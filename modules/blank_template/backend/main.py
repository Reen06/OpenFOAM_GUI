#!/usr/bin/env python3
"""
OpenFOAM Blank Module Template - Backend Server

FastAPI server providing REST API and WebSocket log streaming.
Customize this for your specific OpenFOAM case.

See BLANK_MODULE_GUIDE.md for instructions on adapting this template.
"""

import sys
import json
import asyncio
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any

# Add shared modules to path
SCRIPT_DIR = Path(__file__).parent.absolute()
sys.path.append(str(SCRIPT_DIR.parent.parent))  # OpenFOAM_GUI root to access shared


from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File, Form
from fastapi.responses import HTMLResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from contextlib import asynccontextmanager

# Import local modules
from workflow import WorkflowManager
from job_manager import JobManager
from run_manager import RunManager
from mesh_library import MeshLibrary

# Import shared boundary mapping modules
from shared.mesh_introspection import introspect_mesh, debug_print_introspection
from shared.boundary_schema import (
    load_mapping, save_mapping, validate_mapping,
    generate_legacy_mapping, create_empty_mapping,
    debug_print_mapping
)

# Global managers
workflow_manager: WorkflowManager = None
job_manager: JobManager = None
run_manager: RunManager = None
mesh_library: MeshLibrary = None

# WebSocket connections for log streaming
active_websockets: Dict[str, List[WebSocket]] = {}

# Paths
PROJECT_DIR = SCRIPT_DIR.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
TEMPLATES_DIR = PROJECT_DIR / "templates"
RUNS_DIR = PROJECT_DIR / "runs"
MESHES_DIR = PROJECT_DIR / "meshes"
METADATA_DIR = PROJECT_DIR / "metadata"
LOGS_DIR = PROJECT_DIR / "logs"

# OpenFOAM bashrc path
OPENFOAM_BASHRC = "/usr/lib/openfoam/openfoam2506/etc/bashrc"


def init_managers():
    """Initialize managers. Called at module load time to support sub-app mounting."""
    global workflow_manager, job_manager, run_manager, mesh_library
    
    # Skip if already initialized
    if mesh_library is not None:
        return
    
    # Create directories if needed
    RUNS_DIR.mkdir(exist_ok=True)
    MESHES_DIR.mkdir(exist_ok=True)
    METADATA_DIR.mkdir(exist_ok=True)
    LOGS_DIR.mkdir(exist_ok=True)
    
    # Initialize managers
    job_manager = JobManager()
    run_manager = RunManager(RUNS_DIR, TEMPLATES_DIR, METADATA_DIR)
    mesh_library = MeshLibrary(MESHES_DIR, METADATA_DIR)
    workflow_manager = WorkflowManager(OPENFOAM_BASHRC, job_manager, run_manager)
    
    print(f"[INFO] Blank Module Template initialized")
    print(f"[INFO] Project dir: {PROJECT_DIR}")
    print(f"[INFO] Mesh Library: {MESHES_DIR}")


