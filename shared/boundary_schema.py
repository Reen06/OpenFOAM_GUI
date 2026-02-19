#!/usr/bin/env python3
"""
Boundary Schema — endpoint declaration DSL and mapping data model.

Modules declare what boundary/zone endpoints they need via an endpoint schema.
Users create mappings that assign discovered mesh groups to those endpoints.
This module handles validation, I/O, and lookup.
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

logger = logging.getLogger("boundary_schema")

# Schema version for mapping files
SCHEMA_VERSION = "1.0"


# ---------------------------------------------------------------------------
# Schema helpers — used by modules to declare their requirements
# ---------------------------------------------------------------------------

def make_endpoint(
    key: str,
    label: str,
    endpoint_type: str = "patch",
    required: bool = True,
    multiple: bool = True,
    description: str = "",
) -> Dict:
    """Create an endpoint declaration for use in a module's endpointSchema."""
    return {
        "key": key,
        "label": label,
        "type": endpoint_type,   # "patch" | "cellZone" | "faceZone" | "pointZone"
        "required": required,
        "multiple": multiple,
        "description": description,
    }


def make_repeating_group(
    key: str,
    label: str,
    endpoints: List[Dict],
    parameters: Optional[List[Dict]] = None,
    min_instances: int = 1,
    max_instances: int = 10,
) -> Dict:
    """Create a repeating group declaration (e.g., multiple propellers)."""
    return {
        "key": key,
        "label": label,
        "min": min_instances,
        "max": max_instances,
        "endpoints": endpoints,
        "parameters": parameters or [],
    }


# ---------------------------------------------------------------------------
# Mapping I/O
# ---------------------------------------------------------------------------

def create_empty_mapping(module_id: str) -> Dict:
    """Create a new empty mapping structure."""
    return {
        "schema_version": SCHEMA_VERSION,
        "module": module_id,
        "mappings": {},
        "patchTypeOverrides": {},
        "instances": {},
    }


def load_mapping(path: Path) -> Optional[Dict]:
    """Load a mapping from a JSON file. Returns None if not found."""
    if not path.exists():
        return None
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"Failed to load mapping from {path}: {e}")
        return None


