#!/usr/bin/env python3
"""Quick verification that all boundary mapper components load correctly."""
import sys, json
from pathlib import Path

root = Path(__file__).parent
sys.path.insert(0, str(root))

# 1. Shared imports
from shared.mesh_introspection import introspect_mesh, _parse_boundary, _parse_zone_file
from shared.boundary_schema import (
    validate_mapping, load_mapping, save_mapping,
    generate_legacy_mapping, create_empty_mapping,
    get_patches_for_endpoint, get_instance_patches,
)
print("OK: shared imports")

# 2. Module schemas
for mod in ["wind_tunnel", "propeller", "blank_template"]:
    p = root / "modules" / mod / "module.json"
    data = json.loads(p.read_text())
    schema = data.get("endpointSchema", {})
    eps = len(schema.get("endpoints", []))
    rgs = len(schema.get("repeatingGroups", []))
    print(f"OK: {mod} -> {eps} endpoints, {rgs} repeatingGroups")

# 3. JS file exists
js = root / "shared" / "boundary_mapper.js"
assert js.exists(), "boundary_mapper.js missing"
size = js.stat().st_size
print(f"OK: boundary_mapper.js ({size} bytes)")

print("\nAll verifications passed!")