# Initialize managers at module load time (for sub-app mounting)
init_managers()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize managers on startup (for standalone mode)."""
    # Re-init in case we're running standalone
    init_managers()
    
    print(f"[STARTUP] Blank Module Template")
    print(f"[STARTUP] Templates: {TEMPLATES_DIR}")
    print(f"[STARTUP] Runs: {RUNS_DIR}")
    
    yield
    
    # Cleanup
    print("[SHUTDOWN] Cleaning up...")


app = FastAPI(
    title="OpenFOAM Blank Module Template",
    description="Blank module template — customize for your OpenFOAM case",
    version="1.0.0",
    lifespan=lifespan
)

# Mount static files
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
# Mount shared files (for unit_formatter.js, etc.)
SHARED_DIR = PROJECT_DIR.parent / "shared"
if SHARED_DIR.exists():
    app.mount("/shared", StaticFiles(directory=str(SHARED_DIR)), name="shared")


# ============================================================================
# Pydantic Models
# ============================================================================
#
# TODO: Define your case-specific settings models here.
# These models define the JSON structure that the frontend sends
# when starting a simulation.
#
# Example:
#
#   class SolverSettings(BaseModel):
#       solver: str = "simpleFoam"
#       end_time: float = 1000
#       delta_t: float = 1
#       write_interval: float = 100
#       parallel: bool = False
#       num_cores: int = 4
#
#   class MaterialSettings(BaseModel):
#       density: float = 1.225
#       kinematic_viscosity: float = 1.5e-5
#

class CaseSettings(BaseModel):
    """Generic case settings. Replace with your specific settings."""
    end_time: float = 1000
    delta_t: float = 1
    write_interval: float = 100
    parallel: bool = False
    num_cores: int = 4


class RunStartRequest(BaseModel):
    run_id: str
    case_settings: CaseSettings


# ============================================================================
# Root / Frontend
# ============================================================================

@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    """Serve the main frontend page."""
    return FileResponse(FRONTEND_DIR / "index.html")

@app.get("/favicon.ico")
async def favicon():
    """Return empty favicon to prevent 404 errors."""
    return Response(content=b"", media_type="image/x-icon")


# ============================================================================
# User Defaults API
# ============================================================================

@app.get("/api/defaults")
async def get_defaults():
    """Get saved user defaults."""
    defaults_file = PROJECT_DIR / "user_defaults.json"
    if defaults_file.exists():
        return json.loads(defaults_file.read_text())
    return {}

@app.post("/api/defaults")
async def save_defaults(defaults: dict):
    """Save user defaults to server."""
    defaults_file = PROJECT_DIR / "user_defaults.json"
    defaults_file.write_text(json.dumps(defaults, indent=2))
    return {"status": "saved"}


# ============================================================================
# Mesh Library API
# ============================================================================

@app.get("/api/mesh/library")
async def list_mesh_library():
    """List all meshes in the library."""
    meshes = mesh_library.list_meshes()
    return {"meshes": meshes}

@app.post("/api/mesh/library")
async def add_to_mesh_library(
    name: str = Form(...),
    project: str = Form("default"),
    mesh_file: UploadFile = File(...),
    run_id: str = Form(None)
):
    """Add a mesh file to the library."""
    try:
        # Save uploaded file
        mesh_path = MESHES_DIR / f"temp_{mesh_file.filename}"
        with open(mesh_path, "wb") as f:
            content = await mesh_file.read()
            f.write(content)
        
        # Add to library
        mesh_id = mesh_library.add_mesh(
            name=name,
            project=project,
            mesh_path=mesh_path,
            run_id=run_id
        )
        
        # Clean up temp file
        if mesh_path.exists():
            mesh_path.unlink()
        
        return {"mesh_id": mesh_id, "message": f"Mesh '{name}' added to library"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/mesh/library/{mesh_id}")
async def delete_from_mesh_library(mesh_id: str):
    """Delete a mesh from the library."""
    mesh_library.delete_mesh(mesh_id)
    return {"status": "deleted"}

@app.get("/api/mesh/library/{mesh_id}/download")
async def download_mesh(mesh_id: str):
    """Download the original mesh file (.unv/.msh) from the library."""
    mesh_info = mesh_library.get_mesh(mesh_id)
    if not mesh_info:
        raise HTTPException(status_code=404, detail="Mesh not found")
    
    mesh_path = mesh_info.get("path")
    if not mesh_path or not Path(mesh_path).exists():
        raise HTTPException(status_code=404, detail="Mesh file not found")
    
    return FileResponse(
        path=mesh_path,
        filename=Path(mesh_path).name,
        media_type="application/octet-stream"
    )

@app.post("/api/mesh/library/{mesh_id}/use")
async def use_mesh_from_library(mesh_id: str, request: dict = None):
    """Create a new run using a mesh from the library."""
    run_name = request.get("run_name") if request else None
    
    mesh_info = mesh_library.get_mesh(mesh_id)
    if not mesh_info:
        raise HTTPException(status_code=404, detail="Mesh not found")
    
    # Create run from mesh
    result = run_manager.create_run_from_mesh(
        mesh_id=mesh_id,
        mesh_name=mesh_info["name"],
        mesh_path=Path(mesh_info["path"]) if mesh_info.get("path") else None,
        run_name=run_name,
        polymesh_source_path=Path(mesh_info["polymesh_path"]) if mesh_info.get("polymesh_path") else None
    )
    
    return result


# ============================================================================
# Mesh Upload API
# ============================================================================

@app.post("/api/mesh/upload")
async def upload_mesh(
    mesh_file: UploadFile = File(...),
    run_name: str = Form(None)
):
    """Upload a mesh file and create a new run."""
    try:
        # Generate run ID
        run_id = run_manager._generate_run_id(run_name)
        run_dir = RUNS_DIR / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        
        # Save mesh file
        mesh_path = run_dir / mesh_file.filename
        with open(mesh_path, "wb") as f:
            content = await mesh_file.read()
            f.write(content)
        
        # Check UNV units if applicable
        unit_warning = None
        if mesh_file.filename.lower().endswith('.unv'):
            try:
                from shared.unv_units import parse_unv_units
                unit_info = parse_unv_units(str(mesh_path))
                if unit_info.get("found"):
                    if not unit_info.get("is_meter"):
                        unit_warning = {
                            "unit_name": unit_info.get("unit_name", "Unknown"),
                            "length_label": unit_info.get("length_label", "?"),
                            "length_scale": unit_info.get("length_scale"),
                            "message": f"Mesh units are '{unit_info.get('unit_name', 'Unknown')}' ({unit_info.get('length_label', '?')}), not SI Meters. OpenFOAM assumes all coordinates are in meters. Results may be incorrect unless the mesh is scaled."
                        }
            except Exception as e:
                print(f"[WARN] Could not parse UNV units: {e}")
        
        # Create run metadata
        run_manager.create_run_entry(
            run_id=run_id,
            run_name=run_name,
            mesh_filename=mesh_file.filename
        )
        
        response = {
            "run_id": run_id,
            "mesh_path": str(mesh_path),
            "message": "Mesh uploaded successfully"
        }
        
        if unit_warning:
            response["unit_warning"] = unit_warning
        
        return response
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Run Management API
# ============================================================================

@app.get("/api/run/list")
async def list_runs():
    """List all runs."""
    runs = run_manager.list_runs()
    return {"runs": runs}

@app.get("/api/run/{run_id}")
async def get_run_details(run_id: str):
    """Get detailed information about a run."""
    details = run_manager.get_run_details(run_id)
    if not details:
        raise HTTPException(status_code=404, detail="Run not found")
    return details

@app.get("/api/job/{run_id}/status")
async def get_job_status(run_id: str):
    """Get the current status of a background job."""
    status = job_manager.get_job_status(run_id)
    if not status:
        # Check if it's a completed run
        details = run_manager.get_run_details(run_id)
        if details:
            return {
                "run_id": run_id,
                "status": details.get("status", "unknown"),
                "progress": 100 if details.get("status") == "completed" else 0,
                "size_bytes": details.get("size_bytes", 0)
            }
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Add current size for active runs
    run_dir = run_manager.get_run_directory(run_id)
    if run_dir:
        status["size_bytes"] = run_manager._get_dir_size(run_dir)
    
    return status

@app.get("/api/run/{run_id}/patches")
async def get_run_patches(run_id: str):
    """Get detected patches for a run."""
    run_dir = run_manager.get_run_directory(run_id)
    if not run_dir:
        raise HTTPException(status_code=404, detail="Run not found")
    
    # TODO: Update "caseDir" to match your case directory name
    patches = workflow_manager.get_patches(run_dir / "caseDir")
    return {"patches": patches}


@app.post("/api/run/{run_id}/check-mesh")
async def check_mesh(run_id: str):
    """Run checkMesh on the run's polyMesh and return quality report."""
    run_dir = run_manager.get_run_directory(run_id)
    if not run_dir:
        raise HTTPException(status_code=404, detail="Run not found")
    
    # TODO: Update "caseDir" to match your case directory name
    case_dir = run_dir / "caseDir"
    if not (case_dir / "constant" / "polyMesh").exists():
        raise HTTPException(status_code=400, detail="No mesh found. Create mesh first.")
    
    import subprocess
    import re
    
    try:
        # Run checkMesh
        cmd = f'source {OPENFOAM_BASHRC} && cd "{case_dir}" && checkMesh 2>&1'
        result = subprocess.run(
            ['bash', '-c', cmd],
            capture_output=True,
            text=True,
            timeout=60
        )
        
        output = result.stdout + result.stderr
        
        # Parse results
        issues = []
        warnings = []
        stats = {}
        
        # Check for failed checks
        if "FAILED" in output or "***" in output:
            failed_matches = re.findall(r'\*\*\*(.*?)\*\*\*', output, re.DOTALL)
            for match in failed_matches:
                issues.append(match.strip())
        
        # Check for mesh OK
        mesh_ok = "Mesh OK" in output and len(issues) == 0
        
        return {
            "success": True,
            "mesh_ok": mesh_ok,
            "issues": issues,
            "warnings": warnings,
            "stats": stats,
            "output": output[-3000:] if len(output) > 3000 else output
        }
        
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "checkMesh timed out"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/api/run/{run_id}/create-polymesh")
async def create_polymesh(run_id: str):
    """Create polyMesh from uploaded mesh file."""
    run_dir = run_manager.get_run_directory(run_id)
    if not run_dir:
        raise HTTPException(status_code=404, detail="Run not found")
    
    async def log_callback(msg: str):
        await broadcast_log(run_id, msg)
    
    try:
        await workflow_manager.create_polymesh(run_id, run_dir, log_callback)
        run_manager.update_run_status(run_id, "mesh_ready")
        
        # Auto-save to mesh library
        try:
            # TODO: Update "caseDir" to match your case directory name
            case_dir = run_dir / "caseDir"
            
            # Look for mesh files in both run_dir and case_dir
            mesh_files = (
                list(run_dir.glob("*.unv")) + 
                list(run_dir.glob("*.msh")) +
                list(case_dir.glob("*.unv")) + 
                list(case_dir.glob("*.msh"))
            )
            
            await log_callback(f"[MESH] Found mesh files: {[str(f) for f in mesh_files]}")
            
            if mesh_files:
                mesh_file = mesh_files[0]
                polymesh_path = case_dir / "constant" / "polyMesh"
                
                await log_callback(f"[MESH] Using mesh file: {mesh_file}")
                await log_callback(f"[MESH] PolyMesh exists: {polymesh_path.exists()}")
                
                # Get run details for naming
                run_details = run_manager.get_run_details(run_id)
                base_name = run_details.get("name", run_id) if run_details else run_id
                mesh_name = f"{base_name}_Mesh"
                
                # Add to library with both mesh file and polyMesh
                saved_mesh_id = mesh_library.add_mesh(
                    name=mesh_name,
                    project="default",
                    mesh_path=mesh_file,
                    run_id=run_id,
                    polymesh_path=polymesh_path if polymesh_path.exists() else None
                )
                await log_callback(f"[MESH] Saved to mesh library: {mesh_name} (ID: {saved_mesh_id})")
            else:
                await log_callback("[MESH] Warning: No mesh file found to save to library")
        except Exception as e:
            import traceback
            await log_callback(f"[MESH] Warning: Could not save to library: {e}")
            await log_callback(f"[MESH] Traceback: {traceback.format_exc()}")
        
        return {"status": "success", "message": "PolyMesh created"}
    except Exception as e:
        run_manager.update_run_status(run_id, "error")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/run/{run_id}/start")
