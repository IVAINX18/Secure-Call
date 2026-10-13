"""API v1 router: mounts all v1 endpoint routers."""

from fastapi import APIRouter

from app.api.v1.enroll import router as enroll_router
from app.api.v1.health import router as health_router
from app.api.v1.verify import router as verify_router
from app.api.v1.verify_liveness import router as verify_liveness_router

router = APIRouter(prefix="/api/v1")
router.include_router(health_router)
router.include_router(enroll_router)
router.include_router(verify_router)
router.include_router(verify_liveness_router)
