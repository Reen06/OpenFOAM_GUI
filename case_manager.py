"""
Case Manager - Core functionality for managing OpenFOAM GUI cases.

Provides functions to list, create, delete, export, import, and validate cases.
All cases are tracked in a central registry (cases/registry.json).
"""

import json
import os
import shutil
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import re
import logging

# Paths
SCRIPT_DIR = Path(__file__).parent.absolute()
CASES_DIR = SCRIPT_DIR / "cases"
REGISTRY_FILE = CASES_DIR / "registry.json"

# Import module manager for unified module storage
try:
    import module_manager
    MODULES_ROOT = module_manager.MODULES_ROOT
except ImportError:
    # Fallback if module_manager not available
    MODULES_ROOT = SCRIPT_DIR / "modules"

logger = logging.getLogger("case_manager")

# Constants
SCHEMA_VERSION = "1.0"
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500MB max per file (for large mesh/simulation files)
MAX_ARCHIVE_SIZE = 5 * 1024 * 1024 * 1024  # 5GB max archive


def ensure_registry():
    """Ensure the registry file exists with default structure."""
    CASES_DIR.mkdir(exist_ok=True)
    if not REGISTRY_FILE.exists():
        default_registry = {
            "schema_version": SCHEMA_VERSION,
            "cases": {}
        }
        with open(REGISTRY_FILE, 'w') as f:
            json.dump(default_registry, f, indent=2)


