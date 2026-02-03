#!/usr/bin/env python3
"""
OpenFOAM Web Wind Tunnel GUI - Backend Server

FastAPI server providing REST API and WebSocket log streaming
for OpenFOAM static wind tunnel simulations.
"""

import os
import sys
import json
import asyncio
import shutil
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Any

# Add shared modules to path
SCRIPT_DIR = Path(__file__).parent.absolute()
sys.path.append(str(SCRIPT_DIR.parent.parent))  # OpenFOAM_GUI root to access shared

import json

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

# Global managers
workflow_manager: WorkflowManager = None
job_manager: JobManager = None
run_manager: RunManager = None
mesh_library: MeshLibrary = None

# WebSocket connections for log streaming
active_websockets: Dict[str, List[WebSocket]] = {}

# Paths
SCRIPT_DIR = Path(__file__).parent.absolute()
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
    
    print(f"[INFO] OpenFOAM Web Wind Tunnel GUI initialized")
    print(f"[INFO] Project dir: {PROJECT_DIR}")
    print(f"[INFO] Mesh Library: {MESHES_DIR}")


# Initialize managers at module load time (for sub-app mounting)
init_managers()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize managers on startup (for standalone mode)."""
    # Re-init in case we're running standalone
    init_managers()
    
    print(f"[STARTUP] OpenFOAM Web Wind Tunnel GUI")
    print(f"[STARTUP] Templates: {TEMPLATES_DIR}")
    print(f"[STARTUP] Runs: {RUNS_DIR}")
    
    yield
    
    # Cleanup
    print("[SHUTDOWN] Cleaning up...")


app = FastAPI(
    title="OpenFOAM Web Wind Tunnel GUI",
    description="Web interface for OpenFOAM static wind tunnel simulations",
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

class SolverSettings(BaseModel):
    solver: str = "simpleFoam"
    turbulence_model: str = "kOmegaSST"
    end_time: float = 1000
    delta_t: float = 1
    write_interval: float = 100
    purge_write: int = 0
    inlet_velocity: List[float] = [10, 0, 0]
    outlet_pressure: float = 0
    wall_type: str = "slip"
    wall_slip_fraction: float = 0.5  # 0-1, used when wall_type is partialSlip
    parallel: bool = False
    num_cores: int = 4
    n_outer_correctors: int = 2
    relax_p: float = 0.3
    relax_u: float = 0.7
    adjust_timestep: bool = False
    max_co: float = 0.5
    # Advanced settings
    n_inner_correctors: int = 2
    n_non_ortho_correctors: int = 0
    res_p: float = 1e-4
    res_u: float = 1e-4
    div_scheme_u: str = "linearUpwind"  # linearUpwind or upwind
    div_scheme_turb: str = "upwind"     # upwind or linearUpwind
    ddt_scheme: str = "steadyState"     # steadyState or Euler


class MaterialSettings(BaseModel):
    preset: str = "air"
    temperature: float = 293.15
    density: float = 1.225
    kinematic_viscosity: float = 1.5e-5
    dynamic_viscosity: float = 1.825e-5


class AnalysisSettings(BaseModel):
    enabled: bool = True
    geometry_patches: List[str] = ["model", "wing"]
    drag_axis: List[float] = [1.0, 0.0, 0.0]
    lift_axis: List[float] = [0.0, 0.0, 1.0]
    ref_area: float = 1.0
    ref_length: float = 1.0
    time_mode: str = "latest"  # latest, window
    average: bool = True
    exclude_fraction: float = 0.2


class RunStartRequest(BaseModel):
    run_id: str
    solver_settings: SolverSettings
    material_settings: MaterialSettings
    analysis_settings: Optional[AnalysisSettings] = None


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
        
        # Create run metadata
        run_manager.create_run_entry(
            run_id=run_id,
            run_name=run_name,
            mesh_filename=mesh_file.filename
        )
        
        return {
            "run_id": run_id,
            "mesh_path": str(mesh_path),
            "message": "Mesh uploaded successfully"
        }
    
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
    
    patches = workflow_manager.get_patches(run_dir / "windTunnelCase")
    return {"patches": patches}


@app.post("/api/run/{run_id}/check-mesh")
async def check_mesh(run_id: str):
    """Run checkMesh on the run's polyMesh and return quality report."""
    run_dir = run_manager.get_run_directory(run_id)
    if not run_dir:
        raise HTTPException(status_code=404, detail="Run not found")
    
    case_dir = run_dir / "windTunnelCase"
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
        
        # Check for specific warnings
        if "non-orthogonality" in output.lower():
            match = re.search(r'Mesh non-orthogonality Max:\s*([\d.]+)', output)
            if match:
                value = float(match.group(1))
                stats["max_non_orthogonality"] = value
                if value > 70:
                    issues.append(f"High non-orthogonality: {value}° (should be < 70°)")
                elif value > 50:
                    warnings.append(f"Moderate non-orthogonality: {value}°")
        
        # Check skewness
        if "skewness" in output.lower():
            match = re.search(r'Max skewness\s*=\s*([\d.]+)', output)
            if match:
                value = float(match.group(1))
                stats["max_skewness"] = value
                if value > 4:
                    issues.append(f"High skewness: {value} (should be < 4)")
                elif value > 2:
                    warnings.append(f"Moderate skewness: {value}")
        
        # Check aspect ratio
        if "aspect ratio" in output.lower():
            match = re.search(r'Max aspect ratio\s*=\s*([\d.]+)', output)
            if match:
                value = float(match.group(1))
                stats["max_aspect_ratio"] = value
                if value > 100:
                    issues.append(f"High aspect ratio: {value} (should be < 100)")
        
        # Get cell count
        match = re.search(r'cells:\s*(\d+)', output)
        if match:
            stats["cells"] = int(match.group(1))
        
        # Get face count
        match = re.search(r'faces:\s*(\d+)', output)
        if match:
            stats["faces"] = int(match.group(1))
        
        # Check for mesh OK
        mesh_ok = "Mesh OK" in output and len(issues) == 0
        
        return {
            "success": True,
            "mesh_ok": mesh_ok,
            "issues": issues,
            "warnings": warnings,
            "stats": stats,
            "output": output[-3000:] if len(output) > 3000 else output  # Truncate if too long
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
            case_dir = run_dir / "windTunnelCase"
            
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
    
    # Update configs
    run_manager.update_solver_config(run_id, request.solver_settings.model_dump())
    run_manager.update_material_config(run_id, request.material_settings.model_dump())
    
    # Store start time and end_time for ETA calculations
    from datetime import datetime
    if run_id in run_manager.metadata:
        run_manager.metadata[run_id]["started_at"] = datetime.now().isoformat()
        run_manager.metadata[run_id]["end_time"] = request.solver_settings.end_time
        run_manager._save_metadata()
    
    # Start in background
    asyncio.create_task(
        workflow_manager.run_simulation(
            run_id=run_id,
            run_dir=run_dir,
            solver_settings=request.solver_settings.model_dump(),
            material_settings=request.material_settings.model_dump(),
            analysis_settings=request.analysis_settings.model_dump() if request.analysis_settings else None,
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


@app.get("/api/run/{run_id}/performance")
async def get_run_performance(
    run_id: str,
    mode: str = "saved",  # saved, latest, average, window
    time_start: float = None,
    time_end: float = None,
    exclude_fraction: float = 0.2
):
    """
    Get performance analysis results for a run.
    
    Query params:
    - mode: 'saved' (read cached file), 'latest' (last timestep), 'average' (full avg), 'window' (time range)
    - time_start/time_end: For 'window' mode
    - exclude_fraction: Fraction of initial time to exclude for 'average' mode
    """
    run_dir = run_manager.get_run_directory(run_id)
    if not run_dir:
        raise HTTPException(status_code=404, detail="Run not found")
    
    # For 'saved' mode, just return the cached summary file
    if mode == "saved":
        summary_file = run_dir / "postProcessingSummary.json"
        if summary_file.exists():
            return json.loads(summary_file.read_text())
        # Fall through to calculate if no saved file
        mode = "average"
    
    # Get run details for config
    details = run_manager.get_run_details(run_id)
    config = {
        'drag_axis': [1, 0, 0],
        'lift_axis': [0, 0, 1],
        'exclude_fraction': exclude_fraction,
    }
    
    # Add analysis mode
    if mode == "latest":
        config['average'] = False
    elif mode == "window" and time_start is not None and time_end is not None:
        config['time_start'] = time_start
        config['time_end'] = time_end
        config['use_time_window'] = True
    else:  # average mode
        config['average'] = True
    
    # Add solver/material info for coefficient calculation
    if details and "solver_settings" in details:
        inlet_vel = details["solver_settings"].get("inlet_velocity", [10, 0, 0])
        u_inf = (inlet_vel[0]**2 + inlet_vel[1]**2 + inlet_vel[2]**2) ** 0.5
        config['u_inf'] = u_inf
    else:
        config['u_inf'] = 10.0
        
    if details and "material_settings" in details:
        config['rho'] = details["material_settings"].get("density", 1.225)
    else:
        config['rho'] = 1.225
    
    config['a_ref'] = 1.0  # Default reference area
    
    try:
        summary = workflow_manager.analyzer.analyze_windtunnel(run_dir / "windTunnelCase", config)
        
        # Add time range info to response
        summary['analysis_mode'] = mode
        summary['config'] = {
            'time_start': time_start,
            'time_end': time_end,
            'exclude_fraction': exclude_fraction
        }
        
        return summary
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/run/{run_id}/analyze")
async def trigger_analysis(run_id: str, settings: AnalysisSettings = None):
    """Manually trigger performance analysis and save results."""
    run_dir = run_manager.get_run_directory(run_id)
    if not run_dir:
        raise HTTPException(status_code=404, detail="Run not found")
        
    details = run_manager.get_run_details(run_id)
    if not details or details.get("status") not in ["completed", "success"]:
        raise HTTPException(status_code=400, detail="Run must be completed to analyze")
    
    # Use provided settings or defaults
    config = settings.model_dump() if settings else {}
    if not config and "analysis_settings" in details:
        config = details["analysis_settings"]
    if not config:
        config = AnalysisSettings().model_dump()
        
    # Add solver/material info
    if "solver_settings" in details:
         inlet_vel = details["solver_settings"].get("inlet_velocity", [10, 0, 0])
         u_inf = (inlet_vel[0]**2 + inlet_vel[1]**2 + inlet_vel[2]**2) ** 0.5
         config['u_inf'] = u_inf
         
    if "material_settings" in details:
        config['rho'] = details["material_settings"].get("density", 1.225)

    try:
        summary = workflow_manager.analyzer.analyze_windtunnel(run_dir / "windTunnelCase", config)
        workflow_manager.analyzer.save_summary(summary, run_dir)
        return summary
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))




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


# Note: LOGS_DIR is defined at top of file as PROJECT_DIR / "logs"
# Status API reads from WindTunnelGUI/logs/


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
        # print(f"[WS-DEBUG] No active websockets for run {run_id}")
        return
    
    message_str = json.dumps(message)
    client_count = len(active_websockets[run_id])
    
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
