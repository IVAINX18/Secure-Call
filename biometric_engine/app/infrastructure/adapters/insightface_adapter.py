"""InsightFace-based implementation of the biometric adapter.

Lazy model loading: importing this module (or constructing the
adapter) performs no heavy work. The ``FaceAnalysis`` model is built
on first inference, so Fase 2's FastAPI app keeps importing fast.
"""

from __future__ import annotations

import threading
from typing import Any

import cv2
import numpy as np

from app.domain.exceptions import (
    InvalidImageFormat,
    MultipleFacesDetected,
    NoFaceDetected,
)
from app.domain.value_objects import (
    Embedding,
    FaceDetection,
    QualityScore,
    l2_normalize,
)

# Landmark keys in InsightFace 5-point (kps) order.
_LANDMARK_NAMES = (
    "left_eye",
    "right_eye",
    "nose",
    "left_mouth",
    "right_mouth",
)

# Laplacian-variance reference: sharp frontal face crops typically score
# in the hundreds; blurred/dark captures fall well below ~100. The
# sharpness component is min(1, variance / _SHARPNESS_REF).
_SHARPNESS_REF = 200.0

# Weighted-mean weights for QualityScore.overall (sum = 1.0).
# Sharpness and pose dominate because blur and profile views are the
# most common causes of bad embeddings; brightness and face size matter
# less once a face is detected.
_WEIGHTS = {
    "brightness": 0.2,
    "sharpness": 0.3,
    "face_size": 0.2,
    "pose": 0.3,
}

#: Overall score at or above this value counts as "good". The service
#: layer (Fase 6) enforces this gate on enrollment.
GOOD_QUALITY_THRESHOLD = 0.7


