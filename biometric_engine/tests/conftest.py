"""Shared pytest fixtures for the biometric engine.

Fase 1 placeholder: concrete fixtures (db session, redis client,
sample images) arrive with later phases.
"""

import os
import uuid
from collections.abc import AsyncGenerator
from urllib.parse import urlparse, urlunparse

import asyncpg
import pytest
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.infrastructure.db.models import (
    Base,
    BiometricAuditLog,
    User,
    UserFaceEmbedding,
)


@pytest.fixture
def sample_user_id():
    """Placeholder fixture returning a fixed user id for future tests."""
    return "00000000-0000-0000-0000-000000000000"


def _test_database_url() -> str:
    """Derive the test DB URL (TEST_DATABASE_URL wins, else swap db name)."""
    override = os.environ.get("TEST_DATABASE_URL")
    if override:
        return override
    from app.config import get_settings

    parts = urlparse(get_settings().DATABASE_URL)
    return urlunparse(parts._replace(path="/biometric_test"))


def _plain_dsn(sqlalchemy_url: str, db_name: str) -> str:
    """Convert a SQLAlchemy URL to a plain asyncpg DSN for the given db."""
    parts = urlparse(sqlalchemy_url)
    return urlunparse(("postgresql", parts.netloc, f"/{db_name}", "", "", ""))


async def _ensure_test_database_exists(url: str) -> None:
    """Create the biometric_test database if missing (via the postgres db)."""
    target = urlparse(url).path.lstrip("/")
    admin_dsn = _plain_dsn(url, "postgres")
    conn = await asyncpg.connect(admin_dsn)
    try:
        exists = await conn.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1", target
        )
        if not exists:
            await conn.execute(f'CREATE DATABASE "{target}"')
    finally:
        await conn.close()


@pytest.fixture(scope="function")
async def test_engine():
    """Function-scoped async engine on biometric_test with tables created.

    Function scope (not session) because pooled asyncpg connections are
    loop-bound and pytest-asyncio runs each test in a fresh event loop;
    a session-scoped engine would serve stale-loop connections.
    """
    url = _test_database_url()
    await _ensure_test_database_exists(url)
    engine = create_async_engine(url, pool_pre_ping=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest.fixture
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Function-scoped session; truncate the three tables after each test."""
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as session:
        yield session
        for model in (BiometricAuditLog, UserFaceEmbedding, User):
            await session.execute(model.__table__.delete())
        await session.commit()


@pytest.fixture
def unique_email():
    """Factory fixture returning a fresh unique email per call."""
    return f"user-{uuid.uuid4().hex[:12]}@example.com"
