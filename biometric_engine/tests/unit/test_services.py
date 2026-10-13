"""Unit tests for BiometricService (Fase 6, T6.1-T6.9 + extras).

All collaborators are in-file fakes with the SAME async signatures as the
real repositories, so service logic is tested without DB or ML models.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from types import SimpleNamespace

import numpy as np
import pytest

from app.config import Settings
from app.domain.exceptions import InsufficientFrames, LowQualityFace, NoFaceDetected
from app.domain.services import BiometricService
from app.domain.value_objects import Embedding, LivenessResult, QualityScore
from app.infrastructure.db.models import to_blob


def _vec(*values: float) -> np.ndarray:
    """Build a float32 test vector."""
    return np.array(values, dtype=np.float32)


def _quality(overall: float = 0.9) -> QualityScore:
    """Build a QualityScore with all components at ``overall``."""
    return QualityScore(
        overall=overall,
        brightness=overall,
        sharpness=overall,
        face_size=overall,
        pose=overall,
    )


def _row(embedding_id: uuid.UUID, vec: np.ndarray) -> FakeEmbeddingRow:
    """Build a fake embedding row that ``load_embedding`` can read."""
    return FakeEmbeddingRow(
        id=embedding_id,
        embedding=to_blob(vec),
        quality_score=0.9,
        model_version="test-model",
        is_active=True,
    )


@dataclass
class FakeEmbeddingRow:
    """Typed fake embedding row (satisfies the service's StoredRow port)."""

    id: uuid.UUID
    embedding: bytes
    quality_score: float = 0.9
    model_version: str = "test-model"
    is_active: bool = True


class FakeAdapter:
    """Fake BiometricAdapter with configurable returns and failures."""

    def __init__(
        self,
        vector: np.ndarray | None = None,
        quality: QualityScore | None = None,
        extract_error: Exception | None = None,
        model_name: str = "test-model",
    ) -> None:
        self._vector = vector if vector is not None else _vec(1.0, 0.0, 0.0)
        self._quality = quality if quality is not None else _quality(0.9)
        self._extract_error = extract_error
        self._model_name = model_name
        self.extract_calls = 0

    def detect_face(self, image: bytes):  # type: ignore[no-untyped-def]
        """Not used by the service; present for protocol shape."""
        raise NotImplementedError

    def extract_embedding(self, image: bytes) -> Embedding:
        """Return the configured vector or raise the configured error."""
        self.extract_calls += 1
        if self._extract_error is not None:
            raise self._extract_error
        return Embedding(vector=self._vector, model_name=self._model_name)

    def validate_image_quality(self, image: bytes, detection=None) -> QualityScore:  # type: ignore[no-untyped-def]
        """Return the configured quality score."""
        return self._quality


class FakeLivenessDetector:
    """Fake liveness detector returning a prebuilt LivenessResult."""

    def __init__(self, result: LivenessResult | None = None) -> None:
        self._result = result or LivenessResult(
            live=True,
            confidence=0.9,
            blink_detected=True,
            natural_movement=True,
            details={},
        )
        self.calls = 0

    def detect_liveness(self, video_frames: list[bytes]) -> LivenessResult:
        """Return the prebuilt result and record the call."""
        self.calls += 1
        return self._result


class FakeUserRepo:
    """Fake UserRepository with the real async method signatures."""

    def __init__(self, existing_ids: set[uuid.UUID] | None = None) -> None:
        self._ids: set[uuid.UUID] = set(existing_ids or set())
        self.created: list[tuple[str, str]] = []

    async def create(
        self,
        email: str,
        password_hash: str,
        user_id: uuid.UUID | None = None,
    ) -> SimpleNamespace:
        """Record the creation and pretend the user now exists."""
        self.created.append((email, password_hash))
        if user_id is not None:
            self._ids.add(user_id)
        return SimpleNamespace(email=email)

    async def find_by_email(self, email: str) -> SimpleNamespace | None:
        """Not used by the service; present for signature parity."""
        return None

    async def find_by_id(self, user_id: uuid.UUID) -> SimpleNamespace | None:
        """Return a stub when the id is known, else None."""
        if user_id in self._ids:
            return SimpleNamespace(id=user_id)
        return None

    def mark_existing(self, user_id: uuid.UUID) -> None:
        """Register a user id as already present."""
        self._ids.add(user_id)


class FakeEmbeddingRepo:
    """Fake EmbeddingRepository with the real async method signatures."""

    def __init__(self, rows: list[FakeEmbeddingRow] | None = None) -> None:
        self._rows: list[FakeEmbeddingRow] = list(rows or [])
        self.saved: list[tuple[uuid.UUID, np.ndarray, float, str]] = []

    async def save(
        self,
        user_id: uuid.UUID,
        embedding: np.ndarray,
        quality_score: float,
        model_version: str,
    ) -> FakeEmbeddingRow:
        """Record the save and return a new fake row."""
        self.saved.append((user_id, embedding, quality_score, model_version))
        row = FakeEmbeddingRow(
            id=uuid.uuid4(),
            embedding=to_blob(embedding),
            quality_score=quality_score,
            model_version=model_version,
            is_active=True,
        )
        self._rows.append(row)
        return row

    async def find_by_user(self, user_id: uuid.UUID) -> list[FakeEmbeddingRow]:
        """Return all staged rows (per-test fixtures are single-user)."""
        return list(self._rows)

    async def deactivate(self, embedding_id: uuid.UUID) -> None:
        """Mark the matching row inactive."""
        for row in self._rows:
            if row.id == embedding_id:
                row.is_active = False


class FakeAuditRepo:
    """Fake AuditLogRepository capturing log() calls."""

    def __init__(self, fail_on_log: bool = False) -> None:
        self.entries: list[dict] = []
        self._fail = fail_on_log

    async def log(
        self,
        user_id: uuid.UUID | None,
        action: str,
        success: bool,
        confidence_score: float | None = None,
        details: dict | None = None,
    ) -> SimpleNamespace:
        """Capture the entry, or raise when simulating audit failure."""
        if self._fail:
            raise RuntimeError("audit store unavailable")
        entry = {
            "user_id": user_id,
            "action": action,
            "success": success,
            "confidence_score": confidence_score,
            "details": details,
        }
        self.entries.append(entry)
        return SimpleNamespace(**entry)

    async def find_by_user(
        self, user_id: uuid.UUID, limit: int = 50
    ) -> list[SimpleNamespace]:
        """Return captured entries for parity with the real signature."""
        return [SimpleNamespace(**e) for e in self.entries[:limit]]


def _settings() -> Settings:
    """Build test settings without touching env files."""
    return Settings(
        DATABASE_URL="postgresql+asyncpg://u:p@localhost:1/db",
        REDIS_URL="redis://localhost:1/0",
        JWT_SECRET_KEY="test-secret-not-real",
        BIOMETRIC_THRESHOLD=0.85,
        LIVENESS_THRESHOLD=0.7,
    )


def _service(
    adapter: FakeAdapter | None = None,
    user_repo: FakeUserRepo | None = None,
    embedding_repo: FakeEmbeddingRepo | None = None,
    audit_repo: FakeAuditRepo | None = None,
    liveness: FakeLivenessDetector | None = None,
) -> tuple[BiometricService, FakeAuditRepo, FakeEmbeddingRepo, FakeUserRepo]:
    """Build a service with fakes; user pre-exists unless stated otherwise."""
    user_id_probe = uuid.uuid4()
    users = user_repo or FakeUserRepo(existing_ids={user_id_probe})
    audits = audit_repo or FakeAuditRepo()
    embeddings = embedding_repo or FakeEmbeddingRepo()
    svc = BiometricService(
        adapter=adapter or FakeAdapter(),
        user_repo=users,
        embedding_repo=embeddings,
        audit_repo=audits,
        liveness_detector=liveness or FakeLivenessDetector(),
        settings=_settings(),
    )
    return svc, audits, embeddings, users


# -- T6.1 ---------------------------------------------------------------


async def test_enroll_extracts_and_saves_embedding() -> None:
    """T6.1: enroll extracts the vector and saves it with quality + model."""
    vec = _vec(1.0, 0.0, 0.0)
    svc, _, embeddings, _ = _service(adapter=FakeAdapter(vector=vec))
    result = await svc.enroll(uuid.uuid4(), b"fake-image")
    assert result.quality_score == pytest.approx(0.9)
    assert len(embeddings.saved) == 1
    _user_id, saved_vec, quality, model = embeddings.saved[0]
    assert np.allclose(saved_vec, vec)
    assert quality == pytest.approx(0.9)
    assert model == "test-model"
    assert result.embedding_id is not None


# -- T6.2 ---------------------------------------------------------------


async def test_enroll_low_quality_raises_low_quality_face() -> None:
    """T6.2: quality below MIN_QUALITY_SCORE raises LowQualityFace."""
    svc, _, embeddings, _ = _service(adapter=FakeAdapter(quality=_quality(0.2)))
    with pytest.raises(LowQualityFace):
        await svc.enroll(uuid.uuid4(), b"fake-image")
    assert embeddings.saved == []


# -- T6.3 ---------------------------------------------------------------


async def test_enroll_logs_audit_entry() -> None:
    """T6.3: successful enroll writes one ENROLL success audit entry."""
    user_id = uuid.uuid4()
    users = FakeUserRepo(existing_ids={user_id})
    audits = FakeAuditRepo()
    svc = BiometricService(
        adapter=FakeAdapter(),
        user_repo=users,
        embedding_repo=FakeEmbeddingRepo(),
        audit_repo=audits,
        liveness_detector=FakeLivenessDetector(),
        settings=_settings(),
    )
    await svc.enroll(user_id, b"fake-image")
    assert len(audits.entries) == 1
    entry = audits.entries[0]
    assert entry["action"] == "ENROLL"
    assert entry["success"] is True
    assert entry["user_id"] == user_id


# -- T6.4 ---------------------------------------------------------------


async def test_verify_matching_embedding_returns_verified_true() -> None:
    """T6.4: same vector (cosine ~1.0) verifies True."""
    vec = _vec(1.0, 2.0, 3.0)
    user_id = uuid.uuid4()
    rows = [_row(uuid.uuid4(), vec)]
    svc, _, _, _ = _service(
        adapter=FakeAdapter(vector=vec),
        user_repo=FakeUserRepo(existing_ids={user_id}),
        embedding_repo=FakeEmbeddingRepo(rows=rows),
    )
    result = await svc.verify(user_id, b"fake-image")
    assert result.verified is True
    assert result.confidence == pytest.approx(1.0)
    assert result.embedding_id == rows[0].id


# -- T6.5 ---------------------------------------------------------------


async def test_verify_non_matching_returns_verified_false() -> None:
    """T6.5: orthogonal vector (cosine 0.0) verifies False."""
    stored = _vec(1.0, 0.0, 0.0)
    probe = _vec(0.0, 1.0, 0.0)
    user_id = uuid.uuid4()
    rows = [_row(uuid.uuid4(), stored)]
    svc, _, _, _ = _service(
        adapter=FakeAdapter(vector=probe),
        user_repo=FakeUserRepo(existing_ids={user_id}),
        embedding_repo=FakeEmbeddingRepo(rows=rows),
    )
    result = await svc.verify(user_id, b"fake-image")
    assert result.verified is False
    assert result.confidence == pytest.approx(0.0)
    assert result.embedding_id == rows[0].id


# -- T6.6 ---------------------------------------------------------------


async def test_verify_no_embeddings_returns_verified_false() -> None:
    """T6.6: no stored rows returns False with 0.0 confidence, no exception."""
    user_id = uuid.uuid4()
    svc, _, _, _ = _service(user_repo=FakeUserRepo(existing_ids={user_id}))
    result = await svc.verify(user_id, b"fake-image")
    assert result.verified is False
    assert result.confidence == pytest.approx(0.0)
    assert result.embedding_id is None


# -- T6.7 ---------------------------------------------------------------


async def test_verify_logs_audit_entry() -> None:
    """T6.7: verify writes one VERIFY audit entry with the confidence."""
    user_id = uuid.uuid4()
    rows = [_row(uuid.uuid4(), _vec(1.0, 0.0))]
    audits = FakeAuditRepo()
    svc = BiometricService(
        adapter=FakeAdapter(vector=_vec(1.0, 0.0)),
        user_repo=FakeUserRepo(existing_ids={user_id}),
        embedding_repo=FakeEmbeddingRepo(rows=rows),
        audit_repo=audits,
        liveness_detector=FakeLivenessDetector(),
        settings=_settings(),
    )
    result = await svc.verify(user_id, b"fake-image")
    assert len(audits.entries) == 1
    entry = audits.entries[0]
    assert entry["action"] == "VERIFY"
    assert entry["success"] is True
    assert entry["confidence_score"] == pytest.approx(result.confidence)


# -- T6.8 / T6.9 --------------------------------------------------------


async def test_verify_liveness_live_video_returns_live_true() -> None:
    """T6.8: detector live=True passes through plus success audit."""
    user_id = uuid.uuid4()
    audits = FakeAuditRepo()
    live = LivenessResult(
        live=True,
        confidence=0.9,
        blink_detected=True,
        natural_movement=True,
        details={},
    )
    svc = BiometricService(
        adapter=FakeAdapter(),
        user_repo=FakeUserRepo(existing_ids={user_id}),
        embedding_repo=FakeEmbeddingRepo(),
        audit_repo=audits,
        liveness_detector=FakeLivenessDetector(result=live),
        settings=_settings(),
    )
    result = await svc.verify_liveness(user_id, [b"f"] * 5)
    assert result.live is True
    assert result.confidence == pytest.approx(0.9)
    assert audits.entries[0]["action"] == "LIVENESS_CHECK"
    assert audits.entries[0]["success"] is True


async def test_verify_liveness_static_video_returns_live_false() -> None:
    """T6.9: detector live=False passes through plus failure audit."""
    user_id = uuid.uuid4()
    audits = FakeAuditRepo()
    static = LivenessResult(
        live=False,
        confidence=0.0,
        blink_detected=False,
        natural_movement=False,
        details={},
    )
    svc = BiometricService(
        adapter=FakeAdapter(),
        user_repo=FakeUserRepo(existing_ids={user_id}),
        embedding_repo=FakeEmbeddingRepo(),
        audit_repo=audits,
        liveness_detector=FakeLivenessDetector(result=static),
        settings=_settings(),
    )
    result = await svc.verify_liveness(user_id, [b"f"] * 5)
    assert result.live is False
    assert audits.entries[0]["action"] == "LIVENESS_CHECK"
    assert audits.entries[0]["success"] is False


# -- extras -------------------------------------------------------------


async def test_enroll_auto_provisions_missing_user() -> None:
    """Extra: enroll creates the placeholder user row when it is missing."""
    user_id = uuid.uuid4()
    users = FakeUserRepo(existing_ids=set())
    svc = BiometricService(
        adapter=FakeAdapter(),
        user_repo=users,
        embedding_repo=FakeEmbeddingRepo(),
        audit_repo=FakeAuditRepo(),
        liveness_detector=FakeLivenessDetector(),
        settings=_settings(),
    )
    await svc.enroll(user_id, b"fake-image")
    assert len(users.created) == 1
    email, password_hash = users.created[0]
    assert email == f"user-{user_id}@local"
    assert password_hash == ""


async def test_verify_adapter_exception_writes_failure_audit_and_reraises() -> None:
    """Extra: adapter failure in verify audits success=False then re-raises."""
    user_id = uuid.uuid4()
    audits = FakeAuditRepo()
    svc = BiometricService(
        adapter=FakeAdapter(extract_error=NoFaceDetected()),
        user_repo=FakeUserRepo(existing_ids={user_id}),
        embedding_repo=FakeEmbeddingRepo(),
        audit_repo=audits,
        liveness_detector=FakeLivenessDetector(),
        settings=_settings(),
    )
    with pytest.raises(NoFaceDetected):
        await svc.verify(user_id, b"fake-image")
    assert len(audits.entries) == 1
    assert audits.entries[0]["success"] is False
    assert audits.entries[0]["details"]["error"] == "NoFaceDetected"


async def test_audit_failure_never_masks_original_exception() -> None:
    """Extra: a broken audit store does not hide the domain exception."""
    user_id = uuid.uuid4()
    svc = BiometricService(
        adapter=FakeAdapter(extract_error=NoFaceDetected("no face here")),
        user_repo=FakeUserRepo(existing_ids={user_id}),
        embedding_repo=FakeEmbeddingRepo(),
        audit_repo=FakeAuditRepo(fail_on_log=True),
        liveness_detector=FakeLivenessDetector(),
        settings=_settings(),
    )
    with pytest.raises(NoFaceDetected):
        await svc.verify(user_id, b"fake-image")


class _RaisingLivenessDetector:
    """Liveness detector fake that raises (covers the service except path)."""

    def __init__(self, error: Exception) -> None:
        self._error = error

    def detect_liveness(self, video_frames: list[bytes]) -> LivenessResult:
        """Raise the configured error."""
        raise self._error


async def test_verify_liveness_detector_error_audits_failure_and_reraises() -> None:
    """Extra: liveness detector failure audits success=False then re-raises."""
    user_id = uuid.uuid4()
    audits = FakeAuditRepo()
    svc = BiometricService(
        adapter=FakeAdapter(),
        user_repo=FakeUserRepo(existing_ids={user_id}),
        embedding_repo=FakeEmbeddingRepo(),
        audit_repo=audits,
        liveness_detector=_RaisingLivenessDetector(InsufficientFrames()),
        settings=_settings(),
    )
    with pytest.raises(InsufficientFrames):
        await svc.verify_liveness(user_id, [b"f"])
    assert len(audits.entries) == 1
    assert audits.entries[0]["action"] == "LIVENESS_CHECK"
    assert audits.entries[0]["success"] is False
    assert audits.entries[0]["details"]["error"] == "InsufficientFrames"
