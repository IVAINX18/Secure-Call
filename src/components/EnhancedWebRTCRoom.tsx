import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Video, Mic, MicOff, VideoOff, PhoneOff, Users, AlertCircle, RefreshCw, Settings, Activity, Wifi, Shield, Camera, Fingerprint, Scan, Eye, TestTube, Wrench } from 'lucide-react';
import { initializeEnhancedVideoCall, getEnhancedDebugInfo, toggleEnhancedVideo, toggleEnhancedAudio, cleanupEnhancedVideoCall } from '../utils/enhancedVideoCallManager.js';
import { Button, Card, Spinner, Tag } from './ui';
import { useRole } from '../contexts/RoleContext';

interface EnhancedWebRTCRoomProps {
  userName: string;
  roomId: string;
  onEndCall: () => void;
  isHost?: boolean;
}

const EnhancedWebRTCRoom: React.FC<EnhancedWebRTCRoomProps> = ({ userName, roomId, onEndCall, isHost: isHostProp }) => {
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const enhancedManagerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Role comes from RoleContext (written by RoleSelector); an explicit
  // isHost prop from the parent takes precedence when provided.
  const { role } = useRole();
  const resolvedIsHost = isHostProp ?? role === 'host';
  
  // Estados principales
  const [connectionState, setConnectionState] = useState<string>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [participants, setParticipants] = useState<string[]>([]);
  const [error, setError] = useState<any>(null);
  
  // Estados de UI
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  
  // Estados de timing y diagnóstico
  const [joinStartTime, setJoinStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [isGuest, setIsGuest] = useState(false);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  
  // Estados de animación de escaneo (propios)
  const [faceScanning, setFaceScanning] = useState(false);
  const [handScanning, setHandScanning] = useState(false);

  // 🔧 NUEVO: Estados de animación de escaneo recibido (sobre video local)
  const [receivingFaceScan, setReceivingFaceScan] = useState(false);
  const [receivingHandScan, setReceivingHandScan] = useState(false);

  // Estado para controlar visibilidad del video local
  const [showLocalVideo, setShowLocalVideo] = useState(true);
  const [forceLocalVideoVisible, setForceLocalVideoVisible] = useState(false);

  // 🔧 NUEVO: Estados para resolución responsiva
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });
  const [videoAspectRatio, setVideoAspectRatio] = useState(16/9);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 🔧 FIXED: Estado para notificaciones recibidas con mejor tipado
  const [receivedNotification, setReceivedNotification] = useState<{
    type: string;
    message: string;
    timestamp: number;
    fromName?: string;
  } | null>(null);

  // 🔧 NUEVO: Hook para detectar cambios de tamaño del contenedor
  useEffect(() => {
    let rafId = 0;
    let retries = 0;
    const updateContainerDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if ((rect.width === 0 || rect.height === 0) && retries < 10) {
          retries += 1;
          rafId = requestAnimationFrame(updateContainerDimensions);
          return;
        }
        setContainerDimensions({
          width: rect.width,
          height: rect.height
        });
      }
    };

    // Actualizar dimensiones iniciales
    updateContainerDimensions();

    // Escuchar cambios de tamaño
    const resizeObserver = new ResizeObserver(updateContainerDimensions);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Escuchar cambios de orientación en móviles
    window.addEventListener('orientationchange', updateContainerDimensions);
    window.addEventListener('resize', updateContainerDimensions);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener('orientationchange', updateContainerDimensions);
      window.removeEventListener('resize', updateContainerDimensions);
    };
  }, []);

  // 🔧 NUEVO: Calcular dimensiones óptimas del video
  const calculateOptimalVideoDimensions = useCallback(() => {
    const { width: containerWidth, height: containerHeight } = containerDimensions;
    
    if (containerWidth === 0 || containerHeight === 0) {
      return { width: '100%', height: '100%', objectFit: 'cover' as const };
    }

    // Reservar espacio para controles (120px en la parte inferior)
    const availableHeight = containerHeight - 120;
    const availableWidth = containerWidth;

    // Calcular dimensiones basadas en aspect ratio
    const containerAspectRatio = availableWidth / availableHeight;
    
    let videoWidth, videoHeight, objectFit: 'cover' | 'contain' = 'contain';

    if (videoAspectRatio > containerAspectRatio) {
      // Video es más ancho que el contenedor
      videoWidth = availableWidth;
      videoHeight = availableWidth / videoAspectRatio;
      
      // Si la altura calculada es mayor que la disponible, usar contain
      if (videoHeight > availableHeight) {
        videoHeight = availableHeight;
        videoWidth = availableHeight * videoAspectRatio;
        objectFit = 'contain';
      }
    } else {
      // Video es más alto que el contenedor
      videoHeight = availableHeight;
      videoWidth = availableHeight * videoAspectRatio;
      
      // Si el ancho calculado es mayor que el disponible, usar contain
      if (videoWidth > availableWidth) {
        videoWidth = availableWidth;
        videoHeight = availableWidth / videoAspectRatio;
        objectFit = 'contain';
      }
    }

    return {
      width: `${Math.min(videoWidth, availableWidth)}px`,
      height: `${Math.min(videoHeight, availableHeight)}px`,
      objectFit
    };
  }, [containerDimensions, videoAspectRatio]);

  // 🔧 NUEVO: Detectar aspect ratio del video remoto
  const handleRemoteVideoMetadata = useCallback(() => {
    if (remoteVideoRef.current) {
      const video = remoteVideoRef.current;
      if (video.videoWidth && video.videoHeight) {
        const aspectRatio = video.videoWidth / video.videoHeight;
        setVideoAspectRatio(aspectRatio);
        console.log(`📐 Remote video aspect ratio detected: ${aspectRatio.toFixed(2)} (${video.videoWidth}x${video.videoHeight})`);
      }
    }
  }, []);

  // 🔧 NUEVO: Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch(console.error);
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      }).catch(console.error);
    }
  }, []);

  // Actualizar tiempo transcurrido
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (joinStartTime && !['ready', 'peer_connected', 'error'].includes(connectionState)) {
      interval = setInterval(() => {
        setElapsedTime(Date.now() - joinStartTime);
      }, 100);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [joinStartTime, connectionState]);

  const formatElapsedTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    return `${seconds}s`;
  };

  const getStateMessage = () => {
    switch (connectionState) {
      case 'idle':
        return 'Initializing...';
      case 'connecting_signaling':
        return `Connecting to server... (${formatElapsedTime(elapsedTime)})`;
      case 'signaling_connected':
        return 'Connected to server';
      case 'joining_room':
        return `Joining room... (${formatElapsedTime(elapsedTime)})`;
      case 'room_joined':
        return 'Room joined successfully';
      case 'requesting_media':
        return `Requesting camera permissions... (${formatElapsedTime(elapsedTime)})`;
      case 'media_ready':
        return 'Camera ready - waiting for participants';
      case 'creating_peer_connection':
        return 'Establishing connection...';
      case 'peer_connected':
        return 'Call active - Enhanced WebRTC';
      case 'ready':
        return 'Ready for call';
      case 'error':
        return 'Connection error';
      case 'disconnected':
        return 'Disconnected';
      default:
        return connectionState;
    }
  };

  const getStateColor = () => {
    switch (connectionState) {
      case 'peer_connected':
      case 'ready':
        return 'bg-iris';
      case 'connecting_signaling':
      case 'joining_room':
      case 'requesting_media':
      case 'creating_peer_connection':
        return 'bg-indigo';
      case 'error':
        return 'bg-ink';
      case 'disconnected':
        return 'bg-ink/60';
      default:
        return 'bg-iris';
    }
  };

  // Callback para manejar stream local
  const handleLocalStream = useCallback((stream: MediaStream) => {
    console.log("🎥 Local stream received - ASSIGNING TO VIDEO ELEMENT:", stream);
    console.log("🎥 Video tracks:", stream.getVideoTracks().length);
    console.log("🎥 Audio tracks:", stream.getAudioTracks().length);
    
    setLocalStream(stream);
    
    const assignStreamToVideo = () => {
      if (localVideoRef.current && stream) {
        console.log("🎥 Assigning local stream to video element");
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
        
        localVideoRef.current.play().then(() => {
          console.log("✅ Local video is now playing and visible");
          setShowLocalVideo(true);
        }).catch(error => {
          console.error("❌ Local video play failed:", error);
          setTimeout(() => {
            if (localVideoRef.current && localVideoRef.current.paused) {
              localVideoRef.current.play().catch(console.error);
            }
          }, 1000);
        });
      } else {
        console.error("❌ Local video ref is null or stream is null!");
        setTimeout(assignStreamToVideo, 100);
      }
    };
    
    assignStreamToVideo();
    setTimeout(assignStreamToVideo, 50);
  }, []);

  // Callback para manejar stream remoto
  const handleRemoteStream = useCallback((stream: MediaStream | null) => {
    console.log("🖼️ Remote stream received:", stream);
    setRemoteStream(stream);
    
    if (stream && remoteVideoRef.current) {
      console.log("🖼️ Assigning remote stream to video element");
      remoteVideoRef.current.srcObject = stream;
      
      // 🔧 NUEVO: Configurar event listener para metadata
      remoteVideoRef.current.onloadedmetadata = handleRemoteVideoMetadata;
      
      remoteVideoRef.current.play().then(() => {
        console.log("✅ Remote video is now playing with audio");
      }).catch(error => {
        console.error("❌ Remote video play failed:", error);
      });
    } else if (!stream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  }, [handleRemoteVideoMetadata]);

  // Callback para cambios de estado
  const handleStateChange = useCallback((newState: string, oldState: string, data: any) => {
    console.log(`🔄 State change: ${oldState} → ${newState}`, data);
    setConnectionState(newState);
    
    if (data && data.diagnostics) {
      setDiagnostics(data.diagnostics);
    }
  }, []);

  // Callback para cambios de participantes
  const handleParticipantsChange = useCallback((newParticipants: string[]) => {
    console.log("👥 Participants changed:", newParticipants);
    setParticipants(newParticipants);
  }, []);

  // Callback para errores
  const handleError = useCallback((errorInfo: any) => {
    console.error("❌ Error received:", errorInfo);
    setError(errorInfo);
    setConnectionState('error');
  }, []);

  // 🔧 ENHANCED: Callback para manejar notificaciones de escaneo con animación local
  const handleScanNotification = useCallback((notification: any) => {
    console.log('📢 SCAN: Notification received:', notification);
    
    if (notification && notification.type && notification.message) {
      console.log(`📢 SCAN: Processing ${notification.type} from ${notification.fromName || 'unknown'}`);
      
      // 🔧 NUEVO: Activar animación sobre video local según el tipo de escaneo
      if (notification.type === 'face_scan') {
        console.log('🎭 NUEVO: Activating face scan animation on local video');
        setReceivingFaceScan(true);
        setTimeout(() => {
          setReceivingFaceScan(false);
          console.log('🎭 NUEVO: Face scan animation on local video completed');
        }, notification.duration || 5000);
      } else if (notification.type === 'hand_scan') {
        console.log('👋 NUEVO: Activating hand scan animation on local video');
        setReceivingHandScan(true);
        setTimeout(() => {
          setReceivingHandScan(false);
          console.log('👋 NUEVO: Hand scan animation on local video completed');
        }, notification.duration || 5000);
      }
      
      // Mantener la notificación existente
      setReceivedNotification({
        type: notification.type,
        message: notification.message,
        timestamp: Date.now(),
        fromName: notification.fromName
      });
      
      // Auto-ocultar después de la duración especificada
      const duration = notification.duration || 5000;
      setTimeout(() => {
        setReceivedNotification(null);
        console.log('📢 SCAN: Notification cleared after', duration, 'ms');
      }, duration);
    } else {
      console.error('📢 SCAN: Invalid notification format:', notification);
    }
  }, []);

  // Forzar video local
  const handleForceLocalVideo = useCallback(() => {
    console.log('🔧 FORCE: Forcing local video to be visible and playing');
    setForceLocalVideoVisible(true);
    setShowLocalVideo(true);
    
    if (localVideoRef.current && localStream) {
      console.log('🔧 FORCE: Re-assigning local stream');
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.muted = true;
      
      localVideoRef.current.play().then(() => {
        console.log('✅ FORCE: Local video forced to play successfully');
        setForceLocalVideoVisible(false);
      }).catch(error => {
        console.error('❌ FORCE: Force play failed:', error);
        setForceLocalVideoVisible(false);
      });
    }
  }, [localStream]);

  // Inicialización automática
  useEffect(() => {
    const initializeCall = async () => {
      try {
        setConnectionState('idle');
        setJoinStartTime(Date.now());
        setError(null);

        console.log('🚀 Initializing Enhanced VideoCallManager...');

        // Role is determined by RoleContext (host = offerer, guest = answerer).
        const isHost = resolvedIsHost;
        setIsGuest(!isHost);
        
        console.log(`🎭 Role determined - ${isHost ? 'HOST' : 'GUEST'}`);
        
        // 🔧 FIXED: Configurar callbacks incluyendo onScanNotification
        const callbacks = {
          onLocalStream: handleLocalStream,
          onRemoteStream: handleRemoteStream,
          onStateChange: handleStateChange,
          onParticipantsChange: handleParticipantsChange,
          onError: handleError,
          onScanNotification: handleScanNotification
        };
        
        const manager = await initializeEnhancedVideoCall(roomId, userName, isHost, callbacks);
        enhancedManagerRef.current = manager;
        
        console.log('✅ Enhanced VideoCallManager initialized');
        
        const debugInterval = setInterval(() => {
          const debug = getEnhancedDebugInfo();
          setDebugInfo(debug);
          setDiagnostics(debug.diagnostics);
        }, 2000);
        
        return () => clearInterval(debugInterval);
        
      } catch (err: any) {
        console.error('❌ Failed to initialize Enhanced VideoCallManager:', err);
        
        let errorMessage = err.message;
        let suggestions = err.suggestions || [];
        
        if (err.context === 'server_connection') {
          suggestions = [
            'Check your internet connection',
            'The server may be starting up - wait 30 seconds and try again',
            'Try refreshing the page'
          ];
        } else if (err.context === 'media_access') {
          suggestions = [
            'Click "Allow" when prompted for camera/microphone access',
            'Check camera permissions in browser settings',
            'Close other apps using the camera (Zoom, Teams, etc.)',
            'Try using a different browser (Chrome recommended)'
          ];
        }
        
        setError({
          message: errorMessage,
          suggestions: suggestions,
          context: err.context,
          isGuest: err.isGuest,
          diagnostics: err.diagnostics,
          originalError: err
        });
        setConnectionState('error');
      }
    };

    initializeCall();
    
    return () => {
      if (enhancedManagerRef.current) {
        cleanupEnhancedVideoCall();
        enhancedManagerRef.current = null;
      }
    };
  }, [roomId, userName, resolvedIsHost, handleLocalStream, handleRemoteStream, handleStateChange, handleParticipantsChange, handleError, handleScanNotification]);

  // 🔧 FIXED: Escaneo facial con envío de notificación
  const handleFaceScan = async () => {
    if (faceScanning) return;
    
    setFaceScanning(true);
    console.log('🔍 Starting face scan animation...');
    
    // 🔧 FIXED: Enviar notificación a otros participantes
    if (enhancedManagerRef.current && enhancedManagerRef.current.sendScanNotification) {
      try {
        console.log('📢 SCAN: Sending face scan notification');
        await enhancedManagerRef.current.sendScanNotification({
          type: 'face_scan',
          message: `${userName} está escaneando tu rostro para verificación biométrica`,
          duration: 5000
        });
        console.log('✅ SCAN: Face scan notification sent successfully');
      } catch (err: any) {
        console.error('❌ SCAN: Failed to send face scan notification:', err);
      }
    } else {
      console.error('❌ SCAN: sendScanNotification not available');
    }
    
    setTimeout(() => {
      setFaceScanning(false);
      console.log('✅ Face scan animation completed');
    }, 5000);
  };

  // 🔧 FIXED: Escaneo de mano con envío de notificación
  const handleHandScan = async () => {
    if (handScanning) return;
    
    setHandScanning(true);
    console.log('👋 Starting hand scan animation...');
    
    // 🔧 FIXED: Enviar notificación a otros participantes
    if (enhancedManagerRef.current && enhancedManagerRef.current.sendScanNotification) {
      try {
        console.log('📢 SCAN: Sending hand scan notification');
        await enhancedManagerRef.current.sendScanNotification({
          type: 'hand_scan',
          message: `${userName} está escaneando tu mano para verificación biométrica`,
          duration: 5000
        });
        console.log('✅ SCAN: Hand scan notification sent successfully');
      } catch (err: any) {
        console.error('❌ SCAN: Failed to send hand scan notification:', err);
      }
    } else {
      console.error('❌ SCAN: sendScanNotification not available');
    }
    
    setTimeout(() => {
      setHandScanning(false);
      console.log('✅ Hand scan animation completed');
    }, 5000);
  };

  // Toggle controles
  const handleToggleVideo = () => {
    const enabled = toggleEnhancedVideo();
    setIsVideoEnabled(enabled);
    
    if (localVideoRef.current && localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = enabled;
      }
    }
  };

  const handleToggleAudio = () => {
    const enabled = toggleEnhancedAudio();
    setIsAudioEnabled(enabled);
  };

  // Reintentar conexión
  const handleRetry = async () => {
    setError(null);
    setConnectionState('idle');
    
    if (enhancedManagerRef.current) {
      cleanupEnhancedVideoCall();
      enhancedManagerRef.current = null;
    }
    
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  };

  // Finalizar llamada
  const handleEndCall = () => {
    if (enhancedManagerRef.current) {
      cleanupEnhancedVideoCall();
      enhancedManagerRef.current = null;
    }
    onEndCall();
  };

  // Obtener debug info
  const handleGetDebugInfo = () => {
    const debug = getEnhancedDebugInfo();
    setDebugInfo(debug);
    console.log('📊 Debug Info:', debug);
  };

  // Toggle del video local
  const toggleLocalVideoVisibility = () => {
    setShowLocalVideo(!showLocalVideo);
  };

  // 🔧 NUEVO: Calcular dimensiones del video
  const videoDimensions = calculateOptimalVideoDimensions();

  // Pantalla de conexión
  if (['idle', 'connecting_signaling', 'signaling_connected', 'joining_room'].includes(connectionState)) {
    return (
      <div className="flex items-center justify-center h-full bg-paper text-ink">
        <Card variant="blush" padding="lg" elevated className="text-center max-w-md w-full mx-4">
          <div className="relative mb-6 inline-block">
            <Wifi className="h-16 w-16 text-iris mx-auto animate-pulse" aria-hidden="true" />
            <Tag className="absolute -bottom-2 -right-2 bg-paper">
              {formatElapsedTime(elapsedTime)}
            </Tag>
          </div>

          <h2 className="font-display text-[40px] leading-[1.15] mb-4">
            {connectionState === 'idle' ? 'Initializing Enhanced WebRTC...' : 'Connecting to Room'}
          </h2>

          <p className="font-medium text-ink/70 mb-6">
            Setting up secure video call with enhanced connectivity...
            {isGuest && <span className="block text-iris mt-2">Joining as Guest</span>}
          </p>

          <div className="flex justify-center mb-6" role="status" aria-label="Connecting">
            <Spinner size="lg" />
          </div>

          <div className="text-sm font-medium text-ink/70 space-y-1">
            <p>Room: {roomId}</p>
            <p>User: {userName}</p>
            <p>Role: {isGuest ? 'Guest' : 'Host'}</p>
            <p>Time: {formatElapsedTime(elapsedTime)}</p>
            <p>State: {getStateMessage()}</p>
          </div>

          {diagnostics && (
            <div className="mt-4 text-xs text-ink/60 space-y-1">
              <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${diagnostics.serverReachable ? 'bg-iris' : 'bg-ink'}`} />Server: {diagnostics.serverReachable ? 'Reachable' : '—'}</p>
              <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${diagnostics.socketConnected ? 'bg-iris' : 'bg-ink'}`} />Socket: {diagnostics.socketConnected ? 'Connected' : '—'}</p>
              <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${diagnostics.roomJoined ? 'bg-iris' : 'bg-ink'}`} />Room: {diagnostics.roomJoined ? 'Joined' : '—'}</p>
              <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${diagnostics.mediaGranted ? 'bg-iris' : 'bg-ink'}`} />Media: {diagnostics.mediaGranted ? 'Granted' : '—'}</p>
            </div>
          )}
        </Card>
      </div>
    );
  }

  // Pantalla de solicitud de medios
  if (connectionState === 'requesting_media') {
    return (
      <div className="flex items-center justify-center h-full bg-paper text-ink">
        <Card variant="paper" padding="lg" elevated className="text-center max-w-md w-full mx-4">
          <div className="relative mb-6 inline-block">
            <Camera className="h-16 w-16 text-iris mx-auto animate-pulse" aria-hidden="true" />
            <Tag className="absolute -bottom-2 -right-2 bg-paper">
              {formatElapsedTime(elapsedTime)}
            </Tag>
          </div>

          <h2 className="font-display text-[40px] leading-[1.15] mb-4">Camera Permission Required</h2>

          <p className="font-medium text-ink/70 mb-6">
            Please allow access to your camera and microphone when prompted by your browser.
          </p>

          <div className="bg-blush rounded-card p-4 mb-6">
            <Shield className="h-6 w-6 text-iris mx-auto mb-2" aria-hidden="true" />
            <p className="text-ink text-sm font-medium">
              Waiting for permissions... ({formatElapsedTime(elapsedTime)})
            </p>
            <p className="text-ink/60 text-xs mt-2">
              Look for the permission popup in your browser
            </p>
          </div>

          <div className="flex justify-center mb-6" role="status" aria-label="Waiting for permissions">
            <Spinner size="lg" />
          </div>

          <div className="text-sm font-medium text-ink/70 space-y-1">
            <p><span aria-hidden="true" className="inline-block w-2 h-2 rounded-full mr-1 bg-iris" />Connection: Active</p>
            <p>Participants: {participants.length}</p>
            <p>Timeout: 45 seconds</p>
          </div>
        </Card>
      </div>
    );
  }

  // Pantalla de error mejorada
  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-paper text-ink">
        <Card variant="paper" padding="lg" elevated className="text-center max-w-4xl w-full mx-4">
          <AlertCircle className="h-16 w-16 text-iris mx-auto mb-4" aria-hidden="true" />
          <h3 className="font-display text-[40px] leading-[1.15] mb-2">Connection Error</h3>
          <p className="font-medium text-ink/70 mb-4">{error.message}</p>

          {error.suggestions && error.suggestions.length > 0 && (
            <div className="bg-mist rounded-card p-4 mb-6 text-left border border-faded">
              <h4 className="text-ink font-semibold mb-2">Suggestions:</h4>
              <ul className="text-ink/70 text-sm space-y-1">
                {error.suggestions.map((suggestion: string, index: number) => (
                  <li key={index}><span aria-hidden="true" className="text-iris font-semibold">+ </span>{suggestion}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-4 mb-6">
            <Button
              variant="primary"
              onClick={handleRetry}
            >
              <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
              Try Again
            </Button>

            <Button
              variant="outline"
              onClick={handleEndCall}
            >
              Return to Dashboard
            </Button>

            <Button
              variant="outline"
              onClick={() => setShowDebug(!showDebug)}
            >
              <Settings className="h-4 w-4 mr-2" aria-hidden="true" />
              {showDebug ? 'Hide' : 'Show'} Debug
            </Button>
          </div>

          {showDebug && debugInfo && (
            <div className="bg-mist border border-faded rounded-card p-4 text-left text-xs max-h-64 overflow-y-auto mb-4">
              <h4 className="text-ink font-semibold mb-2">Enhanced Debug Information:</h4>
              <pre className="text-ink/70 whitespace-pre-wrap">
                {JSON.stringify(debugInfo, null, 2)}
              </pre>
            </div>
          )}

          {error.diagnostics && (
            <div className="mt-4 text-sm text-ink/70">
              <p className="font-semibold mb-2 text-ink">Connection Diagnostics:</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${error.diagnostics.serverReachable ? 'bg-iris' : 'bg-ink'}`} />Server: {error.diagnostics.serverReachable ? 'Reachable' : '—'}</div>
                <div><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${error.diagnostics.socketConnected ? 'bg-iris' : 'bg-ink'}`} />Socket: {error.diagnostics.socketConnected ? 'Connected' : '—'}</div>
                <div><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${error.diagnostics.roomJoined ? 'bg-iris' : 'bg-ink'}`} />Room: {error.diagnostics.roomJoined ? 'Joined' : '—'}</div>
                <div><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${error.diagnostics.mediaGranted ? 'bg-iris' : 'bg-ink'}`} />Media: {error.diagnostics.mediaGranted ? 'Granted' : '—'}</div>
                <div><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${error.diagnostics.peerConnected ? 'bg-iris' : 'bg-ink'}`} />Peer: {error.diagnostics.peerConnected ? 'Connected' : '—'}</div>
                <div><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${error.diagnostics.iceConnected ? 'bg-iris' : 'bg-ink'}`} />ICE: {error.diagnostics.iceConnected ? 'Connected' : '—'}</div>
              </div>
            </div>
          )}
        </Card>
      </div>
    );
  }

  // Interfaz principal - Video remoto + video local en picture-in-picture
  return (
    <div ref={containerRef} className="flex flex-col h-full min-h-[480px] w-full bg-paper text-ink relative overflow-hidden">
      {/* 🔧 NUEVO: Contenedor de video responsivo */}
      <div className="flex-1 relative flex items-center justify-center" style={{ minHeight: 0 }}>
        {/* 🔧 NUEVO: Video remoto con dimensiones calculadas */}
        <div
          className="relative bg-mist rounded-card overflow-hidden border border-mist shadow-photo"
          style={{
            width: videoDimensions.width,
            height: videoDimensions.height,
            maxWidth: '100%',
            maxHeight: '100%'
          }}
        >
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full"
            style={{ objectFit: videoDimensions.objectFit }}
            onLoadedMetadata={() => console.log("✅ Remote video metadata loaded")}
            onPlay={() => console.log("✅ Remote video started playing")}
            onError={(e) => console.error("❌ Remote video error:", e)}
          />

          {/* 🔧 NUEVO: Indicador de resolución */}
          <div className="absolute top-2 left-2 bg-paper/90 text-ink text-xs font-medium px-2 py-1 rounded-small border border-faded">
            {containerDimensions.width}x{containerDimensions.height}
            {remoteVideoRef.current?.videoWidth && (
              <span className="ml-1">
                ({remoteVideoRef.current.videoWidth}x{remoteVideoRef.current.videoHeight})
              </span>
            )}
          </div>

          {/* 🔧 NUEVO: Botón de pantalla completa */}
          <button
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
            className="absolute top-2 right-2 min-h-[44px] min-w-[44px] flex items-center justify-center bg-paper/90 hover:bg-mist text-ink rounded-small border border-faded transition-all"
            title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          >
            {isFullscreen ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M3 3h4v2H5v2H3V3zm10 0h4v4h-2V5h-2V3zM3 13v4h4v-2H5v-2H3zm14 0v2h-2v2h-4v-2h2v-2h4z"/>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M3 3v4h2V5h2V3H3zm12 0v2h2v2h2V3h-4zM5 15H3v4h4v-2H5v-2zm10 0v2h2v2h4v-4h-4z"/>
              </svg>
            )}
          </button>
        </div>
        
        {/* Video local (picture-in-picture) con posición responsiva */}
        {showLocalVideo && (
          <div className={`absolute ${
            containerDimensions.width < 768
              ? 'bottom-52 right-2 w-24 h-18'
              : 'top-4 right-4 w-64 h-48'
          } bg-mist rounded-card overflow-hidden shadow-photo border-2 border-ink/20 z-30 relative`}>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              onLoadedMetadata={() => {
                console.log("✅ Local video metadata loaded and ready");
              }}
              onPlay={() => {
                console.log("✅ Local video started playing");
              }}
              onError={(e) => {
                console.error("❌ Local video error:", e);
              }}
            />
            
            {!isVideoEnabled && (
              <div className="absolute inset-0 bg-faded flex items-center justify-center">
                <VideoOff className={`${containerDimensions.width < 768 ? 'h-4 w-4' : 'h-8 w-8'} text-ink/60`} />
              </div>
            )}

            {/* 🔧 NUEVO: Animaciones de escaneo sobre video local cuando se recibe escaneo */}
            {receivingFaceScan && (
              <div className="absolute inset-0 pointer-events-none z-40">
                <div className="relative w-full h-full">
                  {/* Barra de escaneo facial que baja */}
                  <div
                    className="absolute left-0 right-0 h-1 bg-iris shadow-lg"
                    style={{
                      animation: 'localFaceScan 3s ease-in-out infinite',
                      boxShadow: '0 0 15px rgba(43, 24, 155, 0.35)'
                    }}
                  />
                  {/* Overlay de escaneo */}
                  <div className="absolute inset-0 bg-iris/15 border-2 border-iris border-dashed animate-pulse" />
                  {/* Esquinas de escaneo */}
                  <div className="absolute top-2 left-2 w-6 h-6 border-t-2 border-l-2 border-iris"></div>
                  <div className="absolute top-2 right-2 w-6 h-6 border-t-2 border-r-2 border-iris"></div>
                  <div className="absolute bottom-2 left-2 w-6 h-6 border-b-2 border-l-2 border-iris"></div>
                  <div className="absolute bottom-2 right-2 w-6 h-6 border-b-2 border-r-2 border-iris"></div>
                  {/* Texto de escaneo */}
                  <div className="absolute top-1 left-1 bg-iris text-paper px-2 py-1 rounded-small text-xs font-medium">
                    🔍 Siendo Escaneado
                  </div>
                </div>
              </div>
            )}

            {receivingHandScan && (
              <div className="absolute inset-0 pointer-events-none z-40">
                <div className="relative w-full h-full">
                  {/* Círculo pulsante para huella */}
                  <div
                    className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-20 h-20 border-2 border-indigo rounded-full"
                    style={{
                      animation: 'localHandScan 3s ease-in-out infinite',
                      boxShadow: '0 0 20px rgba(33, 19, 117, 0.35)'
                    }}
                  />
                  {/* Líneas de escaneo */}
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                    <div className="w-0.5 h-12 bg-indigo absolute -top-6 left-1/2 transform -translate-x-1/2 animate-pulse"></div>
                    <div className="w-0.5 h-12 bg-indigo absolute -bottom-6 left-1/2 transform -translate-x-1/2 animate-pulse"></div>
                    <div className="h-0.5 w-12 bg-indigo absolute -left-6 top-1/2 transform -translate-y-1/2 animate-pulse"></div>
                    <div className="h-0.5 w-12 bg-indigo absolute -right-6 top-1/2 transform -translate-y-1/2 animate-pulse"></div>
                  </div>
                  {/* Overlay de escaneo */}
                  <div className="absolute inset-0 bg-indigo/15 animate-pulse" />
                  {/* Texto de escaneo */}
                  <div className="absolute top-1 left-1 bg-indigo text-paper px-2 py-1 rounded-small text-xs font-medium">
                    👋 Siendo Escaneado
                  </div>
                </div>
              </div>
            )}
            
            <div className="absolute top-2 left-2">
              <div className={`w-3 h-3 rounded-full ${
                connectionState === 'peer_connected' || connectionState === 'ready' ? 'bg-iris' : 'bg-ink'
              }`}></div>
            </div>

            <div className="absolute top-2 right-2">
              <div className={`px-2 py-1 rounded-small text-xs font-medium border ${
                isGuest ? 'bg-paper text-ink border-faded' : 'bg-iris text-paper border-iris'
              }`}>
                {isGuest ? 'Guest' : 'Host'}
              </div>
            </div>

            <div className="absolute bottom-2 right-2">
              <button
                onClick={toggleLocalVideoVisibility}
                aria-label="Hide/Show local video"
                className="bg-paper/90 hover:bg-mist text-ink border border-faded min-h-[44px] min-w-[44px] flex items-center justify-center p-1 rounded-small"
                title="Hide/Show local video"
              >
                <Eye className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {!showLocalVideo && (
          <div className="absolute top-4 right-4 z-30">
            <button
              onClick={toggleLocalVideoVisibility}
              aria-label="Show local video"
              className="bg-paper/90 hover:bg-mist text-ink border border-faded min-h-[44px] min-w-[44px] flex items-center justify-center p-3 rounded-small"
              title="Show local video"
            >
              <Camera className="h-6 w-6" />
            </button>
          </div>
        )}
        
        {/* Animaciones de escaneo sobre video remoto (cuando YO escaneo) */}
        {faceScanning && (
          <div className="absolute inset-0 pointer-events-none z-20">
            <div className="relative w-full h-full">
              <div
                className="absolute left-0 right-0 h-1 bg-iris shadow-lg"
                style={{
                  animation: 'faceScan 3s ease-in-out',
                  boxShadow: '0 0 20px rgba(43, 24, 155, 0.35)'
                }}
              />
              <div className="absolute inset-0 bg-iris/10 border-2 border-iris border-dashed animate-pulse" />
              <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-iris text-paper px-4 py-2 rounded-pill text-lg font-medium">
                🔍 Escaneando Rostro...
              </div>
              <div className="absolute bottom-32 left-4 right-4 bg-paper/90 border border-faded rounded-card p-3">
                <div className="text-iris text-sm font-medium mb-2">Análisis Facial en Progreso</div>
                <div className="w-full bg-faded rounded-full h-2">
                  <div
                    className="bg-iris h-2 rounded-full"
                    style={{ animation: 'progressBar 3s ease-in-out' }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {handScanning && (
          <div className="absolute inset-0 pointer-events-none z-20">
            <div className="relative w-full h-full">
              <div
                className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-40 h-40 border-4 border-indigo rounded-full"
                style={{
                  animation: 'handScan 3s ease-in-out infinite',
                  boxShadow: '0 0 30px rgba(33, 19, 117, 0.35)',
                  marginTop: '-20px'
                }}
              />
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" style={{ marginTop: '-20px' }}>
                <div className="w-1 h-20 bg-indigo absolute -top-10 left-1/2 transform -translate-x-1/2 animate-pulse"></div>
                <div className="w-1 h-20 bg-indigo absolute -bottom-10 left-1/2 transform -translate-x-1/2 animate-pulse"></div>
                <div className="h-1 w-20 bg-indigo absolute -left-10 top-1/2 transform -translate-y-1/2 animate-pulse"></div>
                <div className="h-1 w-20 bg-indigo absolute -right-10 top-1/2 transform -translate-y-1/2 animate-pulse"></div>
              </div>
              <div className="absolute inset-0 bg-indigo/10" />
              <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-indigo text-paper px-4 py-2 rounded-pill text-lg font-medium">
                👋 Escaneando Mano...
              </div>
              <div className="absolute bottom-32 left-4 right-4 bg-paper/90 border border-faded rounded-card p-3">
                <div className="text-indigo text-sm font-medium mb-2">Análisis Biométrico de Mano</div>
                <div className="w-full bg-faded rounded-full h-2">
                  <div
                    className="bg-indigo h-2 rounded-full"
                    style={{ animation: 'progressBar 3s ease-in-out' }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 🔧 FIXED: Notificación de escaneo recibido - Mejorada con información del remitente */}
        {receivedNotification && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50">
            <div className={`bg-paper/95 text-ink px-10 py-8 rounded-card shadow-photo border-4 ${
              receivedNotification.type === 'face_scan' ? 'border-iris' : 'border-indigo'
            } animate-pulse max-w-md`}>
              <div className="text-center">
                <div className="text-4xl mb-4" aria-hidden="true">
                  {receivedNotification.type === 'face_scan' ? '🔍' : '👋'}
                </div>
                <div className="font-display text-3xl mb-3">¡ALERTA DE ESCANEO!</div>
                <div className="text-lg font-medium text-ink/80 mb-2">{receivedNotification.message}</div>
                {receivedNotification.fromName && (
                  <div className="text-sm text-ink/60 mb-3">
                    De: {receivedNotification.fromName}
                  </div>
                )}
                <div className="text-base font-medium text-iris">
                  {receivedNotification.type === 'face_scan' ? 'Análisis facial en progreso...' : 'Análisis biométrico en progreso...'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Indicadores superiores */}
        <div className="absolute top-4 left-4 z-30">
          <div className={`px-3 py-1 rounded-pill text-sm font-medium text-white ${getStateColor()}`}>
            {getStateMessage()}
          </div>
        </div>

        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-30">
          <div className="bg-paper/90 border border-faded px-3 py-1 rounded-pill text-ink text-sm font-medium flex items-center">
            <Users className="h-4 w-4 mr-1" aria-hidden="true" />
            {participants.length || 1} participant{(participants.length || 1) !== 1 ? 's' : ''}
          </div>
        </div>

        <div className="absolute top-56 right-4 z-30">
          <button
            onClick={() => {
              setShowDebug(!showDebug);
              if (!showDebug) handleGetDebugInfo();
            }}
            aria-expanded={showDebug}
            aria-label="Toggle diagnostics panel"
            className="rounded-small focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30"
          >
            <Tag className="bg-paper/90 hover:bg-mist cursor-pointer">Diagnostics</Tag>
          </button>
        </div>

        {showDebug && debugInfo && (
          <div className="absolute top-64 right-4 z-30 w-80 max-w-[calc(100%-2rem)]">
            <Card variant="mist" padding="sm" className="max-h-64 overflow-y-auto">
              <h4 className="text-ink font-semibold mb-2 text-sm">Enhanced Debug Information:</h4>
              <div className="text-ink text-xs space-y-1">
                <p>State: {connectionState}</p>
                <p>Role: {isGuest ? 'Guest' : 'Host'}</p>
                <p>Attempts: {debugInfo.connectionAttempts}</p>
                <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${debugInfo.hasLocalStream ? 'bg-iris' : 'bg-ink'}`} />Local Stream: {debugInfo.hasLocalStream ? 'On' : '—'}</p>
                <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${debugInfo.hasRemoteStream ? 'bg-iris' : 'bg-ink'}`} />Remote Stream: {debugInfo.hasRemoteStream ? 'On' : '—'}</p>
                <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${debugInfo.isSocketConnected ? 'bg-iris' : 'bg-ink'}`} />Socket: {debugInfo.isSocketConnected ? 'Connected' : '—'}</p>
                <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${debugInfo.peerConnectionState && !['failed', 'disconnected', 'closed'].includes(debugInfo.peerConnectionState) ? 'bg-iris' : 'bg-ink'}`} />Peer State: {debugInfo.peerConnectionState || '—'}</p>
                <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${debugInfo.iceConnectionState && !['failed', 'disconnected', 'closed'].includes(debugInfo.iceConnectionState) ? 'bg-iris' : 'bg-ink'}`} />ICE State: {debugInfo.iceConnectionState || '—'}</p>
                <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${localVideoRef.current?.srcObject ? 'bg-iris' : 'bg-ink'}`} />🔧 Local Video Element: {localVideoRef.current?.srcObject ? 'On' : '—'}</p>
                <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${localVideoRef.current && !localVideoRef.current.paused ? 'bg-iris' : 'bg-ink'}`} />🔧 Local Video Playing: {localVideoRef.current && !localVideoRef.current.paused ? 'On' : '—'}</p>
                <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${showLocalVideo ? 'bg-iris' : 'bg-ink'}`} />🔧 Local Video Visible: {showLocalVideo ? 'On' : '—'}</p>
                <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${debugInfo.scanNotificationCallback ? 'bg-iris' : 'bg-ink'}`} />📢 Scan Callback: {debugInfo.scanNotificationCallback ? 'On' : '—'}</p>
                <p>📢 Notification: {receivedNotification ? `${receivedNotification.type} from ${receivedNotification.fromName}` : 'None'}</p>
                <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${receivingFaceScan ? 'bg-iris' : 'bg-ink'}`} />🎭 Receiving Face Scan: {receivingFaceScan ? 'On' : '—'}</p>
                <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${receivingHandScan ? 'bg-iris' : 'bg-ink'}`} />👋 Receiving Hand Scan: {receivingHandScan ? 'On' : '—'}</p>
                <p>📐 Container: {containerDimensions.width}x{containerDimensions.height}</p>
                <p>📐 Video Aspect: {videoAspectRatio.toFixed(2)}</p>
                <p>📐 Video Size: {videoDimensions.width} x {videoDimensions.height}</p>
                <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${isFullscreen ? 'bg-iris' : 'bg-ink'}`} />🖥️ Fullscreen: {isFullscreen ? 'On' : '—'}</p>
                {debugInfo.diagnostics && (
                  <div className="mt-2 pt-2 border-t border-faded">
                    <p className="font-semibold">Diagnostics:</p>
                    <div className="grid grid-cols-2 gap-2">
                      <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${debugInfo.diagnostics.serverReachable ? 'bg-iris' : 'bg-ink'}`} />Server: {debugInfo.diagnostics.serverReachable ? 'Reachable' : '—'}</p>
                      <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${debugInfo.diagnostics.socketConnected ? 'bg-iris' : 'bg-ink'}`} />Socket: {debugInfo.diagnostics.socketConnected ? 'Connected' : '—'}</p>
                      <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${debugInfo.diagnostics.roomJoined ? 'bg-iris' : 'bg-ink'}`} />Room: {debugInfo.diagnostics.roomJoined ? 'Joined' : '—'}</p>
                      <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${debugInfo.diagnostics.mediaGranted ? 'bg-iris' : 'bg-ink'}`} />Media: {debugInfo.diagnostics.mediaGranted ? 'Granted' : '—'}</p>
                      <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${debugInfo.diagnostics.peerConnected ? 'bg-iris' : 'bg-ink'}`} />Peer: {debugInfo.diagnostics.peerConnected ? 'Connected' : '—'}</p>
                      <p><span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full mr-1 ${debugInfo.diagnostics.iceConnected ? 'bg-iris' : 'bg-ink'}`} />ICE: {debugInfo.diagnostics.iceConnected ? 'Connected' : '—'}</p>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}

        {['media_ready', 'ready'].includes(connectionState) && !remoteStream && (
          <div className="absolute inset-0 flex items-center justify-center bg-paper/70 z-10">
            <div className="text-center text-ink">
              <Users className="h-16 w-16 mx-auto mb-4 text-ink/40" aria-hidden="true" />
              <p className="font-display text-3xl">Waiting for other participants...</p>
              <p className="text-sm font-medium text-ink/60 mt-2">Share the room code to invite others</p>
            </div>
          </div>
        )}
      </div>

      {/* Barra de controles fija */}
      <div className="absolute bottom-0 left-0 right-0 z-40 px-4 pb-4 pt-2">
        <Card variant="paper" padding="sm" elevated className="!rounded-pill w-full md:max-w-3xl md:mx-auto">
          <div className="text-center mb-2">
            <span className="text-ink/60 text-sm font-medium">Room ID: </span>
            <span className="text-ink font-mono bg-mist border border-faded px-2 py-1 rounded-small text-sm">{roomId}</span>
          </div>

          <div className="flex items-center justify-center flex-wrap gap-3 md:gap-4">
            <button
              onClick={handleForceLocalVideo}
              disabled={forceLocalVideoVisible}
              aria-label="Forzar video local"
              className={`p-4 rounded-full transition-all duration-200 min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30 ${
                forceLocalVideoVisible
                  ? 'bg-faded animate-pulse text-ink'
                  : 'bg-mist hover:bg-faded text-ink'
              } disabled:opacity-75`}
              title="Forzar video local"
            >
              <Wrench className="h-6 w-6" aria-hidden="true" />
            </button>

            <div className="h-8 w-px bg-faded" aria-hidden="true"></div>

            <button
              onClick={handleToggleAudio}
              aria-pressed={isAudioEnabled}
              aria-label={isAudioEnabled ? 'Silenciar micrófono' : 'Activar micrófono'}
              className={`p-4 rounded-full transition-all duration-200 min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30 ${
                isAudioEnabled
                  ? 'bg-paper text-ink border border-faded hover:bg-mist'
                  : 'bg-faded text-ink hover:bg-faded/80'
              }`}
              title={isAudioEnabled ? 'Silenciar micrófono' : 'Activar micrófono'}
            >
              {isAudioEnabled ? (
                <Mic className="h-6 w-6" aria-hidden="true" />
              ) : (
                <MicOff className="h-6 w-6" aria-hidden="true" />
              )}
            </button>

            <button
              onClick={handleToggleVideo}
              aria-pressed={isVideoEnabled}
              aria-label={isVideoEnabled ? 'Apagar cámara' : 'Encender cámara'}
              className={`p-4 rounded-full transition-all duration-200 min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30 ${
                isVideoEnabled
                  ? 'bg-paper text-ink border border-faded hover:bg-mist'
                  : 'bg-faded text-ink hover:bg-faded/80'
              }`}
              title={isVideoEnabled ? 'Apagar cámara' : 'Encender cámara'}
            >
              {isVideoEnabled ? (
                <Video className="h-6 w-6" aria-hidden="true" />
              ) : (
                <VideoOff className="h-6 w-6" aria-hidden="true" />
              )}
            </button>

            <div className="h-8 w-px bg-faded" aria-hidden="true"></div>

            {/* Botones de escaneo - SOLO PARA HOST */}
            {!isGuest && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFaceScan}
                  disabled={faceScanning}
                  aria-busy={faceScanning}
                  aria-label="Escanear rostro"
                  title="Escanear rostro"
                  className={`min-h-[44px] min-w-[44px] ${faceScanning ? 'animate-pulse' : ''}`}
                >
                  <Scan className="h-6 w-6" aria-hidden="true" />
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleHandScan}
                  disabled={handScanning}
                  aria-busy={handScanning}
                  aria-label="Escanear mano"
                  title="Escanear mano"
                  className={`min-h-[44px] min-w-[44px] ${handScanning ? 'animate-pulse' : ''}`}
                >
                  <Fingerprint className="h-6 w-6" aria-hidden="true" />
                </Button>
              </>
            )}

            <div className="h-8 w-px bg-faded" aria-hidden="true"></div>

            <button
              onClick={handleGetDebugInfo}
              aria-label="Información de debug"
              className="p-4 rounded-full bg-mist hover:bg-faded text-ink transition-all duration-200 min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30"
              title="Información de debug"
            >
              <Eye className="h-6 w-6" aria-hidden="true" />
            </button>

            <Button
              variant="outline"
              onClick={handleEndCall}
              aria-label="End call"
              title="Colgar llamada"
            >
              <PhoneOff className="h-5 w-5" aria-hidden="true" />
              End call
            </Button>
          </div>

          <div className="flex items-center justify-center flex-wrap gap-x-4 gap-y-1 mt-2 text-sm font-medium text-ink/60">
            <div className="flex items-center space-x-1">
              <div className={`w-2 h-2 rounded-full ${
                ['peer_connected', 'ready'].includes(connectionState) ? 'bg-iris' : 'bg-ink'
              }`} aria-hidden="true"></div>
              <span>Conexión</span>
            </div>

            <div className="flex items-center space-x-1">
              <div className={`w-2 h-2 rounded-full ${
                isGuest ? 'bg-ink/40' : 'bg-iris'
              }`} aria-hidden="true"></div>
              <span>{isGuest ? 'Invitado' : 'Anfitrión'}</span>
            </div>

            <div className="flex items-center space-x-1">
              <div className={`w-2 h-2 rounded-full ${
                showLocalVideo ? 'bg-iris' : 'bg-ink'
              }`} aria-hidden="true"></div>
              <span>Video Local</span>
            </div>

            {(faceScanning || handScanning) && (
              <div className="flex items-center space-x-1">
                <div className="w-2 h-2 rounded-full bg-iris animate-pulse" aria-hidden="true"></div>
                <span>Escaneando...</span>
              </div>
            )}

            {(receivingFaceScan || receivingHandScan || receivedNotification) && (
              <div className="flex items-center space-x-1">
                <div className="w-2 h-2 rounded-full bg-indigo animate-pulse" aria-hidden="true"></div>
                <span>Siendo Escaneado</span>
              </div>
            )}
          </div>
        </Card>
      </div>

      <style jsx>{`
        @keyframes faceScan {
          0% { top: 0; opacity: 1; }
          50% { top: 50%; opacity: 0.8; }
          100% { top: 100%; opacity: 0; }
        }
        
        @keyframes handScan {
          0% { transform: translate(-50%, -50%) scale(0.8); opacity: 1; }
          50% { transform: translate(-50%, -50%) scale(1.2); opacity: 0.6; }
          100% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; }
        }
        
        @keyframes localFaceScan {
          0% { top: 0; opacity: 1; }
          50% { top: 50%; opacity: 0.8; }
          100% { top: 100%; opacity: 0; }
        }
        
        @keyframes localHandScan {
          0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
          50% { transform: translate(-50%, -50%) scale(1.0); opacity: 0.6; }
          100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
        }
        
        @keyframes progressBar {
          0% { width: 0%; }
          100% { width: 100%; }
        }
      `}</style>
    </div>
  );
};

export default EnhancedWebRTCRoom;