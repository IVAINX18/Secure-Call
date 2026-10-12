"""Factory for the biometric adapter (cached singleton)."""

from __future__ import annotations

from app.infrastructure.adapters.base import BiometricAdapter
from app.infrastructure.adapters.insightface_adapter import InsightFaceAdapter

_adapter: BiometricAdapter | None = None


def get_biometric_adapter() -> BiometricAdapter:
    """Return the process-wide cached ``InsightFaceAdapter`` instance."""
    global _adapter
    if _adapter is None:
        _adapter = InsightFaceAdapter()
    return _adapter