async def start_run(run_id: str, request: RunStartRequest):
    """Start a simulation run."""
    run_dir = run_manager.get_run_directory(run_id)
    if not run_dir:
        raise HTTPException(status_code=404, detail="Run not found")
    
    # Clear old log file if exists
    log_file = LOGS_DIR / f"{run_id}.log"
    if log_file.exists():
        log_file.unlink()
    
    async def log_callback(msg: str):
        await broadcast_log(run_id, msg)
    
    # Save case settings
    run_manager.update_solver_config(run_id, request.case_settings.model_dump())
    
    # Store start time for ETA calculations
    if run_id in run_manager.metadata:
        run_manager.metadata[run_id]["started_at"] = datetime.now().isoformat()
        run_manager.metadata[run_id]["end_time"] = request.case_settings.end_time
        run_manager._save_metadata()
    
    # Start in background
    asyncio.create_task(
        workflow_manager.run_simulation(
            run_id=run_id,
            run_dir=run_dir,
            case_settings=request.case_settings.model_dump(),
            log_callback=log_callback
        )
    )
    
    run_manager.update_run_status(run_id, "running")
    return {"status": "started", "success": True}

@app.post("/api/run/{run_id}/stop")
async def stop_run(run_id: str):
    """Stop a running simulation."""
    try:
        workflow_manager.stop_workflow(run_id)
        run_manager.update_run_status(run_id, "stopped")
        return {"status": "stopped", "success": True}
    except Exception as e:
        return {"status": "error", "success": False, "error": str(e)}

