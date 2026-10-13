"""Integration tests for Fase 7 endpoints (T7.1-T7.7).

Full HTTP flow per test: JWT -> endpoint -> real BiometricService
(real InsightFace adapter + real repos on the function-scoped
``biometric_test`` session) via dependency_overrides. Enroll/verify
never touch MediaPipe; the liveness detector is stubbed at the service
seam (T7.6) so the ~60s model init stays out of this module.
"""

from __future__ import annotations

import base64
import uuid
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import get_settings
from app.core.security import create_access_token
from app.dependencies import get_biometric_service
from app.domain.exceptions import InsufficientFrames
from app.domain.services import BiometricService, EnrollResult
from app.domain.value_objects import LivenessResult
from app.infrastructure.adapters.factory import get_biometric_adapter
from app.infrastructure.db.repository import (
    AuditLogRepository,
    EmbeddingRepository,
    UserRepository,
)
from app.infrastructure.liveness.mediapipe_detector import (
    MIN_FRAMES,
    MediaPipeLivenessDetector,
)
from app.main import app

IMAGES_DIR = Path(__file__).parent.parent / "fixtures" / "images"


def _b64(name: str) -> str:
    return base64.b64encode((IMAGES_DIR / name).read_bytes()).decode()


def _auth_headers(subject: str | None = None) -> dict:
    return {"Authorization": f"Bearer {create_access_token(subject or str(uuid.uuid4()))}"}


class _LiveStubDetector:
    """LivenessDetectorPort stub: live=True, honoring the MIN_FRAMES gate."""

    def detect_liveness(self, video_frames: list[bytes]) -> LivenessResult:
        if len(video_frames) < MIN_FRAMES:
            raise InsufficientFrames(
                details={"frames": len(video_frames), "min_frames": MIN_FRAMES}
            )
        return LivenessResult(
            live=True,
            confidence=0.9,
            blink_detected=True,
            natural_movement=True,
            details={"frames_with_face": len(video_frames)},
        )


def _real_service(db_session, detector=None) -> BiometricService:
    """Build the real service on the test session (repos + adapter real)."""
    return BiometricService(
        adapter=get_biometric_adapter(),
        user_repo=UserRepository(db_session),
        embedding_repo=EmbeddingRepository(db_session),
        audit_repo=AuditLogRepository(db_session),
        liveness_detector=detector or _LiveStubDetector(),
        settings=get_settings(),
    )


@pytest_asyncio.fixture
async def api_client(db_session):
    """Async HTTP client with get_biometric_service bound to the test DB."""
    app.dependency_overrides[get_biometric_service] = lambda: _real_service(db_session)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture(scope="module")
def real_detector():
    """Process-wide MediaPipe detector (~60s first init, released after)."""
    det = MediaPipeLivenessDetector()
    yield det
    det.close()


