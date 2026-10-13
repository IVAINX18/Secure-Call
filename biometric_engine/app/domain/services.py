"""Business logic for biometric enrollment, verification, and liveness.

This is the ONLY business-logic layer: the API layer (Fase 7) decodes
base64 payloads and delegates here. All methods are bytes-based so the
API layer stays thin. Audit logging is best-effort and never masks the
original exception.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

import numpy as np
import structlog

from app.config import Settings, get_settings
from app.domain.exceptions import LowQualityFace
from app.domain.value_objects import Embedding, LivenessResult
from app.infrastructure.adapters.base import BiometricAdapter
from app.infrastructure.db.repository import load_embedding

logger = structlog.get_logger(__name__)

#: Audit action names written to the biometric_audit_log table.
ENROLL = "ENROLL"
VERIFY = "VERIFY"
LIVENESS_CHECK = "LIVENESS_CHECK"

#: Minimum accepted face-image quality. Mirrors the adapter's
#: GOOD_QUALITY_THRESHOLD gate (InsightFace adapter: overall >= 0.7
#: is "good"); the service enforces the same value here so the rule
#: lives with the business decision, not just the adapter.
MIN_QUALITY_SCORE = 0.7


class UserRepositoryPort(Protocol):
    """Structural port for user persistence (real: UserRepository)."""

    async def find_by_id(self, user_id: uuid.UUID) -> object | None:
        """Return the user row for ``user_id``, or None when missing."""
        ...

    async def create(
        self,
        email: str,
        password_hash: str,
        user_id: uuid.UUID | None = None,
    ) -> object:
        """Insert a user row and return it."""
        ...


class StoredRow(Protocol):
    """Minimal shape of a stored embedding row (real: UserFaceEmbedding)."""

    id: uuid.UUID


class EmbeddingRepositoryPort(Protocol):
    """Structural port for embedding persistence (real: EmbeddingRepository)."""

    async def save(
        self,
        user_id: uuid.UUID,
        embedding: np.ndarray,
        quality_score: float,
        model_version: str,
    ) -> StoredRow:
        """Store one embedding row and return it (must expose ``.id``)."""
        ...

    async def find_by_user(self, user_id: uuid.UUID) -> Sequence[StoredRow]:
        """Return active embedding rows for ``user_id``."""
        ...


class AuditRepositoryPort(Protocol):
    """Structural port for audit persistence (real: AuditLogRepository)."""

    async def log(
        self,
        user_id: uuid.UUID | None,
        action: str,
        success: bool,
        confidence_score: float | None = None,
        details: dict | None = None,
    ) -> object:
        """Append one audit entry and return it."""
        ...


class LivenessDetectorPort(Protocol):
    """Structural port for liveness detection (real: MediaPipeLivenessDetector)."""

    def detect_liveness(self, video_frames: list[bytes]) -> LivenessResult:
        """Decide liveness for a short sequence of encoded frames."""
        ...


@dataclass(frozen=True)
class EnrollResult:
    """Outcome of enrolling one face embedding for a user."""

    embedding_id: uuid.UUID
    quality_score: float


@dataclass(frozen=True)
class VerifyResult:
    """Outcome of verifying a face against a user's stored embeddings."""

    verified: bool
    confidence: float
    embedding_id: uuid.UUID | None


