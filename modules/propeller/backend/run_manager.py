#!/usr/bin/env python3
"""
Run Manager

Manages simulation runs: create, list, archive, restore, delete.
Runs are now always linked to a mesh_id from the mesh library.
"""

import os
import json
import shutil
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Tuple, Any, Union


class RunManager:
    """Manages simulation runs and archives."""
    
    def __init__(self, runs_dir: Path, templates_dir: Path, metadata_dir: Path):
        self.runs_dir = runs_dir
        self.templates_dir = templates_dir
        self.metadata_dir = metadata_dir
        self.runs_metadata_file = metadata_dir / "runs.json"
        self.runs_metadata = self._load_metadata()
    
    def _load_metadata(self) -> Dict:
        """Load runs metadata from disk."""
        if self.runs_metadata_file.exists():
            try:
                with open(self.runs_metadata_file, 'r') as f:
                    return json.load(f)
            except:
                return {}
        return {}
    
    def _save_metadata(self):
        """Save runs metadata to disk."""
        with open(self.runs_metadata_file, 'w') as f:
            json.dump(self.runs_metadata, f, indent=2, default=str)
    
    def _generate_run_id(self, name: Optional[str] = None) -> str:
        """Generate a unique run ID with collision avoidance."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:20]
        
        if name:
            safe_name = "".join(c if c.isalnum() or c == '_' else '_' for c in name)
            base_id = f"{safe_name}_{timestamp}"
        else:
            base_id = f"run_{timestamp}"
        
        run_id = base_id
        counter = 1
        while (self.runs_dir / run_id).exists() or run_id in self.runs_metadata:
            run_id = f"{base_id}_{counter}"
            counter += 1
        
        return run_id
    
    def _get_dir_size(self, path: Path) -> int:
        """Calculate directory size in bytes."""
        total = 0
        try:
            for entry in path.rglob('*'):
                if entry.is_file():
                    total += entry.stat().st_size
        except:
            pass
        return total
    # ==================== Run Creation ====================
    
    def create_run_from_mesh(
        self,
        mesh_id: str,
        mesh_name: str,
        rotor_paths: Union[Path, List[Path]],
        stator_path: Path,
        run_name: Optional[str] = None,
        solver_config: Optional[Dict] = None,
        material_config: Optional[Dict] = None,
        polymesh_source_path: Optional[Path] = None  # Path to polyMesh in library
    ) -> Tuple[str, str]:
        """
        Create a new run from a mesh in the library.
        
        Args:
            mesh_id: ID of the mesh from library (REQUIRED)
            mesh_name: Display name of the mesh
            rotor_paths: Path(s) to rotor UNV file(s). Single Path or list.
            stator_path: Path to stator.unv file
            run_name: Optional custom run name
            solver_config: Optional initial solver settings
            material_config: Optional initial material settings
            polymesh_source_path: Optional path to polyMesh directory to copy
            
        Returns:
            Tuple of (run_id, error_message). run_id is empty on error.
        """
        if not mesh_id:
            return "", "mesh_id is required"
        
        # Normalize to list for multi-rotor support
        if isinstance(rotor_paths, Path):
            rotor_paths = [rotor_paths]
        
        rotor_count = len(rotor_paths)
        
        run_id = self._generate_run_id(run_name)
        run_dir = self.runs_dir / run_id
        
        if run_dir.exists():
            return "", f"Run directory already exists: {run_id}"
        
        try:
            # Create run directory
            run_dir.mkdir(parents=True)
            (run_dir / "logs").mkdir()
            (run_dir / "inputs").mkdir()
            
            # Copy template
            template_dir = self.templates_dir / "propCase"
            if not template_dir.exists():
                return "", f"Template not found: {template_dir}"
            
            shutil.copytree(template_dir, run_dir / "propCase")
            
            # Remove template rotor/ dir (we create rotor_N/ dirs instead)
            template_rotor = run_dir / "propCase" / "rotor"
            if template_rotor.exists():
                shutil.rmtree(template_rotor)
            
            # Copy stator UNV
            shutil.copy2(stator_path, run_dir / "inputs" / "stator.unv")
            shutil.copy2(stator_path, run_dir / "propCase" / "stator" / "stator.unv")
            
            # Copy each rotor UNV to its own rotor_N/ directory
            for i, rpath in enumerate(rotor_paths, start=1):
                rotor_dir = run_dir / "propCase" / f"rotor_{i}"
                rotor_dir.mkdir(parents=True, exist_ok=True)
                # Copy template rotor contents (0/, constant/, system/) from template
                template_rotor_dir = self.templates_dir / "propCase" / "rotor"
                if template_rotor_dir.exists():
                    for item in template_rotor_dir.iterdir():
                        dest = rotor_dir / item.name
                        if not dest.exists():
                            if item.is_dir():
                                shutil.copytree(item, dest)
                            else:
                                shutil.copy2(item, dest)
                shutil.copy2(rpath, run_dir / "inputs" / f"rotor_{i}.unv")
                shutil.copy2(rpath, rotor_dir / "rotor.unv")
            
            # Copy polyMesh from library if available (run is ready to simulate!)
            has_polymesh = False
            if polymesh_source_path and polymesh_source_path.exists():
                polymesh_dest = run_dir / "propCase" / "stator" / "constant" / "polyMesh"
                polymesh_dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(polymesh_source_path, polymesh_dest)
                has_polymesh = True
                print(f"[INFO] Copied polyMesh from library to {run_id}")
            
            # Create .foam file for ParaView
            foam_file = run_dir / "propCase" / "stator" / "case.foam"
            foam_file.touch()
            
            # Create metadata with mesh_id reference
            self.runs_metadata[run_id] = {
                "run_id": run_id,
                "name": run_name or run_id,
                "mesh_id": mesh_id,
                "mesh_name": mesh_name,
                "rotor_count": rotor_count,
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
                "status": "ready" if has_polymesh else "created",  # ready = has polyMesh
                "archived": False,
                "size_bytes": None,
                "solver_config": solver_config or {},
                "material_config": material_config or {},
                "paraview_outputs": [str(foam_file)],
                "has_polymesh": has_polymesh
            }
            
            self._save_metadata()
            
            return run_id, ""
            
        except Exception as e:
            if run_dir.exists():
                shutil.rmtree(run_dir, ignore_errors=True)
            return "", str(e)
    
    # Legacy create_run for backwards compatibility
    def create_run(
        self,
        rotor_filename: str,
        stator_filename: str,
        run_name: Optional[str] = None
    ) -> Tuple[str, str]:
        """Legacy create_run - uses temp upload location. Supports single rotor only."""
        
        run_id = self._generate_run_id(run_name)
        run_dir = self.runs_dir / run_id
        
        if run_dir.exists():
            return "", f"Run directory already exists: {run_id}"
        
        try:
            run_dir.mkdir(parents=True)
            (run_dir / "logs").mkdir()
            (run_dir / "inputs").mkdir()
            
            template_dir = self.templates_dir / "propCase"
            if not template_dir.exists():
                return "", f"Template not found: {template_dir}"
            
            shutil.copytree(template_dir, run_dir / "propCase")
            
            # Remove template rotor/ dir — we use rotor_1/
            template_rotor = run_dir / "propCase" / "rotor"
            if template_rotor.exists():
                shutil.rmtree(template_rotor)
            
            # Look for files in multiple locations
            uploads_dir = self.runs_dir / "_uploads"
            meshes_dir = self.runs_dir.parent / "meshes"
            
            rotor_src = None
            stator_src = None
            
            for search_dir in [uploads_dir, meshes_dir]:
                if search_dir.exists():
                    r = search_dir / rotor_filename
                    s = search_dir / stator_filename
                    if r.exists() and rotor_src is None:
                        rotor_src = r
                    if s.exists() and stator_src is None:
                        stator_src = s
            
            if not rotor_src or not rotor_src.exists():
                return "", f"Rotor file not found: {rotor_filename}"
            if not stator_src or not stator_src.exists():
                return "", f"Stator file not found: {stator_filename}"
            
            shutil.copy2(rotor_src, run_dir / "inputs" / rotor_filename)
            shutil.copy2(stator_src, run_dir / "inputs" / stator_filename)
            
            # Create rotor_1/ directory from template rotor/
            rotor_1_dir = run_dir / "propCase" / "rotor_1"
            rotor_1_dir.mkdir(parents=True, exist_ok=True)
            template_rotor_dir = self.templates_dir / "propCase" / "rotor"
            if template_rotor_dir.exists():
                for item in template_rotor_dir.iterdir():
                    dest = rotor_1_dir / item.name
                    if not dest.exists():
                        if item.is_dir():
                            shutil.copytree(item, dest)
                        else:
                            shutil.copy2(item, dest)
            shutil.copy2(rotor_src, rotor_1_dir / "rotor.unv")
            shutil.copy2(stator_src, run_dir / "propCase" / "stator" / "stator.unv")
            
            # Create .foam file
            foam_file = run_dir / "propCase" / "stator" / "case.foam"
            foam_file.touch()
            
            self.runs_metadata[run_id] = {
                "run_id": run_id,
                "name": run_name or run_id,
                "mesh_id": None,  # Legacy - no mesh reference
                "mesh_name": None,
                "rotor_count": 1,
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
                "status": "created",
                "archived": False,
                "size_bytes": None,
                "rotor_file": rotor_filename,
                "stator_file": stator_filename,
                "solver_config": {},
                "material_config": {},
                "paraview_outputs": [str(foam_file)]
            }
            
            self._save_metadata()
            
            return run_id, ""
            
        except Exception as e:
            if run_dir.exists():
                shutil.rmtree(run_dir, ignore_errors=True)
            return "", str(e)
    
    # ==================== Run Queries ====================
    
    def list_runs(self) -> List[Dict]:
        """List all runs with metadata including storage size."""
        runs = []
        
        for run_id, meta in self.runs_metadata.items():
            run_dir = self.runs_dir / run_id
            
            # Calculate size if directory exists
            size_bytes = 0
            if run_dir.exists():
                size_bytes = self._get_dir_size(run_dir)
            
            run_info = {
                **meta,
                "exists": run_dir.exists(),
                "has_results": (run_dir / "propCase" / "stator" / "0.01").exists() if run_dir.exists() else False,
                "size_bytes": size_bytes
            }
            
            runs.append(run_info)
        
        runs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        
        return runs
    
    def get_run_details(self, run_id: str) -> Optional[Dict]:
        """Get detailed information about a run."""
        if run_id not in self.runs_metadata:
            return None
        
        meta = self.runs_metadata[run_id]
        run_dir = self.runs_dir / run_id
        
        details = {
            **meta,
            "exists": run_dir.exists(),
            "path": str(run_dir)
        }
        
        if run_dir.exists():
            logs_dir = run_dir / "logs"
            if logs_dir.exists():
                details["logs"] = [f.name for f in logs_dir.iterdir() if f.is_file()]
        
        return details
    
    def get_run_directory(self, run_id: str) -> Optional[Path]:
        """Get the path to a run directory."""
        run_dir = self.runs_dir / run_id
        if run_dir.exists():
            return run_dir
        return None
    
    # ==================== ParaView Helpers ====================
    
    def get_paraview_outputs(self, run_id: str) -> List[str]:
        """Get ParaView output file paths for a run."""
        if run_id not in self.runs_metadata:
            return []
        
        # Return stored paths or find them
        stored = self.runs_metadata[run_id].get("paraview_outputs", [])
        if stored:
            return stored
        
        # Search for .foam files
        run_dir = self.runs_dir / run_id
        if not run_dir.exists():
            return []
        
        foam_files = list(run_dir.rglob("*.foam"))
        return [str(f) for f in foam_files]
    
    def get_case_path(self, run_id: str) -> Optional[str]:
        """Get the main case path for a run."""
        run_dir = self.runs_dir / run_id
        case_path = run_dir / "propCase" / "stator"
        if case_path.exists():
            return str(case_path)
        return None
    
    # ==================== Run Status ====================
    
    def update_run_status(self, run_id: str, status: str) -> bool:
        """Update run status."""
        if run_id not in self.runs_metadata:
            return False
        
        self.runs_metadata[run_id]["status"] = status
        self.runs_metadata[run_id]["updated_at"] = datetime.now().isoformat()
        self._save_metadata()
        return True
    
    def update_solver_config(self, run_id: str, solver_config: Dict) -> bool:
        """Update solver configuration for a run."""
        if run_id not in self.runs_metadata:
            return False
        
        self.runs_metadata[run_id]["solver_config"] = solver_config
        self.runs_metadata[run_id]["updated_at"] = datetime.now().isoformat()
        self._save_metadata()
        return True
    
    def update_material_config(self, run_id: str, material_config: Dict) -> bool:
        """Update material configuration for a run."""
        if run_id not in self.runs_metadata:
            return False
        
        self.runs_metadata[run_id]["material_config"] = material_config
        self.runs_metadata[run_id]["updated_at"] = datetime.now().isoformat()
        self._save_metadata()
        return True
    
    def record_solve_completion(
        self,
        run_id: str,
        solver_config: Dict,
        material_config: Dict,
        started_at: str,
        completed_at: str,
        success: bool = True
    ) -> bool:
        """Record solve completion with settings and duration."""
        if run_id not in self.runs_metadata:
            return False
        
        meta = self.runs_metadata[run_id]
        
        # Store the settings that were actually used
        meta["solver_config"] = solver_config
        meta["material_config"] = material_config
        
        # Store timing info
        meta["solve_started_at"] = started_at
        meta["solve_completed_at"] = completed_at
        
        # Calculate duration in seconds
        try:
            start_dt = datetime.fromisoformat(started_at)
            end_dt = datetime.fromisoformat(completed_at)
            meta["solve_duration_seconds"] = (end_dt - start_dt).total_seconds()
        except:
            meta["solve_duration_seconds"] = None
        
        meta["status"] = "completed" if success else "failed"
        meta["updated_at"] = datetime.now().isoformat()
        
        self._save_metadata()
        return True
    
    # ==================== Archive/Delete ====================
    
    def archive_run(self, run_id: str) -> Tuple[bool, str]:
        """Archive a run."""
        if run_id not in self.runs_metadata:
            return False, "Run not found"
        
        run_dir = self.runs_dir / run_id
        if not run_dir.exists():
            return False, "Run directory not found"
        
        meta = self.runs_metadata[run_id]
        
        if meta.get("size_bytes") is None:
            meta["size_bytes"] = self._get_dir_size(run_dir)
        
        meta["archived"] = True
        meta["archived_at"] = datetime.now().isoformat()
        
        self._save_metadata()
        
        size_mb = meta["size_bytes"] / (1024 * 1024)
        return True, f"Run archived ({size_mb:.1f} MB)"
    
    def unarchive_run(self, run_id: str) -> Tuple[bool, str]:
        """Restore an archived run to active."""
        if run_id not in self.runs_metadata:
            return False, "Run not found"
        
        meta = self.runs_metadata[run_id]
        meta["archived"] = False
        meta.pop("archived_at", None)
        
        self._save_metadata()
        
        return True, "Run restored to active"
    
    def delete_run(self, run_id: str) -> Tuple[bool, str]:
        """Delete a run permanently."""
        run_dir = self.runs_dir / run_id
        
        try:
            if run_dir.exists():
                shutil.rmtree(run_dir)
            
            if run_id in self.runs_metadata:
                del self.runs_metadata[run_id]
                self._save_metadata()
            
            return True, "Run deleted"
            
        except Exception as e:
            return False, str(e)
    
    def update_run_metadata(self, run_id: str, updates: Dict) -> bool:
        """Update run metadata."""
        if run_id not in self.runs_metadata:
            return False
        
        self.runs_metadata[run_id].update(updates)
        self.runs_metadata[run_id]["updated_at"] = datetime.now().isoformat()
        self._save_metadata()
        return True
