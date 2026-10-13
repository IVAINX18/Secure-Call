"""Liveness endpoint: blink + micro-movement check over video frames."""

import base64
import binascii

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.v1.enroll import _resolve_user_id
from app.core.logging import get_logger
from app.core.rate_limit import BIOMETRIC_RATE_LIMIT, limiter
from app.dependencies import get_biometric_service, get_current_user
from app.domain.exceptions import (
    InvalidImageFormat,
    LivenessCheckFailed,
    NoFaceDetected,
)
from app.domain.models import LivenessRequest, LivenessResponse
from app.domain.services import BiometricService

router = APIRouter()

logger = get_logger("biometric_engine.api.verify_liveness")


@router.post("/verify-liveness", response_model=LivenessResponse)
@limiter.limit(BIOMETRIC_RATE_LIMIT)
async def verify_liveness(
    request: Request,
    body: LivenessRequest,
    user_id: str = Depends(get_current_user),
    service: BiometricService = Depends(get_biometric_service),  # noqa: B008 - FastAPI idiom
) -> LivenessResponse:
    """Run liveness over the posted frames; gate failures map to 400.

    The Fase 5 detector raises ``InsufficientFrames`` directly and reports
    blink/movement misses inside ``LivenessResult`` (live=False, 200);
    ``NoBlinkDetected`` / siblings are mapped here defensively in case a
    future detector raises them instead of returning a negative result.
    """
    frames: list[bytes] = []
    for index, raw in enumerate(body.video_frames_base64):
        try:
            frames.append(base64.b64decode(raw, validate=True))
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"video_frames_base64[{index}] is not valid base64.",
            ) from exc
    if any(not frame for frame in frames):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="video_frames_base64 contains an empty frame.",
        )
    try:
        result = await service.verify_liveness(_resolve_user_id(user_id), frames)
    except LivenessCheckFailed as exc:
        # Covers InsufficientFrames, NoBlinkDetected, NoNaturalMovement:
        # the base gate for every liveness failure the service can raise.
        logger.info("liveness_rejected", error=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message
        ) from exc
    except (NoFaceDetected, InvalidImageFormat) as exc:
        logger.info("liveness_rejected", error=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message
        ) from exc
    return LivenessResponse(live=result.live, confidence=result.confidence)
