"""Adapter protocol for biometric face operations.

Framework-free contract: Fase 6's ``BiometricService`` depends on this
protocol, not on any concrete face library.
"""

from __future__ import annotations

from typing import Protocol

from app.domain.value_objects import Embedding, FaceDetection, QualityScore


class BiometricAdapter(Protocol):
    """Structural contract every face backend must satisfy."""

    def detect_face(self, image: bytes) -> FaceDetection:
        """Detect exactly one face; raise ``NoFaceDetected`` / ``MultipleFacesDetected``."""
        ...

    def extract_embedding(self, image: bytes) -> Embedding:
        """Return the L2-normalized embedding of the single face in ``image``."""
        ...

    def validate_image_quality(
        self, image: bytes, detection: FaceDetection | None = None
    ) -> QualityScore:
        """Score image/face quality; ``overall >= 0.7`` is "good" (service enforces)."""
        ...
