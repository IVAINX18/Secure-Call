"""Async SQLAlchemy engine + session factory (generic, reused by Fase 3).

Absorbs plan task F3.1: Fase 2 needs a live DB session for the health
endpoint and the ``get_db_session`` dependency.
"""

import asyncio
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None
_engine_loop: asyncio.AbstractEventLoop | None = None

_PLAIN_POSTGRES_SCHEME = "postgresql://"
_ASYNCPG_SCHEME = "postgresql+asyncpg://"


def normalize_database_url(url: str) -> str:
    """Rewrite a driver-less postgres URL to the asyncpg dialect.

    Render Blueprints inject DATABASE_URL as a plain ``postgresql://``
    connectionString, but ``create_async_engine`` needs an async driver.
    URLs that already name a driver (``postgresql+asyncpg://``,
    ``sqlite+aiosqlite://``, ...) pass through untouched, so local, CI,
    and test configs never change meaning.
    """
    if url.startswith(_PLAIN_POSTGRES_SCHEME):
        return _ASYNCPG_SCHEME + url[len(_PLAIN_POSTGRES_SCHEME):]
    return url


def _running_loop() -> asyncio.AbstractEventLoop | None:
    """Return the running loop, or None when called outside one."""
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


def get_engine() -> AsyncEngine:
    """Return the shared async engine, creating it lazily on first use.

    The engine is recreated when the running event loop changed since
    creation (pooled asyncpg connections are loop-bound).
    """
    global _engine, _session_factory, _engine_loop
    running = _running_loop()
    if _engine is None or (
        running is not None and _engine_loop is not None and _engine_loop is not running
    ):
        _engine = create_async_engine(
            normalize_database_url(get_settings().DATABASE_URL), pool_pre_ping=True
        )
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False)
        _engine_loop = running
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return the shared async session factory."""
    get_engine()
    assert _session_factory is not None
    return _session_factory


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield one async session per call (FastAPI dependency)."""
    async with get_session_factory()() as session:
        yield session


async def dispose_engine() -> None:
    """Dispose the shared engine (called on app shutdown)."""
    global _engine, _session_factory, _engine_loop
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
        _engine_loop = None
