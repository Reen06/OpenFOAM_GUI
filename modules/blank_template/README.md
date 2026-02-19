# OpenFOAM Blank Module Template

A blank, reusable template for creating new OpenFOAM GUI modules.

## Quick Start

See **[BLANK_MODULE_GUIDE.md](BLANK_MODULE_GUIDE.md)** for complete instructions.

### 1. Install Dependencies

```bash
pip3 install -r requirements.txt
```

### 2. Start the Server

```bash
chmod +x start.sh
./start.sh
```

### 3. Open in Browser

Navigate to: **http://localhost:6061**

## Built-in Features (Generic)

- **Run Manager**: Create and manage simulation runs
- **Mesh Library**: Store and reuse meshes (.unv, .msh)
- **Live Logs**: Real-time WebSocket log streaming
- **Progress Tracking**: Timer, ETA, storage monitoring
- **Parallel Execution**: MPI support

## To Customize

1. Add your OpenFOAM case template files to `templates/caseDir/`
2. Implement `_apply_settings()` and `_run_solver()` in `backend/workflow.py`
3. Add your settings UI to `frontend/index.html`
4. Update `getCaseSettings()` in `frontend/js/app.js`

## Directory Structure

```
blank_module/
├── backend/          # FastAPI server
├── frontend/         # HTML/CSS/JS web interface
├── templates/        # OpenFOAM case template (populate this)
├── examples/         # Sample configurations
├── runs/             # Simulation runs (created at runtime)
├── meshes/           # Mesh library storage
├── metadata/         # Run metadata
├── logs/             # Log files
├── BLANK_MODULE_GUIDE.md  # Detailed guide
├── start.sh          # Startup script
└── requirements.txt  # Python dependencies
```