def load_registry() -> dict:
    """Load the case registry from disk."""
    ensure_registry()
    try:
        with open(REGISTRY_FILE, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        print(f"[WARN] Failed to load registry: {e}")
        return {"schema_version": SCHEMA_VERSION, "cases": {}}


def save_registry(registry: dict):
    """Save the case registry to disk."""
    ensure_registry()
    with open(REGISTRY_FILE, 'w') as f:
        json.dump(registry, f, indent=2)


def list_cases() -> List[dict]:
    """Get all cases from the registry, in the saved order."""
    registry = load_registry()
    cases_dict = registry.get("cases", {})
    order = registry.get("order", [])
    
    # Build ordered list
    cases = []
    
    # First add cases in the saved order
    for case_id in order:
        if case_id in cases_dict:
            case_data = cases_dict[case_id].copy()
            case_data["id"] = case_id
            cases.append(case_data)
    
    # Then add any cases not in the order list (new cases)
    for case_id, case_data in cases_dict.items():
        if case_id not in order:
            case_data_copy = case_data.copy()
            case_data_copy["id"] = case_id
            cases.append(case_data_copy)
    
    return cases


def save_module_order(order: List[str]) -> Tuple[bool, str]:
    """
    Save the display order of modules.
    
    Args:
        order: List of case IDs in display order
        
    Returns:
        (success, message)
    """
    try:
        registry = load_registry()
        registry["order"] = order
        save_registry(registry)
        return True, "Order saved"
    except Exception as e:
        logger.error(f"Failed to save order: {e}")
        return False, str(e)


def get_case(case_id: str) -> Optional[dict]:
    """Get a single case by ID."""
    registry = load_registry()
    case_data = registry.get("cases", {}).get(case_id)
    if case_data:
        case_data["id"] = case_id
    return case_data


def validate_case_structure(case_path: Path) -> Tuple[bool, str]:
    """
    Validate that a case directory has the required structure.
    
    Returns:
        (is_valid, error_message)
    """
    errors = []
    
    # Check for backend
    backend_dir = case_path / "backend"
    if not backend_dir.exists():
        errors.append("Missing backend/ directory")
    else:
        main_py = backend_dir / "main.py"
        if not main_py.exists():
            errors.append("Missing backend/main.py")
    
    # Check for frontend
    frontend_dir = case_path / "frontend"
    if not frontend_dir.exists():
        errors.append("Missing frontend/ directory")
    else:
        index_html = frontend_dir / "index.html"
        if not index_html.exists():
            errors.append("Missing frontend/index.html")
    
    if errors:
        return False, "; ".join(errors)
    
    return True, ""


def validate_archive_safety(zip_path: Path) -> Tuple[bool, str]:
    """
    Validate that a ZIP archive is safe to extract.
    
    Checks for:
    - Path traversal attacks (../)
    - Reasonable file sizes
    - Archive size limit
    
    Returns:
        (is_safe, error_message)
    """
    try:
        # Check archive size
        archive_size = zip_path.stat().st_size
        if archive_size > MAX_ARCHIVE_SIZE:
            return False, f"Archive too large ({archive_size / 1024 / 1024:.1f}MB > {MAX_ARCHIVE_SIZE / 1024 / 1024:.0f}MB limit)"
        
        with zipfile.ZipFile(zip_path, 'r') as zf:
            for info in zf.infolist():
                # Check for path traversal
                if '..' in info.filename or info.filename.startswith('/'):
                    return False, f"Unsafe path in archive: {info.filename}"
                
                # Check for absolute paths on Windows
                if re.match(r'^[A-Za-z]:', info.filename):
                    return False, f"Absolute path in archive: {info.filename}"
                
                # Check file size
                if info.file_size > MAX_FILE_SIZE:
                    return False, f"File too large: {info.filename} ({info.file_size / 1024 / 1024:.1f}MB)"
        
        return True, ""
    
    except zipfile.BadZipFile:
        return False, "Invalid or corrupted ZIP file"
    except Exception as e:
        return False, f"Error reading archive: {str(e)}"


def delete_case(case_id: str, delete_files: bool = True) -> Tuple[bool, str]:
    """
    Delete a case from the registry and optionally its files.
    
    Args:
        case_id: The case ID to delete
        delete_files: If True, also delete the case directory
        
    Returns:
        (success, message)
    """
    registry = load_registry()
    
    if case_id not in registry.get("cases", {}):
        return False, f"Case '{case_id}' not found"
    
    case_data = registry["cases"][case_id]
    case_path = case_data.get("path")
    
    # Delete files if requested
    if delete_files and case_path:
        full_path = SCRIPT_DIR / case_path
        if full_path.exists() and full_path.is_dir():
            try:
                shutil.rmtree(full_path)
            except Exception as e:
                return False, f"Failed to delete files: {str(e)}"
    
    # Remove from registry
    del registry["cases"][case_id]
    save_registry(registry)
    
    return True, f"Case '{case_id}' deleted successfully"


def export_case(
    case_id: str, 
    output_path: Optional[Path] = None,
    include_runs: bool = False,
    include_meshes: bool = False
) -> Tuple[bool, str, Optional[Path]]:
    """
    Export a case as a ZIP archive.
    
    Args:
        case_id: The case ID to export
        output_path: Optional output path for the ZIP file
        include_runs: If True, include saved runs in the export
        include_meshes: If True, include mesh library in the export
        
    Returns:
        (success, message, zip_path)
    """
    case_data = get_case(case_id)
    if not case_data:
        return False, f"Case '{case_id}' not found", None
    
    case_path = SCRIPT_DIR / case_data.get("path", "")
    if not case_path.exists():
        return False, f"Case directory not found: {case_path}", None
    
    # Create manifest
    manifest = {
        "manifest_version": "1.0",
        "case_id": case_id,
        "name": case_data.get("name", case_id),
        "type": case_data.get("type", "custom"),
        "category": case_data.get("category", "custom"),
        "description": case_data.get("description", ""),
        "features": case_data.get("features", []),
        "icon": case_data.get("icon", "📦"),
        "created_at": case_data.get("created_at"),
        "exported_at": datetime.now().isoformat(),
        "app_version": "1.0.0",
        "includes_runs": include_runs,
        "includes_meshes": include_meshes
    }
    
    # Determine output path
    if output_path is None:
        output_path = CASES_DIR / f"{case_id}_export.zip"
    
    try:
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            # Add manifest
            zf.writestr("manifest.json", json.dumps(manifest, indent=2))
            
            # Build exclusion list based on options
            # Always exclude logs and dev directories
            exclude_dirs = {'logs', '__pycache__', '.git', 'node_modules'}
            
            # Only exclude metadata if we're not exporting runs AND meshes
            # (metadata contains runs.json and meshes.json)
            if not include_runs and not include_meshes:
                exclude_dirs.add('metadata')
            
            if not include_runs:
                exclude_dirs.add('runs')
            if not include_meshes:
                exclude_dirs.add('meshes')
            
            for root, dirs, files in os.walk(case_path):
                # Skip excluded directories
                dirs[:] = [d for d in dirs if d not in exclude_dirs]
                
                for file in files:
                    file_path = Path(root) / file
                    arcname = file_path.relative_to(case_path)
                    
                    # Skip large files
                    if file_path.stat().st_size > MAX_FILE_SIZE:
                        continue
                    
                    zf.write(file_path, arcname)
        
        return True, f"Exported to {output_path}", output_path
    
    except Exception as e:
        return False, f"Export failed: {str(e)}", None


def inspect_archive(archive_path: Path) -> dict:
    """
    Inspect a ZIP archive to detect its contents.
    
    Returns:
        dict with keys: has_runs, has_meshes, name, manifest
    """
    result = {
        "has_runs": False,
        "has_meshes": False,
        "name": archive_path.stem.replace("_export", ""),
        "manifest": {}
    }
    
    try:
        with zipfile.ZipFile(archive_path, 'r') as zf:
            names = zf.namelist()
            
            # Check for runs and meshes directories
            for name in names:
                if '/runs/' in name or name.startswith('runs/'):
                    result["has_runs"] = True
                if '/meshes/' in name or name.startswith('meshes/'):
                    result["has_meshes"] = True
            
            # Try to read manifest
            if 'manifest.json' in names:
                with zf.open('manifest.json') as f:
                    result["manifest"] = json.load(f)
                    result["name"] = result["manifest"].get("name", result["name"])
    except Exception as e:
        logger.warning(f"Could not inspect archive: {e}")
    
    return result


def import_case(
    archive_path: Path, 
    case_id: Optional[str] = None,
    skip_runs: bool = False,
    skip_meshes: bool = False
) -> Tuple[bool, str, Optional[str]]:
    """
    Import a case from a ZIP archive.
    
    Args:
        archive_path: Path to the ZIP file
        case_id: Optional case ID (will be read from manifest if not provided)
        skip_runs: If True, skip importing runs directory
        skip_meshes: If True, skip importing meshes directory
        
    Returns:
        (success, message, case_id)
    """
    # Validate archive safety
    is_safe, error = validate_archive_safety(archive_path)
    if not is_safe:
        return False, f"Archive validation failed: {error}", None
    
    # Extract to temp directory first
    temp_dir = None
    try:
        temp_dir = Path(tempfile.mkdtemp(prefix="openfoam_import_"))
        
        with zipfile.ZipFile(archive_path, 'r') as zf:
            zf.extractall(temp_dir)
        
        # Read manifest
        manifest_path = temp_dir / "manifest.json"
        manifest = {}
        if manifest_path.exists():
            with open(manifest_path, 'r') as f:
                manifest = json.load(f)
        
        # Determine case ID
        if not case_id:
            case_id = manifest.get("case_id")
        if not case_id:
            case_id = archive_path.stem.replace("_export", "")
        
        # Sanitize case ID
        case_id = re.sub(r'[^a-zA-Z0-9_-]', '_', case_id).lower()
        
        # Find the actual case content directory
        # It might be directly in temp_dir or in a subdirectory
        content_dir = temp_dir
        if (temp_dir / "backend").exists():
            content_dir = temp_dir
        else:
            # Look for first subdirectory with backend
            for subdir in temp_dir.iterdir():
                if subdir.is_dir() and (subdir / "backend").exists():
                    content_dir = subdir
                    break
        
        # Validate case structure
        is_valid, error = validate_case_structure(content_dir)
        
        # Check for ID conflicts
        registry = load_registry()
        original_case_id = case_id
        counter = 1
        while case_id in registry.get("cases", {}):
            case_id = f"{original_case_id}_{counter}"
            counter += 1
        
        # Determine final path - use unified MODULES_ROOT
        MODULES_ROOT.mkdir(exist_ok=True)
        final_path = MODULES_ROOT / case_id
        
        # Move content to final location
        if final_path.exists():
            shutil.rmtree(final_path)
        
        # Build ignore patterns based on skip options
        ignore_patterns = ['manifest.json']
        if skip_runs:
            ignore_patterns.append('runs')
        if skip_meshes:
            ignore_patterns.append('meshes')
        
        # Copy content (excluding selected directories)
        shutil.copytree(content_dir, final_path, 
                       ignore=shutil.ignore_patterns(*ignore_patterns) if ignore_patterns else None)
        
        # Create required directories (always create them, even if skipped during import)
        for subdir in ['runs', 'logs', 'meshes', 'metadata']:
            (final_path / subdir).mkdir(exist_ok=True)
        
        # Use case_id-based route for imported modules to avoid conflicts
        # Each module gets its own unique route based on its ID
        route = f"/{case_id}/"
        
        # Create module.json manifest in the module directory
        module_manifest = {
            "id": case_id,
            "name": manifest.get("name", case_id),
            "type": manifest.get("type", "custom"),
            "route": route,
            "icon": manifest.get("icon", "📦"),
            "description": manifest.get("description", "Imported case"),
            "features": manifest.get("features", []),
            "version": manifest.get("app_version", "1.0.0"),
            "imported_at": datetime.now().isoformat()
        }
        with open(final_path / "module.json", 'w') as f:
            json.dump(module_manifest, f, indent=2)
        
        # Rewrite paths in metadata files (runs.json, meshes.json)
        # These files contain absolute paths that need updating to the new module location
        metadata_dir = final_path / "metadata"
        if metadata_dir.exists():
            for meta_file in ['meshes.json', 'runs.json']:
                meta_path = metadata_dir / meta_file
                if meta_path.exists():
                    try:
                        with open(meta_path, 'r') as f:
                            metadata = json.load(f)
                        
                        # Rewrite all paths in the metadata
                        modified = False
                        for item_id, item_data in metadata.items():
                            if isinstance(item_data, dict):
                                for key in ['path', 'polymesh_path', 'case_path']:
                                    if key in item_data and item_data[key]:
                                        old_path = item_data[key]
                                        # Extract relative path from the old absolute path
                                        # Look for meshes/ or runs/ in the path and keep everything after module base
                                        for subdir in ['meshes/', 'runs/']:
                                            if subdir in old_path:
                                                rel_part = old_path.split(subdir, 1)[1]
                                                new_path = str(final_path / subdir.rstrip('/') / rel_part)
                                                item_data[key] = new_path
                                                modified = True
                                                break
                        
                        if modified:
                            with open(meta_path, 'w') as f:
                                json.dump(metadata, f, indent=2)
                            logger.info(f"Rewrote paths in {meta_file}")
                    except Exception as e:
                        logger.warning(f"Could not rewrite paths in {meta_file}: {e}")
        
        # Register the case
        now = datetime.now().isoformat()
        registry["cases"][case_id] = {
            "id": case_id,
            "name": manifest.get("name", case_id),
            "category": "custom",
            "type": manifest.get("type", "custom"),
            "path": f"modules/{case_id}",
            "route": route,
            "icon": manifest.get("icon", "📦"),
            "description": manifest.get("description", "Imported case"),
            "features": manifest.get("features", []),
            "status": "valid" if is_valid else "invalid",
            "error": error if not is_valid else None,
            "created_at": manifest.get("created_at", now),
            "updated_at": now,
            "imported_at": now
        }
        save_registry(registry)
        
        # Log import success
        logger.info(f"Imported module {case_id} to {final_path} with route {route}")
        
        status_msg = "imported successfully" if is_valid else f"imported with validation errors: {error}"
        return True, f"Case '{case_id}' {status_msg}", case_id
    
    except Exception as e:
        logger.error(f"Import failed: {e}")
        return False, f"Import failed: {str(e)}", None
    
    finally:
        # Clean up temp directory
        if temp_dir and temp_dir.exists():
            try:
                shutil.rmtree(temp_dir)
            except:
                pass


def update_case_status(case_id: str, status: str, error: Optional[str] = None):
    """Update the status of a case in the registry."""
    registry = load_registry()
    if case_id in registry.get("cases", {}):
        registry["cases"][case_id]["status"] = status
        registry["cases"][case_id]["error"] = error
        registry["cases"][case_id]["updated_at"] = datetime.now().isoformat()
        save_registry(registry)


def revalidate_case(case_id: str) -> Tuple[bool, str]:
    """Re-validate a case and update its status."""
    case_data = get_case(case_id)
    if not case_data:
        return False, f"Case '{case_id}' not found"
    
    case_path = SCRIPT_DIR / case_data.get("path", "")
    if not case_path.exists():
        update_case_status(case_id, "invalid", "Case directory not found")
        return False, "Case directory not found"
    
    is_valid, error = validate_case_structure(case_path)
    update_case_status(case_id, "valid" if is_valid else "invalid", error if not is_valid else None)
    
    return is_valid, error if not is_valid else "Case is valid"


def update_case_metadata(
    case_id: str,
    name: Optional[str] = None,
    icon: Optional[str] = None,
    description: Optional[str] = None,
    features: Optional[list] = None
) -> Tuple[bool, str]:
    """
    Update case metadata in the registry and module.json.
    
    Changes are persisted to both:
    1. cases/registry.json (for landing page display)
    2. modules/<id>/module.json (for export persistence)
    
    Returns:
        (success, message)
    """
    registry = load_registry()
    if case_id not in registry.get("cases", {}):
        return False, f"Case '{case_id}' not found"
    
    case_data = registry["cases"][case_id]
    
    # Update registry
    if name is not None:
        case_data["name"] = name
    if icon is not None:
        case_data["icon"] = icon
    if description is not None:
        case_data["description"] = description
    if features is not None:
        case_data["features"] = features
    
    case_data["updated_at"] = datetime.now().isoformat()
    save_registry(registry)
    
    # Also update module.json if it exists (for export persistence)
    module_path = SCRIPT_DIR / case_data.get("path", "")
    module_json_path = module_path / "module.json"
    
    if module_path.exists():
        try:
            # Load existing manifest or create new one
            manifest = {}
            if module_json_path.exists():
                with open(module_json_path, 'r') as f:
                    manifest = json.load(f)
            
            # Update manifest fields
            manifest["id"] = case_id
            if name is not None:
                manifest["name"] = name
            if icon is not None:
                manifest["icon"] = icon
            if description is not None:
                manifest["description"] = description
            if features is not None:
                manifest["features"] = features
            manifest["updated_at"] = datetime.now().isoformat()
            
            # Preserve existing fields
            manifest.setdefault("type", case_data.get("type", case_id))
            manifest.setdefault("route", case_data.get("route", f"/{case_id}/"))
            manifest.setdefault("version", "1.0.0")
            
            # Save manifest
            with open(module_json_path, 'w') as f:
                json.dump(manifest, f, indent=2)
            
            logger.info(f"Updated module.json for {case_id}")
        except Exception as e:
            logger.warning(f"Could not update module.json for {case_id}: {e}")
    
    return True, f"Case '{case_id}' metadata updated"

