#!/usr/bin/env python3
"""
OpenFOAM Web Propeller GUI - Backend Server

FastAPI server providing REST API and WebSocket log streaming
for OpenFOAM propeller/rotor-stator AMI simulations.
"""

import os
import sys
import json
import asyncio
import shutil
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

# Add shared modules to path
SCRIPT_DIR = Path(__file__).parent.resolve()
sys.path.append(str(SCRIPT_DIR.parent.parent))  # OpenFOAM_GUI root to access shared

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel
import zipfile
import io

# Get paths
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPT_DIR.parent
TEMPLATES_DIR = PROJECT_ROOT / "templates"
RUNS_DIR = PROJECT_ROOT / "runs"
MESHES_DIR = PROJECT_ROOT / "meshes"
METADATA_DIR = PROJECT_ROOT / "metadata"
LOGS_DIR = PROJECT_ROOT / "logs"
DEFAULTS_FILE = PROJECT_ROOT / "user_defaults.json"
FRONTEND_DIR = PROJECT_ROOT / "frontend"

# OpenFOAM environment
OPENFOAM_BASHRC = "/usr/lib/openfoam/openfoam2506/etc/bashrc"

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


def init_managers():
    """Initialize managers. Called at module load time to support sub-app mounting."""
    global workflow_manager, job_manager, run_manager, mesh_library
    
    # Skip if already initialized
    if mesh_library is not None:
        return
    
    # Ensure directories exist
    for d in [RUNS_DIR, MESHES_DIR, METADATA_DIR, LOGS_DIR]:
        d.mkdir(exist_ok=True)
    
    # Initialize managers
    job_manager = JobManager(METADATA_DIR)
    run_manager = RunManager(RUNS_DIR, TEMPLATES_DIR, METADATA_DIR)
    mesh_library = MeshLibrary(MESHES_DIR / "library")
    workflow_manager = WorkflowManager(OPENFOAM_BASHRC, job_manager, run_manager)
    
    print(f"[INFO] OpenFOAM Web Propeller GUI initialized")
    print(f"[INFO] Project root: {PROJECT_ROOT}")
    print(f"[INFO] Mesh Library: {MESHES_DIR / 'library'}")


