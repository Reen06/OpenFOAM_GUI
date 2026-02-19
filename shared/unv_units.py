"""
UNV file unit parser.

Reads Dataset 164 from .unv files to detect the mesh unit system.
OpenFOAM assumes SI (meters). If a mesh is in different units,
the user should be warned.
"""

# Known UNV unit system codes (from I-DEAS universal file format spec)
UNV_UNIT_CODES = {
    1: {"name": "SI: Meter (newton)", "length_label": "m", "is_meter": True},
    2: {"name": "BG: Foot (pound f)", "length_label": "ft", "is_meter": False},
    3: {"name": "MG: Meter (kilogram f)", "length_label": "m", "is_meter": True},
    4: {"name": "BA: Foot (poundal)", "length_label": "ft", "is_meter": False},
    5: {"name": "MM: mm (milli-newton)", "length_label": "mm", "is_meter": False},
    6: {"name": "CM: cm (centi-newton)", "length_label": "cm", "is_meter": False},
    7: {"name": "IN: Inch (pound f)", "length_label": "in", "is_meter": False},
    8: {"name": "GM: mm (kilogram f)", "length_label": "mm", "is_meter": False},
    9: {"name": "US: User defined", "length_label": "?", "is_meter": False},
    10: {"name": "MN: mm (newton)", "length_label": "mm", "is_meter": False},
}


def parse_unv_units(file_path):
    """
    Parse a UNV file to extract unit information from Dataset 164.
    
    Returns a dict with:
        - unit_code: int, the UNV unit system code
        - unit_name: str, human-readable unit system name 
        - length_label: str, the length unit label (m, mm, in, ft, etc.)
        - is_meter: bool, True if units are in meters (safe for OpenFOAM)
        - length_scale: float, the length scale factor from the file
        - found: bool, True if Dataset 164 was found
    """
    result = {
        "found": False,
        "unit_code": None,
        "unit_name": "Unknown",
        "length_label": "?",
        "is_meter": None,
        "length_scale": None,
    }
    
    try:
        with open(file_path, 'r', errors='ignore') as f:
            lines = []
            in_dataset_164 = False
            
            for line in f:
                stripped = line.strip()
                
                # Look for dataset delimiter
                if stripped == '-1':
                    if in_dataset_164:
                        # End of dataset 164
                        break
                    # Next line could be dataset number
                    in_dataset_164 = False
                    lines = []
                    continue
                
                if not in_dataset_164:
                    # Check if this line is the dataset number 164
                    try:
                        if int(stripped) == 164:
                            in_dataset_164 = True
                            lines = []
                            continue
                    except ValueError:
                        pass
                else:
                    lines.append(stripped)
                    
                    # Dataset 164 has 3 lines:
                    # Line 1: unit_code  unit_description  temp_mode
                    # Line 2: length_scale  force_scale  temp_scale
                    # Line 3: temp_offset
                    if len(lines) >= 2:
                        # Parse line 1 for unit code
                        parts = lines[0].split()
                        if parts:
                            try:
                                unit_code = int(parts[0])
                                result["unit_code"] = unit_code
                                result["found"] = True
                                
                                # Get unit info from lookup table
                                unit_info = UNV_UNIT_CODES.get(unit_code, {
                                    "name": f"Unknown (code {unit_code})",
                                    "length_label": "?",
                                    "is_meter": False
                                })
                                result["unit_name"] = unit_info["name"]
                                result["length_label"] = unit_info["length_label"]
                                result["is_meter"] = unit_info["is_meter"]
                                
                                # Also check the description text for hints
                                desc = " ".join(parts[1:])
                                if desc:
                                    result["unit_description"] = desc
                            except (ValueError, IndexError):
                                pass
                        
                        # Parse line 2 for length scale factor
                        scale_parts = lines[1].split()
                        if scale_parts:
                            try:
                                length_scale = float(scale_parts[0])
                                result["length_scale"] = length_scale
                                
                                # Double-check: if length scale is 1.0, it's in the 
                                # unit system's base unit (which for code 1 = meters)
                                # If length scale is 0.001, mesh is in mm even if code says SI
                                if result["is_meter"] and abs(length_scale - 1.0) > 0.01:
                                    # Scale isn't 1.0 but unit says meter - unusual
                                    result["is_meter"] = False
                                    result["length_label"] = f"scaled ({length_scale})"
                            except (ValueError, IndexError):
                                pass
                        
                        break  # We have what we need
                        
    except Exception as e:
        result["error"] = str(e)
    
    return result
