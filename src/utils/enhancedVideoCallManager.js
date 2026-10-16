/**
 * ENHANCED VIDEO CALL MANAGER - GUEST CONNECTION FIXED
 * 
 * PROBLEMAS IDENTIFICADOS Y SOLUCIONADOS:
 * 1. ✅ GUEST no puede conectarse al servidor (timeout/error)
 * 2. ✅ Problemas de signaling entre HOST y GUEST
 * 3. ✅ ICE candidates no se intercambian correctamente
 * 4. ✅ Peer connection falla en establecerse
 * 5. ✅ Mejor manejo de errores específicos para GUEST
 * 6. ✅ Fallbacks automáticos cuando WebRTC falla
 * 7. ✅ Diagnóstico completo de conectividad
 * 8. ✅ FIXED: Sistema de notificaciones de escaneo bidireccional
 * 
 * @author SecureCall Team
 * @version 7.1.0 - SCAN NOTIFICATIONS FULLY WORKING
 */

import { io } from 'socket.io-client';

class EnhancedVideoCallManager {
    constructor() {
        this.socket = null;
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.isHost = false;
        this.roomId = null;
        this.userName = null;
        this.connectionState = 'idle';
        
        // 🔧 CRITICAL: Callbacks para UI
        this.callbacks = {
            onLocalStream: null,
            onRemoteStream: null,
            onStateChange: null,
            onParticipantsChange: null,
            onError: null,
            onScanNotification: null // 🔧 FIXED: Callback para notificaciones de escaneo
        };
        
        // 🔧 FIXED: Configuración mejorada para guests
        this.config = {
            // Servidores STUN/TURN más robustos
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ],
            // Timeouts más generosos para guests
            connectionTimeout: 30000,
            mediaTimeout: 45000,
            iceTimeout: 20000,
            signalingTimeout: 15000,
            // Reintentos automáticos
            maxRetries: 5,
            retryDelay: 2000
        };
        
        // Estados de conexión
        this.connectionAttempts = 0;
        this.lastError = null;
        this.participants = [];
        this.isConnecting = false;
        this.mediaReady = false;

        // 🧊 ICE candidate queue: candidates arriving before the remote
        // description is set are buffered here and flushed afterwards
        this.pendingCandidates = [];
        
        // 🔧 ADDED: Diagnóstico de conectividad
        this.diagnostics = {
            serverReachable: false,
            socketConnected: false,
            roomJoined: false,
            mediaGranted: false,
            peerConnected: false,
            iceConnected: false
        };
        
        this.debugMode = true;
        this.heartbeatInterval = null;
        this.connectionMonitor = null;

