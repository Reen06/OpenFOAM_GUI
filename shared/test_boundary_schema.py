#!/usr/bin/env python3
"""
Tests for shared/boundary_schema.py

Run with:
    cd /home/reen/openfoam/Tutorials/Rotating_Setup_Case/OpenFOAM_GUI
    python -m shared.test_boundary_schema
"""

import tempfile
import json
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from shared.boundary_schema import (
    validate_mapping,
    get_patches_for_endpoint,
    get_instance_patches,
    get_instance_parameter,
    get_all_mapped_patches,
    create_empty_mapping,
    save_mapping,
    load_mapping,
    generate_legacy_mapping,
)


# -- Test schemas --

WIND_TUNNEL_SCHEMA = {
    "endpoints": [
        {"key": "inlet", "label": "Inlet", "type": "patch", "required": True, "multiple": True},
        {"key": "outlet", "label": "Outlet", "type": "patch", "required": True, "multiple": True},
        {"key": "walls", "label": "Domain Walls", "type": "patch", "required": False, "multiple": True},
        {"key": "geometry", "label": "Geometry", "type": "patch", "required": False, "multiple": True},
    ],
    "repeatingGroups": [],
}

PROPELLER_SCHEMA = {
    "endpoints": [
        {"key": "inlet", "label": "Inlet", "type": "patch", "required": True, "multiple": True},
        {"key": "outlet", "label": "Outlet", "type": "patch", "required": True, "multiple": True},
        {"key": "domainWalls", "label": "Domain Walls", "type": "patch", "required": False, "multiple": True},
    ],
    "repeatingGroups": [
        {
            "key": "propellers",
            "label": "Propeller",
            "min": 1,
            "max": 10,
            "endpoints": [
                {"key": "cellZone", "label": "Rotating Zone", "type": "cellZone", "required": True, "multiple": False},
                {"key": "interfacePatches", "label": "AMI Interfaces", "type": "patch", "required": True, "multiple": True},
                {"key": "geometryPatches", "label": "Propeller Walls", "type": "patch", "required": False, "multiple": True},
            ],
            "parameters": [
                {"key": "rpm", "label": "RPM", "type": "number", "default": 5000},
            ],
        },
    ],
}


def test_valid_mapping():
    mapping = {
        "schema_version": "1.0",
        "module": "wind_tunnel",
        "mappings": {
            "inlet": ["myInlet"],
            "outlet": ["myOutlet"],
            "walls": ["side1", "side2"],
        },
        "patchTypeOverrides": {},
        "instances": {},
    }
    valid, errors = validate_mapping(WIND_TUNNEL_SCHEMA, mapping)
    assert valid, f"Expected valid, got errors: {errors}"
    print("  PASS: test_valid_mapping")


def test_missing_required():
    mapping = create_empty_mapping("wind_tunnel")
    mapping["mappings"]["inlet"] = ["myInlet"]
    # outlet is missing

    valid, errors = validate_mapping(WIND_TUNNEL_SCHEMA, mapping)
    assert not valid
    assert any("Outlet" in e for e in errors), f"Expected outlet error, got: {errors}"
    print("  PASS: test_missing_required")


def test_single_only_endpoint():
    schema = {
        "endpoints": [
            {"key": "mainInlet", "label": "Main Inlet", "type": "patch", "required": True, "multiple": False},
        ],
        "repeatingGroups": [],
    }
    mapping = create_empty_mapping("test")
    mapping["mappings"]["mainInlet"] = ["inlet1", "inlet2"]

    valid, errors = validate_mapping(schema, mapping)
    assert not valid
    assert any("only accepts one" in e for e in errors)
    print("  PASS: test_single_only_endpoint")


def test_repeating_group_valid():
    mapping = create_empty_mapping("propeller")
    mapping["mappings"]["inlet"] = ["inletPatch"]
    mapping["mappings"]["outlet"] = ["outletPatch"]
    mapping["instances"]["propellers"] = [
        {
            "name": "prop1",
            "mappings": {
                "cellZone": ["rotorZone"],
                "interfacePatches": ["statorAMI", "rotorAMI"],
            },
            "parameters": {"rpm": 5200},
        }
    ]

    valid, errors = validate_mapping(PROPELLER_SCHEMA, mapping)
    assert valid, f"Expected valid, got errors: {errors}"
    print("  PASS: test_repeating_group_valid")


def test_repeating_group_missing_instance():
    mapping = create_empty_mapping("propeller")
    mapping["mappings"]["inlet"] = ["inletPatch"]
    mapping["mappings"]["outlet"] = ["outletPatch"]
    mapping["instances"]["propellers"] = []  # min is 1

    valid, errors = validate_mapping(PROPELLER_SCHEMA, mapping)
    assert not valid
    assert any("at least 1" in e for e in errors)
    print("  PASS: test_repeating_group_missing_instance")


