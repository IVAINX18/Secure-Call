import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Upload, RefreshCw } from 'lucide-react';
import { fileToBase64, snapshotVideoFrame } from '../lib/biometricApi';
import { Button } from './ui';

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
      <div className="overflow-hidden rounded-card border border-faded bg-mist">
        {preview && !streaming ? (
          <img src={preview} alt="Captured face preview" className="min-h-[240px] w-full bg-mist object-contain" />
        ) : (
          <>
            <video ref={videoRef} muted playsInline aria-label="Camera preview" className={`w-full object-cover ${streaming ? 'min-h-[240px]' : 'hidden'}`} />
            {!streaming && (
              <div className="flex min-h-[240px] w-full flex-col items-center justify-center gap-2 px-4 py-6">
                <Camera className="h-8 w-8 text-ink" aria-hidden="true" />
                <p className="text-sm font-medium text-ink">Camera preview appears here</p>
              </div>
            )}
          </>
        )}
      </div>

      {cameraError && (
        <p className="rounded-card border border-faded bg-mist px-3 py-2 text-sm font-normal text-ink" role="alert">
          {cameraError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!streaming ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={startCamera}
            disabled={disabled}
            aria-label="Start camera"
            className="min-h-[44px]"
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
            Start camera
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={takeSnapshot}
              disabled={disabled}
              aria-label="Capture photo"
              className="min-h-[44px]"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              Capture photo
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={stopCamera}
              aria-label="Stop camera"
              className="min-h-[44px]"
            >
              <CameraOff className="h-4 w-4" aria-hidden="true" />
              Stop camera
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          aria-label="Upload an image instead"
          className="min-h-[44px]"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Or upload an image
        </Button>
        {preview && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clear}
            aria-label="Clear captured image"
            className="min-h-[44px]"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Clear
          </Button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} aria-label="Choose an image file" />
      </div>
    </div>
  );
};

export default BiometricCapture;
