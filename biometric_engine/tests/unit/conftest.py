"""Adapter fixtures for Fase 4 (InsightFace) unit tests.

Owns: raw image bytes for each fixture file plus a shared
module-scoped ``InsightFaceAdapter`` (model loads once per session).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.infrastructure.adapters.insightface_adapter import InsightFaceAdapter

IMAGES_DIR = Path(__file__).parent.parent / "fixtures" / "images"


def _read(name: str) -> bytes:
    return (IMAGES_DIR / name).read_bytes()


@pytest.fixture(scope="module")
def adapter() -> InsightFaceAdapter:
    """Shared adapter; the InsightFace model downloads/loads once here."""
    return InsightFaceAdapter()


@pytest.fixture(scope="module")
def single_face_bytes() -> bytes:
    """Exactly one detectable face."""
    return _read("single_face.jpg")


@pytest.fixture(scope="module")
def multi_face_bytes() -> bytes:
    """Six faces in one frame."""
    return _read("multi_face.jpg")


@pytest.fixture(scope="module")
def no_face_bytes() -> bytes:
    """No face (surgical-mask close-up)."""
    return _read("no_face.jpg")


@pytest.fixture(scope="module")
def dark_face_bytes() -> bytes:
    """Same face as single_face.png darkened to 30% brightness."""
    return _read("dark_face.png")
