"""Liveness detector unit tests (Fase 5, T5.1-T5.7 + boundary tests).

T5.2 is the genuine MediaPipe integration proof: the SAME fixture
frame (``single_face.jpg`` bytes, repeated) runs through the REAL
FaceLandmarker. A static repetition cannot blink or jitter, so the
detector must report ``live=False`` / ``blink_detected=False``.

T5.1 covers the positive path with SYNTHETIC landmarks injected at
the ``_extract_landmarks`` seam (monkeypatched). Rationale: no
permissively-licensed blink video is available in this repo, so the
unit boundary is our blink/movement combination logic, not MediaPipe
tracking itself. The seam is the narrowest mock point: decode +
model inference are bypassed, EAR/blink/variance/confidence all run
for real.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest

from app.config import settings
from app.domain.exceptions import (
    InsufficientFrames,
    InvalidImageFormat,
    NoFaceDetected,
)
from app.infrastructure.liveness.mediapipe_detector import (
    BLINK_MIN_CONSECUTIVE,
    EAR_THRESHOLD,
    LEFT_EYE_IDX,
    MIN_FRAMES,
    MOVEMENT_VARIANCE_THRESHOLD,
    RIGHT_EYE_IDX,
    MediaPipeLivenessDetector,
)

IMAGES_DIR = Path(__file__).parent.parent / "fixtures" / "images"

N_LANDMARKS = 478


@pytest.fixture(scope="module")
def detector() -> Iterator[MediaPipeLivenessDetector]:
    """Shared detector; the model bundle loads once, released at teardown."""
    det = MediaPipeLivenessDetector()
    yield det
    det.close()


@pytest.fixture(scope="module")
def single_face_bytes() -> bytes:
    """Exactly one detectable face (MIT insightface bundle crop)."""
    return (IMAGES_DIR / "single_face.jpg").read_bytes()


@pytest.fixture(scope="module")
def no_face_bytes() -> bytes:
    """No detectable face (surgical-mask close-up)."""
    return (IMAGES_DIR / "no_face.jpg").read_bytes()


# -- synthetic landmark helpers -------------------------------------


def _open_eye_landmarks() -> np.ndarray:
    """(478, 2) array with wide-open eyes (EAR ~0.4) on a fixed grid base."""
    rng = np.random.default_rng(7)
    base = rng.uniform(0.3, 0.7, size=(N_LANDMARKS, 2))
    # Left eye: corners 0.1 apart, lids 0.04 apart -> EAR = 0.08/0.2 = 0.4.
    left = {
        33: (0.30, 0.50),
        160: (0.325, 0.48),
        158: (0.375, 0.48),
        133: (0.40, 0.50),
        153: (0.375, 0.52),
        144: (0.325, 0.52),
    }
    right = {
        362: (0.60, 0.50),
        385: (0.625, 0.48),
        387: (0.675, 0.48),
        263: (0.70, 0.50),
        373: (0.675, 0.52),
        380: (0.625, 0.52),
    }
    for idx, xy in {**left, **right}.items():
        base[idx] = xy
    return base


def _with_blink(landmarks: np.ndarray) -> np.ndarray:
    """Copy of ``landmarks`` with lids nearly shut (EAR ~0.05 < 0.2)."""
    closed = landmarks.copy()
    for idx in (160, 158, 385, 387):
        closed[idx][1] = 0.4975
    for idx in (153, 144, 373, 380):
        closed[idx][1] = 0.5025
    return closed


def _jitter(landmarks: np.ndarray, seed: int, scale: float = 0.003) -> np.ndarray:
    """Copy with natural micro-movement noise; eye geometry preserved."""
    rng = np.random.default_rng(seed)
    out = landmarks + rng.normal(0.0, scale, size=landmarks.shape)
    eye_idx = list(LEFT_EYE_IDX) + list(RIGHT_EYE_IDX)
    out[eye_idx] = landmarks[eye_idx]
    return out


# -- T5.1: positive blink path (simulated landmarks) -----------------


def test_detect_liveness_blink_sequence_returns_live_true(
    detector: MediaPipeLivenessDetector, monkeypatch: pytest.MonkeyPatch
) -> None:
    """T5.1: open-blink-open + jitter through the real pipeline -> live."""
    open_lm = _open_eye_landmarks()
    blink_lm = _with_blink(open_lm)
    sequence = [
        _jitter(open_lm, 1),
        _jitter(open_lm, 2),
        _jitter(blink_lm, 3),
        _jitter(blink_lm, 4),
        _jitter(open_lm, 5),
        _jitter(open_lm, 6),
    ]
    frames = [b"frame-%d" % i for i in range(len(sequence))]
    it = iter(sequence)
    monkeypatch.setattr(detector, "_extract_landmarks", lambda _fb: next(it))

    result = detector.detect_liveness(frames)

    assert result.live is True
    assert result.blink_detected is True
    assert result.natural_movement is True
    assert result.confidence >= settings.LIVENESS_THRESHOLD
    assert 0.0 <= result.confidence <= 1.0
    assert result.details["frames_with_face"] == len(sequence)


# -- T5.2: real static-frames path (genuine MediaPipe proof) ----------


def test_detect_liveness_static_frames_returns_live_false(
    detector: MediaPipeLivenessDetector, single_face_bytes: bytes
) -> None:
    """T5.2: same frame repeated -> no blink, no movement, not live."""
    frames = [single_face_bytes] * (MIN_FRAMES + 1)

    result = detector.detect_liveness(frames)

    assert result.live is False
    assert result.blink_detected is False
    assert result.natural_movement is False
    assert result.confidence < settings.LIVENESS_THRESHOLD
    assert result.details["frames_with_face"] == len(frames)
    assert len(result.details["ear_series"]) == len(frames)


def test_detect_liveness_no_face_in_any_frame_raises(
    detector: MediaPipeLivenessDetector, no_face_bytes: bytes
) -> None:
    """All frames skipped -> NoFaceDetected (reused domain exception)."""
    with pytest.raises(NoFaceDetected):
        detector.detect_liveness([no_face_bytes] * MIN_FRAMES)


def test_detect_liveness_invalid_bytes_raise(
    detector: MediaPipeLivenessDetector,
) -> None:
    """Undecodable bytes raise InvalidImageFormat (adapter convention)."""
    with pytest.raises(InvalidImageFormat):
        detector.detect_liveness([b"not-an-image"] * MIN_FRAMES)
    with pytest.raises(InvalidImageFormat):
        detector._extract_landmarks(b"")


# -- T5.3: insufficient frames ---------------------------------------


def test_detect_liveness_insufficient_frames_raises(
    single_face_bytes: bytes,
) -> None:
    """T5.3: fewer than MIN_FRAMES inputs raise before any inference."""
    det = MediaPipeLivenessDetector()
    try:
        with pytest.raises(InsufficientFrames):
            det.detect_liveness([single_face_bytes] * (MIN_FRAMES - 1))
    finally:
        det.close()


# -- T5.4: EAR ratio validity ----------------------------------------


def test_calculate_ear_returns_valid_ratio() -> None:
    """T5.4: open eyes score well above threshold; closed well below."""
    open_ear = MediaPipeLivenessDetector._calculate_ear(_open_eye_landmarks())
    closed_ear = MediaPipeLivenessDetector._calculate_ear(_with_blink(_open_eye_landmarks()))
    assert 0.0 < open_ear < 1.0
    assert open_ear > EAR_THRESHOLD
    assert 0.0 <= closed_ear < EAR_THRESHOLD


def test_eye_ear_degenerate_corners_returns_zero() -> None:
    """Coincident eye corners (zero horizontal) degrade to 0.0, no crash."""
    degenerate = np.zeros((N_LANDMARKS, 2))
    assert MediaPipeLivenessDetector._eye_ear(degenerate, LEFT_EYE_IDX) == 0.0


def test_default_model_path_env_override(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """MEDIAPIPE_MODEL_PATH env var overrides the shared-cache default."""
    from app.infrastructure.liveness.mediapipe_detector import _default_model_path

    custom = tmp_path / "custom.task"
    monkeypatch.setenv("MEDIAPIPE_MODEL_PATH", str(custom))
    assert _default_model_path() == custom


# -- T5.5 / T5.6: blink state machine --------------------------------


def test_detect_blink_finds_valid_blink_sequence() -> None:
    """T5.5: >= BLINK_MIN_CONSECUTIVE dips (edges included) -> True."""
    assert MediaPipeLivenessDetector._detect_blink([0.4, 0.4, 0.1, 0.1, 0.4]) is True
    assert MediaPipeLivenessDetector._detect_blink([0.1] * BLINK_MIN_CONSECUTIVE) is True
    assert MediaPipeLivenessDetector._detect_blink([0.4, 0.4, 0.1, 0.1]) is True


def test_detect_blink_no_blink_returns_false() -> None:
    """T5.6: flat series and lone single-frame dips -> False."""
    assert MediaPipeLivenessDetector._detect_blink([0.4] * 6) is False
    assert MediaPipeLivenessDetector._detect_blink([0.4, 0.4, 0.1, 0.4, 0.4]) is False
    assert MediaPipeLivenessDetector._detect_blink([]) is False


# -- T5.7: movement variance -----------------------------------------


def test_calculate_movement_variance_detects_natural_movement() -> None:
    """T5.7: static stack scores ~0; jittered stack clears the threshold."""
    base = _open_eye_landmarks()
    static_var = MediaPipeLivenessDetector._calculate_movement_variance([base] * 6)
    jittered = [_jitter(base, seed) for seed in range(6)]
    jitter_var = MediaPipeLivenessDetector._calculate_movement_variance(jittered)
    assert static_var < MOVEMENT_VARIANCE_THRESHOLD
    assert jitter_var > MOVEMENT_VARIANCE_THRESHOLD
    assert jitter_var > static_var
