"""CORS test (T2.4): frontend origin is allowed on the v1 API."""

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest_asyncio.fixture
async def client():
    """Async HTTP client bound to the FastAPI app."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def test_cors_allows_frontend_origin(client: AsyncClient) -> None:
    """T2.4: Origin http://localhost:5173 gets an allow-origin response header."""
    response = await client.get(
        "/api/v1/health", headers={"Origin": "http://localhost:5173"}
    )
    assert response.status_code == 200
    assert (
        response.headers.get("access-control-allow-origin") == "http://localhost:5173"
    )
