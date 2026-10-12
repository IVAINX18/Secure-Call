"""JWT helpers for the biometric engine.

Production tokens are issued externally (Secure-Call auth); this module only
validates them. ``create_access_token`` exists for tests and local dev.
"""

from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt

from app.config import get_settings

ALGORITHM = "HS256"


class TokenError(Exception):
    """Raised when a JWT is invalid or expired."""


def create_access_token(subject: str, expires_minutes: int = 30) -> str:
    """Create a short-lived HS256 access token for ``subject`` (dev/tests)."""
    expire = datetime.now(UTC) + timedelta(minutes=expires_minutes)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, get_settings().JWT_SECRET_KEY, algorithm=ALGORITHM)


def decode_jwt(token: str) -> dict:
    """Decode and validate a JWT, returning its claims.

    Raises:
        TokenError: if the token is invalid or expired.
    """
    try:
        return jwt.decode(token, get_settings().JWT_SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise TokenError(f"Invalid or expired token: {exc}") from exc
