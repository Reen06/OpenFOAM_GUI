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

        // Courant number tracking
        this.courantHistory = [];
        this.courantMaxHistory = [];
        this.courantWindowSize = 20;

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
        this.setupDefaultsButton();
        this.setupInfoButtons();
        this.setupPerformanceTab();

        // Load initial data
        this.loadRuns();
        this.loadMeshLibrary();
        this.loadDefaults();

        // Update connection status
        this.updateConnectionStatus('connected');

        // Setup Progressive Web App (PWA) Support
        this.setupPWA();

        // Setup LAN Access Toggle
        this.setupLANToggle();

        // Setup Notifications
        this.setupNotifications();

        // Check for run_id query param (from landing page "View" button)
        this.handleQueryParams();
    }

    // ==================== PWA Setup ====================
    setupPWA() {
        const installBtn = document.getElementById('pwa-install-btn');
        const installedBtn = document.getElementById('pwa-installed-btn');
        let deferredPrompt = null;

        // 1. Register Service Worker and detect updates
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/windtunnel/static/sw.js', { scope: '/windtunnel/' }).then(reg => {
                console.log('Service Worker registered for PWA:', reg.scope);

                // Check for updates periodically (every 60s — great for development)
                setInterval(() => reg.update(), 60 * 1000);

                // Detect when a new SW version is waiting to activate
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (!newWorker) return;

                    newWorker.addEventListener('statechange', () => {
                        // A new SW is installed and waiting — show the update button
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            console.log('New version available — showing update button');
                            const updateBtn = document.getElementById('pwa-update-btn');
                            if (updateBtn) {
                                updateBtn.style.display = 'inline-block';
                                updateBtn.addEventListener('click', () => {
                                    window.location.reload();
                                });
                            }
                        }
                    });
                });
            }).catch(err => {
                console.warn('Service Worker registration failed:', err);
            });

            // Also handle the case where the SW activates and takes control (skipWaiting)
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                // If the page isn't being reloaded already by the user, show the badge
                const updateBtn = document.getElementById('pwa-update-btn');
                if (updateBtn && updateBtn.style.display !== 'inline-block') {
                    updateBtn.style.display = 'inline-block';
                    updateBtn.addEventListener('click', () => {
                        window.location.reload();
                    });
                }
            });
        }

        // 2. Detect if already running as standalone app
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
        if (isStandalone) {
            console.log('Running in standalone PWA mode');
            localStorage.setItem('pwa-installed', 'true');
            if (installedBtn) installedBtn.style.display = 'inline-block';
            if (installBtn) installBtn.style.display = 'none';
            return; // No need to set up install button in standalone mode
        }

        // 3. Check if previously installed (persists across refreshes)
        const wasInstalled = localStorage.getItem('pwa-installed') === 'true';
        if (wasInstalled) {
            if (installBtn) installBtn.style.display = 'none';
            if (installedBtn) installedBtn.style.display = 'inline-block';
        }

        // 4. Button click handler (only matters if button is visible)
        if (installBtn) {
            installBtn.addEventListener('click', async () => {
                if (deferredPrompt) {
                    deferredPrompt.prompt();
                    const { outcome } = await deferredPrompt.userChoice;
                    console.log('User response to PWA install: ' + outcome);
                    deferredPrompt = null;
                    if (outcome === 'accepted') {
                        localStorage.setItem('pwa-installed', 'true');
                        installBtn.style.display = 'none';
                        if (installedBtn) installedBtn.style.display = 'inline-block';
                    }
                } else {
                    alert('To install this app:\n\n1. Click the browser menu (\u22ee) in the top right\n2. Select "Install OpenFOAM Wind Tunnel"\n   (or "Add to Home screen" on mobile)\n\nIf that option is not available, make sure you are using Chrome or Edge.');
                }
            });
        }

        // 5. Intercept Chrome's beforeinstallprompt event
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            // App is installable — clear the installed flag (user may have uninstalled)
            // and show the install button
            localStorage.removeItem('pwa-installed');
            if (installBtn) installBtn.style.display = 'inline-block';
            if (installedBtn) installedBtn.style.display = 'none';
        });

        // 6. Handle successful installation
        window.addEventListener('appinstalled', () => {
            console.log('PWA installation successful');
            localStorage.setItem('pwa-installed', 'true');
            if (installBtn) installBtn.style.display = 'none';
            if (installedBtn) installedBtn.style.display = 'inline-block';
            deferredPrompt = null;
        });
    }

    // ==================== LAN Access Toggle ====================
    setupLANToggle() {
        const toggle = document.getElementById('lan-toggle-input');
        const panel = document.getElementById('lan-info-panel');
        const urlDisplay = document.getElementById('lan-url');
        if (!toggle || !panel) return;

        // Auto-detect LAN access or restore saved state
        const hostname = window.location.hostname;
        const isLANAccess = hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1';
        const savedState = localStorage.getItem('lan-toggle-state');
        
        if (isLANAccess || savedState === 'on') {
            toggle.checked = true;
            this.fetchLANInfo(panel, urlDisplay);
        }

        toggle.addEventListener('change', () => {
            if (toggle.checked) {
                localStorage.setItem('lan-toggle-state', 'on');
                this.fetchLANInfo(panel, urlDisplay);
            } else {
                localStorage.setItem('lan-toggle-state', 'off');
                panel.classList.remove('loaded');
            }
        });

        // Click on URL to copy
        if (urlDisplay) {
            urlDisplay.addEventListener('click', () => {
                const url = urlDisplay.textContent;
                navigator.clipboard.writeText(url).then(() => {
                    const original = urlDisplay.textContent;
                    urlDisplay.textContent = 'Copied!';
                    urlDisplay.style.color = '#3fb950';
                    setTimeout(() => {
                        urlDisplay.textContent = original;
                        urlDisplay.style.color = '#58a6ff';
                    }, 1500);
                });
            });
        }
    }

    async fetchLANInfo(panel, urlDisplay) {
        // Add 'loaded' class — CSS :hover rule on the wrapper shows it on hover
        if (urlDisplay) urlDisplay.textContent = 'Detecting...';
        try {
            const response = await fetch('api/lan-info');
            const data = await response.json();
            if (data.available && urlDisplay) {
                urlDisplay.textContent = data.url;
                panel.classList.add('loaded');
            } else if (urlDisplay) {
                urlDisplay.textContent = 'Could not detect LAN IP';
                urlDisplay.style.color = '#f85149';
                panel.classList.add('loaded');
            }
        } catch (err) {
            if (urlDisplay) {
                urlDisplay.textContent = 'Error fetching LAN info';
                urlDisplay.style.color = '#f85149';
                panel.classList.add('loaded');
            }
        }
    }

    // ==================== Notifications ====================
    setupNotifications() {
        const toggle = document.getElementById('notif-toggle-input');
        if (!toggle) return;

        this.notificationsEnabled = false;

        // Restore saved state
        if (localStorage.getItem('notif-enabled') === 'true') {
            if (Notification.permission === 'granted') {
                toggle.checked = true;
                this.notificationsEnabled = true;
            }
        }

        // Use 'click' rather than 'change' and avoid 'await' before requestPermission
        // Safari iOS requires requestPermission to be called synchronously in the gesture handler
        toggle.addEventListener('click', () => {
            if (toggle.checked) {
                // Request permission
                if ('Notification' in window) {
                    Notification.requestPermission().then(permission => {
                        if (permission === 'granted') {
                            this.notificationsEnabled = true;
                            localStorage.setItem('notif-enabled', 'true');
                            // Use a short delay to ensure SW is ready
                            setTimeout(() => {
                                this.sendNotification('🔔 Notifications enabled', 'You will be notified when simulations finish or crash.');
                            }, 500);
                        } else {
                            toggle.checked = false;
                            alert('Notification permission was denied.\n\nOn iOS, you MUST add this to your Home Screen. Note: Apple also silently blocks notification prompts on LAN IPs (like 10.0.0.x) because they are not HTTPS.');
                        }
                    }).catch(e => {
                        toggle.checked = false;
                        console.warn('Error requesting notification permission:', e);
                    });
                } else {
                    toggle.checked = false;
                    alert('Your browser does not support notifications.');
                }
            } else {
                this.notificationsEnabled = false;
                localStorage.setItem('notif-enabled', 'false');
            }
        });
    }

    sendNotification(title, body) {
        if (!this.notificationsEnabled) return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        
        // Use service worker to show notification (required for iOS PWA)
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'SHOW_NOTIFICATION',
                title: title,
                body: body,
                icon: '/windtunnel/static/icons/icon.svg',
                tag: 'openfoam-gui'
            });
            return;
        }
        
        // Fallback for non-SW contexts
        try {
            const notif = new Notification(title, {
                body: body,
                icon: '/windtunnel/static/icons/icon.svg',
                tag: 'openfoam-gui',
                requireInteraction: false
            });
            setTimeout(() => notif.close(), 8000);
        } catch (e) {
            console.warn('Notification failed:', e);
        }
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
                    this.initBoundaryMapper();
                } else if (tabId === 'paraview') {
                    this.updateParaviewHelper(this.currentRunId);
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
                <strong>Wall Boundary Type (Tunnel Walls)</strong><br><br>
                Controls the boundary condition on the <strong>tunnel walls</strong> (top, bottom, sides).<br><br>
                - <strong>Slip:</strong> Frictionless wall. Air flows perfectly along the surface.<br>
                - <strong>No-Slip:</strong> Realistic wall with friction. Air speed is zero exactly at the surface.<br>
                - <strong>Partial Slip:</strong> Adjustable friction. Use the slider to set how much slip to allow (0% = no-slip, 100% = full slip).<br>
                - <strong>Wall Functions:</strong> Uses mathematical formulas to model the boundary layer. Recommended when using turbulence models for better accuracy without needing an extremely fine mesh.
            `,
            'wall-slip': `
                <strong>Wall Slip Percentage</strong><br><br>
                Controls how much the tunnel wall allows the fluid to slide along it.<br>
                - <strong>0%:</strong> No-slip (zero velocity at wall, maximum friction)<br>
                - <strong>50%:</strong> Half slip (intermediate friction)<br>
                - <strong>100%:</strong> Full slip (frictionless wall)<br><br>
                This uses OpenFOAM's partialSlip boundary condition.
            `,
            'model-surface-type': `
                <strong>Model Surface Condition</strong><br><br>
                Controls the boundary condition on the <strong>model/object surface</strong> inside the wind tunnel.<br><br>
                - <strong>No-Slip:</strong> Realistic wall with friction (default). Air speed is zero at the surface. Use this for accurate force prediction.<br>
                - <strong>Slip:</strong> Frictionless surface. Useful for initial testing or inviscid analysis.<br>
                - <strong>Partial Slip:</strong> Adjustable friction between the model and the air.<br>
                - <strong>Wall Functions:</strong> Uses wall functions for the boundary layer.
            `,
            'model-slip': `
                <strong>Model Slip Percentage</strong><br><br>
                Controls how much the model surface allows the fluid to slide along it.<br>
                - <strong>0%:</strong> No-slip (zero velocity at surface, maximum friction)<br>
                - <strong>50%:</strong> Half slip (intermediate friction)<br>
                - <strong>100%:</strong> Full slip (frictionless surface)<br><br>
                This uses OpenFOAM's partialSlip boundary condition.
            `,
            'ref-area': `
                <strong>Reference / Frontal Area</strong><br><br>
                The projected frontal area of your model (in m²). This is used to calculate aerodynamic coefficients (Cd, Cl).<br><br>
                <strong>How to measure:</strong> Project your model onto a plane perpendicular to the flow direction and measure the area.<br><br>
                For a pinewood derby car, this might be around 0.001-0.003 m² (roughly 3-5 cm² cross-section).<br>
                For a full-size car, typically 1.5-2.5 m².
            `,
            'ref-length': `
                <strong>Reference Length</strong><br><br>
                A characteristic length of your model (in meters). Used for moment coefficient calculations.<br><br>
                Common choices: wheelbase, overall length, or chord length (for airfoils).
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

        // Refresh mesh library when dropdown is clicked/opened
        if (meshSelector) {
            meshSelector.addEventListener('mousedown', () => {
                this.loadMeshLibrary();
            });

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

        // Solver change handler for adaptive row and timestep strategy
        const solverSelect = document.getElementById('solver-select');
        const adaptiveRow = document.getElementById('adaptive-row');
        const timestepStrategyGroup = document.getElementById('timestep-strategy-group');
        const simpleTimestepOpts = document.getElementById('simple-timestep-options');
        const scheduleTimestepOpts = document.getElementById('schedule-timestep-options');
        if (solverSelect) {
            const updateSolverDependentUI = () => {
                const isTransient = solverSelect.value.toLowerCase().includes('pimple');
                const deltaTRow = document.getElementById('delta-t-row');
                const convergenceRow = document.getElementById('convergence-row');
                // Hide adaptive row for steady-state (but keep Delta T visible)
                if (adaptiveRow) adaptiveRow.style.display = isTransient ? 'flex' : 'none';
                // Hide timestep strategy (schedule/simple) for steady-state solvers
                if (timestepStrategyGroup) timestepStrategyGroup.style.display = isTransient ? '' : 'none';
                // Hide Delta T for steady-state (always 1, no user control needed)
                if (deltaTRow) deltaTRow.style.display = isTransient ? '' : 'none';
                // Hide convergence thresholds for transient (only used by SIMPLE)
                if (convergenceRow) convergenceRow.style.display = isTransient ? 'none' : 'flex';
                if (!isTransient) {
                    // Reset to simple and hide schedule panel
                    const strategyEl = document.getElementById('timestep-strategy');
                    if (strategyEl) strategyEl.value = 'simple';
                    if (simpleTimestepOpts) simpleTimestepOpts.style.display = 'block';
                    if (scheduleTimestepOpts) scheduleTimestepOpts.style.display = 'none';
                }
            };
            solverSelect.addEventListener('change', updateSolverDependentUI);
            // Always apply correct UI for the current solver value on init.
            // loadSolverConfig will dispatch 'change' if saved config exists;
            // this call handles the fallback (fresh backend, no saved config).
            updateSolverDependentUI();
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

        // Min Delta T checkbox handler
        const enableMinDt = document.getElementById('enable-min-delta-t');
        const minDtInput = document.getElementById('min-delta-t');
        if (enableMinDt && minDtInput) {
            enableMinDt.addEventListener('change', () => {
                minDtInput.disabled = !enableMinDt.checked;
            });
        }

        // End Time change handler - update schedule widget's total time
        const endTimeInput = document.getElementById('end-time');
        if (endTimeInput) {
            endTimeInput.addEventListener('input', () => {
                const newEnd = parseFloat(endTimeInput.value);
                if (this.timestepSchedule && newEnd > 0) {
                    this.timestepSchedule.setEndTime(newEnd);
                }
            });
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

        // Model surface type handler for partial slip slider
        const modelTypeSelect = document.getElementById('model-surface-type');
        const modelSlipGroup = document.getElementById('model-slip-group');
        const modelSlipFraction = document.getElementById('model-slip-fraction');
        const modelSlipValue = document.getElementById('model-slip-value');

        if (modelTypeSelect && modelSlipGroup) {
            modelTypeSelect.addEventListener('change', () => {
                modelSlipGroup.style.display = modelTypeSelect.value === 'partialSlip' ? 'block' : 'none';
            });
            // Initial state
            modelSlipGroup.style.display = modelTypeSelect.value === 'partialSlip' ? 'block' : 'none';
        }

        if (modelSlipFraction && modelSlipValue) {
            modelSlipFraction.addEventListener('input', () => {
                modelSlipValue.textContent = `${modelSlipFraction.value}%`;
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
                                    ${mesh.project || 'default'} | ${new Date(mesh.created).toLocaleDateString()}${mesh.polymesh_path ? ' | &#x2713; polyMesh' : ''}
                                    ${mesh.has_default_mapping ? ' | <span class="mesh-default-badge" title="This mesh has a saved boundary mapping default">&#x1F4CB; Has saved mapping</span>' : ''}
                                </span>
                            </div>
                            <div class="library-item-actions">
                                ${mesh.has_default_mapping ? `<button class="btn btn-secondary btn-sm" onclick="app.clearMeshDefault('${mesh.id}')" title="Clear saved default mapping">Clear Default</button>` : ''}
                                <button class="btn btn-secondary btn-sm" onclick="app.downloadMesh('${mesh.id}')" title="Download mesh file">&#x1F4E5; Download</button>
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
        msg += `Model Surface: ${solver.model_surface_type || 'noSlip'}\n`;
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
            if (result.has_default_mapping) {
                this.addLog('Default boundary mapping applied from mesh library');
            }

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

            // Enable run and check mesh buttons
            document.getElementById('run-simulation-btn').disabled = false;
            document.getElementById('check-mesh-btn').disabled = false;

            // Set up check mesh button handler
            const checkMeshBtn = document.getElementById('check-mesh-btn');
            checkMeshBtn.onclick = () => this.checkMesh();

            // Performance tab is always visible — show empty state when run isn't complete
            document.getElementById('performance-tab-btn').style.display = 'flex';
            if (details.status === 'completed' || details.status === 'success') {
                this.loadPerformanceData();
            } else {
                // Make sure the empty state is visible and data is hidden
                const perfEmpty = document.getElementById('performance-empty');
                const perfData = document.getElementById('performance-data');
                if (perfEmpty) perfEmpty.style.display = 'block';
                if (perfData) perfData.style.display = 'none';
            }

            // Update ParaView Helper tab with run data
            this.updateParaviewHelper(runId);

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
            const progressStep = document.getElementById('progress-step');
            const progressCourant = document.getElementById('progress-courant');
            if (progressFill) progressFill.style.width = '0%';
            if (progressTime) progressTime.textContent = 'Time: 0m 0s';
            if (progressIter) progressIter.textContent = 'SimTime: 0';
            if (progressEta) progressEta.textContent = 'ETA: calculating...';
            if (progressStep) progressStep.textContent = 'Initializing...';
            if (progressCourant) { progressCourant.style.display = 'none'; progressCourant.textContent = 'Co: --'; }
            const progressDeltaT = document.getElementById('progress-delta-t');
            if (progressDeltaT) { progressDeltaT.style.display = 'none'; progressDeltaT.textContent = 'ΔT: --'; }
            this.courantHistory = [];
            this.courantMaxHistory = [];

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

            // Restore solver settings from saved config
            if (details.solver_config && Object.keys(details.solver_config).length > 0) {
                this.restoreSolverSettings(details.solver_config);
            }

            // Update run list selection
            this.renderRuns(this.runsData);

            // Connect WebSocket to this run
            this.connectWebSocket();

            // Store paraview path for use in Performance tab (pvOutputs already fetched above)
            this.currentParaviewPath = pvOutputs.foam_file || pvOutputs.case_dir || null;
            this.updatePerformanceParaview();

            // Navigate to appropriate tab based on run status
            console.log('[VIEW-DEBUG] Run status:', details.status);
            if (details.status === 'running') {
                // Running simulation - go to Solver tab for live output
                console.log('[VIEW-DEBUG] Navigating to Solver tab');
                document.querySelector('[data-tab="solver"]')?.click();
            } else if (details.status === 'completed' || details.status === 'success') {
                // Completed run - go to Performance/Results tab  
                console.log('[VIEW-DEBUG] Navigating to Performance tab');
                document.querySelector('[data-tab="performance"]')?.click();
            } else {
                // New/created run - go to Boundary Mapper tab
                console.log('[VIEW-DEBUG] Navigating to Boundary Mapper tab');
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

    // ==================== Boundary Mapper ====================

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

        // Get mesh_id from run details for the "Set Default" button
        let meshId = null;
        if (this.currentRunId) {
            try {
                const resp = await fetch(BASE_URL + `/api/run/${this.currentRunId}`);
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

        const viewResultsBtn = document.getElementById('view-results-btn');
        if (viewResultsBtn) {
            viewResultsBtn.addEventListener('click', () => {
                // Navigate to performance tab and load data
                document.querySelector('[data-tab="performance"]')?.click();
                this.loadPerformanceData(true);
            });
        }

        const autoCalcBtn = document.getElementById('auto-calc-ref-btn');
        if (autoCalcBtn) {
            autoCalcBtn.addEventListener('click', async () => {
                if (!this.currentRunId) {
                    alert('Please select a run first');
                    return;
                }

                const statusDiv = document.getElementById('ref-calc-status');
                autoCalcBtn.disabled = true;
                autoCalcBtn.textContent = '⏳ Calculating...';

                if (statusDiv) {
                    statusDiv.style.display = 'block';
                    statusDiv.style.background = 'rgba(0,150,255,0.1)';
                    statusDiv.style.border = '1px solid rgba(0,150,255,0.3)';
                    statusDiv.textContent = 'Reading polyMesh and projecting faces...';
                }

                try {
                    const result = await API.getRefValues(this.currentRunId);

                    if (result.error) {
                        if (statusDiv) {
                            statusDiv.style.background = 'rgba(255,50,50,0.1)';
                            statusDiv.style.border = '1px solid rgba(255,50,50,0.3)';
                            statusDiv.textContent = `Error: ${result.error}`;
                        }
                    } else {
                        // Populate the inputs
                        const areaInput = document.getElementById('ref-area');
                        const lengthInput = document.getElementById('ref-length');
                        if (areaInput) areaInput.value = result.ref_area;
                        if (lengthInput) lengthInput.value = result.ref_length;

                        if (statusDiv) {
                            statusDiv.style.background = 'rgba(0,200,100,0.1)';
                            statusDiv.style.border = '1px solid rgba(0,200,100,0.3)';
                            const bbox = result.bbox_min && result.bbox_max
                                ? `BBox: (${result.bbox_min.map(v => v.toFixed(4)).join(', ')}) → (${result.bbox_max.map(v => v.toFixed(4)).join(', ')})`
                                : '';
                            statusDiv.innerHTML = `✅ <strong>Area:</strong> ${result.ref_area} m² | <strong>Length:</strong> ${result.ref_length} m<br>` +
                                `<span style="font-size: 0.85em; color: var(--text-muted);">Method: ${result.method} | ${result.num_faces} faces, ${result.num_vertices} vertices | Patches: ${result.patches_used?.join(', ')}<br>${bbox}</span>`;
                        }
                    }
                } catch (e) {
                    if (statusDiv) {
                        statusDiv.style.background = 'rgba(255,50,50,0.1)';
                        statusDiv.style.border = '1px solid rgba(255,50,50,0.3)';
                        statusDiv.textContent = `Error: ${e.message}`;
                    }
                }

                autoCalcBtn.disabled = false;
                autoCalcBtn.textContent = '🔄 Auto-Calculate from Mesh';
            });
        }
    }

    getSolverSettings() {
        const strategy = document.getElementById('timestep-strategy')?.value || 'simple';
        const isSchedule = strategy === 'schedule';

        const settings = {
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
            up_direction: document.getElementById('up-direction')?.value || 'z-up',
            wall_type: document.getElementById('wall-type')?.value || 'noSlip',
            wall_slip_fraction: parseInt(document.getElementById('wall-slip-fraction')?.value || 50) / 100,
            model_surface_type: document.getElementById('model-surface-type')?.value || 'noSlip',
            model_slip_fraction: parseInt(document.getElementById('model-slip-fraction')?.value || 50) / 100,
            ref_area: parseFloat(document.getElementById('ref-area')?.value) || 1.0,
            ref_length: parseFloat(document.getElementById('ref-length')?.value) || 1.0,
            parallel: document.getElementById('enable-parallel')?.checked || false,
            num_cores: parseInt(document.getElementById('num-cores')?.value) || 4,
            relax_p: parseFloat(document.getElementById('relax-p')?.value) || 0.15,
            relax_u: parseFloat(document.getElementById('relax-u')?.value) || 0.3,
            adjust_timestep: document.getElementById('adjust-timestep')?.checked || false,
            max_co: parseFloat(document.getElementById('max-co')?.value) || 0.5,
            max_delta_t: parseFloat(document.getElementById('max-delta-t')?.value) || 1e-4,
            enable_min_delta_t: document.getElementById('enable-min-delta-t')?.checked || false,
            min_delta_t: parseFloat(document.getElementById('min-delta-t')?.value) || 1e-6,
            n_inner_correctors: parseInt(document.getElementById('n-correctors')?.value) || 2,
            n_non_ortho_correctors: parseInt(document.getElementById('n-non-ortho')?.value) || 0,
            res_p: parseFloat(document.getElementById('res-p')?.value) || 1e-4,
            res_u: parseFloat(document.getElementById('res-u')?.value) || 1e-4,
            div_scheme_u: document.getElementById('div-scheme-u')?.value || 'linearUpwind',
            div_scheme_turb: document.getElementById('div-scheme-turb')?.value || 'upwind',
            ddt_scheme: document.getElementById('ddt-scheme')?.value || 'steadyState'
        };

        // Include schedule if in schedule mode
        if (isSchedule && this.timestepSchedule) {
            settings.time_schedule = this.timestepSchedule.getSchedule();
            settings.delta_t = this.timestepSchedule.getInitialDeltaT();
            settings.adjust_timestep = true; // Schedule always uses adjustTimeStep yes
        }

        return settings;
    }

    /**
     * Restore solver settings UI from saved configuration.
     */
    restoreSolverSettings(config) {
        if (!config) return;

        // Helper to set a select/input value safely
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el && val !== undefined && val !== null) {
                el.value = val;
            }
        };
        const setChecked = (id, val) => {
            const el = document.getElementById(id);
            if (el && val !== undefined) el.checked = !!val;
        };

        // Basic solver settings
        setVal('solver-select', config.solver);
        setVal('turbulence-model', config.turbulence_model);
        setVal('end-time', config.end_time);
        setVal('delta-t', config.delta_t);
        setVal('write-control', config.write_control);
        setVal('write-interval', config.write_interval);
        setVal('purge-write', config.purge_write);

        // Inlet / outlet
        if (Array.isArray(config.inlet_velocity)) {
            setVal('inlet-ux', config.inlet_velocity[0]);
            setVal('inlet-uy', config.inlet_velocity[1]);
            setVal('inlet-uz', config.inlet_velocity[2]);
        }
        setVal('outlet-pressure', config.outlet_pressure);
        setVal('up-direction', config.up_direction || 'z-up');
        setVal('wall-type', config.wall_type);
        setVal('model-surface-type', config.model_surface_type);
        setVal('ref-area', config.ref_area);
        setVal('ref-length', config.ref_length);
        if (config.model_slip_fraction !== undefined) {
            const msfVal = Math.round(config.model_slip_fraction * 100);
            setVal('model-slip-fraction', msfVal);
            const modelSlipValueEl = document.getElementById('model-slip-value');
            if (modelSlipValueEl) modelSlipValueEl.textContent = `${msfVal}%`;
        }
        // Update model surface type visibility
        const modelSlipGroupEl = document.getElementById('model-slip-group');
        if (modelSlipGroupEl) {
            modelSlipGroupEl.style.display = config.model_surface_type === 'partialSlip' ? 'block' : 'none';
        }

        // Parallel
        setChecked('enable-parallel', config.parallel);
        setVal('num-cores', config.num_cores);

        // Relaxation & solver numerics
        setVal('relax-p', config.relax_p);
        setVal('relax-u', config.relax_u);
        setVal('n-correctors', config.n_inner_correctors);
        setVal('n-non-ortho', config.n_non_ortho_correctors);
        setVal('res-p', config.res_p);
        setVal('res-u', config.res_u);
        setVal('div-scheme-u', config.div_scheme_u);
        setVal('div-scheme-turb', config.div_scheme_turb);
        setVal('ddt-scheme', config.ddt_scheme);

        // Adaptive timestep settings
        setChecked('adjust-timestep', config.adjust_timestep);
        setVal('max-co', config.max_co);
        setVal('max-delta-t', config.max_delta_t);
        setChecked('enable-min-delta-t', config.enable_min_delta_t);
        setVal('min-delta-t', config.min_delta_t);
        // Update min-delta-t input disabled state
        const minDtInput = document.getElementById('min-delta-t');
        if (minDtInput) minDtInput.disabled = !config.enable_min_delta_t;

        // Timestep strategy: schedule vs simple
        if (config.time_schedule && config.time_schedule.length > 0) {
            setVal('timestep-strategy', 'schedule');
            this.updateTimestepStrategy();
            // Load segments into the widget
            if (this.timestepSchedule) {
                this.timestepSchedule.setSchedule(config.time_schedule);
            }
        } else {
            setVal('timestep-strategy', 'simple');
            this.updateTimestepStrategy();
        }

        // Trigger solver-dependent UI updates (hides/shows adaptive row for steady-state)
        const solverSelect = document.getElementById('solver-select');
        if (solverSelect) solverSelect.dispatchEvent(new Event('change'));

        // Trigger adjust-timestep change to update max-co visibility
        const adjustTs = document.getElementById('adjust-timestep');
        if (adjustTs) adjustTs.dispatchEvent(new Event('change'));
    }

    updateTimestepStrategy() {
        const strategy = document.getElementById('timestep-strategy')?.value || 'simple';
        const simpleOptions = document.getElementById('simple-timestep-options');
        const scheduleOptions = document.getElementById('schedule-timestep-options');

        if (strategy === 'simple') {
            if (simpleOptions) simpleOptions.style.display = 'block';
            if (scheduleOptions) scheduleOptions.style.display = 'none';
        } else {
            if (simpleOptions) simpleOptions.style.display = 'none';
            if (scheduleOptions) scheduleOptions.style.display = 'block';
            // Create schedule widget if not yet created
            if (!this.timestepSchedule) {
                const container = document.getElementById('wt-timestep-schedule-container');
                if (container) {
                    const endTime = parseFloat(document.getElementById('end-time')?.value || 1000);
                    const defaultDeltaT = parseFloat(document.getElementById('delta-t')?.value || 1e-5);
                    const defaultMaxCo = parseFloat(document.getElementById('max-co')?.value || 0.5);
                    this.timestepSchedule = new TimestepSchedule(container, {
                        endTime: endTime,
                        defaultDeltaT: defaultDeltaT,
                        defaultMaxCo: defaultMaxCo
                    });
                }
            }
        }
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

        // Hide any previous results button
        const simResultsContainer = document.getElementById('sim-results-btn-container');
        if (simResultsContainer) simResultsContainer.style.display = 'none';

        // Reset progress phase and Courant
        const progressStep = document.getElementById('progress-step');
        const progressCourant = document.getElementById('progress-courant');
        if (progressStep) progressStep.textContent = '⚙️ Initializing...';
        if (progressCourant) { progressCourant.style.display = 'none'; progressCourant.textContent = 'Co: --'; }
        const progressDeltaT2 = document.getElementById('progress-delta-t');
        if (progressDeltaT2) { progressDeltaT2.style.display = 'none'; progressDeltaT2.textContent = 'ΔT: --'; }
        this.courantHistory = [];
        this.courantMaxHistory = [];
        this._lastProgressPct = 0;       // Reset so new sim bar starts from 0
        this._highestSeenSimTime = 0;    // Reset high-water mark for Time= parser


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
            const line = data.line;

            // === Progress Phase Detection ===
            const progressStep = document.getElementById('progress-step');
            if (progressStep) {
                if (line.includes('[WORKFLOW] Applying settings') || line.includes('[SETTINGS]')) {
                    progressStep.textContent = '⚙️ Configuring...';
                } else if (line.includes('[SOLVER] Decomposing') || line.includes('[DECOMPOSE] Running')) {
                    progressStep.textContent = '📦 Decomposing...';
                } else if (line.match(/Compiling.*\.C/i) || line.includes('wmake')) {
                    progressStep.textContent = '🔨 Compiling...';
                } else if (line.includes('[SOLVER] Running') || line.match(/^Time = /)) {
                    progressStep.textContent = '🔄 Solving...';
                } else if (line.includes('[SOLVER] Reconstructing') || line.includes('[RECONSTRUCT]')) {
                    progressStep.textContent = '📦 Reconstructing...';
                } else if (line.includes('[ANALYSIS]')) {
                    progressStep.textContent = '📊 Analyzing...';
                } else if (line.includes('failed') || line.includes('ERROR')) {
                    progressStep.textContent = '❌ Error';
                }
            }

            // === Courant Number Parsing ===
            // OpenFOAM prints: "Courant Number mean: 0.123 max: 0.456"
            const coMatch = line.match(/Courant Number mean:\s*([\d.e+-]+)\s*max:\s*([\d.e+-]+)/);
            if (coMatch) {
                const coMean = parseFloat(coMatch[1]);
                const coMax = parseFloat(coMatch[2]);
                this.courantHistory.push(coMean);
                this.courantMaxHistory.push(coMax);
                if (this.courantHistory.length > this.courantWindowSize) {
                    this.courantHistory.shift();
                    this.courantMaxHistory.shift();
                }
                // Calculate rolling averages
                const avgMean = this.courantHistory.reduce((a, b) => a + b, 0) / this.courantHistory.length;
                const avgMax = this.courantMaxHistory.reduce((a, b) => a + b, 0) / this.courantMaxHistory.length;
                const courantEl = document.getElementById('progress-courant');
                if (courantEl) {
                    courantEl.style.display = '';
                    courantEl.textContent = `Co: ${avgMean.toFixed(3)} / ${avgMax.toFixed(3)}`;
                    // Color code: green < 0.5, yellow < 1.0, red >= 1.0
                    if (avgMax >= 1.0) {
                        courantEl.style.color = 'var(--error, #ff4444)';
                    } else if (avgMax >= 0.5) {
                        courantEl.style.color = 'var(--warning, #ffaa00)';
                    } else {
                        courantEl.style.color = 'var(--success, #44ff44)';
                    }
                }
            }

            // === DeltaT Parsing ===
            // OpenFOAM prints: "deltaT = 1.234e-05"
            const dtMatch = line.match(/deltaT = ([\d.e+-]+)/);
            if (dtMatch) {
                const dt = parseFloat(dtMatch[1]);
                const dtEl = document.getElementById('progress-delta-t');
                if (dtEl) {
                    dtEl.style.display = '';
                    dtEl.textContent = `ΔT: ${dt.toExponential(2)}`;
                }
            }

            // === Simulation Time Parsing ===
            // IMPORTANT: Anchored to start of line so 'ExecutionTime = 0.45' is NOT matched.
            const timeMatch = line.match(/^Time = ([\d.eE+\-]+)/);
            if (timeMatch) {
                const simTime = parseFloat(timeMatch[1]);
                // Guard against non-finite or negative time values (skip if bad)
                if (!isFinite(simTime) || simTime < 0) return;

                // ── Monotonic high-water mark ──────────────────────────────────────────
                // If this Time value is LESS than the highest we've ever seen, it came
                // from a replayed log (out-of-order). Skip silently.
                if (simTime < (this._highestSeenSimTime || 0)) return;
                this._highestSeenSimTime = simTime;
                // ──────────────────────────────────────────────────────────────────────

                this.currentSimTime = simTime;
                const now = Date.now();
                if (!this.lastUiUpdate || now - this.lastUiUpdate > 300) {
                    this.lastUiUpdate = now;

                    // Parse end time from input - if the run's config hasn't loaded, use stored value
                    const endTimeRaw = parseFloat(document.getElementById('end-time')?.value);
                    const endTime = isFinite(endTimeRaw) && endTimeRaw > 0 ? endTimeRaw
                        : (this._lastKnownEndTime || null);

                    if (endTime && endTime > 0) {
                        this._lastKnownEndTime = endTime;
                        const percent = Math.min(100, Math.max(0, (simTime / endTime) * 100));

                        document.getElementById('progress-iter').textContent = `SimTime: ${simTime.toFixed(4)} / ${endTime}`;
                        // Monotonically increasing — only move bar forward
                        if (percent >= (this._lastProgressPct || 0)) {
                            this._lastProgressPct = percent;
                            document.getElementById('progress-fill').style.width = `${percent}%`;
                        }

                        // Calculate ETA based on elapsed real time and simulation progress
                        if (this.simStartTime && percent > 0.1) {
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
                    } else {
                        // No endTime known — at least show the time counter
                        document.getElementById('progress-iter').textContent = `SimTime: ${simTime.toFixed(4)}`;
                    }
                }
            }

        });

        // Track last shown progress so the bar only ever moves forward
        this._lastProgressPct = this._lastProgressPct || 0;

        this.ws.onProgress((data) => {
            const stepText = document.getElementById('progress-step')?.textContent || '';
            const isSolving = stepText.includes('Solving');

            if (data.progress !== undefined && !isSolving) {
                const pct = parseFloat(data.progress);
                // Monotonically increasing: only advance, never go back
                if (!isNaN(pct) && pct >= this._lastProgressPct) {
                    this._lastProgressPct = pct;
                    document.getElementById('progress-fill').style.width = `${pct}%`;
                }
                // lower values are silently ignored
            }
            if (data.iteration !== undefined && !isSolving) {
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
            const stepEl = document.getElementById('progress-step');
            if (stepEl) stepEl.textContent = '✅ Complete';
            this.loadRuns();

            // Show View Results button
            const resultsContainer = document.getElementById('sim-results-btn-container');
            if (resultsContainer) resultsContainer.style.display = 'block';

            // Send desktop/mobile notification
            this.sendNotification('✅ Simulation Complete', data.message || `Run finished successfully.`);
        });

        this.ws.onError((data) => {
            this.addLog(`Error: ${data.message}`, 'error');
            clearInterval(this.progressTimer);
            this.simStartTime = null;
            document.getElementById('run-simulation-btn').disabled = false;
            document.getElementById('stop-simulation-btn').disabled = true;
            const errStepEl = document.getElementById('progress-step');
            if (errStepEl) errStepEl.textContent = '❌ Error';

            // Send desktop/mobile notification
            this.sendNotification('❌ Simulation Error', data.message || 'A simulation encountered an error.');
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

        // Setup playback speed slider with linear slomo/timelapse scale
        this.setupPlaybackSpeedSlider();

        // Calculation function
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
            const endTime = parseFloat(document.getElementById('pv-end-time').value) || 1000;
            const timesteps = parseFloat(document.getElementById('pv-write-interval').value) || 100;

            // Video duration = simulation duration / playback speed
            const videoDuration = endTime / speed;
            const totalFrames = Math.ceil(videoDuration * fps);
            const resampleFactor = Math.max(1, Math.ceil(totalFrames / timesteps));

            document.getElementById('result-timesteps').textContent = timesteps;
            document.getElementById('result-duration').textContent = `${videoDuration.toFixed(1)}s`;
            document.getElementById('result-frames').textContent = totalFrames;
            document.getElementById('result-resample').textContent = `${resampleFactor}x`;

            document.getElementById('pv-results').style.display = 'block';
        };

        // Button click still works
        calcBtn.addEventListener('click', calculate);

        // Auto-recalculate on any input change
        ['target-fps', 'playback-speed', 'pv-end-time', 'pv-write-interval'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', calculate);
        });

        // Copy path button
        const copyBtn = document.getElementById('pv-copy-path-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const foamPath = document.getElementById('pv-foam-path').textContent;
                if (foamPath && foamPath !== '-') {
                    navigator.clipboard.writeText(foamPath);
                    copyBtn.textContent = '\u2713 Copied!';
                    setTimeout(() => copyBtn.textContent = '\ud83d\udccb Copy Path', 1500);
                }
            });
        }
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

        // Helper: convert slider value to playback speed
        const valueToSpeed = (val) => {
            if (val === 0) return 1;
            if (val < 0) return 1 / Math.abs(val);  // Slomo: -8 = 1/8x speed
            return val;  // Timelapse: 8 = 8x speed
        };

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

    /**
     * Update ParaView Helper tab with data from the currently selected run
     */
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

            // Show timestep analysis if we have timesteps
            if (data.count > 0 && timestepInfo) {
                timestepInfo.style.display = 'block';

                document.getElementById('pv-timestep-count').textContent = data.count;
                document.getElementById('pv-time-range').textContent =
                    `${data.min_time.toFixed(4)}s → ${data.max_time.toFixed(4)}s`;
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
Model Surface: ${settings.model_surface_type}
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

        // Re-sync solver-dependent UI after defaults change the solver dropdown
        const solverEl = document.getElementById('solver-select');
        if (solverEl) solverEl.dispatchEvent(new Event('change'));
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

        // Debounce helper for inputs that trigger API calls
        const debounce = (fn, ms) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };
        const autoRefresh = debounce(() => this.loadPerformanceData(false), 600);

        // Mode selector — always re-fetch, all modes supported live
        if (modeSelect) {
            modeSelect.addEventListener('change', () => {
                const mode = modeSelect.value;

                // Show/hide time window controls
                if (timeWindowControls) {
                    timeWindowControls.style.display = mode === 'window' ? 'flex' : 'none';
                }

                // Show/hide exclude fraction (only for average mode)
                if (excludeGroup) {
                    excludeGroup.style.display = (mode === 'average') ? 'block' : 'none';
                }

                // Always re-fetch — every mode change should update the data
                this.loadPerformanceData(false);
            });

            // Initialize visibility based on current mode
            const initialMode = modeSelect.value;
            if (timeWindowControls) {
                timeWindowControls.style.display = initialMode === 'window' ? 'flex' : 'none';
            }
            if (excludeGroup) {
                excludeGroup.style.display = (initialMode === 'average') ? 'block' : 'none';
            }
        }

        // Exclude fraction input — debounced auto-refresh
        const excludeInput = document.getElementById('analysis-exclude-fraction');
        if (excludeInput) {
            excludeInput.addEventListener('input', autoRefresh);
            excludeInput.addEventListener('change', () => this.loadPerformanceData(false));
        }

        // Custom time window inputs — debounced auto-refresh
        const startTimeInput = document.getElementById('analysis-start-time');
        const endTimeInput = document.getElementById('analysis-end-time');
        if (startTimeInput) {
            startTimeInput.addEventListener('change', () => {
                if (modeSelect?.value === 'window') this.loadPerformanceData(false);
            });
        }
        if (endTimeInput) {
            endTimeInput.addEventListener('change', () => {
                if (modeSelect?.value === 'window') this.loadPerformanceData(false);
            });
        }

        // Time window sliders — debounced auto-refresh on release (mouseup/touchend)
        const startSliderEl = document.getElementById('analysis-start-time-slider');
        const endSliderEl = document.getElementById('analysis-end-time-slider');
        const sliderRefresh = debounce(() => {
            if (modeSelect?.value === 'window') this.loadPerformanceData(false);
        }, 400);
        if (startSliderEl) startSliderEl.addEventListener('input', sliderRefresh);
        if (endSliderEl) endSliderEl.addEventListener('input', sliderRefresh);

        // Setup dual-handle range slider (visual only — no refresh logic inside)
        this.setupTimeRangeSlider();

        // Attach display settings listeners immediately (static HTML, always available)
        if (typeof UnitFormatter !== 'undefined') {
            UnitFormatter.attachSettingsListeners('wt-', () => {
                // Re-render with cached data if available
                if (this.cachedPerformanceData) {
                    this.renderPerformanceData(this.cachedPerformanceData);
                }
            });
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

        // Store simulation time range
        this.simTimeMin = 0;
        this.simTimeMax = 1000;

        const updateDisplay = () => {
            const startPct = parseFloat(startSlider.value);
            const endPct = parseFloat(endSlider.value);

            const range = this.simTimeMax - this.simTimeMin;
            const startTime = this.simTimeMin + (startPct / 100) * range;
            const endTime = this.simTimeMin + (endPct / 100) * range;

            if (display) {
                display.textContent = `${startTime.toFixed(3)}s - ${endTime.toFixed(3)}s`;
            }

            if (fill) {
                fill.style.left = `${startPct}%`;
                fill.style.right = `${100 - endPct}%`;
            }

            if (startInput) startInput.value = startTime.toFixed(4);
            if (endInput) endInput.value = endTime.toFixed(4);
        };

        startSlider.style.pointerEvents = 'auto';
        endSlider.style.pointerEvents = 'auto';

        // ── Hover-based z-index ─────────────────────────────────────────────────
        // We update which slider is on top during MOUSEMOVE (hover), not mousedown.
        // This means by the time the user actually clicks, the correct slider thumb
        // is already on top, so the browser's native snap always goes to the right handle.
        // A drag-lock prevents the z-index from switching mid-drag.
        let _sliderDragging = false;
        const sliderContainer = startSlider.parentElement;

        const pickCloserSlider = (clientX) => {
            const rect = sliderContainer.getBoundingClientRect();
            const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
            const distStart = Math.abs(pct - parseFloat(startSlider.value));
            const distEnd = Math.abs(pct - parseFloat(endSlider.value));
            if (distStart <= distEnd) {
                startSlider.style.zIndex = '4';
                endSlider.style.zIndex = '2';
            } else {
                endSlider.style.zIndex = '4';
                startSlider.style.zIndex = '2';
            }
        };

        if (sliderContainer) {
            // Set z-index on every hover movement (before any click)
            sliderContainer.addEventListener('mousemove', e => {
                if (!_sliderDragging) pickCloserSlider(e.clientX);
            });
            // Lock z-index during drag so it doesn't switch mid-drag
            sliderContainer.addEventListener('mousedown', () => { _sliderDragging = true; });
        }
        // Release drag lock on mouseup anywhere on the page
        document.addEventListener('mouseup', () => { _sliderDragging = false; });

        startSlider.addEventListener('input', () => {
            if (parseFloat(startSlider.value) > parseFloat(endSlider.value)) {
                startSlider.value = endSlider.value;
            }
            updateDisplay();
        });

        endSlider.addEventListener('input', () => {
            if (parseFloat(endSlider.value) < parseFloat(startSlider.value)) {
                endSlider.value = startSlider.value;
            }
            updateDisplay();
        });

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

        this.updateTimeRangeSlider = (minTime, maxTime) => {
            this.simTimeMin = minTime;
            this.simTimeMax = maxTime;

            if (minLabel) minLabel.textContent = `${minTime.toFixed(3)}s`;
            if (maxLabel) maxLabel.textContent = `${maxTime.toFixed(3)}s`;

            startSlider.value = 0;
            endSlider.value = 100;

            if (startInput) startInput.value = minTime.toFixed(4);
            if (endInput) endInput.value = maxTime.toFixed(4);

            updateDisplay();
        };

        updateDisplay();
    }

    // Separate render function for re-formatting without API call
    renderPerformanceData(data) {
        const dataDiv = document.getElementById('performance-data');
        const emptyDiv = document.getElementById('performance-empty');
        const errorDiv = document.getElementById('performance-error');
        const timeInfo = document.getElementById('analysis-time-info');

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

            // ================================================================
            // Read current UI settings — these always take priority over cache
            // ================================================================
            const refArea = parseFloat(document.getElementById('ref-area')?.value) || 1.0;
            const refLength = parseFloat(document.getElementById('ref-length')?.value) || 1.0;
            const upDir = document.getElementById('up-direction')?.value || 'z-up';
            // Read inlet velocity vector and compute total speed magnitude
            const ux = parseFloat(document.getElementById('inlet-ux')?.value) || 0;
            const uy = parseFloat(document.getElementById('inlet-uy')?.value) || 0;
            const uz = parseFloat(document.getElementById('inlet-uz')?.value) || 0;
            const U = Math.sqrt(ux * ux + uy * uy + uz * uz) || 10.0;
            const rho = parseFloat(document.getElementById('density')?.value) || 1.225;

            // ================================================================
            // Build wind unit vector and orthogonal lift/side unit vectors
            // These are derived from the actual inlet velocity, so -X wind
            // is handled correctly via dot-product projection.
            // ================================================================
            const axisNames = ['X', 'Y', 'Z'];

            // Wind unit vector (direction wind is flowing, not coming from)
            const windVec = [ux, uy, uz];
            const windMag = U || 1.0;  // U already = |windVec|
            const windHat = windVec.map(v => v / windMag);  // unit vector

            // Determine up unit vector from setting
            let upHat;
            if (upDir === 'y-up') {
                upHat = [0, 1, 0];
            } else {
                upHat = [0, 0, 1];  // z-up default
            }

            // Side = windHat × upHat  (right-hand rule perpendicular to both)
            const crossProduct = (a, b) => [
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0]
            ];
            const normalize = v => { const m = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2); return m > 0 ? v.map(x => x / m) : v; };
            const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

            const sideHat = normalize(crossProduct(windHat, upHat));
            // Recompute true lift axis orthogonal to both wind and side
            const liftHat = normalize(crossProduct(sideHat, windHat));

            // Human-readable axis labels (which axis is most aligned with each)
            const dominantAxis = hat => ['X', 'Y', 'Z'][hat.reduce((mi, v, i, a) => Math.abs(v) > Math.abs(a[mi]) ? i : mi, 0)];
            const signedLabel = hat => {
                const idx = hat.reduce((mi, v, i, a) => Math.abs(v) > Math.abs(a[mi]) ? i : mi, 0);
                return (hat[idx] < 0 ? '-' : '') + ['X', 'Y', 'Z'][idx];
            };

            const dragLabel = signedLabel(windHat);
            const liftLabel = signedLabel(liftHat);
            const sideLabel = signedLabel(sideHat);

            // ================================================================
            // Extract raw forces from backend data
            // ================================================================
            const fx = metrics.fx ?? 0;
            const fy = metrics.fy ?? 0;
            const fz = metrics.fz ?? 0;
            const mx = metrics.mx ?? 0;
            const my = metrics.my ?? 0;
            const mz = metrics.mz ?? 0;
            const forceVec = [fx, fy, fz];

            // Project forces onto each physical axis via dot product
            // This correctly handles any wind direction including -X
            const dragForce = dot(forceVec, windHat);   // along wind direction
            const liftForce = dot(forceVec, liftHat);   // along up direction
            const sideForce = dot(forceVec, sideHat);   // lateral

            // ================================================================
            // Compute coefficients using UI values (always fresh)
            // ================================================================
            const q = 0.5 * rho * U * U;
            const denominator = q * refArea;
            const cd = denominator > 0 ? dragForce / denominator : 0;
            const cl = denominator > 0 ? liftForce / denominator : 0;
            const cs = denominator > 0 ? sideForce / denominator : 0;
            const ld = Math.abs(cd) > 1e-10 ? cl / cd : 0;

            // ================================================================
            // Helper: format a value
            // ================================================================
            const fmtForce = (v) => {
                if (v === undefined || v === null || isNaN(v)) return '—';
                if (fmt) return fmt.formatForce(v);
                const abs = Math.abs(v);
                if (abs === 0) return '0 N';
                if (abs < 0.001) return `${(v * 1e6).toFixed(2)} μN`;
                if (abs < 1) return `${(v * 1e3).toFixed(3)} mN`;
                if (abs >= 1000) return `${(v / 1e3).toFixed(3)} kN`;
                return `${v.toFixed(4)} N`;
            };
            const fmtCoeff = (v) => {
                if (v === undefined || v === null || isNaN(v)) return '—';
                return v.toFixed(5);
            };
            const fmtRatio = (v) => {
                if (v === undefined || v === null || isNaN(v)) return '—';
                return v.toFixed(4);
            };
            const setText = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.textContent = text;
            };

            // ================================================================
            // Update Settings Banner
            // ================================================================
            setText('perf-banner-wind', `${dragLabel} axis  (Ux=${ux}, Uy=${uy}, Uz=${uz})`);
            setText('perf-banner-up', `${upDir === 'y-up' ? '+Y' : '+Z'} axis`);
            setText('perf-banner-area', `${refArea.toFixed(6)} m²`);
            setText('perf-banner-len', `${refLength.toFixed(4)} m`);

            // ================================================================
            // Update Axis Labels on force rows
            // ================================================================
            setText('perf-drag-label', `Drag Force (F along ${dragLabel})`);
            setText('perf-lift-label', `Lift Force (F along ${liftLabel})`);
            setText('perf-side-label', `Side Force (F along ${sideLabel})`);
            setText('perf-axes-note', `— Wind: ${dragLabel}, Up: ${liftLabel}, Side: ${sideLabel}`);

            // ================================================================
            // Coefficients
            // ================================================================
            setText('perf-cd', fmtCoeff(cd));
            setText('perf-cl', fmtCoeff(cl));
            setText('perf-cs', fmtCoeff(cs));
            setText('perf-ld', fmtRatio(ld));

            // ================================================================
            // Aero Forces (axis-mapped)
            // ================================================================
            setText('perf-drag', fmtForce(dragForce));
            setText('perf-lift', fmtForce(liftForce));
            setText('perf-side', fmtForce(sideForce));

            // ================================================================
            // Raw force components (OpenFOAM axes Fx/Fy/Fz)
            // ================================================================
            setText('perf-fx', fmtForce(fx));
            setText('perf-fy', fmtForce(fy));
            setText('perf-fz', fmtForce(fz));
            setText('perf-mx', fmtForce(mx));
            setText('perf-my', fmtForce(my));
            setText('perf-mz', fmtForce(mz));

            // ================================================================
            // Time range info
            // ================================================================
            if (timeInfo && metrics.t_start !== undefined) {
                const iterations = metrics.iterations_analyzed || 'N/A';
                timeInfo.textContent = `Analysis range: ${metrics.t_start?.toFixed(4)}s–${metrics.t_end?.toFixed(4)}s (${iterations} samples)`;
            }

            const rawEl = document.getElementById('perf-raw');
            if (rawEl) {
                rawEl.textContent = JSON.stringify({
                    _computed: { refArea, refLength, U, rho, q, cd, cl, cs, ld, dragLabel, liftLabel, sideLabel },
                    ...data
                }, null, 2);
            }
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
        if (timeInfo) timeInfo.textContent = '';

        try {
            let data;

            // Get analysis mode settings
            const mode = document.getElementById('analysis-mode')?.value || 'saved';
            const excludeFraction = parseFloat(document.getElementById('analysis-exclude-fraction')?.value || 20) / 100;
            const timeStart = parseFloat(document.getElementById('analysis-start-time')?.value || 0);
            const timeEnd = parseFloat(document.getElementById('analysis-end-time')?.value || 1);

            const refArea = parseFloat(document.getElementById('ref-area')?.value) || null;
            const refLength = parseFloat(document.getElementById('ref-length')?.value) || null;

            if (forceRefresh && mode === 'saved') {
                // Only rerun full analysis when explicitly refreshing in 'saved' mode
                // (this updates the cache on disk)
                data = await API.triggerAnalysis(this.currentRunId);
            } else {
                // For all other modes (or non-forced refresh), use the current
                // mode/window settings — this respects custom time windows, averages, etc.
                data = await API.getPerformance(this.currentRunId, mode, excludeFraction, timeStart, timeEnd, refArea, refLength);
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

            // Also load convergence data in parallel
            this.loadConvergenceData();

        } catch (e) {
            if (loading) loading.style.display = 'none';
            if (errorDiv) {
                errorDiv.textContent = `Error loading data: ${e.message}`;
                errorDiv.style.display = 'block';
            }
        }
    }


    // ==================== Convergence / Solution Quality ====================

    async loadConvergenceData() {
        if (!this.currentRunId) return;
        try {
            const data = await API.getConvergence(this.currentRunId);
            if (data && data.status === 'ok') {
                this.renderConvergenceData(data);
            }
        } catch (e) {
            console.log('Convergence data not available:', e.message);
        }
    }

    renderConvergenceData(data) {
        const card = document.getElementById('convergence-card');
        if (!card) return;
        card.style.display = 'block';

        const setText = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        // --- Convergence badge ---
        const badge = document.getElementById('convergence-badge');
        if (badge) {
            if (data.converged) {
                badge.textContent = '✅ Converged';
                badge.style.background = 'rgba(34, 197, 94, 0.15)';
                badge.style.color = '#22c55e';
            } else {
                // Check if partially converged (some fields low)
                const fields = Object.values(data.fields || {});
                const lowCount = fields.filter(f => f.final < 1e-3).length;
                if (lowCount > fields.length / 2) {
                    badge.textContent = '⚠️ Partially Converged';
                    badge.style.background = 'rgba(234, 179, 8, 0.15)';
                    badge.style.color = '#eab308';
                } else {
                    badge.textContent = '❌ Not Converged';
                    badge.style.background = 'rgba(239, 68, 68, 0.15)';
                    badge.style.color = '#ef4444';
                }
            }
        }
        setText('convergence-message',
            `${data.convergence_message || ''} — ${data.total_iterations} iterations (${data.solver || 'unknown'})`);

        // --- Residual table ---
        const tbody = document.getElementById('residual-table-body');
        if (tbody && data.fields) {
            tbody.innerHTML = '';
            // Order fields: Ux, Uy, Uz, p, then turbulence
            const fieldOrder = ['Ux', 'Uy', 'Uz', 'p', 'k', 'omega', 'epsilon', 'nuTilda'];
            const sortedFields = Object.keys(data.fields)
                .sort((a, b) => {
                    const ai = fieldOrder.indexOf(a);
                    const bi = fieldOrder.indexOf(b);
                    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                });

            for (const field of sortedFields) {
                const info = data.fields[field];
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid var(--border-color)';

                // Status icon and color based on final residual
                let statusIcon, statusColor;
                if (info.final < 1e-5) {
                    statusIcon = '🟢'; statusColor = '#22c55e';
                } else if (info.final < 1e-3) {
                    statusIcon = '🟡'; statusColor = '#eab308';
                } else {
                    statusIcon = '🔴'; statusColor = '#ef4444';
                }

                const fmtSci = (v) => {
                    if (v === 0) return '0';
                    return v.toExponential(2);
                };

                tr.innerHTML = `
                    <td style="padding: 6px 8px; font-weight: 500;">${field}</td>
                    <td style="padding: 6px 8px; text-align: right; font-family: monospace;">${fmtSci(info.initial)}</td>
                    <td style="padding: 6px 8px; text-align: right; font-family: monospace; color: ${statusColor};">${fmtSci(info.final)}</td>
                    <td style="padding: 6px 8px; text-align: right; font-weight: 600;">${info.orders_dropped > 0 ? info.orders_dropped.toFixed(1) : '—'}</td>
                    <td style="padding: 6px 8px; text-align: center;">${statusIcon}</td>
                `;
                tbody.appendChild(tr);
            }
        }

        // --- Continuity ---
        const cont = data.continuity_error || {};
        const fmtSci = (v) => v !== null && v !== undefined ? v.toExponential(3) : '—';
        setText('conv-cont-local', fmtSci(cont.final_local));
        setText('conv-cont-global', fmtSci(cont.final_global));

        // --- Force stability ---
        const fs = data.force_stability || {};
        const cdStd = fs.cd?.std;
        const clStd = fs.cl?.std;
        setText('conv-cd-std', cdStd !== undefined ? cdStd.toExponential(3) : '—');
        setText('conv-cl-std', clStd !== undefined ? clStd.toExponential(3) : '—');
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
const app = new App();
