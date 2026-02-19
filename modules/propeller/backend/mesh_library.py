#!/usr/bin/env python3
"""
Unified Mesh Library Manager

Manages all mesh operations:
- Import UNV files to library
- Create PolyMesh from UNV files
- Track mesh metadata (faces, patches, boundary mappings)
- Provide meshes for run creation
"""

import json
import shutil
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Union
import uuid


class MeshLibrary:
    """Unified mesh library manager."""
    
    def __init__(self, library_dir: Path):
        self.library_dir = library_dir
        self.library_dir.mkdir(exist_ok=True)
        self.metadata_file = library_dir / "library.json"
        self._load_metadata()
    
    def _load_metadata(self):
        """Load library metadata from JSON file."""
        if self.metadata_file.exists():
            try:
                with open(self.metadata_file, 'r') as f:
                    self.metadata = json.load(f)
            except:
                self.metadata = {"meshes": {}}
        else:
            self.metadata = {"meshes": {}}
            self._save_metadata()
    
    def _save_metadata(self):
        """Save library metadata to JSON file."""
        with open(self.metadata_file, 'w') as f:
            json.dump(self.metadata, f, indent=2, default=str)
    
    # ==================== Mesh Import ====================
    
    def add_mesh(self, name: str, rotor_paths: Union[Path, List[Path]], stator_path: Path, 
                 project: str = "default", polymesh_source_path: Path = None) -> str:
        """
        Add a mesh set to the library, optionally with pre-created polyMesh.
        
        Args:
            name: Human-readable name for the mesh
            rotor_paths: Path(s) to rotor UNV file(s). Single Path or list.
            stator_path: Path to stator UNV file
            project: Optional project name for organization
            polymesh_source_path: Optional path to existing polyMesh directory to copy
            
        Returns:
            Mesh ID
        """
        # Normalize to list
        if isinstance(rotor_paths, Path):
            rotor_paths = [rotor_paths]
        
        rotor_count = len(rotor_paths)
        
        mesh_id = f"mesh_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        mesh_dir = self.library_dir / mesh_id
        mesh_dir.mkdir(exist_ok=True)
        
        # Copy stator UNV
        stator_dest = mesh_dir / "stator.unv"
        shutil.copy2(stator_path, stator_dest)
        
        # Copy rotor UNV files (rotor_1.unv, rotor_2.unv, ...)
        rotor_dests = []
        rotor_sizes = []
        for i, rpath in enumerate(rotor_paths, start=1):
            rdest = mesh_dir / f"rotor_{i}.unv"
            shutil.copy2(rpath, rdest)
            rotor_dests.append(str(rdest))
            rotor_sizes.append(rdest.stat().st_size)
        
        # Copy polyMesh directory if provided
        polymesh_dest = None
        has_polymesh = False
        if polymesh_source_path and polymesh_source_path.exists():
            polymesh_dest = mesh_dir / "polyMesh"
            shutil.copytree(polymesh_source_path, polymesh_dest)
            has_polymesh = True
        
        # Store metadata
        self.metadata["meshes"][mesh_id] = {
            "name": name,
            "project": project,
            "created": datetime.now().isoformat(),
            "rotor_count": rotor_count,
            "source_files": {
                "rotors": rotor_dests,
                "rotor": rotor_dests[0] if rotor_dests else None,  # backwards compat
                "stator": str(stator_dest)
            },
            "rotor_sizes": rotor_sizes,
            "stator_size": stator_dest.stat().st_size,
            # PolyMesh info
            "polymesh_path": str(polymesh_dest) if polymesh_dest else None,
            "has_polymesh": has_polymesh,
            "status": "ready" if has_polymesh else "imported",
            "faces": 0,
            "patches": [],
            "boundary_mapping": {}
        }
        self._save_metadata()
        
        return mesh_id
    
    # ==================== PolyMesh Creation ====================
    
    def update_polymesh_info(self, mesh_id: str, polymesh_path: Path, 
                             faces: int = 0, patches: List[Dict] = None) -> bool:
        """
        Update mesh with PolyMesh information after creation.
        
        Args:
            mesh_id: Mesh ID
            polymesh_path: Path to the polyMesh directory
            faces: Total face count
            patches: List of patch info dicts
        """
        if mesh_id not in self.metadata["meshes"]:
            return False
        
        self.metadata["meshes"][mesh_id]["polymesh_path"] = str(polymesh_path)
        self.metadata["meshes"][mesh_id]["status"] = "ready"
        self.metadata["meshes"][mesh_id]["faces"] = faces
        self.metadata["meshes"][mesh_id]["patches"] = patches or []
        self._save_metadata()
        return True
    
    def get_polymesh_path(self, mesh_id: str) -> Optional[Path]:
        """Get the polyMesh path for a mesh."""
        if mesh_id not in self.metadata["meshes"]:
            return None
        path_str = self.metadata["meshes"][mesh_id].get("polymesh_path")
        return Path(path_str) if path_str else None
    
    # ==================== Boundary Mapping ====================
    
    def update_boundary_mapping(self, mesh_id: str, mapping: Dict) -> bool:
        """
        Update boundary mapping configuration for a mesh.
        
        Args:
            mesh_id: Mesh ID
            mapping: Dict of boundary assignments
        """
        if mesh_id not in self.metadata["meshes"]:
            return False
        
        self.metadata["meshes"][mesh_id]["boundary_mapping"] = mapping
        self._save_metadata()
        return True
    
    def get_boundary_mapping(self, mesh_id: str) -> Dict:
        """Get boundary mapping for a mesh."""
        if mesh_id not in self.metadata["meshes"]:
            return {}
        return self.metadata["meshes"][mesh_id].get("boundary_mapping", {})
    
    # ==================== Mesh Queries ====================
    
    def list_meshes(self, project: str = None, status: str = None) -> List[Dict]:
        """List all meshes, optionally filtered."""
        meshes = []
        for mesh_id, info in self.metadata["meshes"].items():
            if project and info.get("project") != project:
                continue
            if status and info.get("status") != status:
                continue
            meshes.append({
                "id": mesh_id,
                **info,
                "has_default_mapping": bool(info.get("boundary_mapping"))
            })
        # Sort by created date, newest first
        meshes.sort(key=lambda x: x.get("created", ""), reverse=True)
        return meshes
    
    def list_ready_meshes(self) -> List[Dict]:
        """List only meshes with PolyMesh ready."""
        return self.list_meshes(status="ready")
    
    def get_mesh(self, mesh_id: str) -> Optional[Dict]:
        """Get mesh info by ID."""
        if mesh_id in self.metadata["meshes"]:
            return {
                "id": mesh_id,
                **self.metadata["meshes"][mesh_id]
            }
        return None
    
    def delete_mesh(self, mesh_id: str) -> bool:
        """Delete a mesh from the library."""
        if mesh_id not in self.metadata["meshes"]:
            return False
        
        # Delete files
        mesh_dir = self.library_dir / mesh_id
        if mesh_dir.exists():
            shutil.rmtree(mesh_dir)
        
        # Remove from metadata
        del self.metadata["meshes"][mesh_id]
        self._save_metadata()
        return True
    
    def get_mesh_files(self, mesh_id: str) -> Optional[Dict]:
        """Get paths to mesh UNV files. Returns rotors list + legacy rotor key."""
        if mesh_id not in self.metadata["meshes"]:
            return None
        
        mesh_dir = self.library_dir / mesh_id
        mesh_info = self.metadata["meshes"][mesh_id]
        rotor_count = mesh_info.get("rotor_count", 1)
        
        # Build list of rotor paths
        rotor_paths = []
        for i in range(1, rotor_count + 1):
            rpath = mesh_dir / f"rotor_{i}.unv"
            if rpath.exists():
                rotor_paths.append(rpath)
        
        # Backwards compat: check for legacy single rotor.unv
        if not rotor_paths:
            legacy_path = mesh_dir / "rotor.unv"
            if legacy_path.exists():
                rotor_paths.append(legacy_path)
        
        return {
            "rotors": rotor_paths,
            "rotor": rotor_paths[0] if rotor_paths else None,  # backwards compat
            "stator": mesh_dir / "stator.unv"
        }
    
    # ==================== Utility ====================
    
    def get_projects(self) -> List[str]:
        """Get list of all projects."""
        projects = set()
        for info in self.metadata["meshes"].values():
            projects.add(info.get("project", "default"))
        return sorted(list(projects))
    
    def mesh_exists(self, mesh_id: str) -> bool:
        """Check if a mesh exists."""
        return mesh_id in self.metadata["meshes"]
    
    def get_patches_from_boundary_file(self, boundary_file: Path) -> Tuple[int, List[Dict]]:
        """
        Extract patch information from OpenFOAM boundary file.
        
        Returns:
            Tuple of (total_faces, list of patch dicts)
        """
        patches = []
        total_faces = 0
        
        if not boundary_file.exists():
            return 0, []
        
        try:
            import re
            with open(boundary_file, 'r') as f:
                content = f.read()
            
            pattern = r'(\w+)\s*\{\s*type\s+(\w+);[^}]*nFaces\s+(\d+);[^}]*\}'
            matches = re.findall(pattern, content, re.DOTALL)
            
            for name, ptype, nfaces in matches:
                nfaces_int = int(nfaces)
                total_faces += nfaces_int
                patches.append({
                    'name': name,
                    'type': ptype,
                    'nFaces': nfaces_int
                })
        except Exception as e:
            print(f"Error parsing boundary file: {e}")
        
        return total_faces, patches
