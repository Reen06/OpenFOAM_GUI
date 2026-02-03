#!/usr/bin/env python3
"""
Mesh Manager

Manages saving, loading, and archiving of OpenFOAM meshes.
"""

import json
import shutil
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Tuple


class MeshManager:
    """Manages mesh storage and retrieval."""
    
    def __init__(self, meshes_dir: Path, metadata_dir: Path):
        self.meshes_dir = meshes_dir
        self.metadata_dir = metadata_dir
        self.meshes_metadata_file = metadata_dir / "meshes.json"
        self.meshes_metadata = self._load_metadata()
    
    def _load_metadata(self) -> Dict:
        """Load meshes metadata from disk."""
        if self.meshes_metadata_file.exists():
            try:
                with open(self.meshes_metadata_file, 'r') as f:
                    return json.load(f)
            except:
                return {}
        return {}
    
    def _save_metadata(self):
        """Save meshes metadata to disk."""
        with open(self.meshes_metadata_file, 'w') as f:
            json.dump(self.meshes_metadata, f, indent=2, default=str)
    
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
    
    def _get_patches_from_boundary(self, boundary_file: Path) -> List[Dict]:
        """Extract patch information from boundary file."""
        patches = []
        
        if not boundary_file.exists():
            return patches
        
        try:
            import re
            with open(boundary_file, 'r') as f:
                content = f.read()
            
            pattern = r'(\w+)\s*\{\s*type\s+(\w+);[^}]*nFaces\s+(\d+);[^}]*\}'
            matches = re.findall(pattern, content, re.DOTALL)
            
            for name, ptype, nfaces in matches:
                patches.append({
                    'name': name,
                    'type': ptype,
                    'nFaces': int(nfaces)
                })
        except:
            pass
        
        return patches
    
    def save_mesh(self, run_dir: Path, mesh_name: str) -> Tuple[bool, str]:
        """Save a run's mesh for later reuse."""
        
        # Source polyMesh
        polymesh_src = run_dir / "propCase" / "stator" / "constant" / "polyMesh"
        
        if not polymesh_src.exists():
            return False, "No mesh found in run"
        
        # Sanitize mesh name
        safe_name = "".join(c if c.isalnum() or c == '_' else '_' for c in mesh_name)
        
        if safe_name in self.meshes_metadata:
            return False, f"Mesh '{safe_name}' already exists"
        
        # Create mesh directory
        mesh_dir = self.meshes_dir / safe_name
        
        try:
            # Copy polyMesh
            shutil.copytree(polymesh_src, mesh_dir / "polyMesh")
            
            # Get mesh info
            boundary_file = mesh_dir / "polyMesh" / "boundary"
            patches = self._get_patches_from_boundary(boundary_file)
            size_bytes = self._get_dir_size(mesh_dir)
            
            # Save metadata
            self.meshes_metadata[safe_name] = {
                "name": safe_name,
                "display_name": mesh_name,
                "created_at": datetime.now().isoformat(),
                "source_run": run_dir.name,
                "size_bytes": size_bytes,
                "patches": patches
            }
            
            self._save_metadata()
            
            size_mb = size_bytes / (1024 * 1024)
            return True, f"Mesh saved: {mesh_name} ({size_mb:.1f} MB)"
            
        except Exception as e:
            # Cleanup on failure
            if mesh_dir.exists():
                shutil.rmtree(mesh_dir, ignore_errors=True)
            return False, str(e)
    
    def load_mesh(self, mesh_name: str, run_dir: Path) -> Tuple[bool, str]:
        """Load a saved mesh into a run."""
        
        if mesh_name not in self.meshes_metadata:
            return False, f"Mesh '{mesh_name}' not found"
        
        mesh_dir = self.meshes_dir / mesh_name / "polyMesh"
        
        if not mesh_dir.exists():
            return False, f"Mesh directory not found"
        
        # Target polyMesh
        polymesh_dest = run_dir / "propCase" / "stator" / "constant" / "polyMesh"
        
        try:
            # Remove existing mesh
            if polymesh_dest.exists():
                shutil.rmtree(polymesh_dest)
            
            # Copy saved mesh
            shutil.copytree(mesh_dir, polymesh_dest)
            
            return True, f"Mesh loaded: {mesh_name}"
            
        except Exception as e:
            return False, str(e)
    
    def list_meshes(self) -> List[Dict]:
        """List all saved meshes."""
        meshes = []
        
        for mesh_name, meta in self.meshes_metadata.items():
            mesh_dir = self.meshes_dir / mesh_name
            
            mesh_info = {
                **meta,
                "exists": mesh_dir.exists()
            }
            
            meshes.append(mesh_info)
        
        # Sort by creation time, newest first
        meshes.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        
        return meshes
    
    def delete_mesh(self, mesh_name: str) -> Tuple[bool, str]:
        """Delete a saved mesh."""
        
        mesh_dir = self.meshes_dir / mesh_name
        
        try:
            if mesh_dir.exists():
                shutil.rmtree(mesh_dir)
            
            if mesh_name in self.meshes_metadata:
                del self.meshes_metadata[mesh_name]
                self._save_metadata()
            
            return True, f"Mesh deleted: {mesh_name}"
            
        except Exception as e:
            return False, str(e)
    
    def get_mesh_info(self, mesh_name: str) -> Optional[Dict]:
        """Get information about a saved mesh."""
        return self.meshes_metadata.get(mesh_name)
