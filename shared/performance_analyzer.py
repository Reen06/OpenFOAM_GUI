"""
OpenFOAM Performance Analyzer
Shared module for extracting and calculating performance metrics from OpenFOAM simulations.
"""

import os
import re
import math
import json
import csv
import difflib
from pathlib import Path
from typing import List, Dict, Tuple, Optional, Any, Union

class PerformanceAnalyzer:
    """
    Analyzes OpenFOAM simulation results to extract performance metrics.
    Handles patch detection, force log parsing, and metric calculation.
    """
    
    def __init__(self):
        pass
        
    # =========================================================================
    # Patch Detection
    # =========================================================================
    
    def detect_patches(self, 
                      boundary_file: Path, 
                      candidate_keys: List[str], 
                      min_confidence: float = 0.6) -> List[Dict[str, Any]]:
        """
        Detect geometry patches from boundary file using fuzzy matching.
        
        Args:
            boundary_file: Path to polyMesh/boundary file
            candidate_keys: List of preferred names (e.g. ['model', 'wing'])
            min_confidence: Minimum similarity score (0.0 to 1.0)
            
        Returns:
            List of detected patches with metadata
        """
        if not boundary_file.exists():
            return []
            
        patches = []
        try:
            content = boundary_file.read_text()
            
            # Regex to find patch definitions
            # matches: patchName { type typeName; ... }
            pattern = r'(\w+)\s*\{\s*type\s+(\w+);'
            file_matches = re.findall(pattern, content)
            
            found_patches = []
            for name, ptype in file_matches:
                # Filter useful patch types (walls)
                is_wall = any(t in ptype for t in ['wall', 'mappedWall'])
                
                # Check against candidates
                match_score = 0.0
                match_reason = "none"
                
                # 1. Exact match
                if name in candidate_keys:
                    match_score = 1.0
                    match_reason = "exact"
                
                # 2. Substring match (e.g. "car_body" matches "body")
                elif any(k in name.lower() for k in candidate_keys):
                    match_score = 0.9
                    match_reason = "substring"
                
                # 3. Fuzzy match
                else:
                    matches = difflib.get_close_matches(name, candidate_keys, n=1, cutoff=min_confidence)
                    if matches:
                        match_score = difflib.SequenceMatcher(None, name, matches[0]).ratio()
                        match_reason = "fuzzy"
                
                # Auto-exclude known non-geometry patches if not explicitly asked for
                if match_score < 0.5:
                    if any(x in name.lower() for x in ['inlet', 'outlet', 'ground', 'top', 'bottom', 'side']):
                        continue
                
                if match_score >= min_confidence and is_wall:
                    found_patches.append({
                        "name": name,
                        "type": ptype,
                        "score": match_score,
                        "reason": match_reason
                    })
                    
            # Sort by score descending
            found_patches.sort(key=lambda x: x['score'], reverse=True)
            return found_patches
            
        except Exception as e:
            print(f"Error detecting patches: {e}")
            return []
    
    # =========================================================================
    # Reference Value Calculation from Mesh
    # =========================================================================
    
    def calculate_ref_values(self, case_dir: Path, patch_names: List[str], 
                              flow_direction: List[float] = [1, 0, 0],
                              up_direction: str = "z-up") -> Dict[str, Any]:
        """
        Calculate reference area and length from polyMesh data.
        
        Reads the mesh, extracts faces belonging to the specified patches,
        projects them perpendicular to the flow direction, and computes
        the projected (frontal) area and reference length.
        
        Args:
            case_dir: Path to the OpenFOAM case directory
            patch_names: List of patch names to analyze (e.g. ['model'])
            flow_direction: Inlet velocity direction [vx, vy, vz]
            up_direction: 'z-up' or 'y-up'
            
        Returns:
            Dict with ref_area, ref_length, bbox, and method details
        """
        import numpy as np
        
        poly_mesh_dir = case_dir / "constant" / "polyMesh"
        
        try:
            # 1. Parse boundary to get patch start face and nFaces
            boundary_file = poly_mesh_dir / "boundary"
            patch_info = self._parse_boundary_for_faces(boundary_file, patch_names)
            if not patch_info:
                return {"error": f"Could not find patches {patch_names} in boundary file"}
            
            # 2. Parse points
            points = self._parse_points(poly_mesh_dir / "points")
            if points is None:
                return {"error": "Could not parse points file"}
            
            # 3. Parse faces
            faces = self._parse_faces(poly_mesh_dir / "faces")
            if faces is None:
                return {"error": "Could not parse faces file"}
            
            # 4. Collect all vertex indices belonging to the model patches
            vertex_indices = set()
            face_vertex_groups = []  # For area calculation per face
            
            for pinfo in patch_info:
                start_face = pinfo['startFace']
                n_faces = pinfo['nFaces']
                for fi in range(start_face, start_face + n_faces):
                    if fi < len(faces):
                        face_verts = faces[fi]
                        vertex_indices.update(face_verts)
                        face_vertex_groups.append(face_verts)
            
            if not vertex_indices:
                return {"error": "No vertices found for specified patches"}
            
            # 5. Get the 3D coordinates
            model_points = points[list(vertex_indices)]
            
            # 6. Normalize flow direction
            flow = np.array(flow_direction, dtype=float)
            flow_mag = np.linalg.norm(flow)
            if flow_mag == 0:
                flow = np.array([1.0, 0.0, 0.0])
            else:
                flow = flow / flow_mag
            
            # 7. Reference length = extent of model along flow direction
            projections_flow = model_points @ flow
            ref_length = float(projections_flow.max() - projections_flow.min())
            
            # 8. Compute bounding box
            bbox_min = model_points.min(axis=0).tolist()
            bbox_max = model_points.max(axis=0).tolist()
            
            # 9. Project points onto plane perpendicular to flow direction
            # Create orthonormal basis for the projection plane
            if up_direction == "y-up":
                up = np.array([0.0, 1.0, 0.0])
            else:
                up = np.array([0.0, 0.0, 1.0])
            
            # If flow is parallel to up, pick a different up
            if abs(np.dot(flow, up)) > 0.95:
                up = np.array([0.0, 1.0, 0.0]) if up_direction == "z-up" else np.array([0.0, 0.0, 1.0])
            
            # Gram-Schmidt to get two orthonormal vectors perpendicular to flow
            v1 = up - np.dot(up, flow) * flow
            v1 = v1 / np.linalg.norm(v1)
            v2 = np.cross(flow, v1)
            v2 = v2 / np.linalg.norm(v2)
            
            # Project all model points onto the 2D plane
            proj_2d = np.column_stack([model_points @ v1, model_points @ v2])
            
            # 10. Compute projected area
            # Try ConvexHull first (fast, good for convex-ish shapes)
            # Then rasterize for a more accurate concave estimate
            try:
                from scipy.spatial import ConvexHull
                hull = ConvexHull(proj_2d)
                convex_area = float(hull.volume)  # In 2D, 'volume' = area
            except Exception:
                convex_area = None
            
            # Rasterize for concave shapes — project each face triangle
            raster_area = self._rasterize_projected_area(
                points, face_vertex_groups, v1, v2, resolution=200
            )
            
            # Use the smaller of convex hull and raster (raster handles concavities)
            if convex_area is not None and raster_area is not None:
                ref_area = min(convex_area, raster_area)
                method = "raster" if raster_area < convex_area else "convex_hull"
            elif raster_area is not None:
                ref_area = raster_area
                method = "raster"
            elif convex_area is not None:
                ref_area = convex_area
                method = "convex_hull"
            else:
                # Fallback: bounding box area perpendicular to flow
                bbox_extents = np.array(bbox_max) - np.array(bbox_min)
                # Project bbox extents onto the two perpendicular axes
                e1 = abs(float(bbox_extents @ v1))
                e2 = abs(float(bbox_extents @ v2))
                ref_area = e1 * e2
                method = "bounding_box"
            
            return {
                "ref_area": round(ref_area, 6),
                "ref_length": round(ref_length, 6),
                "method": method,
                "convex_hull_area": round(convex_area, 6) if convex_area else None,
                "raster_area": round(raster_area, 6) if raster_area else None,
                "bbox_min": [round(v, 6) for v in bbox_min],
                "bbox_max": [round(v, 6) for v in bbox_max],
                "num_faces": len(face_vertex_groups),
                "num_vertices": len(vertex_indices),
                "patches_used": [p['name'] for p in patch_info]
            }
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            return {"error": str(e)}
    
    def _parse_boundary_for_faces(self, boundary_file: Path, 
                                   patch_names: List[str]) -> List[Dict]:
        """Parse boundary file to get startFace and nFaces for specified patches."""
        if not boundary_file.exists():
            return []
        
        content = boundary_file.read_text()
        results = []
        
        for patch_name in patch_names:
            # Find the patch block
            pattern = rf'{re.escape(patch_name)}\s*\{{([^}}]*)\}}'
            match = re.search(pattern, content)
            if match:
                block = match.group(1)
                n_faces_match = re.search(r'nFaces\s+(\d+)', block)
                start_face_match = re.search(r'startFace\s+(\d+)', block)
                if n_faces_match and start_face_match:
                    results.append({
                        'name': patch_name,
                        'nFaces': int(n_faces_match.group(1)),
                        'startFace': int(start_face_match.group(1))
                    })
        
        return results
    
    def _parse_points(self, points_file: Path):
        """Parse OpenFOAM points file into numpy array."""
        import numpy as np
        
        if not points_file.exists():
            return None
        
        content = points_file.read_text()
        
        # Find the start of the point list (after the count and opening paren)
        # Format: N\n(\n(x y z)\n(x y z)\n...\n)
        match = re.search(r'(\d+)\s*\n\s*\(', content)
        if not match:
            return None
        
        n_points = int(match.group(1))
        start = match.end()
        
        # Extract all point tuples
        point_pattern = re.compile(r'\(\s*([eE\d.+-]+)\s+([eE\d.+-]+)\s+([eE\d.+-]+)\s*\)')
        points = []
        for m in point_pattern.finditer(content, start):
            points.append([float(m.group(1)), float(m.group(2)), float(m.group(3))])
            if len(points) >= n_points:
                break
        
        return np.array(points)
    
    def _parse_faces(self, faces_file: Path):
        """Parse OpenFOAM faces file into list of vertex index lists."""
        if not faces_file.exists():
            return None
        
        content = faces_file.read_text()
        
        # Find list count and start
        match = re.search(r'(\d+)\s*\n\s*\(', content)
        if not match:
            return None
        
        n_faces = int(match.group(1))
        start = match.end()
        
        # Face format: N(v0 v1 v2 ... vN-1)
        face_pattern = re.compile(r'(\d+)\(([^)]+)\)')
        faces = []
        for m in face_pattern.finditer(content, start):
            verts = [int(v) for v in m.group(2).split()]
            faces.append(verts)
            if len(faces) >= n_faces:
                break
        
        return faces
    
    def _rasterize_projected_area(self, points, face_vertex_groups, 
                                    v1, v2, resolution=200):
        """
        Compute projected area by rasterizing face projections onto a 2D grid.
        Handles concave shapes correctly (unlike convex hull).
        """
        import numpy as np
        
        try:
            # Collect all face vertices and project
            all_proj = []
            for face_verts in face_vertex_groups:
                face_pts = points[face_verts]
                proj = np.column_stack([face_pts @ v1, face_pts @ v2])
                all_proj.append(proj)
            
            # Get bounding box of all projected points
            all_pts = np.vstack(all_proj)
            min_u, min_v = all_pts.min(axis=0)
            max_u, max_v = all_pts.max(axis=0)
            
            # Add small margin
            margin = max((max_u - min_u), (max_v - min_v)) * 0.01
            min_u -= margin
            min_v -= margin
            max_u += margin
            max_v += margin
            
            range_u = max_u - min_u
            range_v = max_v - min_v
            
            if range_u <= 0 or range_v <= 0:
                return None
            
            # Scale resolution based on aspect ratio
            if range_u > range_v:
                res_u = resolution
                res_v = max(1, int(resolution * range_v / range_u))
            else:
                res_v = resolution
                res_u = max(1, int(resolution * range_u / range_v))
            
            # Create raster grid
            grid = np.zeros((res_v, res_u), dtype=bool)
            
            cell_area = (range_u / res_u) * (range_v / res_v)
            
            # For each face, fill the raster cells that its projection covers
            for proj in all_proj:
                # Convert to grid coordinates
                gu = ((proj[:, 0] - min_u) / range_u * (res_u - 1)).astype(int)
                gv = ((proj[:, 1] - min_v) / range_v * (res_v - 1)).astype(int)
                
                gu = np.clip(gu, 0, res_u - 1)
                gv = np.clip(gv, 0, res_v - 1)
                
                # Fill the polygon in the raster using scanline
                # For simplicity, just fill the bounding box of each face
                # and mark all cells within
                u_min, u_max = gu.min(), gu.max()
                v_min, v_max = gv.min(), gv.max()
                grid[v_min:v_max+1, u_min:u_max+1] = True
            
            filled_cells = np.sum(grid)
            return float(filled_cells * cell_area)
            
        except Exception as e:
            print(f"Rasterize error: {e}")
            return None

    # =========================================================================
    # File Parsing
    # =========================================================================
    
    def parse_forces_file(self, forces_dir: Path) -> Dict[str, List[float]]:
        """
        Parse OpenFOAM forces functionObject output.
        Looks for postProcessing/forces/<start_time>/force.dat
        
        Standard OpenFOAM forces output columns (1-based index in file, 0-based in array):
        0: Time
        1-3: Total Force (Fx, Fy, Fz)
        4-6: Pressure Force
        7-9: Viscous Force
        10-12: Total Moment
        13-15: Pressure Moment
        16-18: Viscous Moment
        
        Returns:
            Dict containing lists of values: 'time', 'fx', 'fy', 'fz', 'mx', 'my', 'mz'
        """
        # Find the latest time directory
        if not forces_dir.exists():
            return {}
        
        try:
            contents = list(forces_dir.iterdir())
        except Exception as e:
            return {}
            
        time_dirs = sorted([d for d in forces_dir.iterdir() if d.is_dir()], 
                         key=lambda x: float(x.name) if x.name.replace('.','',1).isdigit() else -1)
        
        if not time_dirs:
            return {}
            
        # Use latest time directory (usually 0 or startTime)
        # Note: OpenFOAM sometimes writes multiple directories if run restarts
        # For simplicity, we'll concatenate all found force.dat files in time order
        
        data = {
            'time': [],
            'fx': [], 'fy': [], 'fz': [],
            'mx': [], 'my': [], 'mz': [],
            'fx_p': [], 'fy_p': [], 'fz_p': [], # Pressure
            'fx_v': [], 'fy_v': [], 'fz_v': [], # Viscous
        }
        
        for t_dir in time_dirs:
            force_file = t_dir / "force.dat"
            if not force_file.exists():
                force_file = t_dir / "forces.dat" # Sometimes named forces.dat
                
            if force_file.exists():
                try:
                    with open(force_file, 'r') as f:
                        for line in f:
                            if line.startswith('#'):
                                continue
                                
                            # Remove parentheses and split
                            # Formats can be: 
                            # 1.0 (0.1 0.2 0.3) (...)
                            # or just tab separated columns
                            
                            clean_line = line.replace('(', ' ').replace(')', ' ')
                            parts = clean_line.split()
                            
                            # OpenFOAM force.dat format varies:
                            # Older: Time + Total(3) + Pressure(3) + Viscous(3) = 10 columns
                            # Moments are often in separate moment.dat file
                            if len(parts) >= 4:  # Minimum: Time + Total Force (3 components)
                                t = float(parts[0])
                                
                                # Skip if time goes backward (restart overlap)
                                if data['time'] and t <= data['time'][-1]:
                                    continue
                                    
                                data['time'].append(t)
                                
                                # Total Forces
                                data['fx'].append(float(parts[1]))
                                data['fy'].append(float(parts[2]))
                                data['fz'].append(float(parts[3]))
                                
                                # Pressure Forces (if available)
                                if len(parts) >= 7:
                                    data['fx_p'].append(float(parts[4]))
                                    data['fy_p'].append(float(parts[5]))
                                    data['fz_p'].append(float(parts[6]))
                                    
                                # Viscous Forces (if available)
                                if len(parts) >= 10:
                                    data['fx_v'].append(float(parts[7]))
                                    data['fy_v'].append(float(parts[8]))
                                    data['fz_v'].append(float(parts[9]))
                                    
                                # Moments if in same file (older formats)
                                if len(parts) >= 13:
                                    data['mx'].append(float(parts[10]))
                                    data['my'].append(float(parts[11]))
                                    data['mz'].append(float(parts[12]))
                                    
                except Exception as e:
                    print(f"Error parsing {force_file}: {e}")
        
        # Also parse separate moment.dat file if it exists (newer OpenFOAM format)
        if not data['mx']:  # Only if moments weren't found in force.dat
            for t_dir in time_dirs:
                moment_file = t_dir / "moment.dat"
                if moment_file.exists():
                    try:
                        with open(moment_file, 'r') as f:
                            for line in f:
                                if line.startswith('#'):
                                    continue
                                    
                                clean_line = line.replace('(', ' ').replace(')', ' ')
                                parts = clean_line.split()
                                
                                if len(parts) >= 4:  # Time + Total Moment (3 components)
                                    t = float(parts[0])
                                    
                                    # Match moment to force time (should align)
                                    data['mx'].append(float(parts[1]))
                                    data['my'].append(float(parts[2]))
                                    data['mz'].append(float(parts[3]))
                                    
                    except Exception as e:
                        print(f"Error parsing {moment_file}: {e}")
                    
        return data

    def parse_coeffs_file(self, coeffs_dir: Path) -> Dict[str, List[float]]:
        """
        Parse OpenFOAM forceCoeffs output.
        postProcessing/forceCoeffs/<start_time>/coefficient.dat
        
        Standard columns:
        Time, Cd, Cs, Cl, CmRoll, CmPitch, CmYaw, Cd(f), Cd(r)
        
        Returns:
            Dict with 'time', 'cd', 'cl', 'cm', etc.
        """
        if not coeffs_dir.exists():
            return {}
            
        time_dirs = sorted([d for d in coeffs_dir.iterdir() if d.is_dir()], 
                         key=lambda x: float(x.name) if x.name.replace('.','',1).isdigit() else -1)
        
        if not time_dirs:
            return {}
            
        data = {
            'time': [],
            'cd': [], 'cl': [], 'cm': [], # standard
            'cs': [], # side force
        }
        
        for t_dir in time_dirs:
            coeff_file = t_dir / "coefficient.dat" # varies by OpenFOAM version? sometimes forceCoeffs.dat
            if not coeff_file.exists():
                # Try finding any .dat file in the directory
                dats = list(t_dir.glob("*.dat"))
                if dats:
                    coeff_file = dats[0]
                else:
                    continue
            
            try:
                with open(coeff_file, 'r') as f:
                    for line in f:
                        if line.startswith('#'):
                            continue
                            
                        parts = line.split()
                        if len(parts) >= 4:
                            t = float(parts[0])
                            
                            if data['time'] and t <= data['time'][-1]:
                                continue
                                
                            data['time'].append(t)
                            data['cd'].append(float(parts[1]))
                            data['cs'].append(float(parts[2]))
                            data['cl'].append(float(parts[3]))
                            
                            # Cm depends on config, usually Pitch moment is relevant for airfoils
                            # Columns: Time Cd Cs Cl CmRoll CmPitch CmYaw
                            if len(parts) >= 6:
                                data['cm'].append(float(parts[5])) # Assuming Pitch
                                
            except Exception as e:
                print(f"Error parsing {coeff_file}: {e}")
                
        return data

    # =========================================================================
    # Averaging & Processing
    # =========================================================================
    
    def get_averaged_value(self, values: List[float], start_idx: int = 0) -> float:
        """Compute average of values from start_idx to end."""
        if not values or start_idx >= len(values):
            return 0.0
            
        subset = values[start_idx:]
        return sum(subset) / len(subset)
    
    def process_series_data(self, 
                           data: Dict[str, List[float]], 
                           config: Dict[str, Any]) -> Dict[str, float]:
        """
        Process time series data to get final/averaged values.
        
        Config keys:
        - average (bool): If True, average values; if False, use latest value
        - exclude_fraction (float): Fraction of initial time to exclude for averaging
        - use_time_window (bool): If True, use time_start/time_end
        - time_start (float): Start time for windowed analysis
        - time_end (float): End time for windowed analysis
        """
        if not data or not data.get('time'):
            return {}
        
        times = data['time']
        n = len(times)
        
        # Determine indices based on mode
        if config.get('use_time_window', False):
            # Time window mode - find indices for time range
            t_start = config.get('time_start', times[0])
            t_end = config.get('time_end', times[-1])
            
            # Find start index
            start_idx = 0
            for i, t in enumerate(times):
                if t >= t_start:
                    start_idx = i
                    break
            
            # Find end index
            end_idx = n - 1
            for i in range(n - 1, -1, -1):
                if times[i] <= t_end:
                    end_idx = i
                    break
            
            # Ensure valid range
            if start_idx > end_idx:
                start_idx = end_idx
                
        elif not config.get('average', True):
            # Latest value mode
            start_idx = n - 1
            end_idx = n - 1
        else:
            # Average mode with exclude fraction
            exclude_fraction = config.get('exclude_fraction', 0.2)
            start_idx = int(n * exclude_fraction)
            end_idx = n - 1
        
        result = {}
        result['t_start'] = times[start_idx]
        result['t_end'] = times[end_idx]
        
        for key, values in data.items():
            if key == 'time':
                continue
            
            if not values:
                result[key] = 0.0
                continue
                
            if start_idx == end_idx:
                # Single value
                result[key] = values[end_idx] if end_idx < len(values) else 0.0
            else:
                # Average over range
                subset = values[start_idx:end_idx + 1]
                result[key] = sum(subset) / len(subset) if subset else 0.0
                
        result['iterations_analyzed'] = end_idx - start_idx + 1
        return result


    # =========================================================================
    # Metric Calculations
    # =========================================================================
    
    def analyze_windtunnel(self, 
                          case_dir: Path, 
                          config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyze wind tunnel case forces.
        """
        # Try both 'forces' and 'forces1' directory names (functionObject naming varies)
        forces_dir = case_dir / "postProcessing" / "forces"
        if not forces_dir.exists():
            forces_dir = case_dir / "postProcessing" / "forces1"
        
        coeffs_dir = case_dir / "postProcessing" / "forceCoeffs"
        if not coeffs_dir.exists():
            coeffs_dir = case_dir / "postProcessing" / "forceCoeffs1"
        
        # Parse data
        forces_data = self.parse_forces_file(forces_dir)
        coeffs_data = self.parse_coeffs_file(coeffs_dir)
        
        summary = {
            "case_type": "wind_tunnel",
            "timestamp": "now", # fill in caller
            "metrics": {},
            "raw_files": []
        }
        
        if not forces_data or not forces_data.get('time'):
            summary["error"] = "No force data found"
            return summary
            
        # Process forces
        avg_forces = self.process_series_data(forces_data, config)
        
        # Calculate derived L/D if coeffs not available
        # Need projection axes from config
        drag_axis = config.get('drag_axis', [1, 0, 0])
        lift_axis = config.get('lift_axis', [0, 0, 1]) # Z-up default
        
        # Project forces
        fx, fy, fz = avg_forces.get('fx', 0), avg_forces.get('fy', 0), avg_forces.get('fz', 0)
        
        drag = (fx * drag_axis[0]) + (fy * drag_axis[1]) + (fz * drag_axis[2])
        lift = (fx * lift_axis[0]) + (fy * lift_axis[1]) + (fz * lift_axis[2])
        
        summary["metrics"] = {
            "drag_force": drag,
            "lift_force": lift,
            "fx": fx, "fy": fy, "fz": fz,
            "mx": avg_forces.get('mx', 0),
            "my": avg_forces.get('my', 0),
            "mz": avg_forces.get('mz', 0)
        }
        
        # Process coefficients if available
        if coeffs_data:
            avg_coeffs = self.process_series_data(coeffs_data, config)
            summary["metrics"].update({
                "cl": avg_coeffs.get('cl', 0),
                "cd": avg_coeffs.get('cd', 0),
                "cm": avg_coeffs.get('cm', 0),
                "l_d_ratio": avg_coeffs.get('cl', 0) / avg_coeffs.get('cd', 1e-6) if avg_coeffs.get('cd', 0) != 0 else 0
            })
            
        # ALWAYS calculate coefficients manually using current config's ref values
        rho = config.get('rho', 1.225)
        u_inf = config.get('u_inf', 10.0)
        a_ref = config.get('a_ref', 1.0)
        
        q = 0.5 * rho * (u_inf ** 2)
        if q > 0 and a_ref > 0:
            cd_calc = drag / (q * a_ref)
            cl_calc = lift / (q * a_ref)
            summary["metrics"].update({
                "cl_calc": cl_calc,
                "cd_calc": cd_calc,
                # Override the base cd/cl using the fresh calculations
                "cl": cl_calc,
                "cd": cd_calc,
                "l_d_ratio": cl_calc / cd_calc if cd_calc != 0 else 0
            })
                
        return summary

    def analyze_propeller(self, 
                         case_dir: Path, 
                         config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyze propeller case forces (Thrust, Torque, Efficiency).
        """
        # Propeller forces usually in stator or separate dir depend on case structure
        # Standard: run_dir/propCase/stator/postProcessing/forces
        # Or just: run_dir/postProcessing/forces if simple
        # Also check forces1 (functionObject naming varies)
        
        forces_dir = case_dir / "postProcessing" / "forces"
        if not forces_dir.exists():
            forces_dir = case_dir / "postProcessing" / "forces1"
        if not forces_dir.exists() and (case_dir / "stator").exists():
            forces_dir = case_dir / "stator" / "postProcessing" / "forces"
            if not forces_dir.exists():
                forces_dir = case_dir / "stator" / "postProcessing" / "forces1"
             
        forces_data = self.parse_forces_file(forces_dir)
        
        summary = {
            "case_type": "propeller",
            "metrics": {},
            "raw_files": []
        }
        
        if not forces_data:
            summary["error"] = "No force data found"
            return summary
            
        avg_forces = self.process_series_data(forces_data, config)
        
        # Thrust and Torque axes
        # Assuming axis along X by default
        thrust_axis = config.get('thrust_axis', [1, 0, 0])
        
        fx, fy, fz = avg_forces.get('fx', 0), avg_forces.get('fy', 0), avg_forces.get('fz', 0)
        mx, my, mz = avg_forces.get('mx', 0), avg_forces.get('my', 0), avg_forces.get('mz', 0)
        
        # Thrust is usually negative of force on fluid, but here we measure force ON blade
        # OpenFOAM forces function 'forces' calculates force on patch from fluid.
        # Force on blade = Pressure + Viscous integrated.
        # If flow goes +X, blade pushes fluid +X (Thrust), fluid pushes blade -X.
        # So Force on Blade in X is negative of Thrust.
        # BUT double check OpenFOAM convention. Typically we want Thrust as positive scalar.
        # We will project and then take magnitude or sign appropriately.
        # For now: Raw projection.
        
        raw_thrust_proj = (fx * thrust_axis[0]) + (fy * thrust_axis[1]) + (fz * thrust_axis[2])
        # Torque is Moment about axis
        torque = (mx * thrust_axis[0]) + (my * thrust_axis[1]) + (mz * thrust_axis[2])
        
        # Invert thrust if it's negative (commonly force on blade is against drag/thrust direction)
        # We'll store both raw and absolute/convention-corrected if we knew convention.
        # Let's assume user wants 'Thrust' as generated thrust. FLUID pushes blade -X.
        # So raw force is negative.
        # Let's just report the force ON PROP for now, and handle sign in UI or config.
        
        summary["metrics"] = {
            "force_x": fx, "force_y": fy, "force_z": fz,
            "moment_x": mx, "moment_y": my, "moment_z": mz,
            "torque": abs(torque), # Torque magnitude usually
            "thrust_force_on_blade": raw_thrust_proj,
            "thrust": abs(raw_thrust_proj),  # Also provide 'thrust' key directly
        }
        
        # Calculate Coefficients
        rho = config.get('rho', 1.225)
        rpm = config.get('rpm', 0) or config.get('rotation_speed', 0)
        d = config.get('diameter', 0) or config.get('prop_diameter', 0)
        v_inf = config.get('v_inf', 0) or config.get('inlet_velocity', 0)
        
        # Try to extract from velocity array if provided
        if isinstance(v_inf, list):
            v_inf = (v_inf[0]**2 + v_inf[1]**2 + v_inf[2]**2) ** 0.5
        
        n = rpm / 60.0 # rev/s
        
        if n > 0 and d > 0:
            # Ct = T / (rho * n^2 * D^4)
            # Cq = Q / (rho * n^2 * D^5)
            # Cp = P / (rho * n^3 * D^5) = 2 * pi * Cq
            
            # Use absolute thrust for coeff? Or raw?
            # Typically logic: Thrust is positive quantity doing work.
            T = abs(raw_thrust_proj) 
            Q = abs(torque)
            
            ct = T / (rho * (n**2) * (d**4))
            cq = Q / (rho * (n**2) * (d**5))
            cp = (Q * 2 * math.pi * n) / (rho * (n**3) * (d**5))
            
            power = Q * 2 * math.pi * n
            
            summary["metrics"].update({
                "thrust": T,
                "torque": Q,
                "power": power,
                "ct": ct,
                "cq": cq,
                "cp": cp,
                # Also provide kt/kq as aliases (frontend uses these names)
                "kt": ct,
                "kq": cq,
            })
            
            # Efficiency
            # eta = (T * V) / P = J * (Ct / Cp)
            if power > 0 and v_inf > 0:
                eta = (T * v_inf) / power
                summary["metrics"]["efficiency"] = eta
            else:
                summary["metrics"]["efficiency"] = 0
                
            # Advance Ratio J = V / (n * D)
            j = v_inf / (n * d) if (n * d) > 0 else 0
            summary["metrics"]["advance_ratio_j"] = j
            summary["metrics"]["advance_ratio"] = j  # Alias for frontend
        else:
            # Provide zeros with note that rpm/diameter not configured
            summary["metrics"].update({
                "thrust": abs(raw_thrust_proj),
                "kt": 0,
                "kq": 0,
                "efficiency": 0,
                "advance_ratio": 0,
                "note": "RPM or diameter not configured - coefficients not calculated"
            })
            
        return summary
    
    # =========================================================================
    # Output Generation
    # =========================================================================
    
    def save_summary(self, 
                    summary: Dict[str, Any], 
                    output_dir: Path) -> None:
        """Save summary to JSON, CSV and MD."""
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # JSON
        with open(output_dir / "postProcessingSummary.json", 'w') as f:
            json.dump(summary, f, indent=2)
            
        # CSV (flattened)
        with open(output_dir / "postProcessingSummary.csv", 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['Metric', 'Value'])
            for k, v in summary.get('metrics', {}).items():
                writer.writerow([k, v])
                
        # Markdown
        with open(output_dir / "postProcessingSummary.md", 'w') as f:
            f.write(f"# Performance Summary\n\n")
            f.write(f"**Case Type:** {summary.get('case_type')}\n")
            f.write(f"**Date:** {summary.get('timestamp')}\n\n")
            
            f.write("## Metrics\n\n")
            f.write("| Metric | Value |\n")
            f.write("| :--- | :--- |\n")
            
            metrics = summary.get('metrics', {})
            # Categorize
            main_keys = ['lift_force', 'drag_force', 'cl', 'cd', 'l_d_ratio', 
                         'thrust', 'torque', 'power', 'efficiency', 'ct', 'cp']
            
            for k in main_keys:
                if k in metrics:
                    val = metrics[k]
                    fmt = "{:.4f}" if isinstance(val, float) else "{}"
                    f.write(f"| **{k}** | {fmt.format(val)} |\n")
                    
            f.write("\n### All Details\n\n")
            f.write("| Metric | Value |\n")
            f.write("| :--- | :--- |\n")
            for k, v in sorted(metrics.items()):
                if k not in main_keys:
                    val = v
                    fmt = "{:.6f}" if isinstance(val, float) else "{}"
                    f.write(f"| {k} | {fmt.format(val)} |\n")