class BiometricService:
    """Orchestrates adapter, repositories, and liveness detection.

    Args:
        adapter: face detection / embedding / quality backend.
        user_repo: users table access (also used to auto-provision).
        embedding_repo: stored embedding rows.
        audit_repo: audit trail writer.
        liveness_detector: MediaPipe liveness backend.
        settings: runtime thresholds; defaults to the cached settings.
    """

    def __init__(
        self,
        adapter: BiometricAdapter,
        user_repo: UserRepositoryPort,
        embedding_repo: EmbeddingRepositoryPort,
        audit_repo: AuditRepositoryPort,
        liveness_detector: LivenessDetectorPort,
        settings: Settings | None = None,
    ) -> None:
        self._adapter = adapter
        self._user_repo = user_repo
        self._embedding_repo = embedding_repo
        self._audit_repo = audit_repo
        self._liveness = liveness_detector
        self._settings = settings or get_settings()

    async def _audit_best_effort(
        self,
        user_id: uuid.UUID | None,
        action: str,
        success: bool,
        confidence_score: float | None = None,
        details: dict | None = None,
    ) -> None:
        """Write one audit entry; swallow failures so they never mask callers."""
        try:
            await self._audit_repo.log(
                user_id=user_id,
                action=action,
                success=success,
                confidence_score=confidence_score,
                details=details,
            )
        except Exception as exc:  # noqa: BLE001 - best-effort audit must catch all
            # structlog's first positional arg IS the event; never pass event= kwarg.
            logger.warning("audit_write_failed", action=action, error=str(exc))

    async def _ensure_user(self, user_id: uuid.UUID) -> None:
        """Auto-provision the user row when missing.

        The users table exists only for FK integrity: authentication is
        external/mock (the Node frontend + JWT), so the service creates a
        placeholder row instead of requiring a real signup flow first.
        """
        existing = await self._user_repo.find_by_id(user_id)
        if existing is None:
            await self._user_repo.create(
                email=f"user-{user_id}@local",
                password_hash="",
                user_id=user_id,
            )

    async def enroll(self, user_id: uuid.UUID, image: bytes) -> EnrollResult:
        """Extract, quality-gate, store, and audit one face embedding."""
        try:
            await self._ensure_user(user_id)
            embedding = self._adapter.extract_embedding(image)
            quality = self._adapter.validate_image_quality(image)
            if quality.overall < MIN_QUALITY_SCORE:
                raise LowQualityFace(
                    details={
                        "overall": quality.overall,
                        "brightness": quality.brightness,
                        "sharpness": quality.sharpness,
                        "face_size": quality.face_size,
                        "pose": quality.pose,
                    }
                )
            row = await self._embedding_repo.save(
                user_id, embedding.vector, quality.overall, embedding.model_name
            )
            await self._audit_best_effort(
                user_id,
                ENROLL,
                True,
                confidence_score=quality.overall,
                details={
                    "overall": quality.overall,
                    "brightness": quality.brightness,
                    "sharpness": quality.sharpness,
                    "face_size": quality.face_size,
                    "pose": quality.pose,
                    "model_name": embedding.model_name,
                    "embedding_id": str(row.id),
                },
            )
            return EnrollResult(embedding_id=row.id, quality_score=quality.overall)
        except Exception as exc:
            await self._audit_best_effort(
                user_id,
                ENROLL,
                False,
                details={"error": type(exc).__name__, "message": str(exc)},
            )
            raise

    async def verify(self, user_id: uuid.UUID, image: bytes) -> VerifyResult:
        """Match one face against the user's stored embeddings (max cosine)."""
        try:
            probe = self._adapter.extract_embedding(image)
            rows = await self._embedding_repo.find_by_user(user_id)
            if not rows:
                await self._audit_best_effort(
                    user_id,
                    VERIFY,
                    False,
                    confidence_score=0.0,
                    details={"reason": "no_embeddings"},
                )
                return VerifyResult(verified=False, confidence=0.0, embedding_id=None)
            probe_emb = Embedding(vector=probe.vector, model_name=probe.model_name)
            best = -1.0
            best_id: uuid.UUID | None = None
            for row in rows:
                candidate = Embedding(vector=load_embedding(row))  # type: ignore[arg-type]
                score = probe_emb.cosine_similarity(candidate)
                if score > best:
                    best = score
                    best_id = row.id
            verified = best >= self._settings.BIOMETRIC_THRESHOLD
            await self._audit_best_effort(
                user_id,
                VERIFY,
                verified,
                confidence_score=best,
                details={"matched_embedding_id": str(best_id)},
            )
            return VerifyResult(verified=verified, confidence=best, embedding_id=best_id)
        except Exception as exc:
            await self._audit_best_effort(
                user_id,
                VERIFY,
                False,
                details={"error": type(exc).__name__, "message": str(exc)},
            )
            raise

    async def verify_liveness(
        self, user_id: uuid.UUID, video_frames: list[bytes]
    ) -> LivenessResult:
        """Run liveness detection over a frame sequence and audit the result."""
        try:
            result = self._liveness.detect_liveness(video_frames)
            await self._audit_best_effort(
                user_id,
                LIVENESS_CHECK,
                result.live,
                confidence_score=result.confidence,
                details={
                    "blink_detected": result.blink_detected,
                    "natural_movement": result.natural_movement,
                },
            )
            return result
        except Exception as exc:
            await self._audit_best_effort(
                user_id,
                LIVENESS_CHECK,
                False,
                details={"error": type(exc).__name__, "message": str(exc)},
            )
            raise
