# API Reference

This document describes the REST API endpoints exposed by OpenFOAM GUI.

## Base URL

```
http://localhost:6060
```

## Main Server Endpoints

### Landing Page

```
GET /
```

Returns the main landing page HTML.

---

### Global Status

```
GET /api/status
```

Returns status of all running simulations across all modules.

**Response:**
```json
{
  "running": [
    {
      "module_id": "wind_tunnel",
      "module_name": "Wind Tunnel",
      "module_icon": "🌬️",
      "run_id": "run_20260202_123456",
      "run_name": "Test Run 1",
      "progress": 45,
      "elapsed_seconds": 120,
      "status": "running",
      "view_url": "/windtunnel/"
    }
  ]
}
```

---

### Stop Simulation

```
POST /api/stop/{sim_type}/{run_id}
```

Stops a running simulation by proxying to the sub-app.

**Parameters:**
- `sim_type`: Module type (e.g., `windtunnel`, `propeller`)
- `run_id`: The run identifier

---

## Case Management API

### List Cases

```
GET /api/cases
```

Returns all registered cases/modules.

**Response:**
```json
{
  "cases": [
    {
      "id": "wind_tunnel",
      "name": "Wind Tunnel",
      "type": "windtunnel",
      "route": "/windtunnel/",
      "icon": "🌬️",
      "description": "External aerodynamics simulator",
      "features": ["Drag analysis", "Lift calculation"],
      "status": "valid",
      "path": "modules/wind_tunnel"
    }
  ],
  "order": ["wind_tunnel", "propeller"]
}
```

---

### Get Single Case

```
GET /api/cases/{case_id}
```

**Response:**
```json
{
  "id": "wind_tunnel",
  "name": "Wind Tunnel",
  "type": "windtunnel",
  ...
}
```

---

### Update Case Metadata

```
PUT /api/cases/{case_id}
```

**Request Body:**
```json
{
  "name": "My Wind Tunnel",
  "icon": "✈️",
  "description": "Custom description",
  "features": ["Feature 1", "Feature 2"]
}
```

---

### Delete Case

```
DELETE /api/cases/{case_id}
```

Deletes a case and its files. Built-in modules cannot be deleted.

---

### Export Case

```
POST /api/cases/{case_id}/export?include_runs=false&include_meshes=false
```

Exports a case as a ZIP archive.

**Query Parameters:**
- `include_runs` (bool): Include simulation runs
- `include_meshes` (bool): Include mesh library

**Response:** ZIP file download

---

### Upload/Import Case

```
POST /api/cases/upload
```

Upload a ZIP archive to import as a new case.

**Content-Type:** `multipart/form-data`

**Response:**
```json
{
  "success": true,
  "staging_id": "temp_abc123",
  "has_runs": true,
  "has_meshes": false,
  "name": "Imported Module"
}
```

---

### Complete Import

```
POST /api/cases/import/complete
```

Complete a staged import with options.

**Request Body:**
```json
{
  "staging_id": "temp_abc123",
  "skip_runs": false,
  "skip_meshes": true
}
```

---

### Save Display Order

```
POST /api/cases/order
```

Save the display order of modules on the landing page.

**Request Body:**
```json
{
  "order": ["propeller", "wind_tunnel"]
}
```

---

### Revalidate Case

```
POST /api/cases/{case_id}/revalidate
```

Re-check a case's directory structure and update status.

---

## Module APIs

Each module exposes its own API at its route prefix.

### Wind Tunnel (`/windtunnel/`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/windtunnel/` | GET | Module UI |
| `/windtunnel/api/meshes` | GET | List meshes |
| `/windtunnel/api/meshes/upload` | POST | Upload mesh |
| `/windtunnel/api/run` | POST | Start simulation |
| `/windtunnel/api/runs` | GET | List saved runs |
| `/windtunnel/api/runs/{id}` | DELETE | Delete run |
| `/windtunnel/api/status` | GET | Current run status |
| `/windtunnel/ws/logs/{id}` | WS | Live log stream |

### Propeller (`/propeller/`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/propeller/` | GET | Module UI |
| `/propeller/api/meshes` | GET | List meshes |
| `/propeller/api/meshes/upload` | POST | Upload mesh |
| `/propeller/api/run` | POST | Start simulation |
| `/propeller/api/runs` | GET | List saved runs |
| `/propeller/api/runs/{id}` | DELETE | Delete run |
| `/propeller/api/status` | GET | Current run status |
| `/propeller/ws/logs/{id}` | WS | Live log stream |

---

## WebSocket Connections

### Log Streaming

```
WS /windtunnel/ws/logs/{run_id}
WS /propeller/ws/logs/{run_id}
```

Streams live solver output during simulation.

**Messages:**
```json
{"type": "log", "data": "Time = 0.001\n"}
{"type": "progress", "value": 25}
{"type": "complete", "success": true}
{"type": "error", "message": "Solver crashed"}
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "detail": "Error description"
}
```

HTTP Status Codes:
- `400` - Bad request
- `404` - Not found
- `500` - Server error
