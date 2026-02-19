"""
Module Manager - Unified module storage and loading for OpenFOAM GUI.

All modules live under MODULES_ROOT (modules/) directory.
No distinction between built-in and custom modules.
"""

import json
import os
import sys
import importlib.util
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("module_manager")

# Paths
SCRIPT_DIR = Path(__file__).parent.absolute()
MODULES_ROOT = SCRIPT_DIR / "modules"
CASES_DIR = SCRIPT_DIR / "cases"
REGISTRY_FILE = CASES_DIR / "registry.json"


def ensure_directories():
    """Ensure required directories exist."""
    MODULES_ROOT.mkdir(exist_ok=True)
    CASES_DIR.mkdir(exist_ok=True)


def load_registry() -> dict:
    """Load the case registry from disk."""
    if not REGISTRY_FILE.exists():
        return {"schema_version": "1.0", "cases": {}}
    try:
        with open(REGISTRY_FILE, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"Failed to load registry: {e}")
        return {"schema_version": "1.0", "cases": {}}


def save_registry(registry: dict):
    """Save the case registry to disk."""
    CASES_DIR.mkdir(exist_ok=True)
    with open(REGISTRY_FILE, 'w') as f:
        json.dump(registry, f, indent=2)


def discover_modules() -> List[dict]:
    """
    Discover all modules in the MODULES_ROOT directory.
    
    Returns a list of module info dicts.
    """
    ensure_directories()
    modules = []
    
    if not MODULES_ROOT.exists():
        return modules
    
    for item in MODULES_ROOT.iterdir():
        if not item.is_dir():
            continue
        
        module_id = item.name
        backend_main = item / "backend" / "main.py"
        
        if not backend_main.exists():
            logger.warning(f"Module {module_id} missing backend/main.py, skipping")
            continue
        
        # Try to load manifest
        manifest_path = item / "module.json"
        manifest = {}
        if manifest_path.exists():
            try:
                with open(manifest_path) as f:
                    manifest = json.load(f)
            except Exception as e:
                logger.warning(f"Failed to load manifest for {module_id}: {e}")
        
        # Derive route from manifest or default
        route = manifest.get("route", f"/{module_id}/")
        
        # Derive route-compatible type from route (e.g., /windtunnel/ -> windtunnel)
        route_type = route.strip('/').split('/')[0] if route else module_id
        
        modules.append({
            "id": module_id,
            "path": str(item),
            "route": route,
            "name": manifest.get("name", module_id),
            "type": route_type,
            "icon": manifest.get("icon", "📦"),
            "description": manifest.get("description", ""),
            "features": manifest.get("features", [])
        })
    
    logger.info(f"Discovered {len(modules)} modules: {[m['id'] for m in modules]}")
    return modules


def load_module_app(module_path: Path) -> Optional[Any]:
    """
    Load a module's FastAPI app from its backend/main.py.
    
    Returns the FastAPI app object, or None if loading failed.
    """
    backend_dir = module_path / "backend"
    main_py = backend_dir / "main.py"
    
    if not main_py.exists():
        logger.error(f"Module main.py not found: {main_py}")
        return None
    
    module_name = f"module_{module_path.name}_main"
    
    # Track modules before import
    modules_before = set(sys.modules.keys())
    
    # Add backend to path
    backend_path = str(backend_dir)
    sys.path.insert(0, backend_path)
    
    try:
        # Import with unique module name
        spec = importlib.util.spec_from_file_location(module_name, main_py)
        module = importlib.util.module_from_spec(spec)
        
        # Change working directory for proper initialization
        original_cwd = os.getcwd()
        os.chdir(backend_dir)
        
        try:
            spec.loader.exec_module(module)
            
            if not hasattr(module, 'app'):
                logger.error(f"Module {module_path.name} has no 'app' attribute")
                return None
            
            return module.app
            
        finally:
            os.chdir(original_cwd)
            # Clean up path
            if backend_path in sys.path:
                sys.path.remove(backend_path)
            # Clean up conflicting modules
            modules_to_remove = ['workflow', 'job_manager', 'run_manager', 'mesh_library']
            for mod in modules_to_remove:
                if mod in sys.modules and mod not in modules_before:
                    del sys.modules[mod]
                    
    except Exception as e:
        logger.error(f"Failed to load module {module_path.name}: {e}")
        import traceback
        traceback.print_exc()
        if backend_path in sys.path:
            sys.path.remove(backend_path)
        return None


def mount_module(app: Any, module_info: dict) -> bool:
    """
    Mount a module as a sub-app on the given FastAPI app.
    
    Args:
        app: The main FastAPI application
        module_info: Dict with 'id', 'path', 'route' keys
        
    Returns:
        True if mounting succeeded
    """
    module_path = Path(module_info["path"])
    route = module_info["route"]
    module_id = module_info["id"]
    
    logger.info(f"Mounting module {module_id} at {route}")
    
    module_app = load_module_app(module_path)
    if module_app is None:
        logger.error(f"Failed to load app for module {module_id}")
        return False
    
    try:
        app.mount(route.rstrip('/'), module_app)
        logger.info(f"Successfully mounted {module_id} at {route}")
        return True
    except Exception as e:
        logger.error(f"Failed to mount {module_id}: {e}")
        return False


def mount_all_modules(app: Any) -> Dict[str, bool]:
    """
    Discover and mount all modules from MODULES_ROOT.
    
    Returns dict of module_id -> mount success.
    """
    modules = discover_modules()
    results = {}
    
    for module_info in modules:
        results[module_info["id"]] = mount_module(app, module_info)
    
    return results


def get_module_path(module_id: str) -> Path:
    """Get the path to a module by ID."""
    return MODULES_ROOT / module_id


def sync_registry():
    """
    Sync the registry with discovered modules.
    Adds any modules found on disk that aren't in the registry.
    """
    registry = load_registry()
    modules = discover_modules()
    updated = False
    
    for mod in modules:
        if mod["id"] not in registry.get("cases", {}):
            registry.setdefault("cases", {})[mod["id"]] = {
                "id": mod["id"],
                "name": mod["name"],
                "category": "module",
                "type": mod["type"],
                "path": f"modules/{mod['id']}",
                "route": mod["route"],
                "icon": mod["icon"],
                "description": mod["description"],
                "features": mod["features"],
                "status": "valid",
                "error": None,
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            }
            updated = True
            logger.info(f"Added module {mod['id']} to registry")
    
    if updated:
        save_registry(registry)


def initialize():
    """
    Initialize the module system.
    
    This should be called on application startup.
    """
    logger.info("Initializing module system...")
    ensure_directories()
    sync_registry()
    logger.info("Module system initialized")
