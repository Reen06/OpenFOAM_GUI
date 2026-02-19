#!/bin/bash
#==============================================================================
# OpenFOAM Web Wind Tunnel GUI - Start Script
#==============================================================================
# Run this script to start the web server and open the GUI in your browser.
#
# Usage:
#   ./start.sh
#
# The server will bind to 0.0.0.0:6061 so it's accessible from Windows browser.
# Access the GUI at: http://localhost:6061
#==============================================================================

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

echo "=============================================="
echo "  OpenFOAM Web Wind Tunnel GUI"
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

# Create required directories
mkdir -p "$SCRIPT_DIR/runs"
mkdir -p "$SCRIPT_DIR/meshes"
mkdir -p "$SCRIPT_DIR/metadata"
mkdir -p "$SCRIPT_DIR/logs"

# Start server
echo "[INFO] Starting server on http://0.0.0.0:6061"
echo "[INFO] Access from browser: http://localhost:6061"
echo ""
echo "Press Ctrl+C to stop the server"
echo "=============================================="
echo ""

cd "$BACKEND_DIR"
python3 main.py
