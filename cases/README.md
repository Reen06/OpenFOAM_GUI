# Case Management

This document explains how case management works in OpenFOAM GUI.

## Where Cases Are Stored

- **Registry**: `OpenFOAM_GUI/cases/registry.json` - Central database of all cases
- **Builtin Cases**: `WindTunnelGUI/` and `PropellerGUI/` directories
- **Custom Cases**: `CustomCases/` directory for imported cases

## Case Registry Format

Each case in the registry has these fields:

```json
{
  "id": "wind_tunnel",
  "name": "Wind Tunnel",
  "category": "builtin",     // "builtin" or "custom"
  "type": "wind_tunnel",     // Case type identifier
  "path": "WindTunnelGUI",   // Directory path relative to OpenFOAM_GUI
  "route": "/windtunnel/",   // URL route for the case
  "icon": "🌬️",
  "description": "...",
  "features": ["feature1", "feature2"],
  "status": "valid",         // "valid" or "invalid"
  "error": null,             // Error message if invalid
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-26T00:00:00Z"
}
```

## Export/Import Format

Exported cases are ZIP archives containing:

```
case_export.zip
├── manifest.json      # Metadata about the case
├── backend/           # Python FastAPI server
│   └── main.py
├── frontend/          # Web UI files
│   ├── index.html
│   ├── css/
│   └── js/
└── (other files)
```

**manifest.json** contains:
- `case_id`: Unique identifier
- `name`: Display name
- `type`: Case type (wind_tunnel, propeller, custom)
- `description`: Case description
- `features`: List of features
- `exported_at`: Export timestamp

**Note**: Run data (runs/, logs/, meshes/, metadata/) is NOT included in exports to keep files small.

## What Makes a Case Valid

A case must have:
1. `backend/` directory with `main.py` (FastAPI app)
2. `frontend/` directory with `index.html`

## What Makes a Case Invalid

A case is marked invalid if:
- Required directories are missing
- Required files are missing
- Archive extraction failed
- File validation checks failed

## Invalid Case Behavior

Invalid cases:
- Appear on the landing page with an "⚠️ Invalid" badge
- Cannot be opened (Open button is replaced with "View Error")
- Can be re-validated or deleted
- Do NOT crash the app

## How to Recover a Broken Case

1. **View Error**: Click "View Error" to see what's wrong
2. **Re-validate**: Click "Re-validate" if you've fixed the issue
3. **Delete and Re-import**: Delete the case and import a fixed version
4. **Manual Fix**: Navigate to `CustomCases/<case_id>/` and fix missing files

## API Endpoints

- `GET /api/cases` - List all cases
- `GET /api/cases/{id}` - Get single case
- `DELETE /api/cases/{id}` - Delete a case
- `POST /api/cases/{id}/export` - Export case as ZIP
- `POST /api/cases/upload` - Import case from ZIP
- `POST /api/cases/{id}/revalidate` - Re-validate a case
