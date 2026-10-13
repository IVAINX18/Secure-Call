"""Fase 11 unit coverage for genuinely sub-90 modules.

Each test targets lines the greenlet-mode coverage run proved untested
(rate_limit key fallbacks, dependencies 401/rollback/repository builders,
cache-client lifecycle, db-session lifecycle, main lifespan/middleware/
exception handler, value-object guards, exception defaults, adapter factory).
All seams use hand-rolled fakes; nothing touches the network or real models.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator

import numpy as np
import pytest
from fastapi import HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import user_or_ip_key
from app.core.security import create_access_token
from app.dependencies import (
    get_audit_log_repository,
    get_current_user,
    get_db_session,
    get_embedding_repository,
    get_user_repository,
)
from app.domain import exceptions as exc_mod
from app.domain.value_objects import Embedding, l2_normalize
from app.infrastructure.adapters import factory as factory_module
from app.infrastructure.cache import client as cache_client_module
from app.infrastructure.db import session as session_module
from app.infrastructure.db.repository import (
    AuditLogRepository,
    EmbeddingRepository,
    UserRepository,
)


def _request(headers: list | None = None) -> Request:
    """Build a bare Starlette request with a client address for IP keying."""
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/v1/enroll",
            "headers": headers or [],
            "query_string": b"",
            "server": ("test", 80),
            "scheme": "http",
            "client": ("127.0.0.1", 50000),
        }
    )


# -- rate_limit.user_or_ip_key -------------------------------------------


def test_rate_key_falls_back_to_ip_without_auth() -> None:
    """No Authorization header keys the bucket by client IP."""
    assert user_or_ip_key(_request()).startswith("ip:")


def test_rate_key_falls_back_to_ip_on_invalid_token() -> None:
    """An undecodable Bearer token still gets an IP bucket (no bypass)."""
    headers = [(b"authorization", b"Bearer not-a-jwt")]
    assert user_or_ip_key(_request(headers)).startswith("ip:")


def test_rate_key_falls_back_to_ip_on_empty_bearer() -> None:
    """A bare 'Bearer ' prefix carries no token, so IP keying applies."""
    headers = [(b"authorization", b"Bearer ")]
    assert user_or_ip_key(_request(headers)).startswith("ip:")


def test_rate_key_falls_back_to_ip_without_subject(monkeypatch: pytest.MonkeyPatch) -> None:
    """A valid token without a sub claim cannot key a user bucket."""
    monkeypatch.setattr(
        "app.core.rate_limit.decode_jwt", lambda token: {"exp": 9999999999}
    )
    headers = [(b"authorization", b"Bearer header.payload.sig")]
    assert user_or_ip_key(_request(headers)).startswith("ip:")


def test_rate_key_uses_subject_for_valid_token() -> None:
    """A normal JWT keys the bucket by its subject."""
    token = create_access_token("rate-user-11")
    headers = [(b"authorization", f"Bearer {token}".encode())]
    assert user_or_ip_key(_request(headers)) == "user:rate-user-11"


# -- dependencies.get_current_user ---------------------------------------


async def test_current_user_rejects_invalid_token() -> None:
    """An undecodable Bearer token becomes a 401, not a 500."""
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="bogus")
    with pytest.raises(HTTPException) as err:
        await get_current_user(credentials)
    assert err.value.status_code == 401


async def test_current_user_rejects_missing_subject(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A token without sub carries no identity, so it is a 401."""
    monkeypatch.setattr("app.dependencies.decode_jwt", lambda token: {})
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="x")
    with pytest.raises(HTTPException) as err:
        await get_current_user(credentials)
    assert err.value.status_code == 401


async def test_current_user_returns_subject() -> None:
    """A valid token yields its subject string for the uuid5 mapping."""
    token = create_access_token("fase11-user")
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    assert await get_current_user(credentials) == "fase11-user"


# -- dependencies repository builders ------------------------------------


def test_repository_builders_bind_session() -> None:
    """The Depends builders wrap the request session in the right repo type."""
    session = object()
    assert isinstance(get_user_repository(session), UserRepository)  # type: ignore[arg-type]
    assert isinstance(get_embedding_repository(session), EmbeddingRepository)  # type: ignore[arg-type]
    assert isinstance(get_audit_log_repository(session), AuditLogRepository)  # type: ignore[arg-type]


# -- dependencies.get_db_session ------------------------------------------


class _FakeSession:
    """Async session fake tracking commit/rollback with an optional fault."""

    def __init__(self, fail_commit: bool = False) -> None:
        self.commits = 0
        self.rollbacks = 0
        self._fail_commit = fail_commit

    async def commit(self) -> None:
        """Count the commit, or raise when the fault is armed."""
        self.commits += 1
        if self._fail_commit:
            raise RuntimeError("commit blown away")

    async def rollback(self) -> None:
        """Count the rollback."""
        self.rollbacks += 1