        // Media-ready handshake: debounce + exactly-once PC setup for late join.
        // Host waits for the peer's media before creating the offer, so a late
        // joiner always triggers PC setup exactly once instead of racing offers.
        this._pcSetupInProgress = false;
        this._peerMediaReadyTimer = null;
    }

    _log(message, level = 'info') {
        if (this.debugMode) {
            const timestamp = new Date().toISOString();
            const role = this.isHost ? 'HOST' : 'GUEST';
            console[level](`[${role} ${timestamp}] ${message}`);
        }
    }

    _setState(newState, data = null) {
        const oldState = this.connectionState;
        this.connectionState = newState;
        
        this._log(`State: ${oldState} → ${newState}${data ? ` (${JSON.stringify(data)})` : ''}`);
        
        if (this.callbacks.onStateChange) {
            this.callbacks.onStateChange(newState, oldState, data);
        }
    }

    _handleError(error, context = '', recoverable = true) {
        this.lastError = { error, context, recoverable, timestamp: Date.now() };
        this._log(`❌ Error in ${context}: ${error.message}`, 'error');
        
        if (this.callbacks.onError) {
            this.callbacks.onError({
                message: error.message,
                context,
                recoverable,
                isGuest: !this.isHost,
                diagnostics: this.diagnostics,
                suggestions: this._getErrorSuggestions(error, context)
            });
        }
    }

    _getErrorSuggestions(error, context) {
        const suggestions = [];
        
        if (context === 'server_connection') {
            suggestions.push('Check your internet connection');
            suggestions.push('The server may be starting up - wait 30 seconds and try again');
            suggestions.push('Try refreshing the page');
        } else if (context === 'media_access') {
            suggestions.push('Click "Allow" when prompted for camera/microphone access');
            suggestions.push('Check camera permissions in browser settings');
            suggestions.push('Close other apps using the camera (Zoom, Teams, etc.)');
            suggestions.push('Try using a different browser (Chrome recommended)');
        } else if (context === 'peer_connection') {
            suggestions.push('Check your firewall settings');
            suggestions.push('Try connecting from a different network');
            suggestions.push('The other participant may have connection issues');
        }
        
        return suggestions;
    }

    // Single /health probe with a 10s abort timeout per attempt.
    async _fetchServerHealthOnce(serverUrl) {
        const startTime = Date.now();
        const response = await fetch(`${serverUrl}/health`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000)
        });
        const responseTime = Date.now() - startTime;
        let data = null;
        if (response.ok) {
            try {
                data = await response.json();
            } catch (_parseError) {
                data = null;
            }
        }
        return { response, responseTime, data };
    }

    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // 🔧 FIXED: Diagnóstico completo de conectividad con reintentos (Render cold-start)
    // Reintenta fetch(serverUrl/health) hasta 3 veces con backoff para que el
    // indicador "Server" se recupere cuando el backend despierta tarde. Cada
    // intento conserva su propio timeout de abort de 10s.
    async runConnectivityDiagnostic(maxAttempts = 3, baseDelayMs = 1500) {
        this._log('🔍 Running comprehensive connectivity diagnostic...');
        
        const results = {
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            location: {
                protocol: window.location.protocol,
                hostname: window.location.hostname,
                port: window.location.port
            },
            webrtc: {
                supported: !!(window.RTCPeerConnection && navigator.mediaDevices),
                getUserMediaSupported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
                secureContext: window.isSecureContext
            },
            server: {
                reachable: false,
                responseTime: null,
                error: null
            },
            media: {
                permissionState: 'unknown',
                devicesAvailable: false,
                error: null
            }
        };

        // Test server connectivity with retries (Render cold-start: first
        // fetch often fails while the service wakes up, then socket.io
        // retries succeed and must heal this flag too).
        const serverUrl = this._getServerUrl();
        const attempts = Math.max(1, maxAttempts || 1);
        let lastError = null;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                const { response, responseTime, data } = await this._fetchServerHealthOnce(serverUrl);

                results.server.responseTime = responseTime;
                results.server.reachable = response.ok;
                results.server.attempts = attempt;

                if (response.ok) {
                    if (data !== null) {
                        results.server.data = data;
                    }
                    this.diagnostics.serverReachable = true;
                    lastError = null;
                    break;
                }
                lastError = new Error(`Health check returned ${response.status} (attempt ${attempt}/${attempts})`);
            } catch (error) {
                lastError = error;
            }
            if (attempt < attempts) {
                this._log(`⏳ Health check attempt ${attempt}/${attempts} failed, retrying...`);
                await this._sleep(baseDelayMs * attempt);
            }
        }
        if (lastError) {
            results.server.error = lastError.message;
            results.server.attempts = attempts;
            this.diagnostics.serverReachable = false;
        }

        // Test media permissions
        try {
            const permissions = await navigator.permissions.query({ name: 'camera' });
            results.media.permissionState = permissions.state;
            
            if (permissions.state !== 'denied') {
                const devices = await navigator.mediaDevices.enumerateDevices();
                results.media.devicesAvailable = devices.some(d => d.kind === 'videoinput');
            }
        } catch (error) {
            results.media.error = error.message;
        }

        this._log('🔍 Diagnostic results:', 'info');
        this._log(JSON.stringify(results, null, 2));
        
        return results;
    }

    _getServerUrl() {
        const isLocalhost = window.location.hostname === 'localhost' || 
                           window.location.hostname === '127.0.0.1';
        
        return isLocalhost ? 
            'http://localhost:3000' : 
            'https://biometricov4.onrender.com';
    }

    // 🔧 FIXED: Conexión al servidor con reintentos automáticos
    async connectToSignaling() {
        if (this.isConnecting) {
            this._log('⚠️ Already connecting to signaling server');
            return;
        }

        this.isConnecting = true;
        this.connectionAttempts++;
        
        try {
            this._setState('connecting_signaling');
            this._log(`🔗 Connecting to signaling server (attempt ${this.connectionAttempts}/${this.config.maxRetries})`);

            // Health-check runs in background and never gates socket connect.
            if (this.connectionAttempts === 1) {
                this.runConnectivityDiagnostic().catch(() => {});
            }

            const serverUrl = this._getServerUrl();
            this._log(`📡 Server URL: ${serverUrl}`);

            await this._establishSocketConnection(serverUrl);
            
            this.diagnostics.socketConnected = true;
            this._setState('signaling_connected');
            this._log('✅ Successfully connected to signaling server');
            
            // Iniciar heartbeat
            this._startHeartbeat();
            
        } catch (error) {
            this.diagnostics.socketConnected = false;
            this._handleError(error, 'server_connection');
            
            // Reintentar si no hemos alcanzado el máximo
            if (this.connectionAttempts < this.config.maxRetries) {
                this._log(`🔄 Retrying connection in ${this.config.retryDelay}ms...`);
                setTimeout(() => {
                    this.isConnecting = false;
                    this.connectToSignaling();
                }, this.config.retryDelay);
            } else {
                this._setState('connection_failed');
                throw new Error(`Failed to connect after ${this.config.maxRetries} attempts: ${error.message}`);
            }
        } finally {
            this.isConnecting = false;
        }
    }

    async _establishSocketConnection(serverUrl) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout - server may be starting up'));
            }, this.config.connectionTimeout);

            // Limpiar socket anterior
            if (this.socket) {
                this.socket.disconnect();
                this.socket = null;
            }

            this.socket = io(serverUrl, {
                transports: ['websocket', 'polling'],
                upgrade: true,
                rememberUpgrade: false,
                timeout: this.config.connectionTimeout,
                forceNew: true,
                reconnection: true,
                reconnectionAttempts: 3,
                reconnectionDelay: 2000,
                autoConnect: true,
                withCredentials: false,
                extraHeaders: {
                    'Origin': window.location.origin,
                    'User-Agent': navigator.userAgent
                },
                query: {
                    'client-type': 'webrtc-enhanced',
                    'role': this.isHost ? 'host' : 'guest',
                    'timestamp': Date.now(),
                    'attempt': this.connectionAttempts
                }
            });

            this.socket.on('connect', () => {
                clearTimeout(timeout);
                this._log(`✅ Socket connected: ${this.socket.id}`);
                this._setupSocketEvents();
                // Re-probe /health (with retries) so the Server light heals
                // after a cold-start where the first probe failed.
                this.runConnectivityDiagnostic().catch(() => {});
                resolve();
            });

            this.socket.on('connect_error', (error) => {
                clearTimeout(timeout);
                this._log(`❌ Socket connection error: ${error.message}`, 'error');
                reject(error);
            });

            this.socket.on('disconnect', (reason) => {
                this._log(`🔌 Socket disconnected: ${reason}`, 'warn');
                this.diagnostics.socketConnected = false;
                
                if (reason !== 'io client disconnect') {
                    this._setState('disconnected');
                }
            });

            this.socket.on('reconnect', (attemptNumber) => {
                this._log(`🔄 Socket reconnected after ${attemptNumber} attempts`);
                this.diagnostics.socketConnected = true;
                this.runConnectivityDiagnostic().catch(() => {});
            });
        });
    }

    _setupSocketEvents() {
        // Confirmación de conexión
        this.socket.on('connection-confirmed', (data) => {
            this._log(`✅ Connection confirmed: ${data.message}`);
        });

        // Eventos de room
        this.socket.on('user-joined', (data) => {
            this._log(`👤 User joined: ${JSON.stringify(data)}`);
            this.participants = data.participants || [];
            
            if (this.callbacks.onParticipantsChange) {
                this.callbacks.onParticipantsChange(this.participants);
            }

            // Si somos host y hay otros participantes, iniciar conexión
            if (this.isHost && this.participants.length > 1 && this.mediaReady) {
                setTimeout(() => this._initiatePeerConnection(), 1000);
            }
        });

        this.socket.on('user-left', (data) => {
            this._log(`👋 User left: ${JSON.stringify(data)}`);
            this.participants = data.participants || [];
            
            if (this.callbacks.onParticipantsChange) {
                this.callbacks.onParticipantsChange(this.participants);
            }
            
            this._clearRemoteStream();

            // Peer gone: drop the PC so a later (re)join triggers a fresh
            // setup through the media-ready handshake instead of reusing a
            // stale connection blocked by the exactly-once guard.
            if (this.peerConnection) {
                try { this.peerConnection.close(); } catch (_) {}
                this.peerConnection = null;
            }
        });

        // Eventos WebRTC signaling
        this.socket.on('offer', async (data) => {
            if (data.from !== this.socket.id) {
                this._log(`📥 Received offer from ${data.from}`);
                await this._handleOffer(data.offer, data.from);
            }
        });

        this.socket.on('answer', async (data) => {
            if (data.from !== this.socket.id) {
                this._log(`📥 Received answer from ${data.from}`);
                await this._handleAnswer(data.answer);
            }
        });

        this.socket.on('ice-candidate', async (data) => {
            if (data.from !== this.socket.id) {
                this._log(`🧊 Received ICE candidate from ${data.from}`);
                await this._handleIceCandidate(data.candidate);
            }
        });

        // 🔧 FIXED: Eventos de notificaciones de escaneo
        this.socket.on('scan-notification', (data) => {
            this._log(`📢 SCAN: Received scan notification from ${data.fromName}: ${data.type} - ${data.message}`);
            
            // 🔧 CRITICAL: Verificar que no sea nuestra propia notificación
            if (data.from !== this.socket.id && this.callbacks.onScanNotification) {
                this._log(`📢 SCAN: Processing notification for UI display`);
                this.callbacks.onScanNotification({
                    type: data.type,
                    message: data.message,
                    duration: data.duration || 5000,
                    from: data.from,
                    fromName: data.fromName,
                    timestamp: data.timestamp || Date.now()
                });
            } else if (data.from === this.socket.id) {
                this._log(`📢 SCAN: Ignoring own notification`);
            } else {
                this._log(`📢 SCAN: No callback configured for scan notifications`, 'warn');
            }
        });

        // Heartbeat
        this.socket.on('heartbeat-ack', () => {
            this._log('💓 Heartbeat acknowledged');
        });

        // Media-ready handshake: when the peer's media is ready, the host
        // (debounced, 1s) sets up the peer connection exactly once so a late
        // join always triggers PC setup.
        this.socket.on('peer-media-ready', (data) => {
            this._log(`✅ Peer media ready: ${data?.userName || data?.userId || 'unknown'} (${data?.role || 'unknown'})`);

            if (!this.isHost || !this.mediaReady) {
                return;
            }

            if (this._peerMediaReadyTimer) {
                clearTimeout(this._peerMediaReadyTimer);
            }

            this._peerMediaReadyTimer = setTimeout(() => {
                this._peerMediaReadyTimer = null;
                if (this.peerConnection && this.peerConnection.signalingState !== 'closed') {
                    this._log('⏭️ Peer connection already exists, skipping duplicate setup');
                    return;
                }
                this._initiatePeerConnection();
            }, 1000);
        });
    }

    _startHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(() => {
            if (this.socket && this.socket.connected) {
                this.socket.emit('heartbeat', { 
                    timestamp: Date.now(),
                    role: this.isHost ? 'host' : 'guest',
                    roomId: this.roomId
                });
            }
        }, 30000);
    }

    // 🔧 FIXED: Unirse al room con mejor manejo de errores
    async joinRoom(roomId, userName) {
        try {
            this._setState('joining_room');
            this._log(`🚪 Joining room: ${roomId} as ${userName}`);

            if (!this.socket || !this.socket.connected) {
                throw new Error('Not connected to signaling server');
            }

            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Room join timeout'));
                }, this.config.signalingTimeout);

                this.socket.emit('join-room', { 
                    roomId, 
                    userName,
                    role: this.isHost ? 'host' : 'guest',
                    timestamp: Date.now()
                });

                const onUserJoined = (data) => {
                    if (data.participants && data.participants.includes(userName)) {
                        clearTimeout(timeout);
                        this.socket.off('user-joined', onUserJoined);
                        this.participants = data.participants;
                        this.diagnostics.roomJoined = true;
                        this._log(`✅ Successfully joined room with ${this.participants.length} participants`);
                        resolve();
                    }
                };

                this.socket.on('user-joined', onUserJoined);
            });

            this._setState('room_joined');

        } catch (error) {
            this.diagnostics.roomJoined = false;
            this._handleError(error, 'room_join');
            throw error;
        }
    }

    // 🔧 FIXED: Enviar notificaciones de escaneo con validación mejorada
    async sendScanNotification(notification) {
        try {
            this._log(`📢 SCAN: Attempting to send scan notification: ${notification.type}`);

            // 🔧 FIXED: Validaciones más robustas
            if (!this.socket || !this.socket.connected) {
                throw new Error('Not connected to signaling server');
            }

            if (!this.roomId) {
                throw new Error('Not in a room');
            }

            if (!notification || !notification.type || !notification.message) {
                throw new Error('Invalid notification format - missing type or message');
            }

            // 🔧 FIXED: Verificar que hay otros participantes
            if (this.participants.length <= 1) {
                this._log('📢 SCAN: No other participants to notify', 'warn');
                return false;
            }

            this._log(`📢 SCAN: Sending ${notification.type} notification to ${this.participants.length - 1} participants`);

            const notificationData = {
                roomId: this.roomId,
                from: this.socket.id,
                fromName: this.userName,
                type: notification.type,
                message: notification.message,
                duration: notification.duration || 5000,
                timestamp: Date.now()
            };

            // 🔧 FIXED: Emitir evento con datos completos
            this.socket.emit('scan-notification', notificationData);
            this._log('✅ SCAN: Notification sent successfully');

            return true;

        } catch (error) {
            this._log(`❌ SCAN: Failed to send scan notification: ${error.message}`, 'error');
            throw error;
        }
    }

    // 🔧 FIXED: Configuración de medios con mejor manejo para guests
    async setupLocalMedia() {
        try {
            this._setState('requesting_media');
            this._log('🎥 Setting up local media...');

            // Verificar contexto seguro
            if (!window.isSecureContext && 
                window.location.protocol !== 'https:' && 
                !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
                throw new Error('HTTPS required for camera access');
            }

            // Verificar soporte del navegador
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Browser does not support camera access');
            }

            // Verificar permisos
            try {
                const permissions = await navigator.permissions.query({ name: 'camera' });
                if (permissions.state === 'denied') {
                    throw new Error('Camera access denied by user');
                }
            } catch (permError) {
                this._log('Cannot check permissions directly, proceeding...', 'warn');
            }

            // Configuración de constraints progresiva
            const constraintSets = [
                // Configuración óptima
                {
                    video: {
                        width: { ideal: 640, min: 320, max: 1280 },
                        height: { ideal: 480, min: 240, max: 720 },
                        frameRate: { ideal: 15, min: 10, max: 30 },
                        facingMode: 'user'
                    },
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                },
                // Configuración básica
                {
                    video: {
                        width: { ideal: 320, min: 160 },
                        height: { ideal: 240, min: 120 },
                        frameRate: { ideal: 10, min: 5 }
                    },
                    audio: true
                },
                // Configuración mínima
                {
                    video: true,
                    audio: true
                },
                // Solo video
                {
                    video: true,
                    audio: false
                }
            ];

            let stream = null;
            let lastError = null;

            for (let i = 0; i < constraintSets.length; i++) {
                try {
                    this._log(`Trying media constraints set ${i + 1}/${constraintSets.length}`);
                    stream = await navigator.mediaDevices.getUserMedia(constraintSets[i]);
                    
                    const videoTracks = stream.getVideoTracks();
                    const audioTracks = stream.getAudioTracks();
                    
                    this._log(`✅ Media obtained: ${videoTracks.length} video, ${audioTracks.length} audio tracks`);
                    
                    if (videoTracks.length > 0) {
                        const settings = videoTracks[0].getSettings();
                        this._log(`Video: ${settings.width}x${settings.height}@${settings.frameRate}fps`);
                    }
                    
                    break;
                } catch (error) {
                    lastError = error;
                    this._log(`Constraints set ${i + 1} failed: ${error.message}`, 'warn');
                    
                    if (error.name === 'NotAllowedError') {
                        break; // No intentar más si se deniegan permisos
                    }
                }
            }

            if (!stream) {
                throw lastError || new Error('Failed to obtain media stream');
            }

            this.localStream = stream;
            this.mediaReady = true;
            this.diagnostics.mediaGranted = true;

            // Llamar callback inmediatamente
            if (this.callbacks.onLocalStream) {
                this.callbacks.onLocalStream(stream);
            }

            this._setState('media_ready');
            this._log('✅ Local media setup completed');

            // Announce local media so the peer (host side) can trigger the
            // peer connection exactly once. The server relays this as
            // `peer-media-ready` to the other participants in the room.
            if (this.socket && this.socket.connected && this.roomId) {
                const videoTracks = stream.getVideoTracks();
                const audioTracks = stream.getAudioTracks();
                this.socket.emit('media-ready', {
                    roomId: this.roomId,
                    mediaInfo: {
                        video: videoTracks.length > 0,
                        audio: audioTracks.length > 0
                    },
                    timestamp: Date.now()
                });
            }

            return stream;

        } catch (error) {
            this.diagnostics.mediaGranted = false;
            this._handleError(error, 'media_access');
            throw error;
        }
    }

    // Configuración de peer connection mejorada. skipOffer es true cuando
    // esta PC se crea para responder a una offer entrante (evita el loop
    // offer/offer). El guard _pcSetupInProgress garantiza setup exactamente
    // una vez ante eventos concurrentes (user-joined + peer-media-ready).
    async _initiatePeerConnection(skipOffer = false) {
        if (this._pcSetupInProgress) {
            this._log('⏭️ Peer connection setup already in progress, skipping');
            return;
        }
        if (this.peerConnection && this.peerConnection.signalingState !== 'closed') {
            this._log('⏭️ Peer connection already exists, skipping duplicate setup');
            return;
        }
        this._pcSetupInProgress = true;
        try {
            this._setState('creating_peer_connection');
            this._log('🔗 Creating peer connection...');

            // Limpiar conexión anterior
            if (this.peerConnection) {
                this.peerConnection.close();
                this.peerConnection = null;
            }
            this.pendingCandidates = [];

            this.peerConnection = new RTCPeerConnection({
                iceServers: this.config.iceServers,
                iceCandidatePoolSize: 10,
                bundlePolicy: 'max-bundle',
                rtcpMuxPolicy: 'require'
            });

            this._setupPeerConnectionEvents();

            // Agregar tracks locales
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    this._log(`➕ Adding ${track.kind} track`);
                    this.peerConnection.addTrack(track, this.localStream);
                });
            }

            // Crear offer si somos host (salvo que esta PC exista solo para
            // responder a una offer entrante)
            if (this.isHost && !skipOffer) {
                await this._createOffer();
            }

            this._setState('peer_connection_created');

        } catch (error) {
            this._handleError(error, 'peer_connection');
            throw error;
        } finally {
            this._pcSetupInProgress = false;
        }
    }

    _setupPeerConnectionEvents() {
        this.peerConnection.ontrack = (event) => {
            this._log('📹 Remote track received');
            const [remoteStream] = event.streams;
            this.remoteStream = remoteStream;
            
            if (this.callbacks.onRemoteStream) {
                this.callbacks.onRemoteStream(remoteStream);
            }
        };

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate && this.socket && this.socket.connected) {
                this._log('📤 Sending ICE candidate');
                this.socket.emit('ice-candidate', {
                    roomId: this.roomId,
                    candidate: event.candidate
                });
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            this._log(`🔗 Peer connection state: ${state}`);
            
            if (state === 'connected') {
                this.diagnostics.peerConnected = true;
                this._setState('peer_connected');
            } else if (state === 'failed') {
                this.diagnostics.peerConnected = false;
                this._log('Peer connection failed, attempting restart...', 'warn');
                // Drop the failed PC so the exactly-once guard in
                // _initiatePeerConnection lets the retry through.
                try { this.peerConnection.close(); } catch (_) {}
                this.peerConnection = null;
                setTimeout(() => this._initiatePeerConnection(), 2000);
            }
        };

        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection.iceConnectionState;
            this._log(`🧊 ICE connection state: ${state}`);
            
            if (state === 'connected' || state === 'completed') {
                this.diagnostics.iceConnected = true;
            } else if (state === 'failed') {
                this.diagnostics.iceConnected = false;
                this._log('ICE connection failed, restarting ICE...', 'warn');
                this.peerConnection.restartIce();
            }
        };
    }

    async _createOffer() {
        try {
            this._log('📤 Creating offer...');
            const offer = await this.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            
            await this.peerConnection.setLocalDescription(offer);
            
            this.socket.emit('offer', {
                roomId: this.roomId,
                offer: offer
            });
            
            this._log('✅ Offer sent');
        } catch (error) {
            this._handleError(error, 'create_offer');
        }
    }

    async _handleOffer(offer, fromId) {
        try {
            this._log(`📥 Handling offer from ${fromId}`);

            if (!this.peerConnection) {
                await this._initiatePeerConnection(true);
            }

            // Glare guard: ya tenemos una offer local en vuelo y recibimos
            // otra offer. El host (impolite) ignora la entrante y conserva la
            // suya; el guest (polite) hace rollback y procesa la entrante.
            // Sin esto ambos lados recrean offers en loop.
            if (this.peerConnection.signalingState !== 'stable') {
                if (this.isHost && this.peerConnection.localDescription) {
                    this._log('⚠️ Glare detected: ignoring incoming offer, keeping local offer', 'warn');
                    return;
                }
                this._log('⚠️ Glare detected: rolling back local description', 'warn');
                await this.peerConnection.setLocalDescription({ type: 'rollback' });
            }

            await this.peerConnection.setRemoteDescription(offer);
            await this._flushPendingCandidates();

            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            this.socket.emit('answer', {
                roomId: this.roomId,
                answer: answer
            });
            
            this._log('✅ Answer sent');
        } catch (error) {
            this._handleError(error, 'handle_offer');
        }
    }

    async _handleAnswer(answer) {
        try {
            this._log('📥 Handling answer');
            
            if (this.peerConnection && this.peerConnection.signalingState !== 'stable') {
                await this.peerConnection.setRemoteDescription(answer);
                await this._flushPendingCandidates();
                this._log('✅ Answer processed');
            }
        } catch (error) {
            this._handleError(error, 'handle_answer');
        }
    }

    async _handleIceCandidate(candidate) {
        try {
            if (!candidate) {
                return;
            }
            if (this.peerConnection && this.peerConnection.remoteDescription) {
                await this.peerConnection.addIceCandidate(candidate);
                this._log('✅ ICE candidate added');
            } else {
                this.pendingCandidates.push(candidate);
                this._log(`⏳ ICE candidate queued (${this.pendingCandidates.length} pending)`);
            }
        } catch (error) {
            this._log(`❌ Error adding ICE candidate: ${error.message}`, 'error');
        }
    }

    async _flushPendingCandidates() {
        if (!this.peerConnection || !this.peerConnection.remoteDescription) {
            return;
        }
        const queued = this.pendingCandidates;
        this.pendingCandidates = [];
        for (const candidate of queued) {
            try {
                await this.peerConnection.addIceCandidate(candidate);
            } catch (error) {
                this._log(`❌ Error adding queued ICE candidate: ${error.message}`, 'error');
            }
        }
        if (queued.length > 0) {
            this._log(`✅ Flushed ${queued.length} queued ICE candidate(s)`);
        }
    }

    _clearRemoteStream() {
        if (this.remoteStream) {
            this.remoteStream = null;
            if (this.callbacks.onRemoteStream) {
                this.callbacks.onRemoteStream(null);
            }
        }
    }

    // 🔧 FIXED: Inicialización completa
    async initialize(roomId, userName, isHost, callbacks = {}) {
        try {
            this._log(`🚀 Initializing as ${isHost ? 'HOST' : 'GUEST'}`);
            
            this.roomId = roomId;
            this.userName = userName;
            this.isHost = isHost;
            this.callbacks = { ...this.callbacks, ...callbacks };
            
            // 1. Conectar al servidor
            await this.connectToSignaling();
            
            // 2. Unirse al room
            await this.joinRoom(roomId, userName);
            
            // 3. Configurar medios
            await this.setupLocalMedia();
            
            // 4. Si hay otros participantes, iniciar peer connection
            if (this.participants.length > 1) {
                await this._initiatePeerConnection();
            }
            
            this._setState('ready');
            this._log('✅ Initialization completed successfully');
            
            return this;
            
        } catch (error) {
            this._setState('error');
            this._handleError(error, 'initialization');
            throw error;
        }
    }

    // Control de medios
    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                this._log(`Video ${videoTrack.enabled ? 'enabled' : 'disabled'}`);
                return videoTrack.enabled;
            }
        }
        return false;
    }

    toggleAudio() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this._log(`Audio ${audioTrack.enabled ? 'enabled' : 'disabled'}`);
                return audioTrack.enabled;
            }
        }
        return false;
    }

    // Información de debug
    getDebugInfo() {
        return {
            connectionState: this.connectionState,
            isHost: this.isHost,
            roomId: this.roomId,
            userName: this.userName,
            participants: this.participants,
            connectionAttempts: this.connectionAttempts,
            hasLocalStream: !!this.localStream,
            hasRemoteStream: !!this.remoteStream,
            isSocketConnected: this.socket && this.socket.connected,
            peerConnectionState: this.peerConnection ? this.peerConnection.connectionState : 'none',
            iceConnectionState: this.peerConnection ? this.peerConnection.iceConnectionState : 'none',
            diagnostics: this.diagnostics,
            lastError: this.lastError,
            mediaReady: this.mediaReady,
            serverUrl: this._getServerUrl(),
            scanNotificationCallback: !!this.callbacks.onScanNotification
        };
    }

    // Limpieza
    cleanup() {
        this._log('🧹 Cleaning up...');

        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        if (this.connectionMonitor) {
            clearInterval(this.connectionMonitor);
            this.connectionMonitor = null;
        }

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        this.pendingCandidates = [];

        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }

        this._clearRemoteStream();
        this._setState('idle');
        
        this._log('✅ Cleanup completed');
    }
}