# Initialize managers at module load time (for sub-app mounting)
init_managers()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize managers on startup (for standalone mode)."""
    # Re-init in case we're running standalone
    init_managers()
    
    print(f"[INFO] OpenFOAM Web Propeller GUI started")
    print(f"[INFO] Templates: {TEMPLATES_DIR}")
    print(f"[INFO] Runs: {RUNS_DIR}")
    
    yield
    
    # Cleanup on shutdown
    print("[INFO] Shutting down...")


app = FastAPI(
    title="OpenFOAM Web Propeller GUI",
    description="Web interface for OpenFOAM propeller AMI simulations",
    version="1.0.0",
    lifespan=lifespan
)

# Mount static files
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
# Mount shared files (for unit_formatter.js, etc.)
SHARED_DIR = PROJECT_ROOT / "shared"
if SHARED_DIR.exists():
    app.mount("/shared", StaticFiles(directory=str(SHARED_DIR)), name="shared")


# ============================================================================
# Pydantic Models
# ============================================================================

class RunCreateRequest(BaseModel):
    rotor_filename: str
    stator_filename: str
    run_name: Optional[str] = None

class SolverSettings(BaseModel):
    solver: str = "pimpleFoam"
    end_time: float = 0.1
    delta_t: float = 1e-5
    write_interval: float = 0.01
    purge_write: int = 0  # 0 = keep all, >0 = keep last N
    rotation_rpm: float = 1500.0
    rotation_axis: List[float] = [0, 0, 1]
    rotation_origin: List[float] = [0, 0, 0]
    parallel: bool = False
    num_cores: int = 4
    # Timestep control
    max_co: float = 0.5
    fixed_timestep: bool = False
    # PIMPLE settings
    n_outer_correctors: int = 4
    relax_p: float = 0.2
    relax_u: float = 0.5
    # RPM ramp-up
    enable_rampup: bool = False
    ramp_duration: float = 0.02
    reverse_direction: bool = False

class MaterialSettings(BaseModel):
    preset: str = "air"  # air, water, custom
    temperature: float = 293.15  # K
    density: float = 1.225  # kg/m3
    kinematic_viscosity: float = 1.5e-5  # m2/s
    dynamic_viscosity: float = 1.825e-5  # Pa.s

class AnalysisSettings(BaseModel):
    enabled: bool = True
    geometry_patches: List[str] = ["propellerWalls"]
    thrust_axis: List[float] = [1.0, 0.0, 0.0]
    prop_diameter: float = 0.2
    time_mode: str = "latest"  # latest, window
    average: bool = True
    exclude_fraction: float = 0.2

class RunStartRequest(BaseModel):
    run_id: str
    solver_settings: SolverSettings
    material_settings: MaterialSettings
    analysis_settings: Optional[AnalysisSettings] = None
    inlet_velocity: Optional[List[float]] = None  # [Ux, Uy, Uz] if wind enabled


# ============================================================================
# Root / Frontend
# ============================================================================

@app.get("/")
async def serve_frontend():
    """Serve the main frontend page."""
    return FileResponse(FRONTEND_DIR / "index.html")

@app.get("/favicon.ico")
async def favicon():
    """Return empty favicon to prevent 404 errors."""
    from fastapi.responses import Response
    # Return empty 1x1 transparent PNG
    return Response(content=b'', media_type="image/x-icon", status_code=200)


# ============================================================================
# User Defaults API
# ============================================================================

@app.get("/api/defaults")
async def get_defaults():
    """Get saved user defaults."""
    import json
    if DEFAULTS_FILE.exists():
        with open(DEFAULTS_FILE, 'r') as f:
            return json.load(f)
    return {}

@app.post("/api/defaults")
async def save_defaults(defaults: dict):
    """Save user defaults to server."""
    import json
    with open(DEFAULTS_FILE, 'w') as f:
        json.dump(defaults, f, indent=2)
    return {"success": True, "message": "Defaults saved"}


# ============================================================================
# Mesh Library API
# ============================================================================

@app.get("/api/mesh/library")
async def list_mesh_library(project: str = None):
    """List all meshes in the library."""
    meshes = mesh_library.list_meshes(project)
    projects = mesh_library.get_projects()
    return {"meshes": meshes, "projects": projects}

@app.post("/api/mesh/library")
async def add_to_mesh_library(
    name: str = Form(...),
    project: str = Form("default"),
    rotor_file: UploadFile = File(...),
    stator_file: UploadFile = File(...),
    run_id: str = Form(None)  # Optional: run_id where polyMesh was created
):
    """Add mesh files to the library, including polyMesh if available."""
    try:
        # Save uploaded files temporarily
        temp_dir = MESHES_DIR / "_temp_upload"
        temp_dir.mkdir(exist_ok=True)
        
        rotor_path = temp_dir / "rotor.unv"
        stator_path = temp_dir / "stator.unv"
        
        with open(rotor_path, 'wb') as f:
            content = await rotor_file.read()
            f.write(content)
        
        with open(stator_path, 'wb') as f:
            content = await stator_file.read()
            f.write(content)
        
        # Find polyMesh directory if run_id is provided
        polymesh_source_path = None
        if run_id:
            run_dir = run_manager.get_run_directory(run_id)
            if run_dir:
                polymesh_path = run_dir / "propCase" / "stator" / "constant" / "polyMesh"
                if polymesh_path.exists():
                    polymesh_source_path = polymesh_path
                    print(f"[INFO] Found polyMesh in run {run_id}: {polymesh_path}")
        
        # Add to library with polyMesh
        mesh_id = mesh_library.add_mesh(
            name, 
            rotor_path, 
            stator_path, 
            project,
            polymesh_source_path=polymesh_source_path
        )
        
        # Clean up temp files
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)
        
        has_polymesh = polymesh_source_path is not None
        return {
            "success": True, 
            "mesh_id": mesh_id, 
            "has_polymesh": has_polymesh,
            "message": f"Mesh '{name}' added to library" + (" (with polyMesh)" if has_polymesh else "")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/mesh/library/{mesh_id}")
async def delete_from_mesh_library(mesh_id: str):
    """Delete a mesh from the library."""
    if mesh_library.delete_mesh(mesh_id):
        return {"success": True, "message": "Mesh deleted"}
    raise HTTPException(status_code=404, detail="Mesh not found")

@app.get("/api/mesh/library/{mesh_id}/download")
async def download_mesh_files(mesh_id: str):
    """Download the UNV files for a mesh as a zip."""
    import zipfile
    import io
    
    files = mesh_library.get_mesh_files(mesh_id)
    if not files:
        raise HTTPException(status_code=404, detail="Mesh not found")
    
    mesh_info = mesh_library.get_mesh(mesh_id)
    
    # Create zip in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.write(files["rotor"], f"{mesh_info['name']}_rotor.unv")
        zf.write(files["stator"], f"{mesh_info['name']}_stator.unv")
    
    zip_buffer.seek(0)
    
    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={mesh_info['name']}_meshes.zip"}
    )

@app.post("/api/mesh/library/{mesh_id}/use")
async def use_mesh_from_library(mesh_id: str, request: dict = None):
    """Create a new run using a mesh from the library, copying polyMesh if available."""
    files = mesh_library.get_mesh_files(mesh_id)
    if not files:
        raise HTTPException(status_code=404, detail="Mesh not found")
    
    mesh_info = mesh_library.get_mesh(mesh_id)
    
    # Get run_name from request body if provided
    run_name = ""
    if request and isinstance(request, dict):
        run_name = request.get("run_name", "")
    
    # Use mesh name as base for run name if not provided
    if not run_name:
        run_name = mesh_info["name"]
    
    # Get polyMesh path from library (if mesh was saved with polyMesh)
    polymesh_source = mesh_library.get_polymesh_path(mesh_id)
    
    # Create run with mesh reference, copying polyMesh if available
    run_id, message = run_manager.create_run_from_mesh(
        mesh_id=mesh_id,
        mesh_name=mesh_info["name"],
        rotor_path=files["rotor"],
        stator_path=files["stator"],
        run_name=run_name,
        polymesh_source_path=polymesh_source
    )
    
    if not run_id:
        raise HTTPException(status_code=500, detail=message)
    
    run_dir = run_manager.get_run_directory(run_id)
    
    # If mesh has no polyMesh, fall back to auto-create (for backwards compatibility)
    has_polymesh = polymesh_source is not None and polymesh_source.exists()
    if not has_polymesh:
        try:
            print(f"[INFO] No polyMesh in library for {mesh_id}, auto-creating...")
            result = await workflow_manager.create_polymesh(run_id, run_dir, None)
            if result["success"]:
                has_polymesh = True
        except Exception as e:
            print(f"Warning: PolyMesh auto-creation error for {run_id}: {e}")
    
    return {
        "success": True,
        "run_id": run_id,
        "run_dir": str(run_dir),
        "mesh_id": mesh_id,
        "mesh_name": mesh_info["name"],
        "has_polymesh": has_polymesh,
        "message": f"Run created with mesh '{mesh_info['name']}'" + (" (instant)" if polymesh_source else " (mesh created)")
    }

# Alias for /api/runs (backwards compatibility)
@app.get("/api/runs")
async def list_runs_alias():
    """List all runs - backwards compatible alias."""
    runs = run_manager.list_runs()
    return {"success": True, "runs": runs}

# ============================================================================
# Run Details API
# ============================================================================

@app.get("/api/run/{run_id}/details")
async def get_run_details(run_id: str):
    """Get detailed information about a run including mesh info."""
    details = run_manager.get_run_details(run_id)
    if not details:
        raise HTTPException(status_code=404, detail="Run not found")
    return details

@app.get("/api/run/{run_id}/paraview")
async def get_run_paraview(run_id: str):
    """Get ParaView output paths for a run."""
    outputs = run_manager.get_paraview_outputs(run_id)
    case_path = run_manager.get_case_path(run_id)
    return {
        "run_id": run_id,
        "case_path": case_path,
        "foam_files": outputs
    }

@app.post("/api/run/{run_id}/solver-config")
async def update_run_solver_config(run_id: str, config: dict):
    """Update solver configuration for a specific run."""
    if run_manager.update_solver_config(run_id, config):
        return {"success": True, "message": "Solver config updated"}
    raise HTTPException(status_code=404, detail="Run not found")


# ============================================================================
# Mesh Upload API
# ============================================================================

@app.post("/api/mesh/upload")
async def upload_mesh_files(
    rotor_file: UploadFile = File(...),
    stator_file: UploadFile = File(...),
    run_name: str = Form(None)  # Optional run name from frontend
):
    """Upload rotor and stator UNV files and create a run with specified name."""
    try:
        # Save to a temp upload location first
        upload_dir = RUNS_DIR / "_uploads"
        upload_dir.mkdir(exist_ok=True)
        
        rotor_path = upload_dir / rotor_file.filename
        stator_path = upload_dir / stator_file.filename
        
        # Write files
        with open(rotor_path, "wb") as f:
            rotor_content = await rotor_file.read()
            f.write(rotor_content)
        
        with open(stator_path, "wb") as f:
            stator_content = await stator_file.read()
            f.write(stator_content)
        
        # Create a run with these files
        # Generate a temp mesh_id since this mesh isn't in library yet
        import uuid
        from datetime import datetime
        temp_mesh_id = f"temp_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:4]}"
        
        run_id, error = run_manager.create_run_from_mesh(
            mesh_id=temp_mesh_id,
            mesh_name="New Mesh",
            rotor_path=rotor_path,
            stator_path=stator_path,
            run_name=run_name  # Use user-provided name
        )
        
        if not run_id:
            raise HTTPException(status_code=500, detail=f"Failed to create run: {error}")
        
        # Clean up temp upload files (they've been copied to the run)
        import shutil
        shutil.rmtree(upload_dir, ignore_errors=True)
        
        return {
            "success": True,
            "run_id": run_id,
            "rotor_file": rotor_file.filename,
            "stator_file": stator_file.filename,
            "rotor_size": len(rotor_content),
            "stator_size": len(stator_content)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Run Management API
# ============================================================================

@app.post("/api/run/create")
async def create_run(request: RunCreateRequest):
    """Create a new run from template with uploaded UNV files."""
    try:
        run_id, error = run_manager.create_run(
            request.rotor_filename,
            request.stator_filename,
            request.run_name
        )
        
        if error:
            raise HTTPException(status_code=400, detail=error)
        
        return {"success": True, "run_id": run_id}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/run/list")
async def list_runs():
    """List all runs (active and archived)."""
    try:
        runs = run_manager.list_runs()
        return {"success": True, "runs": runs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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

@app.post("/api/run/{run_id}/create-polymesh")
async def create_polymesh(run_id: str):
    """Create the polyMesh by running ideasUnvToFoam and mergeMeshes."""
    try:
        run_dir = run_manager.get_run_directory(run_id)
        if not run_dir:
            raise HTTPException(status_code=404, detail="Run not found")
        
        # Run mesh creation synchronously (it's fast enough)
        result = await workflow_manager.create_polymesh(run_id, run_dir, broadcast_log)
        
        return {"success": result["success"], "message": result["message"], "patches": result.get("patches", [])}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/run/{run_id}/start")
async def start_run(run_id: str, request: RunStartRequest):
    """Start the simulation workflow for a run."""
    try:
        # Get run directory
        run_dir = run_manager.get_run_directory(run_id)
        if not run_dir:
            raise HTTPException(status_code=404, detail="Run not found")
        
        # Clear old log file if exists
        log_file = LOGS_DIR / f"{run_id}.log"
        if log_file.exists():
            log_file.unlink()
        
        # Store start time and end_time for ETA calculations
        from datetime import datetime
        if run_id in run_manager.runs_metadata:
            run_manager.runs_metadata[run_id]["started_at"] = datetime.now().isoformat()
            run_manager.runs_metadata[run_id]["end_time"] = request.solver_settings.end_time
            run_manager.runs_metadata[run_id]["status"] = "running"
            run_manager._save_metadata()
        
        # Start workflow in background using asyncio.create_task
        asyncio.create_task(
            workflow_manager.run_simulation(
                run_id,
                run_dir,
                request.solver_settings.dict(),
                request.material_settings.dict(),
                request.inlet_velocity,
                request.analysis_settings.dict() if request.analysis_settings else None,
                broadcast_log
            )
        )
        
        return {"success": True, "message": "Simulation started"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/run/{run_id}/stop")
async def stop_run(run_id: str):
    """Stop a running simulation."""
    try:
        success = workflow_manager.stop_workflow(run_id)
        
        # Update status in metadata
        if run_id in run_manager.runs_metadata:
            run_manager.runs_metadata[run_id]["status"] = "stopped"
            run_manager._save_metadata()
        
        if success:
            return {"success": True, "message": "Workflow stopped"}
        else:
            # Even if no running workflow, mark as stopped
            return {"success": True, "message": "Run marked as stopped"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/run/{run_id}/archive")
async def archive_run(run_id: str):
    """Archive a run (calculates size once if not known)."""
    try:
        success, message = run_manager.archive_run(run_id)
        if success:
            return {"success": True, "message": message}
        else:
            raise HTTPException(status_code=400, detail=message)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/run/{run_id}/unarchive")
async def unarchive_run(run_id: str):
    """Restore an archived run to active."""
    try:
        success, message = run_manager.unarchive_run(run_id)
        if success:
            return {"success": True, "message": message}
        else:
            raise HTTPException(status_code=400, detail=message)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/run/{run_id}")
async def delete_run(run_id: str):
    """Delete a run permanently."""
    try:
        success, message = run_manager.delete_run(run_id)
        if success:
            return {"success": True, "message": message}
        else:
            raise HTTPException(status_code=400, detail=message)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Patches API
# ============================================================================

@app.get("/api/run/{run_id}/patches")
async def get_patches(run_id: str):
    """Get discovered patches from a run's boundary file."""
    try:
        run_dir = run_manager.get_run_directory(run_id)
        if not run_dir:
            raise HTTPException(status_code=404, detail="Run not found")
        
        patches = workflow_manager.get_patches(run_dir)
        return {"success": True, "patches": patches}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Mesh Manager API
