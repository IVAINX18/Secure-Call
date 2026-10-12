"""Domain value objects for the biometric engine.

Framework-free: pure dataclasses + numpy, no FastAPI imports. Fase 5
will append ``LivenessResult`` here; keep sections tidy.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass(frozen=True)
class FaceDetection:
    """Result of detecting a single face in an image.

    ``bbox`` is (x1, y1, x2, y2) in pixel coordinates. ``landmarks``
    holds the 5 InsightFace keypoints (left eye, right eye, nose,
    left mouth corner, right mouth corner) when available.
    """

    bbox: tuple[int, int, int, int]
    confidence: float
    landmarks: dict[str, tuple[int, int]] | None = None


def l2_normalize(vector: np.ndarray) -> np.ndarray:
    """Return the L2-normalized copy of ``vector`` as float32.

    A zero vector is returned unchanged (as float32) instead of
    raising, so callers never hit a division-by-zero.
    """
    arr = np.asarray(vector, dtype=np.float32)
    norm = float(np.linalg.norm(arr))
    if norm == 0.0:
        return arr
    return (arr / norm).astype(np.float32)


@dataclass(frozen=True)
class Embedding:
    """A face embedding vector plus the model that produced it."""

    vector: np.ndarray = field(compare=False)
    model_name: str = ""

    def __post_init__(self) -> None:
        vector = np.asarray(self.vector, dtype=np.float32)
        if vector.ndim != 1:
            raise ValueError(f"Embedding vector must be 1-dimensional, got shape {vector.shape}.")
        # Freeze a canonical float32 copy even though the dataclass is frozen.
        object.__setattr__(self, "vector", vector)

    def cosine_similarity(self, other: Embedding) -> float:
        """Cosine similarity in [-1, 1] between two embeddings.

        Both vectors are L2-normalized internally, so stored vectors
        do not need to be pre-normalized. Shapes must match.
        """
        a = np.asarray(self.vector, dtype=np.float32)
        b = np.asarray(other.vector, dtype=np.float32)
        if a.shape != b.shape:
            raise ValueError(
                f"Cannot compare embeddings with different shapes: {a.shape} vs {b.shape}."
            )
        norm_a = float(np.linalg.norm(a))
        norm_b = float(np.linalg.norm(b))
        if norm_a == 0.0 or norm_b == 0.0:
            raise ValueError("Cannot compute similarity of a zero embedding vector.")
        return float(np.dot(a, b) / (norm_a * norm_b))


@dataclass(frozen=True)
class QualityScore:
    """Breakdown of face-image quality; every component is in [0, 1].

    ``overall`` is a documented weighted mean of the components (see
    ``InsightFaceAdapter.validate_image_quality``). Values >= 0.7 are
    considered "good"; the service layer enforces that gate.
    """

    overall: float
    brightness: float
    sharpness: float
    face_size: float
    pose: float


@dataclass(frozen=True)
class LivenessResult:
    """Outcome of a liveness check over a short frame sequence.

    Produced by ``MediaPipeLivenessDetector.detect_liveness`` (Fase 5).
    ``live`` is True only when a blink AND natural micro-movement were
    both observed and the combined ``confidence`` cleared the
    ``LIVENESS_THRESHOLD`` gate. ``details`` carries the evidence
    (EAR series, movement variance, frame counts) for audit logging.
    """

    live: bool
    confidence: float
    blink_detected: bool
    natural_movement: bool
    details: dict = field(default_factory=dict)
