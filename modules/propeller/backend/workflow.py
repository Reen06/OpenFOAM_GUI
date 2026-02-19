#!/usr/bin/env python3
"""
OpenFOAM Workflow Manager

Handles execution of OpenFOAM commands with real-time log streaming.
"""

import os
import re
import shutil
import asyncio
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Tuple, Callable, Any

# Import shared modules (path added in main.py)
try:
    from shared.performance_analyzer import PerformanceAnalyzer
    from shared.functionobject_manager import FunctionObjectManager
    from shared.mesh_introspection import introspect_mesh
except ImportError:
    # Fallback for direct execution
    import sys
    sys.path.append(str(Path(__file__).parent.parent.parent))
    from shared.performance_analyzer import PerformanceAnalyzer
    from shared.functionobject_manager import FunctionObjectManager
    from shared.mesh_introspection import introspect_mesh


class WorkflowManager:
    """Manages OpenFOAM simulation workflows."""
    
    # Expected patch names
    STATOR_PATCHES = ['statorAMI', 'outerWall', 'inlet_stator', 'outlet_stator']
    ROTOR_PATCHES = ['rotorAMI', 'inlet_rotor', 'outlet_rotor', 'propellerWalls']
    AMI_PATCHES = ['statorAMI', 'rotorAMI']
    
    # Supported solvers
    SOLVERS = ['simpleFoam', 'pimpleFoam', 'rhoSimpleFoam', 'rhoPimpleFoam']
    
    def __init__(self, openfoam_bashrc: str, job_manager, run_manager=None):
        self.openfoam_bashrc = openfoam_bashrc
        self.job_manager = job_manager
        self.run_manager = run_manager
        self.active_processes: Dict[str, subprocess.Popen] = {}
        
        # Initialize helpers
        self.analyzer = PerformanceAnalyzer()
        self.fo_manager = FunctionObjectManager()
    
    async def run_cmd_async(
        self,
        cmd: str,
        cwd: Path,
        log_file: Path,
        run_id: str,
        step_name: str,
        log_callback: Optional[Callable] = None
    ) -> Tuple[bool, str, int]:
        """Execute a command asynchronously with streaming output."""
        
        full_cmd = f'. {self.openfoam_bashrc} && {cmd}'
        
        # Write header to log file
        with open(log_file, 'w') as f:
            f.write(f"# Step: {step_name}\n")
            f.write(f"# Command: {cmd}\n")
            f.write(f"# Directory: {cwd}\n")
            f.write(f"# Started: {datetime.now().isoformat()}\n")
            f.write("=" * 60 + "\n\n")
        
        try:
            process = await asyncio.create_subprocess_shell(
                full_cmd,
                cwd=str(cwd),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                executable='/bin/bash'
            )
            
            self.active_processes[run_id] = process
            output_lines = []
            
            # Stream output
            async for line in process.stdout:
                line_str = line.decode('utf-8', errors='replace')
                output_lines.append(line_str)
                
                # Append to log file
                with open(log_file, 'a') as f:
                    f.write(line_str)
                
                # Broadcast via WebSocket
                if log_callback:
                    await log_callback(run_id, {
                        "type": "log",
                        "step": step_name,
                        "line": line_str.rstrip(),
                        "timestamp": datetime.now().isoformat()
                    })
            
            await process.wait()
            
            # Write footer
            with open(log_file, 'a') as f:
                f.write("\n" + "=" * 60 + "\n")
                f.write(f"# Return code: {process.returncode}\n")
                f.write(f"# Finished: {datetime.now().isoformat()}\n")
            
            # Remove from active processes
            if run_id in self.active_processes:
                del self.active_processes[run_id]
            
            output = ''.join(output_lines)
            return process.returncode == 0, output, process.returncode
            
        except Exception as e:
            error_msg = str(e)
            with open(log_file, 'a') as f:
                f.write(f"\n# ERROR: {error_msg}\n")
            return False, error_msg, -1
    
    def run_cmd_sync(
        self,
        cmd: str,
        cwd: Path,
        log_file: Optional[Path] = None
    ) -> Tuple[bool, str, int]:
        """Execute a command synchronously."""
        
        full_cmd = f'. {self.openfoam_bashrc} && {cmd}'
        
        try:
            result = subprocess.run(
                ['bash', '-c', full_cmd],
                cwd=str(cwd),
                capture_output=True,
                text=True
            )
            
            output = result.stdout + result.stderr
            
            if log_file:
                with open(log_file, 'w') as f:
                    f.write(output)
            
            return result.returncode == 0, output, result.returncode
            
        except Exception as e:
            return False, str(e), -1
    
    async def run_workflow(
        self,
        run_id: str,
        run_dir: Path,
        solver_settings: Dict,
        material_settings: Dict,
        inlet_velocity: Optional[List[float]],
        log_callback: Optional[Callable] = None
    ):
        """Execute the complete propeller AMI workflow."""
        
        prop_case = run_dir / "propCase"
        rotor_dir = prop_case / "rotor"
        stator_dir = prop_case / "stator"
        logs_dir = run_dir / "logs"
        logs_dir.mkdir(exist_ok=True)
        
        # Update job status
        self.job_manager.update_job(run_id, status="running", progress=0)
        
        steps = [
            ("Importing rotor mesh", self._import_rotor),
            ("Importing stator mesh", self._import_stator),
            ("Merging meshes", self._merge_meshes),
            ("Configuring AMI patches", self._set_ami_patches),
            ("Creating rotor cellZone", self._create_cell_zone),
            ("Checking mesh", self._check_mesh),
            ("Applying settings", self._apply_settings),
            ("Running solver", self._run_solver),
        ]
        
        total_steps = len(steps)
        
        for i, (step_name, step_func) in enumerate(steps):
            progress = int((i / total_steps) * 100)
            self.job_manager.update_job(run_id, status="running", progress=progress, current_step=step_name)
            
            if log_callback:
                await log_callback(run_id, {
                    "type": "progress",
                    "step": step_name,
                    "progress": progress,
                    "step_num": i + 1,
                    "total_steps": total_steps
                })
            
            try:
                success, message = await step_func(
                    run_id, run_dir, logs_dir, solver_settings, material_settings, inlet_velocity, log_callback
                )
                
                if not success:
                    self.job_manager.update_job(run_id, status="failed", error=message)
                    if log_callback:
                        await log_callback(run_id, {
                            "type": "error",
                            "step": step_name,
                            "message": message
                        })
                    return
                    
            except Exception as e:
                self.job_manager.update_job(run_id, status="failed", error=str(e))
                if log_callback:
                    await log_callback(run_id, {
                        "type": "error",
                        "step": step_name,
                        "message": str(e)
                    })
                return
        
        # Complete
        self.job_manager.update_job(run_id, status="success", progress=100)
        if log_callback:
            await log_callback(run_id, {
                "type": "complete",
                "message": "Workflow completed successfully"
            })
    
    async def create_polymesh(
        self,
        run_id: str,
        run_dir: Path,
        log_callback: Optional[Callable] = None
    ) -> Dict:
        """Create polyMesh by running ideasUnvToFoam and mergeMeshes."""
        import json as _json
        
        logs_dir = run_dir / "logs"
        logs_dir.mkdir(exist_ok=True)
        
        # Dummy settings for the step functions
        solver_settings = {}
        material_settings = {}
        inlet_velocity = None
        
        # Discover rotor directories (rotor_1/, rotor_2/, ...)
        prop_dir = run_dir / "propCase"
        rotor_dirs = sorted([
            d for d in prop_dir.iterdir()
            if d.is_dir() and d.name.startswith("rotor_") and d.name[6:].isdigit()
        ], key=lambda d: int(d.name.split("_")[1]))
        
        rotor_count = len(rotor_dirs)
        if rotor_count == 0:
            return {"success": False, "message": "No rotor directories found (expected rotor_1/, rotor_2/, ...)", "patches": []}
        
        # Build dynamic step list: import each rotor, import stator, merge each rotor, set AMI
        steps = []
        for i in range(1, rotor_count + 1):
            steps.append((f"Importing rotor {i} mesh", lambda rid, rd, ld, ss, ms, iv, lc, idx=i: self._import_rotor(rid, rd, ld, ss, ms, iv, lc, rotor_index=idx)))
        steps.append(("Importing stator mesh", self._import_stator))
        for i in range(1, rotor_count + 1):
            steps.append((f"Merging rotor {i} into stator", lambda rid, rd, ld, ss, ms, iv, lc, idx=i: self._merge_meshes(rid, rd, ld, ss, ms, iv, lc, rotor_index=idx)))
        steps.append(("Configuring AMI patches", self._set_ami_patches))
        
        total_steps = len(steps)
        
        for i, (step_name, step_func) in enumerate(steps):
            progress = int(((i + 1) / total_steps) * 100)
            
            if log_callback:
                await log_callback(run_id, {
                    "type": "progress",
                    "step": step_name,
                    "progress": progress,
                    "step_num": i + 1,
                    "total_steps": total_steps
                })
            
            try:
                success, message = await step_func(
                    run_id, run_dir, logs_dir, solver_settings, material_settings, inlet_velocity, log_callback
                )
                
                if not success:
                    if log_callback:
                        await log_callback(run_id, {
                            "type": "error",
                            "step": step_name,
                            "message": message
                        })
                    return {"success": False, "message": message, "patches": []}
                    
            except Exception as e:
                if log_callback:
                    await log_callback(run_id, {
                        "type": "error",
                        "step": step_name,
                        "message": str(e)
                    })
                return {"success": False, "message": str(e), "patches": []}
            
            # After all imports are done (stator is last import), save pre-merge introspection
            if step_name.startswith("Importing stator"):
                try:
                    # Introspect all rotor meshes + stator
                    all_patches = []
                    all_cellZones = []
                    all_faceZones = []
                    all_pointZones = []
                    
                    for rd in rotor_dirs:
                        result = introspect_mesh(rd)
                        all_patches.extend(result["patches"])
                        all_cellZones.extend(result["cellZones"])
                        all_faceZones.extend(result["faceZones"])
                        all_pointZones.extend(result["pointZones"])
                    
                    stator_result = introspect_mesh(prop_dir / "stator")
                    all_patches.extend(stator_result["patches"])
                    all_cellZones.extend(stator_result["cellZones"])
                    all_faceZones.extend(stator_result["faceZones"])
                    all_pointZones.extend(stator_result["pointZones"])
                    
                    combined = {
                        "patches": all_patches,
                        "cellZones": all_cellZones,
                        "faceZones": all_faceZones,
                        "pointZones": all_pointZones,
                        "metadata": {
                            "source": "salome_combined",
                            "casePath": str(prop_dir),
                            "rotor_count": rotor_count,
                            "nPatches": len(all_patches),
                            "nCellZones": len(all_cellZones),
                            "nFaceZones": len(all_faceZones),
                            "nPointZones": len(all_pointZones),
                        }
                    }
                    
                    salome_path = prop_dir / "salome_introspection.json"
                    with open(salome_path, 'w') as f:
                        _json.dump(combined, f, indent=2)
                except Exception as e:
                    import logging
                    logging.getLogger("workflow").warning(
                        f"Failed to save Salome introspection: {e}"
                    )
        
        # Get patches from boundary file
        patches = self.get_patches(run_dir)
        
        if log_callback:
            await log_callback(run_id, {
                "type": "complete",
                "message": f"PolyMesh created successfully. Found {len(patches)} patches. ({rotor_count} rotor(s))"
            })
        
        return {"success": True, "message": "PolyMesh created", "patches": patches, "rotor_count": rotor_count}
    
    async def run_simulation(
        self,
        run_id: str,
        run_dir: Path,
        solver_settings: Dict,
        material_settings: Dict,
        inlet_velocity: Optional[List[float]],
        analysis_settings: Optional[Dict] = None,
        log_callback: Optional[Callable] = None
    ):
        """Run the solver only (assumes polyMesh already exists)."""
        
        logs_dir = run_dir / "logs"
        logs_dir.mkdir(exist_ok=True)
        
        # Note: .foam file for Paraview is already created by run_manager when run is created
        
        # Track solve start time
        solve_started_at = datetime.now().isoformat()
        
        # Update job status
        self.job_manager.update_job(run_id, status="running", progress=0)
        
        # Add analysis settings to solver_settings for passing through steps
        if analysis_settings:
            solver_settings['analysis_settings'] = analysis_settings

        steps = [
            ("Creating rotor cellZone", self._create_cell_zone),
            ("Checking mesh", self._check_mesh),
            ("Applying settings", self._apply_settings),
            ("Running solver", self._run_solver),
            ("Performance Analysis", self._run_analysis)
        ]
        
        total_steps = len(steps)
        
        for i, (step_name, step_func) in enumerate(steps):
            progress = int((i / total_steps) * 100)
            self.job_manager.update_job(run_id, status="running", progress=progress, current_step=step_name)
            
            if log_callback:
                await log_callback(run_id, {
                    "type": "progress",
                    "step": step_name,
                    "progress": progress,
                    "step_num": i + 1,
                    "total_steps": total_steps
                })
            
            try:
                success, message = await step_func(
                    run_id, run_dir, logs_dir, solver_settings, material_settings, inlet_velocity, log_callback
                )
                
                if not success:
                    self.job_manager.update_job(run_id, status="failed", error=message)
                    # Record failed run with settings and duration
                    if self.run_manager:
                        self.run_manager.record_solve_completion(
                            run_id, solver_settings, material_settings,
                            solve_started_at, datetime.now().isoformat(), success=False
                        )
                    if log_callback:
                        await log_callback(run_id, {
                            "type": "error",
                            "step": step_name,
                            "message": message
                        })
                    return
                    
            except Exception as e:
                self.job_manager.update_job(run_id, status="failed", error=str(e))
                # Record failed run with settings and duration
                if self.run_manager:
                    self.run_manager.record_solve_completion(
                        run_id, solver_settings, material_settings,
                        solve_started_at, datetime.now().isoformat(), success=False
                    )
                if log_callback:
                    await log_callback(run_id, {
                        "type": "error",
                        "step": step_name,
                        "message": str(e)
                    })
                return
        
        # Complete - record successful run with settings and duration
        solve_completed_at = datetime.now().isoformat()
        self.job_manager.update_job(run_id, status="success", progress=100)
        
        if self.run_manager:
            self.run_manager.record_solve_completion(
                run_id, solver_settings, material_settings,
                solve_started_at, solve_completed_at, success=True
            )
        
        if log_callback:
            await log_callback(run_id, {
                "type": "complete",
                "message": "Simulation completed successfully"
            })
            
        # Step 4: Performance Analysis
        if analysis_settings and analysis_settings.get("enabled", True):
            if log_callback:
                await log_callback(run_id, {"type": "log", "step": "Analysis", "line": "Running performance analysis..."})
            
            try:
                # Add prop_diameter and thrust_axis
                analysis_config = analysis_settings.copy()
                analysis_config['rho'] = material_settings.get("density", 1.225)
                # RPM to omega for J calculation? handled in analyzer
                
                # Analyze results
                summary = self.analyzer.analyze_propeller(
                    case_dir=run_dir / "propCase" / "stator", # forces are usually written here or in rotor?
                    # Propeller forces are usually on rotor patches, but controlDict is in stator/system/controlDict?
                    # Wait, our controlDict is in stator/system/controlDict (see _apply_settings).
                    # So forces will be in stator/postProcessing (if running serial) or similar.
                    # Actually, we merge meshes into stator dir? No.
                    # _merge_meshes: "mergeMeshes -overwrite stator rotor". Merges rotor INTO stator.
                    # So stator dir becomes the full case.
                    config=analysis_config
                )
                
                if "error" not in summary:
                    self.analyzer.save_summary(summary, run_dir)
                    
                    # Update run record with performance data
                    if self.run_manager:
                        self.run_manager.record_solve_completion(
                            run_id, solver_settings, material_settings,
                            solve_started_at, solve_completed_at, success=True,
                            performance_summary=summary
                        )
                        
                    if log_callback:
                        metrics = summary.get('metrics', {})
                        msg = f"Analysis complete. Thrust: {metrics.get('thrust', 0):.2f} N, Torque: {metrics.get('torque', 0):.2f} Nm"
                        await log_callback(run_id, {"type": "log", "step": "Analysis", "line": msg})
                else:
                    if log_callback:
                        await log_callback(run_id, {"type": "error", "step": "Analysis", "message": f"Analysis skipped: {summary.get('error')}"})
                        
            except Exception as e:
                if log_callback:
                    await log_callback(run_id, {"type": "error", "step": "Analysis", "message": str(e)})
    
    async def _import_rotor(self, run_id, run_dir, logs_dir, solver_settings, material_settings, inlet_velocity, log_callback, rotor_index=1):
        """Import rotor mesh using ideasUnvToFoam. Supports rotor_N/ directory naming."""
        rotor_dir = run_dir / "propCase" / f"rotor_{rotor_index}"
        log_file = logs_dir / f"01_rotor_{rotor_index}_import.log"
        
        success, output, rc = await self.run_cmd_async(
            "ideasUnvToFoam rotor.unv",
            rotor_dir,
            log_file,
            run_id,
            f"Import Rotor {rotor_index}",
            log_callback
        )
        
        if success:
            cells_match = re.search(r'cells:\s*(\d+)', output)
            cells = cells_match.group(1) if cells_match else "unknown"
            return True, f"Rotor {rotor_index} mesh imported: {cells} cells"
        else:
            return False, f"Failed to import rotor {rotor_index} mesh (rc={rc})"
    
    async def _import_stator(self, run_id, run_dir, logs_dir, solver_settings, material_settings, inlet_velocity, log_callback):
        """Import stator mesh using ideasUnvToFoam."""
        stator_dir = run_dir / "propCase" / "stator"
        log_file = logs_dir / "02_stator_import.log"
        
        success, output, rc = await self.run_cmd_async(
            "ideasUnvToFoam stator.unv",
            stator_dir,
            log_file,
            run_id,
            "Import Stator",
            log_callback
        )
        
        if success:
            cells_match = re.search(r'cells:\s*(\d+)', output)
            cells = cells_match.group(1) if cells_match else "unknown"
            return True, f"Stator mesh imported: {cells} cells"
        else:
            return False, f"Failed to import stator mesh (rc={rc})"
    
    async def _merge_meshes(self, run_id, run_dir, logs_dir, solver_settings, material_settings, inlet_velocity, log_callback, rotor_index=1):
        """Merge a rotor mesh into the stator. Supports merging rotor_N/ sequentially."""
        prop_case = run_dir / "propCase"
        log_file = logs_dir / f"03_merge_rotor_{rotor_index}.log"
        
        success, output, rc = await self.run_cmd_async(
            f"mergeMeshes -overwrite stator rotor_{rotor_index}",
            prop_case,
            log_file,
            run_id,
            f"Merge Rotor {rotor_index}",
            log_callback
        )
        
        if success:
            cells_match = re.search(r'cells:\s*(\d+)', output)
            cells = cells_match.group(1) if cells_match else "unknown"
            return True, f"Rotor {rotor_index} merged: {cells} total cells"
        else:
            return False, f"Failed to merge rotor {rotor_index} (rc={rc})"
    
    async def _set_ami_patches(self, run_id, run_dir, logs_dir, solver_settings, material_settings, inlet_velocity, log_callback):
        """Configure cyclicAMI patches in boundary file."""
        boundary_file = run_dir / "propCase" / "stator" / "constant" / "polyMesh" / "boundary"
        log_file = logs_dir / "04_set_ami_patches.log"
        
        try:
            if not boundary_file.exists():
                return False, f"Boundary file not found: {boundary_file}"
            
            # Backup original
            shutil.copy2(boundary_file, boundary_file.with_suffix('.orig'))
            
            with open(boundary_file, 'r') as f:
                content = f.read()
            
            def update_patch(content: str, patch_name: str, new_type: str, neighbour: str = None) -> str:
                # Update type
                pattern = rf'({patch_name}\s*\{{\s*type\s+)\w+(;)'
                replacement = rf'\g<1>{new_type}\g<2>'
                content = re.sub(pattern, replacement, content)
                
                # Add neighbourPatch for AMI
                if neighbour:
                    check_pattern = rf'{patch_name}\s*\{{[^}}]*neighbourPatch'
                    if not re.search(check_pattern, content):
                        pattern = rf'({patch_name}\s*\{{\s*type\s+\w+;)'
                        replacement = rf'\g<1>\n        neighbourPatch  {neighbour};'
                        content = re.sub(pattern, replacement, content)
                    
                    # Add lowWeightCorrection to prevent FPE on non-overlapping faces
                    check_lwc = rf'{patch_name}\s*\{{[^}}]*lowWeightCorrection'
                    if not re.search(check_lwc, content):
                        pattern = rf'({patch_name}\s*\{{[^}}]*neighbourPatch\s+\w+;)'
                        replacement = rf'\g<1>\n        lowWeightCorrection 0.2;'
                        content = re.sub(pattern, replacement, content)
                
                return content
            
            # Update patches
            content = update_patch(content, 'statorAMI', 'cyclicAMI', 'rotorAMI')
            content = update_patch(content, 'rotorAMI', 'cyclicAMI', 'statorAMI')
            content = update_patch(content, 'outerWall', 'wall')
            content = update_patch(content, 'propellerWalls', 'wall')
            
            with open(boundary_file, 'w') as f:
                f.write(content)
            
            # Write log
            with open(log_file, 'w') as f:
                f.write("AMI patches configured successfully\n")
                f.write("- statorAMI <-> rotorAMI (cyclicAMI)\n")
                f.write("- outerWall, propellerWalls (wall)\n")
            
            if log_callback:
                await log_callback(run_id, {
                    "type": "log",
                    "step": "Set AMI Patches",
                    "line": "AMI patches configured: statorAMI <-> rotorAMI"
                })
            
            return True, "AMI patches configured"
            
        except Exception as e:
            return False, str(e)
    
    async def _create_cell_zone(self, run_id, run_dir, logs_dir, solver_settings, material_settings, inlet_velocity, log_callback):
        """Create rotor cellZone(s) using topoSet. Multi-rotor aware."""
        stator_dir = run_dir / "propCase" / "stator"
        log_file = logs_dir / "05_toposet.log"
        
        # Discover how many rotors were merged
        prop_dir = run_dir / "propCase"
        rotor_dirs = sorted([
            d for d in prop_dir.iterdir()
            if d.is_dir() and d.name.startswith("rotor_") and d.name[6:].isdigit()
        ], key=lambda d: int(d.name.split("_")[1]))
        rotor_count = len(rotor_dirs)
        if rotor_count == 0:
            rotor_count = 1  # fallback for legacy layouts
        
        # Build topoSetDict with per-rotor actions
        toposet_dict = stator_dir / "system" / "topoSetDict"
        
        actions_str = ""
        zone_names = []
        for i in range(1, rotor_count + 1):
            if rotor_count == 1:
                zone_name = "rotorCells"
                source_zone = "rotor"
            else:
                zone_name = f"rotor_{i}_Cells"
                # After mergeMeshes, zones from rotor_N/ keep their original name "rotor"
                # but get prefixed by the merge. For sequential merges of rotor_1, rotor_2, etc.,
                # the original zone from each rotor mesh is typically named "rotor" in the UNV.
                # We try both the prefixed name and the plain name.
                source_zone = f"rotor_{i}"
            zone_names.append(zone_name)
            
            actions_str += f"""    {{
        name    {zone_name};
        type    cellSet;
        action  new;
        source  zoneToCell;
        zone    {source_zone};
    }}
    {{
        name    {zone_name};
        type    cellZoneSet;
        action  new;
        source  setToCellZone;
        set     {zone_name};
    }}
"""
        
        toposet_content = f"""/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2506                                 |
|   \\\\  /    A nd           | Website:  www.openfoam.com                      |
|    \\\\/     M anipulation  |                                                 |
\\*---------------------------------------------------------------------------*/
FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      topoSetDict;
}}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

actions
(
{actions_str});

// ************************************************************************* //
"""
        with open(toposet_dict, 'w') as f:
            f.write(toposet_content)
        
        success, output, rc = await self.run_cmd_async(
            "topoSet",
            stator_dir,
            log_file,
            run_id,
            "Create Cell Zone",
            log_callback
        )
        
        # Check if all zones were created
        all_found = all(zn in output for zn in zone_names)
        if success or all_found:
            return True, f"Rotor cellZone(s) created: {', '.join(zone_names)}"
        else:
            # Try alternative: setSet
            log_file2 = logs_dir / "05_setset.log"
            setset_lines = []
            for i in range(1, rotor_count + 1):
                if rotor_count == 1:
                    zn = "rotorCells"
                    sz = "rotor"
                else:
                    zn = f"rotor_{i}_Cells"
                    sz = f"rotor_{i}"
                setset_lines.append(f"cellSet {zn} new zoneToCell {sz}")
                setset_lines.append(f"cellZoneSet {zn} new setToCellZone {zn}")
            setset_lines.append("quit")
            setset_cmds = "\\n".join(setset_lines)
            
            proc = subprocess.run(
                ['bash', '-c', f'. {self.openfoam_bashrc} && echo "{setset_cmds}" | setSet -batch'],
                cwd=str(stator_dir),
                capture_output=True,
                text=True
            )
            
            with open(log_file2, 'w') as f:
                f.write(proc.stdout + proc.stderr)
            
            if proc.returncode == 0:
                return True, f"Rotor cellZone(s) created (via setSet): {', '.join(zone_names)}"
            else:
                return False, f"Failed to create cellZone(s) (rc={rc})"
    
    async def _check_mesh(self, run_id, run_dir, logs_dir, solver_settings, material_settings, inlet_velocity, log_callback):
        """Run checkMesh on merged case."""
        stator_dir = run_dir / "propCase" / "stator"
        log_file = logs_dir / "06_checkMesh.log"
        
        success, output, rc = await self.run_cmd_async(
            "checkMesh -allGeometry -allTopology",
            stator_dir,
            log_file,
            run_id,
            "Check Mesh",
            log_callback
        )
        
        # checkMesh may return non-zero for warnings
        if "FOAM FATAL ERROR" in output:
            return False, "checkMesh found fatal errors"
        
        cells_match = re.search(r'cells:\s*(\d+)', output)
        cells = cells_match.group(1) if cells_match else "unknown"
        
        return True, f"Mesh check passed: {cells} cells"
    
    async def _apply_settings(self, run_id, run_dir, logs_dir, solver_settings, material_settings, inlet_velocity, log_callback):
        """Apply solver and material settings to case files."""
        stator_dir = run_dir / "propCase" / "stator"
        log_file = logs_dir / "07_apply_settings.log"
        
        try:
            log_lines = []
            
            # ========== EXPLICIT LOGGING OF RECEIVED SETTINGS ==========
            # Handle fixed_timestep - may come as string "true" from JavaScript
            raw_fixed = solver_settings.get("fixed_timestep", False)
            if isinstance(raw_fixed, str):
                fixed_timestep = raw_fixed.lower() in ('true', '1', 'yes')
            else:
                fixed_timestep = bool(raw_fixed)
            
            delta_t = solver_settings.get("delta_t", 1e-5)
            max_co = solver_settings.get("max_co", 0.5)
            
            log_lines.append(f"=== TIMESTEP SETTINGS RECEIVED ===")
            log_lines.append(f"  raw fixed_timestep value: {raw_fixed} (type: {type(raw_fixed).__name__})")
            log_lines.append(f"  parsed fixed_timestep: {fixed_timestep}")
            log_lines.append(f"  delta_t: {delta_t}")
            log_lines.append(f"  max_co: {max_co}")
            
            # Update controlDict
            control_dict = stator_dir / "system" / "controlDict"
            if control_dict.exists():
                with open(control_dict, 'r') as f:
                    content = f.read()
                
                # Split at 'functions' to avoid updating writeInterval inside functions block
                if 'functions' in content:
                    parts = content.split('functions', 1)
                    main_part = parts[0]
                    functions_part = 'functions' + parts[1]
                else:
                    main_part = content
                    functions_part = ''
                
                # Update solver
                main_part = re.sub(r'application\s+\w+;', f'application     {solver_settings["solver"]};', main_part)
                
                # Update endTime
                main_part = re.sub(r'endTime\s+[\d.e+-]+;', f'endTime         {solver_settings["end_time"]};', main_part)
                
                # Update deltaT - ALWAYS set to the provided delta_t
                main_part = re.sub(r'deltaT\s+[\d.e+-]+;', f'deltaT          {delta_t};', main_part)
                
                # Update writeInterval (only in main section)
                main_part = re.sub(r'writeInterval\s+[\d.e+-]+;', f'writeInterval   {solver_settings["write_interval"]};', main_part)
                
                # Update purgeWrite
                purge_write = solver_settings.get("purge_write", 0)
                main_part = re.sub(r'purgeWrite\s+\d+;', f'purgeWrite      {purge_write};', main_part)
                
                content = main_part + functions_part
                
                # Update maxCo (even for fixed timestep, OpenFOAM may read it)
                content = re.sub(r'maxCo\s+[\d.e+-]+;', f'maxCo           {max_co};', content)
                
                # Update maxDeltaT
                max_delta_t = solver_settings.get("max_delta_t", 1e-4)
                if 'maxDeltaT' in content:
                    content = re.sub(r'maxDeltaT\s+[\d.e+-]+;', f'maxDeltaT       {max_delta_t};', content)
                else:
                    # Insert before functions block or at end
                    content = re.sub(r'(maxCo\s+[\d.e+-]+;)', rf'\1\nmaxDeltaT       {max_delta_t};', content)
                
                # ========== CRITICAL: HANDLE FIXED/ADJUSTABLE TIMESTEP ==========
                # This is where we enforce fixed timestep behavior
                if fixed_timestep:
                    # FIXED TIMESTEP: OpenFOAM must NOT adjust dt
                    log_lines.append(f">>> APPLYING FIXED TIMESTEP MODE <<<")
                    log_lines.append(f"    Setting adjustTimeStep to NO")
                    # Replace any variation of adjustTimeStep yes/no/true/false
                    content = re.sub(r'adjustTimeStep\s+\w+\s*;', 'adjustTimeStep  no;', content)
                else:
                    # ADAPTIVE TIMESTEP: OpenFOAM will adjust dt based on maxCo
                    log_lines.append(f">>> APPLYING ADAPTIVE TIMESTEP MODE (maxCo={max_co}) <<<")
                    log_lines.append(f"    Setting adjustTimeStep to YES")
                    content = re.sub(r'adjustTimeStep\s+\w+\s*;', 'adjustTimeStep  yes;', content)
                
                # Write the updated controlDict
                with open(control_dict, 'w') as f:
                    f.write(content)
                
                # ========== VERIFICATION: READ BACK AND VALIDATE ==========
                log_lines.append(f"=== VERIFICATION: READING BACK controlDict ===")
                with open(control_dict, 'r') as f:
                    verify_content = f.read()
                
                # Extract actual values from the file
                adjust_match = re.search(r'adjustTimeStep\s+(\w+)\s*;', verify_content)
                delta_match = re.search(r'deltaT\s+([\d.e+-]+)\s*;', verify_content)
                maxco_match = re.search(r'maxCo\s+([\d.e+-]+)\s*;', verify_content)
                maxdt_match = re.search(r'maxDeltaT\s+([\d.e+-]+)\s*;', verify_content)
                
                actual_adjust = adjust_match.group(1) if adjust_match else "NOT FOUND"
                actual_delta = delta_match.group(1) if delta_match else "NOT FOUND"
                actual_maxco = maxco_match.group(1) if maxco_match else "NOT FOUND"
                actual_maxdt = maxdt_match.group(1) if maxdt_match else "NOT FOUND"
                
                log_lines.append(f"  adjustTimeStep: {actual_adjust}")
                log_lines.append(f"  deltaT: {actual_delta}")
                log_lines.append(f"  maxCo: {actual_maxco}")
                log_lines.append(f"  maxDeltaT: {actual_maxdt}")
                
                # CRITICAL VALIDATION
                if fixed_timestep and actual_adjust.lower() != "no":
                    error_msg = f"CRITICAL ERROR: fixed_timestep=True but adjustTimeStep={actual_adjust} (expected 'no')"
                    log_lines.append(f"!!! {error_msg} !!!")
                    # Write log before failing
                    with open(log_file, 'w') as f:
                        f.write('\n'.join(log_lines))
                    return False, error_msg
                
                if not fixed_timestep and actual_adjust.lower() != "yes":
                    error_msg = f"CRITICAL ERROR: fixed_timestep=False but adjustTimeStep={actual_adjust} (expected 'yes')"
                    log_lines.append(f"!!! {error_msg} !!!")
                    with open(log_file, 'w') as f:
                        f.write('\n'.join(log_lines))
                    return False, error_msg
                
                log_lines.append(f"✓ VERIFICATION PASSED - controlDict correctly configured")
                
                adjust_str = "no (fixed)" if fixed_timestep else f"yes (maxCo={max_co})"
                log_lines.append(f"Updated controlDict: solver={solver_settings['solver']}, endTime={solver_settings['end_time']}, deltaT={delta_t}, adjustTimeStep={adjust_str}")
            
            # Update fvSolution with PIMPLE and relaxation settings
            fv_solution = stator_dir / "system" / "fvSolution"
            if fv_solution.exists():
                with open(fv_solution, 'r') as f:
                    content = f.read()
                
                n_outer = solver_settings.get("n_outer_correctors", 4)
                relax_p = solver_settings.get("relax_p", 0.2)
                relax_u = solver_settings.get("relax_u", 0.5)
                
                # Update nOuterCorrectors
                content = re.sub(r'nOuterCorrectors\s+\d+;', f'nOuterCorrectors    {n_outer};', content)
                
                # Update pressure relaxation
                content = re.sub(r'p\s+[\d.]+;\s*//\s*More conservative', f'p               {relax_p};  // More conservative', content)
                # Also try without comment
                content = re.sub(r'(fields\s*\{\s*p\s+)[\d.]+;', rf'\g<1>{relax_p};', content)
                
                # Update velocity relaxation
                content = re.sub(r'(equations\s*\{\s*U\s+)[\d.]+;', rf'\g<1>{relax_u};', content)
                
                with open(fv_solution, 'w') as f:
                    f.write(content)
                
                log_lines.append(f"Updated fvSolution: nOuter={n_outer}, relaxP={relax_p}, relaxU={relax_u}")
            
            # Update dynamicMeshDict with optional ramp-up — multi-rotor aware
            dynamic_dict = stator_dir / "constant" / "dynamicMeshDict"
            if dynamic_dict.exists():
                # Discover rotor count
                prop_dir = run_dir / "propCase"
                rotor_dirs = sorted([
                    d for d in prop_dir.iterdir()
                    if d.is_dir() and d.name.startswith("rotor_") and d.name[6:].isdigit()
                ], key=lambda d: int(d.name.split("_")[1]))
                rotor_count = max(len(rotor_dirs), 1)
                
                # Per-rotor settings (defaults to global settings if not specified per-rotor)
                rotor_settings_list = solver_settings.get("rotor_settings", [])
                
                # Default global rotation params
                default_rpm = solver_settings["rotation_rpm"]
                default_origin = solver_settings.get("rotation_origin", [0, 0, 0])
                default_axis = solver_settings.get("rotation_axis", [0, 0, 1])
                default_reverse = solver_settings.get("reverse_direction", False)
                
                enable_rampup = solver_settings.get("enable_rampup", False)
                ramp_duration = solver_settings.get("ramp_duration", 0.02)
                end_time = solver_settings.get("end_time", 0.1)
                table_end_time = max(end_time * 2, ramp_duration + 1.0)
                
                def get_rotor_params(idx):
                    """Get rotation params for rotor idx (0-based index into rotor_settings_list)."""
                    if idx < len(rotor_settings_list) and rotor_settings_list[idx]:
                        rs = rotor_settings_list[idx]
                        rpm = rs.get("rpm", default_rpm)
                        origin = rs.get("origin", default_origin)
                        axis = rs.get("axis", default_axis)
                        reverse = rs.get("reverse_direction", default_reverse)
                    else:
                        rpm = default_rpm
                        origin = default_origin
                        axis = default_axis
                        reverse = default_reverse
                    
                    omega = rpm * 2 * 3.14159265 / 60
                    if reverse:
                        omega = -omega
                    return rpm, origin, axis, omega
                
                if rotor_count == 1:
                    # Single rotor: use dynamicMotionSolverFvMesh (backwards compatible)
                    _, origin, axis, target_omega = get_rotor_params(0)
                    
                    if enable_rampup and ramp_duration > 0:
                        dynamic_content = f"""/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2506                                 |
|   \\\\  /    A nd           | Website:  www.openfoam.com                      |
|    \\\\/     M anipulation  |                                                 |
\\*---------------------------------------------------------------------------*/
FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      dynamicMeshDict;
}}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

dynamicFvMesh   dynamicMotionSolverFvMesh;

motionSolverLibs (fvMotionSolvers);

motionSolver    solidBody;

cellZone        rotorCells;

solidBodyMotionFunction rotatingMotion;

rotatingMotionCoeffs
{{
    origin      ({origin[0]} {origin[1]} {origin[2]});
    axis        ({axis[0]} {axis[1]} {axis[2]});
    
    // Ramp-up omega from 0 to {target_omega:.2f} rad/s over {ramp_duration}s, then hold constant
    omega       table
    (
        (0          0)
        ({ramp_duration/4:.6f}   {target_omega*0.25:.2f})
        ({ramp_duration/2:.6f}   {target_omega*0.5:.2f})
        ({ramp_duration*0.75:.6f}   {target_omega*0.75:.2f})
        ({ramp_duration:.6f}    {target_omega:.2f})
        ({table_end_time:.6f}   {target_omega:.2f})
    );
}}

// ************************************************************************* //
"""
                        with open(dynamic_dict, 'w') as f:
                            f.write(dynamic_content)
                        log_lines.append(f"Updated dynamicMeshDict: omega ramping 0 -> {target_omega:.2f} rad/s over {ramp_duration}s (table extends to {table_end_time}s)")
                    else:
                        # Simple constant omega
                        with open(dynamic_dict, 'r') as f:
                            content = f.read()
                        
                        content = re.sub(r'omega\s+[\d.e+-]+;', f'omega       {target_omega:.2f};', content)
                        content = re.sub(r'origin\s+\([^)]+\);', f'origin      ({origin[0]} {origin[1]} {origin[2]});', content)
                        content = re.sub(r'axis\s+\([^)]+\);', f'axis        ({axis[0]} {axis[1]} {axis[2]});', content)
                        
                        with open(dynamic_dict, 'w') as f:
                            f.write(content)
                        
                        log_lines.append(f"Updated dynamicMeshDict: omega={target_omega:.2f} rad/s ({solver_settings['rotation_rpm']} RPM)")
                else:
                    # Multi-rotor: use dynamicMultiMotionSolverFvMesh (v2506 syntax)
                    zones_block = ""
                    for i in range(1, rotor_count + 1):
                        rpm, origin, axis, omega = get_rotor_params(i - 1)
                        zone_name = f"rotor_{i}_Cells"
                        
                        if enable_rampup and ramp_duration > 0:
                            omega_entry = f"""            omega       table
            (
                (0          0)
                ({ramp_duration/4:.6f}   {omega*0.25:.2f})
                ({ramp_duration/2:.6f}   {omega*0.5:.2f})
                ({ramp_duration*0.75:.6f}   {omega*0.75:.2f})
                ({ramp_duration:.6f}    {omega:.2f})
                ({table_end_time:.6f}   {omega:.2f})
            );"""
                        else:
                            omega_entry = f"            omega       {omega:.2f};"
                        
                        zones_block += f"""
    rotor_{i}
    {{
        solver          solidBody;
        cellZone        {zone_name};
        solidBodyCoeffs
        {{
            solidBodyMotionFunction rotatingMotion;
            rotatingMotionCoeffs
            {{
                origin      ({origin[0]} {origin[1]} {origin[2]});
                axis        ({axis[0]} {axis[1]} {axis[2]});
{omega_entry}
            }}
        }}
    }}
"""
                    
                    dynamic_content = f"""/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2506                                 |
|   \\\\  /    A nd           | Website:  www.openfoam.com                      |
|    \\\\/     M anipulation  |                                                 |
\\*---------------------------------------------------------------------------*/
FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      dynamicMeshDict;
}}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

dynamicFvMesh   dynamicMultiMotionSolverFvMesh;

dynamicMultiMotionSolverFvMeshCoeffs
{{
{zones_block}}}

// ************************************************************************* //
"""
                    with open(dynamic_dict, 'w') as f:
                        f.write(dynamic_content)
                    
                    rpms = [get_rotor_params(i)[0] for i in range(rotor_count)]
                    log_lines.append(f"Updated dynamicMeshDict (dynamicMultiMotionSolver): {rotor_count} zones, RPMs={rpms}")
            
            # Update transportProperties
            transport_props = stator_dir / "constant" / "transportProperties"
            if transport_props.exists():
                with open(transport_props, 'r') as f:
                    content = f.read()
                
                content = re.sub(r'nu\s+[\d.e+-]+;', f'nu              {material_settings["kinematic_viscosity"]};', content)
                
                with open(transport_props, 'w') as f:
                    f.write(content)
                
                log_lines.append(f"Updated transportProperties: nu={material_settings['kinematic_viscosity']}")
            
            # Update turbulenceProperties to match selected turbulence model
            turb_model = solver_settings.get("turbulence_model", "kEpsilon")
            turb_props = stator_dir / "constant" / "turbulenceProperties"
            if turb_props.exists():
                with open(turb_props, 'r') as f:
                    content = f.read()
                content = re.sub(r'RASModel\s+\w+;', f'RASModel        {turb_model};', content)
                with open(turb_props, 'w') as f:
                    f.write(content)
                log_lines.append(f"Updated turbulenceProperties: RASModel={turb_model}")
            
            # Handle omega/epsilon field files based on turbulence model
            zero_dir = stator_dir / "0"
            epsilon_file = zero_dir / "epsilon"
            omega_file = zero_dir / "omega"
            needs_omega = turb_model in ("kOmegaSST", "kOmega")
            needs_epsilon = turb_model in ("kEpsilon", "realizableKE", "RNGkEpsilon", "LaunderSharmaKE")
            
            if needs_omega and not omega_file.exists():
                # Create omega file from epsilon template
                omega_content = """/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2506                                 |
|   \\\\  /    A nd           | Website:  www.openfoam.com                      |
|    \\\\/     M anipulation  |                                                 |
\\*---------------------------------------------------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       volScalarField;
    object      omega;
}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

dimensions      [0 0 -1 0 0 0 0];

internalField   uniform 1.0;

boundaryField
{
    ".*"
    {
        type            fixedValue;
        value           $internalField;
    }
}

// ************************************************************************* //
"""
                with open(omega_file, 'w') as f:
                    f.write(omega_content)
                # Remove epsilon if it exists (wrong for kOmega models)
                if epsilon_file.exists():
                    epsilon_file.unlink()
                log_lines.append(f"Created 0/omega, removed 0/epsilon for {turb_model}")
            elif needs_epsilon and not epsilon_file.exists():
                # Create epsilon file from omega template  
                epsilon_content = """/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2506                                 |
|   \\\\  /    A nd           | Website:  www.openfoam.com                      |
|    \\\\/     M anipulation  |                                                 |
\\*---------------------------------------------------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       volScalarField;
    object      epsilon;
}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

dimensions      [0 2 -3 0 0 0 0];

internalField   uniform 0.1;

boundaryField
{
    ".*"
    {
        type            fixedValue;
        value           $internalField;
    }
}

// ************************************************************************* //
"""
                with open(epsilon_file, 'w') as f:
                    f.write(epsilon_content)
                if omega_file.exists():
                    omega_file.unlink()
                log_lines.append(f"Created 0/epsilon, removed 0/omega for {turb_model}")
            
            # Update inlet velocity if wind enabled
            if inlet_velocity:
                u_file = stator_dir / "0" / "U"
                if u_file.exists():
                    with open(u_file, 'r') as f:
                        content = f.read()
                    
                    # Update inlet conditions
                    inlet_val = f"({inlet_velocity[0]} {inlet_velocity[1]} {inlet_velocity[2]})"
                    content = re.sub(r'(inlet_stator\s*\{[^}]*value\s+uniform\s+)\([^)]+\)', rf'\g<1>{inlet_val}', content)
                    content = re.sub(r'(inlet_rotor\s*\{[^}]*value\s+uniform\s+)\([^)]+\)', rf'\g<1>{inlet_val}', content)
                    
                    with open(u_file, 'w') as f:
                        f.write(content)
                    
                    log_lines.append(f"Updated inlet velocity: {inlet_val}")
            
            # Write parallel settings if enabled
            if solver_settings.get("parallel", False):
                decompose_dict = stator_dir / "system" / "decomposeParDict"
                num_cores = solver_settings.get("num_cores", 4)
                
                decompose_content = f"""/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2506                                 |
|   \\\\  /    A nd           | Website:  www.openfoam.com                      |
|    \\\\/     M anipulation  |                                                 |
\\*---------------------------------------------------------------------------*/
FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      decomposeParDict;
}}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

numberOfSubdomains  {num_cores};

method          scotch;

// ************************************************************************* //
"""
                with open(decompose_dict, 'w') as f:
                    f.write(decompose_content)
                
                log_lines.append(f"Created decomposeParDict: {num_cores} subdomains")
            
            # ============= SYNC BOUNDARY CONDITIONS WITH ACTUAL MESH =============
            # The template 0/ files have hardcoded patch names that may not match
            # the user's actual mesh patches. Read the boundary mapping and polyMesh
            # boundary, then rewrite each 0/ field file's boundaryField block.
            boundary_file = stator_dir / "constant" / "polyMesh" / "boundary"
            mapping_path = run_dir / "boundary_mapping.json"
            
            if boundary_file.exists() and mapping_path.exists():
                try:
                    from shared.mesh_introspection import _parse_boundary
                    from shared.boundary_schema import (
                        load_mapping, get_patches_for_endpoint,
                        get_instance_patches, get_all_mapped_patches
                    )
                    
                    # 1. Get actual patches from polyMesh
                    actual_patches = _parse_boundary(boundary_file)
                    patch_names = [p["name"] for p in actual_patches]
                    patch_types_mesh = {p["name"]: p["type"] for p in actual_patches}
                    
                    # 2. Load boundary mapping
                    mapping = load_mapping(mapping_path)
                    
                    if mapping:
                        # 3. Classify each patch by endpoint role
                        inlet_patches = set(get_patches_for_endpoint(mapping, "inlet"))
                        outlet_patches = set(get_patches_for_endpoint(mapping, "outlet"))
                        wall_patches = set(get_patches_for_endpoint(mapping, "domainWalls"))
                        
                        # Gather AMI and geometry patches from repeating group instances
                        ami_patches = set()
                        geometry_patches = set()
                        ami_neighbours = {}  # patch_name -> neighbour_patch_name
                        instances = mapping.get("instances", {}).get("propellers", [])
                        for i in range(len(instances)):
                            iface = get_instance_patches(mapping, "propellers", i, "interfacePatches")
                            ami_patches.update(iface)
                            # Pair AMI patches: each instance's interfacePatches are [A, B] neighbours
                            if len(iface) == 2:
                                ami_neighbours[iface[0]] = iface[1]
                                ami_neighbours[iface[1]] = iface[0]
                            elif len(iface) > 2:
                                # More than 2: pair sequentially (A↔B, C↔D, ...)
                                for j in range(0, len(iface) - 1, 2):
                                    ami_neighbours[iface[j]] = iface[j + 1]
                                    ami_neighbours[iface[j + 1]] = iface[j]
                            geometry_patches.update(get_instance_patches(mapping, "propellers", i, "geometryPatches"))
                        
                        # Fallback for unpaired AMI patches
                        for ap in ami_patches:
                            if ap not in ami_neighbours:
                                ami_neighbours[ap] = ap
                        
                        all_mapped = set(get_all_mapped_patches(mapping))
                        
                        # ---- Patch polyMesh boundary: convert patch types ----
                        if boundary_file.exists():
                            try:
                                bf_content = boundary_file.read_text(errors='replace')
                                patched_count = 0
                                
                                # Convert AMI patches to cyclicAMI
                                for ami_name in ami_patches:
                                    neighbour = ami_neighbours.get(ami_name, ami_name)
                                    pattern = rf'({re.escape(ami_name)}\s*\{{[^}}]*?)type\s+\w+;'
                                    replacement = rf'\1type            cyclicAMI;\n        neighbourPatch  {neighbour};\n        matchTolerance  0.0001;\n        transform       noOrdering;'
                                    bf_content = re.sub(pattern, replacement, bf_content, flags=re.DOTALL)
                                    patched_count += 1
                                
                                # Convert wall and geometry patches to type wall
                                all_wall_patches = wall_patches | geometry_patches
                                for wp in all_wall_patches:
                                    pattern = rf'({re.escape(wp)}\s*\{{[^}}]*?)type\s+patch;'
                                    replacement = rf'\1type            wall;'
                                    bf_content = re.sub(pattern, replacement, bf_content, flags=re.DOTALL)
                                    patched_count += 1
                                
                                boundary_file.write_text(bf_content)
                                log_lines.append(f"Patched polyMesh/boundary: {len(ami_patches)} AMI + {len(all_wall_patches)} wall patches")
                            except Exception as e:
                                log_lines.append(f"Warning: Failed to patch polyMesh/boundary: {e}")
                        
                        def classify(patch_name):
                            """Classify a patch as: inlet, outlet, wall, ami, geometry, or unknown."""
                            if patch_name in inlet_patches:
                                return "inlet"
                            if patch_name in outlet_patches:
                                return "outlet"
                            if patch_name in wall_patches:
                                return "wall"
                            if patch_name in ami_patches:
                                return "ami"
                            if patch_name in geometry_patches:
                                return "geometry"
                            # Check mesh-level type for cyclicAMI
                            mesh_type = patch_types_mesh.get(patch_name, "")
                            if "cyclicAMI" in mesh_type or "cyclic" in mesh_type.lower():
                                return "ami"
                            if "wall" in mesh_type.lower():
                                return "wall"
                            # Not mapped — default to wall (safe for most cases)
                            return "wall"
                        
                        # 4. Define BC generators per field per role
                        def bc_for_field(field_name, role, patch_name):
                            """Generate the BC dict string for a patch given field and role."""
                            if role == "inlet":
                                if field_name == "U":
                                    return '        type            fixedValue;\n        value           uniform (0 0 -1);'
                                elif field_name == "p":
                                    return '        type            zeroGradient;'
                                elif field_name == "k":
                                    return '        type            fixedValue;\n        value           uniform 0.01;'
                                elif field_name == "epsilon":
                                    return '        type            fixedValue;\n        value           uniform 0.05;'
                                elif field_name == "omega":
                                    return '        type            fixedValue;\n        value           uniform 1.0;'
                                elif field_name == "nut":
                                    return '        type            calculated;\n        value           uniform 0;'
                            elif role == "outlet":
                                if field_name == "U":
                                    return '        type            inletOutlet;\n        inletValue      uniform (0 0 0);\n        value           uniform (0 0 -1);'
                                elif field_name == "p":
                                    return '        type            fixedValue;\n        value           uniform 0;'
                                elif field_name == "k":
                                    return '        type            zeroGradient;'
                                elif field_name == "epsilon":
                                    return '        type            zeroGradient;'
                                elif field_name == "omega":
                                    return '        type            zeroGradient;'
                                elif field_name == "nut":
                                    return '        type            calculated;\n        value           uniform 0;'
                            elif role == "wall":
                                if field_name == "U":
                                    return '        type            noSlip;'
                                elif field_name == "p":
                                    return '        type            zeroGradient;'
                                elif field_name == "k":
                                    return '        type            kqRWallFunction;\n        value           uniform 0.01;'
                                elif field_name == "epsilon":
                                    return '        type            epsilonWallFunction;\n        value           uniform 0.05;'
                                elif field_name == "omega":
                                    return '        type            omegaWallFunction;\n        value           uniform 1.0;'
                                elif field_name == "nut":
                                    return '        type            nutkWallFunction;\n        value           uniform 0;'
                            elif role == "geometry":
                                # Propeller/geometry walls — moving wall for U
                                if field_name == "U":
                                    return '        type            movingWallVelocity;\n        value           uniform (0 0 0);'
                                elif field_name == "p":
                                    return '        type            zeroGradient;'
                                elif field_name == "k":
                                    return '        type            kqRWallFunction;\n        value           uniform 0.01;'
                                elif field_name == "epsilon":
                                    return '        type            epsilonWallFunction;\n        value           uniform 0.05;'
                                elif field_name == "omega":
                                    return '        type            omegaWallFunction;\n        value           uniform 1.0;'
                                elif field_name == "nut":
                                    return '        type            nutkWallFunction;\n        value           uniform 0;'
                            elif role == "ami":
                                neighbour = ami_neighbours.get(patch_name, patch_name)
                                return f'        type            cyclicAMI;\n        neighbourPatch  {neighbour};\n        value           $internalField;'
                            
                            # Fallback: zeroGradient
                            return '        type            zeroGradient;'
                        
                        # 5. Rewrite each 0/ field file
                        zero_dir = stator_dir / "0"
                        field_files = [f for f in zero_dir.iterdir() if f.is_file()] if zero_dir.exists() else []
                        
                        synced_count = 0
                        for ff in field_files:
                            field_name = ff.name
                            try:
                                content = ff.read_text()
                                
                                # Find the boundaryField block
                                bf_match = re.search(r'boundaryField\s*\{', content)
                                if not bf_match:
                                    continue
                                
                                # Extract everything before boundaryField
                                header = content[:bf_match.start()]
                                
                                # Build new boundaryField
                                bf_lines = ["boundaryField", "{"]
                                for pname in patch_names:
                                    role = classify(pname)
                                    bc = bc_for_field(field_name, role, pname)
                                    bf_lines.append(f"    {pname}")
                                    bf_lines.append("    {")
                                    bf_lines.append(bc)
                                    bf_lines.append("    }")
                                    bf_lines.append("")
                                bf_lines.append("}")
                                bf_lines.append("")
                                bf_lines.append("// ************************************************************************* //")
                                bf_lines.append("")
                                
                                new_content = header + "\n".join(bf_lines)
                                ff.write_text(new_content)
                                synced_count += 1
                            except Exception as e:
                                log_lines.append(f"Warning: Failed to sync BC for {field_name}: {e}")
                        
                        log_lines.append(f"Synced boundary conditions for {synced_count} field files ({len(patch_names)} patches)")
                    else:
                        log_lines.append("Warning: No boundary mapping found — using template BCs (may cause errors)")
                except Exception as e:
                    log_lines.append(f"Warning: BC sync failed: {e}")
            elif not boundary_file.exists():
                log_lines.append("Warning: polyMesh/boundary not found — skipping BC sync")
            elif not mapping_path.exists():
                log_lines.append("Warning: boundary_mapping.json not found — using template BCs")
            
            # Write log
            with open(log_file, 'w') as f:
                f.write("Settings applied:\n")
                for line in log_lines:
                    f.write(f"  - {line}\n")
            
            if log_callback:
                for line in log_lines:
                    await log_callback(run_id, {
                        "type": "log",
                        "step": "Apply Settings",
                        "line": line
                    })
            
            # Configure Function Objects (forces)
            analysis_settings = solver_settings.get('analysis_settings')
            if analysis_settings and analysis_settings.get("enabled", True):
                if log_callback:
                    await log_callback(run_id, {"type": "log", "step": "Apply Settings", "line": "Configuring function objects..."})
                
                # Get patches
                patches = analysis_settings.get("geometry_patches", ["propellerWalls"])
                if not patches or patches == ["auto"] or (isinstance(patches, str) and patches == "auto"):
                    # Auto detect? logic is tricky for AMI cases. default to propellerWalls and rotorAMI?
                    # Usually "propellerWalls" is the correct patch group.
                    patches = ["propellerWalls"]
                
                rho = material_settings.get("density", 1.225)
                
                # Generate forces dict
                forces_content = self.fo_manager.generate_forces_dict(
                    name="forces",
                    patches=patches,
                    rho_val=rho,
                    cofr=solver_settings.get("rotation_origin", [0, 0, 0])
                )
                
                # Inject
                control_dict = stator_dir / "system" / "controlDict"
                if control_dict.exists():
                    content = control_dict.read_text()
                    new_objects = {"forces": forces_content}
                    new_content = self.fo_manager.update_controldict(content, new_objects)
                    control_dict.write_text(new_content)
                    
                    if log_callback:
                        await log_callback(run_id, {"type": "log", "step": "Apply Settings", "line": "Injected forces functionObject"})

            return True, "Settings applied"
            
        except Exception as e:
            return False, str(e)
    
    async def _run_solver(self, run_id, run_dir, logs_dir, solver_settings, material_settings, inlet_velocity, log_callback):
        """Run the OpenFOAM solver."""
        stator_dir = run_dir / "propCase" / "stator"
        log_file = logs_dir / "08_solver.log"
        
        solver = solver_settings.get("solver", "pimpleFoam")
        parallel = solver_settings.get("parallel", False)
        num_cores = solver_settings.get("num_cores", 4)
        
        if parallel:
            # Decompose
            decompose_log = logs_dir / "08a_decomposePar.log"
            success, output, rc = await self.run_cmd_async(
                "decomposePar -force",
                stator_dir,
                decompose_log,
                run_id,
                "Decompose",
                log_callback
            )
            
            if not success:
                return False, "Failed to decompose mesh"
            
            # Run parallel
            success, output, rc = await self.run_cmd_async(
                f"mpirun -np {num_cores} {solver} -parallel",
                stator_dir,
                log_file,
                run_id,
                f"Solver ({solver})",
                log_callback
            )
            
            if success:
                # Reconstruct
                reconstruct_log = logs_dir / "08b_reconstructPar.log"
                await self.run_cmd_async(
                    "reconstructPar",
                    stator_dir,
                    reconstruct_log,
                    run_id,
                    "Reconstruct",
                    log_callback
                )
        else:
            # Run serial
            success, output, rc = await self.run_cmd_async(
                solver,
                stator_dir,
                log_file,
                run_id,
                f"Solver ({solver})",
                log_callback
            )
        
        if success:
            return True, f"Solver {solver} completed"
        else:
            return False, f"Solver failed (rc={rc})"
    
    def stop_workflow(self, run_id: str) -> bool:
        """Stop a running workflow."""
        if run_id in self.active_processes:
            process = self.active_processes[run_id]
            try:
                process.terminate()
                process.kill()
                del self.active_processes[run_id]
                self.job_manager.update_job(run_id, status="stopped")
                return True
            except:
                pass
        return False
    
    async def run_smoke_test(self, test_id: str, log_callback: Optional[Callable] = None):
        """Run a quick smoke test."""
        
        if log_callback:
            await log_callback(test_id, {
                "type": "log",
                "step": "Smoke Test",
                "line": "Starting smoke test..."
            })
        
        # Check OpenFOAM version
        success, output, rc = self.run_cmd_sync("foamVersion", Path.cwd())
        
        if log_callback:
            await log_callback(test_id, {
                "type": "log",
                "step": "foamVersion",
                "line": f"OpenFOAM version: {output.strip()}" if success else f"Error: {output}"
            })
        
        if log_callback:
            await log_callback(test_id, {
                "type": "complete",
                "message": "Smoke test completed" if success else "Smoke test failed"
            })
    
    def get_patches(self, run_dir: Path) -> List[Dict]:
        """Read patches from boundary file."""
        boundary_file = run_dir / "propCase" / "stator" / "constant" / "polyMesh" / "boundary"
        patches = []
        
        if not boundary_file.exists():
            return patches
        
        try:
            with open(boundary_file, 'r') as f:
                content = f.read()
            
            pattern = r'(\w+)\s*\{\s*type\s+(\w+);[^}]*nFaces\s+(\d+);[^}]*\}'
            matches = re.findall(pattern, content, re.DOTALL)
            
            for name, ptype, nfaces in matches:
                patches.append({
                    'name': name,
                    'type': ptype,
                    'nFaces': int(nfaces),
                    'locked': name in self.AMI_PATCHES,
                    'expected': name in self.STATOR_PATCHES + self.ROTOR_PATCHES
                })
            
        except Exception as e:
            print(f"Error reading boundary file: {e}")
        
        return patches

    async def _run_analysis(self, run_id, run_dir, logs_dir, solver_settings, material_settings, inlet_velocity, log_callback):
        """Run performance analysis."""
        analysis_settings = solver_settings.get('analysis_settings')
        if not analysis_settings or not analysis_settings.get("enabled", True):
            return True, "Analysis disabled"
            
        try:
            analysis_config = analysis_settings.copy()
            analysis_config['rho'] = material_settings.get("density", 1.225)
            # Add RPM for potential calculations
            analysis_config['rpm'] = float(solver_settings.get("rotation_rpm", 0))
            
            # Analyze using stator directory (where controlDict and forces usually reside now)
            summary = self.analyzer.analyze_propeller(
                case_dir=run_dir / "propCase" / "stator",
                config=analysis_config
            )
            
            if "error" not in summary:
                self.analyzer.save_summary(summary, run_dir)
                
                metrics = summary.get('metrics', {})
                msg = f"Thrust: {metrics.get('thrust', 0):.2f} N, Torque: {metrics.get('torque', 0):.2f} Nm"
                return True, f"Analysis complete. {msg}"
            else:
                return True, f"Analysis skipped: {summary.get('error')}"
                
        except Exception as e:
             return False, f"Analysis failed: {str(e)}"
