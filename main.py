#!/usr/bin/env python3
"""
OpenFOAM Unified GUI - Main Server

Single FastAPI server that hosts multiple simulation tools:
- Wind Tunnel Simulator at /windtunnel/
- Propeller Simulator at /propeller/
- (Future tools can be added here)

IMPORTANT: Routes are defined BEFORE sub-app mounts to ensure landing page works.
"""

import os
import sys
import shutil
from pathlib import Path
from contextlib import asynccontextmanager
import importlib.util

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles

# Paths
SCRIPT_DIR = Path(__file__).parent.absolute()
LANDING_DIR = SCRIPT_DIR / "landing"


def ensure_directories():
    """Ensure required directories exist for sub-apps."""
    for subapp in ["PropellerGUI", "WindTunnelGUI"]:
        subapp_dir = SCRIPT_DIR / subapp
        if subapp_dir.exists():
            (subapp_dir / "runs").mkdir(exist_ok=True)
            (subapp_dir / "meshes").mkdir(exist_ok=True)
            (subapp_dir / "metadata").mkdir(exist_ok=True)
            (subapp_dir / "logs").mkdir(exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize on startup."""
    ensure_directories()
    print(f"[STARTUP] OpenFOAM Unified GUI")
    print(f"[STARTUP] Project dir: {SCRIPT_DIR}")
    print(f"[STARTUP] Landing page: http://localhost:6060/")
    print(f"[STARTUP] Wind Tunnel: http://localhost:6060/windtunnel/")
    print(f"[STARTUP] Propeller: http://localhost:6060/propeller/")
    yield
    print("[SHUTDOWN] Cleaning up...")


# Main application
app = FastAPI(
    title="OpenFOAM GUI",
    description="Unified GUI for OpenFOAM simulation tools",
    version="1.0.0",
    lifespan=lifespan
)


# ============================================================================
# Landing Page Routes (MUST be defined before mounts)
# ============================================================================

@app.get("/", response_class=HTMLResponse)
async def serve_landing():
    """Serve the main landing page."""
    return FileResponse(LANDING_DIR / "index.html")

@app.get("/favicon.ico")
async def favicon():
    """Return empty favicon to prevent 404 errors."""
    return Response(content=b"", media_type="image/x-icon")

@app.get("/home", response_class=HTMLResponse)
async def home_redirect():
    """Redirect /home to landing page."""
    return FileResponse(LANDING_DIR / "index.html")


# ============================================================================
# Case Management API
# ============================================================================

# Import case manager
import case_manager

@app.get("/api/cases")
async def api_list_cases():
    """Get all registered cases."""
    try:
        cases = case_manager.list_cases()
        return {"success": True, "cases": cases}
    except Exception as e:
        return {"success": False, "error": str(e), "cases": []}

@app.get("/api/cases/{case_id}")
async def api_get_case(case_id: str):
    """Get a single case by ID."""
    try:
        case_data = case_manager.get_case(case_id)
        if case_data:
            return {"success": True, "case": case_data}
        return {"success": False, "error": f"Case '{case_id}' not found"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.delete("/api/cases/{case_id}")
async def api_delete_case(case_id: str):
    """Delete a case."""
    try:
        success, message = case_manager.delete_case(case_id)
        return {"success": success, "message": message}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.patch("/api/cases/{case_id}")
async def api_update_case(case_id: str, data: dict):
    """Update case metadata (name, icon, description, features)."""
    try:
        success, message = case_manager.update_case_metadata(
            case_id=case_id,
            name=data.get("name"),
            icon=data.get("icon"),
            description=data.get("description"),
            features=data.get("features")
        )
        return {"success": success, "message": message}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/api/cases/order")
async def api_save_order(data: dict):
    """Save the display order of cases/modules."""
    try:
        order = data.get("order", [])
        success, message = case_manager.save_module_order(order)
        return {"success": success, "message": message}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/api/cases/{case_id}/export")
async def api_export_case(
    case_id: str, 
    include_runs: bool = False, 
    include_meshes: bool = False
):
    """Export a case as a ZIP archive."""
    from fastapi.responses import FileResponse as FR
    try:
        print(f"[EXPORT] Starting export for {case_id}, include_runs={include_runs}, include_meshes={include_meshes}")
        success, message, zip_path = case_manager.export_case(
            case_id, 
            include_runs=include_runs, 
            include_meshes=include_meshes
        )
        print(f"[EXPORT] Result: success={success}, message={message}, path={zip_path}")
        if success and zip_path:
            # Check if file exists and has size
            import os
            if os.path.exists(zip_path):
                file_size = os.path.getsize(zip_path)
                print(f"[EXPORT] File size: {file_size / 1024 / 1024:.1f} MB")
            return FR(
                path=str(zip_path),
                filename=f"{case_id}_export.zip",
                media_type="application/zip"
            )
        print(f"[EXPORT] Export failed: {message}")
        return {"success": False, "error": message}
    except Exception as e:
        print(f"[EXPORT] Exception: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

@app.post("/api/cases/import")
async def api_import_case():
    """Import a case from uploaded ZIP archive."""
    from fastapi import UploadFile, File
    # This endpoint needs special handling - see separate implementation
    return {"success": False, "error": "Use multipart form upload endpoint"}

from fastapi import UploadFile, File

@app.post("/api/cases/upload")
async def api_upload_case(file: UploadFile = File(...)):
    """Upload and import a case from a ZIP archive."""
    import tempfile
    try:
        # Save uploaded file to temp location
        with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = Path(tmp.name)
        
        # Inspect the archive first to detect runs/meshes
        inspection = case_manager.inspect_archive(tmp_path)
        
        # If archive has runs or meshes, we need to offer options
        # For simplicity, we'll check for query params or return info for frontend to show modal
        # The frontend will call the complete endpoint with options
        
        # Save temp file path for later completion
        # Store in a temporary location that persists
        import_staging_dir = SCRIPT_DIR / "cases" / ".import_staging"
        import_staging_dir.mkdir(exist_ok=True)
        
        # Generate a unique staging ID
        import uuid
        staging_id = str(uuid.uuid4())[:8]
        staging_path = import_staging_dir / f"{staging_id}.zip"
        
        # Move temp file to staging
        shutil.copy2(tmp_path, staging_path)
        try:
            tmp_path.unlink()
        except:
            pass
        
        # If there are runs or meshes, return info for options modal
        if inspection["has_runs"] or inspection["has_meshes"]:
            return {
                "success": True,
                "needs_options": True,
                "staging_id": staging_id,
                "name": inspection["name"],
                "has_runs": inspection["has_runs"],
                "has_meshes": inspection["has_meshes"],
                "message": "Archive contains runs or meshes. Choose import options."
            }
        
        # No runs/meshes, proceed directly with import
        success, message, case_id = case_manager.import_case(staging_path)
        
        # Clean up staging file
        try:
            staging_path.unlink()
        except:
            pass
        
        # If import succeeded, dynamically mount the new module
        if success and case_id:
            try:
                # Get the case data to find path and route
                case_data = case_manager.get_case(case_id)
                if case_data:
                    module_path = SCRIPT_DIR / case_data.get("path", "")
                    route = case_data.get("route", f"/{case_id}/")
                    
                    # Mount the module as a sub-app
                    module_info = {
                        "id": case_id,
                        "path": str(module_path),
                        "route": route
                    }
                    if module_manager.mount_module(app, module_info):
                        loaded_modules[case_id] = True
                        print(f"[DYNAMIC] Mounted imported module {case_id} at {route}")
                    else:
                        print(f"[WARNING] Failed to mount imported module {case_id}")
            except Exception as mount_error:
                print(f"[WARNING] Could not mount module dynamically: {mount_error}")
                # Import succeeded but mounting failed - will work after restart
        
        return {"success": success, "message": message, "case_id": case_id}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/api/cases/complete-import")
async def api_complete_import(data: dict):
    """Complete an import with options for runs/meshes."""
    try:
        staging_id = data.get("staging_id")
        skip_runs = data.get("skip_runs", False)
        skip_meshes = data.get("skip_meshes", False)
        
        if not staging_id:
            return {"success": False, "error": "Missing staging_id"}
        
        # Find staging file
        import_staging_dir = SCRIPT_DIR / "cases" / ".import_staging"
        staging_path = import_staging_dir / f"{staging_id}.zip"
        
        if not staging_path.exists():
            return {"success": False, "error": "Staging file not found. Please upload again."}
        
        # Import with options
        success, message, case_id = case_manager.import_case(
            staging_path,
            skip_runs=skip_runs,
            skip_meshes=skip_meshes
        )
        
        # Clean up staging file
        try:
            staging_path.unlink()
        except:
            pass
        
        # If import succeeded, dynamically mount the new module
        if success and case_id:
            try:
                case_data = case_manager.get_case(case_id)
                if case_data:
                    module_path = SCRIPT_DIR / case_data.get("path", "")
                    route = case_data.get("route", f"/{case_id}/")
                    
                    module_info = {
                        "id": case_id,
                        "path": str(module_path),
                        "route": route
                    }
                    if module_manager.mount_module(app, module_info):
                        loaded_modules[case_id] = True
                        print(f"[DYNAMIC] Mounted imported module {case_id} at {route}")
            except Exception as mount_error:
                print(f"[WARNING] Could not mount module dynamically: {mount_error}")
        
        return {"success": success, "message": message, "case_id": case_id}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/api/cases/{case_id}/revalidate")
async def api_revalidate_case(case_id: str):
    """Re-validate a case and update its status."""
    try:
        is_valid, message = case_manager.revalidate_case(case_id)
        return {"success": True, "valid": is_valid, "message": message}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# Static File Mounts
# ============================================================================

# Mount landing page static files
app.mount("/static/landing", StaticFiles(directory=str(LANDING_DIR)), name="landing-static")

# Mount shared static files (unit_formatter.js, etc.)
SHARED_DIR = SCRIPT_DIR / "shared"
if SHARED_DIR.exists():
    app.mount("/shared", StaticFiles(directory=str(SHARED_DIR)), name="shared-static")
    print(f"[STARTUP] Mounted shared files at /shared")


# ============================================================================
# Mount Sub-Applications (Dynamic Module Loading)
# ============================================================================

import module_manager

# Initialize the module system
module_manager.initialize()

# Store mounted modules for status checking
loaded_modules = {}

# Discover and mount all modules from modules/
mount_results = module_manager.mount_all_modules(app)
for module_id, success in mount_results.items():
    if success:
        loaded_modules[module_id] = True
        print(f"[STARTUP] Module {module_id} loaded successfully")
    else:
        print(f"[WARNING] Failed to load module {module_id}")


# ============================================================================
# Global Status API (for landing page)
# ============================================================================

@app.get("/api/status")
async def get_global_status():
    """Get status of all running simulations across sub-apps."""
    import json
    
    active_runs = []
    
    # Get all registered cases from the registry
    registry = case_manager.load_registry()
    
    # Helper function to check a module's metadata directory for running simulations
    def check_module_for_running(module_id: str, module_path: Path, module_type: str, module_route: str, module_name: str, module_icon: str):
        metadata_dir = module_path / "metadata"
        if not metadata_dir.exists():
            return
        
        # Check consolidated runs.json file
        runs_json = metadata_dir / "runs.json"
        if runs_json.exists():
            try:
                with open(runs_json) as f:
                    all_runs = json.load(f)
                for run_id, data in all_runs.items():
                    if data.get("status") == "running":
                        active_runs.append({
                            "type": module_type,
                            "module_id": module_id,
                            "module_name": module_name,
                            "module_icon": module_icon,
                            "route": module_route,
                            "run_id": run_id,
                            "run_name": data.get("name", run_id),
                            "status": "running",
                            "start_time": data.get("started_at") or data.get("start_time"),
                            "logs_path": str(module_path / "logs" / f"{run_id}.log")
                        })
            except Exception:
                pass
        
        # Also check individual JSON files (fallback)
        for meta_file in metadata_dir.glob("*.json"):
            if meta_file.name == "runs.json":
                continue  # Skip consolidated file, already handled above
            try:
                with open(meta_file) as f:
                    data = json.load(f)
                if data.get("status") == "running":
                    # Check if already added from runs.json
                    run_id = data.get("run_id", meta_file.stem)
                    if not any(r["run_id"] == run_id and r["module_id"] == module_id for r in active_runs):
                        active_runs.append({
                            "type": module_type,
                            "module_id": module_id,
                            "module_name": module_name,
                            "module_icon": module_icon,
                            "route": module_route,
                            "run_id": run_id,
                            "run_name": data.get("name", data.get("run_id", "Unknown")),
                            "status": "running",
                            "start_time": data.get("start_time"),
                            "logs_path": str(module_path / "logs" / f"{meta_file.stem}.log")
                        })
            except Exception:
                pass
    
    # Check all registered modules
    for case_id, case_data in registry.get("cases", {}).items():
        case_path_str = case_data.get("path", "")
        case_type = case_data.get("type", case_id)
        case_route = case_data.get("route", f"/{case_id}/")
        case_name = case_data.get("name", case_id)
        case_icon = case_data.get("icon", "📦")
        
        # Resolve the module path
        case_path = SCRIPT_DIR / case_path_str
        if case_path.exists():
            check_module_for_running(case_id, case_path, case_type, case_route, case_name, case_icon)
    
    # Get logs and progress for EACH active run
    import re
    from datetime import datetime
    
    for run in active_runs:
        run_logs = []
        run_progress = 0.0
        run_eta = None
        run_current_time = 0.0
        run_end_time = 1.0
        
        logs_path = Path(run.get("logs_path", ""))
        if logs_path.exists():
            try:
                with open(logs_path) as f:
                    lines = f.readlines()
                    run_logs = [l.strip() for l in lines[-5:]]  # Last 5 lines per run
                    
                    # Parse Time = X.XXX from logs to get current simulation time
                    for line in reversed(lines[-100:]):
                        time_match = re.search(r'Time = ([\d.]+)', line)
                        if time_match:
                            run_current_time = float(time_match.group(1))
                            break
            except Exception:
                pass
        
        # Get end_time from run metadata
        run_type = run.get("type")
        run_id = run.get("run_id")
        start_time_str = None
        
        # Derive metadata path from logs_path (which is already set correctly)
        logs_path_obj = Path(run.get("logs_path", ""))
        if logs_path_obj.parent.name == "logs":
            base_path = logs_path_obj.parent.parent / "metadata"
        else:
            base_path = None
        
        if base_path and base_path.exists():
            # First try consolidated runs.json
            runs_json_path = base_path / "runs.json"
            if runs_json_path.exists():
                try:
                    with open(runs_json_path) as f:
                        all_runs_meta = json.load(f)
                    if run_id in all_runs_meta:
                        run_meta = all_runs_meta[run_id]
                        run_end_time = run_meta.get("end_time", 1.0) or 1.0
                        start_time_str = run_meta.get("started_at") or run_meta.get("start_time")
                except Exception:
                    pass
            
            # Fallback to individual JSON file
            if run_end_time == 1.0:
                meta_path = base_path / f"{run_id}.json"
                if meta_path.exists():
                    try:
                        with open(meta_path) as f:
                            meta = json.load(f)
                            run_end_time = meta.get("end_time", meta.get("solver_settings", {}).get("end_time", 1.0)) or 1.0
                            start_time_str = meta.get("start_time")
                    except Exception:
                        pass
        
        # Calculate progress and ETA
        if run_end_time > 0:
            run_progress = min(100, (run_current_time / run_end_time) * 100)
        
        if start_time_str and run_current_time > 0 and run_end_time > 0:
            try:
                start_dt = datetime.fromisoformat(start_time_str)
                elapsed = (datetime.now() - start_dt).total_seconds()
                if run_progress > 0:
                    total_estimated = elapsed * 100 / run_progress
                    run_eta = max(0, total_estimated - elapsed)
            except Exception:
                pass
        
        # Add per-run data to the run object
        run["recent_logs"] = run_logs
        run["progress"] = round(run_progress, 1)
        run["eta_seconds"] = run_eta
        run["current_time"] = run_current_time
        run["end_time"] = run_end_time
    
    return {
        "active": len(active_runs) > 0,
        "runs": active_runs
    }


@app.post("/api/stop/{sim_type}/{run_id}")
async def stop_simulation(sim_type: str, run_id: str):
    """Stop a running simulation by proxying to the sub-app."""
    import httpx
    
    if sim_type == "propeller":
        target_url = f"http://localhost:6060/propeller/api/run/{run_id}/stop"
    elif sim_type == "windtunnel":
        target_url = f"http://localhost:6060/windtunnel/api/run/{run_id}/stop"
    else:
        return {"success": False, "error": "Unknown simulation type"}
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(target_url, timeout=10.0)
            if response.status_code == 200:
                try:
                    return response.json()
                except:
                    return {"success": True, "message": "Stopped (no JSON response)"}
            else:
                return {"success": False, "error": f"HTTP {response.status_code}: {response.text[:100]}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================================
# Main Entry Point
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=6060)
