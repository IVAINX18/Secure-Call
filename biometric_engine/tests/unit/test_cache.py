"""Unit tests for the Fase 8 embeddings cache (T8.1-T8.3 + extras).

The service is exercised with the same fake repos/adapter as
``test_services.py`` plus a hand-rolled in-memory async fake Redis
(no new dependencies). ``RedisCache`` itself is the real class under
test, so serialization round-trips are covered exactly as production
uses them.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import numpy as np
import pytest

from app.config import Settings
from app.domain.services import BiometricService
from app.domain.value_objects import Embedding, QualityScore
from app.infrastructure.cache.redis_cache import RedisCache
from app.infrastructure.db.models import to_blob
from app.infrastructure.db.repository import load_embedding


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


@dataclass
class FakeEmbeddingRow:
    """Typed fake embedding row (mirrors test_services.py)."""

    id: uuid.UUID
    embedding: bytes
    quality_score: float = 0.9
    model_version: str = "test-model"
    is_active: bool = True


def _row(embedding_id: uuid.UUID, vec: np.ndarray) -> FakeEmbeddingRow:
    """Build a fake embedding row that ``load_embedding`` can read."""
    return FakeEmbeddingRow(id=embedding_id, embedding=to_blob(vec))


class FakeRedis:
    """Hand-rolled in-memory async Redis (get/set/delete only)."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.last_ex: int | None = None
        self.get_calls = 0
        self.set_calls = 0
        self.delete_calls = 0

    async def get(self, key: str) -> str | None:
        """Return the stored string, or None on miss."""
        self.get_calls += 1
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> bool:
        """Store the string and record the TTL argument."""
        self.set_calls += 1
        self.last_ex = ex
        self.store[key] = value
        return True

    async def delete(self, *keys: str) -> int:
        """Remove keys; return how many existed."""
        self.delete_calls += 1
        removed = sum(1 for key in keys if self.store.pop(key, None) is not None)
        return removed


class BrokenRedis(FakeRedis):
    """Fake Redis that raises on every operation (outage simulation)."""

    async def get(self, key: str) -> str | None:
        """Raise to simulate a cache outage on reads."""
        raise ConnectionError("redis down")

    async def set(self, key: str, value: str, ex: int | None = None) -> bool:
        """Raise to simulate a cache outage on writes."""
        raise ConnectionError("redis down")

    async def delete(self, *keys: str) -> int:
        """Raise to simulate a cache outage on deletes."""
        raise ConnectionError("redis down")


class FakeAdapter:
    """Fake BiometricAdapter returning a configured vector."""

    def __init__(self, vector: np.ndarray | None = None) -> None:
        self._vector = vector if vector is not None else _vec(1.0, 0.0, 0.0)

    def detect_face(self, image: bytes):  # type: ignore[no-untyped-def]
        """Not used by the service; present for protocol shape."""
        raise NotImplementedError

    def extract_embedding(self, image: bytes) -> Embedding:
        """Return the configured vector regardless of input."""
        return Embedding(vector=self._vector, model_name="test-model")

    def validate_image_quality(self, image: bytes, detection=None) -> QualityScore:  # type: ignore[no-untyped-def]
        """Always report good quality (cache tests never hit the gate)."""
        return _quality(0.9)


class FakeUserRepo:
    """Fake UserRepository where every probed user pre-exists."""

    def __init__(self, existing_ids: set[uuid.UUID] | None = None) -> None:
        self._ids: set[uuid.UUID] = set(existing_ids or set())

    async def create(
        self,
        email: str,
        password_hash: str,
        user_id: uuid.UUID | None = None,
    ) -> object:
        """Pretend the user now exists."""
        if user_id is not None:
            self._ids.add(user_id)
        return object()

    async def find_by_id(self, user_id: uuid.UUID) -> object | None:
        """Return a stub when the id is known, else None."""
        return object() if user_id in self._ids else None


class FakeEmbeddingRepo:
    """Fake EmbeddingRepository counting find_by_user calls."""

    def __init__(self, rows: list[FakeEmbeddingRow] | None = None) -> None:
        self._rows: list[FakeEmbeddingRow] = list(rows or [])
        self.find_calls = 0

    async def save(
        self,
        user_id: uuid.UUID,
        embedding: np.ndarray,
        quality_score: float,
        model_version: str,
    ) -> FakeEmbeddingRow:
        """Record the save and return a new fake row."""
        row = FakeEmbeddingRow(
            id=uuid.uuid4(),
            embedding=to_blob(embedding),
            quality_score=quality_score,
            model_version=model_version,
        )
        self._rows.append(row)
        return row

    async def find_by_user(self, user_id: uuid.UUID) -> list[FakeEmbeddingRow]:
        """Count the call, then return all staged rows."""
        self.find_calls += 1
        return list(self._rows)


