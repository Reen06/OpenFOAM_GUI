/**
 * OpenFOAM Web Wind Tunnel GUI - Main Application
 */

class App {
    constructor() {
        // State
        this.currentRunId = null;
        this.selectedMeshId = null;
        this.meshFile = null;
        this.logLines = [];
        this.maxLogLines = 100;
        this.runsData = [];

        // Simulation timing
        this.simStartTime = null;
        this.simEndTime = null;
        this.currentSimTime = 0;

        // Storage tracking for averaging
        this.storageHistory = [];  // Array of {simTime, sizeMB} for averaging

        // WebSocket
        this.ws = new WebSocketManager();

        // Initialize
        this.init();
    }

    init() {
        this.setupTabs();
        this.setupMaterialPresets();
        this.setupParallelToggle();
        this.setupButtons();
        this.setupWebSocket();
        this.setupParaviewCalculator();
        this.setupLogControls();
        this.setupRunManager();
        this.setupMeshUpload();
        this.setupDefaultsButton();
        this.setupInfoButtons();

        // Load initial data
        this.loadRuns();
        this.loadMeshLibrary();
        this.loadDefaults();

        // Update connection status
        this.updateConnectionStatus('connected');

        // Check for run_id query param (from landing page "View" button)
        this.handleQueryParams();
    }

    handleQueryParams() {
        const urlParams = new URLSearchParams(window.location.search);
        const runId = urlParams.get('run_id');
        const tab = urlParams.get('tab');

        if (runId) {
            // Wait a bit for runs to load, then select the run
            setTimeout(async () => {
                await this.viewRun(runId);

                // Switch to requested tab (usually solver settings to see logs)
                if (tab) {
                    document.querySelector(`[data-tab="${tab}"]`)?.click();
                }

                // Clean up URL
                window.history.replaceState({}, document.title, window.location.pathname);
            }, 500);
        }
    }

    // ==================== Tab Navigation ====================

    setupTabs() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.dataset.tab;

                // Update buttons
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Update panels
                document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                document.getElementById(tabId)?.classList.add('active');

