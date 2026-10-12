"""Health endpoint tests (T2.1-T2.3): real services + failure paths."""

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.dependencies import get_db_session, get_redis
from app.main import app


@pytest_asyncio.fixture
async def client():
    """Async HTTP client bound to the FastAPI app."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


async def test_health_endpoint_returns_200(client: AsyncClient) -> None:
    """T2.1: healthy DB + Redis (real local services) return 200 + ok flags."""
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["db"] == "ok"
    assert body["redis"] == "ok"
    assert body["version"] == "1.0.0"


async def test_health_checks_db_connectivity(client: AsyncClient) -> None:
    """T2.2: broken DB URL degrades the endpoint to 503 with db error detail."""
    broken_engine = create_async_engine(
        "postgresql+asyncpg://biometric:biometric@localhost:1/biometric",
        pool_pre_ping=True,
    )
    broken_factory = async_sessionmaker(broken_engine, expire_on_commit=False)

    async def broken_db_session():  # type: ignore[no-untyped-def]
        async with broken_factory() as session:
            yield session

    app.dependency_overrides[get_db_session] = broken_db_session
    try:
        response = await client.get("/api/v1/health")
    finally:
        await broken_engine.dispose()
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["db"] == "error"
    assert "db_error" in body
    assert body["redis"] == "ok"


async def test_health_checks_redis_connectivity(client: AsyncClient) -> None:
    """T2.3: unreachable Redis degrades the endpoint to 503 with detail."""

    class _BrokenRedis:
        """Stub whose PING always fails, mimicking a down Redis."""

        async def ping(self) -> None:
            raise ConnectionError("redis down")

    app.dependency_overrides[get_redis] = lambda: _BrokenRedis()
    response = await client.get("/api/v1/health")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["db"] == "ok"
    assert body["redis"] == "error"
    assert "redis_error" in body


async def test_create_and_decode_token_roundtrip() -> None:
    """Sanity: dev token creation + validation round-trips through security."""
    from app.core.security import TokenError, create_access_token, decode_jwt

    token = create_access_token("user-123")
    claims = decode_jwt(token)
    assert claims["sub"] == "user-123"

    with pytest.raises(TokenError):
        decode_jwt("not-a-token")
