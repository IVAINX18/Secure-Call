"""Async repositories: the only DB access layer (Fase 3.4).

Service layer (Fase 6) consumes these; nothing else touches AsyncSession.
``DuplicateEmailError`` lives here (not in domain exceptions) because a
parallel agent owns ``app/domain/exceptions.py`` this wave.
"""

from __future__ import annotations

import uuid

import numpy as np
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.db.models import (
    BiometricAuditLog,
    User,
    UserFaceEmbedding,
    from_blob,
    to_blob,
)


class DuplicateEmailError(Exception):
    """Raised when creating a user whose email already exists."""


def load_embedding(row: UserFaceEmbedding) -> np.ndarray:
    """Deserialize a stored embedding row to a float32 vector."""
    return from_blob(row.embedding)


class UserRepository:
    """Persistence for the users table."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        email: str,
        password_hash: str,
        user_id: uuid.UUID | None = None,
    ) -> User:
        """Insert a user; raise DuplicateEmailError on email conflict.

        ``user_id`` pins the row id (used by auto-provisioning so later
        embedding rows satisfy the users FK); when None the DB default
        (random uuid4) applies as before.
        """
        user = User(
            id=user_id if user_id is not None else uuid.uuid4(),
            email=email,
            password_hash=password_hash,
        )
        self._session.add(user)
        try:
            await self._session.flush()
        except IntegrityError as exc:
            await self._session.rollback()
            raise DuplicateEmailError(f"Email already exists: {email}") from exc
        return user

    async def find_by_email(self, email: str) -> User | None:
        """Return the user with this email, or None."""
        result = await self._session.execute(select(User).where(User.email == email))
        return result.scalars().first()

    async def find_by_id(self, user_id: uuid.UUID) -> User | None:
        """Return the user with this id, or None."""
        return await self._session.get(User, user_id)


class EmbeddingRepository:
    """Persistence for the user_face_embeddings table."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save(
        self,
        user_id: uuid.UUID,
        embedding: np.ndarray,
        quality_score: float,
        model_version: str,
    ) -> UserFaceEmbedding:
        """Serialize and store one embedding row for a user."""
        row = UserFaceEmbedding(
            user_id=user_id,
            embedding=to_blob(embedding),
            quality_score=quality_score,
            model_version=model_version,
        )
        self._session.add(row)
        await self._session.flush()
        return row

    async def find_by_user(self, user_id: uuid.UUID) -> list[UserFaceEmbedding]:
        """Return active embeddings for a user (is_active only)."""
        result = await self._session.execute(
            select(UserFaceEmbedding).where(
                UserFaceEmbedding.user_id == user_id,
                UserFaceEmbedding.is_active.is_(True),
            )
        )
        return list(result.scalars().all())

    async def deactivate(self, embedding_id: uuid.UUID) -> None:
        """Soft-delete an embedding row (set is_active False)."""
        row = await self._session.get(UserFaceEmbedding, embedding_id)
        if row is not None:
            row.is_active = False
            await self._session.flush()


class AuditLogRepository:
    """Persistence for the biometric_audit_log table."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def log(
        self,
        user_id: uuid.UUID | None,
        action: str,
        success: bool,
        confidence_score: float | None = None,
        details: dict | None = None,
    ) -> BiometricAuditLog:
        """Append one audit entry and return it."""
        entry = BiometricAuditLog(
            user_id=user_id,
            action=action,
            success=success,
            confidence_score=confidence_score,
            details=details,
        )
        self._session.add(entry)
        await self._session.flush()
        return entry

    async def find_by_user(
        self, user_id: uuid.UUID, limit: int = 50
    ) -> list[BiometricAuditLog]:
        """Return the most recent audit entries for a user (newest first)."""
        result = await self._session.execute(
            select(BiometricAuditLog)
            .where(BiometricAuditLog.user_id == user_id)
            .order_by(BiometricAuditLog.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())
