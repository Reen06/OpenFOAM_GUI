#!/usr/bin/env python3
"""
Tests for shared/mesh_introspection.py

Run with:
    cd /home/reen/openfoam/Tutorials/Rotating_Setup_Case/OpenFOAM_GUI
    python -m shared.test_introspection
"""

import tempfile
import os
from pathlib import Path

# Add parent to path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from shared.mesh_introspection import introspect_mesh, _parse_boundary, _parse_zone_file


def _write(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


def test_parse_boundary_basic():
    """Test parsing a standard boundary file."""
    with tempfile.TemporaryDirectory() as tmpdir:
        case_dir = Path(tmpdir)
        boundary_file = case_dir / "constant" / "polyMesh" / "boundary"
        _write(boundary_file, """
FoamFile
{
    version     2.0;
    format      ascii;
    class       polyBoundaryMesh;
    object      boundary;
}
3
(
    inlet
    {
        type            patch;
        nFaces          100;
        startFace       50000;
    }
    outlet
    {
        type            patch;
        nFaces          100;
        startFace       50100;
    }
    walls
    {
        type            wall;
        nFaces          5000;
        startFace       50200;
    }
)
""")
        result = introspect_mesh(case_dir)

        assert len(result["patches"]) == 3, f"Expected 3 patches, got {len(result['patches'])}"
        names = [p["name"] for p in result["patches"]]
        assert "inlet" in names
        assert "outlet" in names
        assert "walls" in names

        inlet = next(p for p in result["patches"] if p["name"] == "inlet")
        assert inlet["type"] == "patch"
        assert inlet["nFaces"] == 100

        walls = next(p for p in result["patches"] if p["name"] == "walls")
        assert walls["type"] == "wall"
        assert walls["nFaces"] == 5000

        print("  PASS: test_parse_boundary_basic")


def test_parse_boundary_with_comments():
    """Test that C/C++ comments are stripped."""
    with tempfile.TemporaryDirectory() as tmpdir:
        case_dir = Path(tmpdir)
        boundary_file = case_dir / "constant" / "polyMesh" / "boundary"
        _write(boundary_file, """
FoamFile
{
    version     2.0;
    format      ascii;
    class       polyBoundaryMesh;
    object      boundary;
}
// This is a comment
1
(
    /* Block comment */
    myPatch
    {
        type            patch;
        nFaces          42;
        startFace       0;
    }
)
""")
        result = introspect_mesh(case_dir)
        assert len(result["patches"]) == 1
        assert result["patches"][0]["name"] == "myPatch"
        assert result["patches"][0]["nFaces"] == 42
        print("  PASS: test_parse_boundary_with_comments")


def test_parse_boundary_empty():
    """Test with no boundary file."""
    with tempfile.TemporaryDirectory() as tmpdir:
        case_dir = Path(tmpdir)
        result = introspect_mesh(case_dir)
        assert result["patches"] == []
        assert result["cellZones"] == []
        assert result["metadata"]["nPatches"] == 0
        print("  PASS: test_parse_boundary_empty")


def test_parse_zone_file():
    """Test parsing a cellZones file."""
    with tempfile.TemporaryDirectory() as tmpdir:
        case_dir = Path(tmpdir)
        zones_file = case_dir / "constant" / "polyMesh" / "cellZones"
        _write(zones_file, """
FoamFile
{
    version     2.0;
    format      ascii;
    class       regIOobject;
    object      cellZones;
}
2
(
    rotorCells
    {
        type    cellZone;
        cellLabels  List<label> 500 ( 0 1 2 );
    }
    statorCells
    {
        type    cellZone;
        cellLabels  List<label> 1000 ( 500 501 502 );
    }
)
""")
        result = introspect_mesh(case_dir)
        assert len(result["cellZones"]) == 2, f"Expected 2 cellZones, got {result['cellZones']}"
        assert "rotorCells" in result["cellZones"]
        assert "statorCells" in result["cellZones"]
        print("  PASS: test_parse_zone_file")


def test_many_patches():
    """Test with a large number of patches."""
    with tempfile.TemporaryDirectory() as tmpdir:
        case_dir = Path(tmpdir)
        boundary_file = case_dir / "constant" / "polyMesh" / "boundary"

        n = 50
        patches_str = ""
        for i in range(n):
            patches_str += f"""
    patch_{i}
    {{
        type            patch;
        nFaces          {i * 10 + 1};
        startFace       {i * 1000};
    }}
"""
        _write(boundary_file, f"""
FoamFile
{{
    version     2.0;
    format      ascii;
    class       polyBoundaryMesh;
    object      boundary;
}}
{n}
(
{patches_str}
)
""")
        result = introspect_mesh(case_dir)
        assert len(result["patches"]) == n, f"Expected {n} patches, got {len(result['patches'])}"
        print("  PASS: test_many_patches")


def test_metadata():
    """Test that metadata is populated correctly."""
    with tempfile.TemporaryDirectory() as tmpdir:
        case_dir = Path(tmpdir)
        boundary_file = case_dir / "constant" / "polyMesh" / "boundary"
        _write(boundary_file, """
FoamFile
{
    version     2.0;
    format      ascii;
    class       polyBoundaryMesh;
    object      boundary;
}
1
(
    inlet { type patch; nFaces 10; startFace 0; }
)
""")
        result = introspect_mesh(case_dir)
        assert result["metadata"]["source"] == "polyMesh"
        assert result["metadata"]["nPatches"] == 1
        assert result["metadata"]["nCellZones"] == 0
        assert str(case_dir) in result["metadata"]["casePath"]
        print("  PASS: test_metadata")


if __name__ == "__main__":
    print("Running mesh introspection tests...")
    test_parse_boundary_basic()
    test_parse_boundary_with_comments()
    test_parse_boundary_empty()
    test_parse_zone_file()
    test_many_patches()
    test_metadata()
    print("\nAll introspection tests passed!")
