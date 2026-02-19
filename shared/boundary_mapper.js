/**
 * Boundary Mapper Widget
 * 
 * Reusable UI component for mapping discovered mesh patches/zones
 * to module endpoint requirements. Designed to be embedded in any
 * OpenFOAM module's frontend.
 * 
 * Usage:
 *   const mapper = new BoundaryMapper(containerEl, { runId, apiBase });
 *   await mapper.init();
 * 
 * API Dependencies:
 *   GET  {apiBase}/api/endpoint-schema
 *   GET  {apiBase}/api/run/{runId}/introspect
 *   GET  {apiBase}/api/run/{runId}/mapping
 *   POST {apiBase}/api/run/{runId}/mapping
 *   POST {apiBase}/api/run/{runId}/mapping/validate
 */

class BoundaryMapper {
    /**
     * @param {HTMLElement} container - DOM element to render into
     * @param {Object} opts
     * @param {string} opts.runId - Current run ID
     * @param {string} [opts.apiBase=''] - Base URL prefix for API calls
     * @param {string} [opts.moduleName=''] - Module identifier
     * @param {Function} [opts.onMappingSaved] - Callback after successful save
     * @param {Function} [opts.onValidationChange] - Callback(isValid, errors)
     */
    constructor(container, opts = {}) {
        this.container = container;
        this.runId = opts.runId;
        this.apiBase = opts.apiBase || '';
        this.moduleName = opts.moduleName || '';
        this.meshId = opts.meshId || null;
        this.onMappingSaved = opts.onMappingSaved || null;
        this.onValidationChange = opts.onValidationChange || null;

        // State
        this.schema = null;
        this.introspection = null;
        this.mapping = null;
        this.validationErrors = [];
        this.isLoading = false;
        this.isDirty = false;

        // Auto-initialize: fetch schema, introspect mesh, load mapping
        this.init();
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    async init() {
        this.isLoading = true;
        this._renderLoading();

        try {
            // Fetch schema and introspection in parallel
            const [schemaRes, introRes, mappingRes] = await Promise.all([
                this._fetch(`/api/endpoint-schema`),
                this._fetch(`/api/run/${this.runId}/introspect`),
                this._fetch(`/api/run/${this.runId}/mapping`)
            ]);

            this.schema = schemaRes;
            this.introspection = introRes;

            if (mappingRes.exists && mappingRes.mapping) {
                this.mapping = mappingRes.mapping;
            } else {
                // Create empty mapping from schema
                this.mapping = this._createEmptyMapping();
            }

            this.isLoading = false;
            this._render();
            this._validate();
        } catch (err) {
            this.isLoading = false;
            this._renderError(err.message);
        }
    }

    // ========================================================================
    // API helpers
    // ========================================================================

    async _fetch(path, opts = {}) {
        const url = `${this.apiBase}${path}`;
        const res = await fetch(url, opts);
        if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
        return res.json();
    }

    async _postJson(path, body) {
        return this._fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    }

    // ========================================================================
    // Mapping helpers
    // ========================================================================

    _createEmptyMapping() {
        const mapping = {
            schema_version: '1.0',
            module: this.moduleName,
            mappings: {},
            patchTypeOverrides: {},
            instances: {}
        };

        // Init empty arrays for each top-level endpoint
        if (this.schema && this.schema.endpoints) {
            for (const ep of this.schema.endpoints) {
                mapping.mappings[ep.key] = [];
            }
        }

        // Init empty arrays for repeating groups
        if (this.schema && this.schema.repeatingGroups) {
            for (const rg of this.schema.repeatingGroups) {
                mapping.instances[rg.key] = [];
            }
        }

        return mapping;
    }

    _getAvailablePatches() {
        if (!this.introspection) return [];
        return (this.introspection.patches || []).map(p => p.name);
    }

    _getAvailableCellZones() {
        if (!this.introspection) return [];
        return (this.introspection.cellZones || []).map(z => typeof z === 'object' ? z.name : z);
    }

    _getAvailableFaceZones() {
        if (!this.introspection) return [];
        return this.introspection.faceZones || [];
    }

    _getAllMappedNames() {
        const mapped = new Set();
        if (!this.mapping) return mapped;

        // Top-level mappings
        for (const names of Object.values(this.mapping.mappings || {})) {
            for (const n of names) mapped.add(n);
        }

        // Instance mappings
        for (const instances of Object.values(this.mapping.instances || {})) {
            for (const inst of instances) {
                for (const names of Object.values(inst.mappings || {})) {
                    for (const n of names) mapped.add(n);
                }
            }
        }

        return mapped;
    }

    // ========================================================================
    // Validation
    // ========================================================================

    async _validate() {
        if (!this.mapping || !this.schema) return;

        try {
            const result = await this._postJson(
                `/api/run/${this.runId}/mapping/validate`,
                this.mapping
            );
            this.validationErrors = result.errors || [];
            this._updateValidationUI();
            if (this.onValidationChange) {
                this.onValidationChange(result.valid, this.validationErrors);
            }
        } catch (err) {
            console.warn('Validation request failed:', err);
        }
    }

    // ========================================================================
    // Save
    // ========================================================================

    async save() {
        if (!this.mapping) return;

        try {
            await this._postJson(`/api/run/${this.runId}/mapping`, this.mapping);
            this.isDirty = false;
            this._updateSaveButton();
            if (this.onMappingSaved) {
                this.onMappingSaved(this.mapping);
            }
            this._showToast('Mapping saved successfully', 'success');
        } catch (err) {
            this._showToast('Failed to save mapping: ' + err.message, 'error');
        }
    }

    async saveAsDefault() {
        if (!this.mapping || !this.meshId) return;

        const btn = this.container.querySelector('#bm-save-default-btn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Saving...';
        }

        try {
            await this._postJson(`/api/mesh/library/${this.meshId}/default-mapping`, this.mapping);
            this._showToast('Saved as default for this mesh', 'success');
        } catch (err) {
            this._showToast('Failed to save default: ' + err.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Set Default';
            }
        }
    }

    clearSettings() {
        if (!this.mapping) return;

        this.mapping = this._createEmptyMapping();
        this.isDirty = true;
        this._render();
        this._showToast('All patch assignments cleared', 'success');
    }

    // ========================================================================
    // Rendering
    // ========================================================================

    _renderLoading() {
        this.container.innerHTML = `
            <div class="bm-loading">
                <div class="bm-spinner"></div>
                <span>Loading boundary mapper...</span>
            </div>
        `;
    }

    _renderError(msg) {
        this.container.innerHTML = `
            <div class="bm-error">
                <span class="bm-error-icon">&#9888;</span>
                <p>${msg}</p>
                <button class="bm-btn bm-btn-retry" onclick="this.closest('.bm-error').parentElement.__mapper.init()">Retry</button>
            </div>
        `;
        this.container.__mapper = this;
    }

    _render() {
        const hasPatches = this._getAvailablePatches().length > 0;
        const hasCellZones = this._getAvailableCellZones().length > 0;

        if (!hasPatches && !hasCellZones) {
            this.container.innerHTML = `
                <div class="bm-empty">
                    <span class="bm-empty-icon">&#128269;</span>
                    <p>No mesh groups discovered. Make sure the mesh has been converted to polyMesh first.</p>
                </div>
            `;
            return;
        }

        const html = `
            <div class="bm-widget">
                <div class="bm-header">
                    <h3 class="bm-title">Boundary Mapper</h3>
                    <div class="bm-header-actions">
                        ${this.meshId ? '<button class="bm-btn bm-btn-save-default" id="bm-save-default-btn" title="Save current mapping as default for this mesh">Set Default</button>' : ''}
                        <button class="bm-btn bm-btn-clear-settings" id="bm-clear-settings-btn" title="Reset all patch assignments">Clear Settings</button>
                        <button class="bm-btn bm-btn-save" id="bm-save-btn" disabled>Save Mapping</button>
                    </div>
                </div>

                <div class="bm-validation" id="bm-validation"></div>

                <div class="bm-body">
                    <div class="bm-pool-col">
                        <h4 class="bm-col-title">Discovered Groups</h4>
                        <div class="bm-pool-subtitle">Drag or click to assign</div>
                        <div class="bm-pool" id="bm-pool"></div>
                    </div>

                    <div class="bm-endpoints-col">
                        <h4 class="bm-col-title">Module Endpoints</h4>
                        ${this._renderEndpoints()}
                        ${this._renderRepeatingGroups()}
                    </div>
                </div>

                <div class="bm-toast" id="bm-toast"></div>
            </div>
        `;

        this.container.innerHTML = html;
        this._populatePool();
        this._populateEndpointAssignments();
        this._attachEventListeners();
        this._updateSaveButton();
    }

    _renderEndpoints() {
        if (!this.schema || !this.schema.endpoints) return '';

        return this.schema.endpoints.map(ep => `
            <div class="bm-endpoint" data-key="${ep.key}" data-type="${ep.type}">
                <div class="bm-endpoint-header">
                    <span class="bm-endpoint-label">${ep.label}</span>
                    ${ep.required ? '<span class="bm-badge bm-badge-required">Required</span>' : '<span class="bm-badge bm-badge-optional">Optional</span>'}
                    <span class="bm-badge bm-badge-type">${ep.type}</span>
                </div>
                ${ep.description ? `<div class="bm-endpoint-desc">${ep.description}</div>` : ''}
                <div class="bm-dropzone" data-endpoint="${ep.key}" data-level="top" data-ep-type="${ep.type}" data-multiple="${ep.multiple !== false}">
                    <div class="bm-dropzone-placeholder">Drop ${ep.type}s here...</div>
                    <div class="bm-assigned-list"></div>
                </div>
            </div>
        `).join('');
    }

    _renderRepeatingGroups() {
        if (!this.schema || !this.schema.repeatingGroups || this.schema.repeatingGroups.length === 0) return '';

        return this.schema.repeatingGroups.map(rg => `
            <div class="bm-repeating-group" data-group-key="${rg.key}">
                <div class="bm-rg-header">
                    <span class="bm-rg-label">${rg.label}s</span>
                    <button class="bm-btn bm-btn-small bm-btn-add-instance" data-group="${rg.key}">+ Add ${rg.label}</button>
                </div>
                <div class="bm-rg-instances" id="bm-rg-instances-${rg.key}"></div>
            </div>
        `).join('');
    }

    _renderInstance(rg, instance, idx) {
        const endpoints = rg.endpoints.map(ep => `
            <div class="bm-endpoint bm-instance-endpoint" data-key="${ep.key}" data-type="${ep.type}">
                <div class="bm-endpoint-header">
                    <span class="bm-endpoint-label">${ep.label}</span>
                    ${ep.required ? '<span class="bm-badge bm-badge-required">Req</span>' : ''}
                    <span class="bm-badge bm-badge-type">${ep.type}</span>
                </div>
                <div class="bm-dropzone" data-endpoint="${ep.key}" data-level="instance" data-group="${rg.key}" data-instance-idx="${idx}" data-ep-type="${ep.type}" data-multiple="${ep.multiple !== false}">
                    <div class="bm-dropzone-placeholder">Drop ${ep.type}s here...</div>
                    <div class="bm-assigned-list"></div>
                </div>
            </div>
        `).join('');

        const params = (rg.parameters || []).map(p => {
            const val = instance.parameters[p.key] !== undefined ? instance.parameters[p.key] : p.default;
            const showWhenAttr = p.showWhen ? `data-show-when='${JSON.stringify(p.showWhen)}'` : '';
            const hidden = p.showWhen ? this._evaluateShowWhen(p.showWhen, instance.parameters) ? '' : 'style="display:none"' : '';
            let inputHtml;
            if (p.type === 'select') {
                const opts = (p.options || []).map(o =>
                    `<option value="${o.value}" ${o.value === val ? 'selected' : ''}>${o.label}</option>`
                ).join('');
                inputHtml = `<select class="bm-param-input" data-group="${rg.key}" data-instance-idx="${idx}" data-param="${p.key}" data-param-type="select">${opts}</select>`;
            } else if (p.type === 'checkbox') {
                inputHtml = `<label class="bm-param-checkbox-label"><input type="checkbox" class="bm-param-input" data-group="${rg.key}" data-instance-idx="${idx}" data-param="${p.key}" data-param-type="checkbox" ${val ? 'checked' : ''}> ${p.label}</label>`;
            } else {
                inputHtml = `<input type="number" class="bm-param-input" data-group="${rg.key}" data-instance-idx="${idx}" data-param="${p.key}" data-param-type="number" value="${val}" step="any">`;
            }
            const starBtn = `<button class="bm-default-btn" data-group="${rg.key}" data-param="${p.key}" title="Save as default">&#11088;</button>`;
            return `<div class="bm-param" ${showWhenAttr} ${hidden}>${p.type !== 'checkbox' ? `<label class="bm-param-label">${p.label}:</label>` : ''}${inputHtml}${starBtn}</div>`;
        }).join('');

        return `
            <div class="bm-instance" data-group="${rg.key}" data-idx="${idx}">
                <div class="bm-instance-header">
                    <input type="text" class="bm-instance-name" value="${instance.name}" 
                           data-group="${rg.key}" data-idx="${idx}" placeholder="${rg.label} ${idx + 1}">
                    <button class="bm-btn bm-btn-small bm-btn-remove-instance" data-group="${rg.key}" data-idx="${idx}">Remove</button>
                </div>
                ${params}
                ${endpoints}
            </div>
        `;
    }

    _populatePool() {
        const pool = this.container.querySelector('#bm-pool');
        if (!pool) return;

        const mapped = this._getAllMappedNames();
        let html = '';

        // Patches
        const patches = this.introspection.patches || [];
        if (patches.length > 0) {
            html += '<div class="bm-pool-section"><div class="bm-pool-section-title">Patches</div>';
            for (const p of patches) {
                const isMapped = mapped.has(p.name);
                html += `
                    <div class="bm-pool-item ${isMapped ? 'bm-mapped' : ''}" 
                         data-name="${p.name}" data-item-type="patch" draggable="${!isMapped}">
                        <span class="bm-pool-item-name">${p.name}</span>
                        <span class="bm-pool-item-meta">${p.type} (${p.nFaces} faces)</span>
                    </div>
                `;
            }
            html += '</div>';
        }

        // Cell Zones
        const cellZones = this.introspection.cellZones || [];
        if (cellZones.length > 0) {
            html += '<div class="bm-pool-section"><div class="bm-pool-section-title">Cell Zones</div>';
            for (const z of cellZones) {
                const zName = typeof z === 'object' ? z.name : z;
                const nCells = typeof z === 'object' ? z.nCells : 0;
                const isMapped = mapped.has(zName);
                const cellsLabel = nCells > 0 ? `cellZone (${nCells.toLocaleString()} cells)` : 'cellZone';
                html += `
                    <div class="bm-pool-item ${isMapped ? 'bm-mapped' : ''}" 
                         data-name="${zName}" data-item-type="cellZone" draggable="${!isMapped}">
                        <span class="bm-pool-item-name">${zName}</span>
                        <span class="bm-pool-item-meta">${cellsLabel}</span>
                    </div>
                `;
            }
            html += '</div>';
        }

        // Face Zones
        const faceZones = this.introspection.faceZones || [];
        if (faceZones.length > 0) {
            html += '<div class="bm-pool-section"><div class="bm-pool-section-title">Face Zones</div>';
            for (const z of faceZones) {
                const isMapped = mapped.has(z);
                html += `
                    <div class="bm-pool-item ${isMapped ? 'bm-mapped' : ''}" 
                         data-name="${z}" data-item-type="faceZone" draggable="${!isMapped}">
                        <span class="bm-pool-item-name">${z}</span>
                        <span class="bm-pool-item-meta">faceZone</span>
                    </div>
                `;
            }
            html += '</div>';
        }

        // Point Zones
        const pointZones = this.introspection.pointZones || [];
        if (pointZones.length > 0) {
            html += '<div class="bm-pool-section"><div class="bm-pool-section-title">Point Zones</div>';
            for (const z of pointZones) {
                const isMapped = mapped.has(z);
                html += `
                    <div class="bm-pool-item ${isMapped ? 'bm-mapped' : ''}" 
                         data-name="${z}" data-item-type="pointZone" draggable="${!isMapped}">
                        <span class="bm-pool-item-name">${z}</span>
                        <span class="bm-pool-item-meta">pointZone</span>
                    </div>
                `;
            }
            html += '</div>';
        }

        if (!html) {
            html = '<div class="bm-pool-empty">No mesh groups found</div>';
        }

        pool.innerHTML = html;
    }

    _populateEndpointAssignments() {
        if (!this.mapping) return;

        // Top-level endpoints
        for (const [key, names] of Object.entries(this.mapping.mappings || {})) {
            const dropzone = this.container.querySelector(`.bm-dropzone[data-endpoint="${key}"][data-level="top"]`);
            if (!dropzone) continue;

            const list = dropzone.querySelector('.bm-assigned-list');
            if (!list) continue;

            list.innerHTML = '';
            for (const name of names) {
                list.appendChild(this._createAssignedChip(name, key, 'top'));
            }

            // Toggle placeholder
            const placeholder = dropzone.querySelector('.bm-dropzone-placeholder');
            if (placeholder) placeholder.style.display = names.length > 0 ? 'none' : '';
        }

        // Repeating group instances
        for (const rg of (this.schema.repeatingGroups || [])) {
            const instancesContainer = this.container.querySelector(`#bm-rg-instances-${rg.key}`);
            if (!instancesContainer) continue;

            const instances = (this.mapping.instances || {})[rg.key] || [];
            instancesContainer.innerHTML = '';

            for (let i = 0; i < instances.length; i++) {
                instancesContainer.insertAdjacentHTML('beforeend', this._renderInstance(rg, instances[i], i));

                // Populate assigned items for this instance's endpoints
                for (const ep of rg.endpoints) {
                    const dropzone = instancesContainer.querySelector(
                        `.bm-dropzone[data-endpoint="${ep.key}"][data-instance-idx="${i}"]`
                    );
                    if (!dropzone) continue;

                    const list = dropzone.querySelector('.bm-assigned-list');
                    const names = (instances[i].mappings || {})[ep.key] || [];
                    list.innerHTML = '';
                    for (const name of names) {
                        list.appendChild(this._createAssignedChip(name, ep.key, 'instance', rg.key, i));
                    }

                    const placeholder = dropzone.querySelector('.bm-dropzone-placeholder');
                    if (placeholder) placeholder.style.display = names.length > 0 ? 'none' : '';
                }
            }
        }
    }

    _createAssignedChip(name, endpointKey, level, groupKey = null, instanceIdx = null) {
        const chip = document.createElement('div');
        chip.className = 'bm-assigned-chip';
        chip.innerHTML = `
            <span class="bm-chip-name">${name}</span>
            <button class="bm-chip-remove" title="Remove">&times;</button>
        `;

        chip.querySelector('.bm-chip-remove').addEventListener('click', () => {
            this._unassign(name, endpointKey, level, groupKey, instanceIdx);
        });

        return chip;
    }

    // ========================================================================
    // Assignment logic
    // ========================================================================

    _assign(name, endpointKey, level, groupKey = null, instanceIdx = null) {
        if (level === 'top') {
            if (!this.mapping.mappings[endpointKey]) {
                this.mapping.mappings[endpointKey] = [];
            }
            if (!this.mapping.mappings[endpointKey].includes(name)) {
                this.mapping.mappings[endpointKey].push(name);
            }
        } else if (level === 'instance') {
            const instances = this.mapping.instances[groupKey];
            if (instances && instances[instanceIdx]) {
                if (!instances[instanceIdx].mappings[endpointKey]) {
                    instances[instanceIdx].mappings[endpointKey] = [];
                }
                if (!instances[instanceIdx].mappings[endpointKey].includes(name)) {
                    instances[instanceIdx].mappings[endpointKey].push(name);
                }
            }
        }

        this.isDirty = true;
        this._refreshUI();
    }

    _unassign(name, endpointKey, level, groupKey = null, instanceIdx = null) {
        if (level === 'top') {
            const arr = this.mapping.mappings[endpointKey];
            if (arr) {
                const idx = arr.indexOf(name);
                if (idx >= 0) arr.splice(idx, 1);
            }
        } else if (level === 'instance') {
            const instances = this.mapping.instances[groupKey];
            if (instances && instances[instanceIdx]) {
                const arr = instances[instanceIdx].mappings[endpointKey];
                if (arr) {
                    const idx = arr.indexOf(name);
                    if (idx >= 0) arr.splice(idx, 1);
                }
            }
        }

        this.isDirty = true;
        this._refreshUI();
    }

    _addInstance(groupKey) {
        const rg = this.schema.repeatingGroups.find(g => g.key === groupKey);
        if (!rg) return;

        if (!this.mapping.instances[groupKey]) {
            this.mapping.instances[groupKey] = [];
        }

        const idx = this.mapping.instances[groupKey].length;
        const instance = {
            name: `${rg.label} ${idx + 1}`,
            mappings: {},
            parameters: {}
        };

        // Init empty mappings for each endpoint
        for (const ep of rg.endpoints) {
            instance.mappings[ep.key] = [];
        }

        // Init default parameters (use saved defaults if available, else schema defaults)
        const savedDefaults = this._getParamDefaults(groupKey);
        for (const p of (rg.parameters || [])) {
            instance.parameters[p.key] = savedDefaults[p.key] !== undefined ? savedDefaults[p.key] : p.default;
        }

        this.mapping.instances[groupKey].push(instance);
        this.isDirty = true;
        this._refreshUI();
    }

    _removeInstance(groupKey, idx) {
        if (this.mapping.instances[groupKey]) {
            this.mapping.instances[groupKey].splice(idx, 1);
            this.isDirty = true;
            this._refreshUI();
        }
    }

    /**
     * Check if a showWhen condition is satisfied.
     * showWhen is an object like { "enableRampup": true }
     * meaning "show this param only when enableRampup === true"
     */
    _evaluateShowWhen(showWhen, parameters) {
        if (!showWhen) return true;
        for (const [key, expected] of Object.entries(showWhen)) {
            if (parameters[key] !== expected) return false;
        }
        return true;
    }

    /**
     * Re-evaluate showWhen visibility for all params in a specific instance
     */
    _updateShowWhen(groupKey, idx) {
        const instanceEl = this.container.querySelector(`.bm-instance[data-group="${groupKey}"][data-idx="${idx}"]`);
        if (!instanceEl) return;
        const instance = this.mapping.instances[groupKey]?.[idx];
        if (!instance) return;

        instanceEl.querySelectorAll('.bm-param[data-show-when]').forEach(paramEl => {
            try {
                const cond = JSON.parse(paramEl.dataset.showWhen);
                paramEl.style.display = this._evaluateShowWhen(cond, instance.parameters) ? '' : 'none';
            } catch (e) { /* ignore parse errors */ }
        });
    }

    // ========================================================================
    // Parameter Defaults Persistence
    // ========================================================================

    _getParamDefaults(groupKey) {
        try {
            const all = JSON.parse(localStorage.getItem(`mapperDefaults_${this.moduleName}`) || '{}');
            return all[groupKey] || {};
        } catch { return {}; }
    }

    _saveParamDefault(groupKey, paramKey, value) {
        try {
            const all = JSON.parse(localStorage.getItem(`mapperDefaults_${this.moduleName}`) || '{}');
            if (!all[groupKey]) all[groupKey] = {};
            all[groupKey][paramKey] = value;
            localStorage.setItem(`mapperDefaults_${this.moduleName}`, JSON.stringify(all));
        } catch (e) { console.warn('Failed to save mapper default:', e); }
    }

    _refreshUI() {
        this._populatePool();
        this._populateEndpointAssignments();
        this._attachDragListeners();
        this._updateSaveButton();
        this._validate();
    }

    // ========================================================================
    // Validation UI
    // ========================================================================

    _updateValidationUI() {
        const el = this.container.querySelector('#bm-validation');
        if (!el) return;

        if (this.validationErrors.length === 0) {
            el.innerHTML = '<div class="bm-validation-ok">&#10003; Mapping is valid</div>';
        } else {
            el.innerHTML = `
                <div class="bm-validation-errors">
                    <div class="bm-validation-title">&#9888; Validation Issues:</div>
                    <ul>${this.validationErrors.map(e => `<li>${e}</li>`).join('')}</ul>
                </div>
            `;
        }
    }

    _updateSaveButton() {
        const btn = this.container.querySelector('#bm-save-btn');
        if (btn) {
            btn.disabled = !this.isDirty;
            btn.textContent = this.isDirty ? 'Save Mapping *' : 'Save Mapping';
        }
    }

    _showToast(message, type = 'info') {
        const toast = this.container.querySelector('#bm-toast');
        if (!toast) return;

        toast.textContent = message;
        toast.className = `bm-toast bm-toast-${type} bm-toast-visible`;
        setTimeout(() => {
            toast.className = 'bm-toast';
        }, 3000);
    }

    // ========================================================================
    // Event listeners
    // ========================================================================

    _attachEventListeners() {
        // Save button
        const saveBtn = this.container.querySelector('#bm-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.save());
        }

        // Save as Mesh Default button
        const saveDefaultBtn = this.container.querySelector('#bm-save-default-btn');
        if (saveDefaultBtn && this.meshId) {
            saveDefaultBtn.addEventListener('click', () => this.saveAsDefault());
        }

        // Clear Settings button
        const clearSettingsBtn = this.container.querySelector('#bm-clear-settings-btn');
        if (clearSettingsBtn) {
            clearSettingsBtn.addEventListener('click', () => this.clearSettings());
        }

        // Add instance buttons
        this.container.querySelectorAll('.bm-btn-add-instance').forEach(btn => {
            btn.addEventListener('click', () => {
                this._addInstance(btn.dataset.group);
            });
        });

        // Drag and drop + click-to-assign
        this._attachDragListeners();
        this._attachClickAssign();
    }

    _attachDragListeners() {
        // Pool items — drag start
        this.container.querySelectorAll('.bm-pool-item:not(.bm-mapped)').forEach(item => {
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({
                    name: item.dataset.name,
                    type: item.dataset.itemType
                }));
                item.classList.add('bm-dragging');
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('bm-dragging');
                this.container.querySelectorAll('.bm-dropzone').forEach(dz => {
                    dz.classList.remove('bm-dropzone-hover');
                });
            });
        });

        // Dropzones
        this.container.querySelectorAll('.bm-dropzone').forEach(dz => {
            dz.addEventListener('dragover', (e) => {
                e.preventDefault();
                dz.classList.add('bm-dropzone-hover');
            });

            dz.addEventListener('dragleave', () => {
                dz.classList.remove('bm-dropzone-hover');
            });

            dz.addEventListener('drop', (e) => {
                e.preventDefault();
                dz.classList.remove('bm-dropzone-hover');

                try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));

                    // Check type compatibility
                    const epType = dz.dataset.epType;
                    if (epType && data.type !== epType) {
                        this._showToast(`Cannot assign ${data.type} to ${epType} endpoint`, 'error');
                        return;
                    }

                    // Check single vs multiple
                    const isMultiple = dz.dataset.multiple !== 'false';
                    if (!isMultiple) {
                        const existing = this._getDropzoneAssignments(dz);
                        if (existing.length > 0) {
                            this._showToast('This endpoint only accepts one item', 'error');
                            return;
                        }
                    }

                    this._assign(
                        data.name,
                        dz.dataset.endpoint,
                        dz.dataset.level,
                        dz.dataset.group || null,
                        dz.dataset.instanceIdx !== undefined ? parseInt(dz.dataset.instanceIdx) : null
                    );
                } catch (err) {
                    console.warn('Drop failed:', err);
                }
            });
        });

        // Remove instance buttons
        this.container.querySelectorAll('.bm-btn-remove-instance').forEach(btn => {
            btn.addEventListener('click', () => {
                this._removeInstance(btn.dataset.group, parseInt(btn.dataset.idx));
            });
        });

        // Instance name inputs
        this.container.querySelectorAll('.bm-instance-name').forEach(input => {
            input.addEventListener('change', () => {
                const group = input.dataset.group;
                const idx = parseInt(input.dataset.idx);
                if (this.mapping.instances[group] && this.mapping.instances[group][idx]) {
                    this.mapping.instances[group][idx].name = input.value;
                    this.isDirty = true;
                    this._updateSaveButton();
                }
            });
        });

        // Parameter inputs (number, select, checkbox)
        this.container.querySelectorAll('.bm-param-input').forEach(input => {
            input.addEventListener('change', () => {
                const group = input.dataset.group;
                const idx = parseInt(input.dataset.instanceIdx);
                const param = input.dataset.param;
                const paramType = input.dataset.paramType || 'number';
                if (this.mapping.instances[group] && this.mapping.instances[group][idx]) {
                    let value;
                    if (paramType === 'checkbox') {
                        value = input.checked;
                    } else if (paramType === 'select') {
                        value = input.value;
                    } else {
                        value = parseFloat(input.value);
                    }
                    this.mapping.instances[group][idx].parameters[param] = value;
                    this.isDirty = true;
                    this._updateSaveButton();
                    // Re-evaluate showWhen visibility for sibling params
                    this._updateShowWhen(group, idx);
                }
            });
        });

        // Default (star) buttons
        this.container.querySelectorAll('.bm-default-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const group = btn.dataset.group;
                const param = btn.dataset.param;
                // Find the sibling input value
                const paramDiv = btn.closest('.bm-param');
                const input = paramDiv?.querySelector('.bm-param-input');
                if (!input) return;
                let value;
                if (input.dataset.paramType === 'checkbox') {
                    value = input.checked;
                } else if (input.dataset.paramType === 'select') {
                    value = input.value;
                } else {
                    value = parseFloat(input.value);
                }
                this._saveParamDefault(group, param, value);
                // Visual feedback
                const orig = btn.innerHTML;
                btn.innerHTML = '&#10003;';
                btn.classList.add('bm-default-saved');
                setTimeout(() => {
                    btn.innerHTML = orig;
                    btn.classList.remove('bm-default-saved');
                }, 1500);
            });
        });
    }

    _attachClickAssign() {
        // Click on unassigned pool item to show assignment menu
        this.container.querySelectorAll('.bm-pool-item:not(.bm-mapped)').forEach(item => {
            item.addEventListener('click', (e) => {
                // Prevent if dragging
                if (item.classList.contains('bm-dragging')) return;

                // Show a quick-assign dropdown
                this._showQuickAssign(item, item.dataset.name, item.dataset.itemType);
            });
        });
    }

    _showQuickAssign(anchorEl, name, itemType) {
        // Remove any existing quick-assign
        const existing = this.container.querySelector('.bm-quick-assign');
        if (existing) existing.remove();

        // Build list of compatible endpoints
        const options = [];

        // Top-level endpoints
        for (const ep of (this.schema.endpoints || [])) {
            if (ep.type === itemType) {
                options.push({ label: ep.label, key: ep.key, level: 'top' });
            }
        }

        // Instance endpoints
        for (const rg of (this.schema.repeatingGroups || [])) {
            const instances = (this.mapping.instances || {})[rg.key] || [];
            for (let i = 0; i < instances.length; i++) {
                for (const ep of rg.endpoints) {
                    if (ep.type === itemType) {
                        options.push({
                            label: `${instances[i].name} > ${ep.label}`,
                            key: ep.key,
                            level: 'instance',
                            group: rg.key,
                            instanceIdx: i
                        });
                    }
                }
            }
        }

        if (options.length === 0) {
            this._showToast(`No compatible endpoint for ${itemType}`, 'error');
            return;
        }

        const menu = document.createElement('div');
        menu.className = 'bm-quick-assign';
        menu.innerHTML = `
            <div class="bm-qa-title">Assign "${name}" to:</div>
            ${options.map((o, i) => `
                <div class="bm-qa-option" data-idx="${i}">${o.label}</div>
            `).join('')}
        `;

        // Position near the anchor
        const rect = anchorEl.getBoundingClientRect();
        const parentRect = this.container.getBoundingClientRect();
        menu.style.position = 'absolute';
        menu.style.top = `${rect.bottom - parentRect.top + 4}px`;
        menu.style.left = `${rect.left - parentRect.left}px`;

        this.container.style.position = 'relative';
        this.container.appendChild(menu);

        // Listen for clicks
        menu.querySelectorAll('.bm-qa-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const o = options[parseInt(opt.dataset.idx)];
                this._assign(name, o.key, o.level, o.group || null, o.instanceIdx !== undefined ? o.instanceIdx : null);
                menu.remove();
            });
        });

        // Close on outside click
        const closeHandler = (e) => {
            if (!menu.contains(e.target) && e.target !== anchorEl) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }

    _getDropzoneAssignments(dz) {
        const epKey = dz.dataset.endpoint;
        const level = dz.dataset.level;

        if (level === 'top') {
            return this.mapping.mappings[epKey] || [];
        } else if (level === 'instance') {
            const group = dz.dataset.group;
            const idx = parseInt(dz.dataset.instanceIdx);
            const instances = this.mapping.instances[group];
            if (instances && instances[idx]) {
                return instances[idx].mappings[epKey] || [];
            }
        }
        return [];
    }

    /**
     * Clean up the widget, removing all rendered content.
     */
    destroy() {
        this.container.innerHTML = '';
    }
}


