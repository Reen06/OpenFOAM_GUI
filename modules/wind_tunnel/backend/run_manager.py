#!/usr/bin/env python3
"""
Run Manager for Wind Tunnel GUI

Manages simulation runs: create, list, archive, restore, delete.
Single mesh handling (no rotor/stator).
"""

import os
import json
import shutil
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Any


class RunManager:
    """Manages simulation runs and archives."""
    
    def __init__(self, runs_dir: Path, templates_dir: Path, metadata_dir: Path):
        self.runs_dir = runs_dir
        self.templates_dir = templates_dir
        self.metadata_dir = metadata_dir
        self.metadata_file = metadata_dir / "runs.json"
        self.metadata: Dict[str, Dict] = {}
        self._load_metadata()
    
    def _load_metadata(self):
        """Load runs metadata from disk."""
        if self.metadata_file.exists():
            try:
                self.metadata = json.loads(self.metadata_file.read_text())
            except:
                self.metadata = {}
        else:
            self.metadata = {}
    
    def _save_metadata(self):
        """Save runs metadata to disk."""
        self.metadata_file.write_text(json.dumps(self.metadata, indent=2))
    
    def _generate_run_id(self, name: Optional[str] = None) -> str:
        """Generate a unique run ID with collision avoidance."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        if name:
            # Sanitize name
            safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)
            base_id = f"{safe_name}_{timestamp}"
        else:
            base_id = f"run_{timestamp}"
        
        # Check for collision
        run_id = base_id
        counter = 1
        while (self.runs_dir / run_id).exists():
            run_id = f"{base_id}_{counter}"
            counter += 1
        
        return run_id
    
    def _get_dir_size(self, path: Path) -> int:
        """Calculate directory size in bytes."""
        total = 0
        try:
            for entry in path.rglob("*"):
                if entry.is_file():
                    total += entry.stat().st_size
        except:
            pass
        return total
    
    def create_run_from_mesh(
        self,
        mesh_id: str,
        mesh_name: str,
        mesh_path: Optional[Path],
        run_name: Optional[str] = None,
        solver_config: Optional[Dict] = None,
        material_config: Optional[Dict] = None,
        polymesh_source_path: Optional[Path] = None
    ) -> Dict:
        """Create a new run from a mesh in the library."""
        
        run_id = self._generate_run_id(run_name)
        run_dir = self.runs_dir / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        
        # Copy template case
        template_case = self.templates_dir / "windTunnelCase"
        case_dir = run_dir / "windTunnelCase"
        
        if template_case.exists():
            shutil.copytree(template_case, case_dir)
        else:
            # Create minimal structure
            case_dir.mkdir()
            (case_dir / "0").mkdir()
            (case_dir / "constant").mkdir()
            (case_dir / "system").mkdir()
        
        # Copy polyMesh if available from library
        if polymesh_source_path and polymesh_source_path.exists():
            dest_polymesh = case_dir / "constant" / "polyMesh"
            shutil.copytree(polymesh_source_path, dest_polymesh)
        
        # Copy mesh file if provided
        if mesh_path and mesh_path.exists():
            shutil.copy2(mesh_path, run_dir / mesh_path.name)
        
        # Create .foam file for ParaView
        foam_file = case_dir / "windTunnelCase.foam"
        foam_file.touch()
        
        # Store metadata
        self.metadata[run_id] = {
            "run_id": run_id,
            "name": run_name or run_id,
            "mesh_id": mesh_id,
            "mesh_name": mesh_name,
            "status": "created",
            "created_at": datetime.now().isoformat(),
            "solver_config": solver_config or {},
            "material_config": material_config or {}
        }
        self._save_metadata()
        
        return {
            "run_id": run_id,
            "name": run_name or run_id,
            "path": str(run_dir),
            "case_path": str(case_dir)
        }
    
    def create_run_entry(
        self,
        run_id: str,
        run_name: Optional[str],
        mesh_filename: str
    ):
        """Create a run metadata entry for an uploaded mesh."""
        
        run_dir = self.runs_dir / run_id
        
        # Copy template case
        template_case = self.templates_dir / "windTunnelCase"
        case_dir = run_dir / "windTunnelCase"
        
        if template_case.exists() and not case_dir.exists():
            shutil.copytree(template_case, case_dir)
        elif not case_dir.exists():
            case_dir.mkdir()
            (case_dir / "0").mkdir()
            (case_dir / "constant").mkdir()
            (case_dir / "system").mkdir()
        
        # Create .foam file
        foam_file = case_dir / "windTunnelCase.foam"
        foam_file.touch()
        
        self.metadata[run_id] = {
            "run_id": run_id,
            "name": run_name or run_id,
            "mesh_id": None,
            "mesh_name": mesh_filename,
            "status": "created",
            "created_at": datetime.now().isoformat(),
            "solver_config": {},
            "material_config": {}
        }
        self._save_metadata()
    
    def list_runs(self) -> List[Dict]:
        """List all runs with metadata including storage size."""
        runs = []
        
        for run_id, meta in self.metadata.items():
            run_dir = self.runs_dir / run_id
            if run_dir.exists():
                run_info = {
                    **meta,
                    "size_bytes": self._get_dir_size(run_dir)
                }
                runs.append(run_info)
        
        # Sort by creation time (newest first)
        runs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        
        return runs
    
    def get_run_details(self, run_id: str) -> Optional[Dict]:
        """Get detailed information about a run."""
        if run_id not in self.metadata:
            return None
        
        run_dir = self.runs_dir / run_id
        case_dir = run_dir / "windTunnelCase"
        
        details = {
            **self.metadata[run_id],
            "path": str(run_dir),
            "case_path": str(case_dir),
            "has_polymesh": (case_dir / "constant" / "polyMesh").exists(),
            "size_bytes": self._get_dir_size(run_dir)
        }
        
        return details
    
    def get_run_directory(self, run_id: str) -> Optional[Path]:
        """Get the path to a run directory."""
        run_dir = self.runs_dir / run_id
        if run_dir.exists():
            return run_dir
        return None
    
    def get_paraview_outputs(self, run_id: str) -> Dict:
        """Get ParaView output file paths for a run."""
        run_dir = self.runs_dir / run_id
        case_dir = run_dir / "windTunnelCase"
        
        foam_file = case_dir / "windTunnelCase.foam"
        
        return {
            "foam_file": str(foam_file) if foam_file.exists() else None,
            "case_dir": str(case_dir)
        }
    
    def update_run_status(self, run_id: str, status: str):
        """Update run status."""
        if run_id in self.metadata:
            self.metadata[run_id]["status"] = status
            self._save_metadata()

    def update_run_metadata(self, run_id: str, updates: Dict) -> bool:
        """Update arbitrary metadata fields on a run."""
        if run_id not in self.metadata:
            return False
        self.metadata[run_id].update(updates)
        self._save_metadata()
        return True
    
    def update_solver_config(self, run_id: str, solver_config: Dict):
        """Update solver configuration for a run."""
        if run_id in self.metadata:
            self.metadata[run_id]["solver_config"] = solver_config
            self._save_metadata()
    
    def update_material_config(self, run_id: str, material_config: Dict):
        """Update material configuration for a run."""
        if run_id in self.metadata:
            self.metadata[run_id]["material_config"] = material_config
            self._save_metadata()
    
    def record_solve_completion(
        self,
        run_id: str,
        solver_config: Dict,
        material_config: Dict,
        started_at: str,
        completed_at: str,
        success: bool = True
    ):
        """Record solve completion with settings and duration."""
        if run_id not in self.metadata:
            return
        
        # Calculate duration
        try:
            start = datetime.fromisoformat(started_at)
            end = datetime.fromisoformat(completed_at)
            duration_seconds = (end - start).total_seconds()
        except:
            duration_seconds = None
        
        self.metadata[run_id].update({
            "status": "completed" if success else "failed",
            "solver_config": solver_config,
            "material_config": material_config,
            "started_at": started_at,
            "completed_at": completed_at,
            "solve_duration_seconds": duration_seconds
        })
        self._save_metadata()
    
    def delete_run(self, run_id: str):
        """Delete a run permanently."""
        run_dir = self.runs_dir / run_id
        
        if run_dir.exists():
            shutil.rmtree(run_dir)
        
        if run_id in self.metadata:
            del self.metadata[run_id]
            self._save_metadata()
