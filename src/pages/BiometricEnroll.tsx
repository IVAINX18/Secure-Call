import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react';
import BiometricTokenField from '../components/BiometricTokenField';
import BiometricCapture from '../components/BiometricCapture';
import { Button, Card, Tag, Spinner } from '../components/ui';
import {
  BiometricApiError,
  enrollFace,
  getBiometricToken,
  setBiometricToken,
  type EnrollResult,
} from '../lib/biometricApi';

// Protected page: capture a face and enroll it via POST /api/v1/enroll (12.1-12.4).
const BiometricEnroll: React.FC = () => {
  const [token, setToken] = useState(getBiometricToken());
  const [image, setImage] = useState<string | null>(null);
  const [result, setResult] = useState<EnrollResult | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const handleTokenChange = (value: string) => {
    setToken(value);
    setBiometricToken(value);
  };

  const handleEnroll = async () => {
    setResult(null);
    setError('');
    if (!token.trim()) {
      setError('Paste a biometric API token first (401 otherwise).');
      return;
    }
    if (!image) {
      setError('Capture a photo or upload an image first.');
      return;
    }
    setSending(true);
    try {
      setResult(await enrollFace(image, token.trim()));
    } catch (err) {
      setError(err instanceof BiometricApiError ? err.detail : 'Enrollment failed');
    } finally {
      setSending(false);
    }
  };

  const ready = token.trim().length > 0 && image !== null;

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto w-full max-w-page px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <Link
            to="/settings"
            className="inline-flex min-h-[44px] items-center font-medium text-ink hover:text-iris focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30"
          >
            <ArrowLeft className="mr-2 h-5 w-5" aria-hidden="true" />
            Back to Settings
          </Link>
        </div>

        <h1 className="font-display text-[40px] font-normal leading-[1.15] text-ink sm:text-[48px]">
          Biometric enrollment
        </h1>
        <p className="mt-2 max-w-[65ch] text-base font-normal leading-[1.5] text-ink/60">
          Capture your face and enroll it in the biometric engine.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-6">
          <Card variant="paper" padding="lg" elevated>
            <div className="space-y-6">
              <BiometricTokenField token={token} onChange={handleTokenChange} />

              <BiometricCapture
                onCapture={(raw) => {
                  setImage(raw);
                  setResult(null);
                  setError('');
                }}
                onClear={() => {
                  setImage(null);
                  setResult(null);
                  setError('');
                }}
                disabled={sending}
              />

              <div>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={handleEnroll}
                  disabled={sending || !ready}
                  loading={sending}
                  aria-label="Enroll this face"
                  className="min-h-[44px] w-full"
                >
                  {sending ? 'Enrolling...' : 'Enroll this face'}
                </Button>
                {!ready && !sending && (
                  <p className="mt-2 text-sm font-normal text-ink/60">
                    Paste your engine token and capture a photo to enable enrollment.
                  </p>
                )}
              </div>

              {sending && (
                <div className="flex items-center gap-3 rounded-card border border-faded bg-mist px-4 py-3" role="status" aria-live="polite">
                  <Spinner size="md" />
                  <span className="text-sm font-medium text-ink">Sending to the engine...</span>
                </div>
              )}

              {error && (
                <div className="rounded-card border border-faded bg-mist px-4 py-3" role="alert">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-ink" aria-hidden="true" />
                    <span className="block text-sm font-normal text-ink sm:inline">{error}</span>
                  </div>
                </div>
              )}

              {result && (
                <div className="rounded-card border border-faded bg-paper px-4 py-3" role="status">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ink" aria-hidden="true" />
                    <div className="text-sm">
                      <p className="font-medium text-ink">Face enrolled</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Tag>quality_score {result.quality_score.toFixed(4)}</Tag>
                        <Tag>
                          <span className="break-all">embedding_id {result.embedding_id}</span>
                        </Tag>
                      </div>
                      <p className="mt-2 font-normal text-ink/60">
                        Gate: 0.7, below it the engine rejects with a 400.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default BiometricEnroll;
