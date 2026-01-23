#!/bin/bash
#==============================================================================
# OpenFOAM Unified GUI - Start Script
#==============================================================================
# Run this script to start the unified web server for all OpenFOAM tools.
#
# Usage:
#   ./start.sh
#
# The server will bind to 0.0.0.0:6060 so it's accessible from Windows browser.
# Access the GUI at: http://localhost:6060
#==============================================================================

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=============================================="
echo "  OpenFOAM Unified GUI"
echo "=============================================="
echo ""
echo "Project: $SCRIPT_DIR"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python 3 not found. Please install Python 3."
    exit 1
fi

# Check required packages
echo "[INFO] Checking dependencies..."

if ! python3 -c "import fastapi" 2>/dev/null; then
    echo "[INFO] Installing dependencies..."
    pip3 install --user -r "$SCRIPT_DIR/requirements.txt"
fi

echo "[OK] Dependencies ready"
echo ""

# Create required directories for sub-apps
for subapp in PropellerGUI WindTunnelGUI; do
    if [ -d "$SCRIPT_DIR/$subapp" ]; then
        mkdir -p "$SCRIPT_DIR/$subapp/runs"
        mkdir -p "$SCRIPT_DIR/$subapp/meshes"
        mkdir -p "$SCRIPT_DIR/$subapp/metadata"
        mkdir -p "$SCRIPT_DIR/$subapp/logs"
    fi
done

# Start server
echo "[INFO] Starting server on http://0.0.0.0:6060"
echo "[INFO] Access from browser: http://localhost:6060"
echo ""
echo "Available tools:"
echo "  - Landing Page:     http://localhost:6060/"
echo "  - Wind Tunnel:      http://localhost:6060/windtunnel/"
echo "  - Propeller:        http://localhost:6060/propeller/"
echo ""
echo "Press Ctrl+C to stop the server"
echo "=============================================="
echo ""

cd "$SCRIPT_DIR"
python3 main.py