@app.delete("/api/run/{run_id}")
async def delete_run(run_id: str):
    """Delete a run permanently."""
    run_manager.delete_run(run_id)
    return {"status": "deleted"}

@app.get("/api/run/{run_id}/paraview")
async def get_run_paraview(run_id: str):
    """Get ParaView output paths for a run."""
    outputs = run_manager.get_paraview_outputs(run_id)
    return outputs


# ============================================================================
# Boundary Mapper API
# ============================================================================

@app.get("/api/endpoint-schema")
async def get_endpoint_schema():
    """Return this module's endpoint schema for the boundary mapper UI."""
    module_json = PROJECT_DIR / "module.json"
    if module_json.exists():
        data = json.loads(module_json.read_text())
        return data.get("endpointSchema", {"endpoints": [], "repeatingGroups": []})
    return {"endpoints": [], "repeatingGroups": []}


@app.get("/api/run/{run_id}/introspect")
async def introspect_run_mesh(run_id: str):
    """Discover all patches, cellZones, faceZones, pointZones from a run's polyMesh."""
    run_dir = run_manager.get_run_directory(run_id)
    if not run_dir:
        raise HTTPException(status_code=404, detail="Run not found")
    
    # TODO: Update "caseDir" to match your case directory name
    case_dir = run_dir / "caseDir"
    if not (case_dir / "constant" / "polyMesh" / "boundary").exists():
        return {"patches": [], "cellZones": [], "faceZones": [], "pointZones": [],
                "metadata": {"error": "No polyMesh found. Create mesh first."}}
    
    result = introspect_mesh(case_dir)
    return result


