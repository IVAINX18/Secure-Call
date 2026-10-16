import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle, Camera, CheckCircle2, XCircle } from 'lucide-react';
import BiometricTokenField from '../components/BiometricTokenField';
import BiometricCapture from '../components/BiometricCapture';
import Logo from '../components/Logo';
import { Button, Card, Tag, Spinner } from '../components/ui';
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

  const verifyReady = token.trim().length > 0 && image !== null;
  const livenessProgress = Math.round((recordedFrames / LIVENESS_FRAMES) * 100);

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto w-full max-w-page px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="mt-6">
          <h1 className="text-center font-display text-[40px] font-normal leading-[1.15] text-ink sm:text-[48px]">
            Biometric sign-in
          </h1>
          <p className="mt-2 text-center text-sm font-normal text-ink/60">
            Or{' '}
            <Link to="/" className="font-medium text-iris hover:text-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30">
              sign in with email and password
            </Link>
          </p>
        </div>

        <div className="mx-auto mt-8 grid max-w-2xl grid-cols-1 gap-6">
          <Card variant="paper" padding="lg" elevated>
            <BiometricTokenField token={token} onChange={handleTokenChange} />
          </Card>

          <Card variant="paper" padding="lg" elevated>
            <h2 className="font-display text-[40px] font-normal leading-[1.15] text-ink">
              Verify face
            </h2>
            <div className="mt-6 space-y-4">
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
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleVerify}
                disabled={verifying || !verifyReady}
                loading={verifying}
                aria-label="Verify this face"
                className="min-h-[44px] w-full"
              >
                {verifying ? 'Verifying...' : 'Verify this face'}
              </Button>
              {!verifyReady && !verifying && (
                <p className="text-sm font-normal text-ink/60">
                  Paste your engine token and capture a photo to enable verification.
                </p>
              )}

              {verifying && (
                <div className="flex items-center gap-3 rounded-card border border-faded bg-mist px-4 py-3" role="status" aria-live="polite">
                  <Spinner size="md" />
                  <span className="text-sm font-medium text-ink">Checking against enrolled embeddings...</span>
                </div>
              )}

              {verifyError && (
                <div className="rounded-card border border-faded bg-mist px-4 py-3" role="alert">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-ink" aria-hidden="true" />
                    <span className="block text-sm font-normal text-ink sm:inline">{verifyError}</span>
                  </div>
                </div>
              )}

              {verifyResult && (
                <div className="rounded-card border border-faded bg-paper px-4 py-3" role="status">
                  <div className="flex items-start gap-2">
                    {verifyResult.verified ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ink" aria-hidden="true" />
                    ) : (
                      <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-ink" aria-hidden="true" />
                    )}
                    <div className="text-sm">
                      <p className="font-medium text-ink">
                        {verifyResult.verified ? 'Verified: this face matches an enrolled embedding' : 'Not verified: no enrolled embedding matches'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Tag>confidence {verifyResult.confidence.toFixed(4)}</Tag>
                        {verifyResult.embedding_id && (
                          <Tag>
                            <span className="break-all">matched {verifyResult.embedding_id}</span>
                          </Tag>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card variant="paper" padding="lg" elevated>
            <h2 className="font-display text-[40px] font-normal leading-[1.15] text-ink">
              Liveness check
            </h2>
            <p className="mt-2 max-w-[65ch] text-sm font-normal leading-[1.5] text-ink/60">
              Records ~2.5s of video ({LIVENESS_FRAMES} frames) and sends it to the engine.
              A positive result needs a real camera and a blink; static frames return live:false.
            </p>
            <div className="mt-6 space-y-4">
              <div className="overflow-hidden rounded-card border border-faded bg-mist">
                <video ref={livenessVideoRef} muted playsInline aria-label="Liveness camera preview" className={`w-full object-cover ${liveVideo ? 'min-h-[240px]' : 'hidden'}`} />
                {!liveVideo && (
                  <div className="flex min-h-[240px] w-full flex-col items-center justify-center gap-2 px-4 py-6">
                    <Camera className="h-8 w-8 text-ink" aria-hidden="true" />
                    <p className="text-sm font-medium text-ink">Camera preview appears here</p>
                  </div>
                )}
              </div>

              {(recording || recordedFrames > 0) && (
                <div role="status" aria-live="polite" aria-label={`Liveness capture progress ${recordedFrames} of ${LIVENESS_FRAMES} frames`}>
                  <div className="flex items-center gap-3">
                    {recording && <Spinner size="sm" />}
                    <div
                      className="h-2 flex-1 overflow-hidden rounded-pill bg-mist"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={LIVENESS_FRAMES}
                      aria-valuenow={recordedFrames}
                    >
                      <div className="h-full rounded-pill bg-iris transition-all" style={{ width: `${livenessProgress}%` }} />
                    </div>
                    <span className="text-sm font-medium tabular-nums text-ink">
                      {recordedFrames}/{LIVENESS_FRAMES}
                    </span>
                  </div>
                </div>
              )}

              {livenessError && (
                <div className="rounded-card border border-faded bg-mist px-4 py-3" role="alert">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-ink" aria-hidden="true" />
                    <span className="block text-sm font-normal text-ink sm:inline">{livenessError}</span>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {!liveVideo ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={startLivenessCamera}
                    disabled={recording}
                    aria-label="Start liveness camera"
                    className="min-h-[44px]"
                  >
                    Start liveness camera
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={recordLiveness}
                    disabled={recording}
                    loading={recording}
                    aria-label={`Record ${LIVENESS_FRAMES} frames`}
                    className="min-h-[44px]"
                  >
                    {recording ? `Recording... ${recordedFrames}/${LIVENESS_FRAMES}` : `Record ${LIVENESS_FRAMES} frames`}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => livenessFileRef.current?.click()}
                  disabled={recording}
                  aria-label="Test liveness with an image"
                  className="min-h-[44px]"
                >
                  Test with an image (static frames)
                </Button>
                <input ref={livenessFileRef} type="file" accept="image/*" className="hidden" onChange={handleLivenessFile} aria-label="Choose an image for static liveness frames" />
              </div>

              {livenessResult && (
                <div className="rounded-card border border-faded bg-paper px-4 py-3" role="status">
                  <div className="flex items-start gap-2">
                    {livenessResult.live ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ink" aria-hidden="true" />
                    ) : (
                      <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-ink" aria-hidden="true" />
                    )}
                    <div className="text-sm">
                      <p className="font-medium text-ink">
                        {livenessResult.live ? 'Live: blink and movement detected' : 'Not live: no blink/movement detected'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Tag>confidence {livenessResult.confidence.toFixed(4)}</Tag>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>

          <div>
            <Link
              to="/"
              className="inline-flex min-h-[44px] items-center text-sm font-medium text-ink hover:text-iris focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30"
            >
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              Back to sign-in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BiometricVerify;
