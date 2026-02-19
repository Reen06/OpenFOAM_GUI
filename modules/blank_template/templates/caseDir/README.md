# Case Template Directory

This directory should contain your OpenFOAM case template files.

When a new run is created, the contents of this directory are copied to the
run's working directory. The mesh is then imported into this case structure.

## Expected Structure

```
caseDir/
  0/            # Initial boundary conditions (U, p, k, omega, etc.)
  constant/     # Mesh and physical properties (transportProperties, etc.)
  system/       # Solver settings (controlDict, fvSchemes, fvSolution)
```

## Instructions

1. Copy your OpenFOAM case's `0/`, `constant/`, and `system/` directories here
2. Remove any existing `constant/polyMesh/` — this will be created from the uploaded mesh
3. The `_apply_settings()` method in `workflow.py` will modify these files at runtime

See `BLANK_MODULE_GUIDE.md` in the module root for detailed instructions.
