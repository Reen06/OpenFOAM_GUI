#!/usr/bin/env python3
"""
OpenFOAM Workflow Manager - Blank Module Template

Handles execution of OpenFOAM commands with real-time log streaming.
Customize _apply_settings() and _run_solver() for your specific case.

See BLANK_MODULE_GUIDE.md for instructions.
"""

import os
import re
import shutil
import asyncio
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Tuple, Callable, Any


# ===========================================================================
# CASE_DIR_NAME: The name of the OpenFOAM case directory inside each run.
# Change this to match your case structure (e.g., "motorBikeCase", "cavityCase").
# ===========================================================================
CASE_DIR_NAME = "caseDir"


class WorkflowManager:
    """Manages OpenFOAM simulation workflows.
    
    TODO: Customize this class for your specific OpenFOAM case.
    The key methods to implement are:
      - _apply_settings(): Write your case files (controlDict, BCs, etc.)
      - _run_solver(): Run your OpenFOAM solver
    """
    
    def __init__(self, openfoam_bashrc: str, job_manager, run_manager=None):
        self.openfoam_bashrc = openfoam_bashrc
        self.job_manager = job_manager
        self.run_manager = run_manager
        self.running_processes: Dict[str, asyncio.subprocess.Process] = {}
    
    # ========================================================================
    # Command Execution Helpers (generic — no changes needed)
    # ========================================================================
    
    async def run_cmd_async(
        self,
        cmd: str,
        cwd: Path,
        log_file: Path,
        run_id: str,
        step_name: str,
        log_callback: Optional[Callable] = None
    ) -> Tuple[bool, str]:
        """Execute a command asynchronously with streaming output."""
        
        # Source OpenFOAM and run command
        full_cmd = f"source {self.openfoam_bashrc} && {cmd}"
        
        if log_callback:
            await log_callback(f"[{step_name}] Running: {cmd}")
        
        try:
            process = await asyncio.create_subprocess_shell(
                full_cmd,
                cwd=str(cwd),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                executable="/bin/bash"
            )
            
            self.running_processes[run_id] = process
            
            output_lines = []
            with open(log_file, "w") as f:
                while True:
                    line = await process.stdout.readline()
                    if not line:
                        break
                    
                    decoded = line.decode('utf-8', errors='replace').rstrip()
                    output_lines.append(decoded)
                    f.write(decoded + "\n")
                    f.flush()
                    
                    if log_callback:
                        await log_callback(decoded)
            
            await process.wait()
            
            if run_id in self.running_processes:
                del self.running_processes[run_id]
            
            success = process.returncode == 0
            if log_callback:
                status = "completed" if success else "failed"
                await log_callback(f"[{step_name}] {status} (exit code: {process.returncode})")
            
            return success, "\n".join(output_lines[-50:])
            
        except Exception as e:
            if log_callback:
                await log_callback(f"[{step_name}] ERROR: {str(e)}")
            return False, str(e)
    
    def run_cmd_sync(
        self,
        cmd: str,
        cwd: Path,
        log_file: Optional[Path] = None
    ) -> Tuple[bool, str]:
        """Execute a command synchronously."""
        full_cmd = f"source {self.openfoam_bashrc} && {cmd}"
        
        try:
            result = subprocess.run(
                full_cmd,
                shell=True,
                cwd=str(cwd),
                capture_output=True,
                text=True,
                executable="/bin/bash"
            )
            
            output = result.stdout + result.stderr
            
            if log_file:
                with open(log_file, "w") as f:
                    f.write(output)
            
            return result.returncode == 0, output
            
        except Exception as e:
            return False, str(e)
    
    # ========================================================================
    # Mesh Import (generic — works for .unv and .msh files)
    # ========================================================================
    
    async def create_polymesh(
        self,
        run_id: str,
        run_dir: Path,
        log_callback: Optional[Callable] = None
    ) -> bool:
        """Create polyMesh from uploaded mesh file."""
        
        case_dir = run_dir / CASE_DIR_NAME
        logs_dir = run_dir / "logs"
        logs_dir.mkdir(exist_ok=True)
        
        # Ensure constant directory exists
        (case_dir / "constant").mkdir(parents=True, exist_ok=True)
        
        if log_callback:
            await log_callback("[MESH] Starting mesh import...")
        
        # Check if polyMesh already exists
        polymesh_dir = case_dir / "constant" / "polyMesh"
        if polymesh_dir.exists() and (polymesh_dir / "points").exists():
            if log_callback:
                await log_callback("[MESH] polyMesh already exists")
            return True
        
        # Find mesh file in run directory
        mesh_files = list(run_dir.glob("*.unv")) + list(run_dir.glob("*.msh"))
        
        if not mesh_files:
            if log_callback:
                await log_callback("[MESH] ERROR: No mesh file found in run directory")
            return False
        
        mesh_file = mesh_files[0]
        
        # Copy mesh file to case directory for the converter
        case_mesh_file = case_dir / mesh_file.name
        if not case_mesh_file.exists():
            shutil.copy2(mesh_file, case_mesh_file)
            if log_callback:
                await log_callback(f"[MESH] Copied {mesh_file.name} to case directory")
        
        # Determine converter based on file extension
        if mesh_file.suffix.lower() == ".unv":
            cmd = f"ideasUnvToFoam {mesh_file.name}"
        elif mesh_file.suffix.lower() == ".msh":
            cmd = f"gmshToFoam {mesh_file.name}"
        else:
            if log_callback:
                await log_callback(f"[MESH] ERROR: Unsupported mesh format: {mesh_file.suffix}")
            return False
        
        success, output = await self.run_cmd_async(
            cmd,
            case_dir,
            logs_dir / "mesh_import.log",
            run_id,
            "MESH_IMPORT",
            log_callback
        )
        
        if not success:
            return False
        
        # Run checkMesh
        if log_callback:
            await log_callback("[MESH] Running checkMesh...")
        
        success, output = await self.run_cmd_async(
            "checkMesh",
            case_dir,
            logs_dir / "checkMesh.log",
            run_id,
            "CHECK_MESH",
            log_callback
        )
        
        return True  # checkMesh warnings are okay
    
    # ========================================================================
    # Simulation Workflow
    # ========================================================================
    
    async def run_simulation(
        self,
        run_id: str,
        run_dir: Path,
        case_settings: Dict,
        log_callback: Optional[Callable] = None
    ) -> bool:
        """Execute the complete simulation workflow.
        
        This is the main entry point called by main.py when a user
        clicks 'Run Simulation'. It:
          1. Applies settings to the case files
          2. Runs the solver
          3. (Optional) Runs post-processing
        """
        
        case_dir = run_dir / CASE_DIR_NAME
        logs_dir = run_dir / "logs"
        logs_dir.mkdir(exist_ok=True)
        
        started_at = datetime.now().isoformat()
        
        try:
            # Step 1: Apply settings to case files
            if log_callback:
                await log_callback("[WORKFLOW] Applying settings...")
            
            await self._apply_settings(
                run_id, case_dir, logs_dir,
                case_settings,
                log_callback
            )
            
            # Step 2: Run solver
            if log_callback:
                await log_callback("[WORKFLOW] Starting solver...")
            
            success = await self._run_solver(
                run_id, case_dir, logs_dir,
                case_settings,
                log_callback
            )
            
            completed_at = datetime.now().isoformat()
            
            # Record completion
            if self.run_manager:
                self.run_manager.record_solve_completion(
                    run_id=run_id,
                    solver_config=case_settings,
                    material_config={},
                    started_at=started_at,
                    completed_at=completed_at,
                    success=success
                )
            
            # TODO: Step 3: Add your post-processing here
            # Example:
            #   if success:
            #       await self._run_post_processing(run_id, case_dir, log_callback)
            
            if success and log_callback:
                await log_callback({
                    "type": "complete",
                    "message": "Simulation finished successfully"
                })
            
            return success
            
        except Exception as e:
            if log_callback:
                await log_callback(f"[WORKFLOW] ERROR: {str(e)}")
            return False
    
    async def _apply_settings(
        self,
        run_id: str,
        case_dir: Path,
        logs_dir: Path,
        case_settings: Dict,
        log_callback: Optional[Callable] = None
    ):
        """Apply case settings to OpenFOAM files.
        
        TODO: Implement this for your specific case.
        
        This method should:
          1. Update system/controlDict (endTime, deltaT, writeInterval, solver name)
          2. Update constant/ files (transportProperties, turbulenceProperties, etc.)
          3. Update 0/ boundary condition files (U, p, k, omega, etc.)
          4. Configure any function objects needed
        
        Example for a basic case:
        
            control_dict = case_dir / "system" / "controlDict"
            if control_dict.exists():
                content = control_dict.read_text()
                
                solver = case_settings.get("solver", "simpleFoam")
                content = re.sub(r'application\\s+\\w+;', f'application {solver};', content)
                
                end_time = case_settings.get("end_time", 1000)
                content = re.sub(r'endTime\\s+[\\d.e+-]+;', f'endTime {end_time};', content)
                
                delta_t = case_settings.get("delta_t", 1)
                content = re.sub(r'deltaT\\s+[\\d.e+-]+;', f'deltaT {delta_t};', content)
                
                control_dict.write_text(content)
        """
        if log_callback:
            await log_callback("[SETTINGS] TODO: Implement _apply_settings() for your case")
    
    async def _run_solver(
        self,
        run_id: str,
        case_dir: Path,
        logs_dir: Path,
        case_settings: Dict,
        log_callback: Optional[Callable] = None
    ) -> bool:
        """Run the OpenFOAM solver.
        
        TODO: Implement this for your specific case.
        
        Basic implementation (handles serial and parallel):
        
            solver = case_settings.get("solver", "simpleFoam")
            parallel = case_settings.get("parallel", False)
            num_cores = case_settings.get("num_cores", 4)
            
            if parallel:
                # Decompose
                success, _ = await self.run_cmd_async(
                    "decomposePar -force", case_dir,
                    logs_dir / "decomposePar.log", run_id, "DECOMPOSE", log_callback
                )
                if not success:
                    return False
                
                cmd = f"mpirun -np {num_cores} {solver} -parallel"
            else:
                cmd = solver
            
            success, _ = await self.run_cmd_async(
                cmd, case_dir,
                logs_dir / f"{solver}.log", run_id, "SOLVER", log_callback
            )
            
            if parallel and success:
                await self.run_cmd_async(
                    "reconstructPar", case_dir,
                    logs_dir / "reconstructPar.log", run_id, "RECONSTRUCT", log_callback
                )
            
            return success
        """
        if log_callback:
            await log_callback("[SOLVER] TODO: Implement _run_solver() for your case")
        return False
    
    # ========================================================================
    # Control & Utilities (generic — no changes needed)
    # ========================================================================
    
    def stop_workflow(self, run_id: str):
        """Stop a running workflow."""
        if run_id in self.running_processes:
            process = self.running_processes[run_id]
            try:
                process.terminate()
            except:
                pass
            del self.running_processes[run_id]
    
    def get_patches(self, case_dir: Path) -> List[Dict[str, str]]:
        """Read patches from boundary file."""
        boundary_file = case_dir / "constant" / "polyMesh" / "boundary"
        
        if not boundary_file.exists():
            return []
        
        patches = []
        content = boundary_file.read_text()
        
        # Simple regex to find patches
        pattern = r'(\w+)\s*\{\s*type\s+(\w+);'
        for match in re.finditer(pattern, content):
            patch_name = match.group(1)
            patch_type = match.group(2)
            
            patches.append({
                "name": patch_name,
                "type": patch_type,
                "category": "other"  # TODO: Add category detection for your patches
            })
        
        return patches
