"""slowapi rate limiting: 100 req/min per user for biometric endpoints."""

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.security import TokenError, decode_jwt

#: Biometric endpoints (enroll / verify / verify-liveness) share this budget.
BIOMETRIC_RATE_LIMIT = "100/minute"


def user_or_ip_key(request: Request) -> str:
    """Rate-limit key: JWT subject when a Bearer token is present, else IP.

    Falls back to the client IP when the Authorization header is missing
    or the token does not decode, so unauthenticated callers still share
    a bounded bucket instead of bypassing the limiter.
    """
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token:
            try:
                claims = decode_jwt(token)
            except TokenError:
                claims = {}
            subject = claims.get("sub")
            if subject:
                return f"user:{subject}"
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(key_func=user_or_ip_key)
