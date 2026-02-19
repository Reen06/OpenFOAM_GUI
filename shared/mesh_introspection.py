#!/usr/bin/env python3
"""
Mesh Introspection — discovers all patches, cellZones, faceZones, and pointZones
from an OpenFOAM case directory by parsing polyMesh files.

Works after any mesh converter (ideasUnvToFoam, gmshToFoam, etc.) has been run.
No hardcoded filtering — returns everything the mesh contains.
"""

import re
import logging
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger("mesh_introspection")


def introspect_mesh(case_dir: Path) -> Dict:
    """
    Discover all groups from a converted OpenFOAM mesh.

    Args:
        case_dir: Path to the OpenFOAM case directory (the one containing
                  constant/, system/, 0/, etc.)

    Returns:
        {
            "patches": [{"name": "...", "type": "...", "nFaces": N}, ...],
            "cellZones": ["cz1", ...],
            "faceZones": ["fz1", ...],
            "pointZones": ["pz1", ...],
            "metadata": {
                "source": "polyMesh",
                "casePath": str(case_dir),
                "nPatches": N,
                "nCellZones": N,
                "nFaceZones": N,
                "nPointZones": N,
            }
        }
    """
    polymesh_dir = case_dir / "constant" / "polyMesh"

    patches = _parse_boundary(polymesh_dir / "boundary")
    cell_zones = _parse_zone_file(polymesh_dir / "cellZones")
    face_zones = _parse_zone_file(polymesh_dir / "faceZones")
    point_zones = _parse_zone_file(polymesh_dir / "pointZones")

    result = {
        "patches": patches,
        "cellZones": cell_zones,
        "faceZones": face_zones,
        "pointZones": point_zones,
        "metadata": {
            "source": "polyMesh",
            "casePath": str(case_dir),
            "nPatches": len(patches),
            "nCellZones": len(cell_zones),
            "nFaceZones": len(face_zones),
            "nPointZones": len(point_zones),
        },
    }

    return result


def _parse_boundary(boundary_file: Path) -> List[Dict]:
    """
    Parse constant/polyMesh/boundary to extract patch info.

    Returns a list of dicts: [{"name": str, "type": str, "nFaces": int}, ...]
    """
    if not boundary_file.exists():
        logger.debug(f"Boundary file not found: {boundary_file}")
        return []

    try:
        content = boundary_file.read_text()

        # Strip C/C++ comments
        content = _strip_comments(content)

        patches = []
        # Match patch blocks: patchName { type ...; nFaces ...; ... }
        pattern = r'(\w+)\s*\{\s*type\s+(\w+)\s*;[^}]*nFaces\s+(\d+)\s*;[^}]*\}'
        for match in re.finditer(pattern, content, re.DOTALL):
            name = match.group(1)
            ptype = match.group(2)
            nfaces = int(match.group(3))

            # Skip the FoamFile header block
            if name == "FoamFile":
                continue

            patches.append({
                "name": name,
                "type": ptype,
                "nFaces": nfaces,
            })

        return patches

    except Exception as e:
        logger.warning(f"Error parsing boundary file {boundary_file}: {e}")
        return []


