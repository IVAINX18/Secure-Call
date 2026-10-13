import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Upload, RefreshCw } from 'lucide-react';
import { fileToBase64, snapshotVideoFrame } from '../lib/biometricApi';

interface BiometricCaptureProps {
  onCapture: (imageBase64: string) => void;
  onClear: () => void;
  disabled?: boolean;
}

// Webcam snapshot (getUserMedia + canvas JPEG) with an upload fallback for
// devices without a camera. Emits raw base64 (no data: prefix) via onCapture.
const BiometricCapture: React.FC<BiometricCaptureProps> = ({ onCapture, onClear, disabled }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState('');

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreaming(false);
  };

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const startCamera = async () => {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser or context exposes no camera (getUserMedia unavailable). Use the upload fallback below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreaming(true);
    } catch {
      setCameraError('Camera access was denied or no camera is available. Use the upload fallback below.');
    }
  };

  const takeSnapshot = () => {
    if (!videoRef.current) {
      return;
    }
    try {
      const raw = snapshotVideoFrame(videoRef.current);
      setPreview(`data:image/jpeg;base64,${raw}`);
      onCapture(raw);
    } catch {
      setCameraError('Could not grab a frame from the camera yet. Wait for the preview and retry.');
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const raw = await fileToBase64(file);
      setPreview(`data:image/jpeg;base64,${raw}`);
      onCapture(raw);
    } catch {
      setCameraError('Could not read the selected file.');
    } finally {
      e.target.value = '';
    }
  };

  const clear = () => {
    setPreview(null);
    onClear();
  };

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-md overflow-hidden">
        {preview && !streaming ? (
          <img src={preview} alt="Captured face preview" className="w-full max-h-64 object-contain" />
        ) : (
          <video ref={videoRef} muted playsInline className="w-full max-h-64 object-contain bg-gray-900" />
        )}
        {!streaming && !preview && (
          <p className="text-center text-sm text-gray-400 py-10">Camera preview appears here</p>
        )}
      </div>

      {cameraError && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2" role="alert">
          {cameraError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!streaming ? (
          <button
            type="button"
            onClick={startCamera}
            disabled={disabled}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            <Camera className="h-4 w-4 mr-2" />
            Start camera
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={takeSnapshot}
              disabled={disabled}
              className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              <Camera className="h-4 w-4 mr-2" />
              Capture photo
            </button>
            <button
              type="button"
              onClick={stopCamera}
              className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
            >
              <CameraOff className="h-4 w-4 mr-2" />
              Stop camera
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          <Upload className="h-4 w-4 mr-2" />
          Or upload an image
        </button>
        {preview && (
          <button
            type="button"
            onClick={clear}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Clear
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
    </div>
  );
};

export default BiometricCapture;
