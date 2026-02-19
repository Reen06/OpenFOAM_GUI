"""
OpenFOAM FunctionObject Manager
Shared module for generating and managing functionObjects in controlDict.
"""

import re
from pathlib import Path
from typing import List, Dict, Tuple, Optional, Any, Union

class FunctionObjectManager:
    """
    Manages OpenFOAM functionObjects (forces, forceCoeffs, etc.)
    """
    
    def __init__(self):
        pass

    def generate_forces_dict(self, 
                            name: str,
                            patches: List[str], 
                            rho_name: str = "rhoInf",
                            rho_val: float = 1.225,
                            cofr: List[float] = [0, 0, 0]) -> str:
        """Generate forces functionObject dictionary content."""
        
        # Format patch list for OpenFOAM: (patch1 patch2)
        patch_str = "(" + " ".join(patches) + ")"
        cofr_str = f"({cofr[0]} {cofr[1]} {cofr[2]})"
        
        return f"""
    {name}
    {{
        type            forces;
        libs            (forces);
        writeControl    timeStep;
        writeInterval   1;
        
        patches         {patch_str};
        rho             {rho_name};
        {rho_name}          {rho_val};
        
        CofR            {cofr_str};
    }}
"""

    def generate_force_coeffs_dict(self, 
                                  name: str,
                                  patches: List[str], 
                                  rho_name: str = "rhoInf",
                                  rho_val: float = 1.225,
                                  u_inf: float = 10.0,
                                  l_ref: float = 1.0,
                                  a_ref: float = 1.0,
                                  cofr: List[float] = [0, 0, 0],
                                  lift_dir: List[float] = [0, 0, 1],
                                  drag_dir: List[float] = [1, 0, 0],
                                  pitch_axis: List[float] = [0, 1, 0]) -> str:
        """Generate forceCoeffs functionObject dictionary content."""
        
        patch_str = "(" + " ".join(patches) + ")"
        cofr_str = f"({cofr[0]} {cofr[1]} {cofr[2]})"
        lift_str = f"({lift_dir[0]} {lift_dir[1]} {lift_dir[2]})"
        drag_str = f"({drag_dir[0]} {drag_dir[1]} {drag_dir[2]})"
        pitch_str = f"({pitch_axis[0]} {pitch_axis[1]} {pitch_axis[2]})"
        
        return f"""
    {name}
    {{
        type            forceCoeffs;
        libs            (forces);
        writeControl    timeStep;
        writeInterval   1;

        patches         {patch_str};
        rho             {rho_name};
        {rho_name}          {rho_val};
        
        magUInf         {u_inf};
        lRef            {l_ref};
        Aref            {a_ref};
        
        CofR            {cofr_str};
        liftDir         {lift_str};
        dragDir         {drag_str};
        pitchAxis       {pitch_str};
    }}
"""

    def update_controldict(self, 
                          content: str, 
                          function_objects: Dict[str, str]) -> str:
        """
        Inject or update functionObjects in controlDict content.
        function_objects: dict of {name: content_string}
        """
        
        # check if functions block exists
        functions_match = re.search(r'functions\s*\{', content)
        
        if functions_match:
            # Block exists, we need to insert/replace inside
            # This is tricky with regex/string manipulation without full parser
            # Strategy: Split content into pre-functions, functions block, post-functions
            # But finding matching brace is hard with regex.
            
            # Simplified strategy: 
            # 1. If function object 'name' exists, replace it? Hard to find bounds.
            # 2. Append new ones at the end of functions block?
            
            # We'll use a pragmatic approach: 
            # If `name` exists in content, we assume it's defined and try to replace its block? Too risky.
            # Safe approach: If `name` exists, Disable it / Remove it / Replace it?
            
            # Better approach for this task:
            # We control the templates.
            # Wind Tunnel template has `forces1`.
            # Propeller template has `forces`.
            
            # If we find `name` { ... }, we replace the whole block if possible.
            # If we fail to find exact block bounds, maybe just use python brace counting.
            
            idx = functions_match.end()
            balance = 1
            block_end = -1
            
            for i in range(idx, len(content)):
                if content[i] == '{':
                    balance += 1
                elif content[i] == '}':
                    balance -= 1
                    
                if balance == 0:
                    block_end = i
                    break
            
            if block_end == -1:
                return content # Failed to find end of functions block
                
            functions_body = content[idx:block_end]
            
            new_body = functions_body
            
            for name, obj_content in function_objects.items():
                # Check if name already exists in body
                # name followed by {
                check_pattern = rf'\b{name}\s*\{{'
                if re.search(check_pattern, new_body):
                    # It exists. We should try to remove it or update it.
                    # Removing via regex is safest if we can match the block.
                    # But nested braces...
                    
                    # Hack: Just append "Override" version with a new name? No, duplicates are bad.
                    # If we can't robustly replace, maybe we disable the old one?
                    # `enabled false;`?
                    
                    # Let's try to remove it using brace counting on the substring
                    obj_start_match = re.search(check_pattern, new_body)
                    if obj_start_match:
                        start_pos = obj_start_match.start()
                        inner_idx = obj_start_match.end()
                        inner_balance = 1
                        obj_end = -1
                        for k in range(inner_idx, len(new_body)):
                            if new_body[k] == '{':
                                inner_balance += 1
                            elif new_body[k] == '}':
                                inner_balance -= 1
                            if inner_balance == 0:
                                obj_end = k + 1 # Include closing brace
                                break
                        
                        if obj_end != -1:
                            # Remove the old block
                            new_body = new_body[:start_pos] + new_body[obj_end:]
            
            # Now append new objects
            for name, obj_content in function_objects.items():
                new_body += "\n" + obj_content
                
            # Reassemble
            return content[:idx] + new_body + content[block_end:]
            
        else:
            # Create functions block at end of file (before last comment or something)
            # Or just append it before #include statements?
            # Standard place: end of file.
            
            new_block = "\nfunctions\n{"
            for name, obj_content in function_objects.items():
                new_block += obj_content
            new_block += "\n}\n"
            
            # Insert before last line? Or replacing comment?
            # Append is safest.
            return content + "\n" + new_block