class FakeAuditRepo:
    """Fake AuditLogRepository capturing log() calls."""

    def __init__(self) -> None:
        self.entries: list[dict] = []

    async def log(
        self,
        user_id: uuid.UUID | None,
        action: str,
        success: bool,
        confidence_score: float | None = None,
        details: dict | None = None,
    ) -> object:
        """Capture the entry."""
        self.entries.append(
            {
                "user_id": user_id,
                "action": action,
                "success": success,
                "confidence_score": confidence_score,
                "details": details,
            }
        )
        return object()


class FakeLiveness:
    """Liveness-detector stub (unused by verify/enroll, required by ctor)."""

    def detect_liveness(self, video_frames: list[bytes]) -> object:
        """Never called in cache tests."""
        raise NotImplementedError


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
    rows: list[FakeEmbeddingRow] | None = None,
    probe: np.ndarray | None = None,
    redis: FakeRedis | BrokenRedis | None = None,
    user_id: uuid.UUID | None = None,
) -> tuple[BiometricService, FakeEmbeddingRepo, FakeRedis | BrokenRedis, uuid.UUID]:
    """Build a cache-wired service; the user pre-exists."""
    uid = user_id or uuid.uuid4()
    repo = FakeEmbeddingRepo(rows=rows)
    fake_redis: FakeRedis | BrokenRedis = redis if redis is not None else FakeRedis()
    svc = BiometricService(
        adapter=FakeAdapter(vector=probe),
        user_repo=FakeUserRepo(existing_ids={uid}),
        embedding_repo=repo,
        audit_repo=FakeAuditRepo(),
        liveness_detector=FakeLiveness(),  # type: ignore[arg-type]
        settings=_settings(),
        cache=RedisCache(fake_redis),
    )
    return svc, repo, fake_redis, uid


# -- T8.1 ---------------------------------------------------------------


async def test_cache_hit_avoids_db_query() -> None:
    """T8.1: a warm cache serves verify with zero DB queries."""
    vec = _vec(1.0, 2.0, 3.0)
    uid = uuid.uuid4()
    rows = [_row(uuid.uuid4(), vec)]
    fake_redis = FakeRedis()
    svc, repo, _, _ = _service(rows=rows, probe=vec, redis=fake_redis, user_id=uid)
    # First verify: miss -> DB -> populate cache.
    first = await svc.verify(uid, b"fake-image")
    assert first.verified is True
    assert repo.find_calls == 1
    # Second verify: hit -> no additional DB query.
    second = await svc.verify(uid, b"fake-image")
    assert second.verified is True
    assert repo.find_calls == 1
    assert second.confidence == pytest.approx(first.confidence)
    assert second.embedding_id == first.embedding_id


# -- T8.2 ---------------------------------------------------------------


async def test_cache_miss_queries_db_and_sets_cache() -> None:
    """T8.2: a cold cache queries the DB once and stores the rows."""
    vec = _vec(1.0, 0.0, 0.0)
    uid = uuid.uuid4()
    rows = [_row(uuid.uuid4(), vec)]
    fake_redis = FakeRedis()
    svc, repo, _, _ = _service(rows=rows, probe=vec, redis=fake_redis, user_id=uid)
    assert await fake_redis.get(f"biometric:embeddings:{uid}") is None
    result = await svc.verify(uid, b"fake-image")
    assert result.verified is True
    assert repo.find_calls == 1
    assert fake_redis.set_calls == 1
    # TTL comes from the EMBEDDING_CACHE_TTL setting (300s default).
    assert fake_redis.last_ex == 300
    cached = await RedisCache(fake_redis).get_embeddings(uid)
    assert cached is not None
    assert [r.id for r in cached] == [r.id for r in rows]


# -- T8.3 ---------------------------------------------------------------


