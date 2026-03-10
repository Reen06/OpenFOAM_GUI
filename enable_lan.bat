@echo off
REM ============================================================================
REM  OpenFOAM GUI - Enable LAN Access
REM  
REM  Run this script as Administrator to allow devices on your local WiFi
REM  to access the OpenFOAM GUI running in WSL2.
REM  
REM  This does TWO things:
REM    1. Opens Windows Firewall on port 6060 for Private networks ONLY
REM    2. Sets up port forwarding from your LAN IP to WSL2
REM  
REM  SAFE: Only opens port on Private networks (home WiFi).
REM  NOT accessible from the public internet.
REM ============================================================================

echo.
echo  OpenFOAM GUI - LAN Access Setup
echo  ================================
echo.

REM Check for admin privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: This script must be run as Administrator.
    echo  Right-click the file and select "Run as administrator".
    echo.
    pause
    exit /b 1
)

REM Step 1: Add firewall rule for port 6060 (Private networks only)
echo  [1/2] Adding Windows Firewall rule (Private networks only)...
netsh advfirewall firewall delete rule name="OpenFOAM GUI LAN Access" >nul 2>&1
netsh advfirewall firewall add rule name="OpenFOAM GUI LAN Access" dir=in action=allow protocol=TCP localport=6060 profile=private
if %errorlevel% equ 0 (
    echo        Firewall rule added successfully.
) else (
    echo        WARNING: Failed to add firewall rule.
)

REM Step 2: Set up port forwarding from Windows LAN to WSL2
REM WSL2 uses a virtual NAT, so we need to forward the port from the
REM Windows host (0.0.0.0:6060) to the WSL2 IP
echo.
echo  [2/2] Setting up port forwarding to WSL2...

REM Get the WSL2 IP address
for /f "tokens=*" %%i in ('wsl -d Ubuntu-24.04 hostname -I') do set WSL_IP=%%i
REM Trim whitespace
for /f "tokens=1" %%a in ("%WSL_IP%") do set WSL_IP=%%a

if "%WSL_IP%"=="" (
    echo        WARNING: Could not detect WSL2 IP address.
    echo        Make sure WSL is running and try again.
    goto :done
)

echo        WSL2 IP detected: %WSL_IP%

REM Remove existing proxy rule (if any) and add fresh one
netsh interface portproxy delete v4tov4 listenport=6060 listenaddress=0.0.0.0 >nul 2>&1
netsh interface portproxy add v4tov4 listenport=6060 listenaddress=0.0.0.0 connectport=6060 connectaddress=%WSL_IP%

if %errorlevel% equ 0 (
    echo        Port forwarding configured: 0.0.0.0:6060 -^> %WSL_IP%:6060
) else (
    echo        WARNING: Failed to set up port forwarding.
)

:done
echo.
echo  ============================================
echo  SETUP COMPLETE!
echo  ============================================
echo.
echo  Your local devices can now access the GUI.
echo  Toggle the LAN switch in the GUI header to see your URL.
echo.
echo  NOTE: If WSL restarts, you may need to run this script again
echo  (the WSL2 IP can change on restart).
echo.
pause
