#!/bin/bash
#==============================================================================
# OpenFOAM GUI - Installation Script
#==============================================================================
# This script installs all dependencies required to run OpenFOAM GUI.
#
# Usage:
#   chmod +x install.sh
#   ./install.sh
#
# Requirements:
#   - Python 3.8+
#   - OpenFOAM (optional but needed for simulations)
#==============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=============================================="
echo "  OpenFOAM GUI - Installation"
echo "=============================================="
echo ""

# Check Python version
echo -n "[1/5] Checking Python... "
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
    PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)
    
    if [ "$PYTHON_MAJOR" -ge 3 ] && [ "$PYTHON_MINOR" -ge 8 ]; then
        echo -e "${GREEN}OK${NC} (Python $PYTHON_VERSION)"
    else
        echo -e "${YELLOW}WARNING${NC} (Python $PYTHON_VERSION - 3.8+ recommended)"
    fi
else
    echo -e "${RED}FAILED${NC}"
    echo ""
    echo "Python 3 is required. Please install it:"
    echo "  sudo apt install python3 python3-pip"
    exit 1
fi

# Check pip
echo -n "[2/5] Checking pip... "
if command -v pip3 &> /dev/null; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}Installing...${NC}"
    sudo apt install -y python3-pip
fi

# Install Python dependencies
echo "[3/5] Installing Python dependencies..."
cd "$SCRIPT_DIR"
pip3 install --user -r requirements.txt
echo -e "      ${GREEN}OK${NC}"

# Check OpenFOAM
echo -n "[4/5] Checking OpenFOAM... "
if command -v simpleFoam &> /dev/null; then
    FOAM_VERSION=$(simpleFoam -help 2>&1 | head -1 || echo "unknown")
    echo -e "${GREEN}OK${NC}"
elif [ -f /usr/lib/openfoam/openfoam2506/etc/bashrc ]; then
    echo -e "${YELLOW}Available${NC} (source bashrc to use)"
    echo "      Add to ~/.bashrc:"
    echo "      source /usr/lib/openfoam/openfoam2506/etc/bashrc"
else
    echo -e "${YELLOW}Not found${NC}"
    echo "      OpenFOAM is needed for simulations."
    echo "      Install with:"
    echo "        curl -s https://dl.openfoam.com/add-debian-repo.sh | sudo bash"
    echo "        sudo apt install openfoam2506"
fi

# Make scripts executable
echo -n "[5/5] Setting permissions... "
chmod +x "$SCRIPT_DIR/start.sh" 2>/dev/null || true
chmod +x "$SCRIPT_DIR/install.sh" 2>/dev/null || true
echo -e "${GREEN}OK${NC}"

echo ""
echo "=============================================="
echo -e "  ${GREEN}Installation Complete!${NC}"
echo "=============================================="
echo ""
echo "To start the GUI:"
echo "  cd $SCRIPT_DIR"
echo "  ./start.sh"
echo ""
echo "Then open in browser: http://localhost:6060"
echo ""