class InsightFaceAdapter:
    """Face detection + ArcFace embeddings via InsightFace.

    Args:
        model_name: InsightFace model pack. ``"buffalo_sc"`` (small /
            fast, default) keeps CPU inference quick; ``"buffalo_l"``
            is the higher-accuracy option. Downloaded once to
            ``~/.insightface`` on first inference.
    """

    def __init__(self, model_name: str = "buffalo_sc") -> None:
        self._model_name = model_name
        self._app: Any = None
        self._lock = threading.Lock()

    # -- lazy model -------------------------------------------------
    @property
    def _analysis_app(self) -> Any:
        """Build the FaceAnalysis app on first use (thread-safe)."""
        if self._app is None:
            with self._lock:
                if self._app is None:
                    from insightface.app import FaceAnalysis

                    app = FaceAnalysis(
                        name=self._model_name,
                        providers=["CPUExecutionProvider"],
                    )
                    app.prepare(ctx_id=-1, det_size=(640, 640))
                    self._app = app
        return self._app

    # -- helpers ----------------------------------------------------
    @staticmethod
    def _decode(image: bytes) -> np.ndarray:
        """Decode raw bytes to a BGR image; raise ``InvalidImageFormat`` if unreadable."""
        if not image:
            raise InvalidImageFormat(details={"reason": "empty input"})
        data = np.frombuffer(image, dtype=np.uint8)
        decoded = cv2.imdecode(data, cv2.IMREAD_COLOR)
        if decoded is None:
            raise InvalidImageFormat(details={"reason": "cv2.imdecode returned None"})
        return decoded

    @staticmethod
    def _to_detection(face) -> FaceDetection:  # type: ignore[no-untyped-def]
        """Convert one InsightFace Face object to a domain FaceDetection."""
        x1, y1, x2, y2 = (int(v) for v in face.bbox)
        landmarks: dict[str, tuple[int, int]] | None = None
        if getattr(face, "kps", None) is not None:
            landmarks = {name: (int(x), int(y)) for name, (x, y) in zip(_LANDMARK_NAMES, face.kps)}
        return FaceDetection(
            bbox=(x1, y1, x2, y2),
            confidence=float(face.det_score),
            landmarks=landmarks,
        )

    def _get_faces(self, image: bytes) -> tuple[np.ndarray, list]:  # type: ignore[no-untyped-def]
        """Decode ``image`` and run detection; return (bgr, faces)."""
        bgr = self._decode(image)
        faces = self._analysis_app.get(bgr)
        return bgr, faces

    # -- protocol ---------------------------------------------------
    def detect_face(self, image: bytes) -> FaceDetection:
        """Detect exactly one face in ``image``.

        Raises:
            InvalidImageFormat: bytes cannot be decoded.
            NoFaceDetected: no face found.
            MultipleFacesDetected: more than one face found.
        """
        _, faces = self._get_faces(image)
        if len(faces) == 0:
            raise NoFaceDetected()
        if len(faces) > 1:
            raise MultipleFacesDetected(
                details={"face_count": len(faces)},
            )
        return self._to_detection(faces[0])

    def extract_embedding(self, image: bytes) -> Embedding:
        """Extract the L2-normalized 512-dim embedding of the single face.

        Raises:
            InvalidImageFormat: bytes cannot be decoded.
            NoFaceDetected: no face found.
            MultipleFacesDetected: more than one face found.
        """
        _, faces = self._get_faces(image)
        if len(faces) == 0:
            raise NoFaceDetected()
        if len(faces) > 1:
            raise MultipleFacesDetected(
                details={"face_count": len(faces)},
            )
        vector = l2_normalize(np.asarray(faces[0].embedding, dtype=np.float32))
        return Embedding(vector=vector, model_name=self._model_name)

    def validate_image_quality(
        self, image: bytes, detection: FaceDetection | None = None
    ) -> QualityScore:
        """Score brightness, sharpness, face size and pose in [0, 1].

        - brightness: grayscale mean / 255.
        - sharpness: ``min(1, laplacian_variance / 200)`` where the
          variance comes from ``cv2.Laplacian(gray, CV_64F).var()``.
        - face_size: face bbox area / image area, saturated at 1.0.
        - pose: frontal-ness from landmark geometry (1.0 = frontal).
        - overall: weighted mean (0.2 brightness + 0.3 sharpness +
          0.2 face_size + 0.3 pose); >= 0.7 is "good".

        When ``detection`` is omitted the face is detected first, which
        raises ``NoFaceDetected`` / ``MultipleFacesDetected`` as usual.
        """
        bgr = self._decode(image)
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        height, width = gray.shape

        if detection is None:
            detection = self.detect_face(image)

        brightness = float(np.mean(gray)) / 255.0

        laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        sharpness = min(1.0, laplacian_var / _SHARPNESS_REF)

        x1, y1, x2, y2 = detection.bbox
        face_area = max(0, x2 - x1) * max(0, y2 - y1)
        image_area = max(1, width * height)
        face_size = min(1.0, face_area / image_area)

        pose = self._pose_score(detection.landmarks)

        overall = (
            _WEIGHTS["brightness"] * brightness
            + _WEIGHTS["sharpness"] * sharpness
            + _WEIGHTS["face_size"] * face_size
            + _WEIGHTS["pose"] * pose
        )
        return QualityScore(
            overall=float(overall),
            brightness=float(min(1.0, max(0.0, brightness))),
            sharpness=float(sharpness),
            face_size=float(face_size),
            pose=float(pose),
        )

    # -- quality internals ------------------------------------------
    @staticmethod
    def _pose_score(landmarks: dict[str, tuple[int, int]] | None) -> float:
        """Estimate frontal-ness in [0, 1] from 5-point landmarks.

        Combines three symmetry cues, each 0 when perfectly frontal:
        eye-level tilt, nose offset from the eye midpoint, and mouth
        offset from the eye midpoint (all normalized by eye distance).
        Missing landmarks degrade gracefully to a neutral 0.5.
        """
        if landmarks is None:
            return 0.5
        try:
            left_eye = np.array(landmarks["left_eye"], dtype=float)
            right_eye = np.array(landmarks["right_eye"], dtype=float)
            nose = np.array(landmarks["nose"], dtype=float)
            left_mouth = np.array(landmarks["left_mouth"], dtype=float)
            right_mouth = np.array(landmarks["right_mouth"], dtype=float)
        except KeyError:
            return 0.5
        eye_distance = float(np.linalg.norm(right_eye - left_eye))
        if eye_distance <= 0.0:
            return 0.5
        eye_mid = (left_eye + right_eye) / 2.0
        mouth_mid = (left_mouth + right_mouth) / 2.0
        eye_tilt = abs(left_eye[1] - right_eye[1]) / eye_distance
        nose_offset = abs(nose[0] - eye_mid[0]) / eye_distance
        mouth_offset = abs(mouth_mid[0] - eye_mid[0]) / eye_distance
        deviation = 2.0 * eye_tilt + 1.5 * nose_offset + 1.0 * mouth_offset
        return float(min(1.0, max(0.0, 1.0 - deviation)))
