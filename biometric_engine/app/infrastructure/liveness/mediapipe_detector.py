"""MediaPipe-based liveness detection (blink + natural micro-movement).

API deviation note (mediapipe 1.1.0): the legacy
``mp.solutions.face_mesh.FaceMesh`` API referenced in early drafts no
longer ships with mediapipe >= 1.0 (``mediapipe.solutions`` was
removed). This module therefore uses the supported Tasks API,
``FaceLandmarker`` in ``IMAGE`` running mode (per-frame static mode:
each frame is analyzed independently, no temporal tracking state),
with the ``face_landmarker.task`` bundle (3.6 MB, Apache 2.0,
downloaded on first init to ``~/.cache/mediapipe/`` when absent,
mirroring how InsightFace caches models under ``~/.insightface``).
The 468-point topology indices used for the eyes are identical in
both APIs, so the EAR math is unchanged.

Heuristics / thresholds (all documented here and re-stated in code):
- ``MIN_FRAMES = 5``: minimum sequence length; shorter inputs raise
  ``InsufficientFrames`` (a blink needs an open-blink-open context).
- ``EAR_THRESHOLD = 0.15``: Eye Aspect Ratio below this counts as a
  closed eye. Calibrated empirically: the open-eye fixture face
  (``tests/fixtures/images/single_face.jpg``) scores ~0.20 mean EAR
  (left 0.212 / right 0.188, a narrow-eyed subject), while a fully
  closed eye collapses toward ~0.05. 0.15 splits the margin on both
  sides; the literature default 0.2 was rejected because it sits
  exactly on this fixture's open-eye score (false blink).
- ``BLINK_MIN_CONSECUTIVE = 2``: a blink is >= 2 consecutive frames
  with EAR < threshold (rejects single-frame detection flicker).
- Eye indices (MediaPipe 468-point topology, first face only):
  left ``[33, 160, 158, 133, 153, 144]``,
  right ``[362, 385, 387, 263, 373, 380]``.
- ``MOVEMENT_VARIANCE_THRESHOLD = 1e-6``: mean per-landmark
  coordinate variance (normalized 0-1 coordinates) across frames.
  Bit-identical static frames score exactly 0.0; sub-pixel natural
  jitter (std ~0.003) scores ~1e-5, an order of magnitude above.
- Confidence: ``0.6 * blink + 0.4 * movement`` where movement is the
  variance normalized to ``10 * threshold`` and saturated at 1.0.
  ``live`` requires blink AND movement AND
  ``confidence >= settings.LIVENESS_THRESHOLD`` (final gate).

Lazy init: importing this module (or constructing the detector)
performs no heavy work; the model bundle loads on first inference.
"""

from __future__ import annotations

import os
import threading
import urllib.request
from pathlib import Path

import cv2
import numpy as np

from app.config import settings
from app.domain.exceptions import (
    InsufficientFrames,
    InvalidImageFormat,
    NoFaceDetected,
)
from app.domain.value_objects import LivenessResult

#: Minimum number of frames required for a liveness decision.
MIN_FRAMES = 5

#: EAR below this value counts as a closed eye (empirically calibrated,
#: see module docstring; the textbook 0.2 false-triggers on the fixture).
EAR_THRESHOLD = 0.15

#: Consecutive closed-eye frames required to count as a blink.
BLINK_MIN_CONSECUTIVE = 2

#: MediaPipe eye landmark indices in (p1..p6) EAR order:
#: outer corner, upper-lid x2, inner corner, lower-lid x2.
LEFT_EYE_IDX = (33, 160, 158, 133, 153, 144)
RIGHT_EYE_IDX = (362, 385, 387, 263, 373, 380)

#: Mean per-landmark coordinate variance separating a live sequence
#: from bit-identical static frames (which score exactly 0.0).
MOVEMENT_VARIANCE_THRESHOLD = 1e-6