@app.get("/api/run/{run_id}/mapping")
async def get_run_mapping(run_id: str):
    """Get the current boundary mapping for a run."""
    run_dir = run_manager.get_run_directory(run_id)
    if not run_dir:
        raise HTTPException(status_code=404, detail="Run not found")
    
    mapping_path = run_dir / "boundary_mapping.json"
    mapping = load_mapping(mapping_path)
    
    if mapping is None:
        return {"exists": False, "mapping": None}
    
    return {"exists": True, "mapping": mapping}


@app.post("/api/run/{run_id}/mapping")
async def save_run_mapping(run_id: str, mapping: dict):
    """Save or update the boundary mapping for a run."""
    run_dir = run_manager.get_run_directory(run_id)
    if not run_dir:
        raise HTTPException(status_code=404, detail="Run not found")
    
    mapping_path = run_dir / "boundary_mapping.json"
    success = save_mapping(mapping, mapping_path)
    
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save mapping")
    
    return {"status": "saved", "path": str(mapping_path)}


@app.post("/api/run/{run_id}/mapping/validate")
async def validate_run_mapping(run_id: str, mapping: dict):
    """Validate a mapping against this module's endpoint schema."""
    module_json = PROJECT_DIR / "module.json"
    if not module_json.exists():
        return {"valid": False, "errors": ["Module schema not found"]}
    
    data = json.loads(module_json.read_text())
    schema = data.get("endpointSchema", {})
    
    is_valid, errors = validate_mapping(schema, mapping)
    return {"valid": is_valid, "errors": errors}


# ============================================================================
# WebSocket Log Streaming
# ============================================================================

@app.websocket("/ws/logs/{run_id}")
async def websocket_logs(websocket: WebSocket, run_id: str):
    """WebSocket endpoint for live log streaming."""
    await websocket.accept()
    
    if run_id not in active_websockets:
        active_websockets[run_id] = []
    active_websockets[run_id].append(websocket)
    
    # Send recent log history from file (last 50 lines)
    try:
        log_file = LOGS_DIR / f"{run_id}.log"
        print(f"[WS] Checking for logs at: {log_file}")
        if log_file.exists():
            with open(log_file, "r") as f:
                lines = f.readlines()
            # Send last 50 lines to new connection
            recent_lines = lines[-50:] if len(lines) > 50 else lines
            for line in recent_lines:
                await websocket.send_text(json.dumps({"type": "log", "line": line.strip()}))
            # Send a marker to indicate replay complete
            await websocket.send_text(json.dumps({"type": "log", "line": "[Connected - showing recent log history above]"}))
        else:
            print(f"[WS] Log file not found: {log_file}")
            await websocket.send_text(json.dumps({"type": "log", "line": f"[Warning] Log file not found at {log_file}"}))
    except Exception as e:
        print(f"[WS] Error replaying logs: {e}")
    
    try:
        while True:
            # Keep connection alive, receive any client messages
            data = await websocket.receive_text()
            # Echo back for ping/pong
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        active_websockets[run_id].remove(websocket)
        if not active_websockets[run_id]:
            del active_websockets[run_id]


async def broadcast_log(run_id: str, message: Any):
    """Broadcast a log message to all connected WebSocket clients and write to file."""
    # Ensure message is JSON
    if isinstance(message, str):
        message = {"type": "log", "line": message}
    
    # Write to log file for status API access
    log_file = LOGS_DIR / f"{run_id}.log"
    try:
        with open(log_file, "a") as f:
            if "line" in message:
                f.write(message["line"] + "\n")
            elif "type" in message and message["type"] == "progress":
                f.write(f"Time = {message.get('current_time', 0)}\n")
    except Exception:
        pass  # Silently ignore log file write errors
    
    if run_id not in active_websockets:
        return
    
    message_str = json.dumps(message)
    
    disconnected = []
    for ws in active_websockets[run_id]:
        try:
            await ws.send_text(message_str)
        except Exception:
            disconnected.append(ws)
    
    # Clean up disconnected
    for ws in disconnected:
        try:
            active_websockets[run_id].remove(ws)
        except:
            pass


# ============================================================================
# Main Entry Point
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=6061)
