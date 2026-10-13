"""Health endpoint: DB + Redis connectivity checks."""

import asyncio

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db_session, get_redis

router = APIRouter()

SERVICE_VERSION = "1.0.0"
_CHECK_TIMEOUT_SECONDS = 2.0


async def _check_db(session: AsyncSession) -> tuple[str, str | None]:
    """Run SELECT 1 with a timeout; return (status, error)."""
    try:
        await asyncio.wait_for(
            session.execute(text("SELECT 1")), timeout=_CHECK_TIMEOUT_SECONDS
        )
        return "ok", None
    except Exception as exc:  # noqa: BLE001 - health check must report any failure
        return "error", f"{type(exc).__name__}: {exc}"


async def _check_redis(redis_client: object) -> tuple[str, str | None]:
    """Run PING with a timeout; return (status, error)."""
    try:
        await asyncio.wait_for(
            # Redis client is injected as object (loop-aware factory); ping exists at runtime.
            redis_client.ping(),  # type: ignore[attr-defined]
            timeout=_CHECK_TIMEOUT_SECONDS,
        )
        return "ok", None
    except Exception as exc:  # noqa: BLE001 - health check must report any failure
        return "error", f"{type(exc).__name__}: {exc}"


@router.get("/health")
async def health(
    session: AsyncSession = Depends(get_db_session),  # noqa: B008 - FastAPI idiom
    redis_client: object = Depends(get_redis),
) -> JSONResponse:
    """Return 200 healthy when DB and Redis are reachable, else 503 degraded."""
    db_status, db_error = await _check_db(session)
    redis_status, redis_error = await _check_redis(redis_client)
    healthy = db_status == "ok" and redis_status == "ok"
    body: dict = {
        "status": "healthy" if healthy else "degraded",
        "db": db_status,
        "redis": redis_status,
        "version": SERVICE_VERSION,
    }
    if db_error:
        body["db_error"] = db_error
    if redis_error:
        body["redis_error"] = redis_error
    return JSONResponse(status_code=200 if healthy else 503, content=body)