#: Variance at which the movement component saturates to 1.0
#: (10x the acceptance threshold).
_MOVEMENT_SATURATION = 10.0 * MOVEMENT_VARIANCE_THRESHOLD

#: Confidence weights: a blink is the stronger liveness signal.
_BLINK_WEIGHT = 0.6
_MOVEMENT_WEIGHT = 0.4

#: Remote location of the FaceLandmarker bundle (Apache 2.0).
_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)
_MODEL_FILENAME = "face_landmarker.task"


def _default_model_path() -> Path:
    """Resolve the model bundle path (env override or shared cache)."""
    override = os.environ.get("MEDIAPIPE_MODEL_PATH")
    if override:
        return Path(override)
    return Path.home() / ".cache" / "mediapipe" / _MODEL_FILENAME


def _ensure_model(path: Path) -> Path:
    """Return ``path``, downloading the bundle first when absent."""
    if not path.exists():  # pragma: no cover - exercised only on fresh hosts
        path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(_MODEL_URL, path)
    return path


class MediaPipeLivenessDetector:
    """Liveness detection via MediaPipe FaceLandmarker (blink + jitter).

    Args:
        model_path: path to the ``face_landmarker.task`` bundle. When
            omitted, ``MEDIAPIPE_MODEL_PATH`` or the shared
            ``~/.cache/mediapipe/`` location is used.
        min_detection_confidence: minimum face-detection confidence
            passed to the landmarker (default 0.5).
    """

    def __init__(
        self,
        model_path: str | Path | None = None,
        min_detection_confidence: float = 0.5,
    ) -> None:
        self._model_path = Path(model_path) if model_path else _default_model_path()
        self._min_detection_confidence = min_detection_confidence
        self._landmarker = None
        self._lock = threading.Lock()

    # -- lazy model -------------------------------------------------
    @property
    def _face_landmarker(self):  # type: ignore[no-untyped-def]
        """Build the FaceLandmarker on first use (thread-safe)."""
        if self._landmarker is None:
            with self._lock:
                if self._landmarker is None:
                    from mediapipe.tasks.python import vision
                    from mediapipe.tasks.python.core.base_options import BaseOptions

                    bundle = _ensure_model(self._model_path)
                    options = vision.FaceLandmarkerOptions(
                        base_options=BaseOptions(model_asset_path=str(bundle)),
                        running_mode=vision.RunningMode.IMAGE,
                        num_faces=1,
                        min_face_detection_confidence=self._min_detection_confidence,
                    )
                    self._landmarker = vision.FaceLandmarker.create_from_options(options)
        return self._landmarker

    def close(self) -> None:
        """Release the native landmarker resources (idempotent)."""
        with self._lock:
            if self._landmarker is not None:
                self._landmarker.close()
                self._landmarker = None

    # -- per-frame seam ---------------------------------------------
    def _extract_landmarks(self, image: bytes) -> np.ndarray | None:
        """Return the first face as a (478, 2) normalized array, or None.

        This is the unit-test seam: synthetic landmark sequences are
        injected here so blink/movement logic is tested without video.
        Decode failures raise ``InvalidImageFormat`` (same convention
        as the InsightFace adapter).
        """
        if not image:
            raise InvalidImageFormat(details={"reason": "empty input"})
        data = np.frombuffer(image, dtype=np.uint8)
        bgr = cv2.imdecode(data, cv2.IMREAD_COLOR)
        if bgr is None:
            raise InvalidImageFormat(details={"reason": "cv2.imdecode returned None"})
        import mediapipe as mp

        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self._face_landmarker.detect(mp_image)
        if not result.face_landmarks:
            return None
        points = result.face_landmarks[0]
        return np.array([(p.x, p.y) for p in points], dtype=np.float64)

    # -- EAR / blink / movement -------------------------------------
    @staticmethod
    def _eye_ear(landmarks: np.ndarray, idx: tuple[int, ...]) -> float:
        """EAR of one eye: (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||).

        Vertical lid distances shrink to ~0 on a blink while the
        horizontal corner distance stays constant, so the ratio drops
        from ~0.3 (open) toward 0.0 (closed).
        """
        p1, p2, p3, p4, p5, p6 = (landmarks[i] for i in idx)
        vertical = float(np.linalg.norm(p2 - p6) + np.linalg.norm(p3 - p5))
        horizontal = float(np.linalg.norm(p1 - p4))
        if horizontal <= 0.0:
            return 0.0
        return vertical / (2.0 * horizontal)

    @classmethod
    def _calculate_ear(cls, landmarks: np.ndarray) -> float:
        """Mean EAR of both eyes for one frame's landmarks."""
        left = cls._eye_ear(landmarks, LEFT_EYE_IDX)
        right = cls._eye_ear(landmarks, RIGHT_EYE_IDX)
        return float((left + right) / 2.0)

    @staticmethod
    def _detect_blink(ear_series: list[float]) -> bool:
        """True when >= BLINK_MIN_CONSECUTIVE frames dip below threshold."""
        run = 0
        for ear in ear_series:
            if ear < EAR_THRESHOLD:
                run += 1
                if run >= BLINK_MIN_CONSECUTIVE:
                    return True
            else:
                run = 0
        return False

    @staticmethod
    def _calculate_movement_variance(landmarks_series: list[np.ndarray]) -> float:
        """Mean per-landmark coordinate variance across frames.

        Stacks the (478, 2) per-frame arrays, takes the variance over
        the frame axis, and averages over landmarks and x/y. Static
        (bit-identical) sequences score 0.0; natural micro-movement
        and head jitter score orders of magnitude higher.
        """
        stacked = np.stack(landmarks_series, axis=0)
        return float(np.var(stacked, axis=0).mean())

    # -- public API ---------------------------------------------------
    def detect_liveness(self, video_frames: list[bytes]) -> LivenessResult:
        """Decide liveness for a short sequence of encoded frames.

        Frames without a detectable face are skipped; when NO frame
        yields a face, ``NoFaceDetected`` is raised. Fewer than
        ``MIN_FRAMES`` inputs raise ``InsufficientFrames``.

        Returns:
            LivenessResult with the blink/movement flags, the combined
            confidence, and the raw evidence in ``details``.
        """
        if len(video_frames) < MIN_FRAMES:
            raise InsufficientFrames(
                details={"frames": len(video_frames), "min_frames": MIN_FRAMES},
            )
        per_frame: list[np.ndarray] = []
        for frame in video_frames:
            landmarks = self._extract_landmarks(frame)
            if landmarks is not None:
                per_frame.append(landmarks)
        if not per_frame:
            raise NoFaceDetected(
                details={"frames": len(video_frames)},
            )

        ear_series = [self._calculate_ear(lm) for lm in per_frame]
        blink_detected = self._detect_blink(ear_series)
        variance = self._calculate_movement_variance(per_frame)
        natural_movement = variance >= MOVEMENT_VARIANCE_THRESHOLD

        movement_score = min(1.0, variance / _MOVEMENT_SATURATION)
        confidence = _BLINK_WEIGHT * (1.0 if blink_detected else 0.0)
        confidence += _MOVEMENT_WEIGHT * movement_score
        live = blink_detected and natural_movement and confidence >= settings.LIVENESS_THRESHOLD
        return LivenessResult(
            live=bool(live),
            confidence=float(confidence),
            blink_detected=blink_detected,
            natural_movement=natural_movement,
            details={
                "ear_series": ear_series,
                "ear_threshold": EAR_THRESHOLD,
                "movement_variance": variance,
                "movement_threshold": MOVEMENT_VARIANCE_THRESHOLD,
                "frames_total": len(video_frames),
                "frames_with_face": len(per_frame),
                "confidence_threshold": settings.LIVENESS_THRESHOLD,
            },
        )
