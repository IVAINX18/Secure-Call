"""Shared FastAPI dependencies: DB session, Redis client, current user."""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenError, decode_jwt
from app.domain.services import BiometricService
from app.infrastructure.adapters.factory import get_biometric_adapter
from app.infrastructure.cache.client import create_redis_client
from app.infrastructure.cache.redis_cache import RedisCache
from app.infrastructure.db.repository import (
    AuditLogRepository,
    EmbeddingRepository,
    UserRepository,
)
from app.infrastructure.db.session import get_async_session
from app.infrastructure.liveness.mediapipe_detector import MediaPipeLivenessDetector

_bearer_scheme = HTTPBearer(auto_error=True)

_liveness_detector: MediaPipeLivenessDetector | None = None


def get_liveness_detector() -> MediaPipeLivenessDetector:
    """Return the process-wide cached MediaPipeLivenessDetector singleton.

    The detector lazy-loads its model bundle (first init costs ~60s of
    TF-Lite delegate build), so one instance is shared per process.
    """
    global _liveness_detector
    if _liveness_detector is None:
        _liveness_detector = MediaPipeLivenessDetector()
    return _liveness_detector


async def get_db_session() -> AsyncSession:
    """Yield a request-scoped async DB session.

    Unit of work: commit when the request succeeds, roll back when it
    raises — with one exception. Controlled business outcomes surface as
    ``HTTPException`` (endpoints translate domain rejections into 4xx),
    and the service writes its failure audit BEFORE raising, so those
    rows must survive: commit, not rollback. Unexpected (non-HTTP)
    errors still roll back. Without any commit here, flush-only
    repository writes would stay invisible to later requests and vanish
    on session close.
    """
    async for session in get_async_session():
        try:
            yield session
        except HTTPException:
            try:
                await session.commit()
            except Exception:  # noqa: BLE001 - commit fallback must roll back on any failure
                await session.rollback()
            raise
        except Exception:
            await session.rollback()
            raise
        else:
            await session.commit()


async def get_redis() -> object:
    """Return the shared Redis client.

    Async so it executes in the request event loop: the client factory
    detects loop changes (pooled connections are loop-bound).
    """
    return create_redis_client()


def get_user_repository(
    session: AsyncSession = Depends(get_db_session),  # noqa: B008 - FastAPI idiom
) -> UserRepository:
    """Build a UserRepository bound to the request DB session."""
    return UserRepository(session)


def get_embedding_repository(
    session: AsyncSession = Depends(get_db_session),  # noqa: B008 - FastAPI idiom
) -> EmbeddingRepository:
    """Build an EmbeddingRepository bound to the request DB session."""
    return EmbeddingRepository(session)


def get_audit_log_repository(
    session: AsyncSession = Depends(get_db_session),  # noqa: B008 - FastAPI idiom
) -> AuditLogRepository:
    """Build an AuditLogRepository bound to the request DB session."""
    return AuditLogRepository(session)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),  # noqa: B008 - FastAPI idiom
) -> str:
    """Extract the user id (sub claim) from a Bearer JWT; 401 if invalid."""
    try:
        claims = decode_jwt(credentials.credentials)
    except TokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc
    subject = claims.get("sub")
    if not subject:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    return str(subject)


async def get_cache(
    redis_client: object = Depends(get_redis),
) -> RedisCache:
    """Build a RedisCache on the request-loop Redis client.

    Built per request (never cached across event loops): the underlying
    client is loop-bound and recreated by ``create_redis_client`` when
    the loop changes.
    """
    return RedisCache(redis_client)


async def get_biometric_service(
    user_repo: UserRepository = Depends(get_user_repository),  # noqa: B008
    embedding_repo: EmbeddingRepository = Depends(get_embedding_repository),  # noqa: B008
    audit_repo: AuditLogRepository = Depends(get_audit_log_repository),  # noqa: B008
    cache: RedisCache = Depends(get_cache),  # noqa: B008 - FastAPI idiom
) -> BiometricService:
    """Build a BiometricService wired to the adapter, repos, detector, cache."""
    from app.config import get_settings

    return BiometricService(
        adapter=get_biometric_adapter(),
        user_repo=user_repo,
        embedding_repo=embedding_repo,
        audit_repo=audit_repo,
        liveness_detector=get_liveness_detector(),
        settings=get_settings(),
        cache=cache,
    )
