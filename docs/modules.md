# Module System

This document describes how the OpenFOAM GUI module system works.

## Overview

The OpenFOAM GUI uses a unified module system where all simulation case types (Wind Tunnel, Propeller, and any imported/custom modules) are stored in the same location and loaded dynamically at startup.

## Storage Location

All modules are stored under `modules/` in the project root:

```
OpenFOAM_GUI/
└── modules/
    ├── wind_tunnel/     # Built-in Wind Tunnel module
    ├── propeller/       # Built-in Propeller module
    └── {imported}/      # Any imported modules
```

## Module Structure

Each module must have the following structure:

```
module_name/
├── backend/
│   └── main.py          # FastAPI app (must export 'app')
├── frontend/
│   └── index.html       # Main HTML page
├── module.json          # Module manifest (recommended)
├── templates/           # OpenFOAM case templates
├── runs/                # Simulation run data (gitignored)
├── logs/                # Simulation logs (gitignored)
├── meshes/              # Uploaded meshes (gitignored)
└── metadata/            # Run metadata JSON files (gitignored)
```

### Required Files

- `backend/main.py` - Must export a FastAPI app as `app`

### Optional Files

- `module.json` - Module manifest with display info
- `frontend/index.html` - Module UI
- `templates/` - OpenFOAM case template files

## Module Manifest (`module.json`)

```json
{
  "id": "module_id",
  "name": "Display Name",
  "type": "module_type",
  "route": "/route/",
  "icon": "📦",
  "description": "Module description",
  "features": ["Feature 1", "Feature 2"],
  "version": "1.0.0"
}
```

| Field | Description |
|-------|-------------|
| `id` | Unique identifier (matches directory name) |
| `name` | Human-readable display name |
| `type` | Module type for API routing |
| `route` | URL route (e.g., `/windtunnel/`) |
| `icon` | Emoji icon for landing page |
| `description` | Short description |
| `features` | List of feature strings |
| `version` | Semantic version |

## Module Loading

### Startup Sequence

1. **Initialization**: `module_manager.initialize()` called on startup
2. **Directory Sync**: Ensures `modules/` and `cases/` directories exist
3. **Discovery**: Scans `modules/` for directories with `backend/main.py`
4. **Registry Sync**: Adds discovered modules to `cases/registry.json`
5. **Mounting**: Each module's FastAPI app is loaded and mounted at its route

### Discovery Process

```python
# module_manager.discover_modules()
for directory in modules/:
    if directory/backend/main.py exists:
        load module.json (if exists)
        add to discovered modules list
```

### App Loading

```python
# module_manager.load_module_app()
1. Import backend/main.py dynamically
2. Extract 'app' attribute
3. Return FastAPI app object
```

### Mounting

```python
# module_manager.mount_module()
main_app.mount("/windtunnel", module_app)
```

## Registry

All modules are tracked in `cases/registry.json`:

```json
{
  "schema_version": "1.0",
  "cases": {
    "wind_tunnel": {
      "id": "wind_tunnel",
      "name": "Wind Tunnel",
      "category": "module",
      "type": "windtunnel",
      "path": "modules/wind_tunnel",
      "route": "/windtunnel/",
      "icon": "🌬️",
      "description": "External aerodynamics",
      "features": [],
      "status": "valid",
      "created_at": "2025-01-01T00:00:00",
      "updated_at": "2025-01-01T00:00:00"
    }
  },
  "order": ["wind_tunnel", "propeller"]
}
```

## Import/Export

### Export

Creates a ZIP archive containing:
- Module code (`backend/`, `frontend/`, `templates/`)
- Module manifest (`module.json`)
- Optionally: `runs/` and `meshes/`

```bash
POST /api/cases/{id}/export?include_runs=false&include_meshes=false
```

### Import

1. Upload ZIP to `/api/cases/upload`
2. System inspects archive for runs/meshes
3. Complete import with `/api/cases/import/complete`
4. Module extracted to `modules/{new_id}/`
5. Added to registry and mounted

## Adding a New Module

### Manual Creation

1. Create directory: `modules/my_module/`
2. Add `backend/main.py` with FastAPI app
3. Add `frontend/index.html` (optional)
4. Add `module.json` manifest (optional)
5. Restart server

### From Template

1. Copy existing module directory
2. Rename and update `module.json`
3. Modify backend/frontend code
4. Restart server

The module will be auto-discovered and mounted.

## Key Files

| File | Purpose |
|------|---------|
| `module_manager.py` | Discovery, loading, mounting |
| `case_manager.py` | Registry, import/export |
| `main.py` | Server startup, module initialization |

## Related Documentation

- [Architecture](architecture.md) - System design overview
- [Development](development.md) - Creating new modules
- [API Reference](api.md) - Endpoint documentation
