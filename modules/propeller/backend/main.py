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
    rotor_files: List[UploadFile] = File(...),
    stator_file: UploadFile = File(...),
    run_id: str = Form(None)  # Optional: run_id where polyMesh was created
):
    """Add mesh files to the library, including polyMesh if available."""
    try:
        # Save uploaded files temporarily
        temp_dir = MESHES_DIR / "_temp_upload"
        temp_dir.mkdir(exist_ok=True)
        
        # Save rotor files
        rotor_paths = []
        for i, rf in enumerate(rotor_files, start=1):
            rpath = temp_dir / f"rotor_{i}.unv"
            with open(rpath, 'wb') as f:
                content = await rf.read()
                f.write(content)
            rotor_paths.append(rpath)
        
        stator_path = temp_dir / "stator.unv"
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
            rotor_paths, 
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
            "rotor_count": len(rotor_paths),
            "has_polymesh": has_polymesh,
            "message": f"Mesh '{name}' added to library ({len(rotor_paths)} rotor(s))" + (" (with polyMesh)" if has_polymesh else "")
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
        # Add all rotor files
        for i, rpath in enumerate(files["rotors"], start=1):
            if rpath.exists():
                suffix = f"_rotor_{i}" if len(files["rotors"]) > 1 else "_rotor"
                zf.write(rpath, f"{mesh_info['name']}{suffix}.unv")
        zf.write(files["stator"], f"{mesh_info['name']}_stator.unv")
    
    zip_buffer.seek(0)
    
    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={mesh_info['name']}_meshes.zip"}
    )

# ---- Default Boundary Mapping for Mesh Library ----

@app.get("/api/mesh/library/{mesh_id}/default-mapping")
async def get_default_mapping(mesh_id: str):
    """Retrieve saved default boundary mapping for a library mesh."""
    if not mesh_library.mesh_exists(mesh_id):
        raise HTTPException(status_code=404, detail="Mesh not found")
    mapping = mesh_library.get_boundary_mapping(mesh_id)
    if not mapping:
        return {"exists": False, "mapping": None}
    return {"exists": True, "mapping": mapping}


@app.post("/api/mesh/library/{mesh_id}/default-mapping")
async def save_default_mapping(mesh_id: str, mapping: dict):
    """Save a boundary mapping as the default for a library mesh."""
    if not mesh_library.mesh_exists(mesh_id):
        raise HTTPException(status_code=404, detail="Mesh not found")
    success = mesh_library.update_boundary_mapping(mesh_id, mapping)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save default mapping")
    return {"success": True, "message": "Default mapping saved"}


@app.delete("/api/mesh/library/{mesh_id}/default-mapping")
async def delete_default_mapping(mesh_id: str):
    """Clear the default boundary mapping for a library mesh."""
    if not mesh_library.mesh_exists(mesh_id):
        raise HTTPException(status_code=404, detail="Mesh not found")
    mesh_library.update_boundary_mapping(mesh_id, {})
    return {"success": True, "message": "Default mapping cleared"}


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
        rotor_paths=files["rotors"],
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
    
    # Auto-copy default boundary mapping if one is saved for this mesh
    has_default_mapping = False
    default_mapping = mesh_library.get_boundary_mapping(mesh_id)
    if default_mapping:
        mapping_path = run_dir / "boundary_mapping.json"
        if save_mapping(default_mapping, mapping_path):
            has_default_mapping = True
            print(f"[INFO] Applied default boundary mapping from mesh {mesh_id} to run {run_id}")
    
    return {
        "success": True,
        "run_id": run_id,
        "run_dir": str(run_dir),
        "mesh_id": mesh_id,
        "mesh_name": mesh_info["name"],
        "has_polymesh": has_polymesh,
        "has_default_mapping": has_default_mapping,
        "message": f"Run created with mesh '{mesh_info['name']}'" + (" (instant)" if polymesh_source else " (mesh created)")
    }


@app.patch("/api/run/{run_id}/mesh-link")
async def update_run_mesh_link(run_id: str, body: dict):
    """Update the mesh_id and mesh_name on a run's metadata.
    
    Used after creating a run with a temp mesh ID and then saving the mesh
    to the library — ensures the run references the real library mesh.
    """
    mesh_id = body.get("mesh_id")
    mesh_name = body.get("mesh_name")
    if not mesh_id:
        raise HTTPException(status_code=400, detail="mesh_id is required")
    
    updates = {"mesh_id": mesh_id}
    if mesh_name:
        updates["mesh_name"] = mesh_name
    
    success = run_manager.update_run_metadata(run_id, updates)
    if not success:
        raise HTTPException(status_code=404, detail="Run not found")
    
    return {"success": True, "message": f"Run {run_id} linked to mesh {mesh_id}"}

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


