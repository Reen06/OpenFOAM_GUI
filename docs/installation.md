# Installation Guide

This guide covers installing and running OpenFOAM GUI on various systems.

## Prerequisites

### Required

- **Python 3.8+** with pip
- **OpenFOAM** (ESI-OpenCFD v2506 recommended)
- **ParaView** (for visualization, optional but recommended)

### Windows Users

OpenFOAM GUI runs inside **WSL2** (Windows Subsystem for Linux). The web interface is accessible from Windows browsers.

## Installation

### Quick Install (Linux/WSL)

```bash
cd /path/to/OpenFOAM_GUI
chmod +x install.sh
./install.sh
```

### Manual Installation

1. **Install Python dependencies:**
   ```bash
   pip3 install --user -r requirements.txt
   ```

2. **Verify OpenFOAM is available:**
   ```bash
   source /usr/lib/openfoam/openfoam2506/etc/bashrc
   simpleFoam -help  # Should show help text
   ```

3. **Make scripts executable:**
   ```bash
   chmod +x start.sh install.sh
   ```

## Running the Server

```bash
./start.sh
```

Or manually:
```bash
python3 main.py
```

The server starts on `http://0.0.0.0:6060`

Access from browser: **http://localhost:6060**

## WSL2 Setup (Windows)

### 1. Install WSL2

```powershell
# In PowerShell as Administrator
wsl --install -d Ubuntu-24.04
```

### 2. Install OpenFOAM in WSL

```bash
# Add OpenFOAM repository
curl -s https://dl.openfoam.com/add-debian-repo.sh | sudo bash

# Install OpenFOAM
sudo apt update
sudo apt install openfoam2506

# Add to bashrc
echo 'source /usr/lib/openfoam/openfoam2506/etc/bashrc' >> ~/.bashrc
```

### 3. Install Python Dependencies

```bash
sudo apt install python3 python3-pip
pip3 install --user fastapi uvicorn python-multipart websockets aiofiles httpx
```

### 4. Clone/Copy Project to WSL

```bash
cd ~
mkdir -p openfoam/Tutorials
# Copy or clone project to this location
```

### 5. Start the GUI

```bash
cd ~/openfoam/Tutorials/Rotating_Setup_Case/OpenFOAM_GUI
./start.sh
```

Access from Windows browser: **http://localhost:6060**

## ParaView Setup

For viewing simulation results, install ParaView:

### Linux
```bash
sudo apt install paraview
```

### Windows
Download from [paraview.org](https://www.paraview.org/download/) and install.

To open results from Windows ParaView accessing WSL files:
1. Open ParaView
2. File → Open
3. Navigate to `\\wsl.localhost\Ubuntu-24.04\path\to\case.foam`

## Troubleshooting

### Server won't start

```bash
# Check Python version
python3 --version  # Should be 3.8+

# Check dependencies
pip3 list | grep fastapi
```

### OpenFOAM commands not found

```bash
# Source OpenFOAM environment
source /usr/lib/openfoam/openfoam2506/etc/bashrc

# Verify
which simpleFoam
```

### Port 6060 already in use

```bash
# Find process using port
lsof -i :6060

# Kill if needed
kill -9 <PID>
```

### WSL network issues

```powershell
# In PowerShell, restart WSL
wsl --shutdown
wsl
```

## Next Steps

- Read the [Architecture](architecture.md) overview
- Explore [Wind Tunnel](wind_tunnel.md) module
- Explore [Propeller](propeller.md) module
