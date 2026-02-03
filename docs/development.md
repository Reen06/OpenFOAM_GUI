# Development Guide

This guide covers how to contribute to OpenFOAM GUI and create new modules.

## Project Setup

### Clone and Install

```bash
git clone <repository>
cd OpenFOAM_GUI
./install.sh
```

### Development Server

```bash
python3 main.py
```

The server auto-reloads on code changes when using uvicorn directly:
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 6060
```

## Code Structure

### Core Files

| File | Purpose |
|------|---------|
| `main.py` | FastAPI entry point, routes, lifespan |
| `module_manager.py` | Module discovery and mounting |
| `case_manager.py` | Registry and import/export |

### Shared Utilities

| File | Purpose |
|------|---------|
| `shared/performance_analyzer.py` | Force/coefficient extraction |
| `shared/functionobject_manager.py` | OpenFOAM functionObjects |

## Creating a New Module

### 1. Create Module Directory

```bash
mkdir -p modules/my_module/backend
mkdir -p modules/my_module/frontend
mkdir -p modules/my_module/templates
```

### 2. Create Backend (`backend/main.py`)

```python
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.absolute()
MODULE_DIR = SCRIPT_DIR.parent
FRONTEND_DIR = MODULE_DIR / "frontend"

app = FastAPI(title="My Module")

# Serve frontend
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    return FileResponse(FRONTEND_DIR / "index.html")

@app.get("/api/status")
async def get_status():
    return {"status": "ready", "running": None}

# Add your API endpoints here
```

### 3. Create Frontend (`frontend/index.html`)

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>My Module</title>
    <link rel="stylesheet" href="/my_module/static/css/styles.css">
</head>
<body>
    <h1>My Module</h1>
    <script src="/my_module/static/js/app.js"></script>
</body>
</html>
```

### 4. Create Module Manifest (`module.json`)

```json
{
  "id": "my_module",
  "name": "My Module",
  "type": "mymodule",
  "route": "/mymodule/",
  "icon": "🔧",
  "description": "A custom simulation module",
  "features": ["Feature 1", "Feature 2"],
  "version": "1.0.0"
}
```

### 5. Restart Server

The module will be auto-discovered and mounted at `/mymodule/`.

## Backend Patterns

### Job Management

For running long processes:

```python
import subprocess
import asyncio

class JobManager:
    def __init__(self):
        self.process = None
        self.running = False
    
    async def start(self, cmd, cwd):
        self.process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT
        )
        self.running = True
    
    async def stop(self):
        if self.process:
            self.process.terminate()
            await self.process.wait()
        self.running = False
```

### WebSocket Log Streaming

```python
from fastapi import WebSocket

@app.websocket("/ws/logs/{run_id}")
async def log_stream(websocket: WebSocket, run_id: str):
    await websocket.accept()
    try:
        async for line in read_log_lines(run_id):
            await websocket.send_json({"type": "log", "data": line})
    except Exception:
        pass
    finally:
        await websocket.close()
```

### File Upload

```python
from fastapi import UploadFile, File

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    content = await file.read()
    dest = MODULE_DIR / "uploads" / file.filename
    dest.write_bytes(content)
    return {"filename": file.filename}
```

## Frontend Patterns

### API Calls

```javascript
async function fetchStatus() {
    const response = await fetch('/mymodule/api/status');
    const data = await response.json();
    return data;
}

async function startRun(config) {
    const response = await fetch('/mymodule/api/run', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(config)
    });
    return response.json();
}
```

### WebSocket Connection

```javascript
function connectLogStream(runId) {
    const ws = new WebSocket(`ws://${location.host}/mymodule/ws/logs/${runId}`);
    
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'log') {
            appendToLog(msg.data);
        }
    };
    
    ws.onclose = () => {
        console.log('Log stream closed');
    };
    
    return ws;
}
```

## OpenFOAM Integration

### Generating Case Files

Use templates and string substitution:

```python
def generate_controlDict(end_time, delta_t):
    template = (MODULE_DIR / "templates" / "controlDict").read_text()
    return template.replace("{{END_TIME}}", str(end_time)) \
                   .replace("{{DELTA_T}}", str(delta_t))
```

### Running Solvers

```python
async def run_solver(case_dir, solver="simpleFoam"):
    cmd = ["bash", "-c", f"source /usr/lib/openfoam/openfoam2506/etc/bashrc && {solver}"]
    process = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=case_dir,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT
    )
    return process
```

## Testing

### Manual Testing

1. Start server: `./start.sh`
2. Open browser: `http://localhost:6060`
3. Navigate to module
4. Test workflow

### API Testing

```bash
# Test status endpoint
curl http://localhost:6060/mymodule/api/status

# Test file upload
curl -X POST -F "file=@mesh.unv" http://localhost:6060/mymodule/api/upload
```

## Code Style

- Python: Follow PEP 8
- JavaScript: Use modern ES6+ syntax
- HTML/CSS: Semantic HTML5, BEM naming for CSS

## Git Workflow

1. Create feature branch
2. Make changes
3. Test locally
4. Commit with descriptive message
5. Push and create PR

## Related Documentation

- [Architecture](architecture.md) - System design
- [Modules](modules.md) - Module system details
- [API Reference](api.md) - Endpoint documentation

## External Resources

- [salomeToOpenFOAM](https://github.com/nicolasedh/salomeToOpenFOAM) - Python script for exporting Salome meshes directly to OpenFOAM polyMesh format (alternative to UNV workflow for power users)