async def test_enroll_endpoint_success(api_client: AsyncClient) -> None:
    """T7.1: valid leveled face -> 200 + embedding_id + quality >= 0.7."""
    response = await api_client.post(
        "/api/v1/enroll", json={"image_base64": _b64("face_leveled.jpg")},
        headers=_auth_headers(),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert uuid.UUID(body["embedding_id"])
    assert body["quality_score"] >= 0.7


async def test_enroll_non_uuid_subject_maps_deterministically(
    api_client: AsyncClient,
) -> None:
    """Non-UUID JWT subjects (dev/mock auth) enroll via the uuid5 mapping."""
    response = await api_client.post(
        "/api/v1/enroll", json={"image_base64": _b64("face_leveled.jpg")},
        headers=_auth_headers("qa-user-f7"),
    )
    assert response.status_code == 200, response.text
    assert uuid.UUID(response.json()["embedding_id"])


async def test_enroll_endpoint_no_auth_returns_401(api_client: AsyncClient) -> None:
    """T7.2: missing Bearer token -> 401 (HTTPBearer auto_error)."""
    response = await api_client.post(
        "/api/v1/enroll", json={"image_base64": _b64("face_leveled.jpg")}
    )
    assert response.status_code == 401


async def test_enroll_endpoint_invalid_image_returns_400(
    api_client: AsyncClient,
) -> None:
    """T7.3: no-face image -> 400; undecodable bytes -> 400."""
    no_face = await api_client.post(
        "/api/v1/enroll", json={"image_base64": _b64("no_face.jpg")},
        headers=_auth_headers(),
    )
    assert no_face.status_code == 400, no_face.text
    garbage = await api_client.post(
        "/api/v1/enroll",
        json={"image_base64": base64.b64encode(b"hello").decode()},
        headers=_auth_headers(),
    )
    assert garbage.status_code == 400, garbage.text


async def test_verify_endpoint_success(api_client: AsyncClient) -> None:
    """T7.4: enroll then verify same face -> 200 verified=True, same row."""
    headers = _auth_headers()
    payload = {"image_base64": _b64("face_leveled.jpg")}
    enrolled = await api_client.post("/api/v1/enroll", json=payload, headers=headers)
    assert enrolled.status_code == 200, enrolled.text
    matched = await api_client.post("/api/v1/verify", json=payload, headers=headers)
    assert matched.status_code == 200, matched.text
    body = matched.json()
    assert body["verified"] is True
    assert body["embedding_id"] == enrolled.json()["embedding_id"]
    assert body["confidence"] >= get_settings().BIOMETRIC_THRESHOLD


async def test_verify_endpoint_wrong_user_returns_verified_false(
    api_client: AsyncClient,
) -> None:
    """T7.5: verify as a user with no embeddings -> 200 verified=False."""
    enrolled = await api_client.post(
        "/api/v1/enroll",
        json={"image_base64": _b64("face_leveled.jpg")},
        headers=_auth_headers(),
    )
    assert enrolled.status_code == 200, enrolled.text
    other = await api_client.post(
        "/api/v1/verify",
        json={"image_base64": _b64("face_leveled.jpg")},
        headers=_auth_headers(),
    )
    assert other.status_code == 200, other.text
    body = other.json()
    assert body["verified"] is False
    assert body["confidence"] == 0.0


async def test_verify_liveness_endpoint_success(api_client: AsyncClient) -> None:
    """T7.6: MIN_FRAMES valid frames -> 200 live=True; short seq -> 400."""
    headers = _auth_headers()
    frames = [_b64("face_leveled.jpg")] * (MIN_FRAMES + 1)
    response = await api_client.post(
        "/api/v1/verify-liveness",
        json={"video_frames_base64": frames},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["live"] is True
    short = await api_client.post(
        "/api/v1/verify-liveness",
        json={"video_frames_base64": frames[: MIN_FRAMES - 1]},
        headers=headers,
    )
    assert short.status_code == 400, short.text


async def test_endpoints_reject_malformed_payloads(api_client: AsyncClient) -> None:
    """Non-base64 / empty payloads and missing auth map to 400/401."""
    headers = _auth_headers()
    bad = {"image_base64": "!!!not-base64!!!"}
    empty = {"image_base64": base64.b64encode(b"").decode()}
    for path in ("/api/v1/enroll", "/api/v1/verify"):
        rejected = await api_client.post(path, json=bad, headers=headers)
        assert rejected.status_code == 400, (path, rejected.text)
        blank = await api_client.post(path, json=empty, headers=headers)
        assert blank.status_code == 400, (path, blank.text)
        unauth = await api_client.post(path, json=bad)
        assert unauth.status_code == 401, (path, unauth.text)
    live_bad = await api_client.post(
        "/api/v1/verify-liveness",
        json={"video_frames_base64": ["!!!not-base64!!!"]},
        headers=headers,
    )
    assert live_bad.status_code == 400, live_bad.text
    live_unauth = await api_client.post(
        "/api/v1/verify-liveness",
        json={"video_frames_base64": [_b64("face_leveled.jpg")] * MIN_FRAMES},
    )
    assert live_unauth.status_code == 401, live_unauth.text


async def test_verify_liveness_real_detector_static_frames(
    db_session, real_detector: MediaPipeLivenessDetector
) -> None:
    """Real MediaPipe path end-to-end: static frames -> 200 live=False."""
    app.dependency_overrides[get_biometric_service] = lambda: _real_service(
        db_session, detector=real_detector
    )
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            headers = _auth_headers()
            frames = [_b64("face_leveled.jpg")] * MIN_FRAMES
            response = await ac.post(
                "/api/v1/verify-liveness",
                json={"video_frames_base64": frames},
                headers=headers,
            )
            assert response.status_code == 200, response.text
            assert response.json()["live"] is False
            no_face = await ac.post(
                "/api/v1/verify-liveness",
                json={"video_frames_base64": [_b64("no_face.jpg")] * MIN_FRAMES},
                headers=headers,
            )
            assert no_face.status_code == 400, no_face.text
    finally:
        app.dependency_overrides.clear()


async def test_enroll_persists_across_requests(
    test_engine, db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Enroll in request 1 is visible to verify in request 2.

    Production topology: NO dependency overrides — the real
    get_db_session (request-scoped commit) plus the real service chain,
    with only the session factory pointed at biometric_test. Guards the
    commit in get_db_session: without it, flush-only writes vanish on
    session close and verify sees nothing. (``db_session`` param is
    cleanup-only: it truncates tables after the test.)
    """
    from app.infrastructure.db import session as session_module

    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(session_module, "get_session_factory", lambda: factory)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        headers = _auth_headers()
        payload = {"image_base64": _b64("face_leveled.jpg")}
        enrolled = await ac.post("/api/v1/enroll", json=payload, headers=headers)
        assert enrolled.status_code == 200, enrolled.text
        matched = await ac.post("/api/v1/verify", json=payload, headers=headers)
        assert matched.status_code == 200, matched.text
        assert matched.json()["verified"] is True


async def test_failed_enroll_persists_failure_audit(
    test_engine, db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Failed enroll (400) still persists its failure audit row.

    Production topology (no service overrides): the service writes the
    ENROLL failure audit BEFORE raising, the endpoint maps it to 400,
    and get_db_session must COMMIT controlled HTTPException outcomes
    (rollback would silently erase the failure trail). (``db_session``
    is read + cleanup only.)
    """
    from app.domain.services import ENROLL
    from app.infrastructure.db import session as session_module
    from app.infrastructure.db.models import BiometricAuditLog

    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(session_module, "get_session_factory", lambda: factory)
    subject = str(uuid.uuid4())
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        rejected = await ac.post(
            "/api/v1/enroll",
            json={"image_base64": _b64("no_face.jpg")},
            headers=_auth_headers(subject),
        )
        assert rejected.status_code == 400, rejected.text
    rows = (
        (
            await db_session.execute(
                select(BiometricAuditLog).where(
                    BiometricAuditLog.user_id == uuid.UUID(subject)
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) >= 1
    assert any(row.action == ENROLL and row.success is False for row in rows)


async def test_rate_limiting_returns_429_after_100_requests(
    db_session,
) -> None:
    """T7.7: 100 req/min/user; 101st -> 429; another user unaffected.

    Heavy deps are stubbed (no DB/model per request) so 101 sequential
    requests stay well under 15s; the real slowapi limiter + keying run.
    """
    calls = {"n": 0}

    class _CheapService:
        async def enroll(self, user_id, image):  # type: ignore[no-untyped-def]
            calls["n"] += 1
            return EnrollResult(embedding_id=uuid.uuid4(), quality_score=0.9)

    app.dependency_overrides[get_biometric_service] = lambda: _CheapService()
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            user = _auth_headers("ratelimit-user-f7")
            payload = {"image_base64": base64.b64encode(b"x").decode()}
            last_ok = None
            for _ in range(100):
                last_ok = await ac.post("/api/v1/enroll", json=payload, headers=user)
                assert last_ok.status_code == 200, last_ok.text
            over = await ac.post("/api/v1/enroll", json=payload, headers=user)
            assert over.status_code == 429, over.text
            fresh_user = await ac.post(
                "/api/v1/enroll", json=payload,
                headers=_auth_headers("ratelimit-other-f7"),
            )
            assert fresh_user.status_code == 200, fresh_user.text
    finally:
        app.dependency_overrides.clear()
    assert calls["n"] == 101
