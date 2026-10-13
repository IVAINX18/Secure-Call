"""Endpoint domain-error mapping (Fase 11 gaps).

Pin the except-handler branches that honest (greenlet-mode) coverage showed
as genuinely untested: ``verify.py`` 44-53 (service-level NoFaceDetected /
InvalidImageFormat) and ``verify_liveness.py`` 50 (empty-frame guard).

Style follows the T7.7 rate-limit test: real app + real JWT + stubbed
service over ASGITransport, so each case runs in milliseconds with no DB.
"""

from __future__ import annotations

import base64
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.security import create_access_token
from app.dependencies import get_biometric_service
from app.domain.exceptions import (
    InsufficientFrames,
    InvalidImageFormat,
    NoFaceDetected,
)
from app.main import app


def _auth() -> dict:
    """Bearer headers for a fresh random subject."""
    return {"Authorization": f"Bearer {create_access_token(str(uuid.uuid4()))}"}


def _b64(raw: bytes) -> str:
    """Base64-encode raw bytes for a JSON payload."""
    return base64.b64encode(raw).decode()


class _RaisingService:
    """Minimal service stub raising a configured domain error per method."""

    def __init__(self, exc: Exception) -> None:
        self._exc = exc

    async def enroll(self, user_id, image):  # type: ignore[no-untyped-def]
        """Raise the configured error (enroll path)."""
        raise self._exc

    async def verify(self, user_id, image):  # type: ignore[no-untyped-def]
        """Raise the configured error (verify path)."""
        raise self._exc

    async def verify_liveness(self, user_id, frames):  # type: ignore[no-untyped-def]
        """Raise the configured error (liveness path)."""
        raise self._exc


@pytest.fixture
def stubbed_api():
    """App client with the biometric service replaced by a per-test stub."""
    holder: dict = {}

    def _install(exc: Exception) -> AsyncClient:
        holder["client"] = AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        )
        app.dependency_overrides[get_biometric_service] = lambda: _RaisingService(exc)
        return holder["client"]

    yield _install
    app.dependency_overrides.clear()


async def test_verify_maps_no_face_to_400(stubbed_api) -> None:
    """Service-level NoFaceDetected on /verify maps to 400 with its detail."""
    async with stubbed_api(NoFaceDetected(details={"faces": 0})) as client:
        response = await client.post(
            "/api/v1/verify", json={"image_base64": _b64(b"decodable")}, headers=_auth()
        )
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "No face detected in the image."


async def test_verify_maps_invalid_image_to_400(stubbed_api) -> None:
    """Service-level InvalidImageFormat on /verify maps to 400 with detail."""
    async with stubbed_api(InvalidImageFormat()) as client:
        response = await client.post(
            "/api/v1/verify", json={"image_base64": _b64(b"decodable")}, headers=_auth()
        )
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Invalid image format: bytes could not be decoded."


async def test_liveness_rejects_empty_frame(stubbed_api) -> None:
    """An empty frame in the batch maps to 400 before the service runs."""
    exc = InsufficientFrames(details={"frames": 0, "min_frames": 6})
    async with stubbed_api(exc) as client:
        response = await client.post(
            "/api/v1/verify-liveness",
            json={"video_frames_base64": [_b64(b"frame"), _b64(b"")]},
            headers=_auth(),
        )
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "video_frames_base64 contains an empty frame."


async def test_liveness_maps_no_face_to_400(stubbed_api) -> None:
    """Service-level NoFaceDetected on /verify-liveness maps to 400."""
    async with stubbed_api(NoFaceDetected(details={"faces": 0})) as client:
        response = await client.post(
            "/api/v1/verify-liveness",
            json={"video_frames_base64": [_b64(b"frame")]},
            headers=_auth(),
        )
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "No face detected in the image."
