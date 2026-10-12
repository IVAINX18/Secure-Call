"""Domain exceptions for the biometric engine.

Framework-free: no FastAPI (or any web framework) imports. Fase 5
(MediaPipe liveness) will append liveness exceptions to this file;
keep the layout clean and sectioned.
"""

from __future__ import annotations


class BiometricException(Exception):
    """Base class for all biometric domain errors.

    Carries an optional ``details`` payload with structured context
    (e.g. number of faces found, quality breakdown) for logging and
    API error responses.
    """

    def __init__(self, message: str, details: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NoFaceDetected(BiometricException):
    """Raised when no face is found in the supplied image."""

    def __init__(
        self,
        message: str = "No face detected in the image.",
        details: dict | None = None,
    ) -> None:
        super().__init__(message, details)


class MultipleFacesDetected(BiometricException):
    """Raised when more than one face is found but exactly one was expected."""

    def __init__(
        self,
        message: str = "Multiple faces detected; exactly one face is required.",
        details: dict | None = None,
    ) -> None:
        super().__init__(message, details)


class LowQualityFace(BiometricException):
    """Raised when a detected face fails the quality gate (service layer)."""

    def __init__(
        self,
        message: str = "Face quality below the acceptance threshold.",
        details: dict | None = None,
    ) -> None:
        super().__init__(message, details)


class InvalidImageFormat(BiometricException):
    """Raised when raw bytes cannot be decoded into an image."""

    def __init__(
        self,
        message: str = "Invalid image format: bytes could not be decoded.",
        details: dict | None = None,
    ) -> None:
        super().__init__(message, details)


class LivenessCheckFailed(BiometricException):
    """Base class for liveness-check failures (Fase 5, MediaPipe detector)."""


class InsufficientFrames(LivenessCheckFailed):
    """Raised when fewer than MIN_FRAMES frames are supplied.

    Raised directly by the detector. Fase 6's service layer maps this
    (and the siblings below) to API error responses.
    """

    def __init__(
        self,
        message: str = "Insufficient frames for liveness detection.",
        details: dict | None = None,
    ) -> None:
        super().__init__(message, details)


class NoBlinkDetected(LivenessCheckFailed):
    """Raised when no valid blink is found in the frame sequence.

    Not raised by the Fase 5 detector itself (which reports
    ``blink_detected=False`` in ``LivenessResult`` instead); exists
    for Fase 6's service layer to signal a failed liveness gate.
    """

    def __init__(
        self,
        message: str = "No blink detected in the video sequence.",
        details: dict | None = None,
    ) -> None:
        super().__init__(message, details)


class NoNaturalMovement(LivenessCheckFailed):
    """Raised when landmark variance shows no natural micro-movement.

    Not raised by the Fase 5 detector itself (which reports
    ``natural_movement=False`` in ``LivenessResult`` instead); exists
    for Fase 6's service layer to signal a failed liveness gate.
    """

    def __init__(
        self,
        message: str = "No natural movement detected in the video sequence.",
        details: dict | None = None,
    ) -> None:
        super().__init__(message, details)
