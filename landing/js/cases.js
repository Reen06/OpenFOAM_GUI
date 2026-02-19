/**
 * OpenFOAM GUI - Case Management
 * Handles loading, displaying, importing, exporting, and deleting cases
 */

let casesData = [];
let pendingDeleteId = null;
let pendingErrorCaseId = null;

// Load cases on page load
document.addEventListener('DOMContentLoaded', () => {
    loadCases();
});

async function loadCases() {
    const grid = document.getElementById('tools-grid');

    try {
        const response = await fetch('/api/cases');
        const data = await response.json();

        if (data.success && data.cases) {
            casesData = data.cases;
            currentCases = data.cases;  // Store for drag-drop reordering
            renderCases(data.cases);
        } else {
            grid.innerHTML = '<div class="error-state">Failed to load cases</div>';
        }
    } catch (error) {
        console.error('Failed to load cases:', error);
        grid.innerHTML = '<div class="error-state">Failed to load cases: ' + error.message + '</div>';
    }
}

function renderCases(cases) {
    const grid = document.getElementById('tools-grid');
    let html = '';

    // Render each case card
    cases.forEach((caseData, index) => {
        const isInvalid = caseData.status === 'invalid';
        const invalidClass = isInvalid ? 'invalid-case' : '';
        const route = caseData.route || `/${caseData.id}/`;

        html += `
            <div class="tool-card ${invalidClass}" 
                 data-case-id="${caseData.id}" 
                 data-index="${index}"
                 data-route="${route}"
                 draggable="true"
                 onclick="navigateToModule(event, '${route}', ${isInvalid})"
                 ondragstart="handleDragStart(event)"
                 ondragover="handleDragOver(event)"
                 ondragenter="handleDragEnter(event)"
                 ondragleave="handleDragLeave(event)"
                 ondrop="handleDrop(event)"
                 ondragend="handleDragEnd(event)">
                ${isInvalid ? '<span class="broken-badge">⚠️ Invalid</span>' : ''}
                <div class="drag-handle" title="Drag to reorder">⋮⋮</div>
                <div class="tool-icon">${caseData.icon || '📦'}</div>
                <div class="tool-info">
                    <h2>${escapeHtml(caseData.name)}</h2>
                    <p>${escapeHtml(caseData.description || '')}</p>
                </div>
                <div class="tool-features">
                    ${(caseData.features || []).map(f => `<span class="feature">${escapeHtml(f)}</span>`).join('')}
                </div>
                <div class="case-actions" onclick="event.stopPropagation()">
                    <button class="action-btn secondary" onclick="openEditModal('${caseData.id}')" title="Edit">✏️</button>
                    <button class="action-btn secondary" onclick="exportCase('${caseData.id}')" title="Export">📤</button>
                    <button class="action-btn danger" onclick="showDeleteConfirm('${caseData.id}', '${escapeHtml(caseData.name)}')" title="Delete">🗑️</button>
                </div>
            </div>
        `;
    });

    // Add the "Edit Cases" management card
    html += `
        <div class="tool-card edit-cases-card">
            <div class="tool-icon">📦</div>
            <div class="tool-info">
                <h2>Manage Cases</h2>
                <p>Import, export, or delete simulation case setups.</p>
            </div>
            <div class="tool-features">
                <span class="feature">Import</span>
                <span class="feature">Export</span>
                <span class="feature">Delete</span>
            </div>
            <div class="case-actions">
                <button class="action-btn primary" onclick="openImportModal()">📥 Import Case</button>
            </div>
        </div>
    `;

    grid.innerHTML = html;
}

// ============================================================================
// Import Case
// ============================================================================

function openImportModal() {
    document.getElementById('import-modal').style.display = 'flex';
    document.getElementById('upload-status').innerHTML = '';
}

function closeImportModal() {
    resetImportModal();
    document.getElementById('import-modal').style.display = 'none';
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        uploadCase(file);
    }
}

