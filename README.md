# OpenFOAM GUI

A unified web-based interface for running OpenFOAM CFD simulations. Currently supports Wind Tunnel and Propeller (rotating mesh) simulations with an extensible module system.

![OpenFOAM GUI](https://img.shields.io/badge/OpenFOAM-v2506-blue) ![Python](https://img.shields.io/badge/Python-3.8+-green) ![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-orange)

## Features

- 🌬️ **Wind Tunnel Simulations** - External aerodynamics with drag/lift analysis
- 🌀 **Propeller Simulations** - Rotating mesh (AMI) with thrust/torque calculations
- 📊 **Real-time Monitoring** - Live solver output, progress tracking, storage estimates
- 📦 **Mesh Library** - Upload and manage mesh files (.unv, .msh formats)
- 💾 **Run Manager** - Save, compare, and export simulation results
- 📈 **Performance Analysis** - Automatic extraction of forces and coefficients
- 🔌 **Modular Architecture** - Easy to extend with new simulation types

## Quick Start

### Prerequisites

- **OpenFOAM** (ESI-OpenCFD v2506 recommended)
- **Python 3.8+**
- **WSL2** (if running on Windows)

### Installation

```bash
# Clone or navigate to the project
cd /path/to/OpenFOAM_GUI

# Run the install script
chmod +x install.sh
./install.sh

# Start the server
./start.sh
```

### Access the GUI

Open your browser and navigate to: **http://localhost:6060**

## Project Structure

```
OpenFOAM_GUI/
├── main.py                 # Main FastAPI server
├── module_manager.py       # Module discovery and loading
├── case_manager.py         # Case import/export/registry
├── start.sh               # Startup script
├── install.sh             # Installation script
├── requirements.txt       # Python dependencies
│
├── landing/               # Landing page (HTML/CSS/JS)
│   ├── index.html
│   ├── css/
│   └── js/
│
├── modules/               # Simulation modules
│   ├── wind_tunnel/       # Wind tunnel module
│   │   ├── backend/       # FastAPI sub-app
│   │   ├── frontend/      # Module UI
│   │   └── templates/     # OpenFOAM case templates
│   │
│   └── propeller/         # Propeller module
│       ├── backend/
│       ├── frontend/
│       └── templates/
│
├── shared/                # Shared utilities
│   ├── performance_analyzer.py
│   └── functionobject_manager.py
│
├── cases/                 # Case registry
│   └── registry.json
│
└── docs/                  # Documentation
    └── *.md
```

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | System design and component relationships |
| [Installation](docs/installation.md) | Detailed setup guide |
| [Modules](docs/modules.md) | Module system documentation |
| [API Reference](docs/api.md) | REST API endpoints |
| [Development](docs/development.md) | Contributing guide |
| [Wind Tunnel](docs/wind_tunnel.md) | Wind tunnel module details |
| [Propeller](docs/propeller.md) | Propeller module details |
| [Performance](docs/performance.md) | Performance analysis system |

## Technology Stack

- **Backend**: Python, FastAPI, uvicorn
- **Frontend**: HTML5, CSS3, JavaScript (vanilla)
- **CFD**: OpenFOAM (ESI-OpenCFD)
- **Communication**: WebSockets (live log streaming)

## Running on Windows (WSL)

This GUI is designed to run inside WSL2 with OpenFOAM installed. The web interface is accessible from Windows browsers at `http://localhost:6060`.

See [Installation Guide](docs/installation.md) for detailed WSL setup instructions.

## License

This project uses the OpenFOAM open-source CFD toolbox. OpenFOAM is a registered trademark of OpenCFD Ltd.

## Contributing

See [Development Guide](docs/development.md) for information on:
- Creating new modules
- Backend/frontend conventions
- Testing guidelines