def _parse_zone_file(zone_file: Path) -> List[Dict]:
    """
    Parse an OpenFOAM zone file (cellZones, faceZones, or pointZones).

    Handles both ASCII and binary format files. Binary files have a readable
    ASCII header containing a ``meta { names N ( name1 name2 ... ); }`` block
    from which zone names can be extracted. Cell counts are extracted from the
    text markers surrounding binary data.

    Returns a list of dicts: [{"name": str, "nCells": int}, ...]
    """
    if not zone_file.exists():
        return []

    # ------------------------------------------------------------------
    # Read the file as bytes and extract printable ASCII content.  The
    # FoamFile header, zone names, and size markers are always ASCII
    # even when the cell-label data itself is binary.
    # ------------------------------------------------------------------
    try:
        raw = zone_file.read_bytes()
    except Exception as e:
        logger.warning(f"Could not read zone file {zone_file}: {e}")
        return []

    # Decode to ASCII, replacing non-printable bytes
    text = raw.decode('ascii', errors='replace')

    # ------------------------------------------------------------------
    # Strategy 1: Parse the "meta" header for zone names, then scan the
    # body for cell counts.
    # Format: meta { names N ( name1 name2 ... ); }
    # ------------------------------------------------------------------
    meta_match = re.search(
        r'meta\s*\{[^}]*names\s+\d+\s*\(\s*([^)]+)\s*\)',
        text[:4096], re.DOTALL
    )
    if meta_match:
        names_str = meta_match.group(1).strip()
        zone_names = [n.strip() for n in names_str.split() if n.strip()]
        if zone_names:
            logger.debug(f"Parsed {len(zone_names)} zone(s) from meta header of {zone_file.name}: {zone_names}")
            # Extract cell counts for each zone from body text markers.
            # Pattern: zoneName\n{\n    type  cellZone;\n    cellLabels  List<label>\nN
            # or:      zoneName { type cellZone; cellLabels List<label> N
            zones = []
            for name in zone_names:
                n_cells = 0
                # Look for: zoneName ... cellLabels ... List<label> ... N
                count_pattern = re.escape(name) + r'[^}]*?(?:cellLabels|faceLabels)\s+List<label>\s*(\d+)'
                count_match = re.search(count_pattern, text, re.DOTALL)
                if count_match:
                    n_cells = int(count_match.group(1))
                zones.append({"name": name, "nCells": n_cells})
            return zones

    # ------------------------------------------------------------------
    # Strategy 2: Full-text regex parse (works for ASCII format files).
    # ------------------------------------------------------------------
    try:
        content = _strip_comments(text)

        zones = []

        # Remove FoamFile header block
        content = re.sub(
            r'FoamFile\s*\{[^}]*\}', '', content, count=1, flags=re.DOTALL
        )

        # Find the outer list: N ( ... )
        list_match = re.search(r'\(\s*(.*)\s*\)', content, re.DOTALL)
        if list_match:
            list_content = list_match.group(1)
            # Match zone blocks: zoneName { type ...; cellLabels List<label> N ... }
            zone_pattern = r'(\w+)\s*\{([^}]*)\}'
            for m in re.finditer(zone_pattern, list_content):
                zone_name = m.group(1)
                zone_body = m.group(2)
                # Skip keywords that aren't zone names
                if zone_name.lower() in ('type', 'flipmap'):
                    continue
                # Extract cell count
                n_cells = 0
                count_match = re.search(r'(?:cellLabels|faceLabels)\s+List<label>\s*(\d+)', zone_body)
                if count_match:
                    n_cells = int(count_match.group(1))
                else:
                    # Alternative: count from inline list
                    count_match = re.search(r'(?:cellLabels|faceLabels)\s+(\d+)', zone_body)
                    if count_match:
                        n_cells = int(count_match.group(1))
                zones.append({"name": zone_name, "nCells": n_cells})

        return zones

    except Exception as e:
        logger.warning(f"Error parsing zone file {zone_file}: {e}")
        return []


def _strip_comments(text: str) -> str:
    """Remove C-style (/* ... */) and C++-style (// ...) comments."""
    # Remove block comments
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
    # Remove line comments (but not inside the header block markers)
    text = re.sub(r'//.*?$', '', text, flags=re.MULTILINE)
    return text


# ---------------------------------------------------------------------------
# Debug helpers
# ---------------------------------------------------------------------------

def debug_print_introspection(result: Dict) -> str:
    """
    Format introspection results as a human-readable string for logging.
    """
    lines = []
    lines.append("=" * 60)
    lines.append("MESH INTROSPECTION RESULTS")
    lines.append(f"  Case: {result['metadata']['casePath']}")
    lines.append(f"  Source: {result['metadata']['source']}")
    lines.append("-" * 60)

    lines.append(f"  Patches ({result['metadata']['nPatches']}):")
    for p in result["patches"]:
        lines.append(f"    - {p['name']:30s}  type={p['type']:15s}  nFaces={p['nFaces']}")

    if result["cellZones"]:
        lines.append(f"  Cell Zones ({result['metadata']['nCellZones']}):")
        for z in result["cellZones"]:
            lines.append(f"    - {z['name']:30s}  nCells={z['nCells']}")

    if result["faceZones"]:
        lines.append(f"  Face Zones ({result['metadata']['nFaceZones']}):")
        for z in result["faceZones"]:
            lines.append(f"    - {z['name']:30s}  nCells={z['nCells']}")

    if result["pointZones"]:
        lines.append(f"  Point Zones ({result['metadata']['nPointZones']}):")
        for z in result["pointZones"]:
            lines.append(f"    - {z['name']:30s}  nCells={z['nCells']}")

    lines.append("=" * 60)
    return "\n".join(lines)

