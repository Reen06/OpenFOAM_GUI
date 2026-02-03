# Propeller Module

The Propeller module simulates rotating machinery using OpenFOAM's sliding mesh (AMI) approach.

## Overview

This module is designed for:
- Propeller thrust and torque analysis
- Rotating machinery simulations
- Ducted propeller configurations
- Rotor-stator interaction studies

## Workflow

```mermaid
graph LR
    A[Upload Rotor Mesh] --> B[Upload Stator Mesh]
    B --> C[Configure RPM]
    C --> D[Run Solver]
    D --> E[View Results]
```

### 1. Mesh Requirements

The propeller simulation requires **two separate meshes**:

#### Rotor Mesh
- Contains the propeller/rotor geometry
- Will rotate during simulation
- Must have AMI interface patches

#### Stator Mesh  
- Contains the surrounding domain (inlet, outlet, walls)
- Remains stationary
- Must have matching AMI interface patches

### 2. Configuration

#### Rotation Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| RPM | Rotations per minute | 1000 |
| Rotation Axis | Axis of rotation | (0, 0, 1) |
| Origin | Center of rotation | (0, 0, 0) |

#### Flow Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| Inlet Velocity | Advance velocity (m/s) | 5.0 |
| Density | Fluid density (kg/m³) | 1.225 |

#### Solver Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| End Time | Simulation end time | 0.1 |
| Delta T | Time step (auto-calculated) | based on RPM |
| Max Courant | Maximum CFL number | 1.0 |

### 3. AMI Interface

The Arbitrary Mesh Interface (AMI) allows non-conformal mesh coupling:

```
rotor side:  AMI_rotor   <-->  AMI_stator  :stator side
```

The module automatically:
- Detects interface patches
- Configures `cyclicAMI` boundaries
- Sets up `dynamicMeshDict` for rotation

### 4. Running

Uses `pimpleFoam` (transient incompressible) with:
- Rotating mesh via `dynamicMotionSolverFvMesh`
- `solidBodyMotionFvMesh` with `rotatingMotion`

### 5. Results

After completion:
- **Thrust**: Axial force on rotor
- **Torque**: Moment about rotation axis
- **Power**: Torque × angular velocity
- **Efficiency**: Thrust × velocity / Power

## OpenFOAM Configuration

### Dynamic Mesh

```cpp
// dynamicMeshDict
dynamicFvMesh   dynamicMotionSolverFvMesh;
motionSolver    solidBody;
cellZone        rotorCells;
solidBodyMotionFunction rotatingMotion;

origin    (0 0 0);
axis      (0 0 1);
omega     104.72; // rad/s = RPM * 2π/60
```

### Cell Zones

The rotor mesh cells are assigned to `rotorCells` zone for rotation.

### Function Objects

Automatically configured to extract:
- Forces on rotor patches
- Moments about rotation axis
- Time-averaged values

## File Structure

```
modules/propeller/
├── backend/
│   ├── main.py          # FastAPI app
│   ├── workflow.py      # Case generation (AMI setup)
│   ├── job_manager.py   # Process control
│   ├── run_manager.py   # Saved runs
│   ├── mesh_library.py  # Mesh handling
│   └── mesh_manager.py  # Rotor/stator merging
├── frontend/
│   ├── index.html
│   ├── css/
│   └── js/
├── templates/           # OpenFOAM templates
│   ├── 0/
│   ├── constant/
│   └── system/
├── propCase/           # Working case directory
├── runs/               # Saved simulations
├── meshes/             # Uploaded meshes
└── module.json
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/propeller/` | GET | Module UI |
| `/propeller/api/meshes` | GET | List meshes |
| `/propeller/api/meshes/upload` | POST | Upload mesh |
| `/propeller/api/run` | POST | Start simulation |
| `/propeller/api/stop` | POST | Stop simulation |
| `/propeller/api/status` | GET | Current status |
| `/propeller/api/runs` | GET | List saved runs |
| `/propeller/ws/logs/{id}` | WS | Live log stream |

## Mesh Preparation Tips

### Creating Compatible Meshes

1. **Rotor mesh**: 
   - Model propeller geometry
   - Create cylindrical interface surface
   - Name it consistently (e.g., `AMI_rotor`)

2. **Stator mesh**:
   - Create domain with inlet/outlet
   - Create matching cylindrical interface
   - Name it to match (e.g., `AMI_stator`)

3. **Interface alignment**:
   - Same radius
   - Same axial position
   - Same circumferential extent

### Salome Workflow

```
1. Create rotor geometry → Mesh with Netgen
2. Create stator geometry → Mesh with Netgen
3. Export both as UNV files
4. Upload to GUI
```

## Performance Coefficients

The module calculates standard propeller coefficients:

| Coefficient | Formula | Description |
|-------------|---------|-------------|
| Kt | T / (ρ n² D⁴) | Thrust coefficient |
| Kq | Q / (ρ n² D⁵) | Torque coefficient |
| J | V / (n D) | Advance ratio |
| η | J Kt / (2π Kq) | Efficiency |

Where:
- T = Thrust
- Q = Torque
- ρ = Density
- n = Rotations per second
- D = Propeller diameter
- V = Advance velocity

## Related

- [Wind Tunnel Module](wind_tunnel.md)
- [Performance Analysis](performance.md)
- [Architecture](architecture.md)
