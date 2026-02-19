# Blank Module Template — How to Create a New Module

This guide walks you through using this blank template to create a new OpenFOAM module for the GUI.

## Quick Start

1. **Copy this directory** to create your new module:
   ```bash
   cp -r blank_template/ my_new_module/
   ```

2. **Update `module.json`** with your module's identity:
   ```json
   {
     "name": "My New Module",
     "type": "myType",
     "icon": "🔧",
     "description": "Description of what this module does",
     "port": 6065,
     "features": ["feature1", "feature2"]
   }
   ```
   > **Important:** Use a unique `port` number that doesn't conflict with other modules.

3. **Add your OpenFOAM case template** to `templates/caseDir/`:
   - Copy your `0/`, `constant/`, and `system/` directories
   - Remove `constant/polyMesh/` (it gets created from the uploaded mesh)

4. **Implement the backend** — edit 2 methods in `backend/workflow.py`:
   - `_apply_settings()` — write your case-specific settings to files
   - `_run_solver()` — run your OpenFOAM solver

5. **Implement the frontend** — edit 2 files:
   - `frontend/index.html` — add your settings UI in the Settings tab
   - `frontend/js/app.js` — update `getCaseSettings()` to gather your values

6. **Wire settings to the API** — edit `frontend/js/api.js`:
   - Update `startRun()` to send your settings object

---

## Detailed Instructions

### Step 1: Backend — `workflow.py`

#### `_apply_settings()`

This is where you modify your OpenFOAM case files. You receive `case_settings` as a dictionary with whatever the frontend sent.

```python
async def _apply_settings(self, run_id, case_dir, logs_dir, case_settings, log_callback=None):
    import re

    # Example: Update controlDict
    control_dict = case_dir / "system" / "controlDict"
    content = control_dict.read_text()

    solver = case_settings.get("solver", "simpleFoam")
    content = re.sub(r'application\s+\w+;', f'application {solver};', content)

    end_time = case_settings.get("end_time", 1000)
    content = re.sub(r'endTime\s+[\d.e+-]+;', f'endTime {end_time};', content)

    control_dict.write_text(content)

    # Example: Update boundary conditions (0/U)
    u_file = case_dir / "0" / "U"
    content = u_file.read_text()
    velocity = case_settings.get("inlet_velocity", [10, 0, 0])
    vel_str = f"({velocity[0]} {velocity[1]} {velocity[2]})"
    content = re.sub(r'value\s+uniform\s+\([^)]+\);', f'value uniform {vel_str};', content, count=1)
    u_file.write_text(content)

    if log_callback:
        await log_callback(f"[SETTINGS] Applied: solver={solver}, endTime={end_time}")
```

#### `_run_solver()`

This runs your OpenFOAM solver. It should handle both serial and parallel execution.

```python
async def _run_solver(self, run_id, case_dir, logs_dir, case_settings, log_callback=None):
    solver = case_settings.get("solver", "simpleFoam")
    parallel = case_settings.get("parallel", False)
    num_cores = case_settings.get("num_cores", 4)

    if parallel:
        success, _ = await self.run_cmd_async(
            "decomposePar -force", case_dir,
            logs_dir / "decomposePar.log", run_id, "DECOMPOSE", log_callback
        )
        if not success:
            return False

        cmd = f"mpirun -np {num_cores} {solver} -parallel"
    else:
        cmd = solver

    success, _ = await self.run_cmd_async(
        cmd, case_dir,
        logs_dir / f"{solver}.log", run_id, "SOLVER", log_callback
    )

    if parallel and success:
        await self.run_cmd_async(
            "reconstructPar", case_dir,
            logs_dir / "reconstructPar.log", run_id, "RECONSTRUCT", log_callback
        )

    return success
```

### Step 2: Frontend — Add Settings UI

Edit `frontend/index.html`. Add form fields inside the **Settings** tab (`<section id="solver">`):

```html
<div class="card">
    <h4>Solver Selection</h4>
    <div class="form-row">
        <div class="form-group">
            <label>Solver</label>
            <select id="solver-select">
                <option value="simpleFoam">simpleFoam (steady)</option>
                <option value="pimpleFoam">pimpleFoam (transient)</option>
            </select>
        </div>
    </div>
</div>

<div class="card">
    <h4>Inlet Conditions</h4>
    <div class="form-row">
        <div class="form-group">
            <label>Velocity X (m/s)</label>
            <input type="number" id="inlet-ux" value="10" step="0.1">
        </div>
        <div class="form-group">
            <label>Velocity Y (m/s)</label>
            <input type="number" id="inlet-uy" value="0" step="0.1">
        </div>
    </div>
</div>
```

### Step 3: Frontend — Gather Settings

Edit `frontend/js/app.js`. Update the `getCaseSettings()` method:

```javascript
getCaseSettings() {
    return {
        solver: document.getElementById('solver-select')?.value || 'simpleFoam',
        end_time: parseFloat(document.getElementById('end-time')?.value) || 1000,
        delta_t: parseFloat(document.getElementById('delta-t')?.value) || 1,
        write_interval: parseFloat(document.getElementById('write-interval')?.value) || 100,
        parallel: document.getElementById('enable-parallel')?.checked || false,
        num_cores: parseInt(document.getElementById('num-cores')?.value) || 4,
        inlet_velocity: [
            parseFloat(document.getElementById('inlet-ux')?.value) || 0,
            parseFloat(document.getElementById('inlet-uy')?.value) || 0,
            0
        ]
    };
}
```

---

## File Reference

| File | Purpose |
|------|---------|
| `module.json` | Module identity (name, icon, port) |
| `backend/main.py` | FastAPI server, endpoints |
| `backend/workflow.py` | OpenFOAM execution (**main customization**) |
| `backend/run_manager.py` | Run CRUD operations |
| `frontend/index.html` | UI layout |
| `frontend/js/app.js` | UI logic (**getCaseSettings**) |
| `frontend/js/api.js` | API client |
| `templates/caseDir/` | OpenFOAM case template |
| `start.sh` | Launch script |

## Architecture

```
User clicks "Run Simulation"
    → app.js: getCaseSettings()
    → api.js: startRun(runId, settings)
    → main.py: /api/run/{id}/start
    → workflow.py: _apply_settings(settings)
    → workflow.py: _run_solver(settings)
    → WebSocket: live logs back to browser
```
