/**
 * OpenFOAM Blank Module Template - API Client
 *
 * TODO: Add your custom API methods below the generic ones.
 * See BLANK_MODULE_GUIDE.md for instructions.
 */

// Get base URL from current path (handles sub-app mounting)
const BASE_URL = window.location.pathname.replace(/\/$/, '');

const API = {
    // Base fetch wrapper with error handling
    async fetch(url, options = {}) {
        try {
            const response = await fetch(BASE_URL + url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.detail || `HTTP ${response.status}`);
            }

            return response.json();
        } catch (error) {
            console.error(`API Error (${url}):`, error);
            throw error;
        }
    },

    // User Defaults
    async getDefaults() {
        return this.fetch('/api/defaults');
    },

    async saveDefaults(defaults) {
        return this.fetch('/api/defaults', {
            method: 'POST',
            body: JSON.stringify(defaults)
        });
    },

    // Mesh Library
    async listMeshLibrary() {
        return this.fetch('/api/mesh/library');
    },

    async deleteMesh(meshId) {
        return this.fetch(`/api/mesh/library/${meshId}`, { method: 'DELETE' });
    },

    async useMeshFromLibrary(meshId, runName = null) {
        return this.fetch(`/api/mesh/library/${meshId}/use`, {
            method: 'POST',
            body: JSON.stringify({ run_name: runName })
        });
    },

    // Mesh Upload
    async uploadMesh(formData) {
        const response = await fetch(BASE_URL + '/api/mesh/upload', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || `HTTP ${response.status}`);
        }

        return response.json();
    },

    // Runs
    async listRuns() {
        return this.fetch('/api/run/list');
    },

    async getRunDetails(runId) {
        return this.fetch(`/api/run/${runId}`);
    },

    async getRunPatches(runId) {
        return this.fetch(`/api/run/${runId}/patches`);
    },

    async createPolyMesh(runId) {
        return this.fetch(`/api/run/${runId}/create-polymesh`, { method: 'POST' });
    },

    async startRun(runId, caseSettings) {
        return this.fetch(`/api/run/${runId}/start`, {
            method: 'POST',
            body: JSON.stringify({
                run_id: runId,
                case_settings: caseSettings
            })
        });
    },

    async stopRun(runId) {
        return this.fetch(`/api/run/${runId}/stop`, { method: 'POST' });
    },

    async deleteRun(runId) {
        return this.fetch(`/api/run/${runId}`, { method: 'DELETE' });
    },

    async getParaViewOutputs(runId) {
        return this.fetch(`/api/run/${runId}/paraview`);
    },

    async getJobStatus(runId) {
        return this.fetch(`/api/job/${runId}/status`);
    }

    // TODO: Add your custom API methods here.
    // Example:
    //
    //   async getResults(runId) {
    //       return this.fetch(`/api/run/${runId}/results`);
    //   },
};