@app.get("/api/run/{run_id}/timesteps")
async def get_run_timesteps(run_id: str):
    """Get timestep information for ParaView Helper calculations.
    
    Scans the case directory for time directories to support both
    fixed and adaptive timestep runs.
    """
    run_dir = run_manager.get_run_directory(run_id)
    if not run_dir:
        raise HTTPException(status_code=404, detail="Run not found")
    
    # Propeller uses propCase/stator as the case directory
    case_dir = run_dir / "propCase" / "stator"
    if not case_dir.exists():
        return {"error": "Case directory not found", "timesteps": []}
    
    # Scan for time directories (numeric folder names)
    timesteps = []
    for item in case_dir.iterdir():
        if item.is_dir():
            try:
                # Try to parse as float (time value)
                time_val = float(item.name)
                timesteps.append(time_val)
            except ValueError:
                # Not a time directory (e.g., constant, system, etc.)
                continue
    
    # Sort timesteps
    timesteps.sort()
    
    if not timesteps:
        return {
            "timesteps": [],
            "count": 0,
            "min_time": 0,
            "max_time": 0,
            "avg_interval": 0,
            "is_adaptive": False
        }
    
    # Calculate intervals to detect if adaptive
    intervals = []
    for i in range(1, len(timesteps)):
        intervals.append(timesteps[i] - timesteps[i-1])
    
    avg_interval = sum(intervals) / len(intervals) if intervals else 0
    
    # Check if adaptive (variance in intervals > 10%)
    is_adaptive = False
    if intervals:
        min_interval = min(intervals)
        max_interval = max(intervals)
        if min_interval > 0 and (max_interval / min_interval) > 1.1:
            is_adaptive = True
    
    # Get run details for settings info
    details = run_manager.get_run_details(run_id)
    solver_settings = details.get("solver_settings", {}) if details else {}
    
    # Get ParaView path
    pv_outputs = run_manager.get_paraview_outputs(run_id)
    foam_file = pv_outputs[0] if pv_outputs else ""
    
    return {
        "timesteps": timesteps,
        "count": len(timesteps),
        "min_time": min(timesteps),
        "max_time": max(timesteps),
        "avg_interval": avg_interval,
        "is_adaptive": is_adaptive,
        "foam_file": foam_file,
        "run_name": details.get("name", run_id) if details else run_id,
        "solver_settings": {
            "end_time": solver_settings.get("end_time", 0),
            "write_interval": solver_settings.get("write_interval", 0),
            "delta_t": solver_settings.get("delta_t", 0)
        }
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
    rotor_files: List[UploadFile] = File(...),
    stator_file: UploadFile = File(...),
    run_name: str = Form(None)  # Optional run name from frontend
):
    """Upload rotor(s) and stator UNV files and create a run with specified name."""
    try:
        # Save to a temp upload location first
        upload_dir = RUNS_DIR / "_uploads"
        upload_dir.mkdir(exist_ok=True)
        
        # Save rotor files
        rotor_paths = []
        rotor_contents = []
        for i, rf in enumerate(rotor_files, start=1):
            rpath = upload_dir / f"rotor_{i}_{rf.filename}"
            rcontent = await rf.read()
            with open(rpath, "wb") as f:
                f.write(rcontent)
            rotor_paths.append(rpath)
            rotor_contents.append((rf.filename, rcontent))
        
        stator_path = upload_dir / stator_file.filename
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
            rotor_paths=rotor_paths,
            stator_path=stator_path,
            run_name=run_name  # Use user-provided name
        )
        
        if not run_id:
            raise HTTPException(status_code=500, detail=f"Failed to create run: {error}")
        
        # Clean up temp upload files (they've been copied to the run)
        import shutil
        shutil.rmtree(upload_dir, ignore_errors=True)
        
        # Check UNV units for all files
        unit_warnings = []
        try:
            from shared.unv_units import parse_unv_units
            run_dir = run_manager.get_run_directory(run_id)
            if run_dir:
                # Check all rotor files
                for i, (rfname, _) in enumerate(rotor_contents, start=1):
                    check_path = run_dir / "inputs" / f"rotor_{i}.unv"
                    if check_path.exists() and rfname.lower().endswith('.unv'):
                        unit_info = parse_unv_units(str(check_path))
                        if unit_info.get("found") and not unit_info.get("is_meter"):
                            unit_warnings.append({
                                "file": f"Rotor {i}" if len(rotor_contents) > 1 else "Rotor",
                                "filename": rfname,
                                "unit_name": unit_info.get("unit_name", "Unknown"),
                                "length_label": unit_info.get("length_label", "?"),
                                "length_scale": unit_info.get("length_scale"),
                            })
                # Check stator file
                stator_check = run_dir / "inputs" / "stator.unv"
                if stator_check.exists() and stator_file.filename.lower().endswith('.unv'):
                    unit_info = parse_unv_units(str(stator_check))
                    if unit_info.get("found") and not unit_info.get("is_meter"):
                        unit_warnings.append({
                            "file": "Stator",
                            "filename": stator_file.filename,
                            "unit_name": unit_info.get("unit_name", "Unknown"),
                            "length_label": unit_info.get("length_label", "?"),
                            "length_scale": unit_info.get("length_scale"),
                        })
        except Exception as e:
            print(f"[WARN] Could not parse UNV units: {e}")
        
        response = {
            "success": True,
            "run_id": run_id,
            "rotor_count": len(rotor_contents),
            "rotor_files": [rfname for rfname, _ in rotor_contents],
            "stator_file": stator_file.filename,
            "rotor_file": rotor_contents[0][0] if rotor_contents else None,  # backwards compat
        }
        
        if unit_warnings:
            files_str = ", ".join([f"{w['file']} ({w['length_label']})" for w in unit_warnings])
            response["unit_warning"] = {
                "files": unit_warnings,
                "message": f"Non-meter units detected in: {files_str}. OpenFOAM assumes all coordinates are in meters. Results may be incorrect unless the mesh is scaled."
            }
        
        return response
        
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
# Boundary Mapper API
# ============================================================================

