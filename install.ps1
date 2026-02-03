#==============================================================================
# OpenFOAM GUI - Windows PowerShell Installation Script
#==============================================================================
# This script helps set up the Python dependencies for OpenFOAM GUI.
# Note: OpenFOAM itself runs in WSL, not Windows directly.
#
# Usage:
#   .\install.ps1
#
# Requirements:
#   - Python 3.8+ (Windows or WSL)
#   - WSL2 with Ubuntu (for OpenFOAM)
#==============================================================================

Write-Host "=============================================="
Write-Host "  OpenFOAM GUI - Windows Setup"
Write-Host "=============================================="
Write-Host ""

# Check if running in WSL context vs Windows
$IsWSL = $false
$WSLPath = ""

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "[1/4] Checking Python..." -NoNewline
try {
    $pythonVersion = python --version 2>&1
    if ($pythonVersion -match "Python 3\.([89]|1[0-9])") {
        Write-Host " OK ($pythonVersion)" -ForegroundColor Green
    } else {
        Write-Host " $pythonVersion (3.8+ recommended)" -ForegroundColor Yellow
    }
} catch {
    Write-Host " Not found" -ForegroundColor Red
    Write-Host ""
    Write-Host "Python 3 is required. Download from: https://www.python.org/downloads/"
    Write-Host "Or install via Microsoft Store: 'Python 3.11'"
    exit 1
}

Write-Host "[2/4] Checking WSL..." -NoNewline
try {
    $wslList = wsl --list --quiet 2>&1
    if ($wslList -match "Ubuntu") {
        Write-Host " OK (Ubuntu found)" -ForegroundColor Green
    } else {
        Write-Host " No Ubuntu distribution" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Install WSL2 with Ubuntu:"
        Write-Host "  wsl --install -d Ubuntu-24.04"
    }
} catch {
    Write-Host " Not available" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "WSL2 is required for running OpenFOAM."
    Write-Host "Install with: wsl --install"
}

Write-Host "[3/4] Installing Python dependencies..." -NoNewline
try {
    $requirementsPath = Join-Path $ScriptDir "requirements.txt"
    pip install --user -r $requirementsPath 2>&1 | Out-Null
    Write-Host " OK" -ForegroundColor Green
} catch {
    Write-Host " Failed" -ForegroundColor Red
    Write-Host "Try manually: pip install fastapi uvicorn python-multipart websockets aiofiles httpx"
}

Write-Host "[4/4] Setup complete" -NoNewline
Write-Host " OK" -ForegroundColor Green

Write-Host ""
Write-Host "=============================================="
Write-Host "  Next Steps" -ForegroundColor Cyan
Write-Host "=============================================="
Write-Host ""
Write-Host "1. Open WSL terminal (Ubuntu)"
Write-Host ""
Write-Host "2. Navigate to project:"
Write-Host "   cd ~/openfoam/Tutorials/Rotating_Setup_Case/OpenFOAM_GUI"
Write-Host ""
Write-Host "3. Run install script in WSL:"
Write-Host "   ./install.sh"
Write-Host ""
Write-Host "4. Start the server:"
Write-Host "   ./start.sh"
Write-Host ""
Write-Host "5. Open browser: http://localhost:6060"
Write-Host ""
Write-Host "=============================================="
Write-Host "  OpenFOAM Installation (in WSL)" -ForegroundColor Cyan
Write-Host "=============================================="
Write-Host ""
Write-Host "If OpenFOAM is not installed, run in WSL:"
Write-Host ""
Write-Host "  curl -s https://dl.openfoam.com/add-debian-repo.sh | sudo bash"
Write-Host "  sudo apt update"
Write-Host "  sudo apt install openfoam2506"
Write-Host "  echo 'source /usr/lib/openfoam/openfoam2506/etc/bashrc' >> ~/.bashrc"
Write-Host ""