// Drag and drop support
document.addEventListener('DOMContentLoaded', () => {
    const uploadZone = document.getElementById('upload-zone');
    if (uploadZone) {
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('drag-over');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('drag-over');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith('.zip')) {
                uploadCase(file);
            } else {
                showUploadStatus('Please select a .zip file', 'error');
            }
        });
    }
});

async function uploadCase(file) {
    const statusEl = document.getElementById('upload-status');
    statusEl.innerHTML = '<div class="status-loading">⏳ Uploading and inspecting...</div>';

    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/cases/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            if (data.needs_options) {
                // Archive has runs or meshes - show options
                showImportOptions(data);
            } else {
                // Direct import completed
                statusEl.innerHTML = `<div class="status-success">✅ ${escapeHtml(data.message)}</div>`;
                setTimeout(() => {
                    closeImportModal();
                    loadCases();
                }, 1500);
            }
        } else {
            statusEl.innerHTML = `<div class="status-error">❌ ${escapeHtml(data.error || data.message)}</div>`;
        }
    } catch (error) {
        statusEl.innerHTML = `<div class="status-error">❌ Upload failed: ${escapeHtml(error.message)}</div>`;
    }
}

function showImportOptions(data) {
    // Hide upload step, show options step
    document.getElementById('import-upload-step').style.display = 'none';
    document.getElementById('import-options-step').style.display = 'block';

    // Set staging ID and module name
    document.getElementById('import-staging-id').value = data.staging_id;
    document.getElementById('import-module-name').textContent = data.name;

    // Show relevant options
    if (data.has_runs) {
        document.getElementById('import-runs-option').style.display = 'block';
        document.getElementById('import-include-runs').checked = true;
    } else {
        document.getElementById('import-runs-option').style.display = 'none';
    }

    if (data.has_meshes) {
        document.getElementById('import-meshes-option').style.display = 'block';
        document.getElementById('import-include-meshes').checked = true;
    } else {
        document.getElementById('import-meshes-option').style.display = 'none';
    }
}

function cancelImportOptions() {
    // Reset and close modal
    resetImportModal();
    closeImportModal();
}

function resetImportModal() {
    document.getElementById('import-upload-step').style.display = 'block';
    document.getElementById('import-options-step').style.display = 'none';
    document.getElementById('upload-status').innerHTML = '';
    document.getElementById('file-input').value = '';
}

async function completeImport() {
    const stagingId = document.getElementById('import-staging-id').value;
    const includeRuns = document.getElementById('import-include-runs').checked;
    const includeMeshes = document.getElementById('import-include-meshes').checked;

    // Show loading state
    const optionsStep = document.getElementById('import-options-step');
    optionsStep.innerHTML = '<div class="status-loading">⏳ Importing...</div>';

    try {
        const response = await fetch('/api/cases/complete-import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                staging_id: stagingId,
                skip_runs: !includeRuns,
                skip_meshes: !includeMeshes
            })
        });

        const data = await response.json();

        if (data.success) {
            optionsStep.innerHTML = `<div class="status-success">✅ ${escapeHtml(data.message)}</div>`;
            setTimeout(() => {
                resetImportModal();
                closeImportModal();
                loadCases();
            }, 1500);
        } else {
            optionsStep.innerHTML = `<div class="status-error">❌ ${escapeHtml(data.error || data.message)}</div>`;
        }
    } catch (error) {
        optionsStep.innerHTML = `<div class="status-error">❌ Import failed: ${escapeHtml(error.message)}</div>`;
    }
}

function showUploadStatus(message, type) {
    const statusEl = document.getElementById('upload-status');
    statusEl.innerHTML = `<div class="status-${type}">${type === 'error' ? '❌' : '✅'} ${escapeHtml(message)}</div>`;
}

// ============================================================================
// Edit Module
// ============================================================================

function openEditModal(caseId) {
    const caseData = casesData.find(c => c.id === caseId);
    if (!caseData) return;

    document.getElementById('edit-module-id').value = caseId;
    document.getElementById('edit-icon').value = caseData.icon || '📦';
    document.getElementById('edit-name').value = caseData.name || '';
    document.getElementById('edit-description').value = caseData.description || '';
    document.getElementById('edit-features').value = (caseData.features || []).join(', ');

    document.getElementById('edit-modal').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('edit-modal').style.display = 'none';
}