                // Load data based on tab
                if (tabId === 'run-manager') {
                    this.loadRuns();
                } else if (tabId === 'mesh-library') {
                    this.loadMeshLibrary();
                } else if (tabId === 'boundary-mapper' && this.currentRunId) {
                    this.loadPatches();
                }
            });
        });
    }

    // ==================== Detailed Help / Info ====================

    setupInfoButtons() {
        const helpText = {
            'solver': `
                <strong>Solver Selection</strong><br><br>
                - <strong>simpleFoam:</strong> Steady-state solver for incompressible, turbulent flow. Best for getting quick results when flow doesn't change over time.<br>
                - <strong>pimpleFoam:</strong> Transient (time-dependent) solver. Use this if you want to see vortex shedding or if the simulation is unstable with steady-state.<br>
                - <strong>rhoSimpleFoam / rhoPimpleFoam:</strong> Compressible versions. Use if your flow speeds are very high (Mach > 0.3) or if there are large temperature changes.
            `,
            'turbulence': `
                <strong>Turbulence Models</strong><br><br>
                - <strong>k-omega SST:</strong> The industry standard for external aerodynamics. It handles flow separation very well.<br>
                - <strong>k-epsilon:</strong> Good for general internal flows but can struggle with curved surfaces and separation.<br>
                - <strong>Spalart-Allmaras:</strong> A simpler model often used for aircraft wings. Fast, but less accurate for complex separation.<br>
                - <strong>Laminar:</strong> No turbulence model. Only use for very slow flows (low Reynolds number).
            `,
            'end-time': `
                <strong>End Time / Iterations</strong><br><br>
                For <strong>Steady</strong> solvers (simpleFoam), this is the maximum number of iterations. Usually 1000-2000 is enough to reach convergence.<br><br>
                For <strong>Transient</strong> solvers (pimpleFoam), this is the physical simulation time in seconds.
            `,
            'delta-t': `
                <strong>Delta T (Time Step)</strong><br><br>
                For steady solvers, keep this at 1.<br><br>
                For transient solvers, this is critical for stability. The Courant Number should ideally be < 1. If the simulation crashes (blows up), try a smaller Delta T (e.g., 0.001 or 0.0001).
            `,
            'write-control': `
                <strong>Write Control</strong><br><br>
                Determines when OpenFOAM saves result files.<br>
                - <strong>timeStep:</strong> Save every X steps (e.g., every 100 iterations).<br>
                - <strong>runTime:</strong> Save every X seconds of simulation time.
            `,
            'write-interval': `
                <strong>Write Interval</strong><br><br>
                The frequency of saving results, based on the Write Control setting. If Write Control is 'timeStep' and Interval is 100, it saves data every 100 iterations.
            `,
            'purge-write': `
                <strong>Purge Write</strong><br><br>
                Limits how many result folders are kept. If set to 5, only the 5 most recent time steps will be stored on disk. Set to 0 to keep all results (caution: this can use a lot of disk space!).
            `,
            'wall-type': `
                <strong>Wall Boundary Type</strong><br><br>
                - <strong>Slip:</strong> Frictionless wall. Air flows perfectly along the surface.<br>
                - <strong>No-Slip:</strong> Realistic wall with friction. Air speed is zero exactly at the surface.<br>
                - <strong>Partial Slip:</strong> Adjustable friction. Use the slider to set how much slip to allow (0% = no-slip, 100% = full slip).<br>
                - <strong>Wall Functions:</strong> Uses mathematical formulas to model the boundary layer. Recommended when using turbulence models for better accuracy without needing an extremely fine mesh.
            `,
            'wall-slip': `
                <strong>Wall Slip Percentage</strong><br><br>
                Controls how much the wall allows the fluid to slide along it.<br>
                - <strong>0%:</strong> No-slip (zero velocity at wall, maximum friction)<br>
                - <strong>50%:</strong> Half slip (intermediate friction)<br>
                - <strong>100%:</strong> Full slip (frictionless wall)<br><br>
                This uses OpenFOAM's partialSlip boundary condition.
            `,
            'relax-p': `
                <strong>Pressure Relaxation</strong><br><br>
                Used to stabilize steady-state solvers. Recommended value is 0.3. If the simulation is oscillating, try lowering this to 0.2.
            `,
            'relax-u': `
                <strong>Velocity Relaxation</strong><br><br>
                Recommended value is 0.7. Lower this (0.5 or 0.4) if the velocity residuals are not dropping or are unstable.
            `,
            'correctors': `
                <strong>SIMPLE/PIMPLE Correctors</strong><br><br>
                Number of times the pressure-velocity coupling is recalculated per step. 2-3 is usually sufficient. Higher values improve stability for larger time steps but make each step slower.
            `,
            'adjust-timestep': `
                <strong>Adjust Time Step (Adaptive)</strong><br><br>
                OpenFOAM will automatically change Delta T to keep the Courant Number below your target Max Co. Highly recommended for transient simulations to prevent blow-ups while maintaining speed.
            `,
            'max-co': `
                <strong>Max Courant Number (Co)</strong><br><br>
                The stability limit for adaptive time stepping. <br>
                - <strong>0.5:</strong> Balanced (industry standard).<br>
                - <strong>1.0:</strong> Faster, but might lose accuracy or crash if the flow is complex.
            `,
            'ddt-scheme': `
                <strong>Time Discretization</strong><br><br>
                - <strong>steadyState:</strong> For simpleFoam (steady runs).<br>
                - <strong>Euler:</strong> For transient runs (pimpleFoam). Standard 1st order accurate scheme.
            `,
            'div-u': `
                <strong>U Advection Scheme</strong><br><br>
                - <strong>linearUpwind:</strong> 2nd order accurate. Best for final results and smooth flow.<br>
                - <strong>upwind:</strong> 1st order, very robust. Use if the simulation is crashing.
            `,
            'div-turb': `
                <strong>Turbulence Advection</strong><br><br>
                Discretization for k, omega, or epsilon. upwind is generally recommended for stability in turbulence equations.
            `,
            'non-ortho': `
                <strong>Non-Orthogonal Correctors</strong><br><br>
                Used if your mesh has many non-orthogonal cells. Increasing this (1 or 2) can improve stability but adds compute cost.
            `,
            'res-p': `
                <strong>Pressure Residual</strong><br><br>
                Target convergence error for pressure. 1e-4 is standard. Lower (1e-6) for higher precision.
            `,
            'res-u': `
                <strong>Velocity Residual</strong><br><br>
                Target convergence error for velocity (Ux, Uy, Uz). 1e-4 is standard.
            `
        };

        document.querySelectorAll('.info-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const key = btn.dataset.info;
                const info = helpText[key];

                if (info) {
                    // Create a simple custom "modal" or use alert for now
                    // To be more modern, let's inject a temporary info box
                    this.showInfoModal(info);
                }
            });
        });
    }

    showInfoModal(html) {
        // Create modal backdrop
        const backdrop = document.createElement('div');
        backdrop.style.position = 'fixed';
        backdrop.style.top = '0';
        backdrop.style.left = '0';
        backdrop.style.width = '100vw';
        backdrop.style.height = '100vh';
        backdrop.style.background = 'rgba(0,0,0,0.7)';
        backdrop.style.display = 'flex';
        backdrop.style.alignItems = 'center';
        backdrop.style.justifyContent = 'center';
        backdrop.style.zIndex = '2000';
        backdrop.onclick = () => document.body.removeChild(backdrop);

        // Create modal content
        const modal = document.createElement('div');
        modal.style.background = 'var(--bg-secondary)';
        modal.style.padding = '24px';
        modal.style.borderRadius = '12px';
        modal.style.maxWidth = '500px';
        modal.style.border = '1px solid var(--border-color)';
        modal.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
        modal.innerHTML = `
            <div style="margin-bottom: 20px; line-height: 1.5;">${html}</div>
            <button class="btn btn-primary" style="width: 100%">Got it</button>
        `;
        modal.onclick = (e) => e.stopPropagation();
        modal.querySelector('button').onclick = () => document.body.removeChild(backdrop);

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
    }


    // ==================== Material Presets ====================

    setupMaterialPresets() {
        const presetSelect = document.getElementById('fluid-preset');
        if (!presetSelect) return;

        const presets = {
            air: { density: 1.225, kinematic_viscosity: 1.5e-5, temperature: 293.15 },
            water: { density: 998.2, kinematic_viscosity: 1.004e-6, temperature: 293.15 },
            custom: null
        };

        presetSelect.addEventListener('change', () => {
            const preset = presets[presetSelect.value];
            if (preset) {
                document.getElementById('density').value = preset.density;
                document.getElementById('kinematic-viscosity').value = preset.kinematic_viscosity;
                document.getElementById('temperature').value = preset.temperature;
            }
        });
    }

    // ==================== Parallel Toggle ====================

    setupParallelToggle() {
        const checkbox = document.getElementById('enable-parallel');
        const inputs = document.getElementById('parallel-inputs');

        if (checkbox && inputs) {
            checkbox.addEventListener('change', () => {
                inputs.style.display = checkbox.checked ? 'block' : 'none';
            });
        }
    }

    // ==================== Mesh Upload ====================

    setupMeshUpload() {
        const uploadBox = document.getElementById('mesh-upload-box');
        const fileInput = document.getElementById('mesh-file-input');

        if (!uploadBox || !fileInput) return;

        uploadBox.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.meshFile = e.target.files[0];
                this.updateMeshUploadStatus(this.meshFile.name);
            }
        });

        // Drag and drop
        uploadBox.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadBox.style.borderColor = 'var(--accent-primary)';
        });

        uploadBox.addEventListener('dragleave', () => {
            uploadBox.style.borderColor = '';
        });

        uploadBox.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadBox.style.borderColor = '';

            if (e.dataTransfer.files.length > 0) {
                this.meshFile = e.dataTransfer.files[0];
                this.updateMeshUploadStatus(this.meshFile.name);
            }
        });
    }

    updateMeshUploadStatus(filename) {
        const statusEl = document.getElementById('mesh-upload-status');
        const uploadBox = document.getElementById('mesh-upload-box');

        if (statusEl) statusEl.textContent = filename;
        if (uploadBox) uploadBox.classList.add('has-file');
    }

    // ==================== Run Manager ====================

    setupRunManager() {
        const meshSelector = document.getElementById('mesh-selector');
        const createBtn = document.getElementById('create-run-btn');
        const refreshBtn = document.getElementById('refresh-runs-btn');
        const solverBtn = document.getElementById('go-to-solver-btn');
        const paraviewBtn = document.getElementById('go-to-paraview-btn');

        // Mesh selector change
        if (meshSelector) {
            meshSelector.addEventListener('change', () => {
                const value = meshSelector.value;
                const isNewMesh = value === '__NEW_MESH__';

                // Toggle upload section
                const uploadSection = document.getElementById('new-mesh-upload-section');
                if (uploadSection) {
                    uploadSection.style.display = isNewMesh ? 'block' : 'none';
                }

                if (createBtn) {
                    createBtn.disabled = !value;
                    createBtn.textContent = isNewMesh ? 'Create Run (Upload & Process)' : 'Create Run';
                }
            });
        }

        if (createBtn) {
            createBtn.addEventListener('click', () => this.createRun());
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadRuns());
        }

        if (solverBtn) {
            solverBtn.addEventListener('click', () => {
                document.querySelector('[data-tab="solver"]')?.click();
            });
        }

        if (paraviewBtn) {
            paraviewBtn.addEventListener('click', () => {
                document.querySelector('[data-tab="paraview"]')?.click();
            });
        }

        // Solver change handler for adaptive row
        const solverSelect = document.getElementById('solver-select');
        const adaptiveRow = document.getElementById('adaptive-row');
        if (solverSelect && adaptiveRow) {
            solverSelect.addEventListener('change', () => {
                const isTransient = solverSelect.value.toLowerCase().includes('pimple');
                adaptiveRow.style.display = isTransient ? 'flex' : 'none';
            });
            // Initial state
            const isTransient = solverSelect.value.toLowerCase().includes('pimple');
            adaptiveRow.style.display = isTransient ? 'flex' : 'none';
        }

        // Adjust timestep handler for max-co group
        const adjustTs = document.getElementById('adjust-timestep');
        const maxCoGroup = document.getElementById('max-co-group');
        if (adjustTs && maxCoGroup) {
            adjustTs.addEventListener('change', () => {
                maxCoGroup.style.display = adjustTs.checked ? 'flex' : 'none';
            });
            // Initial state
            maxCoGroup.style.display = adjustTs.checked ? 'flex' : 'none';
        }

        // Wall type handler for partial slip slider
        const wallTypeSelect = document.getElementById('wall-type');
        const wallSlipGroup = document.getElementById('wall-slip-group');
        const wallSlipFraction = document.getElementById('wall-slip-fraction');
        const wallSlipValue = document.getElementById('wall-slip-value');

        if (wallTypeSelect && wallSlipGroup) {
            wallTypeSelect.addEventListener('change', () => {
                wallSlipGroup.style.display = wallTypeSelect.value === 'partialSlip' ? 'block' : 'none';
            });
            // Initial state
            wallSlipGroup.style.display = wallTypeSelect.value === 'partialSlip' ? 'block' : 'none';
        }

        if (wallSlipFraction && wallSlipValue) {
            wallSlipFraction.addEventListener('input', () => {
                wallSlipValue.textContent = `${wallSlipFraction.value}%`;
            });
        }

        // Advanced Toggle
        const advToggle = document.getElementById('advanced-toggle');
        const advContent = document.getElementById('advanced-content');
        const advIcon = document.getElementById('advanced-toggle-icon');
        if (advToggle && advContent) {
            advToggle.addEventListener('click', () => {
                const isHidden = advContent.style.display === 'none';
                advContent.style.display = isHidden ? 'block' : 'none';
                advIcon.textContent = isHidden ? '▲' : '▼';
            });
        }
    }

    async loadMeshLibrary() {
        try {
            const data = await API.listMeshLibrary();
            const meshes = data.meshes || [];

            // Update library list
            const listEl = document.getElementById('mesh-library-list');
            if (listEl) {
                if (meshes.length === 0) {
                    listEl.innerHTML = '<div class="empty-state">No saved meshes.</div>';
                } else {
                    listEl.innerHTML = meshes.map(mesh => `
                        <div class="library-item" data-mesh-id="${mesh.id}">
                            <div class="library-item-info">
                                <strong>${mesh.name}</strong>
                                <span class="library-item-meta">
                                    ${mesh.project || 'default'} | ${new Date(mesh.created).toLocaleDateString()}${mesh.polymesh_path ? ' | ✓ polyMesh' : ''}
                                </span>
                            </div>
                            <div class="library-item-actions">
                                <button class="btn btn-secondary btn-sm" onclick="app.downloadMesh('${mesh.id}')" title="Download mesh file">📥 Download</button>
                                <button class="btn btn-danger btn-sm" onclick="app.deleteMesh('${mesh.id}')">Delete</button>
                            </div>
                        </div>
                    `).join('');
                }
            }

            // Update mesh selector
            const selectorEl = document.getElementById('mesh-selector');
            if (selectorEl) {
                const currentValue = selectorEl.value;
                selectorEl.innerHTML = '<option value="">-- Select a mesh --</option>';

                // Add new mesh option
                const newMeshOption = document.createElement('option');
                newMeshOption.value = '__NEW_MESH__';
                newMeshOption.textContent = '+ Upload New Mesh';
                selectorEl.appendChild(newMeshOption);

                if (meshes.length > 0) {
                    const separator = document.createElement('option');
                    separator.disabled = true;
                    separator.textContent = '──────────────';
                    selectorEl.appendChild(separator);
                }

                meshes.forEach(mesh => {
                    const option = document.createElement('option');
                    option.value = mesh.id;
                    option.textContent = `${mesh.name} (${mesh.project || 'default'})`;
                    selectorEl.appendChild(option);
                });

                if (currentValue && (currentValue === '__NEW_MESH__' || meshes.find(m => m.id === currentValue))) {
                    selectorEl.value = currentValue;
                }
            }

        } catch (e) {
            console.error('Failed to load mesh library:', e);

            // Still populate selector with "Upload New Mesh" option even if API fails  
            const selectorEl = document.getElementById('mesh-selector');
            if (selectorEl) {
                selectorEl.innerHTML = '<option value="">-- Select a mesh --</option>';
                const newMeshOption = document.createElement('option');
                newMeshOption.value = '__NEW_MESH__';
                newMeshOption.textContent = '+ Upload New Mesh';
                selectorEl.appendChild(newMeshOption);
            }
        }
    }

    async deleteMesh(meshId) {
        if (!confirm('Delete this mesh from the library?')) return;

        try {
            await API.deleteMesh(meshId);
            this.addLog('Mesh deleted');
            await this.loadMeshLibrary();
        } catch (e) {
            this.addLog(`Error: ${e.message}`, 'error');
            alert('Failed to delete mesh');
        }
    }

    downloadMesh(meshId) {
        // Trigger download via direct link
        window.location.href = BASE_URL + `/api/mesh/library/${meshId}/download`;
    }

    async loadRuns() {
        try {
            const data = await API.listRuns();
            this.runsData = data.runs || [];
            this.renderRuns(this.runsData);
        } catch (e) {
            console.error('Failed to load runs:', e);
        }
    }

    renderRuns(runs) {
        const container = document.getElementById('runs-list');
        if (!container) return;

        if (runs.length === 0) {
            container.innerHTML = '<p class="empty-state">No runs yet. Select a mesh and create a run.</p>';
            return;
        }

        const formatSize = (bytes) => {
            if (!bytes) return '--';
            if (bytes >= 1024 * 1024 * 1024) {
                return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
            }
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        };

        const formatDuration = (seconds) => {
            if (!seconds) return '';
            if (seconds < 60) return `${Math.round(seconds)}s`;
            const mins = Math.floor(seconds / 60);
            const secs = Math.round(seconds % 60);
            return `${mins}m ${secs}s`;
        };

        container.innerHTML = runs.map(run => {
            const isSelected = this.currentRunId === run.run_id;
            const durationText = run.solve_duration_seconds ? ` | Solved in ${formatDuration(run.solve_duration_seconds)}` : '';
            const hasSettings = run.solver_config && Object.keys(run.solver_config).length > 0;

            return `
            <div class="run-item ${isSelected ? 'selected' : ''}" data-run-id="${run.run_id}">
                <div class="run-info">
                    <h5>${run.name || run.run_id}</h5>
                    <p>${run.mesh_name || 'Unknown mesh'} | ${new Date(run.created_at).toLocaleDateString()} | ${formatSize(run.size_bytes)}${durationText}</p>
                </div>
                <span class="run-status ${run.status || 'created'}">${run.status || 'Ready'}</span>
                <div class="run-actions">
                    ${hasSettings ? `<button class="btn btn-secondary btn-sm" onclick="app.showSettings('${run.run_id}')" title="View settings used">⚙️</button>` : ''}
                    <button class="btn btn-primary btn-sm" onclick="app.viewRun('${run.run_id}')">View</button>
                    <button class="btn btn-danger btn-sm" onclick="app.deleteRun('${run.run_id}')">Delete</button>
                </div>
            </div>`;
        }).join('');
    }

    showSettings(runId) {
        // Find the run data
        const run = this.runsData?.find(r => r.run_id === runId);
        if (!run) {
            alert('Run not found');
            return;
        }

        const solver = run.solver_config || {};
        const material = run.material_config || {};

        // Format settings for display
        let msg = `=== SOLVER SETTINGS ===\n`;
        msg += `Solver: ${solver.solver || 'simpleFoam'}\n`;
        msg += `End Time: ${solver.end_time || '--'}s\n`;
        msg += `Delta T: ${solver.delta_t || '--'}\n`;
        msg += `Write Interval: ${solver.write_interval || '--'}s\n`;
        msg += `Inlet Velocity: ${JSON.stringify(solver.inlet_velocity || [10, 0, 0])} m/s\n`;
        msg += `Wall Type: ${solver.wall_type || 'noSlip'}\n`;
        msg += `Turbulence Model: ${solver.turbulence_model || 'kOmegaSST'}\n`;
        msg += `Parallel: ${solver.parallel ? `Yes (${solver.num_cores} cores)` : 'No'}\n`;
        msg += `Relaxation U: ${solver.relax_u || '--'}\n`;
        msg += `Relaxation P: ${solver.relax_p || '--'}\n`;

        msg += `\n=== MATERIAL SETTINGS ===\n`;
        msg += `Preset: ${material.preset || 'air'}\n`;
        msg += `Density: ${material.density || '--'} kg/m³\n`;
        msg += `Kinematic Viscosity: ${material.kinematic_viscosity || '--'} m²/s\n`;

        if (run.solve_duration_seconds) {
            const mins = Math.floor(run.solve_duration_seconds / 60);
            const secs = Math.round(run.solve_duration_seconds % 60);
            msg += `\n=== TIMING ===\n`;
            msg += `Solve Duration: ${mins}m ${secs}s\n`;
        }

        alert(msg);
    }

    async createRun() {
        const meshSelector = document.getElementById('mesh-selector');
        const meshId = meshSelector?.value;
        const runNameInput = document.getElementById('new-run-name');
        const runName = runNameInput?.value?.trim() || '';
        const createBtn = document.getElementById('create-run-btn');

        if (!meshId) {
            alert('Please select a mesh first');
            return;
        }

        const isNewMesh = meshId === '__NEW_MESH__';

        if (createBtn) {
            createBtn.disabled = true;
            createBtn.textContent = isNewMesh ? 'Uploading...' : 'Creating...';
        }

        try {
            let result;

            if (isNewMesh) {
                if (!this.meshFile) {
                    throw new Error('Please select a mesh file');
                }

                // Upload mesh
                const formData = new FormData();
                formData.append('mesh_file', this.meshFile);
                if (runName) {
                    formData.append('run_name', runName);
                }

                result = await API.uploadMesh(formData);
                this.currentRunId = result.run_id;

                // Create polyMesh
                this.addLog('Creating PolyMesh...');
                await API.createPolyMesh(result.run_id);

                // Clear file input
                this.meshFile = null;
                document.getElementById('mesh-file-input').value = '';
                document.getElementById('mesh-upload-status').textContent = '';
                document.getElementById('mesh-upload-box').classList.remove('has-file');

            } else {
                result = await API.useMeshFromLibrary(meshId, runName);
            }

            this.currentRunId = result.run_id;
            this.addLog(`Run created: ${result.run_id}`);

            // Clear inputs
            if (runNameInput) runNameInput.value = '';
            if (meshSelector) meshSelector.value = '';

            // Hide upload section
            const uploadSection = document.getElementById('new-mesh-upload-section');
            if (uploadSection) uploadSection.style.display = 'none';

            // Reload and switch to solver tab
            await this.loadRuns();
            await this.viewRun(result.run_id);
            document.querySelector('[data-tab="solver"]')?.click();

        } catch (e) {
            console.error('createRun error:', e);
            this.addLog(`Error: ${e.message}`, 'error');
            alert(`Failed to create run: ${e.message}`);
        } finally {
            if (createBtn) {
                createBtn.disabled = false;
                createBtn.textContent = 'Create Run';
            }
        }
    }

    async viewRun(runId) {
        this.currentRunId = runId;

        try {
            const details = await API.getRunDetails(runId);

            // Update details panel
            document.getElementById('run-detail-name').textContent = details.name;
            document.getElementById('run-detail-status').textContent = details.status;
            document.getElementById('run-detail-mesh').textContent = details.mesh_name;
            document.getElementById('run-detail-created').textContent = new Date(details.created_at).toLocaleString();

            const pvOutputs = await API.getParaViewOutputs(runId);
            document.getElementById('run-detail-pv-path').textContent = pvOutputs.foam_file || pvOutputs.case_dir;

            // Show panel
            document.getElementById('run-details-panel').style.display = 'block';

            // Enable run and check mesh buttons
            document.getElementById('run-simulation-btn').disabled = false;
            document.getElementById('check-mesh-btn').disabled = false;

            // Set up check mesh button handler
            const checkMeshBtn = document.getElementById('check-mesh-btn');
            checkMeshBtn.onclick = () => this.checkMesh();

            // If simulation is running, show appropriate UI state
            const runBtn = document.getElementById('run-simulation-btn');
            const stopBtn = document.getElementById('stop-simulation-btn');
            const progressContainer = document.getElementById('progress-container');

            // Clear previous run's state when switching runs
            if (this.progressTimer) {
                clearInterval(this.progressTimer);
                this.progressTimer = null;
            }
            this.simStartTime = null;
            this.currentSimTime = 0;  // Use 0 instead of null so progress calculations work after log replay
            this.storageHistory = [];  // Clear storage history for fresh estimation

            // Reset progress display
            const progressFill = document.getElementById('progress-fill');
            const progressTime = document.getElementById('progress-time');
            const progressIter = document.getElementById('progress-iter');
            const progressEta = document.getElementById('progress-eta');
            if (progressFill) progressFill.style.width = '0%';
            if (progressTime) progressTime.textContent = 'Time: 0m 0s';
            if (progressIter) progressIter.textContent = 'SimTime: 0';
            if (progressEta) progressEta.textContent = 'ETA: calculating...';

            // Reset storage display
            const currentStorage = document.getElementById('current-storage');
            const estContainer = document.getElementById('est-size-container');
            if (currentStorage) currentStorage.textContent = '0 MB';
            if (estContainer) estContainer.style.display = 'none';

            // Clear log display for fresh start (logs will reload from WebSocket)
            this.logLines = [];
            this.updateLogDisplay();

            if (details.status === 'running') {
                // Simulation is running - show stop button and progress
                runBtn.disabled = true;
                stopBtn.disabled = false;
                progressContainer.style.display = 'block';
                this.addLog('[STATUS] Reconnected to running simulation');

                // Debug: log the ETA fields
                console.log('[ETA DEBUG] details.started_at:', details.started_at);
                console.log('[ETA DEBUG] details.end_time:', details.end_time);

                // Restore ETA state from metadata
                if (details.started_at) {
                    this.startedAt = new Date(details.started_at);
                    // Also set simStartTime which is used by WebSocket ETA calculation
                    this.simStartTime = this.startedAt.getTime();
                    console.log('[ETA DEBUG] Set this.startedAt:', this.startedAt);
                    console.log('[ETA DEBUG] Set this.simStartTime:', this.simStartTime);
                }
                if (details.end_time) {
                    this.endTime = details.end_time;
                    console.log('[ETA DEBUG] Set this.endTime:', this.endTime);
                }

                // Start progress timer if we have the info
                if (this.startedAt && this.endTime) {
                    console.log('[ETA DEBUG] Starting progress timer');
                    this.startProgressTimer();
                } else {
                    console.log('[ETA DEBUG] Missing startedAt or endTime, cannot start timer');
                }
            } else {
                // Not running - normal state
                runBtn.disabled = false;
                stopBtn.disabled = true;
                // Don't hide progress container to preserve logs from previous run
            }

            // Update run list selection
            this.renderRuns(this.runsData);

            // Connect WebSocket to this run
            this.connectWebSocket();

        } catch (e) {
            console.error('Failed to load run details:', e);
        }
    }

    async deleteRun(runId) {
        if (!confirm('Delete this run permanently?')) return;

        try {
            await API.deleteRun(runId);
            if (this.currentRunId === runId) {
                this.currentRunId = null;
                document.getElementById('run-details-panel').style.display = 'none';
            }
            await this.loadRuns();
            this.addLog('Run deleted');
        } catch (e) {
            this.addLog(`Error: ${e.message}`, 'error');
            alert('Failed to delete run');
        }
    }

    // ==================== Boundary Mapper ====================

    async loadPatches() {
        if (!this.currentRunId) return;

        try {
            const data = await API.getRunPatches(this.currentRunId);
            const patches = data.patches || [];

            const container = document.getElementById('patches-container');
            if (!container) return;

            if (patches.length === 0) {
                container.innerHTML = '<p class="empty-state">No patches detected. Import a mesh first.</p>';
                return;
            }

            container.innerHTML = `
                <h4>Detected Patches</h4>
                <div class="patch-list">
                    ${patches.map(p => `
                        <div class="patch-item">
                            <span class="boundary-badge ${p.category}">${p.name}</span>
                            <span class="patch-type">${p.type}</span>
                        </div>
                    `).join('')}
                </div>
            `;

        } catch (e) {
            console.error('Failed to load patches:', e);
        }
    }

    // ==================== Simulation Control ====================

    setupButtons() {
        const runBtn = document.getElementById('run-simulation-btn');
        const stopBtn = document.getElementById('stop-simulation-btn');

        if (runBtn) {
            runBtn.addEventListener('click', () => this.startSimulation());
        }

        if (stopBtn) {
            stopBtn.addEventListener('click', () => this.stopSimulation());
        }
    }

    getSolverSettings() {
        return {
            solver: document.getElementById('solver-select')?.value || 'simpleFoam',
            turbulence_model: document.getElementById('turbulence-model')?.value || 'kOmegaSST',
            end_time: parseFloat(document.getElementById('end-time')?.value) || 1000,
            delta_t: parseFloat(document.getElementById('delta-t')?.value) || 1e-5,
            write_control: document.getElementById('write-control')?.value || 'timeStep',
            write_interval: parseFloat(document.getElementById('write-interval')?.value) || 100,
            purge_write: parseInt(document.getElementById('purge-write')?.value) || 0,
            inlet_velocity: [
                parseFloat(document.getElementById('inlet-ux')?.value) || 10,
                parseFloat(document.getElementById('inlet-uy')?.value) || 0,
                parseFloat(document.getElementById('inlet-uz')?.value) || 0
            ],
            outlet_pressure: parseFloat(document.getElementById('outlet-pressure')?.value) || 0,
            wall_type: document.getElementById('wall-type')?.value || 'noSlip',
            wall_slip_fraction: parseInt(document.getElementById('wall-slip-fraction')?.value || 50) / 100,
            parallel: document.getElementById('enable-parallel')?.checked || false,
            num_cores: parseInt(document.getElementById('num-cores')?.value) || 4,
            relax_p: parseFloat(document.getElementById('relax-p')?.value) || 0.15,
            relax_u: parseFloat(document.getElementById('relax-u')?.value) || 0.3,
            adjust_timestep: document.getElementById('adjust-timestep')?.checked || false,
            max_co: parseFloat(document.getElementById('max-co')?.value) || 0.5,
            max_delta_t: parseFloat(document.getElementById('max-delta-t')?.value) || 1e-4,
            n_inner_correctors: parseInt(document.getElementById('n-correctors')?.value) || 2,
            n_non_ortho_correctors: parseInt(document.getElementById('n-non-ortho')?.value) || 0,
            res_p: parseFloat(document.getElementById('res-p')?.value) || 1e-4,
            res_u: parseFloat(document.getElementById('res-u')?.value) || 1e-4,
            div_scheme_u: document.getElementById('div-scheme-u')?.value || 'linearUpwind',
            div_scheme_turb: document.getElementById('div-scheme-turb')?.value || 'upwind',
            ddt_scheme: document.getElementById('ddt-scheme')?.value || 'steadyState'
        };
    }

    getMaterialSettings() {
        return {
            preset: document.getElementById('fluid-preset')?.value || 'air',
            temperature: parseFloat(document.getElementById('temperature')?.value) || 293.15,
            density: parseFloat(document.getElementById('density')?.value) || 1.225,
            kinematic_viscosity: parseFloat(document.getElementById('kinematic-viscosity')?.value) || 1.5e-5
        };
    }

    async checkMesh() {
        if (!this.currentRunId) {
            alert('Please select a run first');
            return;
        }

        const checkMeshBtn = document.getElementById('check-mesh-btn');
        const resultsContainer = document.getElementById('mesh-results-container');
        const statusEl = document.getElementById('mesh-results-status');
        const summaryEl = document.getElementById('mesh-results-summary');
        const detailsEl = document.getElementById('mesh-results-details');

        checkMeshBtn.disabled = true;
        checkMeshBtn.textContent = '⏳ Checking...';
        resultsContainer.style.display = 'block';
        statusEl.textContent = 'Running checkMesh...';
        statusEl.style.color = '#00d4ff';
        summaryEl.textContent = '';
        detailsEl.style.display = 'none';

        try {
            const response = await fetch(`${BASE_URL}/api/run/${this.currentRunId}/check-mesh`, {
                method: 'POST'
            });
            const data = await response.json();

            if (data.success) {
                if (data.mesh_ok) {
                    statusEl.textContent = '✅ Mesh OK';
                    statusEl.style.color = '#00ff88';
                } else if (data.issues && data.issues.length > 0) {
                    statusEl.textContent = '❌ Mesh has issues';
                    statusEl.style.color = '#ff4444';
                } else if (data.warnings && data.warnings.length > 0) {
                    statusEl.textContent = '⚠️ Mesh has warnings';
                    statusEl.style.color = '#ffaa00';
                } else {
                    statusEl.textContent = '✅ Mesh OK';
                    statusEl.style.color = '#00ff88';
                }

                // Build summary
                let summary = [];
                if (data.stats) {
                    if (data.stats.cells) summary.push(`Cells: ${data.stats.cells.toLocaleString()}`);
                    if (data.stats.max_non_orthogonality) summary.push(`Non-ortho: ${data.stats.max_non_orthogonality.toFixed(1)}°`);
                    if (data.stats.max_skewness) summary.push(`Skewness: ${data.stats.max_skewness.toFixed(2)}`);
                    if (data.stats.max_aspect_ratio) summary.push(`Aspect: ${data.stats.max_aspect_ratio.toFixed(1)}`);
                }
                if (data.issues && data.issues.length > 0) {
                    summary.push('Issues: ' + data.issues.join('; '));
                }
                if (data.warnings && data.warnings.length > 0) {
                    summary.push('Warnings: ' + data.warnings.join('; '));
                }
                summaryEl.textContent = summary.join(' | ');

                // Show raw output
                detailsEl.textContent = data.output || 'No output';

                this.addLog('[MESH CHECK] ' + statusEl.textContent);
            } else {
                statusEl.textContent = '❌ Check failed';
                statusEl.style.color = '#ff4444';
                summaryEl.textContent = data.error || 'Unknown error';
                this.addLog('[MESH CHECK] Failed: ' + (data.error || 'Unknown error'), 'error');
            }
        } catch (e) {
            statusEl.textContent = '❌ Error';
            statusEl.style.color = '#ff4444';
            summaryEl.textContent = e.message;
            this.addLog('[MESH CHECK] Error: ' + e.message, 'error');
        } finally {
            checkMeshBtn.disabled = false;
            checkMeshBtn.textContent = '🔍 Check Mesh';
        }
    }

    async startSimulation() {
        if (!this.currentRunId) {
            alert('Please select a run first');
            return;
        }

        const runBtn = document.getElementById('run-simulation-btn');
        const stopBtn = document.getElementById('stop-simulation-btn');
        const progressContainer = document.getElementById('progress-container');

        runBtn.disabled = true;
        stopBtn.disabled = false;
        progressContainer.style.display = 'block';

        const solverSettings = this.getSolverSettings();
        const materialSettings = this.getMaterialSettings();

        this.addLog('Starting simulation...');
        this.addLog(`Solver: ${solverSettings.solver}`);
        this.addLog(`Turbulence: ${solverSettings.turbulence_model}`);
        this.addLog(`Inlet velocity: (${solverSettings.inlet_velocity.join(', ')}) m/s`);

        try {
            this.simStartTime = Date.now();
            this.progressTimer = setInterval(() => this.updateProgressTimer(), 1000);

            await API.startRun(this.currentRunId, solverSettings, materialSettings);
        } catch (e) {
            this.addLog(`Error: ${e.message}`, 'error');
            runBtn.disabled = false;
            stopBtn.disabled = true;
            if (this.progressTimer) clearInterval(this.progressTimer);
        }
    }

    updateProgressTimer() {
        if (!this.simStartTime) return;

        const elapsed = Math.floor((Date.now() - this.simStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        document.getElementById('progress-time').textContent = `Time: ${mins}m ${secs}s`;

        // Fetch storage size every 5 seconds
        if (!this.lastStorageUpdate || (Date.now() - this.lastStorageUpdate > 5000)) {
            this.lastStorageUpdate = Date.now();
            this.updateStorageDisplay();
        }
    }

    startProgressTimer() {
        // Clear any existing timer
        if (this.progressTimer) {
            clearInterval(this.progressTimer);
        }
        // Start the progress timer
        this.progressTimer = setInterval(() => this.updateProgressTimer(), 1000);
    }

    async updateStorageDisplay() {
        if (!this.currentRunId) return;

        try {
            const result = await API.getJobStatus(this.currentRunId);
            if (result.size_bytes !== undefined) {
                const sizeBytes = result.size_bytes;
                const sizeMB = sizeBytes / (1024 * 1024);
                let sizeText;
                if (sizeBytes >= 1024 * 1024 * 1024) {
                    sizeText = `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
                } else {
                    sizeText = `${sizeMB.toFixed(1)} MB`;
                }

                const currentStorage = document.getElementById('current-storage');
                if (currentStorage) currentStorage.textContent = sizeText;

                // Track storage history for averaging (only if simTime has advanced)
                if (this.currentSimTime > 0 && sizeMB > 0) {
                    const lastEntry = this.storageHistory[this.storageHistory.length - 1];
                    // Only add if simTime has changed significantly
                    if (!lastEntry || this.currentSimTime > lastEntry.simTime + 0.001) {
                        this.storageHistory.push({
                            simTime: this.currentSimTime,
                            sizeMB: sizeMB
                        });
                        // Keep only last 20 entries for averaging
                        if (this.storageHistory.length > 20) {
                            this.storageHistory.shift();
                        }
                    }
                }

                // Update estimation
                this.updateEstimatedSize(sizeMB);
            }
        } catch (error) {
            console.debug('Storage fetch error:', error);
        }
    }

    updateEstimatedSize(currentSizeMB) {
        const estContainer = document.getElementById('est-size-container');
        const estValEl = document.getElementById('estimated-total-size');
        if (!estContainer || !estValEl) return;

        const solverSettings = this.getSolverSettings();
        const endTime = parseFloat(solverSettings.end_time) || 0;
        const writeInterval = parseFloat(solverSettings.write_interval) || 0;

        if (endTime > 0 && writeInterval > 0 && this.currentSimTime > 0) {
            const totalSteps = Math.ceil(endTime / writeInterval) + 1;

            // Calculate average MB per simTime unit using history
            let avgSizePerTime = 0;
            if (this.storageHistory.length >= 2) {
                // Use linear regression for better accuracy
                const first = this.storageHistory[0];
                const last = this.storageHistory[this.storageHistory.length - 1];
                const timeDiff = last.simTime - first.simTime;
                const sizeDiff = last.sizeMB - first.sizeMB;

                if (timeDiff > 0) {
                    avgSizePerTime = sizeDiff / timeDiff;
                }
            }

            // Calculate estimated total size
            let estimatedTotalMB;
            if (avgSizePerTime > 0) {
                // Project based on growth rate
                estimatedTotalMB = currentSizeMB + (avgSizePerTime * (endTime - this.currentSimTime));
            } else {
                // Fallback: use current size / progress ratio
                const progress = this.currentSimTime / endTime;
                if (progress > 0.01) {  // Only estimate if we have at least 1% progress
                    estimatedTotalMB = currentSizeMB / progress;
                } else {
                    // Too early to estimate, use heuristic
                    estimatedTotalMB = totalSteps * 35;  // ~35MB per step default for wind tunnel
                }
            }

            estContainer.style.display = '';
            if (estimatedTotalMB >= 1000) {
                estValEl.textContent = `~${(estimatedTotalMB / 1024).toFixed(2)} GB`;
            } else {
                estValEl.textContent = `~${Math.round(estimatedTotalMB)} MB`;
            }
        } else {
            estContainer.style.display = 'none';
        }
    }

    async stopSimulation() {
        if (!this.currentRunId) return;

        try {
            await API.stopRun(this.currentRunId);
            this.addLog('Simulation stopped');

            document.getElementById('run-simulation-btn').disabled = false;
            document.getElementById('stop-simulation-btn').disabled = true;
        } catch (e) {
            this.addLog(`Error: ${e.message}`, 'error');
        }
    }

    // ==================== WebSocket ====================

    setupWebSocket() {
        // Set up callback handlers (like Propeller GUI)
        this.ws.onLog((data) => {
            this.addLog(data.line);

            // Parse simulation time (format: "Time = X.XXX" or "Time = X")
            const timeMatch = data.line.match(/Time = ([\d.]+)/);
            if (timeMatch) {
                const simTime = parseFloat(timeMatch[1]);
                this.currentSimTime = simTime;
                document.getElementById('progress-iter').textContent = `SimTime: ${simTime.toFixed(4)}`;

                // Update progress bar and ETA
                const endTime = parseFloat(document.getElementById('end-time').value);
                if (endTime > 0 && simTime > 0) {
                    const percent = Math.min(100, (simTime / endTime) * 100);
                    document.getElementById('progress-fill').style.width = `${percent}%`;

                    // Calculate ETA based on elapsed real time and simulation progress
                    if (this.simStartTime && percent > 0) {
                        const elapsedMs = Date.now() - this.simStartTime;
                        const elapsedSecs = elapsedMs / 1000;
                        const totalEstimatedSecs = elapsedSecs * 100 / percent;
                        const etaSecs = Math.max(0, totalEstimatedSecs - elapsedSecs);

                        // Format ETA
                        let etaText;
                        if (etaSecs < 60) {
                            etaText = `${Math.round(etaSecs)}s`;
                        } else if (etaSecs < 3600) {
                            const mins = Math.floor(etaSecs / 60);
                            const secs = Math.round(etaSecs % 60);
                            etaText = `${mins}m ${secs}s`;
                        } else {
                            const hours = Math.floor(etaSecs / 3600);
                            const mins = Math.floor((etaSecs % 3600) / 60);
                            etaText = `${hours}h ${mins}m`;
                        }
                        document.getElementById('progress-eta').textContent = `ETA: ${etaText}`;
                    }
                }
            }
        });

        this.ws.onProgress((data) => {
            if (data.progress !== undefined) {
                document.getElementById('progress-fill').style.width = `${data.progress}%`;
            }
            if (data.iteration !== undefined) {
                document.getElementById('progress-iter').textContent = `Iter: ${data.iteration}`;
            }
        });

        this.ws.onComplete((data) => {
            this.addLog(data.message || 'Simulation complete');
            clearInterval(this.progressTimer);
            this.simStartTime = null;
            document.getElementById('run-simulation-btn').disabled = false;
            document.getElementById('stop-simulation-btn').disabled = true;
            document.getElementById('progress-fill').style.width = '100%';
            document.getElementById('progress-eta').textContent = 'Done';
            this.loadRuns();
        });

        this.ws.onError((data) => {
            this.addLog(`Error: ${data.message}`, 'error');
            clearInterval(this.progressTimer);
            this.simStartTime = null;
            document.getElementById('run-simulation-btn').disabled = false;
            document.getElementById('stop-simulation-btn').disabled = true;
        });

        this.ws.onConnection((status) => {
            this.updateConnectionStatus(status);
        });
    }

    connectWebSocket() {
        // Actually connect to WebSocket for the current run
        if (this.currentRunId) {
            console.log('[WS] Connecting to run:', this.currentRunId);
            this.ws.connect(this.currentRunId);
        }
    }

    // ==================== ParaView Calculator ====================

    setupParaviewCalculator() {
        const calcBtn = document.getElementById('calculate-pv-btn');
        if (!calcBtn) return;

        calcBtn.addEventListener('click', () => {
            const fps = parseFloat(document.getElementById('target-fps').value) || 30;
            const speed = parseFloat(document.getElementById('playback-speed').value) || 1.0;
            const endTime = parseFloat(document.getElementById('pv-end-time').value) || 1000;
            const writeInterval = parseFloat(document.getElementById('pv-write-interval').value) || 100;

            const timesteps = Math.floor(endTime / writeInterval);
            const simDuration = endTime / speed;
            const totalFrames = Math.ceil(simDuration * fps);
            const resampleFactor = Math.ceil(totalFrames / timesteps);

            document.getElementById('result-timesteps').textContent = timesteps;
            document.getElementById('result-duration').textContent = `${simDuration.toFixed(1)}s`;
            document.getElementById('result-frames').textContent = totalFrames;
            document.getElementById('result-resample').textContent = `${resampleFactor}x`;

            document.getElementById('pv-results').style.display = 'block';
        });
    }

    // ==================== Logging ====================

    setupLogControls() {
        const copyBtn = document.getElementById('copy-logs-btn');
        const copyWithSettingsBtn = document.getElementById('copy-logs-with-settings-btn');
        const clearBtn = document.getElementById('clear-logs-btn');
        const linesSelect = document.getElementById('log-lines');

        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const logOutput = document.getElementById('log-output');
                navigator.clipboard.writeText(logOutput.textContent);
                copyBtn.textContent = '✓ Copied';
                setTimeout(() => copyBtn.textContent = '📋 Copy Logs', 1500);
            });
        }

        if (copyWithSettingsBtn) {
            copyWithSettingsBtn.addEventListener('click', () => {
                const logOutput = document.getElementById('log-output');
                const settings = this.getSolverSettings();
                const materials = this.getMaterialSettings();

                const settingsText = `=== SOLVER SETTINGS ===
Solver: ${settings.solver}
Turbulence Model: ${settings.turbulence_model}
End Time: ${settings.end_time}
Delta T: ${settings.delta_t}
Write Control: ${settings.write_control}
Write Interval: ${settings.write_interval}
Inlet Velocity: (${settings.inlet_velocity.join(', ')}) m/s
Wall Type: ${settings.wall_type}
Parallel: ${settings.parallel ? 'Yes (' + settings.num_cores + ' cores)' : 'No'}
Relaxation P: ${settings.relax_p}, U: ${settings.relax_u}

=== MATERIAL SETTINGS ===
Preset: ${materials.preset}
Density: ${materials.density} kg/m3
Kinematic Viscosity: ${materials.kinematic_viscosity} m2/s
Temperature: ${materials.temperature} K

=== LOGS ===
${logOutput.textContent}`;

                navigator.clipboard.writeText(settingsText);
                copyWithSettingsBtn.textContent = '✓ Copied';
                setTimeout(() => copyWithSettingsBtn.textContent = '📋 Copy Logs + Settings', 1500);
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.logLines = [];
                this.updateLogDisplay();
            });
        }

        if (linesSelect) {
            linesSelect.addEventListener('change', () => {
                this.maxLogLines = parseInt(linesSelect.value);
                this.updateLogDisplay();
            });
        }
    }

    addLog(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        this.logLines.push(`[${timestamp}] ${message}`);

        while (this.logLines.length > this.maxLogLines) {
            this.logLines.shift();
        }

        this.updateLogDisplay();
        this.updateMiniLog(message);
    }

    updateLogDisplay() {
        const logOutput = document.getElementById('log-output');
        if (logOutput) {
            logOutput.textContent = this.logLines.join('\n');
            logOutput.scrollTop = logOutput.scrollHeight;
        }
    }

    updateMiniLog(message) {
        const miniLog = document.getElementById('mini-log');
        if (miniLog) {
            const line = document.createElement('div');
            line.textContent = message;
            miniLog.appendChild(line);

            // Keep only last 20 lines
            while (miniLog.children.length > 20) {
                miniLog.removeChild(miniLog.firstChild);
            }

            miniLog.scrollTop = miniLog.scrollHeight;
        }
    }

    // ==================== Connection Status ====================

    updateConnectionStatus(status) {
        const indicator = document.getElementById('connection-status');
        if (!indicator) return;

        const dot = indicator.querySelector('.status-dot');
        const text = indicator.querySelector('.status-text');

        if (status === 'connected') {
            dot.style.background = 'var(--accent-success)';
            text.textContent = 'Ready';
        } else {
            dot.style.background = 'var(--accent-danger)';
            text.textContent = 'Disconnected';
        }
    }

    // ==================== Defaults Management ====================

    setupDefaultsButton() {
        // Global save all defaults button
        const saveBtn = document.getElementById('save-defaults-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveDefaults());
        }

        // Per-field default buttons (⭐ next to each input)
        document.querySelectorAll('.default-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                const fieldId = btn.dataset.field;
                if (!fieldId) return;

                const el = document.getElementById(fieldId);
                if (!el) return;

                // Get the value based on input type
                let value;
                if (el.type === 'checkbox') {
                    value = el.checked;
                } else {
                    value = el.value;
                }

                // Save to localStorage for quick access
                const defaults = JSON.parse(localStorage.getItem('windTunnelDefaults') || '{}');
                defaults[fieldId] = value;
                localStorage.setItem('windTunnelDefaults', JSON.stringify(defaults));

                // Also save to server
                try {
                    await API.saveDefaults(defaults);
                } catch (e) {
                    console.log('Server save failed, using local storage');
                }

                // Visual feedback
                btn.classList.add('saved');
                btn.textContent = '✓';
                setTimeout(() => {
                    btn.classList.remove('saved');
                    btn.textContent = '⭐';
                }, 1500);

                this.addLog(`Set default for ${fieldId}: ${value}`);
            });
        });
    }

    async loadDefaults() {
        // First try localStorage for per-field defaults
        const localDefaults = JSON.parse(localStorage.getItem('windTunnelDefaults') || '{}');

        // Apply localStorage defaults directly by field ID
        Object.entries(localDefaults).forEach(([fieldId, value]) => {
            const el = document.getElementById(fieldId);
            if (el) {
                if (el.type === 'checkbox') {
                    el.checked = value;
                    // Trigger parallel inputs visibility
                    if (fieldId === 'enable-parallel') {
                        document.getElementById('parallel-inputs').style.display = value ? 'block' : 'none';
                    }
                } else {
                    el.value = value;
                }
            }
        });

        // Then try server defaults (these may override)
        try {
            const defaults = await API.getDefaults();
            if (!defaults || Object.keys(defaults).length === 0) return;

            // Apply all server defaults by field ID
            Object.entries(defaults).forEach(([fieldId, value]) => {
                const el = document.getElementById(fieldId);
                if (el) {
                    if (el.type === 'checkbox') {
                        el.checked = value;
                        if (fieldId === 'enable-parallel') {
                            document.getElementById('parallel-inputs').style.display = value ? 'block' : 'none';
                        }
                    } else if (Array.isArray(value)) {
                        // Special handling for inlet-velocity array if needed,
                        // but we use individual IDs for defaults now (inlet-ux, etc.)
                        if (fieldId === 'inlet_velocity') {
                            document.getElementById('inlet-ux').value = value[0] || 10;
                            document.getElementById('inlet-uy').value = value[1] || 0;
                            document.getElementById('inlet-uz').value = value[2] || 0;
                        }
                    } else {
                        el.value = value;
                    }
                }
            });

            this.addLog('Loaded defaults from server');
        } catch (e) {
            console.log('Failed to load server defaults:', e);
        }
    }

    async saveDefaults() {
        // Get all star buttons and simulate clicking each one
        const starButtons = document.querySelectorAll('.default-btn');

        const saveBtn = document.getElementById('save-defaults-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = '⏳ Saving...';
        }

        // Collect all defaults first
        const defaults = {};

        // Click each star button with a small delay for visual effect
        let delay = 0;
        for (const btn of starButtons) {
            const fieldId = btn.dataset.field;
            if (!fieldId) continue;

            const el = document.getElementById(fieldId);
            if (!el) continue;

            // Get the value
            let value;
            if (el.type === 'checkbox') {
                value = el.checked;
            } else {
                value = el.value;
            }
            defaults[fieldId] = value;

            // Visual feedback with slight stagger
            setTimeout(() => {
                btn.classList.add('saved');
                btn.textContent = '✓';
                setTimeout(() => {
                    btn.classList.remove('saved');
                    btn.textContent = '⭐';
                }, 1500);
            }, delay);
            delay += 50; // Stagger each button by 50ms
        }

        // Save to localStorage
        localStorage.setItem('windTunnelDefaults', JSON.stringify(defaults));

        // Save to server
        try {
            await API.saveDefaults(defaults);
            this.addLog('All defaults saved to server');
        } catch (e) {
            console.log('Server save failed, using local storage');
        }

        if (saveBtn) {
            saveBtn.textContent = '✓ All Saved!';
            saveBtn.disabled = false;
            setTimeout(() => saveBtn.textContent = '💾 Save All Defaults', 2000);
        }
    }
}

// Initialize app
const app = new App();