def _session_gen(fake: _FakeSession):  # type: ignore[no-untyped-def]
    """Replacement for get_async_session yielding one fake session."""

    async def _gen() -> AsyncGenerator[AsyncSession, None]:
        yield fake  # type: ignore[misc]

    return _gen


async def test_db_session_commits_controlled_400_outcome(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """HTTPException outcomes commit (failure audits must survive)."""
    fake = _FakeSession()
    monkeypatch.setattr(
        "app.dependencies.get_async_session", _session_gen(fake)
    )
    gen = get_db_session()
    assert await gen.__anext__() is fake
    with pytest.raises(HTTPException):
        await gen.athrow(HTTPException(status_code=400, detail="mapped"))
    assert fake.commits == 1
    assert fake.rollbacks == 0


async def test_db_session_rolls_back_when_commit_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failing commit on the 400 path falls back to rollback, then raises."""
    fake = _FakeSession(fail_commit=True)
    monkeypatch.setattr(
        "app.dependencies.get_async_session", _session_gen(fake)
    )
    gen = get_db_session()
    assert await gen.__anext__() is fake
    with pytest.raises(HTTPException):
        await gen.athrow(HTTPException(status_code=400, detail="mapped"))
    assert fake.commits == 1
    assert fake.rollbacks == 1


async def test_db_session_rolls_back_unexpected_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Non-HTTP errors roll back without committing."""
    fake = _FakeSession()
    monkeypatch.setattr(
        "app.dependencies.get_async_session", _session_gen(fake)
    )
    gen = get_db_session()
    assert await gen.__anext__() is fake
    with pytest.raises(RuntimeError, match="boom"):
        await gen.athrow(RuntimeError("boom"))
    assert fake.commits == 0
    assert fake.rollbacks == 1


# -- cache client lifecycle -----------------------------------------------


class _FakeRedisClient:
    """Redis client stand-in recording close calls."""

    def __init__(self) -> None:
        self.aclosed = 0

    async def aclose(self) -> None:
        """Count the close."""
        self.aclosed += 1


def test_redis_client_created_without_running_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sync-context creation records no loop and builds via from_url."""
    created: list = []
    monkeypatch.setattr(cache_client_module, "_redis_client", None)
    monkeypatch.setattr(cache_client_module, "_redis_loop", None)
    monkeypatch.setattr(
        "redis.asyncio.from_url", lambda url, decode_responses: created.append(url) or _FakeRedisClient()
    )
    client = cache_client_module.create_redis_client("redis://localhost:1/0")
    assert isinstance(client, _FakeRedisClient)
    assert created == ["redis://localhost:1/0"]
    assert cache_client_module._redis_loop is None


async def test_redis_client_close_lifecycle(monkeypatch: pytest.MonkeyPatch) -> None:
    """Close shuts the client and forgets it; a second close is a no-op."""
    fake = _FakeRedisClient()
    monkeypatch.setattr(cache_client_module, "_redis_client", fake)
    monkeypatch.setattr(cache_client_module, "_redis_loop", None)
    await cache_client_module.close_redis_client()
    assert fake.aclosed == 1
    assert cache_client_module._redis_client is None
    await cache_client_module.close_redis_client()
    assert fake.aclosed == 1


async def test_redis_client_recreated_on_loop_change(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A stale loop-bound client is rebuilt for the current loop."""
    calls: list = []
    monkeypatch.setattr(cache_client_module, "_redis_client", _FakeRedisClient())
    monkeypatch.setattr(cache_client_module, "_redis_loop", object())
    monkeypatch.setattr(
        "redis.asyncio.from_url", lambda url, decode_responses: calls.append(url) or _FakeRedisClient()
    )
    monkeypatch.setattr(
        cache_client_module, "get_settings", lambda: _FakeSettings()
    )
    client = cache_client_module.create_redis_client()
    assert isinstance(client, _FakeRedisClient)
    assert len(calls) == 1


class _FakeSettings:
    """Settings stub exposing only the Redis URL."""

    REDIS_URL = "redis://localhost:1/0"


# -- db session lifecycle --------------------------------------------------


def test_running_loop_returns_none_outside_loop() -> None:
    """Outside a running loop there is no loop to bind the engine to."""
    assert session_module._running_loop() is None


async def test_running_loop_returns_current_loop_inside() -> None:
    """Inside a coroutine the running loop is reported for binding."""
    import asyncio

    assert session_module._running_loop() is asyncio.get_running_loop()


class _FakeEngine:
    """Engine stand-in recording dispose calls."""

    def __init__(self) -> None:
        self.disposed = 0

    async def dispose(self) -> None:
        """Count the dispose."""
        self.disposed += 1


async def test_dispose_engine_lifecycle(monkeypatch: pytest.MonkeyPatch) -> None:
    """Dispose tears the engine down and forgets it; empty dispose is safe."""
    fake = _FakeEngine()
    monkeypatch.setattr(session_module, "_engine", fake)
    monkeypatch.setattr(session_module, "_session_factory", object())
    monkeypatch.setattr(session_module, "_engine_loop", object())
    await session_module.dispose_engine()
    assert fake.disposed == 1
    assert session_module._engine is None
    assert session_module._session_factory is None
    assert session_module._engine_loop is None
    await session_module.dispose_engine()


# -- main: lifespan / middleware / exception handler ------------------------


async def test_lifespan_initializes_and_disposes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Startup builds engine+redis; shutdown disposes both in order."""
    import app.main as main_module

    calls: list = []
    monkeypatch.setattr(
        main_module, "get_engine", lambda: calls.append("engine") or object()
    )
    monkeypatch.setattr(
        main_module, "create_redis_client", lambda: calls.append("redis") or object()
    )

    async def _close() -> None:
        calls.append("close_redis")

    async def _dispose() -> None:
        calls.append("dispose_engine")

    monkeypatch.setattr(main_module, "close_redis_client", _close)
    monkeypatch.setattr(main_module, "dispose_engine", _dispose)
    async with main_module.lifespan(main_module.app):
        assert calls == ["engine", "redis"]
    assert calls == ["engine", "redis", "close_redis", "dispose_engine"]


async def test_middleware_reraises_downstream_errors() -> None:
    """Middleware logs and re-raises when the downstream app explodes."""
    from app.main import RequestContextMiddleware

    async def _boom(request: Request, call_next=None):  # type: ignore[no-untyped-def]
        raise RuntimeError("downstream gone")

    middleware = RequestContextMiddleware(app=_boom)  # type: ignore[arg-type]
    with pytest.raises(RuntimeError, match="downstream gone"):
        await middleware.dispatch(_request(), _boom)


async def test_unhandled_exception_handler_returns_500() -> None:
    """Last-resort handler maps any exception to a generic 500 JSON."""
    from app.main import create_app

    handler = create_app().exception_handlers[Exception]
    response = await handler(_request(), RuntimeError("x"))
    assert response.status_code == 500
    assert response.body == b'{"detail":"Internal server error"}'


# -- value objects / exceptions ---------------------------------------------


def test_l2_normalize_zero_vector_returns_unchanged() -> None:
    """Zero vectors come back as float32 instead of dividing by zero."""
    out = l2_normalize(np.zeros(4))
    assert out.dtype == np.float32
    assert np.array_equal(out, np.zeros(4, dtype=np.float32))


def test_embedding_rejects_non_1d_vector() -> None:
    """Only flat vectors are valid embeddings."""
    with pytest.raises(ValueError, match="1-dimensional"):
        Embedding(vector=np.zeros((2, 2)), model_name="m")


def test_embedding_rejects_shape_mismatch() -> None:
    """Similarity needs identical shapes on both sides."""
    left = Embedding(vector=np.ones(3, dtype=np.float32))
    right = Embedding(vector=np.ones(4, dtype=np.float32))
    with pytest.raises(ValueError, match="different shapes"):
        left.cosine_similarity(right)


def test_embedding_rejects_zero_vector_similarity() -> None:
    """Similarity against a zero vector is undefined, not NaN."""
    left = Embedding(vector=np.ones(3, dtype=np.float32))
    right = Embedding(vector=np.zeros(3, dtype=np.float32))
    with pytest.raises(ValueError, match="zero embedding"):
        left.cosine_similarity(right)


def test_liveness_exceptions_carry_defaults() -> None:
    """Gate exceptions used by the service layer have stable defaults."""
    assert "blink" in exc_mod.NoBlinkDetected().message
    assert exc_mod.NoBlinkDetected().details == {}
    assert "movement" in exc_mod.NoNaturalMovement().message
    assert exc_mod.NoNaturalMovement().details == {}


def test_factory_creates_singleton_once(monkeypatch: pytest.MonkeyPatch) -> None:
    """Resetting the cached adapter rebuilds it exactly once."""

    class _StubAdapter:
        pass

    monkeypatch.setattr(factory_module, "InsightFaceAdapter", _StubAdapter)
    monkeypatch.setattr(factory_module, "_adapter", None)
    first = factory_module.get_biometric_adapter()
    second = factory_module.get_biometric_adapter()
    assert isinstance(first, _StubAdapter)
    assert first is second


def test_resolve_user_id_deterministic_for_non_uuid() -> None:
    """Non-UUID subjects map stably via uuid5; UUIDs pass through."""
    from app.api.v1.enroll import _resolve_user_id

    subject = f"fase11-{uuid.uuid4().hex[:8]}"
    assert _resolve_user_id(subject) == _resolve_user_id(subject)
    raw = str(uuid.uuid4())
    assert _resolve_user_id(raw) == uuid.UUID(raw)