// ============================================================================
// CSS Styles (injected once)
// ============================================================================

(function injectBoundaryMapperStyles() {
    if (document.getElementById('bm-styles')) return;

    const style = document.createElement('style');
    style.id = 'bm-styles';
    style.textContent = `
        /* Boundary Mapper Widget */
        .bm-widget {
            border: 1px solid var(--border, #333);
            border-radius: 10px;
            background: var(--card-bg, #1a1a2e);
            overflow: hidden;
            font-family: inherit;
        }

        .bm-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 14px 18px;
            background: var(--card-header-bg, rgba(255,255,255,0.03));
            border-bottom: 1px solid var(--border, #333);
        }

        .bm-title {
            margin: 0;
            font-size: 15px;
            font-weight: 600;
            color: var(--text, #e0e0e0);
        }

        .bm-body {
            display: grid;
            grid-template-columns: 280px 1fr;
            min-height: 300px;
        }

        /* Pool column */
        .bm-pool-col {
            border-right: 1px solid var(--border, #333);
            padding: 12px;
            background: rgba(0,0,0,0.15);
            overflow-y: auto;
            max-height: 500px;
        }

        .bm-col-title {
            margin: 0 0 4px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-secondary, #888);
        }

        .bm-pool-subtitle {
            font-size: 11px;
            color: var(--text-secondary, #666);
            margin-bottom: 10px;
        }

        .bm-pool-section {
            margin-bottom: 12px;
        }

        .bm-pool-section-title {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            color: var(--accent, #4dabf7);
            margin-bottom: 6px;
            padding-bottom: 3px;
            border-bottom: 1px solid rgba(77,171,247,0.2);
        }

        .bm-pool-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 7px 10px;
            margin-bottom: 3px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 6px;
            cursor: grab;
            transition: all 0.15s;
            font-size: 13px;
        }

        .bm-pool-item:hover:not(.bm-mapped) {
            background: rgba(77,171,247,0.1);
            border-color: rgba(77,171,247,0.3);
        }

        .bm-pool-item.bm-mapped {
            opacity: 0.35;
            cursor: default;
            text-decoration: line-through;
        }

        .bm-pool-item.bm-dragging {
            opacity: 0.5;
        }

        .bm-pool-item-name {
            font-weight: 500;
            color: var(--text, #e0e0e0);
        }

        .bm-pool-item-meta {
            font-size: 10px;
            color: var(--text-secondary, #666);
            margin-left: 8px;
            white-space: nowrap;
        }

        /* Endpoints column */
        .bm-endpoints-col {
            padding: 12px;
            overflow-y: auto;
            max-height: 500px;
        }

        .bm-endpoint {
            margin-bottom: 12px;
        }

        .bm-endpoint-header {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 4px;
        }

        .bm-endpoint-label {
            font-size: 13px;
            font-weight: 600;
            color: var(--text, #e0e0e0);
        }

        .bm-endpoint-desc {
            font-size: 11px;
            color: var(--text-secondary, #666);
            margin-bottom: 6px;
        }

        .bm-badge {
            font-size: 9px;
            font-weight: 700;
            text-transform: uppercase;
            padding: 2px 6px;
            border-radius: 4px;
            letter-spacing: 0.3px;
        }

        .bm-badge-required {
            background: rgba(255,107,107,0.15);
            color: #ff6b6b;
        }

        .bm-badge-optional {
            background: rgba(255,255,255,0.05);
            color: #666;
        }

        .bm-badge-type {
            background: rgba(77,171,247,0.1);
            color: #4dabf7;
        }

        /* Dropzones */
        .bm-dropzone {
            min-height: 40px;
            padding: 6px;
            border: 2px dashed rgba(255,255,255,0.1);
            border-radius: 8px;
            transition: all 0.15s;
        }

        .bm-dropzone-hover {
            border-color: rgba(77,171,247,0.5);
            background: rgba(77,171,247,0.05);
        }

        .bm-dropzone-placeholder {
            font-size: 12px;
            color: var(--text-secondary, #555);
            text-align: center;
            padding: 8px;
            font-style: italic;
        }

        .bm-assigned-list {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        }

        .bm-assigned-chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 8px;
            background: rgba(77,171,247,0.15);
            border: 1px solid rgba(77,171,247,0.3);
            border-radius: 5px;
            font-size: 12px;
            color: #bcd8f0;
        }

        .bm-chip-name {
            font-weight: 500;
        }

        .bm-chip-remove {
            background: none;
            border: none;
            color: #ff6b6b;
            cursor: pointer;
            font-size: 14px;
            line-height: 1;
            padding: 0 2px;
            opacity: 0.7;
        }

        .bm-chip-remove:hover {
            opacity: 1;
        }

        /* Repeating groups */
        .bm-repeating-group {
            margin-top: 16px;
            border-top: 1px solid var(--border, #333);
            padding-top: 12px;
        }

        .bm-rg-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }

        .bm-rg-label {
            font-size: 14px;
            font-weight: 600;
            color: var(--text, #e0e0e0);
        }

        .bm-instance {
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 8px;
            padding: 10px;
            margin-bottom: 10px;
            background: rgba(0,0,0,0.1);
        }

        .bm-instance-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }

        .bm-instance-name {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 13px;
            color: var(--text, #e0e0e0);
            width: 200px;
        }

        .bm-instance-endpoint {
            margin-bottom: 8px;
        }

        .bm-param {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
        }

        .bm-param-label {
            font-size: 12px;
            color: var(--text-secondary, #888);
            min-width: 60px;
        }

        .bm-param-input {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 13px;
            color: var(--text, #e0e0e0);
            width: 100px;
        }

        select.bm-param-input {
            width: auto;
            min-width: 120px;
            cursor: pointer;
        }

        .bm-param-checkbox-label {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: var(--text-secondary, #888);
            cursor: pointer;
        }

        .bm-param-checkbox-label input[type="checkbox"] {
            accent-color: #4dabf7;
            cursor: pointer;
        }

        .bm-default-btn {
            background: none;
            border: none;
            cursor: pointer;
            font-size: 11px;
            padding: 2px 4px;
            opacity: 0.4;
            transition: opacity 0.15s, transform 0.15s;
            flex-shrink: 0;
        }
        .bm-default-btn:hover {
            opacity: 1;
            transform: scale(1.2);
        }
        .bm-default-saved {
            opacity: 1;
            color: #51cf66;
        }

        /* Buttons */
        .bm-btn {
            padding: 7px 14px;
            border: none;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
        }

        .bm-btn:disabled {
            opacity: 0.4;
            cursor: default;
        }

        .bm-btn-save {
            background: linear-gradient(135deg, #4dabf7, #228be6);
            color: white;
        }

        .bm-btn-save:hover:not(:disabled) {
            background: linear-gradient(135deg, #74c0fc, #339af0);
        }

        .bm-btn-save-default {
            background: rgba(255,255,255,0.06);
            color: #a0d8ef;
            border: 1px solid rgba(77,171,247,0.3);
        }

        .bm-btn-save-default:hover:not(:disabled) {
            background: rgba(77,171,247,0.15);
            border-color: rgba(77,171,247,0.5);
        }

        .bm-btn-clear-settings {
            background: rgba(255,255,255,0.06);
            color: #e8d0a0;
            border: 1px solid rgba(255,193,7,0.3);
        }

        .bm-btn-clear-settings:hover:not(:disabled) {
            background: rgba(255,193,7,0.15);
            border-color: rgba(255,193,7,0.5);
        }

        .bm-btn-small {
            padding: 4px 10px;
            font-size: 11px;
        }

        .bm-btn-add-instance {
            background: rgba(77,171,247,0.15);
            color: #4dabf7;
            border: 1px solid rgba(77,171,247,0.3);
        }

        .bm-btn-add-instance:hover {
            background: rgba(77,171,247,0.25);
        }

        .bm-btn-remove-instance {
            background: rgba(255,107,107,0.1);
            color: #ff6b6b;
            border: 1px solid rgba(255,107,107,0.2);
        }

        .bm-btn-remove-instance:hover {
            background: rgba(255,107,107,0.2);
        }

        .bm-btn-retry {
            background: rgba(255,255,255,0.1);
            color: var(--text, #e0e0e0);
        }

        /* Validation */
        .bm-validation {
            padding: 0 18px;
        }

        .bm-validation-ok {
            padding: 8px 0;
            font-size: 12px;
            color: #51cf66;
        }

        .bm-validation-errors {
            padding: 8px 0;
        }

        .bm-validation-title {
            font-size: 12px;
            font-weight: 600;
            color: #ffa94d;
            margin-bottom: 4px;
        }

        .bm-validation-errors ul {
            margin: 0;
            padding-left: 18px;
        }

        .bm-validation-errors li {
            font-size: 12px;
            color: #ffa94d;
            margin-bottom: 2px;
        }

        /* Quick-assign menu */
        .bm-quick-assign {
            background: var(--card-bg, #1e1e3a);
            border: 1px solid var(--border, #444);
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            z-index: 100;
            min-width: 200px;
            overflow: hidden;
        }

        .bm-qa-title {
            padding: 8px 12px;
            font-size: 11px;
            font-weight: 600;
            color: var(--text-secondary, #888);
            border-bottom: 1px solid var(--border, #333);
        }

        .bm-qa-option {
            padding: 8px 12px;
            font-size: 13px;
            color: var(--text, #e0e0e0);
            cursor: pointer;
            transition: background 0.1s;
        }

        .bm-qa-option:hover {
            background: rgba(77,171,247,0.15);
        }

        /* Toast */
        .bm-toast {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%) translateY(100px);
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 500;
            opacity: 0;
            transition: all 0.3s;
            z-index: 200;
            pointer-events: none;
        }

        .bm-toast-visible {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }

        .bm-toast-success {
            background: rgba(81, 207, 102, 0.2);
            border: 1px solid rgba(81, 207, 102, 0.4);
            color: #51cf66;
        }

        .bm-toast-error {
            background: rgba(255, 107, 107, 0.2);
            border: 1px solid rgba(255, 107, 107, 0.4);
            color: #ff6b6b;
        }

        .bm-toast-info {
            background: rgba(77, 171, 247, 0.2);
            border: 1px solid rgba(77, 171, 247, 0.4);
            color: #4dabf7;
        }

        /* Loading / Error / Empty states */
        .bm-loading, .bm-error, .bm-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
            text-align: center;
        }

        .bm-spinner {
            width: 32px;
            height: 32px;
            border: 3px solid rgba(77,171,247,0.2);
            border-top-color: #4dabf7;
            border-radius: 50%;
            animation: bm-spin 0.8s linear infinite;
            margin-bottom: 12px;
        }

        @keyframes bm-spin {
            to { transform: rotate(360deg); }
        }

        .bm-loading span, .bm-empty p, .bm-error p {
            font-size: 13px;
            color: var(--text-secondary, #888);
        }

        .bm-error-icon, .bm-empty-icon {
            font-size: 32px;
            margin-bottom: 8px;
        }

        .bm-pool-empty {
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: var(--text-secondary, #666);
        }
    `;

    document.head.appendChild(style);
})();
