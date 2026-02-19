#!/usr/bin/env python3
"""
Mesh Library for Wind Tunnel GUI

Manages saved meshes that can be reused across runs.
Single mesh handling (not rotor/stator pairs).
"""

import json
import shutil
import uuid
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List


class MeshLibrary:
    """Manages a library of saved meshes."""
    
    def __init__(self, meshes_dir: Path, metadata_dir: Path):
        self.meshes_dir = meshes_dir
        self.metadata_dir = metadata_dir
        self.metadata_file = metadata_dir / "meshes.json"
        self.metadata: Dict[str, Dict] = {}
        self._load_metadata()
    
    def _load_metadata(self):
        """Load mesh library metadata from disk."""
        if self.metadata_file.exists():
            try:
                self.metadata = json.loads(self.metadata_file.read_text())
            except:
                self.metadata = {}
        else:
            self.metadata = {}
    
    def _save_metadata(self):
        """Save mesh library metadata to disk."""
        self.metadata_file.write_text(json.dumps(self.metadata, indent=2))
    
    def _generate_mesh_id(self) -> str:
        """Generate a unique mesh ID."""
        return str(uuid.uuid4())[:8]
    
    def add_mesh(
        self,
        name: str,
        project: str = "default",
        mesh_path: Optional[Path] = None,
        run_id: Optional[str] = None,
        polymesh_path: Optional[Path] = None
    ) -> str:
        """Add a mesh to the library with both mesh file and polyMesh."""
        
        mesh_id = self._generate_mesh_id()
        mesh_dir = self.meshes_dir / mesh_id
        mesh_dir.mkdir(parents=True, exist_ok=True)
        
        stored_path = None
        stored_polymesh_path = None
        
        # Copy mesh file if provided
        if mesh_path and mesh_path.exists():
            dest = mesh_dir / mesh_path.name
            shutil.copy2(mesh_path, dest)
            stored_path = str(dest)
        
        # Copy polyMesh if provided
        if polymesh_path and polymesh_path.exists():
            dest_polymesh = mesh_dir / "polyMesh"
            if dest_polymesh.exists():
                shutil.rmtree(dest_polymesh)
            shutil.copytree(polymesh_path, dest_polymesh)
            stored_polymesh_path = str(dest_polymesh)
        
        self.metadata[mesh_id] = {
            "id": mesh_id,
            "name": name,
            "project": project,
            "path": stored_path,
            "polymesh_path": stored_polymesh_path,
            "run_id": run_id,
            "created": datetime.now().isoformat()
        }
        self._save_metadata()
        
        return mesh_id
    
    def list_meshes(self, project: Optional[str] = None) -> List[Dict]:
        """List all meshes in the library."""
        meshes = []
        for m in self.metadata.values():
            entry = dict(m)
            entry["has_default_mapping"] = bool(m.get("boundary_mapping"))
            meshes.append(entry)

        if project:
            meshes = [m for m in meshes if m.get("project") == project]

        # Sort by creation time (newest first)
        meshes.sort(key=lambda x: x.get("created", ""), reverse=True)

        return meshes
    
    def get_mesh(self, mesh_id: str) -> Optional[Dict]:
        """Get mesh information by ID."""
        return self.metadata.get(mesh_id)
    
    def delete_mesh(self, mesh_id: str):
        """Delete a mesh from the library."""
        mesh_dir = self.meshes_dir / mesh_id
        
        if mesh_dir.exists():
            shutil.rmtree(mesh_dir)
        
        if mesh_id in self.metadata:
            del self.metadata[mesh_id]
            self._save_metadata()
    
    def update_polymesh_path(self, mesh_id: str, polymesh_path: Path):
        """Update the polyMesh path for a mesh."""
        if mesh_id in self.metadata:
            # Copy polyMesh to mesh library
            mesh_dir = self.meshes_dir / mesh_id
            dest_polymesh = mesh_dir / "polyMesh"

            if polymesh_path.exists():
                if dest_polymesh.exists():
                    shutil.rmtree(dest_polymesh)
                shutil.copytree(polymesh_path, dest_polymesh)
                self.metadata[mesh_id]["polymesh_path"] = str(dest_polymesh)
                self._save_metadata()

    def mesh_exists(self, mesh_id: str) -> bool:
        """Check if a mesh exists in the library."""
        return mesh_id in self.metadata

    def get_boundary_mapping(self, mesh_id: str) -> Dict:
        """Get the default boundary mapping for a mesh."""
        if mesh_id not in self.metadata:
            return {}
        return self.metadata[mesh_id].get("boundary_mapping", {})

    def update_boundary_mapping(self, mesh_id: str, mapping: Dict) -> bool:
        """Update the default boundary mapping for a mesh."""
        if mesh_id not in self.metadata:
            return False
        self.metadata[mesh_id]["boundary_mapping"] = mapping
        self._save_metadata()
        return True
