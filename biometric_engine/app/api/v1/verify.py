"""Verify endpoint: match one face against the calling user's embeddings."""

import base64
import binascii

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.v1.enroll import _resolve_user_id
from app.core.logging import get_logger
from app.core.rate_limit import BIOMETRIC_RATE_LIMIT, limiter
from app.dependencies import get_biometric_service, get_current_user
from app.domain.exceptions import InvalidImageFormat, NoFaceDetected
from app.domain.models import VerifyRequest, VerifyResponse
from app.domain.services import BiometricService

router = APIRouter()

logger = get_logger("biometric_engine.api.verify")


@router.post("/verify", response_model=VerifyResponse)
@limiter.limit(BIOMETRIC_RATE_LIMIT)
async def verify_face(
    request: Request,
    body: VerifyRequest,
    user_id: str = Depends(get_current_user),
    service: BiometricService = Depends(get_biometric_service),  # noqa: B008 - FastAPI idiom
) -> VerifyResponse:
    """Verify one face; unknown users return verified=False (200), not 404."""
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
        result = await service.verify(_resolve_user_id(user_id), image_bytes)
    except NoFaceDetected as exc:
        logger.info("verify_rejected", error=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message
        ) from exc
    except InvalidImageFormat as exc:
        logger.info("verify_rejected", error=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message
        ) from exc
    return VerifyResponse(
        verified=result.verified,
        confidence=result.confidence,
        embedding_id=result.embedding_id,
    )