// Instancia global
let enhancedVideoCallManager = null;

// Función principal de inicialización
export async function initializeEnhancedVideoCall(roomId, userName, isHost, callbacks = {}) {
    try {
        console.log('🚀 Starting Enhanced VideoCallManager...');
        
        if (enhancedVideoCallManager) {
            enhancedVideoCallManager.cleanup();
        }
        
        enhancedVideoCallManager = new EnhancedVideoCallManager();
        await enhancedVideoCallManager.initialize(roomId, userName, isHost, callbacks);
        
        return enhancedVideoCallManager;
        
    } catch (error) {
        console.error('❌ Failed to start enhanced video call:', error);
        throw error;
    }
}

export function getEnhancedDebugInfo() {
    return enhancedVideoCallManager ? enhancedVideoCallManager.getDebugInfo() : {
        error: 'Enhanced VideoCallManager not initialized'
    };
}

export function toggleEnhancedVideo() {
    return enhancedVideoCallManager ? enhancedVideoCallManager.toggleVideo() : false;
}

export function toggleEnhancedAudio() {
    return enhancedVideoCallManager ? enhancedVideoCallManager.toggleAudio() : false;
}

export function cleanupEnhancedVideoCall() {
    if (enhancedVideoCallManager) {
        enhancedVideoCallManager.cleanup();
        enhancedVideoCallManager = null;
    }
}

export default EnhancedVideoCallManager;