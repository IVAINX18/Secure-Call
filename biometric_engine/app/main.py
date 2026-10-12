"""FastAPI application entrypoint for the biometric engine."""

import time
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_client import make_asgi_app
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.v1.router import router as v1_router
from app.config import get_settings
from app.core.logging import (
    bind_request_id,
    configure_logging,
    get_logger,
    unbind_request_id,
)
from app.core.metrics import REQUEST_DURATION_SECONDS, REQUESTS_TOTAL
from app.infrastructure.cache.client import close_redis_client, create_redis_client
from app.infrastructure.db.session import dispose_engine, get_engine

settings = get_settings()
configure_logging(settings.LOG_LEVEL)
logger = get_logger("biometric_engine.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Initialize shared DB engine + Redis on startup; dispose on shutdown."""
    get_engine()
    create_redis_client()
    logger.info("startup_complete", phase="startup")
    yield
    await close_redis_client()
    await dispose_engine()
    logger.info("shutdown_complete", phase="shutdown")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Bind request_id, log JSON access lines, and record metrics."""

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        request_id = uuid.uuid4().hex[:12]
        bind_request_id(request_id)
        request.state.request_id = request_id
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (time.perf_counter() - start) * 1000
            logger.exception("unhandled_request_error", duration_ms=round(duration_ms, 2))
            raise
        duration_ms = (time.perf_counter() - start) * 1000
        route = request.scope.get("route")
        path = route.path if route is not None else request.url.path
        REQUESTS_TOTAL.labels(
            method=request.method, path=path, status=response.status_code
        ).inc()
        REQUEST_DURATION_SECONDS.labels(method=request.method, path=path).observe(
            duration_ms / 1000
        )
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "request_completed",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=round(duration_ms, 2),
        )
        unbind_request_id()
        return response


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    app = FastAPI(
        title="Biometric Engine API",
        version="1.0.0",
        description="Facial biometric enrollment and verification service",
        lifespan=lifespan,
    )
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        logger.exception("unhandled_exception", path=request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    app.include_router(v1_router)
    app.mount("/metrics", make_asgi_app())
    return app


app = create_app()
