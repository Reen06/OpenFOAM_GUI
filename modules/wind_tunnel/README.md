# OpenFOAM Web Wind Tunnel GUI

A web-based GUI for static wind tunnel CFD simulations using OpenFOAM.

## Quick Start

### 1. Install Dependencies

```bash
cd OpenFOAM_WebWindTunnelGUI
pip3 install -r requirements.txt
```

### 2. Start the Server

```bash
chmod +x start.sh
./start.sh
```

### 3. Open in Browser

Navigate to: **http://localhost:6061**

## Features

- **Run Manager**: Create and manage simulation runs
- **Mesh Library**: Store and reuse wind tunnel meshes
- **Boundary Mapper**: View and verify patch assignments
- **Materials**: Configure fluid properties (air, water, custom)
- **Solver Controls**: Choose solver (simpleFoam, pimpleFoam) and turbulence model (k-omega SST, k-epsilon, etc.)
- **Live Logs**: Real-time WebSocket log streaming
- **ParaView Helper**: Calculate video settings

## Supported Solvers

| Solver | Type |
|--------|------|
| simpleFoam | Steady, incompressible |
| pimpleFoam | Transient, incompressible |
| rhoSimpleFoam | Steady, compressible |
| rhoPimpleFoam | Transient, compressible |

## Turbulence Models

- k-omega SST (default)
- k-epsilon
- RNG k-epsilon
- Spalart-Allmaras
- Laminar

## Directory Structure

```
OpenFOAM_WebWindTunnelGUI/
├── backend/          # FastAPI server
├── frontend/         # HTML/CSS/JS web interface
├── templates/        # OpenFOAM case templates
├── examples/         # Sample configurations
├── runs/             # Simulation runs (created at runtime)
├── meshes/           # Mesh library storage
├── metadata/         # Run metadata
├── logs/             # Log files
├── start.sh          # Startup script
└── requirements.txt  # Python dependencies
```

## Creating a Case

1. Go to **Run Manager** tab
2. Select "Upload New Mesh" or choose from library
3. Upload your mesh file (.unv or .msh)
4. Click **Create Run**
5. Configure settings in **Solver + Controls**
6. Click **Run Simulation**

## Results

After simulation completes:
- Open `.foam` file in ParaView (path shown in GUI)
- Logs saved in `runs/<run_id>/logs/`

---

## Diff Summary: What's Copied vs Redesigned

### Copied from WebPropellerGUI
- FastAPI server structure
- Frontend tab layout and styling
- WebSocket log streaming
- Run manager / mesh library pattern
- CSS styling (minimal changes)

### Redesigned for Wind Tunnel
- **Removed**: AMI patches, rotation settings, rotor/stator mesh handling
- **Added**: Turbulence model selection (k-omega SST, k-epsilon, etc.)
- **Added**: Wall treatment options (slip, noSlip, wallFunction)
- **Simplified**: Single mesh input instead of rotor+stator pairs
- **Changed**: Port 6061 (to avoid conflict with PropellerGUI on 6060)
- **Template**: Static wind tunnel case with inlet/outlet/walls/model patches

### Adapted from Save_V1
- Turbulence model templates
- Boundary condition structure
- fvSchemes and fvSolution settings
