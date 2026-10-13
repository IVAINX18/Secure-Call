"""Enroll endpoint: store one face embedding for the calling user."""

import base64
import binascii
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.logging import get_logger
from app.core.rate_limit import BIOMETRIC_RATE_LIMIT, limiter
from app.dependencies import get_biometric_service, get_current_user
from app.domain.exceptions import (
    InvalidImageFormat,
    LowQualityFace,
    MultipleFacesDetected,
    NoFaceDetected,
)
from app.domain.models import EnrollRequest, EnrollResponse
from app.domain.services import BiometricService

router = APIRouter()

logger = get_logger("biometric_engine.api.enroll")


def _resolve_user_id(subject: str) -> uuid.UUID:
    """Map the JWT subject to the internal users-table UUID.

    UUID subjects are used directly; any other external subject maps
    deterministically via uuid5 so non-UUID callers (dev/mock auth)
    still land on a stable FK-safe row.
    """
    try:
        return uuid.UUID(subject)
    except ValueError:
        return uuid.uuid5(uuid.NAMESPACE_URL, f"secure-call:{subject}")


@router.post("/enroll", response_model=EnrollResponse)
@limiter.limit(BIOMETRIC_RATE_LIMIT)
async def enroll_face(
    request: Request,
    body: EnrollRequest,
    user_id: str = Depends(get_current_user),
    service: BiometricService = Depends(get_biometric_service),  # noqa: B008 - FastAPI idiom
) -> EnrollResponse:
    """Enroll one face embedding for the JWT subject; 400 on bad input."""
    try:
        image_bytes = base64.b64decode(body.image_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="image_base64 is not valid base64.",
        ) from exc
    if not image_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="image_base64 decodes to empty bytes.",
        )
    try:
        result = await service.enroll(_resolve_user_id(user_id), image_bytes)
    except (NoFaceDetected, LowQualityFace, MultipleFacesDetected) as exc:
        logger.info("enroll_rejected", error=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message
        ) from exc
    except InvalidImageFormat as exc:
        logger.info("enroll_rejected", error=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message
        ) from exc
    return EnrollResponse(
        embedding_id=result.embedding_id, quality_score=result.quality_score
    )
