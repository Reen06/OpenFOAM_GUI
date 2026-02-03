/**
 * API Client for OpenFOAM Web Propeller GUI
 */

// Get base URL from current path (handles sub-app mounting)
const BASE_URL = window.location.pathname.replace(/\/$/, '');

const API = {
    baseUrl: BASE_URL,

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const response = await fetch(url, { ...defaultOptions, ...options });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || 'API request failed');
        }

        return data;
    },

    // Mesh Upload
    async uploadMeshFiles(rotorFile, statorFile) {
        const formData = new FormData();
        formData.append('rotor_file', rotorFile);
        formData.append('stator_file', statorFile);

        const response = await fetch(BASE_URL + '/api/mesh/upload', {
            method: 'POST',
            body: formData
        });

        return response.json();
    },

    // Run Management
    async createRun(rotorFilename, statorFilename, runName = null) {
        return this.request('/api/run/create', {
            method: 'POST',
            body: JSON.stringify({
                rotor_filename: rotorFilename,
                stator_filename: statorFilename,
                run_name: runName
            })
        });
    },

    async createPolymesh(runId) {
        return this.request(`/api/run/${runId}/create-polymesh`, {
            method: 'POST'
        });
    },

    async listRuns() {
        return this.request('/api/run/list');
    },

    async getRunDetails(runId) {
        return this.request(`/api/run/${runId}`);
    },

    async startRun(runId, solverSettings, materialSettings, inletVelocity = null) {
        return this.request(`/api/run/${runId}/start`, {
            method: 'POST',
            body: JSON.stringify({
                run_id: runId,
                solver_settings: solverSettings,
                material_settings: materialSettings,
                inlet_velocity: inletVelocity
            })
        });
    },

    async stopRun(runId) {
        return this.request(`/api/run/${runId}/stop`, {
            method: 'POST'
        });
    },

    async archiveRun(runId) {
        return this.request(`/api/run/${runId}/archive`, {
            method: 'POST'
        });
    },

    async unarchiveRun(runId) {
        return this.request(`/api/run/${runId}/unarchive`, {
            method: 'POST'
        });
    },

    async deleteRun(runId) {
        return this.request(`/api/run/${runId}`, {
            method: 'DELETE'
        });
    },

    // Patches
    async getPatches(runId) {
        return this.request(`/api/run/${runId}/patches`);
    },

    // Mesh Management
    async listMeshes() {
        return this.request('/api/meshes');
    },

    async saveMesh(runId, meshName) {
        const formData = new FormData();
        formData.append('run_id', runId);
        formData.append('mesh_name', meshName);

        const response = await fetch(BASE_URL + '/api/mesh/save', {
            method: 'POST',
            body: formData
        });

        return response.json();
    },

    async loadMesh(runId, meshName) {
        const formData = new FormData();
        formData.append('run_id', runId);
        formData.append('mesh_name', meshName);

        const response = await fetch(BASE_URL + '/api/mesh/load', {
            method: 'POST',
            body: formData
        });

        return response.json();
    },

    async deleteMesh(meshName) {
        return this.request(`/api/mesh/${meshName}`, {
            method: 'DELETE'
        });
    },

    downloadMesh(meshId) {
        window.location.href = BASE_URL + `/api/mesh/download/${meshId}`;
    },

    // Smoke Test
    async runSmokeTest() {
        return this.request('/api/smoke-test', {
            method: 'POST'
        });
    },

    // Job Status
    async getJobStatus(jobId) {
        return this.request(`/api/job/${jobId}/status`);
    },

    // Performance Analysis
    async getPerformance(runId) {
        return this.request(`/api/run/${runId}/performance`);
    },

    async triggerAnalysis(runId, settings = null) {
        return this.request(`/api/run/${runId}/analyze`, {
            method: 'POST',
            body: settings ? JSON.stringify(settings) : undefined
        });
    },

    // Paraview Helper
    async calculateParaviewSettings(targetFps, playbackSpeed, endTime, writeInterval) {
        const formData = new FormData();
        formData.append('target_fps', targetFps);
        formData.append('playback_speed', playbackSpeed);
        formData.append('simulation_end_time', endTime);
        formData.append('write_interval', writeInterval);

        const response = await fetch(BASE_URL + '/api/paraview/calculate', {
            method: 'POST',
            body: formData
        });

        return response.json();
    }
};

// Export for use in other modules
window.API = API;
