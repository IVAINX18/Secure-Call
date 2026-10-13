// Minimal fetch client for the biometric engine (FastAPI) used by Fase 12.
// Shapes mirror biometric_engine/app/domain/models.py; error `detail`
// strings are surfaced verbatim so API rejections stay readable in the UI.

// Base URL of the engine. Local dev points at :8800 via .env.development
// (canonical 8000 is taken on some machines); production uses whatever
// VITE_BIOMETRIC_API_URL is set to at build time.
export const BIOMETRIC_API_URL: string =
  import.meta.env.VITE_BIOMETRIC_API_URL ?? 'http://localhost:8000';

// localStorage key for the engine Bearer JWT. The app has no auth backend
// that can mint it, so both biometric pages ask the user to paste one.
export const BIOMETRIC_TOKEN_KEY = 'biometric_api_token';

export function getBiometricToken(): string {
  return localStorage.getItem(BIOMETRIC_TOKEN_KEY) ?? '';
}

export function setBiometricToken(token: string): void {
  localStorage.setItem(BIOMETRIC_TOKEN_KEY, token);
}

export interface EnrollResult {
  embedding_id: string;
  quality_score: number;
}

export interface VerifyResult {
  verified: boolean;
  confidence: number;
  embedding_id: string | null;
}

export interface LivenessResult {
  live: boolean;
  confidence: number;
}

// Thrown for every non-2xx API response and for network failures.
// `detail` is the API's own message (or a transport message), shown as-is.
export class BiometricApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'BiometricApiError';
    this.status = status;
    this.detail = detail;
  }
}

async function postJson<T>(path: string, token: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BIOMETRIC_API_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network request failed';
    throw new BiometricApiError(0, `Could not reach ${BIOMETRIC_API_URL}: ${message}`);
  }
  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const data: unknown = await response.json();
      if (typeof data === 'object' && data !== null && 'detail' in data) {
        const raw = (data as { detail: unknown }).detail;
        if (typeof raw === 'string' && raw.length > 0) {
          detail = raw;
        }
      }
    } catch {
      // Non-JSON error body: keep the default detail.
    }
    throw new BiometricApiError(response.status, detail);
  }
  return (await response.json()) as T;
}

// Enroll one face image (12.3). `imageBase64` must be raw base64, no data: prefix.
export function enrollFace(imageBase64: string, token: string): Promise<EnrollResult> {
  return postJson<EnrollResult>('/api/v1/enroll', token, { image_base64: imageBase64 });
}

// Verify one face image (12.7).
export function verifyFace(imageBase64: string, token: string): Promise<VerifyResult> {
  return postJson<VerifyResult>('/api/v1/verify', token, { image_base64: imageBase64 });
}

// Liveness over a short frame sequence (12.10). Needs >= 5 frames (MIN_FRAMES).
export function verifyLiveness(framesBase64: string[], token: string): Promise<LivenessResult> {
  return postJson<LivenessResult>('/api/v1/verify-liveness', token, {
    video_frames_base64: framesBase64,
  });
}

// Strip the `data:image/jpeg;base64,` prefix canvas/FileReader URLs carry;
// the API expects raw base64 only.
export function stripDataPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

// Read an uploaded image file as raw base64 (upload fallback for capture).
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(stripDataPrefix(reader.result));
      } else {
        reject(new Error('Could not read the selected file'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read the selected file'));
    reader.readAsDataURL(file);
  });
}

// Snapshot one JPEG frame from a playing video element as raw base64.
export function snapshotVideoFrame(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D is not available in this browser');
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return stripDataPrefix(canvas.toDataURL('image/jpeg', 0.92));
}

// Sample `count` frames spaced `intervalMs` apart (~2.5s of video for the
// liveness check, 12.9). Throws when the video is not playing.
export async function sampleVideoFrames(
  video: HTMLVideoElement,
  count: number,
  intervalMs: number,
): Promise<string[]> {
  if (video.readyState < 2 || video.videoWidth === 0) {
    throw new Error('Camera is not streaming yet. Start the camera and wait for the preview.');
  }
  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    frames.push(snapshotVideoFrame(video));
    if (i < count - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return frames;
}
