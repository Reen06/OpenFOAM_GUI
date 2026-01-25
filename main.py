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
# Mount Sub-Applications
# ============================================================================

def load_subapp(name: str, subapp_dir: Path, mount_path: str):
    """Load and mount a sub-application."""
    backend_dir = subapp_dir / "backend"
    if not backend_dir.exists():
        print(f"[WARNING] {name} backend not found at {backend_dir}")
        return False
    
    # Track modules before import to clean up afterwards
    modules_before = set(sys.modules.keys())
    
    # Add backend to path
    backend_path = str(backend_dir)
    sys.path.insert(0, backend_path)
    
    try:
        # Import with unique module name to avoid conflicts
        spec = importlib.util.spec_from_file_location(
            f"{name.lower()}_main", 
            backend_dir / "main.py"
        )
        module = importlib.util.module_from_spec(spec)
        
        # Change working directory for proper initialization
        original_cwd = os.getcwd()
        os.chdir(backend_dir)
        try:
            spec.loader.exec_module(module)
            app.mount(mount_path, module.app)
            print(f"[STARTUP] Mounted {name} at {mount_path}")
            return True
        finally:
            os.chdir(original_cwd)
            # IMPORTANT: Remove this backend from path to prevent module conflicts
            if backend_path in sys.path:
                sys.path.remove(backend_path)
            # Also remove any modules that were imported by this sub-app
            # to prevent them being reused by the next sub-app
            modules_to_remove = ['workflow', 'job_manager', 'run_manager', 'mesh_library']
            for mod in modules_to_remove:
                if mod in sys.modules and mod not in modules_before:
                    del sys.modules[mod]
    except Exception as e:
        print(f"[WARNING] Could not load {name}: {e}")
        import traceback
        traceback.print_exc()
        # Clean up path even on error
        if backend_path in sys.path:
            sys.path.remove(backend_path)
        return False

# Store loaded sub-app modules for status checking
loaded_subapps = {}


# Load sub-applications
propeller_dir = SCRIPT_DIR / "PropellerGUI"
if propeller_dir.exists():
    load_subapp("PropellerGUI", propeller_dir, "/propeller")

windtunnel_dir = SCRIPT_DIR / "WindTunnelGUI"
if windtunnel_dir.exists():
    load_subapp("WindTunnelGUI", windtunnel_dir, "/windtunnel")


# ============================================================================
# Global Status API (for landing page)
# ============================================================================

@app.get("/api/status")
async def get_global_status():
    """Get status of all running simulations across sub-apps."""
    import json
    
    active_runs = []
    
    # Check PropellerGUI - uses runs.json consolidated format
    propeller_metadata = SCRIPT_DIR / "PropellerGUI" / "metadata"
    if propeller_metadata.exists():
        # Check consolidated runs.json file
        runs_json = propeller_metadata / "runs.json"
        if runs_json.exists():
            try:
                with open(runs_json) as f:
                    all_runs = json.load(f)
                for run_id, data in all_runs.items():
                    if data.get("status") == "running":
                        active_runs.append({
                            "type": "propeller",
                            "run_id": run_id,
                            "run_name": data.get("name", run_id),
                            "status": "running",
                            "start_time": data.get("started_at") or data.get("start_time"),
                            "logs_path": str(SCRIPT_DIR / "PropellerGUI" / "logs" / f"{run_id}.log")
                        })
            except Exception:
                pass
        
        # Also check individual JSON files (fallback)
        for meta_file in propeller_metadata.glob("*.json"):
            if meta_file.name == "runs.json":
                continue  # Skip consolidated file, already handled above
            try:
                with open(meta_file) as f:
                    data = json.load(f)
                if data.get("status") == "running":
                    active_runs.append({
                        "type": "propeller",
                        "run_id": data.get("run_id", meta_file.stem),
                        "run_name": data.get("name", data.get("run_id", "Unknown")),
                        "status": "running",
                        "start_time": data.get("start_time"),
                        "logs_path": str(SCRIPT_DIR / "PropellerGUI" / "logs" / f"{meta_file.stem}.log")
                    })
            except Exception:
                pass
    
    # Check WindTunnelGUI - uses runs.json consolidated format
    windtunnel_metadata = SCRIPT_DIR / "WindTunnelGUI" / "metadata"
    if windtunnel_metadata.exists():
        # Check consolidated runs.json file
        runs_json = windtunnel_metadata / "runs.json"
        if runs_json.exists():
            try:
                with open(runs_json) as f:
                    all_runs = json.load(f)
                for run_id, data in all_runs.items():
                    if data.get("status") == "running":
                        active_runs.append({
                            "type": "windtunnel",
                            "run_id": run_id,
                            "run_name": data.get("name", run_id),
                            "status": "running",
                            "start_time": data.get("started_at") or data.get("start_time"),
                            "logs_path": str(SCRIPT_DIR / "WindTunnelGUI" / "logs" / f"{run_id}.log")
                        })
            except Exception:
                pass
        
        # Also check individual JSON files (fallback)
        for meta_file in windtunnel_metadata.glob("*.json"):
            if meta_file.name == "runs.json":
                continue  # Skip consolidated file, already handled above
            try:
                with open(meta_file) as f:
                    data = json.load(f)
                if data.get("status") == "running":
                    active_runs.append({
                        "type": "windtunnel",
                        "run_id": data.get("run_id", meta_file.stem),
                        "run_name": data.get("name", data.get("run_id", "Unknown")),
                        "status": "running",
                        "start_time": data.get("start_time"),
                        "logs_path": str(SCRIPT_DIR / "WindTunnelGUI" / "logs" / f"{meta_file.stem}.log")
                    })
            except Exception:
                pass
    
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
        
        if run_type and run_id:
            if run_type == "propeller":
                base_path = SCRIPT_DIR / "PropellerGUI" / "metadata"
            else:
                base_path = SCRIPT_DIR / "WindTunnelGUI" / "metadata"
            
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
