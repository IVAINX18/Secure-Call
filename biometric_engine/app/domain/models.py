"""Pydantic API schemas for the biometric engine (Fase 6.2).

Transport-only: the API layer (Fase 7) decodes base64 payloads and calls
``BiometricService`` with raw bytes; these schemas never hold business logic.
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class EnrollRequest(BaseModel):
    """Enroll payload: one base64-encoded face image for the caller user."""

    image_base64: str = Field(description="Base64-encoded JPEG/PNG face image.")


class EnrollResponse(BaseModel):
    """Enroll result: stored embedding id plus its quality score."""

    embedding_id: uuid.UUID = Field(description="ID of the stored embedding row.")
    quality_score: float = Field(description="Overall quality score (0.0-1.0).")


class VerifyRequest(BaseModel):
    """Verify payload: one base64-encoded face image to match."""

    image_base64: str = Field(description="Base64-encoded JPEG/PNG face image.")


class VerifyResponse(BaseModel):
    """Verify result: match decision, best cosine similarity, matched row."""

    verified: bool = Field(description="True when similarity clears the threshold.")
    confidence: float = Field(description="Best cosine similarity (0.0 when none).")
    embedding_id: uuid.UUID | None = Field(
        default=None, description="Matched embedding row id, if any rows exist."
    )


class LivenessRequest(BaseModel):
    """Liveness payload: base64-encoded video frames (at least MIN_FRAMES)."""

    video_frames_base64: list[str] = Field(
        description="Base64-encoded frames of a short face video."
    )


class LivenessResponse(BaseModel):
    """Liveness result: live decision plus detector confidence."""

    live: bool = Field(description="True when blink and movement both observed.")
    confidence: float = Field(description="Combined liveness confidence (0.0-1.0).")