async function saveModuleEdit() {
    const moduleId = document.getElementById('edit-module-id').value;
    const icon = document.getElementById('edit-icon').value.trim() || '📦';
    const name = document.getElementById('edit-name').value.trim();
    const description = document.getElementById('edit-description').value.trim();
    const featuresStr = document.getElementById('edit-features').value.trim();
    const features = featuresStr ? featuresStr.split(',').map(f => f.trim()).filter(f => f) : [];

    if (!name) {
        alert('Name is required');
        return;
    }

    const btn = document.getElementById('save-edit-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Saving...';

    try {
        const response = await fetch(`/api/cases/${moduleId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ icon, name, description, features })
        });

        const data = await response.json();

        if (data.success) {
            closeEditModal();
            loadCases();
        } else {
            alert('Save failed: ' + (data.error || data.message));
        }
    } catch (error) {
        alert('Save failed: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '💾 Save';
    }
}

// ============================================================================
// Export Case
// ============================================================================

function exportCase(caseId) {
    // Open export modal instead of directly exporting
    document.getElementById('export-module-id').value = caseId;
    document.getElementById('export-include-runs').checked = false;
    document.getElementById('export-include-meshes').checked = false;
    document.getElementById('export-modal').style.display = 'flex';
}

function closeExportModal() {
    document.getElementById('export-modal').style.display = 'none';
}

function confirmExport() {
    const caseId = document.getElementById('export-module-id').value;
    const includeRuns = document.getElementById('export-include-runs').checked;
    const includeMeshes = document.getElementById('export-include-meshes').checked;

    // Build export URL with options
    let url = `/api/cases/${caseId}/export?`;
    if (includeRuns) url += 'include_runs=true&';
    if (includeMeshes) url += 'include_meshes=true&';

    // Close modal and trigger download
    closeExportModal();
    window.location.href = url;
}

// ============================================================================
// Delete Case
// ============================================================================

function showDeleteConfirm(caseId, caseName) {
    pendingDeleteId = caseId;
    document.getElementById('delete-message').textContent =
        `Are you sure you want to delete "${caseName}"? This action cannot be undone.`;
    document.getElementById('delete-modal').style.display = 'flex';
}

function closeDeleteModal() {
    document.getElementById('delete-modal').style.display = 'none';
    pendingDeleteId = null;
}

async function confirmDelete() {
    if (!pendingDeleteId) return;

    const btn = document.getElementById('confirm-delete-btn');
    btn.disabled = true;
    btn.textContent = 'Deleting...';

    try {
        const response = await fetch(`/api/cases/${pendingDeleteId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            closeDeleteModal();
            loadCases();
        } else {
            alert('Delete failed: ' + (data.error || data.message));
        }
    } catch (error) {
        alert('Delete failed: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Delete';
    }
}

// ============================================================================
// Case Error Handling
// ============================================================================

function showCaseError(caseId) {
    pendingErrorCaseId = caseId;
    const caseData = casesData.find(c => c.id === caseId);

    if (caseData) {
        document.getElementById('error-case-name').textContent = caseData.name;
        document.getElementById('error-message').textContent = caseData.error || 'Unknown error';
    }

    document.getElementById('error-modal').style.display = 'flex';
}

function closeErrorModal() {
    document.getElementById('error-modal').style.display = 'none';
    pendingErrorCaseId = null;
}

async function revalidateCase() {
    if (!pendingErrorCaseId) return;

    const btn = document.getElementById('revalidate-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Validating...';

    try {
        const response = await fetch(`/api/cases/${pendingErrorCaseId}/revalidate`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.valid) {
            closeErrorModal();
            loadCases();
        } else {
            document.getElementById('error-message').textContent = data.message || 'Still invalid';
        }
    } catch (error) {
        document.getElementById('error-message').textContent = 'Validation failed: ' + error.message;
    } finally {
        btn.disabled = false;
        btn.textContent = '🔄 Re-validate';
    }
}

// ============================================================================
// Utilities
// ============================================================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Close modals on overlay click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
    }
});

// Close modals on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.style.display = 'none';
        });
    }
});

