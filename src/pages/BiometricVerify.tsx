import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ScanFace, CheckCircle2, XCircle, Video, Square, Upload } from 'lucide-react';
import BiometricTokenField from '../components/BiometricTokenField';
import BiometricCapture from '../components/BiometricCapture';
import Logo from '../components/Logo';
import {
  BiometricApiError,
  fileToBase64,
  getBiometricToken,
  sampleVideoFrames,
  setBiometricToken,
  verifyFace,
  verifyLiveness,
  type LivenessResult,
  type VerifyResult,
} from '../lib/biometricApi';

// Frames sent per liveness attempt: above the engine MIN_FRAMES (5).
const LIVENESS_FRAMES = 8;
// Spacing between frames: 8 frames x 300ms ~= 2.4s of video (12.9).
const LIVENESS_INTERVAL_MS = 300;

// Public page (like Login): verify a face via POST /api/v1/verify (12.5-12.8)
// and run a liveness check via POST /api/v1/verify-liveness (12.9-12.10).
const BiometricVerify: React.FC = () => {
  const [token, setToken] = useState(getBiometricToken());
  const [image, setImage] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const [liveVideo, setLiveVideo] = useState(false);
  const [livenessResult, setLivenessResult] = useState<LivenessResult | null>(null);
  const [livenessError, setLivenessError] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordedFrames, setRecordedFrames] = useState(0);
  const livenessVideoRef = useRef<HTMLVideoElement | null>(null);
  const livenessStreamRef = useRef<MediaStream | null>(null);
  const livenessFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      livenessStreamRef.current?.getTracks().forEach((track) => track.stop());
      livenessStreamRef.current = null;
    };
  }, []);

  const handleTokenChange = (value: string) => {
    setToken(value);
    setBiometricToken(value);
  };

  const requireToken = (): string | null => {
    if (!token.trim()) {
      setVerifyError('Paste a biometric API token first (401 otherwise).');
      return null;
    }
    return token.trim();
  };

  const handleVerify = async () => {
    setVerifyResult(null);
    setVerifyError('');
    const bearer = requireToken();
    if (!bearer || !image) {
      if (!image) {
        setVerifyError('Capture a photo or upload an image first.');
      }
      return;
    }
    setVerifying(true);
    try {
      setVerifyResult(await verifyFace(image, bearer));
    } catch (err) {
      setVerifyError(err instanceof BiometricApiError ? err.detail : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const startLivenessCamera = async () => {
    setLivenessError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setLivenessError('This browser or context exposes no camera. Use an image as static frames instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      livenessStreamRef.current = stream;
      if (livenessVideoRef.current) {
        livenessVideoRef.current.srcObject = stream;
        await livenessVideoRef.current.play();
      }
      setLiveVideo(true);
    } catch {
      setLivenessError('Camera access was denied or no camera is available. Use an image as static frames instead.');
    }
  };

  const sendLivenessFrames = async (frames: string[]) => {
    const bearer = token.trim();
    if (!bearer) {
      setLivenessError('Paste a biometric API token first (401 otherwise).');
      return;
    }
    setLivenessError('');
    setLivenessResult(null);
    try {
      setLivenessResult(await verifyLiveness(frames, bearer));
    } catch (err) {
      setLivenessError(err instanceof BiometricApiError ? err.detail : 'Liveness check failed');
    }
  };

  const recordLiveness = async () => {
    if (!livenessVideoRef.current) {
      return;
    }
    setRecording(true);
    setRecordedFrames(0);
    setLivenessResult(null);
    setLivenessError('');
    try {
      const frames: string[] = [];
      for (let i = 0; i < LIVENESS_FRAMES; i++) {
        if (!livenessVideoRef.current) {
          throw new Error('Camera preview was lost mid-recording.');
        }
        frames.push(...(await sampleVideoFrames(livenessVideoRef.current, 1, 0)));
        setRecordedFrames(i + 1);
        if (i < LIVENESS_FRAMES - 1) {
          await new Promise((resolve) => setTimeout(resolve, LIVENESS_INTERVAL_MS));
        }
      }
      await sendLivenessFrames(frames);
    } catch (err) {
      setLivenessError(err instanceof BiometricApiError ? err.detail : err instanceof Error ? err.message : 'Recording failed');
    } finally {
      setRecording(false);
    }
  };

  const handleLivenessFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) {
      return;
    }
    try {
      const raw = await fileToBase64(file);
      // Static frames never blink: expect live:false (200). This still proves
      // the request/response wiring; a live:true needs a real camera.
      await sendLivenessFrames(Array<string>(LIVENESS_FRAMES).fill(raw));
    } catch (err) {
      setLivenessError(err instanceof BiometricApiError ? err.detail : 'Liveness check failed');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div>
          <h2 className="text-center text-3xl font-extrabold text-gray-900">Biometric sign-in</h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Or{' '}
            <Link to="/" className="font-medium text-blue-600 hover:text-blue-500">
              sign in with email and password
            </Link>
          </p>
        </div>

        <div className="bg-white shadow rounded-lg p-6">
          <BiometricTokenField token={token} onChange={handleTokenChange} />
        </div>

        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center">
              <ScanFace className="h-6 w-6 text-gray-600 mr-2" />
              <h3 className="text-lg font-medium text-gray-900">Verify face</h3>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <BiometricCapture
              onCapture={(raw) => {
                setImage(raw);
                setVerifyResult(null);
                setVerifyError('');
              }}
              onClear={() => {
                setImage(null);
                setVerifyResult(null);
                setVerifyError('');
              }}
              disabled={verifying}
            />
            <button
              type="button"
              onClick={handleVerify}
              disabled={verifying || !image}
              className={`w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white ${
                verifying || !image ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
              } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`}
            >
              {verifying ? 'Verifying...' : 'Verify this face'}
            </button>

            {verifyError && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded" role="alert">
                <div className="flex items-start">
                  <XCircle className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" />
                  <span className="block sm:inline">{verifyError}</span>
                </div>
              </div>
            )}

            {verifyResult && (
              <div
                className={`border rounded px-4 py-3 ${verifyResult.verified ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}
                role="status"
              >
                <div className="flex items-start">
                  {verifyResult.verified ? (
                    <CheckCircle2 className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0 text-green-600" />
                  ) : (
                    <XCircle className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0 text-amber-600" />
                  )}
                  <div className="text-sm">
                    <p className={`font-medium ${verifyResult.verified ? 'text-green-800' : 'text-amber-800'}`}>
                      {verifyResult.verified ? 'Verified: this face matches an enrolled embedding' : 'Not verified: no enrolled embedding matches'}
                    </p>
                    <p className={`mt-1 ${verifyResult.verified ? 'text-green-700' : 'text-amber-700'}`}>
                      Confidence: <span className="font-semibold">{verifyResult.confidence.toFixed(4)}</span>
                      {verifyResult.embedding_id && (
                        <>
                          {' '}Matched embedding:{' '}
                          <span className="font-mono text-xs break-all">{verifyResult.embedding_id}</span>
                        </>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center">
              <Video className="h-6 w-6 text-gray-600 mr-2" />
              <h3 className="text-lg font-medium text-gray-900">Liveness check</h3>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              Records ~2.5s of video ({LIVENESS_FRAMES} frames) and sends it to the engine.
              A positive result needs a real camera and a blink; static frames return live:false.
            </p>
          </div>
          <div className="p-6 space-y-4">
            <div className="bg-gray-900 rounded-md overflow-hidden">
              <video ref={livenessVideoRef} muted playsInline className="w-full max-h-64 object-contain bg-gray-900" />
              {!liveVideo && (
                <p className="text-center text-sm text-gray-400 py-4">Liveness camera preview appears here</p>
              )}
            </div>

            {livenessError && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded" role="alert">
                <div className="flex items-start">
                  <XCircle className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" />
                  <span className="block sm:inline">{livenessError}</span>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {!liveVideo ? (
                <button
                  type="button"
                  onClick={startLivenessCamera}
                  disabled={recording}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  <Video className="h-4 w-4 mr-2" />
                  Start liveness camera
                </button>
              ) : (
                <button
                  type="button"
                  onClick={recordLiveness}
                  disabled={recording}
                  className={`inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white ${
                    recording ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  <Square className="h-4 w-4 mr-2" />
                  {recording ? `Recording... ${recordedFrames}/${LIVENESS_FRAMES}` : `Record ${LIVENESS_FRAMES} frames`}
                </button>
              )}
              <button
                type="button"
                onClick={() => livenessFileRef.current?.click()}
                disabled={recording}
                className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                <Upload className="h-4 w-4 mr-2" />
                Test with an image (static frames)
              </button>
              <input ref={livenessFileRef} type="file" accept="image/*" className="hidden" onChange={handleLivenessFile} />
            </div>

            {livenessResult && (
              <div
                className={`border rounded px-4 py-3 ${livenessResult.live ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}
                role="status"
              >
                <div className="flex items-start">
                  {livenessResult.live ? (
                    <CheckCircle2 className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0 text-green-600" />
                  ) : (
                    <XCircle className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0 text-amber-600" />
                  )}
                  <div className="text-sm">
                    <p className={`font-medium ${livenessResult.live ? 'text-green-800' : 'text-amber-800'}`}>
                      {livenessResult.live ? 'Live: blink and movement detected' : 'Not live: no blink/movement detected'}
                    </p>
                    <p className={`mt-1 ${livenessResult.live ? 'text-green-700' : 'text-amber-700'}`}>
                      Confidence: <span className="font-semibold">{livenessResult.confidence.toFixed(4)}</span>
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <Link to="/" className="inline-flex items-center text-gray-600 hover:text-gray-900 text-sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to sign-in
          </Link>
        </div>
      </div>
    </div>
  );
};

export default BiometricVerify;
