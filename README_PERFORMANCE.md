# OpenFOAM GUI Performance Analysis System

This system automatically extracts aerodynamic forces and calculates performance metrics for both Wind Tunnel and Propeller simulations.

## Features

- **Automatic Patch Detection**: Fuzzy matching identifies `monitor`, `wing`, `body`, `propeller`, or `blades` patches automatically.
- **Real-time Integration**: Function objects are configured during case setup.
- **Post-Processing**: Analysis runs automatically after simulation completion.
- **Frontend Dashboard**: View Lift/Drag (Wind Tunnel) or Thrust/Torque/Efficiency (Propeller) directly in the GUI.

## Configuration

The system uses sensible defaults, but you can override them in `user_defaults.json` or run-specific metadata.

### Wind Tunnel Defaults
```json
{
  "analysis-enabled": true,
  "analysis-patches": "model",     // Fuzzy match target
  "analysis-drag-axis": "1,0,0",
  "analysis-lift-axis": "0,0,1",
  "analysis-ref-area": "1.0",
  "analysis-ref-length": "1.0"
}
```

### Propeller Defaults
```json
{
  "analysis-enabled": true,
  "analysis-patches": "propellerVals",
  "analysis-thrust-axis": "1,0,0", // Axis of rotation
  "analysis-prop-diameter": "0.2"  // Meters
}
```

## How It Works

1. **Setup**: When you click "Configure & Run", the backend detects geometry patches and modifies `controlDict` to include `forces` and `forceCoeffs` functionObjects.
2. **Simulation**: OpenFOAM writes force data to `postProcessing/forces/0/force.dat` during the run.
3. **Analysis**: Upon completion, the backend parses these files.
   - **Wind Tunnel**: Calculates Cd, Cl, L/D ratio.
   - **Propeller**: Calculates Thrust (N), Torque (Nm), Kt, Kq, Advance Ratio (J), and Efficiency (η).
4. **Display**: The "Performance" tab in the GUI fetches the results from `performance_summary.json`.

## Troubleshooting

- **"No patches detected"**: Ensure your mesh borders are named logically (e.g., `wing_wall`, `propeller_blade`). The system searches for `propeller`, `blade`, `monitor`, `wall`, `wing`, `body`, `fuselage`.
- **"No performance data available"**: The simulation might have failed or not produced `force.dat` files. Check the Logs tab for solver errors.
- **Weird Values**: 
  - Check **Reference Area** (default 1.0 m^2).
  - Check **Rotation Axis** / **Drag Axis**.
  - **Propeller**: Ensure RPM and Diameter are correct in the config.

## API Endpoints

- `GET /api/run/{run_id}/performance`: Get JSON summary.
- `POST /api/run/{run_id}/analyze`: Trigger manual re-analysis.
