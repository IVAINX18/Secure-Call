"""SQLAlchemy ORM models for the biometric engine (Fase 3.2).

Portability rule: embeddings are stored as float32 bytes in a LargeBinary
column (helpers ``to_blob`` / ``from_blob``). Never use postgresql.ARRAY.
The audit column for request details is named ``details`` because
``metadata`` is reserved by SQLAlchemy declarative.
"""

from __future__ import annotations

import uuid
from datetime import datetime

import numpy as np
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, LargeBinary, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.sqlite import JSON as SQLiteJSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import JSON, Uuid


class Base(DeclarativeBase):
    """Declarative base for all biometric engine ORM models."""


def to_blob(embedding: np.ndarray) -> bytes:
    """Serialize a float32 embedding vector to portable bytes."""
    return np.ascontiguousarray(embedding, dtype=np.float32).tobytes()


def from_blob(blob: bytes) -> np.ndarray:
    """Deserialize portable bytes back to a float32 embedding vector."""
    return np.frombuffer(blob, dtype=np.float32).copy()


class User(Base):
    """Application user (auth is local/mock; this mirrors the login identity)."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UserFaceEmbedding(Base):
    """Stored face embedding for a user (bytes, never a raw image)."""

    __tablename__ = "user_face_embeddings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), index=True
    )
    embedding: Mapped[bytes] = mapped_column(LargeBinary)
    quality_score: Mapped[float] = mapped_column(Float)
    model_version: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)


class BiometricAuditLog(Base):
    """Audit trail for biometric actions (enroll / verify / liveness)."""

    __tablename__ = "biometric_audit_log"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(50))
    success: Mapped[bool] = mapped_column(Boolean)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Portable JSON: JSONB on postgres, generic JSON elsewhere (tests use PG anyway).
    details: Mapped[dict | None] = mapped_column(
        JSON().with_variant(JSONB, "postgresql").with_variant(SQLiteJSON, "sqlite"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
