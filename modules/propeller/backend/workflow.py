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
except ImportError:
    # Fallback for direct execution
    import sys
    sys.path.append(str(Path(__file__).parent.parent.parent))
    from shared.performance_analyzer import PerformanceAnalyzer
    from shared.functionobject_manager import FunctionObjectManager


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
        
        logs_dir = run_dir / "logs"
        logs_dir.mkdir(exist_ok=True)
        
        # Dummy settings for the step functions
        solver_settings = {}
        material_settings = {}
        inlet_velocity = None
        
        steps = [
            ("Importing rotor mesh", self._import_rotor),
            ("Importing stator mesh", self._import_stator),
            ("Merging meshes", self._merge_meshes),
            ("Configuring AMI patches", self._set_ami_patches),
        ]
        
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
        
        # Get patches from boundary file
        patches = self.get_patches(run_dir)
        
        if log_callback:
            await log_callback(run_id, {
                "type": "complete",
                "message": f"PolyMesh created successfully. Found {len(patches)} patches."
            })
        
        return {"success": True, "message": "PolyMesh created", "patches": patches}
    
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
    
    async def _import_rotor(self, run_id, run_dir, logs_dir, solver_settings, material_settings, inlet_velocity, log_callback):
        """Import rotor mesh using ideasUnvToFoam."""
        rotor_dir = run_dir / "propCase" / "rotor"
        log_file = logs_dir / "01_rotor_import.log"
        
        success, output, rc = await self.run_cmd_async(
            "ideasUnvToFoam rotor.unv",
            rotor_dir,
            log_file,
            run_id,
            "Import Rotor",
            log_callback
        )
        
        if success:
            cells_match = re.search(r'cells:\s*(\d+)', output)
            cells = cells_match.group(1) if cells_match else "unknown"
            return True, f"Rotor mesh imported: {cells} cells"
        else:
            return False, f"Failed to import rotor mesh (rc={rc})"
    
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
    
    async def _merge_meshes(self, run_id, run_dir, logs_dir, solver_settings, material_settings, inlet_velocity, log_callback):
        """Merge rotor and stator meshes."""
        prop_case = run_dir / "propCase"
        log_file = logs_dir / "03_merge_meshes.log"
        
        success, output, rc = await self.run_cmd_async(
            "mergeMeshes -overwrite stator rotor",
            prop_case,
            log_file,
            run_id,
            "Merge Meshes",
            log_callback
        )
        
        if success:
            cells_match = re.search(r'cells:\s*(\d+)', output)
            cells = cells_match.group(1) if cells_match else "unknown"
            return True, f"Meshes merged: {cells} total cells"
        else:
            return False, f"Failed to merge meshes (rc={rc})"
    
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
        """Create rotor cellZone using topoSet."""
        stator_dir = run_dir / "propCase" / "stator"
        log_file = logs_dir / "05_toposet.log"
        
        # Create topoSetDict if not exists
        toposet_dict = stator_dir / "system" / "topoSetDict"
        if not toposet_dict.exists():
            toposet_content = """/*--------------------------------*- C++ -*----------------------------------*\\
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
    class       dictionary;
    object      topoSetDict;
}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

actions
(
    {
        name    rotorCells;
        type    cellSet;
        action  new;
        source  zoneToCell;
        zone    rotor;
    }
    {
        name    rotorCells;
        type    cellZoneSet;
        action  new;
        source  setToCellZone;
        set     rotorCells;
    }
);

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
        
        if success or "rotorCells" in output:
            return True, "Rotor cellZone created"
        else:
            # Try alternative: setSet
            log_file2 = logs_dir / "05_setset.log"
            setset_cmds = "cellSet rotorCells new zoneToCell rotor\ncellZoneSet rotorCells new setToCellZone rotorCells\nquit\n"
            
            proc = subprocess.run(
                ['bash', '-c', f'. {self.openfoam_bashrc} && echo "{setset_cmds}" | setSet -batch'],
                cwd=str(stator_dir),
                capture_output=True,
                text=True
            )
            
            with open(log_file2, 'w') as f:
                f.write(proc.stdout + proc.stderr)
            
            if proc.returncode == 0:
                return True, "Rotor cellZone created (via setSet)"
            else:
                return False, f"Failed to create cellZone (rc={rc})"
    
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
            
            # Update dynamicMeshDict with optional ramp-up
            dynamic_dict = stator_dir / "constant" / "dynamicMeshDict"
            if dynamic_dict.exists():
                # Convert RPM to rad/s
                target_omega = solver_settings["rotation_rpm"] * 2 * 3.14159265 / 60
                
                # Reverse direction (counterclockwise) = negate omega
                if solver_settings.get("reverse_direction", False):
                    target_omega = -target_omega
                
                origin = solver_settings.get("rotation_origin", [0, 0, 0])
                axis = solver_settings.get("rotation_axis", [0, 0, 1])
                
                enable_rampup = solver_settings.get("enable_rampup", False)
                ramp_duration = solver_settings.get("ramp_duration", 0.02)
                
                if enable_rampup and ramp_duration > 0:
                    # Create dynamicMeshDict with omega as a table function
                    # IMPORTANT: Table must extend to at least endTime to avoid interpolation errors
                    end_time = solver_settings.get("end_time", 0.1)
                    # Add extra time beyond endTime to be safe
                    table_end_time = max(end_time * 2, ramp_duration + 1.0)
                    
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
            
            # Update transportProperties
            transport_props = stator_dir / "constant" / "transportProperties"
            if transport_props.exists():
                with open(transport_props, 'r') as f:
                    content = f.read()
                
                content = re.sub(r'nu\s+[\d.e+-]+;', f'nu              {material_settings["kinematic_viscosity"]};', content)
                
                with open(transport_props, 'w') as f:
                    f.write(content)
                
                log_lines.append(f"Updated transportProperties: nu={material_settings['kinematic_viscosity']}")
            
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