@app.get("/api/endpoint-schema")
async def get_endpoint_schema():
    """Return this module's endpoint schema for the boundary mapper UI."""
    module_json = PROJECT_ROOT / "module.json"
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
    
    # Prefer pre-merge Salome introspection (shows only user-defined groups)
    salome_path = run_dir / "propCase" / "salome_introspection.json"
    if salome_path.exists():
        try:
            data = json.loads(salome_path.read_text())
            return data
        except Exception:
            pass  # Fall through to live introspection
    
    # Fallback: introspect the merged stator polyMesh
    case_dir = run_dir / "propCase" / "stator"
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
    module_json = PROJECT_ROOT / "module.json"
    if not module_json.exists():
        return {"valid": False, "errors": ["Module schema not found"]}
    
    data = json.loads(module_json.read_text())
    schema = data.get("endpointSchema", {})
    
    is_valid, errors = validate_mapping(schema, mapping)
    return {"valid": is_valid, "errors": errors}


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
async def get_run_performance(
    run_id: str,
    mode: str = "saved",
    exclude_fraction: float = 0.2,
    time_start: float = None,
    time_end: float = None
):
    """Get performance analysis results for a run.
    
    Modes:
    - saved: Return saved analysis file
    - average: Recalculate using time average (exclude initial fraction)
    - latest: Use only the latest timestep
    - window: Use a specific time window
    """
    run_dir = run_manager.get_run_directory(run_id)
    if not run_dir:
        raise HTTPException(status_code=404, detail="Run not found")
    
    # For 'saved' mode, just return the saved file
    if mode == "saved":
        # Check both possible filenames (for compatibility)
        summary_file = run_dir / "postProcessingSummary.json"
        if not summary_file.exists():
            summary_file = run_dir / "performance_summary.json"
        
        if summary_file.exists():
            return json.loads(summary_file.read_text())
        
        return {"status": "no_data", "message": "No performance data available"}
    
    # For other modes, recalculate with specified time range
    details = run_manager.get_run_details(run_id)
    if not details:
        raise HTTPException(status_code=404, detail="Run details not found")
    
    # Build config from run details
    config = {}
    if "analysis_settings" in details:
        config = details["analysis_settings"].copy()
    
    # Add material info
    if "material_config" in details:
        config['rho'] = details["material_config"].get("density", 1.225)
    elif "material_settings" in details:
        config['rho'] = details["material_settings"].get("density", 1.225)
    
    # Add solver settings
    solver = details.get("solver_config") or details.get("solver_settings") or {}
    if solver:
        config['rpm'] = solver.get("rotation_rpm", 0) or solver.get("rpm", 0)
        inlet_vel = solver.get("inlet_velocity", [0, 0, 0])
        if isinstance(inlet_vel, list) and len(inlet_vel) == 3:
            config['v_inf'] = (inlet_vel[0]**2 + inlet_vel[1]**2 + inlet_vel[2]**2) ** 0.5
        elif isinstance(inlet_vel, (int, float)):
            config['v_inf'] = inlet_vel
    
    if "analysis_settings" in details:
        analysis = details["analysis_settings"]
        config['diameter'] = analysis.get("prop_diameter", 0) or analysis.get("diameter", 0)
    
    # Set time range based on mode
    config['mode'] = mode
    if mode == "average":
        config['exclude_fraction'] = exclude_fraction
    elif mode == "window" and time_start is not None and time_end is not None:
        config['time_start'] = time_start
        config['time_end'] = time_end
    elif mode == "latest":
        config['latest_only'] = True
    
    try:
        # Note: Propeller case structure
        case_dir = run_dir / "propCase" / "stator"
        summary = workflow_manager.analyzer.analyze_propeller(case_dir, config)
        # Don't save to file for non-saved modes (keep original analysis intact)
        return summary
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