# ============================================================================

@app.get("/api/meshes")
async def list_meshes():
    """List all saved meshes."""
    try:
        meshes = mesh_manager.list_meshes()
        return {"success": True, "meshes": meshes}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/mesh/save")
async def save_mesh(run_id: str = Form(...), mesh_name: str = Form(...)):
    """Save a run's mesh for later reuse."""
    try:
        run_dir = run_manager.get_run_directory(run_id)
        if not run_dir:
            raise HTTPException(status_code=404, detail="Run not found")
        
        success, message = mesh_manager.save_mesh(run_dir, mesh_name)
        if success:
            return {"success": True, "message": message}
        else:
            raise HTTPException(status_code=400, detail=message)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/mesh/load")
async def load_mesh(run_id: str = Form(...), mesh_name: str = Form(...)):
    """Load a saved mesh into a run."""
    try:
        run_dir = run_manager.get_run_directory(run_id)
        if not run_dir:
            raise HTTPException(status_code=404, detail="Run not found")
        
        success, message = mesh_manager.load_mesh(mesh_name, run_dir)
        if success:
            return {"success": True, "message": message}
        else:
            raise HTTPException(status_code=400, detail=message)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/mesh/{mesh_name}")
async def delete_mesh(mesh_name: str):
    """Delete a saved mesh."""
    try:
        success, message = mesh_manager.delete_mesh(mesh_name)
        if success:
            return {"success": True, "message": message}
        else:
            raise HTTPException(status_code=400, detail=message)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/mesh/download/{mesh_id}")