async def test_cache_invalidate_clears_user_embeddings() -> None:
    """T8.3: enroll invalidates the user's cache entry."""
    vec = _vec(1.0, 0.0, 0.0)
    uid = uuid.uuid4()
    rows = [_row(uuid.uuid4(), vec)]
    fake_redis = FakeRedis()
    svc, repo, _, _ = _service(rows=rows, probe=vec, redis=fake_redis, user_id=uid)
    await svc.verify(uid, b"fake-image")
    assert await RedisCache(fake_redis).get_embeddings(uid) is not None
    await svc.enroll(uid, b"fake-image")
    assert await RedisCache(fake_redis).get_embeddings(uid) is None
    assert fake_redis.delete_calls == 1
    # The next verify goes back to the DB (now two enrolled rows).
    await svc.verify(uid, b"fake-image")
    assert repo.find_calls == 2


# -- extras -------------------------------------------------------------


async def test_cache_path_result_matches_db_path_result() -> None:
    """Extra: cached verify returns the IDENTICAL outcome as the DB path."""
    stored = _vec(0.2, 0.5, 0.9)
    probe = _vec(0.21, 0.49, 0.91)
    uid = uuid.uuid4()
    row_id = uuid.uuid4()
    fake_redis = FakeRedis()
    svc, _, _, _ = _service(
        rows=[_row(row_id, stored)], probe=probe, redis=fake_redis, user_id=uid
    )
    db_result = await svc.verify(uid, b"fake-image")
    cache_result = await svc.verify(uid, b"fake-image")
    assert cache_result.verified == db_result.verified
    assert cache_result.confidence == pytest.approx(db_result.confidence)
    assert cache_result.embedding_id == db_result.embedding_id == row_id


async def test_cached_blobs_round_trip_bit_exact() -> None:
    """Extra: embedding bytes survive set/get without a single bit flip."""
    vec = _vec(0.123456, -4.567, 8.9e-3, 100.25)
    uid = uuid.uuid4()
    rows = [_row(uuid.uuid4(), vec), _row(uuid.uuid4(), vec * 2)]
    cache = RedisCache(FakeRedis())
    await cache.set_embeddings(uid, rows)
    cached = await cache.get_embeddings(uid)
    assert cached is not None
    assert [r.id for r in cached] == [r.id for r in rows]
    for got, want in zip(cached, rows):
        # Read through the real consumer (load_embedding), exactly like
        # the service's verify path does.
        assert load_embedding(got) is not None  # type: ignore[arg-type]
        assert np.array_equal(load_embedding(got), load_embedding(want))  # type: ignore[arg-type]


async def test_cache_outage_falls_back_to_db() -> None:
    """Extra: Redis errors never break verify (fail-open to the DB path)."""
    vec = _vec(1.0, 2.0, 3.0)
    uid = uuid.uuid4()
    svc, repo, _, _ = _service(
        rows=[_row(uuid.uuid4(), vec)], probe=vec, redis=BrokenRedis(), user_id=uid
    )
    result = await svc.verify(uid, b"fake-image")
    assert result.verified is True
    assert result.confidence == pytest.approx(1.0)
    assert repo.find_calls == 1


async def test_cache_outage_does_not_break_enroll() -> None:
    """Extra: Redis errors never break enroll (invalidate failure is safe)."""
    vec = _vec(1.0, 0.0, 0.0)
    uid = uuid.uuid4()
    svc, _, _, _ = _service(
        rows=[_row(uuid.uuid4(), vec)], probe=vec, redis=BrokenRedis(), user_id=uid
    )
    result = await svc.enroll(uid, b"fake-image")
    assert result.embedding_id is not None
    assert result.quality_score == pytest.approx(0.9)


async def test_verify_without_cache_always_queries_db() -> None:
    """Extra: cache=None preserves the exact pre-Fase-8 behavior."""
    vec = _vec(1.0, 2.0, 3.0)
    uid = uuid.uuid4()
    repo = FakeEmbeddingRepo(rows=[_row(uuid.uuid4(), vec)])
    svc = BiometricService(
        adapter=FakeAdapter(vector=vec),
        user_repo=FakeUserRepo(existing_ids={uid}),
        embedding_repo=repo,
        audit_repo=FakeAuditRepo(),
        liveness_detector=FakeLiveness(),  # type: ignore[arg-type]
        settings=_settings(),
    )
    await svc.verify(uid, b"fake-image")
    await svc.verify(uid, b"fake-image")
    assert repo.find_calls == 2
