import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ScanFace, CheckCircle2, XCircle } from 'lucide-react';
import BiometricTokenField from '../components/BiometricTokenField';
import BiometricCapture from '../components/BiometricCapture';
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Link to="/settings" className="inline-flex items-center text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-5 w-5 mr-2" />
            Back to Settings
          </Link>
        </div>

        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center">
              <ScanFace className="h-6 w-6 text-gray-600 mr-2" />
              <h2 className="text-xl font-semibold text-gray-900">Biometric enrollment</h2>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              Capture your face and enroll it in the biometric engine.
            </p>
          </div>

          <div className="p-6 space-y-6">
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
              <button
                type="button"
                onClick={handleEnroll}
                disabled={sending || !image}
                className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                  sending || !image ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`}
              >
                {sending ? 'Enrolling...' : 'Enroll this face'}
              </button>
            </div>

            {error && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded" role="alert">
                <div className="flex items-start">
                  <XCircle className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" />
                  <span className="block sm:inline">{error}</span>
                </div>
              </div>
            )}

            {result && (
              <div className="bg-green-50 border border-green-200 rounded px-4 py-3" role="status">
                <div className="flex items-start">
                  <CheckCircle2 className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0 text-green-600" />
                  <div className="text-sm">
                    <p className="font-medium text-green-800">Face enrolled</p>
                    <p className="mt-1 text-green-700">
                      Quality score: <span className="font-semibold">{result.quality_score.toFixed(4)}</span>
                      {' '}(gate: 0.7 — below it the engine rejects with a 400)
                    </p>
                    <p className="mt-1 text-green-700 break-all">
                      Embedding id: <span className="font-mono text-xs">{result.embedding_id}</span>
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BiometricEnroll;