def test_repeating_group_missing_required_endpoint():
    mapping = create_empty_mapping("propeller")
    mapping["mappings"]["inlet"] = ["inletPatch"]
    mapping["mappings"]["outlet"] = ["outletPatch"]
    mapping["instances"]["propellers"] = [
        {
            "name": "prop1",
            "mappings": {
                # cellZone is missing (required)
                "interfacePatches": ["ami1"],
            },
            "parameters": {},
        }
    ]

    valid, errors = validate_mapping(PROPELLER_SCHEMA, mapping)
    assert not valid
    assert any("Rotating Zone" in e for e in errors)
    print("  PASS: test_repeating_group_missing_required_endpoint")


def test_get_patches_for_endpoint():
    mapping = create_empty_mapping("test")
    mapping["mappings"]["walls"] = ["side1", "side2", "top"]

    result = get_patches_for_endpoint(mapping, "walls")
    assert result == ["side1", "side2", "top"]

    result = get_patches_for_endpoint(mapping, "nonexistent")
    assert result == []
    print("  PASS: test_get_patches_for_endpoint")


def test_get_instance_patches():
    mapping = create_empty_mapping("propeller")
    mapping["instances"]["propellers"] = [
        {"name": "p1", "mappings": {"interfacePatches": ["ami1", "ami2"]}, "parameters": {}},
        {"name": "p2", "mappings": {"interfacePatches": ["ami3"]}, "parameters": {}},
    ]

    result = get_instance_patches(mapping, "propellers", 0, "interfacePatches")
    assert result == ["ami1", "ami2"]

    result = get_instance_patches(mapping, "propellers", 1, "interfacePatches")
    assert result == ["ami3"]

    result = get_instance_patches(mapping, "propellers", 5, "interfacePatches")
    assert result == []
    print("  PASS: test_get_instance_patches")


def test_get_instance_parameter():
    mapping = create_empty_mapping("propeller")
    mapping["instances"]["propellers"] = [
        {"name": "p1", "mappings": {}, "parameters": {"rpm": 4800}},
    ]

    assert get_instance_parameter(mapping, "propellers", 0, "rpm") == 4800
    assert get_instance_parameter(mapping, "propellers", 0, "missing", 999) == 999
    assert get_instance_parameter(mapping, "propellers", 5, "rpm", 0) == 0
    print("  PASS: test_get_instance_parameter")


def test_get_all_mapped_patches():
    mapping = create_empty_mapping("test")
    mapping["mappings"]["inlet"] = ["a", "b"]
    mapping["mappings"]["outlet"] = ["c"]
    mapping["instances"]["group"] = [
        {"name": "g1", "mappings": {"ep1": ["d", "e"]}, "parameters": {}},
    ]

    result = sorted(get_all_mapped_patches(mapping))
    assert result == ["a", "b", "c", "d", "e"]
    print("  PASS: test_get_all_mapped_patches")


def test_save_load_mapping():
    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "mapping.json"
        mapping = create_empty_mapping("test_module")
        mapping["mappings"]["inlet"] = ["a"]

        assert save_mapping(mapping, path)
        loaded = load_mapping(path)
        assert loaded is not None
        assert loaded["module"] == "test_module"
        assert loaded["mappings"]["inlet"] == ["a"]

    print("  PASS: test_save_load_mapping")


def test_legacy_mapping():
    patches = [
        {"name": "inlet", "type": "patch", "nFaces": 100},
        {"name": "outlet", "type": "patch", "nFaces": 100},
        {"name": "walls", "type": "patch", "nFaces": 5000},
        {"name": "model", "type": "patch", "nFaces": 2000},
        {"name": "randomPatch", "type": "patch", "nFaces": 50},
    ]

    mapping = generate_legacy_mapping("wind_tunnel", patches, WIND_TUNNEL_SCHEMA)
    assert "inlet" in mapping["mappings"]["inlet"]
    assert "outlet" in mapping["mappings"]["outlet"]
    assert "walls" in mapping["mappings"]["walls"]
    assert "model" in mapping["mappings"]["geometry"]

    # Type overrides should have walls and model as wall
    assert mapping["patchTypeOverrides"].get("walls") == "wall"
    assert mapping["patchTypeOverrides"].get("model") == "wall"
    print("  PASS: test_legacy_mapping")


if __name__ == "__main__":
    print("Running boundary schema tests...")
    test_valid_mapping()
    test_missing_required()
    test_single_only_endpoint()
    test_repeating_group_valid()
    test_repeating_group_missing_instance()
    test_repeating_group_missing_required_endpoint()
    test_get_patches_for_endpoint()
    test_get_instance_patches()
    test_get_instance_parameter()
    test_get_all_mapped_patches()
    test_save_load_mapping()
    test_legacy_mapping()
    print("\nAll boundary schema tests passed!")
