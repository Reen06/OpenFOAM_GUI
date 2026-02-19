/**
 * OpenFOAM Web Propeller GUI - Main Application
 */

class App {
    constructor() {
        // State
        this.currentRunId = null;
        this.selectedMeshId = null;
        this.selectedMeshName = null;
        this.rotorFiles = [];  // Array for multi-rotor support
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
                                    ${mesh.has_default_mapping ? ' | <span class="mesh-default-badge" title="This mesh has a saved boundary mapping default">&#x1F4CB; Has saved mapping</span>' : ''}
                                </span>
                            </div>
                            <div class="library-item-actions">
                                ${mesh.has_default_mapping ? `<button class="btn btn-secondary btn-sm" onclick="app.clearMeshDefault('${mesh.id}')" title="Clear saved default mapping">Clear Default</button>` : ''}
                                <button class="btn btn-secondary btn-sm" onclick="API.downloadMesh('${mesh.id}')" title="Download UNV files (zip)">&#x1F4E5; Download</button>
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

        if (!this.rotorFiles.length || !this.statorFile) {
            alert('Please complete Step 1 first: upload rotor and stator files');
            return;
        }

        const formData = new FormData();
        formData.append('name', name);
        formData.append('project', project);
        this.rotorFiles.forEach(f => formData.append('rotor_files', f));
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

    async clearMeshDefault(meshId) {
        if (!confirm('Clear saved default mapping for this mesh?')) return;

        try {
            const response = await fetch(BASE_URL + `/api/mesh/library/${meshId}/default-mapping`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to clear default');
            this.addLog('Default mapping cleared');
            await this.loadMeshLibrary();
        } catch (e) {
            this.addLog(`Error: ${e.message}`, 'error');
            alert('Failed to clear default mapping');
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
                this.rmRotorFiles = Array.from(e.target.files);
                const names = this.rmRotorFiles.map(f => f.name);
                this.updateRmUploadStatus('rm-rotor', names.length === 1 ? names[0] : `${names.length} rotor files: ${names.join(', ')}`);
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
                        // Drag & drop: collect all dropped .unv files for rotor
                        const unvFiles = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.unv'));
                        this.rmRotorFiles = unvFiles.length ? unvFiles : [e.dataTransfer.files[0]];
                        const names = this.rmRotorFiles.map(f => f.name);
                        this.updateRmUploadStatus('rm-rotor', names.length === 1 ? names[0] : `${names.length} rotor files: ${names.join(', ')}`);
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
                const rotorFiles = this.rmRotorFiles || [];
                const statorFile = this.rmStatorFile;

                if (!rotorFiles.length || !statorFile) {
                    throw new Error('Please select rotor mesh file(s) and a stator mesh file');
                }

                console.log('[RM-DEBUG] New mesh flow - uploading files...');
                this.addLog('[RM-DEBUG] Uploading mesh files...');

                // Step 1: Upload meshes and create run with name
                const formData = new FormData();
                rotorFiles.forEach(f => formData.append('rotor_files', f));
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

                // Check for UNV unit warnings
                if (uploadResult.unit_warning) {
                    const msg = `\u26a0\ufe0f Unit Warning\n\n${uploadResult.unit_warning.message}\n\nOpenFOAM requires all mesh coordinates to be in meters (SI).\n\nDo you want to continue anyway?`;
                    if (!confirm(msg)) {
                        this.addLog('Upload cancelled due to unit mismatch.');
                        return;
                    }
                    this.addLog(`[WARN] ${uploadResult.unit_warning.message}`);
                }

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
                rotorFiles.forEach(f => libraryFormData.append('rotor_files', f));
                libraryFormData.append('stator_file', statorFile);
                libraryFormData.append('run_id', tempRunId);

                const libraryResponse = await fetch(BASE_URL + '/api/mesh/library', {
                    method: 'POST',
                    body: libraryFormData
                });

                const libraryResult = await libraryResponse.json();

                // Link the run to the real library mesh_id (fixes default-mapping 404)
                if (libraryResult.mesh_id) {
                    await fetch(BASE_URL + `/api/run/${tempRunId}/mesh-link`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mesh_id: libraryResult.mesh_id, mesh_name: meshNameToSave })
                    });
                }

                this.addLog(`[RM-DEBUG] Mesh "${meshNameToSave}" saved to library`);

                // Clear file inputs and status
                document.getElementById('rm-rotor-file').value = '';
                document.getElementById('rm-stator-file').value = '';
                document.getElementById('rm-rotor-status').textContent = '';
                document.getElementById('rm-stator-status').textContent = '';
                document.getElementById('rm-rotor-upload').classList.remove('has-file');
                document.getElementById('rm-stator-upload').classList.remove('has-file');
                this.rmRotorFiles = [];
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
            if (result.has_default_mapping) {
                this.addLog('[RM] Default boundary mapping applied from mesh library');
            }

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

            // Switch to boundary mapper tab
            console.log('[RM-DEBUG] Switching to boundary mapper tab');
            document.querySelector('[data-tab="boundary-mapper"]')?.click();

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

            // Update ParaView Helper tab with run data
            this.updateParaviewHelper(runId);

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
                // New/created run - go to Boundary Mapper tab
                console.log('[RM-DEBUG] Navigating to Boundary Mapper tab');
                document.querySelector('[data-tab="boundary-mapper"]')?.click();
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

                // Load data based on tab
                if (tabId === 'paraview') {
                    this.updateParaviewHelper(this.currentRunId);
                } else if (tabId === 'boundary-mapper' && this.currentRunId) {
                    this.initBoundaryMapper();
                }
            });
        });
    }

    // ==================== ParaView Helper ====================

    async updateParaviewHelper(runId) {
        const noRunSelected = document.getElementById('pv-no-run-selected');
        const runDetails = document.getElementById('pv-run-details');
        const timestepInfo = document.getElementById('pv-timestep-info');

        if (!runId) {
            // No run selected - show placeholder
            if (noRunSelected) noRunSelected.style.display = 'block';
            if (runDetails) runDetails.style.display = 'none';
            if (timestepInfo) timestepInfo.style.display = 'none';
            return;
        }

        try {
            // Get timestep analysis from API
            const data = await API.getTimesteps(runId);

            // Show run info
            if (noRunSelected) noRunSelected.style.display = 'none';
            if (runDetails) runDetails.style.display = 'block';

            // Set run name
            const runName = document.getElementById('pv-run-name');
            if (runName) runName.textContent = data.run_name || runId;

            // Set .foam path
            const foamPath = document.getElementById('pv-foam-path');
            if (foamPath) foamPath.textContent = data.foam_file || '(No .foam file found)';

            // Setup copy button
            const copyBtn = document.getElementById('pv-copy-path-btn');
            if (copyBtn) {
                copyBtn.onclick = () => {
                    navigator.clipboard.writeText(data.foam_file || '');
                    copyBtn.textContent = '✓ Copied!';
                    setTimeout(() => copyBtn.textContent = '📋 Copy Path', 2000);
                };
            }

            // Show timestep analysis if we have timesteps
            if (data.count > 0 && timestepInfo) {
                timestepInfo.style.display = 'block';

                document.getElementById('pv-timestep-count').textContent = data.count;
                document.getElementById('pv-time-range').textContent =
                    `${data.min_time.toFixed(4)}s -> ${data.max_time.toFixed(4)}s`;
                document.getElementById('pv-avg-interval').textContent =
                    data.avg_interval.toExponential(3) + 's';
                document.getElementById('pv-timestep-type').textContent =
                    data.is_adaptive ? 'Adaptive' : 'Fixed';

                // Auto-populate the calculator inputs
                const endTimeInput = document.getElementById('pv-end-time');
                const writeIntervalInput = document.getElementById('pv-write-interval');
                const simDurationLabel = document.getElementById('pv-sim-duration-auto');
                const timestepsLabel = document.getElementById('pv-timesteps-auto');

                if (endTimeInput) {
                    endTimeInput.value = data.max_time;
                    if (simDurationLabel) simDurationLabel.textContent = '(auto)';
                }

                if (writeIntervalInput) {
                    // Use actual timestep count for better accuracy with adaptive
                    writeIntervalInput.value = data.count;
                    if (timestepsLabel) timestepsLabel.textContent = '(auto)';
                }
            } else if (timestepInfo) {
                timestepInfo.style.display = 'none';
            }
        } catch (error) {
            console.log('Failed to load timesteps for ParaView helper:', error);
            // Still show the run but indicate no data
            if (noRunSelected) noRunSelected.style.display = 'none';
            if (runDetails) runDetails.style.display = 'block';
            if (timestepInfo) timestepInfo.style.display = 'none';

            const runName = document.getElementById('pv-run-name');
            if (runName) runName.textContent = runId;
        }
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
                this.rotorFiles = Array.from(e.target.files);
                const names = this.rotorFiles.map(f => f.name);
                this.updateUploadStatus('rotor', names.length === 1 ? names[0] : `${names.length} files`);
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
                        this.rotorFiles = [file];
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
        const ready = !!(this.rotorFiles.length && this.statorFile);
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
            const uploadResult = await API.uploadMeshFiles(this.rotorFiles, this.statorFile);

            if (!uploadResult.success) {
                throw new Error(uploadResult.detail || 'Upload failed');
            }

            const rotorNames = this.rotorFiles.map(f => f.name).join(', ');
            this.addLog(`Files uploaded: ${rotorNames}, ${this.statorFile.name}`);

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

            // Boundary mapper will pick up patches when the tab is opened
            this.addLog('Patches ready for boundary mapping.');

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

    // ==================== Boundary Mapper ====================

    async initBoundaryMapper() {
        if (!this.currentRunId) return;

        const container = document.getElementById('boundary-mapper-container');
        if (!container) return;

        // Destroy previous instance if exists
        if (this._boundaryMapper) {
            this._boundaryMapper.destroy();
            this._boundaryMapper = null;
        }

        // Get mesh_id from run details for the "Save as Mesh Default" button
        let meshId = null;
        if (this.currentRunId) {
            try {
                const resp = await fetch(BASE_URL + `/api/run/${this.currentRunId}/details`);
                if (resp.ok) {
                    const details = await resp.json();
                    meshId = details.mesh_id || null;
                }
            } catch (e) {
                console.warn('Could not fetch run details for meshId:', e);
            }
        }

        // Create new BoundaryMapper widget
        this._boundaryMapper = new BoundaryMapper(container, {
            apiBase: BASE_URL,
            runId: this.currentRunId,
            meshId: meshId,
            onMappingSaved: () => {
                document.querySelector('[data-tab="materials"]')?.click();
            }
        });
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
            const solverSettings = await this.getSolverSettings();
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

    async updateEstimatedSize(currentSizeMB) {
        const estContainer = document.getElementById('est-size-container');
        const estValEl = document.getElementById('estimated-total-size');
        if (!estContainer || !estValEl) return;

        const solverSettings = await this.getSolverSettings();
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

    async getSolverSettings() {
        // Determine timestep mode
        const timestepModeEl = document.getElementById('timestep-mode');
        const timestepMode = timestepModeEl?.value || 'adaptive';
        const isFixedTimestep = timestepMode === 'fixed';

        let deltaT;
        if (isFixedTimestep) {
            deltaT = parseFloat(document.getElementById('fixed-delta-t')?.value || 1e-3);
        } else {
            deltaT = parseFloat(document.getElementById('delta-t')?.value || 1e-5);
        }

        // Fetch rotation settings from saved mapping
        let rotationParams = {
            rpm: 300, rotationAxis: '0,0,1',
            originX: 0, originY: 0, originZ: 0,
            enableRampup: true, rampDuration: 0.02, reverseDirection: false
        };
        try {
            const resp = await fetch(BASE_URL + `/api/run/${this.currentRunId}/mapping`);
            if (resp.ok) {
                const mapping = await resp.json();
                const propInstances = mapping.instances?.propellers;
                if (propInstances && propInstances.length > 0) {
                    const p = propInstances[0].parameters || {};
                    rotationParams = { ...rotationParams, ...p };
                }
            }
        } catch (e) {
            console.warn('Could not load mapping for rotation settings, using defaults:', e);
        }

        const axis = rotationParams.rotationAxis.split(',').map(Number);

        return {
            solver: document.getElementById('solver-select').value,
            turbulence_model: document.getElementById('turbulence-model')?.value || 'kOmegaSST',
            end_time: parseFloat(document.getElementById('end-time').value),
            delta_t: deltaT,
            write_interval: parseFloat(document.getElementById('write-interval').value),
            purge_write: parseInt(document.getElementById('purge-write')?.value || 0),
            rotation_rpm: rotationParams.rpm,
            rotation_axis: axis,
            rotation_origin: [rotationParams.originX, rotationParams.originY, rotationParams.originZ],
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
            // RPM ramp-up (from mapping)
            enable_rampup: rotationParams.enableRampup,
            ramp_duration: rotationParams.rampDuration,
            reverse_direction: rotationParams.reverseDirection,
            // Include all propeller instances for multi-propeller support
            propeller_instances: null  // Will be populated below
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
        const calcBtn = document.getElementById('calculate-pv-btn');
        if (!calcBtn) return;

        // Setup playback speed slider with linear slomo/timelapse scale
        this.setupPlaybackSpeedSlider();

        // Calculation function (client-side for instant feedback)
        const calculate = () => {
            const fps = parseFloat(document.getElementById('target-fps').value) || 30;
            // Get speed from slider: negative = slomo (1/N), 0 = 1x, positive = timelapse (N)
            const sliderVal = parseInt(document.getElementById('playback-speed').value) || 0;
            let speed;
            if (sliderVal === 0) {
                speed = 1;
            } else if (sliderVal < 0) {
                speed = 1 / Math.abs(sliderVal);  // e.g., -8 = 1/8x speed (8x slomo)
            } else {
                speed = sliderVal;  // e.g., 8 = 8x speed (timelapse)
            }
            const endTime = parseFloat(document.getElementById('pv-end-time').value) || 1;
            const timesteps = parseFloat(document.getElementById('pv-write-interval').value) || 100;

            // Video duration = simulation duration / playback speed
            const videoDuration = endTime / speed;
            const totalFrames = Math.ceil(videoDuration * fps);
            const resampleFactor = Math.max(1, Math.ceil(totalFrames / timesteps));

            document.getElementById('result-timesteps').textContent = timesteps;
            document.getElementById('result-duration').textContent = `${videoDuration.toFixed(1)}s`;
            document.getElementById('result-frames').textContent = totalFrames;
            document.getElementById('result-resample').textContent = `${resampleFactor}x`;

            // Generate recommendation
            const recEl = document.getElementById('result-recommendation');
            if (recEl) {
                if (resampleFactor > 1) {
                    recEl.textContent = `Use Temporal Shift-Scale filter with factor ${resampleFactor}`;
                } else {
                    recEl.textContent = 'No resampling needed';
                }
            }

            document.getElementById('pv-results').style.display = 'block';
        };

        // Button click still works
        calcBtn.addEventListener('click', calculate);

        // Auto-recalculate on any input change
        ['target-fps', 'playback-speed', 'pv-end-time', 'pv-write-interval'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', calculate);
        });
    }

    setupPlaybackSpeedSlider() {
        const slider = document.getElementById('playback-speed');
        const display = document.getElementById('playback-speed-display');
        const minInput = document.getElementById('playback-speed-min');  // Slomo max
        const maxInput = document.getElementById('playback-speed-max');  // Timelapse max
        const stepInput = document.getElementById('playback-speed-step');
        const minLabel = document.getElementById('playback-speed-min-label');
        const maxLabel = document.getElementById('playback-speed-max-label');

        if (!slider || !display) return;

        // Load saved settings from localStorage
        const savedSlomoMax = localStorage.getItem('pv-slomo-max');
        const savedTimelapseMax = localStorage.getItem('pv-timelapse-max');
        const savedStep = localStorage.getItem('pv-speed-step');

        if (savedSlomoMax !== null) minInput.value = savedSlomoMax;
        if (savedTimelapseMax !== null) maxInput.value = savedTimelapseMax;
        if (savedStep !== null && stepInput) stepInput.value = savedStep;

        // Helper: format speed for display
        const formatSpeed = (val) => {
            if (val === 0) return '1x';
            if (val < 0) return `${Math.abs(val)}x slomo`;
            return `${val}x`;
        };

        // Helper: format speed for labels
        const formatLabel = (val, isSlomo) => {
            if (isSlomo) return `${val}x slomo`;
            return `${val}x`;
        };

        // Update slider bounds and step
        const updateSlider = () => {
            const slomoMax = parseInt(minInput.value) || 8;
            const timelapseMax = parseInt(maxInput.value) || 8;
            const step = parseInt(stepInput?.value) || 1;

            slider.min = -slomoMax;
            slider.max = timelapseMax;
            slider.step = step;

            // Update labels
            if (minLabel) minLabel.textContent = formatLabel(slomoMax, true);
            if (maxLabel) maxLabel.textContent = formatLabel(timelapseMax, false);

            // Snap current value to valid step
            let currentVal = parseInt(slider.value) || 0;
            if (step > 1 && currentVal !== 0) {
                // Snap to nearest valid step value
                const sign = currentVal < 0 ? -1 : 1;
                const absVal = Math.abs(currentVal);
                const snapped = Math.round(absVal / step) * step;
                currentVal = snapped === 0 ? 0 : sign * Math.max(step, snapped);
            }
            // Clamp to bounds
            currentVal = Math.max(-slomoMax, Math.min(timelapseMax, currentVal));
            slider.value = currentVal;
            display.textContent = formatSpeed(currentVal);
        };

        // Update display when slider changes
        slider.addEventListener('input', () => {
            const val = parseInt(slider.value) || 0;
            display.textContent = formatSpeed(val);
        });

        // Save and update when bounds change
        minInput.addEventListener('change', () => {
            localStorage.setItem('pv-slomo-max', minInput.value);
            updateSlider();
        });

        maxInput.addEventListener('change', () => {
            localStorage.setItem('pv-timelapse-max', maxInput.value);
            updateSlider();
        });

        if (stepInput) {
            stepInput.addEventListener('change', () => {
                localStorage.setItem('pv-speed-step', stepInput.value);
                updateSlider();
            });
        }

        // Initialize
        updateSlider();
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

        document.getElementById('copy-logs-settings-btn')?.addEventListener('click', async () => {
            const settings = {
                solver: await this.getSolverSettings(),
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

        // Mode selector
        const modeSelect = document.getElementById('analysis-mode');
        const timeWindowControls = document.getElementById('time-window-controls');
        const excludeGroup = document.getElementById('exclude-fraction-group');

        if (modeSelect) {
            modeSelect.addEventListener('change', () => {
                const mode = modeSelect.value;

                // Show/hide time window controls
                if (timeWindowControls) {
                    timeWindowControls.style.display = mode === 'window' ? 'block' : 'none';
                }

                // Show/hide exclude fraction (only for average mode)
                if (excludeGroup) {
                    excludeGroup.style.display = (mode === 'average') ? 'block' : 'none';
                }

                // Auto-refresh when mode changes (except 'saved' which is just reading file)
                if (mode !== 'saved') {
                    this.loadPerformanceData(false);
                } else {
                    this.loadPerformanceData(false);
                }
            });

            // Initialize visibility based on current mode
            const initialMode = modeSelect.value;
            if (timeWindowControls) {
                timeWindowControls.style.display = initialMode === 'window' ? 'block' : 'none';
            }
            if (excludeGroup) {
                excludeGroup.style.display = (initialMode === 'average') ? 'block' : 'none';
            }
        }

        // Setup dual-handle range slider
        this.setupTimeRangeSlider();

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

    setupTimeRangeSlider() {
        const startSlider = document.getElementById('analysis-start-time-slider');
        const endSlider = document.getElementById('analysis-end-time-slider');
        const startInput = document.getElementById('analysis-start-time');
        const endInput = document.getElementById('analysis-end-time');
        const display = document.getElementById('time-window-display');
        const fill = document.getElementById('range-slider-fill');
        const minLabel = document.getElementById('time-slider-min');
        const maxLabel = document.getElementById('time-slider-max');

        if (!startSlider || !endSlider) return;

        // Store simulation time range (will be updated when loading run data)
        this.simTimeMin = 0;
        this.simTimeMax = 0.1;

        const updateDisplay = () => {
            const startPct = parseFloat(startSlider.value);
            const endPct = parseFloat(endSlider.value);

            // Convert percentage to actual time
            const range = this.simTimeMax - this.simTimeMin;
            const startTime = this.simTimeMin + (startPct / 100) * range;
            const endTime = this.simTimeMin + (endPct / 100) * range;

            // Update display
            if (display) {
                display.textContent = `${startTime.toFixed(3)}s - ${endTime.toFixed(3)}s`;
            }

            // Update fill bar
            if (fill) {
                fill.style.left = `${startPct}%`;
                fill.style.right = `${100 - endPct}%`;
            }

            // Sync with number inputs
            if (startInput) startInput.value = startTime.toFixed(4);
            if (endInput) endInput.value = endTime.toFixed(4);
        };

        // Make slider thumbs interactive
        startSlider.style.pointerEvents = 'auto';
        endSlider.style.pointerEvents = 'auto';

        startSlider.addEventListener('input', () => {
            // Ensure start doesn't exceed end
            if (parseFloat(startSlider.value) > parseFloat(endSlider.value)) {
                startSlider.value = endSlider.value;
            }
            updateDisplay();
        });

        endSlider.addEventListener('input', () => {
            // Ensure end doesn't go below start
            if (parseFloat(endSlider.value) < parseFloat(startSlider.value)) {
                endSlider.value = startSlider.value;
            }
            updateDisplay();
        });

        // Sync number inputs to sliders
        if (startInput) {
            startInput.addEventListener('change', () => {
                const val = parseFloat(startInput.value) || 0;
                const range = this.simTimeMax - this.simTimeMin;
                const pct = range > 0 ? ((val - this.simTimeMin) / range) * 100 : 0;
                startSlider.value = Math.max(0, Math.min(100, pct));
                updateDisplay();
            });
        }

        if (endInput) {
            endInput.addEventListener('change', () => {
                const val = parseFloat(endInput.value) || this.simTimeMax;
                const range = this.simTimeMax - this.simTimeMin;
                const pct = range > 0 ? ((val - this.simTimeMin) / range) * 100 : 100;
                endSlider.value = Math.max(0, Math.min(100, pct));
                updateDisplay();
            });
        }

        // Store update function for later use
        this.updateTimeRangeSlider = (minTime, maxTime) => {
            this.simTimeMin = minTime;
            this.simTimeMax = maxTime;

            if (minLabel) minLabel.textContent = `${minTime.toFixed(3)}s`;
            if (maxLabel) maxLabel.textContent = `${maxTime.toFixed(3)}s`;

            // Reset sliders to full range
            startSlider.value = 0;
            endSlider.value = 100;

            if (startInput) startInput.value = minTime.toFixed(4);
            if (endInput) endInput.value = maxTime.toFixed(4);

            updateDisplay();
        };

        // Initialize
        updateDisplay();
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
        const timeInfo = document.getElementById('analysis-time-info');

        if (loading) loading.style.display = 'block';
        if (dataDiv) dataDiv.style.display = 'none';
        if (errorDiv) errorDiv.style.display = 'none';
        if (emptyDiv) emptyDiv.style.display = 'none';

        try {
            // Get analysis mode and parameters
            const mode = document.getElementById('analysis-mode')?.value || 'saved';
            const excludeFraction = parseFloat(document.getElementById('analysis-exclude-fraction')?.value || 20) / 100;
            const timeStart = parseFloat(document.getElementById('analysis-start-time')?.value || 0);
            const timeEnd = parseFloat(document.getElementById('analysis-end-time')?.value || 1);

            let data;
            if (forceRefresh) {
                data = await API.triggerAnalysis(this.currentRunId);
            } else {
                data = await API.getPerformance(this.currentRunId, mode, excludeFraction, timeStart, timeEnd);
            }

            if (loading) loading.style.display = 'none';

            // Update time info display
            if (timeInfo && data.time_range) {
                const tr = data.time_range;
                timeInfo.textContent = `Analysis: ${tr.start?.toFixed(3) || 0}s - ${tr.end?.toFixed(3) || 0}s (${tr.samples || 0} samples)`;
            } else if (timeInfo) {
                timeInfo.textContent = '';
            }

            // Update slider range if we got time data from the response
            if (data.simulation_time_range && this.updateTimeRangeSlider) {
                this.updateTimeRangeSlider(data.simulation_time_range.min, data.simulation_time_range.max);
            }

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
