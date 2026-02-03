# Wind Tunnel Module

The Wind Tunnel module provides external aerodynamics simulation for analyzing bodies in uniform flow.

## Overview

This module is designed for:
- Drag and lift analysis of vehicles, aircraft, and other bodies
- External flow simulations with boundary layer resolution
- Force coefficient calculation (Cd, Cl, Cm)

## Workflow

```mermaid
graph LR
    A[Upload Mesh] --> B[Configure]
    B --> C[Run Solver]
    C --> D[View Results]
    D --> E[Save Run]
```

### 1. Mesh Upload

Upload your geometry mesh in supported formats:
- **UNV** (Universal File Format) - from Salome, etc.
- **MSH** (Gmsh format)

The mesh should:
- Have a defined inlet, outlet, and walls
- Include your geometry as a named patch (e.g., "model", "wing", "car")
- Be properly refined near the body for boundary layer resolution

### 2. Configuration

#### Flow Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| Velocity | Freestream velocity (m/s) | 10.0 |
| Density | Air density (kg/m³) | 1.225 |
| Kinematic Viscosity | ν (m²/s) | 1.5e-5 |

#### Turbulence Model

Options:
- **k-epsilon** - Standard two-equation model
- **k-omega SST** - Better for separated flows
- **Spalart-Allmaras** - One-equation model

#### Solver Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| End Time | Total simulation time | 1000 |
| Delta T | Time step | 1 |
| Write Interval | Output frequency | 100 |

### 3. Running

Click "Run Simulation" to start. You'll see:
- Live solver output in the log panel
- Progress bar with ETA estimate
- Storage usage tracking

### 4. Results

After completion:
- View force coefficients (Cd, Cl)
- Copy `.foam` file path for ParaView
- Analyze performance metrics

## OpenFOAM Configuration

### Solver

Uses `simpleFoam` (steady-state incompressible).

### Boundary Conditions

| Patch | Velocity | Pressure | k | omega/epsilon |
|-------|----------|----------|---|---------------|
| inlet | fixedValue | zeroGradient | fixedValue | fixedValue |
| outlet | zeroGradient | fixedValue | zeroGradient | zeroGradient |
| model | noSlip | zeroGradient | kqRWallFunction | omegaWallFunction |
| walls | slip | zeroGradient | zeroGradient | zeroGradient |

### Function Objects

The module automatically adds `forces` function objects to extract:
- Pressure force (Fx, Fy, Fz)
- Viscous force
- Total force
- Moments

## File Structure

```
modules/wind_tunnel/
├── backend/
│   ├── main.py          # FastAPI app
│   ├── workflow.py      # Case generation
│   ├── job_manager.py   # Process control
│   ├── run_manager.py   # Saved runs
│   └── mesh_library.py  # Mesh handling
├── frontend/
│   ├── index.html
│   ├── css/
│   └── js/
├── templates/           # OpenFOAM templates
│   ├── 0/              # Initial conditions
│   ├── constant/       # Physical properties
│   └── system/         # Solver settings
├── runs/               # Simulation outputs
├── meshes/             # Uploaded meshes
└── module.json
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/windtunnel/` | GET | Module UI |
| `/windtunnel/api/meshes` | GET | List meshes |
| `/windtunnel/api/meshes/upload` | POST | Upload mesh |
| `/windtunnel/api/run` | POST | Start simulation |
| `/windtunnel/api/stop` | POST | Stop simulation |
| `/windtunnel/api/status` | GET | Current status |
| `/windtunnel/api/runs` | GET | List saved runs |
| `/windtunnel/ws/logs/{id}` | WS | Live log stream |

## Tips

1. **Mesh Quality**: Ensure y+ values are appropriate for your wall functions
2. **Convergence**: Watch residuals in the log - should decrease steadily
3. **Storage**: Enable "write latest only" for long runs to save disk space
4. **Performance**: Use the Performance tab to view extracted forces after completion

## Related

- [Propeller Module](propeller.md)
- [Performance Analysis](performance.md)
- [Architecture](architecture.md)