def save_mapping(mapping: Dict, path: Path) -> bool:
    """Save a mapping to a JSON file."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(mapping, f, indent=2)
        return True
    except IOError as e:
        logger.error(f"Failed to save mapping to {path}: {e}")
        return False


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_mapping(schema: Dict, mapping: Dict) -> Tuple[bool, List[str]]:
    """
    Validate a mapping against a module's endpoint schema.

    Args:
        schema: The module's endpointSchema dict (with "endpoints" and
                optionally "repeatingGroups" keys)
        mapping: The user-created mapping dict

    Returns:
        (is_valid, list_of_error_strings)
    """
    errors = []
    mappings = mapping.get("mappings", {})
    instances = mapping.get("instances", {})

    # Check top-level endpoints
    for ep in schema.get("endpoints", []):
        key = ep["key"]
        required = ep.get("required", False)
        multiple = ep.get("multiple", True)

        assigned = mappings.get(key, [])
        if isinstance(assigned, str):
            assigned = [assigned]

        if required and len(assigned) == 0:
            errors.append(f"Required endpoint '{ep['label']}' ({key}) is not mapped")

        if not multiple and len(assigned) > 1:
            errors.append(
                f"Endpoint '{ep['label']}' ({key}) only accepts one mapping, "
                f"but {len(assigned)} were assigned"
            )

    # Check repeating groups
    for group in schema.get("repeatingGroups", []):
        group_key = group["key"]
        group_instances = instances.get(group_key, [])
        min_inst = group.get("min", 0)
        max_inst = group.get("max", 10)

        if len(group_instances) < min_inst:
            errors.append(
                f"Repeating group '{group['label']}' requires at least "
                f"{min_inst} instance(s), but {len(group_instances)} provided"
            )

        if len(group_instances) > max_inst:
            errors.append(
                f"Repeating group '{group['label']}' allows at most "
                f"{max_inst} instance(s), but {len(group_instances)} provided"
            )

        # Validate each instance's endpoints
        for i, inst in enumerate(group_instances):
            inst_name = inst.get("name", f"#{i + 1}")
            inst_mappings = inst.get("mappings", {})

            for ep in group.get("endpoints", []):
                ep_key = ep["key"]
                required = ep.get("required", False)
                multiple = ep.get("multiple", True)

                assigned = inst_mappings.get(ep_key, [])
                if isinstance(assigned, str):
                    assigned = [assigned]

                if required and len(assigned) == 0:
                    errors.append(
                        f"'{group['label']}' instance '{inst_name}': "
                        f"required endpoint '{ep['label']}' ({ep_key}) is not mapped"
                    )

                if not multiple and len(assigned) > 1:
                    errors.append(
                        f"'{group['label']}' instance '{inst_name}': "
                        f"endpoint '{ep['label']}' ({ep_key}) only accepts one mapping"
                    )

    is_valid = len(errors) == 0
    return is_valid, errors


# ---------------------------------------------------------------------------
# Lookup helpers — used during case generation
# ---------------------------------------------------------------------------

def get_patches_for_endpoint(mapping: Dict, endpoint_key: str) -> List[str]:
    """Get the list of mesh patch/zone names mapped to a given endpoint."""
    assigned = mapping.get("mappings", {}).get(endpoint_key, [])
    if isinstance(assigned, str):
        return [assigned]
    return list(assigned)


def get_instance_patches(
    mapping: Dict, group_key: str, instance_index: int, endpoint_key: str
) -> List[str]:
    """Get patches for a repeating-group instance endpoint."""
    instances = mapping.get("instances", {}).get(group_key, [])
    if instance_index >= len(instances):
        return []
    inst = instances[instance_index]
    assigned = inst.get("mappings", {}).get(endpoint_key, [])
    if isinstance(assigned, str):
        return [assigned]
    return list(assigned)


def get_instance_parameter(
    mapping: Dict, group_key: str, instance_index: int, param_key: str, default: Any = None
) -> Any:
    """Get a parameter value for a repeating-group instance."""
    instances = mapping.get("instances", {}).get(group_key, [])
    if instance_index >= len(instances):
        return default
    return instances[instance_index].get("parameters", {}).get(param_key, default)


def get_all_mapped_patches(mapping: Dict) -> List[str]:
    """Get a flat list of ALL patch/zone names that appear in any mapping."""
    all_patches = set()

    for patches in mapping.get("mappings", {}).values():
        if isinstance(patches, str):
            all_patches.add(patches)
        elif isinstance(patches, list):
            all_patches.update(patches)

    for group_instances in mapping.get("instances", {}).values():
        for inst in group_instances:
            for patches in inst.get("mappings", {}).values():
                if isinstance(patches, str):
                    all_patches.add(patches)
                elif isinstance(patches, list):
                    all_patches.update(patches)

    return list(all_patches)


def get_type_overrides(mapping: Dict) -> Dict[str, str]:
    """Get the patch type overrides dict (patch_name -> desired OpenFOAM type)."""
    return mapping.get("patchTypeOverrides", {})


# ---------------------------------------------------------------------------
# Legacy fallback — auto-generate mapping from patch names
# ---------------------------------------------------------------------------

# Keywords used for heuristic name-matching (backwards compatibility)
_LEGACY_KEYWORDS = {
    "inlet": ["inlet", "inflow", "inlet_stator"],
    "outlet": ["outlet", "outflow", "outlet_stator"],
    "walls": ["walls", "wall", "sides", "top", "bottom", "ground", "outerWall"],
    "geometry": ["model", "object", "body", "car", "wing", "vehicle",
                 "propellerWalls", "propeller"],
    "amiInterfaces": ["statorAMI", "rotorAMI", "AMI"],
}


def generate_legacy_mapping(
    module_id: str,
    patches: List[Dict],
    schema: Optional[Dict] = None,
) -> Dict:
    """
    Generate a best-effort mapping from patch names using the old
    substring-matching logic. Used as a fallback when no mapping file exists.

    Args:
        module_id: The module identifier
        patches: List of patch dicts from introspect_mesh()
        schema: Optional endpoint schema to guide which keys to fill

    Returns:
        A mapping dict (same format as save_mapping/load_mapping)
    """
    mapping = create_empty_mapping(module_id)

    # If we have a schema, use its endpoint keys; otherwise use generic keys
    if schema:
        endpoint_keys = [ep["key"] for ep in schema.get("endpoints", [])]
    else:
        endpoint_keys = list(_LEGACY_KEYWORDS.keys())

    for key in endpoint_keys:
        keywords = _LEGACY_KEYWORDS.get(key, [])
        matched = []
        for p in patches:
            pname = p["name"].lower()
            for kw in keywords:
                if kw.lower() in pname:
                    matched.append(p["name"])
                    break
        if matched:
            mapping["mappings"][key] = matched

    # Auto-set patch type overrides for wall-category patches
    wall_keywords = _LEGACY_KEYWORDS.get("walls", []) + _LEGACY_KEYWORDS.get("geometry", [])
    for p in patches:
        pname = p["name"].lower()
        if any(kw.lower() in pname for kw in wall_keywords):
            if p["type"] == "patch":
                mapping["patchTypeOverrides"][p["name"]] = "wall"

    return mapping


# ---------------------------------------------------------------------------
# Debug helpers
# ---------------------------------------------------------------------------

def debug_print_mapping(schema: Dict, mapping: Dict) -> str:
    """Format mapping + validation results as a human-readable string."""
    lines = []
    lines.append("=" * 60)
    lines.append("BOUNDARY MAPPING")
    lines.append(f"  Module: {mapping.get('module', '?')}")
    lines.append(f"  Schema version: {mapping.get('schema_version', '?')}")
    lines.append("-" * 60)

    # Top-level mappings
    lines.append("  Endpoint Mappings:")
    for key, patches in mapping.get("mappings", {}).items():
        if isinstance(patches, str):
            patches = [patches]
        lines.append(f"    {key:20s} -> {', '.join(patches)}")

    # Type overrides
    overrides = mapping.get("patchTypeOverrides", {})
    if overrides:
        lines.append("  Patch Type Overrides:")
        for name, ptype in overrides.items():
            lines.append(f"    {name:20s} -> {ptype}")

    # Instances
    for group_key, instances in mapping.get("instances", {}).items():
        lines.append(f"  Repeating Group '{group_key}' ({len(instances)} instances):")
        for i, inst in enumerate(instances):
            name = inst.get("name", f"#{i + 1}")
            lines.append(f"    Instance '{name}':")
            for ep_key, patches in inst.get("mappings", {}).items():
                if isinstance(patches, str):
                    patches = [patches]
                lines.append(f"      {ep_key:18s} -> {', '.join(patches)}")
            for pk, pv in inst.get("parameters", {}).items():
                lines.append(f"      {pk:18s} = {pv}")

    # Validation
    is_valid, errors = validate_mapping(schema, mapping)
    lines.append("-" * 60)
    if is_valid:
        lines.append("  VALIDATION: PASSED")
    else:
        lines.append("  VALIDATION: FAILED")
        for err in errors:
            lines.append(f"    WARNING: {err}")

    lines.append("=" * 60)
    return "\n".join(lines)
