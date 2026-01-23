#!/usr/bin/env python3
"""
OpenFOAM Workflow Manager for Static Wind Tunnel

Handles execution of OpenFOAM commands with real-time log streaming.
No AMI, no rotation - simple static domain workflow.
"""

import os
import re
import shutil
import asyncio
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Tuple, Callable, Any


class WorkflowManager:
    """Manages OpenFOAM simulation workflows for static wind tunnel."""
    
    # Standard patch names for wind tunnel
    INLET_PATCHES = ['inlet', 'inlet_stator', 'inflow']
    OUTLET_PATCHES = ['outlet', 'outlet_stator', 'outflow']
    WALL_PATCHES = ['walls', 'wall', 'sides', 'top', 'bottom', 'ground']
    OBJECT_PATCHES = ['model', 'object', 'body', 'car', 'wing']
    
    def __init__(self, openfoam_bashrc: str, job_manager, run_manager=None):
        self.openfoam_bashrc = openfoam_bashrc
        self.job_manager = job_manager
        self.run_manager = run_manager
        self.running_processes: Dict[str, asyncio.subprocess.Process] = {}
    
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
    
    async def create_polymesh(
        self,
        run_id: str,
        run_dir: Path,
        log_callback: Optional[Callable] = None
    ) -> bool:
        """Create polyMesh from uploaded mesh file."""
        
        case_dir = run_dir / "windTunnelCase"
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
        
        # Fix patch types in boundary file
        # Wall patches must be of type 'wall' for wall functions to work
        if log_callback:
            await log_callback("[MESH] Fixing patch types in boundary file...")
        
        await self._fix_boundary_patch_types(case_dir, log_callback)
        
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
    
    async def _fix_boundary_patch_types(
        self,
        case_dir: Path,
        log_callback: Optional[Callable] = None
    ):
        """Fix patch types in boundary file - change wall patches from 'patch' to 'wall'."""
        boundary_file = case_dir / "constant" / "polyMesh" / "boundary"
        
        if not boundary_file.exists():
            if log_callback:
                await log_callback("[MESH] Warning: boundary file not found")
            return
        
        content = boundary_file.read_text()
        original_content = content
        
        # List of patch names that should be type 'wall'
        wall_patch_names = ['walls', 'wall', 'model', 'body', 'object', 'ground', 
                           'top', 'bottom', 'sides', 'wing', 'car', 'vehicle']
        
        # Simple approach: find each wall patch block and change type patch -> wall
        for patch_name in wall_patch_names:
            # Look for pattern like: walls { type patch; -> walls { type wall;
            # This regex looks for the patch name followed by its block
            pattern = rf'({patch_name}\s*\{{\s*type\s+)patch(\s*;)'
            replacement = rf'\1wall\2'
            content = re.sub(pattern, replacement, content, flags=re.IGNORECASE)
        
        if content != original_content:
            boundary_file.write_text(content)
            if log_callback:
                await log_callback("[MESH] Fixed wall patch types in boundary file")
    
    async def run_simulation(
        self,
        run_id: str,
        run_dir: Path,
        solver_settings: Dict,
        material_settings: Dict,
        log_callback: Optional[Callable] = None
    ) -> bool:
        """Execute the complete wind tunnel simulation workflow."""
        
        case_dir = run_dir / "windTunnelCase"
        logs_dir = run_dir / "logs"
        logs_dir.mkdir(exist_ok=True)
        
        started_at = datetime.now().isoformat()
        
        try:
            # Step 1: Apply settings to case files
            if log_callback:
                await log_callback("[WORKFLOW] Applying settings...")
            
            await self._apply_settings(
                run_id, case_dir, logs_dir,
                solver_settings, material_settings,
                log_callback
            )
            
            # Step 2: Run solver
            if log_callback:
                await log_callback("[WORKFLOW] Starting solver...")
            
            success = await self._run_solver(
                run_id, case_dir, logs_dir,
                solver_settings,
                log_callback
            )
            
            completed_at = datetime.now().isoformat()
            
            # Record completion
            if self.run_manager:
                self.run_manager.record_solve_completion(
                    run_id=run_id,
                    solver_config=solver_settings,
                    material_config=material_settings,
                    started_at=started_at,
                    completed_at=completed_at,
                    success=success
                )
            
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
        solver_settings: Dict,
        material_settings: Dict,
        log_callback: Optional[Callable] = None
    ):
        """Apply solver and material settings to case files."""
        
        # Update controlDict
        control_dict = case_dir / "system" / "controlDict"
        if control_dict.exists():
            content = control_dict.read_text()
            
            # Update application
            solver = solver_settings.get("solver", "simpleFoam")
            content = re.sub(r'application\s+\w+;', f'application {solver};', content)
            
            # Update time settings
            end_time = solver_settings.get("end_time", 1000)
            delta_t = solver_settings.get("delta_t", 1)
            write_interval = solver_settings.get("write_interval", 100)
            write_control = solver_settings.get("write_control", "timeStep")
            purge_write = solver_settings.get("purge_write", 0)
            
            content = re.sub(r'endTime\s+[\d.e+-]+;', f'endTime {end_time};', content)
            content = re.sub(r'deltaT\s+[\d.e+-]+;', f'deltaT {delta_t};', content)
            content = re.sub(r'writeControl\s+\w+;', f'writeControl {write_control};', content)
            content = re.sub(r'writeInterval\s+[\d.e+-]+;', f'writeInterval {write_interval};', content)
            content = re.sub(r'purgeWrite\s+\d+;', f'purgeWrite {purge_write};', content)
            
            # Adaptive time stepping
            adjust_ts = "yes" if solver_settings.get("adjust_timestep", False) else "no"
            max_co = solver_settings.get("max_co", 0.5)
            
            # Ensure adjustTimeStep and maxCo entries exist or update them
            if 'adjustTimeStep' in content:
                content = re.sub(r'adjustTimeStep\s+\w+;', f'adjustTimeStep {adjust_ts};', content)
            else:
                content = content.replace('purgeWrite', f'adjustTimeStep {adjust_ts};\npurgeWrite')
                
            if 'maxCo' in content:
                content = re.sub(r'maxCo\s+[\d.]+;', f'maxCo {max_co};', content)
            else:
                content = content.replace('purgeWrite', f'maxCo {max_co};\npurgeWrite')
            
            # Add maxDeltaT support
            max_delta_t = solver_settings.get("max_delta_t", 1e-4)
            if 'maxDeltaT' in content:
                content = re.sub(r'maxDeltaT\s+[\d.e+-]+;', f'maxDeltaT {max_delta_t};', content)
            else:
                content = content.replace('purgeWrite', f'maxDeltaT {max_delta_t};\npurgeWrite')
            
            control_dict.write_text(content)
            
            if log_callback:
                await log_callback(f"[SETTINGS] Updated controlDict: solver={solver}, endTime={end_time}")
        
        # Update transportProperties
        transport_props = case_dir / "constant" / "transportProperties"
        if transport_props.exists():
            content = transport_props.read_text()
            
            nu = material_settings.get("kinematic_viscosity", 1.5e-5)
            content = re.sub(r'nu\s+\[\s*0\s+2\s+-1\s+0\s+0\s+0\s+0\s*\]\s*[\d.e+-]+;',
                           f'nu [0 2 -1 0 0 0 0] {nu};', content)
            
            transport_props.write_text(content)
            
            if log_callback:
                await log_callback(f"[SETTINGS] Updated transportProperties: nu={nu}")
        
        # Update turbulenceProperties
        turb_props = case_dir / "constant" / "turbulenceProperties"
        if turb_props.exists():
            content = turb_props.read_text()
            
            turb_model = solver_settings.get("turbulence_model", "kOmegaSST")
            content = re.sub(r'RASModel\s+\w+;', f'RASModel {turb_model};', content)
            
            turb_props.write_text(content)
            
            if log_callback:
                await log_callback(f"[SETTINGS] Updated turbulenceProperties: model={turb_model}")
        
        # Update boundary conditions (0/ files)
        inlet_velocity = solver_settings.get("inlet_velocity", [10, 0, 0])
        wall_type = solver_settings.get("wall_type", "slip")
        wall_slip_fraction = solver_settings.get("wall_slip_fraction", 0.5)
        
        # Update U file
        u_file = case_dir / "0" / "U"
        if u_file.exists():
            content = u_file.read_text()
            vel_str = f"({inlet_velocity[0]} {inlet_velocity[1]} {inlet_velocity[2]})"
            content = re.sub(r'value\s+uniform\s+\([^)]+\);', f'value uniform {vel_str};', content, count=1)
            
            # Update wall type
            if wall_type == "noSlip":
                content = re.sub(r'(walls\s*\{[^}]*type\s+)slip;', r'\1noSlip;', content)
            elif wall_type == "partialSlip":
                # OpenFOAM partialSlip: valueFraction 0 = full slip, 1 = no-slip
                # Our slider: 0% = no-slip, 100% = full slip
                # So we invert: valueFraction = 1 - wall_slip_fraction
                value_fraction = 1.0 - wall_slip_fraction
                partial_slip_block = f"""walls
    {{
        type            partialSlip;
        valueFraction   uniform {value_fraction};
        value           uniform (0 0 0);
    }}"""
                # Replace the walls block
                content = re.sub(
                    r'walls\s*\{[^}]*type\s+\w+;[^}]*\}',
                    partial_slip_block,
                    content
                )
            
            u_file.write_text(content)
            
        # Update fvSolution
        fv_solution = case_dir / "system" / "fvSolution"
        if fv_solution.exists():
            content = fv_solution.read_text()
            
            # Update correctors and residual control
            n_inner = solver_settings.get("n_inner_correctors", 2)
            n_non_ortho = solver_settings.get("n_non_ortho_correctors", 0)
            res_p = solver_settings.get("res_p", 1e-4)
            res_u = solver_settings.get("res_u", 1e-4)
            
            # PIMPLE correctors
            content = re.sub(r'nCorrectors\s+\d+;', f'nCorrectors {n_inner};', content)
            content = re.sub(r'nNonOrthogonalCorrectors\s+\d+;', f'nNonOrthogonalCorrectors {n_non_ortho};', content)
            
            # SIMPLE residual control
            if 'residualControl' in content:
                content = re.sub(r'(p\s+)[\d.e-]+;', f'\\g<1>{res_p};', content)
                content = re.sub(r'(U\s+)[\d.e-]+;', f'\\g<1>{res_u};', content)
            
            fv_solution.write_text(content)
            
        # Update fvSchemes
        fv_schemes = case_dir / "system" / "fvSchemes"
        if fv_schemes.exists():
            content = fv_schemes.read_text()
            
            ddt_scheme = solver_settings.get("ddt_scheme", "steadyState")
            div_u = solver_settings.get("div_scheme_u", "linearUpwind")
            div_turb = solver_settings.get("div_scheme_turb", "upwind")
            
            # Map simplified names to OpenFOAM strings
            u_scheme_str = "bounded Gauss linearUpwind grad(U)" if div_u == "linearUpwind" else "bounded Gauss upwind"
            turb_scheme_str = "bounded Gauss upwind" if div_turb == "upwind" else "bounded Gauss linearUpwind default"
            
            content = re.sub(r'(ddtSchemes\s*\{[^}]*default\s+)\w+;', f'\\g<1>{ddt_scheme};', content)
            content = re.sub(r'div\(phi,U\)\s+[^;]+;', f'div(phi,U) {u_scheme_str};', content)
            
            # Update turbulence div schemes
            for field in ['k', 'omega', 'epsilon']:
                content = re.sub(rf'div\(phi,{field}\)\s+[^;]+;', f'div(phi,{field}) {turb_scheme_str};', content)
                
            fv_schemes.write_text(content)
    
    async def _run_solver(
        self,
        run_id: str,
        case_dir: Path,
        logs_dir: Path,
        solver_settings: Dict,
        log_callback: Optional[Callable] = None
    ) -> bool:
        """Run the OpenFOAM solver."""
        
        solver = solver_settings.get("solver", "simpleFoam")
        parallel = solver_settings.get("parallel", False)
        num_cores = solver_settings.get("num_cores", 4)
        
        if parallel:
            # Decompose
            if log_callback:
                await log_callback("[SOLVER] Decomposing for parallel run...")
            
            # Update decomposeParDict
            decompose_dict = case_dir / "system" / "decomposeParDict"
            if decompose_dict.exists():
                content = decompose_dict.read_text()
                content = re.sub(r'numberOfSubdomains\s+\d+;', f'numberOfSubdomains {num_cores};', content)
                decompose_dict.write_text(content)
            
            success, _ = await self.run_cmd_async(
                "decomposePar -force",
                case_dir,
                logs_dir / "decomposePar.log",
                run_id,
                "DECOMPOSE",
                log_callback
            )
            
            if not success:
                return False
            
            # Run parallel
            cmd = f"mpirun -np {num_cores} {solver} -parallel"
        else:
            cmd = solver
        
        if log_callback:
            await log_callback(f"[SOLVER] Running {solver}...")
        
        success, _ = await self.run_cmd_async(
            cmd,
            case_dir,
            logs_dir / f"{solver}.log",
            run_id,
            "SOLVER",
            log_callback
        )
        
        if parallel and success:
            # Reconstruct
            if log_callback:
                await log_callback("[SOLVER] Reconstructing parallel results...")
            
            await self.run_cmd_async(
                "reconstructPar",
                case_dir,
                logs_dir / "reconstructPar.log",
                run_id,
                "RECONSTRUCT",
                log_callback
            )
        
        return success
    
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
            
            # Determine category
            category = "other"
            if any(p in patch_name.lower() for p in ['inlet', 'inflow']):
                category = "inlet"
            elif any(p in patch_name.lower() for p in ['outlet', 'outflow']):
                category = "outlet"
            elif any(p in patch_name.lower() for p in ['wall', 'sides', 'top', 'bottom', 'ground']):
                category = "wall"
            elif any(p in patch_name.lower() for p in ['model', 'object', 'body']):
                category = "object"
            
            patches.append({
                "name": patch_name,
                "type": patch_type,
                "category": category
            })
        
        return patches
