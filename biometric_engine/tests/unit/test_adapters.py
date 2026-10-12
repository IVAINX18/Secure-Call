"""Fase 4 unit tests: InsightFaceAdapter (T4.1-T4.9 + extras).

Real-model tests (module-scoped ``adapter`` fixture loads buffalo_sc
once). Assertions use ranges/relations, not exact detector outputs.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app.domain.exceptions import (
    InvalidImageFormat,
    MultipleFacesDetected,
    NoFaceDetected,
)
from app.domain.value_objects import Embedding, FaceDetection
from app.infrastructure.adapters.factory import get_biometric_adapter
from app.infrastructure.adapters.insightface_adapter import InsightFaceAdapter


# -- T4.1 ------------------------------------------------------------
def test_detect_face_returns_face_detection(
    adapter: InsightFaceAdapter, single_face_bytes: bytes
) -> None:
    """T4.1: detection on a single-face image returns a FaceDetection."""
    detection = adapter.detect_face(single_face_bytes)
    assert isinstance(detection, FaceDetection)
    x1, y1, x2, y2 = detection.bbox
    assert all(isinstance(v, int) for v in detection.bbox)
    assert x2 > x1 and y2 > y1
    assert 0.0 <= detection.confidence <= 1.0
    assert detection.landmarks is not None
    assert set(detection.landmarks) == {
        "left_eye",
        "right_eye",
        "nose",
        "left_mouth",
        "right_mouth",
    }


# -- T4.2 ------------------------------------------------------------
def test_detect_face_no_face_raises_no_face_detected(
    adapter: InsightFaceAdapter, no_face_bytes: bytes
) -> None:
    """T4.2: an image with no face raises NoFaceDetected."""
    with pytest.raises(NoFaceDetected):
        adapter.detect_face(no_face_bytes)


# -- T4.3 ------------------------------------------------------------
def test_detect_face_multiple_faces_raises_multiple_faces(
    adapter: InsightFaceAdapter, multi_face_bytes: bytes
) -> None:
    """T4.3: an image with several faces raises MultipleFacesDetected."""
    with pytest.raises(MultipleFacesDetected):
        adapter.detect_face(multi_face_bytes)


# -- T4.4 ------------------------------------------------------------
def test_extract_embedding_returns_512_dim_vector(
    adapter: InsightFaceAdapter, single_face_bytes: bytes
) -> None:
    """T4.4: the embedding is a 512-dim float32 vector."""
    embedding = adapter.extract_embedding(single_face_bytes)
    assert isinstance(embedding, Embedding)
    assert embedding.vector.shape == (512,)
    assert embedding.vector.dtype == np.float32
    assert embedding.model_name == "buffalo_sc"


# -- T4.5 ------------------------------------------------------------
def test_extract_embedding_normalizes_to_unit_vector(
    adapter: InsightFaceAdapter, single_face_bytes: bytes
) -> None:
    """T4.5: the embedding has unit L2 norm."""
    embedding = adapter.extract_embedding(single_face_bytes)
    norm = float(np.linalg.norm(embedding.vector))
    assert norm == pytest.approx(1.0, abs=1e-5)


# -- T4.6 ------------------------------------------------------------
def test_validate_image_quality_calculates_brightness(
    adapter: InsightFaceAdapter, single_face_bytes: bytes, dark_face_bytes: bytes
) -> None:
    """T4.6: brightness tracks illumination; dark variant scores lower."""
    bright = adapter.validate_image_quality(single_face_bytes)
    dark = adapter.validate_image_quality(dark_face_bytes)
    assert 0.0 <= bright.brightness <= 1.0
    assert 0.0 <= dark.brightness <= 1.0
    assert dark.brightness < bright.brightness


# -- T4.7 ------------------------------------------------------------
def test_validate_image_quality_calculates_sharpness(
    adapter: InsightFaceAdapter, single_face_bytes: bytes
) -> None:
    """T4.7: sharpness drops on a heavily blurred copy of the same face."""
    raw = np.frombuffer(single_face_bytes, dtype=np.uint8)
    img = cv2.imdecode(raw, cv2.IMREAD_COLOR)
    blurred = cv2.GaussianBlur(img, (31, 31), 0)
    _, encoded = cv2.imencode(".png", blurred)
    blurred_bytes = encoded.tobytes()

    sharp = adapter.validate_image_quality(single_face_bytes)
    blurry = adapter.validate_image_quality(blurred_bytes)
    assert 0.0 <= sharp.sharpness <= 1.0
    assert blurry.sharpness < sharp.sharpness


# -- T4.8 ------------------------------------------------------------
def test_validate_image_quality_calculates_face_size(
    adapter: InsightFaceAdapter, single_face_bytes: bytes
) -> None:
    """T4.8: face_size is a valid area ratio in (0, 1]."""
    quality = adapter.validate_image_quality(single_face_bytes)
    assert 0.0 < quality.face_size <= 1.0


# -- T4.9 ------------------------------------------------------------
def test_cosine_similarity_returns_value_between_minus_1_and_1(
    adapter: InsightFaceAdapter, single_face_bytes: bytes
) -> None:
    """T4.9: cosine similarity stays in [-1, 1]; self-match is ~1.0."""
    embedding = adapter.extract_embedding(single_face_bytes)
    same = adapter.extract_embedding(single_face_bytes)
    similarity = embedding.cosine_similarity(same)
    assert -1.0 <= similarity <= 1.0
    assert similarity == pytest.approx(1.0, abs=1e-5)


# -- extras (exception paths, overall score, factory) ----------------
def test_detect_face_invalid_bytes_raises_invalid_image_format(
    adapter: InsightFaceAdapter,
) -> None:
    """Garbage/empty bytes raise InvalidImageFormat on every entry point."""
    with pytest.raises(InvalidImageFormat):
        adapter.detect_face(b"not-an-image")
    with pytest.raises(InvalidImageFormat):
        adapter.extract_embedding(b"")
    with pytest.raises(InvalidImageFormat):
        adapter.validate_image_quality(b"not-an-image")


def test_extract_embedding_multi_face_raises(
    adapter: InsightFaceAdapter, multi_face_bytes: bytes
) -> None:
    """Embedding extraction refuses multi-face images."""
    with pytest.raises(MultipleFacesDetected):
        adapter.extract_embedding(multi_face_bytes)


def test_extract_embedding_no_face_raises(
    adapter: InsightFaceAdapter, no_face_bytes: bytes
) -> None:
    """Embedding extraction refuses images with no face."""
    with pytest.raises(NoFaceDetected):
        adapter.extract_embedding(no_face_bytes)


def test_pose_score_degrades_gracefully() -> None:
    """Pose falls back to neutral 0.5 without usable landmarks."""
    assert InsightFaceAdapter._pose_score(None) == 0.5
    assert InsightFaceAdapter._pose_score({"left_eye": (0, 0)}) == 0.5
    same_eye = {
        "left_eye": (10, 10),
        "right_eye": (10, 10),
        "nose": (10, 10),
        "left_mouth": (10, 10),
        "right_mouth": (10, 10),
    }
    assert InsightFaceAdapter._pose_score(same_eye) == 0.5


def test_validate_image_quality_accepts_explicit_detection(
    adapter: InsightFaceAdapter, single_face_bytes: bytes
) -> None:
    """Passing a detection explicitly skips re-detection."""
    detection = adapter.detect_face(single_face_bytes)
    quality = adapter.validate_image_quality(single_face_bytes, detection=detection)
    assert 0.0 <= quality.overall <= 1.0
    assert quality.pose == pytest.approx(adapter.validate_image_quality(single_face_bytes).pose)


def test_validate_image_quality_overall_in_range(
    adapter: InsightFaceAdapter, single_face_bytes: bytes
) -> None:
    """Overall score is a weighted mean in [0, 1] with all parts present."""
    quality = adapter.validate_image_quality(single_face_bytes)
    for component in (
        quality.overall,
        quality.brightness,
        quality.sharpness,
        quality.face_size,
        quality.pose,
    ):
        assert 0.0 <= component <= 1.0


def test_get_biometric_adapter_returns_cached_singleton() -> None:
    """Factory returns the same cached adapter instance."""
    first = get_biometric_adapter()
    second = get_biometric_adapter()
    assert first is second
    assert isinstance(first, InsightFaceAdapter)
