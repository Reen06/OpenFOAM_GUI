/**
 * OpenFOAM Web Propeller GUI - Main Application
 */

class App {
    constructor() {
        // State
        this.currentRunId = null;
        this.selectedMeshId = null;
        this.selectedMeshName = null;
        this.rotorFile = null;
        this.statorFile = null;
        this.logLines = [];
        this.maxLogLines = 100;

        // Simulation timing
        this.simStartTime = null;
        this.simEndTime = null;
        this.currentSimTime = 0;
        this.iterationCount = 0;

        // Storage tracking for averaging
        this.storageHistory = [];  // Array of {simTime, sizeMB} for averaging

        // WebSocket
        this.ws = new WebSocketManager();

        // Initialize
        this.init();
    }

    init() {
        this.setupTabs();
        this.setupFileUpload();
        this.setupMaterialPresets();
        this.setupParallelToggle();
        this.setupWindToggle();
        this.setupButtons();
        this.setupWebSocket();
        this.setupParaviewCalculator();
        this.setupLogControls();
        this.setupRunFilters();
        this.setupInfoButtons();
        this.setupDefaults();
        this.setupMeshManager();
        this.setupMeshManager();
        this.setupRunManager();
        this.setupPerformanceTab();

        // Load initial data
        this.rmLoadRuns();
        this.loadMeshLibrary();


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
                await this.rmViewRun(runId);

                // Switch to requested tab (usually solver settings to see logs)
                if (tab) {
                    document.querySelector(`[data-tab="${tab}"]`)?.click();
                }

                // Clean up URL
                window.history.replaceState({}, document.title, window.location.pathname);
            }, 500);
        }
    }

    setupInfoButtons() {
        const helpText = {
            'solver': `
                <strong>Solver Selection</strong><br><br>
                - <strong>pimpleFoam:</strong> Standard transient solver for incompressible flow. Best for rotating propellers.<br>
                - <strong>simpleFoam:</strong> Steady-state solver. Use for quick results once the flow is developed.<br>
                - <strong>rhoPimpleFoam:</strong> Compressible transient solver. Use for high-speed propellers (blade tips > Mach 0.3).
            `,
            'end-time': `
                <strong>End Time</strong><br><br>
                Total physical time to simulate in seconds. For a propeller at 3000 RPM (50 rev/s), 0.1s is enough for 5 full rotations.
            `,
            'timestep-mode': `
                <strong>Timestep Mode</strong><br><br>
                - <strong>Adaptive:</strong> Automatically adjusts Delta T to keep Courant number below Max Co. Highly recommended for stability.<br>
                - <strong>Fixed:</strong> Uses the exact Fixed Delta T provided. Faster but prone to crashing if too large.
            `,
            'max-co': `
                <strong>Max Courant Number (Co)</strong><br><br>
                Controls stability. <br>
                - <strong>0.3 - 0.5:</strong> Recommended for rotating meshes.<br>
                - <strong>0.8 - 1.0:</strong> Faster but risks numerical 'blow-up'.
            `,
            'delta-t': `
                <strong>Initial Delta T</strong><br><br>
                Starting timestep for adaptive mode. The solver will adjust this immediately. Usually 1e-5 or 1e-6 is a safe start.
            `,
            'fixed-delta-t': `
                <strong>Fixed Delta T</strong><br><br>
                The constant timestep used in Fixed mode. Must be small enough to capture rotation (e.g., < 1/100th of a rotation period).
            `,
            'write-interval': `
                <strong>Write Interval</strong><br><br>
                Saves result files every X seconds of simulation time. 0.001s (1ms) is typical for high-speed analysis.
            `,
            'purge-write': `
                <strong>Purge Write</strong><br><br>
                Keep only the last N result folders. Set to 0 to keep all.
            `,
            'rotation-rpm': `
                <strong>Target RPM</strong><br><br>
                Desired rotation speed in Revolutions Per Minute. Positive values follow Right-Hand Rule (usually clockwise looking from behind).
            `,
            'rotation-axis': `
                <strong>Rotation Axis</strong><br><br>
                The axis vector the propeller rotates around. Check your model's orientation!
            `,
            'ramp-duration': `
                <strong>Ramp Duration</strong><br><br>
                Time in seconds to linearly increase RPM from 0 to Target. Helps prevent simulation crashes caused by sudden motion.
            `,
            'correctors': `
                <strong>PIMPLE Correctors</strong><br><br>
                Number of pressure-velocity coupling loops per step. 4-6 is typical for rotating cases.
            `,
            'relax-p': `
                <strong>Pressure Relaxation</strong><br><br>
                Suggested: 0.2 - 0.3. Lower values improve stability at the start.
            `,
            'relax-u': `
                <strong>Velocity Relaxation</strong><br><br>
                Suggested: 0.5 - 0.7. Lower this if the simulation residuals are high or oscillating.
            `
        };

        document.querySelectorAll('.info-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const key = btn.dataset.info;
                const info = helpText[key];

                if (info) {
                    this.showInfoModal(info);
                } else if (btn.hasAttribute('onclick')) {
                    // Fallback for any buttons still using legacy onclick
                }
            });
        });
    }

    showInfoModal(html) {
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop'; // Ensure styles exist or use inline
        Object.assign(backdrop.style, {
            position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
            background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: '2000'
        });
        backdrop.onclick = () => document.body.removeChild(backdrop);

        const modal = document.createElement('div');
        Object.assign(modal.style, {
            background: 'var(--bg-secondary)', padding: '24px', borderRadius: '12px',
            maxWidth: '500px', border: '1px solid var(--border-color)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)', color: 'var(--text-primary)'
        });
        modal.innerHTML = `
            <div style="margin-bottom: 20px; line-height: 1.5;">${html}</div>
            <button class="btn btn-primary" style="width: 100%">Got it</button>
        `;
        modal.onclick = (e) => e.stopPropagation();
        modal.querySelector('button').onclick = () => document.body.removeChild(backdrop);

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
    }

    // ==================== Persistent Defaults System ====================

    setupDefaults() {
        // Star buttons for saving defaults
        document.querySelectorAll('.default-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                const fieldId = btn.dataset.field;
                const el = document.getElementById(fieldId);
                if (!el) return;

                let value;
                if (el.type === 'checkbox') {
                    value = el.checked;
                } else {
                    value = el.value;
                }

                // Save to localStorage
                const defaults = JSON.parse(localStorage.getItem('propellerDefaults') || '{}');
                defaults[fieldId] = value;
                localStorage.setItem('propellerDefaults', JSON.stringify(defaults));

                // Save to server
                try {
                    await fetch(BASE_URL + '/api/defaults', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(defaults)
                    });
                } catch (e) {
                    console.log('Server save failed');
                }

                // Visual feedback
                btn.classList.add('saved');
                const originalText = btn.textContent;
                btn.textContent = '✓';
                setTimeout(() => {
                    btn.classList.remove('saved');
                    btn.textContent = originalText;
                }, 1500);

                this.addLog(`Set default for ${fieldId}: ${value}`);
            });
        });

        // Save All Defaults button
        const saveAllBtn = document.getElementById('save-defaults-btn');
        if (saveAllBtn) {
            saveAllBtn.addEventListener('click', () => this.saveDefaults());
        }

        // Load defaults
        this.loadDefaults();
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
        localStorage.setItem('propellerDefaults', JSON.stringify(defaults));

        // Save to server
        try {
            await fetch(BASE_URL + '/api/defaults', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(defaults)
            });
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

    async loadDefaults() {
        // Try local storage first
        const localDefaults = JSON.parse(localStorage.getItem('propellerDefaults') || '{}');
        Object.entries(localDefaults).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) {
                if (el.type === 'checkbox') {
                    el.checked = val;
                    // Trigger specific toggles if any
                    if (id === 'enable-parallel') document.getElementById('parallel-inputs').style.display = val ? 'block' : 'none';
                    if (id === 'enable-wind') document.getElementById('wind-inputs').style.display = val ? 'block' : 'none';
                } else {
                    el.value = val;
                }
            }
        });

        // Then server
        try {
            const response = await fetch(BASE_URL + '/api/defaults');
            if (response.ok) {
                const defaults = await response.json();
                Object.entries(defaults).forEach(([id, val]) => {
                    const el = document.getElementById(id);
                    if (el) {
                        if (el.type === 'checkbox') {
                            el.checked = val;
                            if (id === 'enable-parallel') document.getElementById('parallel-inputs').style.display = val ? 'block' : 'none';
                            if (id === 'enable-wind') document.getElementById('wind-inputs').style.display = val ? 'block' : 'none';
                        } else {
                            el.value = val;
                        }
                    }
                });
            }
        } catch (e) {
            console.log('No server defaults found');
        }
    }

    // ==================== Mesh Manager ====================

    setupMeshManager() {
        // Step 3: Save to Library button
        document.getElementById('save-to-library-btn')?.addEventListener('click', () => this.saveToLibrary());
    }

    async loadMeshLibrary() {
        const listEl = document.getElementById('mesh-library-list');
        const selectorEl = document.getElementById('mesh-selector');

        try {
            const response = await fetch(BASE_URL + '/api/mesh/library');
            if (!response.ok) throw new Error('Failed to load mesh library');

            const data = await response.json();
            const meshes = data.meshes || [];

            // Update library list in Mesh Manager
            if (listEl) {
                if (meshes.length === 0) {
                    listEl.innerHTML = '<div class="empty-state">No saved meshes. Complete steps 1-3 above to add meshes.</div>';
                } else {
                    listEl.innerHTML = meshes.map(mesh => `
                        <div class="library-item" data-mesh-id="${mesh.id}">
                            <div class="library-item-info">
                                <strong>${mesh.name}</strong>
                                <span class="library-item-meta">
                                    ${mesh.project || 'default'} | ${new Date(mesh.created).toLocaleDateString()}
                                </span>
                            </div>
                            <div class="library-item-actions">
                                <button class="btn btn-secondary btn-sm" onclick="API.downloadMesh('${mesh.id}')" title="Download UNV files (zip)">📥 Download</button>
                                <button class="btn btn-danger btn-sm" onclick="app.deleteMesh('${mesh.id}')">Delete</button>
                            </div>
                        </div>
                    `).join('');
                }
            }

            // Update mesh selector dropdown in Run Manager
            if (selectorEl) {
                const currentValue = selectorEl.value;
                selectorEl.innerHTML = '<option value="">-- Select a mesh --</option>';

                // Add "Add A New Mesh" option first
                const newMeshOption = document.createElement('option');
                newMeshOption.value = '__NEW_MESH__';
                newMeshOption.textContent = '+ Add A New Mesh (upload files)';
                newMeshOption.style.fontWeight = 'bold';
                selectorEl.appendChild(newMeshOption);

                // Add separator
                if (meshes.length > 0) {
                    const separator = document.createElement('option');
                    separator.disabled = true;
                    separator.textContent = '──────────────';
                    selectorEl.appendChild(separator);
                }

                // Add existing meshes
                meshes.forEach(mesh => {
                    const option = document.createElement('option');
                    option.value = mesh.id;
                    option.textContent = `${mesh.name} (${mesh.project || 'default'})`;
                    option.dataset.meshName = mesh.name;
                    selectorEl.appendChild(option);
                });
                // Restore previous selection if still valid
                if (currentValue && (currentValue === '__NEW_MESH__' || meshes.find(m => m.id === currentValue))) {
                    selectorEl.value = currentValue;
                }

                // Show warning only if no meshes AND not new mesh mode
                const warning = document.getElementById('no-meshes-warning');
                if (warning) {
                    warning.style.display = 'none'; // Always hide now since we have "Add New Mesh"
                }
            }

        } catch (e) {
            console.error('Failed to load mesh library:', e);
            if (listEl) listEl.innerHTML = '<div class="empty-state">Failed to load mesh library</div>';

            // Still populate selector with "Add New Mesh" option even if API fails
            if (selectorEl) {
                selectorEl.innerHTML = '<option value="">-- Select a mesh --</option>';
                const newMeshOption = document.createElement('option');
                newMeshOption.value = '__NEW_MESH__';
                newMeshOption.textContent = '+ Add A New Mesh (upload files)';
                newMeshOption.style.fontWeight = 'bold';
                selectorEl.appendChild(newMeshOption);
            }
        }
    }

    async saveToLibrary() {
        const nameInput = document.getElementById('mesh-name-input');
        const projectInput = document.getElementById('mesh-project-input');
        const name = nameInput?.value?.trim();
        const project = projectInput?.value?.trim() || 'default';

        if (!name) {
            alert('Please enter a mesh name');
            nameInput?.focus();
            return;
        }

        if (!this.rotorFile || !this.statorFile) {
            alert('Please complete Step 1 first: upload rotor and stator files');
            return;
        }

        const formData = new FormData();
        formData.append('name', name);
        formData.append('project', project);
        formData.append('rotor_file', this.rotorFile);
        formData.append('stator_file', this.statorFile);

        // Pass run_id so backend can copy polyMesh from run directory
        if (this.currentRunId) {
            formData.append('run_id', this.currentRunId);
        }

        const btn = document.getElementById('save-to-library-btn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Saving...';
        }

        try {
            this.addLog(`Saving mesh "${name}" to library...`);
            const response = await fetch(BASE_URL + '/api/mesh/library', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.detail || 'Failed to save mesh');
            }

            const result = await response.json();
            this.addLog(`Mesh saved: ${result.message || 'Success'}`);

            // Clear input and reload
            if (nameInput) nameInput.value = '';
            await this.loadMeshLibrary();

            alert('Mesh saved to library! You can now create runs from it in Run Manager.');

        } catch (e) {
            console.error('saveToLibrary error:', e);
            this.addLog(`Error: ${e.message}`, 'error');
            alert(`Failed to save: ${e.message}`);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Save to Library';
            }
        }
    }

    async deleteMesh(meshId) {
        if (!confirm('Delete this mesh from the library?')) return;

        try {
            const response = await fetch(BASE_URL + `/api/mesh/library/${meshId}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to delete mesh');
            this.addLog('Mesh deleted');
            await this.loadMeshLibrary();
        } catch (e) {
            this.addLog(`Error: ${e.message}`, 'error');
            alert('Failed to delete mesh');
        }
    }

    // ==================== Run Manager ====================
    // All debug logs use [RM-DEBUG] prefix for easy grep/removal

    setupRunManager() {
        console.log('[RM-DEBUG] setupRunManager() called');
        this.addLog('[RM-DEBUG] Setting up Run Manager...');

        // Get elements
        const meshSelector = document.getElementById('mesh-selector');
        const createBtn = document.getElementById('create-run-btn');
        const refreshBtn = document.getElementById('refresh-runs-btn');
        const solverBtn = document.getElementById('go-to-solver-btn');
        const paraviewBtn = document.getElementById('go-to-paraview-btn');

        // Log found elements
        console.log('[RM-DEBUG] Elements found:', {
            meshSelector: !!meshSelector,
            createBtn: !!createBtn,
            refreshBtn: !!refreshBtn,
            solverBtn: !!solverBtn,
            paraviewBtn: !!paraviewBtn
        });

        // Mesh selector change - enable/disable create button and toggle upload section
        if (meshSelector) {
            meshSelector.addEventListener('change', () => {
                const value = meshSelector.value;
                const hasValue = !!value;
                const isNewMesh = value === '__NEW_MESH__';

                console.log('[RM-DEBUG] Mesh selector changed:', value, 'isNewMesh:', isNewMesh);
                this.addLog(`[RM-DEBUG] Mesh selected: ${value || 'none'}`);

                // Toggle new mesh upload section
                const uploadSection = document.getElementById('new-mesh-upload-section');
                if (uploadSection) {
                    uploadSection.style.display = isNewMesh ? 'block' : 'none';
                }

                if (createBtn) {
                    // Enable create button if mesh selected (or if new mesh mode with files)
                    createBtn.disabled = !hasValue;
                    createBtn.textContent = isNewMesh ? 'Create Run (Upload & Process)' : 'Create Run';
                    console.log('[RM-DEBUG] Create button disabled:', createBtn.disabled);
                }
            });
        }

        // Create run button
        if (createBtn) {
            createBtn.addEventListener('click', () => {
                console.log('[RM-DEBUG] Create Run button clicked');
                this.addLog('[RM-DEBUG] Create Run button clicked');
                this.rmCreateRun();
            });
        }

        // Refresh runs button
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                console.log('[RM-DEBUG] Refresh button clicked');
                this.addLog('[RM-DEBUG] Refresh button clicked');
                this.rmLoadRuns();
            });
        }

        // Go to solver button
        if (solverBtn) {
            solverBtn.addEventListener('click', () => {
                console.log('[RM-DEBUG] Go to Solver button clicked');
                this.addLog('[RM-DEBUG] Navigating to Solver tab');
                document.querySelector('[data-tab="solver"]')?.click();
            });
        }

        // Go to ParaView button
        if (paraviewBtn) {
            paraviewBtn.addEventListener('click', () => {
                console.log('[RM-DEBUG] Go to ParaView button clicked');
                this.addLog('[RM-DEBUG] Navigating to ParaView tab');
                document.querySelector('[data-tab="paraview"]')?.click();
            });
        }

        // Setup Run Manager upload boxes (for "Add New Mesh" flow)
        this.setupRmUploadBoxes();

        console.log('[RM-DEBUG] setupRunManager() complete');
        this.addLog('[RM-DEBUG] Run Manager setup complete');
    }

    setupRmUploadBoxes() {
        const rmRotorUpload = document.getElementById('rm-rotor-upload');
        const rmStatorUpload = document.getElementById('rm-stator-upload');
        const rmRotorInput = document.getElementById('rm-rotor-file');
        const rmStatorInput = document.getElementById('rm-stator-file');

        if (!rmRotorUpload || !rmStatorUpload) return;

        // Click to select
        rmRotorUpload.addEventListener('click', () => rmRotorInput.click());
        rmStatorUpload.addEventListener('click', () => rmStatorInput.click());

        // File selection
        rmRotorInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.rmRotorFile = e.target.files[0];
                this.updateRmUploadStatus('rm-rotor', this.rmRotorFile.name);
            }
        });

        rmStatorInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.rmStatorFile = e.target.files[0];
                this.updateRmUploadStatus('rm-stator', this.rmStatorFile.name);
            }
        });

        // Drag and drop
        [rmRotorUpload, rmStatorUpload].forEach((box, index) => {
            box.addEventListener('dragover', (e) => {
                e.preventDefault();
                box.style.borderColor = 'var(--accent-primary)';
            });

            box.addEventListener('dragleave', () => {
                box.style.borderColor = '';
            });

            box.addEventListener('drop', (e) => {
                e.preventDefault();
                box.style.borderColor = '';

                if (e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    if (index === 0) {
                        this.rmRotorFile = file;
                        this.updateRmUploadStatus('rm-rotor', file.name);
                    } else {
                        this.rmStatorFile = file;
                        this.updateRmUploadStatus('rm-stator', file.name);
                    }
                }
            });
        });
    }

    updateRmUploadStatus(type, filename) {
        const statusEl = document.getElementById(`${type}-status`);
        const uploadBox = document.getElementById(`${type}-upload`);

        if (statusEl) statusEl.textContent = filename;
        if (uploadBox) uploadBox.classList.add('has-file');
    }

    async rmLoadRuns() {
        console.log('[RM-DEBUG] rmLoadRuns() called');
        this.addLog('[RM-DEBUG] Loading runs...');

        try {
            console.log('[RM-DEBUG] Fetching /api/run/list...');
            const response = await fetch(BASE_URL + '/api/run/list');
            console.log('[RM-DEBUG] Response status:', response.status);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log('[RM-DEBUG] Runs data:', data);
            this.addLog(`[RM-DEBUG] Loaded ${data.runs?.length || 0} runs`);

            this.rmRenderRuns(data.runs || []);

        } catch (error) {
            console.error('[RM-DEBUG] rmLoadRuns error:', error);
            this.addLog(`[RM-DEBUG] ERROR loading runs: ${error.message}`, 'error');
        }
    }

    rmRenderRuns(runs) {
        console.log('[RM-DEBUG] rmRenderRuns() called with', runs.length, 'runs');
        this.addLog(`[RM-DEBUG] Rendering ${runs.length} runs`);

        // Store runs data for later access (e.g., settings popup)
        this.runsData = runs;

        const container = document.getElementById('runs-list');
        if (!container) {
            console.error('[RM-DEBUG] runs-list container not found!');
            return;
        }

        if (runs.length === 0) {
            container.innerHTML = '<p class="empty-state">No runs yet. Select a mesh and create a run.</p>';
            return;
        }

        // Helper to format bytes to readable size
        const formatSize = (bytes) => {
            if (!bytes || bytes === 0) return '--';
            if (bytes >= 1024 * 1024 * 1024) {
                return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
            }
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        };

        // Helper to format duration in seconds to readable format
        const formatDuration = (seconds) => {
            if (!seconds && seconds !== 0) return '--';
            if (seconds < 60) return `${Math.round(seconds)}s`;
            if (seconds < 3600) {
                const mins = Math.floor(seconds / 60);
                const secs = Math.round(seconds % 60);
                return `${mins}m ${secs}s`;
            }
            const hours = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${mins}m`;
        };

        container.innerHTML = runs.map(run => {
            const isSelected = this.currentRunId === run.run_id;
            console.log('[RM-DEBUG] Rendering run:', run.run_id, 'selected:', isSelected);
            const sizeText = formatSize(run.size_bytes);
            const durationText = formatDuration(run.solve_duration_seconds);
            const hasSettings = run.solver_config && Object.keys(run.solver_config).length > 0;

            return `
            <div class="run-item ${isSelected ? 'selected' : ''}" data-run-id="${run.run_id}">
                <div class="run-info">
                    <h5>${run.name || run.run_id}</h5>
                    <p>${run.mesh_name || 'Unknown mesh'} | ${new Date(run.created_at).toLocaleDateString()} | <strong>${sizeText}</strong>${run.solve_duration_seconds ? ` | Solved in ${durationText}` : ''}</p>
                </div>
                <span class="run-status ${run.status || 'created'}">${run.status || 'Ready'}</span>
                <div class="run-actions">
                    ${hasSettings ? `<button class="btn btn-secondary btn-sm" onclick="app.rmShowSettings('${run.run_id}')" title="View settings used">⚙️</button>` : ''}
                    <button class="btn btn-primary btn-sm" onclick="app.rmViewRun('${run.run_id}')">View</button>
                    <button class="btn btn-danger btn-sm" onclick="app.rmDeleteRun('${run.run_id}')">Delete</button>
                </div>
            </div>`;
        }).join('');

        console.log('[RM-DEBUG] rmRenderRuns() complete');
    }

    rmShowSettings(runId) {
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
        msg += `Solver: ${solver.solver || 'pimpleFoam'}\n`;
        msg += `End Time: ${solver.end_time || '--'}s\n`;
        msg += `Delta T: ${solver.delta_t || '--'}\n`;
        msg += `Write Interval: ${solver.write_interval || '--'}s\n`;
        msg += `RPM: ${solver.rotation_rpm || '--'}\n`;
        msg += `Rotation Axis: ${JSON.stringify(solver.rotation_axis || [0, 0, 1])}\n`;
        msg += `Parallel: ${solver.parallel ? `Yes (${solver.num_cores} cores)` : 'No'}\n`;
        msg += `Fixed Timestep: ${solver.fixed_timestep ? 'Yes' : 'No (Adaptive)'}\n`;
        msg += `Max Courant: ${solver.max_co || '--'}\n`;
        msg += `RPM Ramp-up: ${solver.enable_rampup ? `Yes (${solver.ramp_duration}s)` : 'No'}\n`;

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

    async rmCreateRun() {
        console.log('[RM-DEBUG] rmCreateRun() called');
        this.addLog('[RM-DEBUG] Creating new run...');

        const meshSelector = document.getElementById('mesh-selector');
        const meshId = meshSelector?.value;
        const meshName = meshSelector?.selectedOptions[0]?.textContent || 'Unknown';
        const runNameInput = document.getElementById('new-run-name');
        const runName = runNameInput?.value?.trim() || '';
        const createBtn = document.getElementById('create-run-btn');

        console.log('[RM-DEBUG] Create params:', { meshId, meshName, runName });
        this.addLog(`[RM-DEBUG] Mesh: ${meshId}, Name: ${runName || '(auto)'}`);

        if (!meshId) {
            console.log('[RM-DEBUG] No mesh selected, aborting');
            this.addLog('[RM-DEBUG] ERROR: No mesh selected', 'error');
            alert('Please select a mesh first');
            return;
        }

        // Check if creating new mesh
        const isNewMesh = meshId === '__NEW_MESH__';

        // Disable button
        if (createBtn) {
            createBtn.disabled = true;
            createBtn.textContent = isNewMesh ? 'Uploading & Processing...' : 'Creating...';
        }

        try {
            let result;

            if (isNewMesh) {
                // NEW MESH FLOW: Upload files, create run, create polymesh
                const rotorFile = this.rmRotorFile;
                const statorFile = this.rmStatorFile;

                if (!rotorFile || !statorFile) {
                    throw new Error('Please select both rotor and stator mesh files');
                }

                console.log('[RM-DEBUG] New mesh flow - uploading files...');
                this.addLog('[RM-DEBUG] Uploading mesh files...');

                // Step 1: Upload meshes and create run with name
                const formData = new FormData();
                formData.append('rotor_file', rotorFile);
                formData.append('stator_file', statorFile);
                if (runName) {
                    formData.append('run_name', runName);  // Pass run name to backend
                }

                const uploadResponse = await fetch(BASE_URL + '/api/mesh/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!uploadResponse.ok) {
                    throw new Error('Failed to upload mesh files');
                }

                const uploadResult = await uploadResponse.json();
                console.log('[RM-DEBUG] Upload result:', uploadResult);

                // Get run_id from upload (run is already named correctly)
                const tempRunId = uploadResult.run_id;
                this.currentRunId = tempRunId;

                this.addLog('[RM-DEBUG] Creating PolyMesh...');

                // Step 2: Create PolyMesh
                const polymeshResponse = await fetch(BASE_URL + `/api/run/${tempRunId}/create-polymesh`, {
                    method: 'POST'
                });

                if (!polymeshResponse.ok) {
                    throw new Error('Failed to create PolyMesh');
                }

                result = await polymeshResponse.json();
                result.run_id = tempRunId;

                this.addLog('[RM-DEBUG] PolyMesh created, saving to library...');

                // Step 3: Save to library with RunName_Mesh format
                const meshNameToSave = runName ? `${runName}_Mesh` : `Mesh_${tempRunId}`;
                const libraryFormData = new FormData();
                libraryFormData.append('name', meshNameToSave);
                libraryFormData.append('project', 'default');
                libraryFormData.append('rotor_file', rotorFile);
                libraryFormData.append('stator_file', statorFile);
                libraryFormData.append('run_id', tempRunId);

                await fetch(BASE_URL + '/api/mesh/library', {
                    method: 'POST',
                    body: libraryFormData
                });

                this.addLog(`[RM-DEBUG] Mesh "${meshNameToSave}" saved to library`);

                // Clear file inputs and status
                document.getElementById('rm-rotor-file').value = '';
                document.getElementById('rm-stator-file').value = '';
                document.getElementById('rm-rotor-status').textContent = '';
                document.getElementById('rm-stator-status').textContent = '';
                document.getElementById('rm-rotor-upload').classList.remove('has-file');
                document.getElementById('rm-stator-upload').classList.remove('has-file');
                this.rmRotorFile = null;
                this.rmStatorFile = null;

            } else {
                // EXISTING MESH FLOW: Use mesh from library
                const url = BASE_URL + `/api/mesh/library/${meshId}/use`;
                console.log('[RM-DEBUG] POST', url);
                this.addLog(`[RM-DEBUG] POST ${url}`);

                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ run_name: runName })
                });

                console.log('[RM-DEBUG] Response status:', response.status);
                this.addLog(`[RM-DEBUG] Response: ${response.status}`);

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.detail || `HTTP ${response.status}`);
                }

                result = await response.json();
            }

            console.log('[RM-DEBUG] Create result:', result);
            this.addLog(`[RM-DEBUG] Run created: ${result.run_id}`);

            // Update state
            this.currentRunId = result.run_id;

            // Clear inputs
            if (runNameInput) runNameInput.value = '';
            if (meshSelector) meshSelector.value = '';

            // Hide upload section
            const uploadSection = document.getElementById('new-mesh-upload-section');
            if (uploadSection) uploadSection.style.display = 'none';

            // Reload mesh library (in case new mesh was saved)
            await this.loadMeshLibrary();

            // Reload and view
            await this.rmLoadRuns();
            await this.rmViewRun(result.run_id);

            // Switch to solver tab
            console.log('[RM-DEBUG] Switching to solver tab');
            document.querySelector('[data-tab="solver"]')?.click();

        } catch (error) {
            console.error('[RM-DEBUG] rmCreateRun error:', error);
            this.addLog(`[RM-DEBUG] ERROR: ${error.message}`, 'error');
            alert(`Failed to create run: ${error.message}`);
        } finally {
            if (createBtn) {
                createBtn.disabled = true; // No mesh selected after clear
                createBtn.textContent = 'Create Run';
            }
        }
    }

    async rmViewRun(runId) {
        console.log('[RM-DEBUG] rmViewRun() called with:', runId);
        this.addLog(`[RM-DEBUG] Viewing run: ${runId}`);

        this.currentRunId = runId;

        try {
            const url = BASE_URL + `/api/run/${runId}/details`;
            console.log('[RM-DEBUG] GET', url);

            const response = await fetch(url);
            console.log('[RM-DEBUG] Response status:', response.status);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const details = await response.json();
            console.log('[RM-DEBUG] Run details:', details);
            this.addLog(`[RM-DEBUG] Loaded details for: ${details.name || runId}`);

            this.rmShowRunDetails(details);

            // Store paraview path for use in Performance tab
            this.currentParaviewPath = details.paraview_outputs?.[0] ||
                (details.path ? `${details.path}/propCase/stator/case.foam` : null);

            // Load performance data if complete
            if (details.status === 'completed' || details.status === 'success') {
                document.getElementById('performance-tab-btn').style.display = 'flex';
                this.loadPerformanceData();
                // Update ParaView section in Performance tab
                this.updatePerformanceParaview();
            } else {
                document.getElementById('performance-tab-btn').style.display = 'none';
            }

            // Get button references
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
            this.iterationCount = 0;
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
            if (typeof this.updateLogDisplay === 'function') this.updateLogDisplay();

            // Check if simulation is running and update UI accordingly
            if (details.status === 'running') {
                // Simulation is running - show stop button and progress
                if (runBtn) runBtn.disabled = true;
                if (stopBtn) stopBtn.disabled = false;
                if (progressContainer) progressContainer.style.display = 'block';
                this.addLog('[STATUS] Reconnected to running simulation');

                // Restore ETA state from metadata
                if (details.started_at) {
                    this.startedAt = new Date(details.started_at);
                    this.simStartTime = this.startedAt.getTime();
                }
                if (details.end_time) {
                    this.simEndTime = details.end_time;  // Must be simEndTime for updateProgressTimer
                }

                // Start progress timer if we have the info
                if (this.simStartTime && this.simEndTime) {
                    if (this.progressTimer) clearInterval(this.progressTimer);
                    this.progressTimer = setInterval(() => this.updateProgressTimer(), 1000);
                }

                // Reconnect WebSocket for live updates
                this.ws.connect(runId);
            } else {
                // Not running - normal state
                if (runBtn) {
                    runBtn.disabled = false;
                    console.log('[RM-DEBUG] Enabled run-simulation-btn');
                }
                if (stopBtn) stopBtn.disabled = true;
            }

            // Re-render to highlight selected
            await this.rmLoadRuns();

            // Navigate to appropriate tab based on run status
            console.log('[RM-DEBUG] Checking status for tab navigation:', details.status);
            if (details.status === 'running') {
                // Running simulation - go to Solver tab for live output
                console.log('[RM-DEBUG] Navigating to Solver tab (running)');
                document.querySelector('[data-tab="solver"]')?.click();
            } else if (details.status === 'completed' || details.status === 'success') {
                // Completed run - go to Performance/Results tab
                console.log('[RM-DEBUG] Navigating to Performance tab (completed)');
                document.querySelector('[data-tab="performance"]')?.click();
            } else {
                console.log('[RM-DEBUG] Status not running/completed, staying on current tab. Status:', details.status);
            }

        } catch (error) {
            console.error('[RM-DEBUG] rmViewRun error:', error);
            this.addLog(`[RM-DEBUG] ERROR: ${error.message}`, 'error');
        }
    }

    rmShowRunDetails(details) {
        console.log('[RM-DEBUG] rmShowRunDetails() called');

        const panel = document.getElementById('run-details-panel');
        if (!panel) {
            console.error('[RM-DEBUG] run-details-panel not found!');
            return;
        }

        panel.style.display = 'block';

        // Helper to set element text safely
        const setText = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        setText('run-detail-name', details.name || details.run_id);
        setText('run-detail-status', details.status || 'created');
        setText('run-detail-mesh', details.mesh_name || 'N/A');
        setText('run-detail-created', details.created_at ? new Date(details.created_at).toLocaleString() : 'N/A');

        // ParaView path
        const pvPath = details.paraview_outputs?.[0] ||
            (details.path ? `${details.path}/propCase/stator/case.foam` : 'Not available');
        setText('run-detail-pv-path', pvPath);

        console.log('[RM-DEBUG] Run details panel updated');
        this.addLog('[RM-DEBUG] Details panel shown');
    }

    async rmDeleteRun(runId) {
        console.log('[RM-DEBUG] rmDeleteRun() called with:', runId);
        this.addLog(`[RM-DEBUG] Delete requested for: ${runId}`);

        if (!confirm(`Delete run "${runId}"? This cannot be undone.`)) {
            console.log('[RM-DEBUG] Delete cancelled by user');
            this.addLog('[RM-DEBUG] Delete cancelled');
            return;
        }

        console.log('[RM-DEBUG] Delete confirmed');
        this.addLog('[RM-DEBUG] Delete confirmed, proceeding...');

        try {
            const url = BASE_URL + `/api/run/${runId}`;
            console.log('[RM-DEBUG] DELETE', url);
            this.addLog(`[RM-DEBUG] DELETE ${url}`);

            const response = await fetch(url, { method: 'DELETE' });
            console.log('[RM-DEBUG] Response status:', response.status);
            this.addLog(`[RM-DEBUG] Response: ${response.status}`);

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.detail || `HTTP ${response.status}`);
            }

            const result = await response.json();
            console.log('[RM-DEBUG] Delete result:', result);
            this.addLog(`[RM-DEBUG] Deleted: ${result.message || 'Success'}`);

            // Clear current if deleted
            if (this.currentRunId === runId) {
                this.currentRunId = null;
                const panel = document.getElementById('run-details-panel');
                if (panel) panel.style.display = 'none';
            }

            // Reload runs
            await this.rmLoadRuns();

        } catch (error) {
            console.error('[RM-DEBUG] rmDeleteRun error:', error);
            this.addLog(`[RM-DEBUG] ERROR: ${error.message}`, 'error');
            alert(`Failed to delete: ${error.message}`);
        }
    }

    // ==================== Tab Navigation ====================

    setupTabs() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabPanels = document.querySelectorAll('.tab-panel');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.getAttribute('data-tab');

                // Update buttons
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Update panels
                tabPanels.forEach(p => p.classList.remove('active'));
                document.getElementById(tabId).classList.add('active');
            });
        });
    }

    // ==================== File Upload ====================

    setupFileUpload() {
        const rotorUpload = document.getElementById('rotor-upload');
        const statorUpload = document.getElementById('stator-upload');
        const rotorInput = document.getElementById('rotor-file');
        const statorInput = document.getElementById('stator-file');

        // Skip if mesh manager upload elements don't exist (they were removed)
        if (!rotorUpload || !statorUpload || !rotorInput || !statorInput) {
            return;
        }

        // Click to select
        rotorUpload.addEventListener('click', () => rotorInput.click());
        statorUpload.addEventListener('click', () => statorInput.click());

        // File selection
        rotorInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.rotorFile = e.target.files[0];
                this.updateUploadStatus('rotor', this.rotorFile.name);
            }
        });

        statorInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.statorFile = e.target.files[0];
                this.updateUploadStatus('stator', this.statorFile.name);
            }
        });

        // Drag and drop
        [rotorUpload, statorUpload].forEach((box, index) => {
            box.addEventListener('dragover', (e) => {
                e.preventDefault();
                box.style.borderColor = 'var(--accent-primary)';
            });

            box.addEventListener('dragleave', () => {
                box.style.borderColor = '';
            });

            box.addEventListener('drop', (e) => {
                e.preventDefault();
                box.style.borderColor = '';

                if (e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    if (index === 0) {
                        this.rotorFile = file;
                        this.updateUploadStatus('rotor', file.name);
                    } else {
                        this.statorFile = file;
                        this.updateUploadStatus('stator', file.name);
                    }
                }
            });
        });
    }

    updateUploadStatus(type, filename) {
        const statusEl = document.getElementById(`${type}-status`);
        const uploadBox = document.getElementById(`${type}-upload`);

        statusEl.textContent = filename;
        uploadBox.classList.add('has-file');

        this.checkUploadReady();
    }

    checkUploadReady() {
        const uploadBtn = document.getElementById('upload-btn');
        const saveLibraryBtn = document.getElementById('save-to-library-btn');
        const ready = !!(this.rotorFile && this.statorFile);
        uploadBtn.disabled = !ready;
        if (saveLibraryBtn) saveLibraryBtn.disabled = !ready;
    }

    // ==================== Material Presets ====================

    setupMaterialPresets() {
        const presetSelect = document.getElementById('fluid-preset');
        const densityInput = document.getElementById('density');
        const kinViscInput = document.getElementById('kinematic-viscosity');
        const dynViscInput = document.getElementById('dynamic-viscosity');
        const tempInput = document.getElementById('temperature');

        const presets = {
            air: { density: 1.225, kinVisc: 1.5e-5, dynVisc: 1.825e-5, temp: 293.15 },
            water: { density: 998.2, kinVisc: 1.0e-6, dynVisc: 1.002e-3, temp: 293.15 },
            custom: null
        };

        presetSelect.addEventListener('change', () => {
            const preset = presets[presetSelect.value];
            if (preset) {
                densityInput.value = preset.density;
                kinViscInput.value = preset.kinVisc;
                dynViscInput.value = preset.dynVisc;
                tempInput.value = preset.temp;
            }
        });
    }

    // ==================== Toggles ====================

    setupParallelToggle() {
        const checkbox = document.getElementById('enable-parallel');
        const inputs = document.getElementById('parallel-inputs');

        checkbox.addEventListener('change', () => {
            inputs.style.display = checkbox.checked ? 'block' : 'none';
        });
    }

    setupWindToggle() {
        const checkbox = document.getElementById('enable-wind');
        const inputs = document.getElementById('wind-inputs');

        checkbox.addEventListener('change', () => {
            inputs.style.display = checkbox.checked ? 'block' : 'none';
        });
    }

    // ==================== Buttons ====================

    setupButtons() {
        // Upload Meshes
        document.getElementById('upload-btn')?.addEventListener('click', () => this.uploadMeshes());

        // Create PolyMesh
        document.getElementById('create-polymesh-btn')?.addEventListener('click', () => this.createPolymesh());

        // Run Simulation
        document.getElementById('run-simulation-btn')?.addEventListener('click', () => this.startSimulation());

        // Stop Simulation
        document.getElementById('stop-simulation-btn')?.addEventListener('click', () => this.stopSimulation());

        // Smoke Test (may not exist after UI refactor)
        document.getElementById('smoke-test-btn')?.addEventListener('click', () => this.runSmokeTest());



        // Save Mesh (old button, may not exist)
        document.getElementById('save-mesh-btn')?.addEventListener('click', () => this.saveMesh());
    }

    // ==================== API Actions ====================

    async uploadMeshes() {
        const uploadBtn = document.getElementById('upload-btn');
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Uploading...';

        try {
            // Upload files
            const uploadResult = await API.uploadMeshFiles(this.rotorFile, this.statorFile);

            if (!uploadResult.success) {
                throw new Error(uploadResult.detail || 'Upload failed');
            }

            this.addLog(`Files uploaded: ${this.rotorFile.name}, ${this.statorFile.name}`);

            // Get run name from input
            const runName = document.getElementById('run-name')?.value.trim() || null;

            // Create run
            const createResult = await API.createRun(
                uploadResult.rotor_file,
                uploadResult.stator_file,
                runName
            );

            if (!createResult.success) {
                throw new Error(createResult.detail || 'Failed to create run');
            }

            this.currentRunId = createResult.run_id;
            this.addLog(`Run created: ${this.currentRunId}`);

            // Enable Create PolyMesh button
            document.getElementById('create-polymesh-btn').disabled = false;

            // Refresh runs list
            await this.rmLoadRuns();

            uploadBtn.textContent = 'Upload Meshes';

        } catch (error) {
            this.addLog(`Error: ${error.message}`, 'error');
            uploadBtn.textContent = 'Upload Meshes';
            uploadBtn.disabled = false;
        }
    }

    async createPolymesh() {
        if (!this.currentRunId) {
            this.addLog('No run created. Upload meshes first.', 'error');
            return;
        }

        const btn = document.getElementById('create-polymesh-btn');
        btn.disabled = true;
        btn.textContent = 'Creating PolyMesh...';

        // Show mesh progress
        const progressContainer = document.getElementById('mesh-progress-container');
        if (progressContainer) progressContainer.style.display = 'block';

        // Connect WebSocket to receive logs
        this.ws.connect(this.currentRunId);

        try {
            const result = await API.createPolymesh(this.currentRunId);

            if (!result.success) {
                throw new Error(result.message || 'Failed to create polymesh');
            }

            this.addLog(`PolyMesh created! Found ${result.patches?.length || 0} patches.`);

            // Update patches in Boundary Mapper
            this.renderPatches(result.patches || []);

            // Enable Run Simulation button (with null checks)
            const runSimBtn = document.getElementById('run-simulation-btn');
            if (runSimBtn) runSimBtn.disabled = false;

            // Show save to library prompt - make it very visible
            const saveForm = document.getElementById('save-library-form');
            if (saveForm) {
                saveForm.style.display = 'block';
                // Scroll to the form
                saveForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            // Don't auto-switch tabs - let user save to library first
            // Alert user to save
            alert('PolyMesh created successfully! Please save it to your library by entering a name below.');

            btn.textContent = 'Create PolyMesh';

        } catch (error) {
            this.addLog(`Error creating PolyMesh: ${error.message}`, 'error');
            btn.textContent = 'Create PolyMesh';
            btn.disabled = false;
        } finally {
            if (progressContainer) progressContainer.style.display = 'none';
        }
    }

    renderPatches(patches) {
        const container = document.getElementById('patches-container');
        if (!patches || patches.length === 0) {
            container.innerHTML = '<p class="empty-state">No patches detected. Import meshes first.</p>';
            return;
        }

        container.innerHTML = `
            <h4>Detected Patches (${patches.length})</h4>
            <table style="width:100%; border-collapse: collapse;">
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <th style="padding: 8px; text-align: left;">Name</th>
                    <th style="padding: 8px; text-align: left;">Type</th>
                    <th style="padding: 8px; text-align: right;">Faces</th>
                    <th style="padding: 8px; text-align: center;">Status</th>
                </tr>
                ${patches.map(p => `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding: 8px; font-family: monospace;">${p.name}</td>
                        <td style="padding: 8px;">${p.type}</td>
                        <td style="padding: 8px; text-align: right;">${p.nFaces}</td>
                        <td style="padding: 8px; text-align: center;">
                            ${p.locked ? '<span style="color: var(--accent-warning);">Locked (AMI)</span>' :
                (p.expected ? '<span style="color: var(--accent-success);">OK</span>' :
                    '<span style="color: var(--text-muted);">Custom</span>')}
                        </td>
                    </tr>
                `).join('')}
            </table>
        `;
    }

    async startSimulation() {
        console.log('[SIM-DEBUG] startSimulation called, currentRunId:', this.currentRunId);

        if (!this.currentRunId) {
            this.addLog('No run selected', 'error');
            return;
        }

        const runBtn = document.getElementById('run-simulation-btn');
        const stopBtn = document.getElementById('stop-simulation-btn');

        console.log('[SIM-DEBUG] Button elements found:', { runBtn: !!runBtn, stopBtn: !!stopBtn });

        if (runBtn) {
            runBtn.disabled = true;
            console.log('[SIM-DEBUG] Set runBtn.disabled = true');
        }
        if (stopBtn) {
            stopBtn.disabled = false;
            console.log('[SIM-DEBUG] Set stopBtn.disabled = false');
        }

        // Reset timing
        this.simStartTime = Date.now();
        this.iterationCount = 0;
        this.currentSimTime = 0;
        this.simEndTime = parseFloat(document.getElementById('end-time').value);

        // Hide error, show progress
        document.getElementById('solver-error-alert').style.display = 'none';
        document.getElementById('progress-container').style.display = 'block';
        document.getElementById('progress-step').textContent = 'Initializing...';
        document.getElementById('progress-fill').style.width = '0%';

        // Show Paraview info
        const paraviewPath = `/home/reen/openfoam/Tutorials/Rotating_Setup_Case/OpenFOAM_WebPropellerGUI/runs/${this.currentRunId}/propCase/stator/${this.currentRunId}.foam`;
        document.getElementById('paraview-path').textContent = paraviewPath;
        document.getElementById('paraview-info').style.display = 'block';

        // Start progress update timer
        this.progressTimer = setInterval(() => this.updateProgressTimer(), 1000);

        // Connect WebSocket
        this.ws.connect(this.currentRunId);

        try {
            // Gather settings
            const solverSettings = this.getSolverSettings();
            const materialSettings = this.getMaterialSettings();
            const inletVelocity = this.getInletVelocity();

            // Debug: Log what's being sent
            console.log('Solver settings being sent:', solverSettings);
            console.log('fixed_timestep =', solverSettings.fixed_timestep, 'delta_t =', solverSettings.delta_t);
            this.addLog(`Settings: fixed_timestep=${solverSettings.fixed_timestep}, delta_t=${solverSettings.delta_t}`);

            await API.startRun(this.currentRunId, solverSettings, materialSettings, inletVelocity);

            this.addLog('Simulation started');

        } catch (error) {
            this.addLog(`Error starting simulation: ${error.message}`, 'error');
            runBtn.disabled = false;
            stopBtn.disabled = true;
            clearInterval(this.progressTimer);
        }
    }

    updateProgressTimer() {
        if (!this.simStartTime) return;

        const elapsed = Math.floor((Date.now() - this.simStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        document.getElementById('progress-time').textContent = `Time: ${mins}m ${secs}s`;

        // Update simulation time display (matches Wind Tunnel format)
        document.getElementById('progress-iter').textContent = `SimTime: ${this.currentSimTime.toFixed(4)}`;

        // Calculate ETA based on simulation time progress
        if (this.currentSimTime > 0 && this.simEndTime > 0) {
            const progress = this.currentSimTime / this.simEndTime;
            const totalEstimated = elapsed / progress;
            const remaining = Math.max(0, totalEstimated - elapsed);
            const etaMins = Math.floor(remaining / 60);
            const etaSecs = Math.floor(remaining % 60);
            document.getElementById('progress-eta').textContent = `ETA: ${etaMins}m ${etaSecs}s`;

            // Update progress bar
            const percent = Math.min(100, Math.round(progress * 100));
            document.getElementById('progress-fill').style.width = `${percent}%`;
        }

        // Fetch storage size every 5 seconds to avoid too many requests
        if (!this.lastStorageUpdate || (Date.now() - this.lastStorageUpdate > 2500)) {
            this.lastStorageUpdate = Date.now();
            this.updateStorageDisplay();
        }
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

                // Update storage display
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
            // Silently fail - storage display is non-critical
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
                    estimatedTotalMB = totalSteps * 50;  // ~50MB per step default
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

            clearInterval(this.progressTimer);
            this.simStartTime = null;

            document.getElementById('run-simulation-btn').disabled = false;
            document.getElementById('stop-simulation-btn').disabled = true;
            document.getElementById('progress-container').style.display = 'none';

        } catch (error) {
            this.addLog(`Error stopping simulation: ${error.message}`, 'error');
        }
    }

    async runSmokeTest() {
        const btn = document.getElementById('smoke-test-btn');
        btn.disabled = true;
        btn.textContent = 'Running...';

        try {
            const result = await API.runSmokeTest();
            this.ws.connect(result.test_id);
            this.addLog('Smoke test started');

        } catch (error) {
            this.addLog(`Smoke test error: ${error.message}`, 'error');
        }

        btn.disabled = false;
        btn.textContent = '🔧 Smoke Test';
    }

    async loadRuns() {
        try {
            const result = await API.listRuns();
            this.renderRuns(result.runs || []);
        } catch (error) {
            console.error('Failed to load runs:', error);
        }
    }

    async loadMeshes() {
        try {
            const result = await API.listMeshes();
            this.renderMeshes(result.meshes || []);
        } catch (error) {
            console.error('Failed to load meshes:', error);
        }
    }

    async saveMesh() {
        const nameInput = document.getElementById('save-mesh-name');
        const meshName = nameInput.value.trim();

        if (!meshName) {
            this.addLog('Please enter a mesh name', 'error');
            return;
        }

        if (!this.currentRunId) {
            this.addLog('No run selected', 'error');
            return;
        }

        try {
            const result = await API.saveMesh(this.currentRunId, meshName);
            this.addLog(result.message);
            nameInput.value = '';
            await this.loadMeshes();
        } catch (error) {
            this.addLog(`Error saving mesh: ${error.message}`, 'error');
        }
    }



    // ==================== Settings Getters ====================

    getSolverSettings() {
        const axisStr = document.getElementById('rotation-axis').value;
        const axis = axisStr.split(',').map(Number);

        // Determine timestep mode - DEBUG THIS
        const timestepModeEl = document.getElementById('timestep-mode');
        console.log('[DEBUG] timestep-mode element:', timestepModeEl);
        console.log('[DEBUG] timestep-mode value:', timestepModeEl?.value);

        const timestepMode = timestepModeEl?.value || 'adaptive';
        const isFixedTimestep = timestepMode === 'fixed';

        console.log('[DEBUG] timestepMode =', timestepMode, ', isFixedTimestep =', isFixedTimestep);

        // Get appropriate delta_t based on mode
        let deltaT;
        if (isFixedTimestep) {
            deltaT = parseFloat(document.getElementById('fixed-delta-t')?.value || 1e-3);
            console.log('[DEBUG] Using fixed-delta-t:', deltaT);
        } else {
            deltaT = parseFloat(document.getElementById('delta-t')?.value || 1e-5);
            console.log('[DEBUG] Using adaptive delta-t:', deltaT);
        }

        // Also log what will be sent
        console.log('[DEBUG] SENDING fixed_timestep:', isFixedTimestep);

        return {
            solver: document.getElementById('solver-select').value,
            turbulence_model: document.getElementById('turbulence-model')?.value || 'kOmegaSST',
            end_time: parseFloat(document.getElementById('end-time').value),
            delta_t: deltaT,
            write_interval: parseFloat(document.getElementById('write-interval').value),
            purge_write: parseInt(document.getElementById('purge-write')?.value || 0),
            rotation_rpm: parseFloat(document.getElementById('rotation-rpm').value),
            rotation_axis: axis,
            rotation_origin: [
                parseFloat(document.getElementById('origin-x').value),
                parseFloat(document.getElementById('origin-y').value),
                parseFloat(document.getElementById('origin-z').value)
            ],
            parallel: document.getElementById('enable-parallel').checked,
            num_cores: parseInt(document.getElementById('num-cores').value),
            // Timestep settings
            max_co: parseFloat(document.getElementById('max-co')?.value || 0.5),
            max_delta_t: parseFloat(document.getElementById('max-delta-t')?.value || 1e-4),
            fixed_timestep: isFixedTimestep,
            // Solver stability
            n_outer_correctors: parseInt(document.getElementById('n-outer-correctors')?.value || 4),
            relax_p: parseFloat(document.getElementById('relax-p')?.value || 0.2),
            relax_u: parseFloat(document.getElementById('relax-u')?.value || 0.5),
            // RPM ramp-up
            enable_rampup: document.getElementById('enable-rampup')?.checked || false,
            ramp_duration: parseFloat(document.getElementById('ramp-duration')?.value || 0.02),
            reverse_direction: document.getElementById('reverse-direction')?.checked || false
        };
    }

    updateTimestepMode() {
        const mode = document.getElementById('timestep-mode')?.value || 'adaptive';
        const adaptiveOptions = document.getElementById('adaptive-options');
        const fixedOptions = document.getElementById('fixed-options');

        if (mode === 'adaptive') {
            adaptiveOptions.style.display = 'block';
            fixedOptions.style.display = 'none';
        } else {
            adaptiveOptions.style.display = 'none';
            fixedOptions.style.display = 'block';
        }
    }

    updateMiniLog(line) {
        const miniLog = document.getElementById('mini-log');
        if (!miniLog) return;

        // Keep only last 5 lines
        const lines = miniLog.querySelectorAll('div');
        if (lines.length >= 5) {
            lines[0].remove();
        }

        const lineEl = document.createElement('div');
        lineEl.textContent = line;
        miniLog.appendChild(lineEl);

        // Auto-scroll to bottom
        miniLog.scrollTop = miniLog.scrollHeight;
    }

    getMaterialSettings() {
        return {
            preset: document.getElementById('fluid-preset').value,
            temperature: parseFloat(document.getElementById('temperature').value),
            density: parseFloat(document.getElementById('density').value),
            kinematic_viscosity: parseFloat(document.getElementById('kinematic-viscosity').value),
            dynamic_viscosity: parseFloat(document.getElementById('dynamic-viscosity').value)
        };
    }

    getInletVelocity() {
        if (!document.getElementById('enable-wind').checked) {
            return null;
        }

        return [
            parseFloat(document.getElementById('wind-ux').value),
            parseFloat(document.getElementById('wind-uy').value),
            parseFloat(document.getElementById('wind-uz').value)
        ];
    }

    // ==================== WebSocket ====================

    setupWebSocket() {
        this.ws.onLog((data) => {
            this.addLog(`[${data.step}] ${data.line}`);

            // Update mini log (last 5 lines)
            this.updateMiniLog(data.line);

            // Parse simulation time from solver output (e.g., "Time = 0.00123")
            const timeMatch = data.line.match(/^Time\s*=\s*([\d.e+-]+)/);
            if (timeMatch) {
                this.currentSimTime = parseFloat(timeMatch[1]);
                this.iterationCount++;
            }
        });

        this.ws.onProgress((data) => {
            this.updateProgress(data.progress, data.step, data.step_num, data.total_steps);
        });

        this.ws.onComplete((data) => {
            this.addLog(data.message);
            clearInterval(this.progressTimer);
            this.simStartTime = null;
            document.getElementById('run-simulation-btn').disabled = false;
            document.getElementById('stop-simulation-btn').disabled = true;
            document.getElementById('progress-step').textContent = 'Complete!';
            document.getElementById('progress-fill').style.width = '100%';
            document.getElementById('progress-eta').textContent = 'Done';
            this.rmLoadRuns();
        });

        this.ws.onError((data) => {
            this.addLog(`Error: ${data.message}`, 'error');
            clearInterval(this.progressTimer);
            this.simStartTime = null;
            this.showSolverError(data.message);
            document.getElementById('run-simulation-btn').disabled = false;
            document.getElementById('stop-simulation-btn').disabled = true;
            document.getElementById('progress-container').style.display = 'none';
        });

        this.ws.onConnection((status) => {
            this.updateConnectionStatus(status);
        });
    }

    updateConnectionStatus(status) {
        const dot = document.querySelector('.status-dot');
        const text = document.querySelector('.status-text');
        if (!dot || !text) return;

        dot.className = 'status-dot';

        switch (status) {
            case 'connected':
                dot.classList.add('connected');
                text.textContent = 'Live';
                break;
            case 'ready':
                dot.classList.add('connected');
                text.textContent = 'Ready';
                break;
            case 'disconnected':
                text.textContent = 'Idle';
                break;
            case 'error':
                dot.classList.add('error');
                text.textContent = 'Error';
                break;
            default:
                dot.classList.add('connected');
                text.textContent = 'Ready';
        }
    }

    // ==================== Progress ====================

    updateProgress(percent, step, stepNum, totalSteps) {
        const fillEl = document.getElementById('progress-fill');
        const percentEl = document.getElementById('progress-percent');
        const stepEl = document.getElementById('progress-step');

        if (fillEl) fillEl.style.width = `${percent}%`;
        if (percentEl) percentEl.textContent = `${percent}%`;
        if (stepEl) stepEl.textContent = `Step ${stepNum}/${totalSteps}: ${step}`;

        // Calculate ETA based on elapsed time and progress
        if (percent > 0 && percent < 100 && this.simStartTime) {
            const elapsed = (Date.now() - this.simStartTime) / 1000; // seconds
            const progress = percent / 100;
            const totalEstimated = elapsed / progress;
            const remaining = Math.max(0, totalEstimated - elapsed);
            const etaMins = Math.floor(remaining / 60);
            const etaSecs = Math.floor(remaining % 60);
            document.getElementById('progress-eta').textContent = `ETA: ${etaMins}m ${etaSecs}s`;
        } else if (percent >= 100) {
            document.getElementById('progress-eta').textContent = 'Done';
        } else {
            document.getElementById('progress-eta').textContent = '';
        }
    }

    showSolverError(message) {
        const alertDiv = document.getElementById('solver-error-alert');
        const messageDiv = document.getElementById('solver-error-message');
        if (alertDiv && messageDiv) {
            messageDiv.textContent = message;
            alertDiv.style.display = 'block';
        }
    }

    // ==================== Rendering ====================

    renderRuns(runs) {
        const container = document.getElementById('runs-list');
        if (!container) return;

        if (runs.length === 0) {
            container.innerHTML = '<p class="empty-state">No runs yet. Select a mesh and create a run.</p>';
            return;
        }

        container.innerHTML = runs.map(run => {
            const isSelected = this.currentRunId === run.run_id;
            const statusClass = run.status || 'created';
            const statusText = run.status || 'Ready';

            return `
            <div class="run-item ${isSelected ? 'selected' : ''}" data-run-id="${run.run_id}">
                <div class="run-info" onclick="app.rmViewRun('${run.run_id}')" style="cursor: pointer;">
                    <h5>${run.name || run.run_id}</h5>
                    <p>${run.mesh_name || 'Unknown mesh'} | ${new Date(run.created_at).toLocaleDateString()}</p>
                </div>
                <span class="run-status ${statusClass}">${statusText}</span>
                <div class="run-actions">
                    <button class="btn btn-primary btn-sm" onclick="app.rmViewRun('${run.run_id}')">View</button>
                    <button class="btn btn-danger btn-sm" onclick="app.rmDeleteRun('${run.run_id}')">Delete</button>
                </div>
            </div>`;
        }).join('');
    }

    renderMeshes(meshes) {
        const container = document.getElementById('meshes-list');

        if (meshes.length === 0) {
            container.innerHTML = '<p class="empty-state">No saved meshes.</p>';
            return;
        }

        container.innerHTML = meshes.map(mesh => `
            <div class="mesh-item">
                <div class="mesh-info">
                    <h5>${mesh.display_name || mesh.name}</h5>
                    <p>Created: ${new Date(mesh.created_at).toLocaleString()}</p>
                    <p>Size: ${(mesh.size_bytes / 1024 / 1024).toFixed(1)} MB | Patches: ${mesh.patches?.length || 0}</p>
                </div>
                <div class="run-actions">
                    <button class="btn btn-secondary" onclick="app.loadMeshToRun('${mesh.name}')">Load</button>
                    <button class="btn btn-danger" onclick="app.deleteMesh('${mesh.name}')">Delete</button>
                </div>
            </div>
        `).join('');
    }

    // selectRun is defined in Run Manager section above

    async loadMeshToRun(meshName) {
        if (!this.currentRunId) {
            this.addLog('Select a run first', 'error');
            return;
        }

        try {
            const result = await API.loadMesh(this.currentRunId, meshName);
            this.addLog(result.message);
        } catch (error) {
            this.addLog(`Error loading mesh: ${error.message}`, 'error');
        }
    }


    // ==================== Run Filters ====================

    setupRunFilters() {
        const filterBtns = document.querySelectorAll('.filter-btn');

        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const filter = btn.dataset.filter;
                const items = document.querySelectorAll('.run-item');

                items.forEach(item => {
                    const isArchived = item.dataset.archived === 'true';

                    if (filter === 'all') {
                        item.style.display = '';
                    } else if (filter === 'active') {
                        item.style.display = isArchived ? 'none' : '';
                    } else if (filter === 'archived') {
                        item.style.display = isArchived ? '' : 'none';
                    }
                });
            });
        });
    }

    // ==================== Paraview Calculator ====================

    setupParaviewCalculator() {
        document.getElementById('calculate-pv-btn').addEventListener('click', async () => {
            const targetFps = parseFloat(document.getElementById('target-fps').value);
            const playbackSpeed = parseFloat(document.getElementById('playback-speed').value);
            const endTime = parseFloat(document.getElementById('pv-end-time').value);
            const writeInterval = parseFloat(document.getElementById('pv-write-interval').value);

            try {
                const result = await API.calculateParaviewSettings(targetFps, playbackSpeed, endTime, writeInterval);

                const calc = result.calculation;
                document.getElementById('result-timesteps').textContent = calc.num_timesteps;
                document.getElementById('result-duration').textContent = `${calc.video_duration_sec} s`;
                document.getElementById('result-frames').textContent = calc.total_frames;
                document.getElementById('result-resample').textContent = calc.resample_factor;
                document.getElementById('result-recommendation').textContent = calc.recommendation;

                document.getElementById('pv-results').style.display = 'block';

            } catch (error) {
                this.addLog(`Calculation error: ${error.message}`, 'error');
            }
        });
    }

    // ==================== Logs ====================

    setupLogControls() {
        const linesSelect = document.getElementById('log-lines');
        linesSelect.addEventListener('change', () => {
            this.maxLogLines = parseInt(linesSelect.value);
            this.trimLogs();
        });

        document.getElementById('copy-logs-btn')?.addEventListener('click', () => {
            const logText = this.logLines.join('\n');
            this.copyToClipboard(logText);
            this.addLog('Logs copied to clipboard');
        });

        document.getElementById('copy-logs-settings-btn')?.addEventListener('click', () => {
            const settings = {
                solver: this.getSolverSettings(),
                material: this.getMaterialSettings(),
                inlet_velocity: this.getInletVelocity()
            };
            const logText = this.logLines.join('\n') + '\n\n--- SETTINGS ---\n' + JSON.stringify(settings, null, 2);
            this.copyToClipboard(logText);
            this.addLog('Logs + settings copied to clipboard');
        });

        document.getElementById('clear-logs-btn')?.addEventListener('click', () => {
            this.logLines = [];
            const logOutput = document.getElementById('log-output');
            if (logOutput) logOutput.textContent = '';
        });
    }

    copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).catch(err => {
                console.error('Clipboard write failed:', err);
                this.fallbackCopyToClipboard(text);
            });
        } else {
            this.fallbackCopyToClipboard(text);
        }
    }

    fallbackCopyToClipboard(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
        } catch (err) {
            console.error('Fallback copy failed:', err);
            alert('Failed to copy to clipboard');
        }
        document.body.removeChild(textArea);
    }

    addLog(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const line = `[${timestamp}] ${message}`;

        this.logLines.push(line);
        this.trimLogs();

        const logOutput = document.getElementById('log-output');
        logOutput.textContent = this.logLines.join('\n');
        logOutput.scrollTop = logOutput.scrollHeight;
    }

    trimLogs() {
        if (this.logLines.length > this.maxLogLines) {
            this.logLines = this.logLines.slice(-this.maxLogLines);
        }
    }
    // ==================== Performance Tab ====================

    setupPerformanceTab() {
        const refreshBtn = document.getElementById('refresh-performance-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadPerformanceData(true));
        }

        // Attach display settings listeners immediately (static HTML, always available)
        if (typeof UnitFormatter !== 'undefined') {
            console.log('[DEBUG] Attaching UnitFormatter listeners with prefix prop-');
            UnitFormatter.attachSettingsListeners('prop-', () => {
                console.log('[DEBUG] Settings changed! cachedPerformanceData:', this.cachedPerformanceData);
                // Re-render with cached data if available
                if (this.cachedPerformanceData) {
                    console.log('[DEBUG] Calling renderPerformanceData');
                    this.renderPerformanceData(this.cachedPerformanceData);
                } else {
                    console.log('[DEBUG] No cached data available');
                }
            });
        } else {
            console.warn('[WARN] UnitFormatter is not defined!');
        }
    }

    // Separate render function for re-formatting without API call
    renderPerformanceData(data) {
        const dataDiv = document.getElementById('performance-data');
        const errorDiv = document.getElementById('performance-error');
        const emptyDiv = document.getElementById('performance-empty');

        if (!data || data.status === 'no_data' || data.error) {
            if (emptyDiv) emptyDiv.style.display = 'block';
            if (dataDiv) dataDiv.style.display = 'none';
            return;
        }

        if (dataDiv) {
            dataDiv.style.display = 'block';
            if (emptyDiv) emptyDiv.style.display = 'none';

            const metrics = data.metrics || {};
            const fmt = (typeof UnitFormatter !== 'undefined') ? UnitFormatter : null;

            const setVal = (id, val, unit = '') => {
                const el = document.getElementById(id);
                if (!el) return;

                if (val === undefined || val === null || (typeof val === 'number' && isNaN(val))) {
                    el.textContent = '-';
                } else if (typeof val === 'number' && fmt) {
                    if (unit === 'N') {
                        el.textContent = fmt.formatForce(val);
                    } else if (unit === 'Nm') {
                        el.textContent = fmt.formatTorque(val);
                    } else if (unit === '%') {
                        el.textContent = fmt.formatPercent(val);
                    } else if (unit) {
                        el.textContent = fmt.format(val, unit);
                    } else {
                        el.textContent = fmt.formatCoefficient(val);
                    }
                } else if (typeof val === 'number') {
                    el.textContent = val.toFixed(4) + (unit ? ' ' + unit : '');
                } else {
                    el.textContent = val + (unit ? ' ' + unit : '');
                }
            };

            setVal('perf-thrust', metrics.thrust, 'N');
            setVal('perf-torque', metrics.torque, 'Nm');

            const efficiency = metrics.efficiency;
            if (efficiency !== undefined && !isNaN(efficiency)) {
                setVal('perf-eta', efficiency * 100, '%');
            } else {
                const etaEl = document.getElementById('perf-eta');
                if (etaEl) etaEl.textContent = '- %';
            }

            setVal('perf-j', metrics.advance_ratio);
            setVal('perf-kt', metrics.kt);
            setVal('perf-kq', metrics.kq);

            if (metrics.note && errorDiv) {
                errorDiv.textContent = `Note: ${metrics.note}`;
                errorDiv.style.display = 'block';
                errorDiv.style.color = 'var(--accent-warning, #ffaa00)';
            }

            const rawEl = document.getElementById('perf-raw');
            if (rawEl) rawEl.textContent = JSON.stringify(data, null, 2);
        }
    }

    async loadPerformanceData(forceRefresh = false) {
        if (!this.currentRunId) return;

        const loading = document.getElementById('performance-loading');
        const errorDiv = document.getElementById('performance-error');
        const emptyDiv = document.getElementById('performance-empty');
        const dataDiv = document.getElementById('performance-data');

        if (loading) loading.style.display = 'block';
        if (dataDiv) dataDiv.style.display = 'none';
        if (errorDiv) errorDiv.style.display = 'none';
        if (emptyDiv) emptyDiv.style.display = 'none';

        try {
            let data;
            if (forceRefresh) {
                data = await API.triggerAnalysis(this.currentRunId);
            } else {
                data = await API.getPerformance(this.currentRunId);
            }

            if (loading) loading.style.display = 'none';

            // Cache the data for re-rendering on settings change
            this.cachedPerformanceData = data;

            if (data.status === 'no_data' || data.error) {
                if (emptyDiv) emptyDiv.style.display = 'block';
                if (data.error && errorDiv) {
                    errorDiv.textContent = `Analysis Error: ${data.error}`;
                    errorDiv.style.display = 'block';
                }
                return;
            }

            // Use the shared render function
            this.renderPerformanceData(data);

        } catch (e) {
            if (loading) loading.style.display = 'none';
            if (errorDiv) {
                errorDiv.textContent = `Error loading data: ${e.message}`;
                errorDiv.style.display = 'block';
            }
        }
    }

    // Update ParaView section in Performance tab
    updatePerformanceParaview() {
        const pvPathEl = document.getElementById('performance-pv-path');
        if (pvPathEl) {
            pvPathEl.textContent = this.currentParaviewPath || 'No ParaView file available';
        }
    }
}

// Initialize app
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new App();
});
