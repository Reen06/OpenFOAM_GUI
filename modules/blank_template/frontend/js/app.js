/**
 * OpenFOAM Blank Module Template - Main Application
 *
 * Generic simulation manager with:
 *   - Run management (create, view, delete)
 *   - Mesh library & upload
 *   - WebSocket log streaming
 *   - Progress tracking
 *
 * TODO: Add your case-specific settings gathering in getCaseSettings().
 * See BLANK_MODULE_GUIDE.md for instructions.
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
        this.storageHistory = [];

        // WebSocket
        this.ws = new WebSocketManager();

        // Initialize
        this.init();
    }

    init() {
        this.setupTabs();
        this.setupParallelToggle();
        this.setupButtons();
        this.setupWebSocket();
        this.setupLogControls();
        this.setupRunManager();
        this.setupMeshUpload();

        // Load initial data
        this.loadRuns();
        this.loadMeshLibrary();

        // Update connection status
        this.updateConnectionStatus('connected');

        // Check for run_id query param (from landing page "View" button)
        this.handleQueryParams();
    }

    handleQueryParams() {
        const params = new URLSearchParams(window.location.search);
        const runId = params.get('run_id');
        if (runId) {
            this.viewRun(runId);
        }
    }

    // ==================== Tabs ====================

    setupTabs() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabPanels = document.querySelectorAll('.tab-panel');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.dataset.tab;

                tabBtns.forEach(b => b.classList.remove('active'));
                tabPanels.forEach(p => p.classList.remove('active'));

                btn.classList.add('active');
                document.getElementById(tabId)?.classList.add('active');

                // Load data based on tab
                if (tabId === 'boundary-mapper' && this.currentRunId) {
                    this.initBoundaryMapper();
                }
            });
        });
    }

    // ==================== Boundary Mapper ====================
    // Initializes the shared BoundaryMapper widget.
    // Copy this method into your own module's app.js.
    // Requires: <script src="/shared/boundary_mapper.js"> in index.html
    //           <div id="boundary-mapper-container"> in the tab panel
    //           API endpoints in your backend (see blank_template/backend/main.py)

    initBoundaryMapper() {
        if (!this.currentRunId) return;

        const container = document.getElementById('boundary-mapper-container');
        if (!container) return;

        // Destroy previous instance if exists
        if (this._boundaryMapper) {
            this._boundaryMapper.destroy();
            this._boundaryMapper = null;
        }

        // Create new BoundaryMapper widget
        this._boundaryMapper = new BoundaryMapper(container, {
            apiBase: BASE_URL,
            runId: this.currentRunId
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

        if (uploadBox && fileInput) {
            uploadBox.addEventListener('click', () => fileInput.click());

            uploadBox.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadBox.classList.add('dragover');
            });

            uploadBox.addEventListener('dragleave', () => {
                uploadBox.classList.remove('dragover');
            });

            uploadBox.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadBox.classList.remove('dragover');
                if (e.dataTransfer.files.length > 0) {
                    this.meshFile = e.dataTransfer.files[0];
                    this.updateMeshUploadStatus(this.meshFile.name);
                }
            });

            fileInput.addEventListener('change', () => {
                if (fileInput.files.length > 0) {
                    this.meshFile = fileInput.files[0];
                    this.updateMeshUploadStatus(this.meshFile.name);
                }
            });
        }
    }

    updateMeshUploadStatus(filename) {
        const status = document.getElementById('mesh-upload-status');
        if (status) {
            status.textContent = `Selected: ${filename}`;
            document.getElementById('mesh-upload-box')?.classList.add('has-file');
        }
    }

    // ==================== Run Manager ====================

    setupRunManager() {
        const meshSelector = document.getElementById('mesh-selector');
        const createBtn = document.getElementById('create-run-btn');
        const refreshBtn = document.getElementById('refresh-runs-btn');
        const solverBtn = document.getElementById('go-to-solver-btn');

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
        const run = this.runsData?.find(r => r.run_id === runId);
        if (!run) {
            alert('Run not found');
            return;
        }

        const config = run.solver_config || {};
        let msg = `=== CASE SETTINGS ===\n`;

        // TODO: Customize this display for your case settings
        for (const [key, value] of Object.entries(config)) {
            msg += `${key}: ${JSON.stringify(value)}\n`;
        }

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

                // Check for UNV unit warnings
                if (result.unit_warning) {
                    const msg = `\u26a0\ufe0f Unit Warning\n\n${result.unit_warning.message}\n\nOpenFOAM requires all mesh coordinates to be in meters (SI).\n\nDo you want to continue anyway?`;
                    if (!confirm(msg)) {
                        this.addLog('Upload cancelled due to unit mismatch.');
                        return;
                    }
                    this.addLog(`[WARN] ${result.unit_warning.message}`);
                }

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

            // Reload and switch to boundary mapper tab
            await this.loadRuns();
            await this.viewRun(result.run_id);
            document.querySelector('[data-tab="boundary-mapper"]')?.click();

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

            // Enable run button
            document.getElementById('run-simulation-btn').disabled = false;

            // If simulation is running, show appropriate UI state
            const runBtn = document.getElementById('run-simulation-btn');
            const stopBtn = document.getElementById('stop-simulation-btn');
            const progressContainer = document.getElementById('progress-container');

            // Clear previous run's state
            if (this.progressTimer) {
                clearInterval(this.progressTimer);
                this.progressTimer = null;
            }
            this.simStartTime = null;
            this.currentSimTime = 0;
            this.storageHistory = [];

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

            // Clear log display
            this.logLines = [];
            this.updateLogDisplay();

            if (details.status === 'running') {
                runBtn.disabled = true;
                stopBtn.disabled = false;
                progressContainer.style.display = 'block';
                this.addLog('[STATUS] Reconnected to running simulation');

                if (details.started_at) {
                    this.startedAt = new Date(details.started_at);
                    this.simStartTime = this.startedAt.getTime();
                }
                if (details.end_time) {
                    this.endTime = details.end_time;
                }

                if (this.startedAt && this.endTime) {
                    this.startProgressTimer();
                }
            } else {
                runBtn.disabled = false;
                stopBtn.disabled = true;
            }

            // Update run list selection
            this.renderRuns(this.runsData);

            // Connect WebSocket to this run
            this.connectWebSocket();

            // Navigate to appropriate tab based on run status
            if (details.status === 'running') {
                document.querySelector('[data-tab="solver"]')?.click();
            } else {
                document.querySelector('[data-tab="boundary-mapper"]')?.click();
            }

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

    /**
     * TODO: Customize this method to gather your case-specific settings.
     *
     * This returns a dictionary that gets sent to the backend's /start endpoint.
     * Add whatever fields your _apply_settings() and _run_solver() need.
     */
    getCaseSettings() {
        return {
            end_time: parseFloat(document.getElementById('end-time')?.value) || 1000,
            delta_t: parseFloat(document.getElementById('delta-t')?.value) || 1,
            write_interval: parseFloat(document.getElementById('write-interval')?.value) || 100,
            parallel: document.getElementById('enable-parallel')?.checked || false,
            num_cores: parseInt(document.getElementById('num-cores')?.value) || 4
            // TODO: Add your case settings here, e.g.:
            // solver: document.getElementById('solver-select')?.value || 'simpleFoam',
            // turbulence_model: document.getElementById('turbulence-model')?.value || 'kOmegaSST',
            // inlet_velocity: [parseFloat(document.getElementById('inlet-ux')?.value) || 0, 0, 0],
        };
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

        const caseSettings = this.getCaseSettings();

        this.addLog('Starting simulation...');
        this.addLog(`Settings: ${JSON.stringify(caseSettings)}`);

        try {
            this.simStartTime = Date.now();
            this.progressTimer = setInterval(() => this.updateProgressTimer(), 1000);

            await API.startRun(this.currentRunId, caseSettings);
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

        const progressTime = document.getElementById('progress-time');
        if (progressTime) {
            progressTime.textContent = `Time: ${mins}m ${secs}s`;
        }
    }

    startProgressTimer() {
        if (this.progressTimer) clearInterval(this.progressTimer);
        this.progressTimer = setInterval(() => this.updateProgressTimer(), 1000);
    }

    async stopSimulation() {
        if (!this.currentRunId) return;

        try {
            await API.stopRun(this.currentRunId);
            this.addLog('Stop signal sent');
        } catch (e) {
            this.addLog(`Error: ${e.message}`, 'error');
        }

        clearInterval(this.progressTimer);
        document.getElementById('run-simulation-btn').disabled = false;
        document.getElementById('stop-simulation-btn').disabled = true;
    }

    // ==================== WebSocket ====================

    setupWebSocket() {
        // Set up callback handlers
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

                    if (this.simStartTime && percent > 0) {
                        const elapsedMs = Date.now() - this.simStartTime;
                        const elapsedSecs = elapsedMs / 1000;
                        const totalEstimatedSecs = elapsedSecs * 100 / percent;
                        const etaSecs = Math.max(0, totalEstimatedSecs - elapsedSecs);

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
        if (this.currentRunId) {
            this.ws.connect(this.currentRunId);
        }
    }

    // ==================== Logging ====================

    setupLogControls() {
        const clearBtn = document.getElementById('clear-logs-btn');
        const scrollBtn = document.getElementById('scroll-bottom-btn');

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.logLines = [];
                this.updateLogDisplay();
            });
        }

        if (scrollBtn) {
            scrollBtn.addEventListener('click', () => {
                const logOutput = document.getElementById('log-output');
                if (logOutput) logOutput.scrollTop = logOutput.scrollHeight;
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
}

// Initialize app
const app = new App();
