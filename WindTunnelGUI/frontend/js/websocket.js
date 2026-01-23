/**
 * OpenFOAM Web Wind Tunnel GUI - WebSocket Manager
 * (Copied from PropellerGUI implementation)
 */

class WebSocketManager {
    constructor() {
        this.socket = null;
        this.runId = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.onLogCallback = null;
        this.onProgressCallback = null;
        this.onCompleteCallback = null;
        this.onErrorCallback = null;
        this.onConnectionChange = null;
    }

    connect(runId) {
        console.log('[WS] connect() called with runId:', runId);

        // Close existing connection if connecting to a different run
        if (this.socket && this.runId !== runId) {
            console.log('[WS] Closing existing connection to', this.runId);
            this.intentionalClose = true;  // Don't reset buttons when switching runs
            this.socket.close();
            this.socket = null;
        }

        this.runId = runId;
        this.reconnectAttempts = 0;
        this._connect();
    }

    _connect() {
        // Only skip if already connected to the SAME run
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            console.log('[WS] Already connected to', this.runId);
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const basePath = window.location.pathname.replace(/\/$/, '');
        const wsUrl = `${protocol}//${window.location.host}${basePath}/ws/logs/${this.runId}`;

        try {
            console.log('[WS] Creating WebSocket to:', wsUrl);
            this.socket = new WebSocket(wsUrl);

            this.socket.onopen = () => {
                console.log('[WS] Connected to run:', this.runId);
                this.reconnectAttempts = 0;
                if (this.onConnectionChange) {
                    this.onConnectionChange('connected');
                }
            };

            this.socket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                console.log('[WS] Message received:', data.type, data.line ? data.line.substring(0, 50) : '');
                this._handleMessage(data);
            };

            this.socket.onclose = () => {
                console.log('WebSocket closed');
                if (this.onConnectionChange) {
                    this.onConnectionChange('disconnected');
                }

                // Only reset buttons if this was an UNEXPECTED close (not intentional switch)
                if (!this.intentionalClose) {
                    const runBtn = document.getElementById('run-simulation-btn');
                    const stopBtn = document.getElementById('stop-simulation-btn');
                    if (runBtn) runBtn.disabled = false;
                    if (stopBtn) stopBtn.disabled = true;
                }
                this.intentionalClose = false;

                this._attemptReconnect();
            };

            this.socket.onerror = (error) => {
                console.error('WebSocket error:', error);
                if (this.onConnectionChange) {
                    this.onConnectionChange('error');
                }
            };
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
        }
    }

    _handleMessage(data) {
        switch (data.type) {
            case 'log':
                if (this.onLogCallback) {
                    this.onLogCallback(data);
                }
                break;

            case 'progress':
                if (this.onProgressCallback) {
                    this.onProgressCallback(data);
                }
                break;

            case 'complete':
                if (this.onCompleteCallback) {
                    this.onCompleteCallback(data);
                }
                break;

            case 'error':
                if (this.onErrorCallback) {
                    this.onErrorCallback(data);
                }
                break;

            case 'pong':
                // Heartbeat response
                break;
        }
    }

    _attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
            setTimeout(() => this._connect(), 2000 * this.reconnectAttempts);
        }
    }

    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    }

    sendPing() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send('ping');
        }
    }

    // Event handlers - set these before calling connect()
    onLog(callback) {
        this.onLogCallback = callback;
    }

    onProgress(callback) {
        this.onProgressCallback = callback;
    }

    onComplete(callback) {
        this.onCompleteCallback = callback;
    }

    onError(callback) {
        this.onErrorCallback = callback;
    }

    onConnection(callback) {
        this.onConnectionChange = callback;
    }
}

// Export
window.WebSocketManager = WebSocketManager;