// ============================================================================
// Drag and Drop Reordering
// ============================================================================

let draggedElement = null;
let currentCases = [];

function handleDragStart(e) {
    draggedElement = e.target.closest('.tool-card');
    if (!draggedElement || draggedElement.classList.contains('edit-cases-card')) {
        e.preventDefault();
        return;
    }

    draggedElement.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedElement.dataset.caseId);
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
    const target = e.target.closest('.tool-card');
    if (target && target !== draggedElement && !target.classList.contains('edit-cases-card')) {
        target.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    const target = e.target.closest('.tool-card');
    if (target) {
        target.classList.remove('drag-over');
    }
}

function handleDrop(e) {
    e.preventDefault();
    const target = e.target.closest('.tool-card');

    if (!target || !draggedElement || target === draggedElement) {
        return;
    }

    if (target.classList.contains('edit-cases-card')) {
        return;
    }

    target.classList.remove('drag-over');

    const draggedId = draggedElement.dataset.caseId;
    const targetId = target.dataset.caseId;

    // Reorder in the array
    const draggedIdx = currentCases.findIndex(c => c.id === draggedId);
    const targetIdx = currentCases.findIndex(c => c.id === targetId);

    if (draggedIdx !== -1 && targetIdx !== -1) {
        const [removed] = currentCases.splice(draggedIdx, 1);
        currentCases.splice(targetIdx, 0, removed);

        // Re-render
        renderCases(currentCases);

        // Save new order to server
        saveModuleOrder(currentCases.map(c => c.id));
    }
}

function handleDragEnd(e) {
    if (draggedElement) {
        draggedElement.classList.remove('dragging');
    }
    document.querySelectorAll('.tool-card').forEach(card => {
        card.classList.remove('drag-over');
    });
    draggedElement = null;
}

async function saveModuleOrder(orderArray) {
    try {
        const response = await fetch('/api/cases/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order: orderArray })
        });

        const data = await response.json();
        if (!data.success) {
            console.error('Failed to save order:', data.error);
        }
    } catch (error) {
        console.error('Failed to save order:', error);
    }
}

// ============================================================================
// Card Click Navigation
// ============================================================================

function navigateToModule(event, route, isInvalid) {
    // Don't navigate if clicking on action buttons or drag handle
    if (event.target.closest('.case-actions') ||
        event.target.closest('.drag-handle') ||
        event.target.closest('.broken-badge')) {
        return;
    }

    // Don't navigate for invalid modules
    if (isInvalid) {
        return;
    }

    window.location.href = route;
}

// ============================================================================
// Grid/List View Toggle
// ============================================================================

let currentViewMode = localStorage.getItem('viewMode') || 'grid';

function initViewMode() {
    const grid = document.getElementById('tools-grid');
    if (currentViewMode === 'list') {
        grid.classList.add('list-view');
    }
    updateToggleButton();
}

function toggleViewMode() {
    const grid = document.getElementById('tools-grid');

    if (currentViewMode === 'grid') {
        currentViewMode = 'list';
        grid.classList.add('list-view');
    } else {
        currentViewMode = 'grid';
        grid.classList.remove('list-view');
    }

    localStorage.setItem('viewMode', currentViewMode);
    updateToggleButton();
}

function updateToggleButton() {
    const btn = document.getElementById('view-toggle-btn');
    if (btn) {
        if (currentViewMode === 'grid') {
            btn.innerHTML = '☰';
            btn.title = 'Switch to list view';
        } else {
            btn.innerHTML = '⊞';
            btn.title = 'Switch to grid view';
        }
    }
}

// Initialize view mode when page loads
document.addEventListener('DOMContentLoaded', initViewMode);