async def download_mesh(mesh_id: str):
    """Download mesh UNV files as a zip."""
    try:
        mesh_files = mesh_manager.get_mesh_files(mesh_id)
        if not mesh_files:
            raise HTTPException(status_code=404, detail="Mesh not found")
        
        mesh_info = mesh_manager.get_mesh(mesh_id)
        mesh_name = mesh_info.get("name", mesh_id)
        
        # Create zip in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
            for key, path in mesh_files.items():
                if path.exists():
                    zip_file.write(path, arcname=f"{key}.unv")
        
        zip_buffer.seek(0)
        
        filename = f"{mesh_name}_UNV.zip"
        return StreamingResponse(
            zip_buffer,
            media_type="application/x-zip-compressed",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Smoke Test API
# ============================================================================

@app.post("/api/smoke-test")
async def smoke_test():
    """Run a quick smoke test (foamVersion + checkMesh on template)."""
    try:
        test_id = f"smoketest_{datetime.now().strftime('%H%M%S')}"
        
        # Run smoke test using asyncio.create_task
        asyncio.create_task(
            workflow_manager.run_smoke_test(test_id, broadcast_log)
        )
        
        return {"success": True, "test_id": test_id}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Job Status API
# ============================================================================

@app.get("/api/job/{job_id}/status")
async def get_job_status(job_id: str):
    """Get status of a job including current run directory size."""
    try:
        status = job_manager.get_job_status(job_id)
        if not status:
            raise HTTPException(status_code=404, detail="Job not found")
        
        # Calculate current run directory size
        run_id = status.get("run_id", job_id)
        run_dir = run_manager.get_run_directory(run_id)
        size_bytes = 0
        if run_dir and run_dir.exists():
            size_bytes = run_manager._get_dir_size(run_dir)
        
        return {
            "success": True, 
            "status": status,
            "size_bytes": size_bytes
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Paraview Helper API
# ============================================================================

@app.post("/api/paraview/calculate")
async def calculate_paraview_settings(
    target_fps: float = Form(30),
    playback_speed: float = Form(1.0),
    simulation_end_time: float = Form(0.1),
    write_interval: float = Form(0.01)
):
    """Calculate Paraview temporal interpolation settings."""
    try:
        # Calculate number of timesteps
        num_timesteps = int(simulation_end_time / write_interval)
        
        # Target video duration = simulation_time / playback_speed
        video_duration = simulation_end_time / playback_speed
        
        # Total frames needed
        total_frames = int(video_duration * target_fps)
        
        # Resample factor
        if num_timesteps > 0:
            resample_factor = total_frames / num_timesteps
        else:
            resample_factor = 1.0
        
        return {
            "success": True,
            "calculation": {
                "num_timesteps": num_timesteps,
                "video_duration_sec": round(video_duration, 2),
                "total_frames": total_frames,
                "resample_factor": round(resample_factor, 2),
                "recommendation": f"Use TemporalInterpolator with {total_frames} frames" if resample_factor > 1 else "No interpolation needed"
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# WebSocket for Log Streaming
# ============================================================================

@app.get("/api/run/{run_id}/performance")
async def get_run_performance(run_id: str):
    """Get performance analysis results for a run."""
    run_dir = run_manager.get_run_directory(run_id)
    if not run_dir:
        raise HTTPException(status_code=404, detail="Run not found")
    
    # Check both possible filenames (for compatibility)
    summary_file = run_dir / "postProcessingSummary.json"
    if not summary_file.exists():
        summary_file = run_dir / "performance_summary.json"
    
    if summary_file.exists():
        return json.loads(summary_file.read_text())
    
    return {"status": "no_data", "message": "No performance data available"}

@app.post("/api/run/{run_id}/analyze")
async def trigger_analysis(run_id: str, settings: AnalysisSettings = None):
    """Manually trigger performance analysis."""
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
        
    # Add material info (run_manager saves as material_config)
    if "material_config" in details:
        config['rho'] = details["material_config"].get("density", 1.225)
    elif "material_settings" in details:  # Fallback for compatibility
        config['rho'] = details["material_settings"].get("density", 1.225)
    
    # Add solver settings (run_manager saves as solver_config)
    solver = details.get("solver_config") or details.get("solver_settings") or {}
    if solver:
        # RPM can be stored as rotation_rpm or rpm
        config['rpm'] = solver.get("rotation_rpm", 0) or solver.get("rpm", 0)
        # Inlet velocity for advance ratio calculation
        inlet_vel = solver.get("inlet_velocity", [0, 0, 0])
        if isinstance(inlet_vel, list) and len(inlet_vel) == 3:
            config['v_inf'] = (inlet_vel[0]**2 + inlet_vel[1]**2 + inlet_vel[2]**2) ** 0.5
        elif isinstance(inlet_vel, (int, float)):
            config['v_inf'] = inlet_vel
    
    # Add analysis settings (prop diameter)
    if "analysis_settings" in details:
        analysis = details["analysis_settings"]
        config['diameter'] = analysis.get("prop_diameter", 0) or analysis.get("diameter", 0)

    try:
        # Note: Propeller case structure expected by analyzer
        summary = workflow_manager.analyzer.analyze_propeller(run_dir / "propCase" / "stator", config)
        workflow_manager.analyzer.save_summary(summary, run_dir)
        return summary
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.websocket("/ws/logs/{run_id}")
async def websocket_logs(websocket: WebSocket, run_id: str):
    """WebSocket endpoint for streaming logs."""
    await websocket.accept()
    
    # Register this connection
    if run_id not in active_websockets:
        active_websockets[run_id] = []
    active_websockets[run_id].append(websocket)
    
    # Send recent log history from file (last 50 lines)
    try:
        log_file = LOGS_DIR / f"{run_id}.log"
        if log_file.exists():
            with open(log_file, "r") as f:
                lines = f.readlines()
            # Send last 50 lines to new connection
            recent_lines = lines[-50:] if len(lines) > 50 else lines
            for line in recent_lines:
                await websocket.send_text(json.dumps({"type": "log", "line": line.strip()}))
            # Send a marker to indicate replay complete
            await websocket.send_text(json.dumps({"type": "log", "line": "[Connected - showing recent log history above]"}))
    except Exception as e:
        print(f"[WS] Error replaying logs: {e}")
    
    try:
        while True:
            # Keep connection alive, wait for client messages
            data = await websocket.receive_text()
            # Handle any client commands if needed
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        # Remove from active connections
        if run_id in active_websockets:
            active_websockets[run_id].remove(websocket)
            if not active_websockets[run_id]:
                del active_websockets[run_id]


async def broadcast_log(run_id: str, log_entry: dict):
    """Broadcast a log entry to all connected WebSocket clients and write to file."""
    # Write to log file for landing page status API access
    log_file = LOGS_DIR / f"{run_id}.log"
    try:
        with open(log_file, "a") as f:
            if "line" in log_entry:
                f.write(log_entry["line"] + "\n")
            elif "type" in log_entry and log_entry["type"] == "progress":
                f.write(f"Time = {log_entry.get('current_time', 0)}\n")
    except Exception:
        pass
    
    # Broadcast to WebSocket clients
    if run_id in active_websockets:
        message = json.dumps(log_entry)
        disconnected = []
        for ws in active_websockets[run_id]:
            try:
                await ws.send_text(message)
            except:
                disconnected.append(ws)
        
        # Clean up disconnected clients
        for ws in disconnected:
            active_websockets[run_id].remove(ws)


# ============================================================================
# Main Entry Point
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    
    print("=" * 60)
    print("OpenFOAM Web Propeller GUI")
    print("=" * 60)
    print(f"Server starting on http://localhost:6060")
    print(f"Access from Windows: http://localhost:6060")
    print("=" * 60)
    
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=6060,
        reload=False,
        log_level="info"
    )
