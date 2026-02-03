/**
 * OpenFOAM GUI - Landing Page Status Monitor
 * Polls for running simulations and displays status cards for each
 * Optimized: Only updates dynamic content (logs/progress) without rebuilding DOM
 */

let currentRuns = {};  // Track all running simulations
let pollInterval = null;
let collapsedStates = {};  // Remember collapsed state per run
let lastRunIds = [];  // Track run IDs to detect structure changes

async function checkStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();

        const container = document.getElementById('simulations-container');
        const readyBar = document.getElementById('ready-bar');

        if (data.active && data.runs.length > 0) {
            // Hide ready bar, show simulations
            readyBar.style.display = 'none';

            // Check if we need to rebuild the structure (runs added/removed)
            const newRunIds = data.runs.map(r => r.run_id).sort().join(',');
            const oldRunIds = lastRunIds.sort().join(',');

            if (newRunIds !== oldRunIds) {
                // Structure changed - rebuild cards
                renderSimulationCards(container, data.runs);
                lastRunIds = data.runs.map(r => r.run_id);
                updateContainerPadding(data.runs.length);
            }

            // Always update dynamic content (logs, progress, ETA)
            updateDynamicContent(data.runs);

        } else {
            // No simulations running - clear container IMMEDIATELY and show ready bar
            container.innerHTML = '';
            lastRunIds = [];
            currentRuns = {};
            readyBar.style.display = 'flex';
            document.querySelector('.container').style.paddingTop = '80px';
        }
    } catch (error) {
        console.error('Status check failed:', error);
    }
}

function renderSimulationCards(container, runs) {
    // Build HTML for all cards (only called when structure changes)
    let cardsHtml = '';

    runs.forEach((run) => {
        const runId = run.run_id;
        const route = run.route || `/${run.type}/`;  // Fall back to type-based route
        const isCollapsed = collapsedStates[runId] || false;
        const typeClass = run.type === 'propeller' ? 'propeller' : 'windtunnel';

        // Use custom module name and icon from registry, with fallback
        const moduleIcon = run.module_icon || (run.type === 'propeller' ? '🔄' : '🌬️');
        const moduleName = run.module_name || (run.type === 'propeller' ? 'Propeller' : 'Wind Tunnel');

        cardsHtml += `
            <div class="sim-card ${typeClass} ${isCollapsed ? 'collapsed' : ''}" data-run-id="${runId}" data-type="${run.type}" data-route="${route}">
                <div class="sim-card-header" onclick="toggleCollapse('${runId}')">
                    <button class="collapse-btn">${isCollapsed ? '▶' : '▼'}</button>
                    <span class="sim-type">${moduleIcon} ${moduleName}</span>
                    <span class="sim-name">${run.run_name || runId}</span>
                    <span class="sim-indicator">Running</span>
                    <span class="sim-progress" id="progress-${runId}"></span>
                    <span class="sim-eta" id="eta-${runId}">ETA: calculating...</span>
                    <div class="sim-actions" onclick="event.stopPropagation()">
                        <button class="sim-view-btn" onclick="viewSimulation('${route}', '${runId}')">👁 View</button>
                        <button class="sim-stop-btn" id="stop-${runId}" onclick="stopSimulation('${route}', '${runId}', this)">⏹ Stop</button>
                    </div>
                </div>
                <div class="sim-card-body">
                    <div class="sim-logs" id="logs-${runId}">
                        <div class="log-line">Waiting for output...</div>
                    </div>
                </div>
            </div>
        `;

        currentRuns[runId] = run;
    });

    container.innerHTML = cardsHtml;
}

function updateDynamicContent(runs) {
    // Update only the dynamic elements without rebuilding DOM
    runs.forEach((run) => {
        const runId = run.run_id;
        currentRuns[runId] = run;

        // Update progress
        const progressEl = document.getElementById(`progress-${runId}`);
        if (progressEl) {
            const progress = run.progress || 0;
            progressEl.textContent = progress > 0 ? `${progress.toFixed(1)}%` : '';
        }

        // Update ETA
        const etaEl = document.getElementById(`eta-${runId}`);
        if (etaEl) {
            let etaText = 'calculating...';
            if (run.eta_seconds !== null && run.eta_seconds !== undefined) {
                etaText = formatDuration(run.eta_seconds);
            } else if (run.progress > 0) {
                etaText = `${run.progress.toFixed(1)}%`;
            }
            etaEl.textContent = `ETA: ${etaText}`;
        }

        // Update logs
        const logsEl = document.getElementById(`logs-${runId}`);
        if (logsEl) {
            const logs = run.recent_logs || [];
            if (logs.length > 0) {
                const logsHtml = logs.slice(-3).map(line => `<div class="log-line">${escapeHtml(line)}</div>`).join('');
                logsEl.innerHTML = logsHtml;
            }
        }
    });
}

function toggleCollapse(runId) {
    collapsedStates[runId] = !collapsedStates[runId];
    const card = document.querySelector(`.sim-card[data-run-id="${runId}"]`);
    if (card) {
        card.classList.toggle('collapsed');
        const btn = card.querySelector('.collapse-btn');
        btn.textContent = collapsedStates[runId] ? '▶' : '▼';
        updateContainerPadding(Object.keys(currentRuns).length);
    }
}

function updateContainerPadding(numRuns) {
    // Estimate height needed based on number of cards
    const baseHeight = 80;  // Ready bar height
    const cardHeight = 85;  // Approximate height of one collapsed card header
    const expandedExtra = 60;  // Extra height for expanded logs

    let totalHeight = 0;
    Object.keys(currentRuns).forEach(runId => {
        totalHeight += cardHeight;
        if (!collapsedStates[runId]) {
            totalHeight += expandedExtra;
        }
    });

    document.querySelector('.container').style.paddingTop = `${Math.max(baseHeight, totalHeight + 20)}px`;
}

function formatDuration(seconds) {
    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins}m ${secs}s`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${mins}m`;
    }
}

function viewSimulation(route, runId) {
    // Navigate to the appropriate sub-app with run_id to auto-select and tab to switch to solver
    // Route is the full route like "/windtunnel/" or "/wind_tunnel_1/"
    window.location.href = `${route}?run_id=${runId}&tab=solver`;
}

async function stopSimulation(route, runId, buttonEl) {
    if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.textContent = 'Stopping...';
    }

    try {
        // Call sub-app stop endpoint directly using the module's route
        // Route is like "/windtunnel/" or "/wind_tunnel_1/"
        const targetUrl = `${route}api/run/${runId}/stop`;

        console.log('Stopping simulation:', targetUrl);
        const response = await fetch(targetUrl, { method: 'POST' });
        const data = await response.json();
        console.log('Stop response:', data);

        if (data.success) {
            // Force structure rebuild on next poll
            lastRunIds = [];
            setTimeout(checkStatus, 500);
        } else {
            console.error('Stop failed:', data.error);
            alert('Stop failed: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Stop request failed:', error);
        alert('Stop request failed: ' + error.message);
    } finally {
        if (buttonEl) {
            buttonEl.disabled = false;
            buttonEl.textContent = '⏹ Stop';
        }
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Start polling when page loads
document.addEventListener('DOMContentLoaded', () => {
    checkStatus();
    pollInterval = setInterval(checkStatus, 250);  // Poll every 250ms for smooth data updates
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (pollInterval) {
        clearInterval(pollInterval);
    }
});
