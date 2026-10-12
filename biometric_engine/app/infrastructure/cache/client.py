"""Redis asyncio client factory (shared singleton for the app lifespan)."""

import asyncio

import redis.asyncio as redis

from app.config import get_settings

_redis_client: redis.Redis | None = None
_redis_loop: asyncio.AbstractEventLoop | None = None


def create_redis_client(url: str | None = None) -> redis.Redis:
    """Create (or reuse) the shared asyncio Redis client.

    The client is recreated when the running event loop changed since
    creation (connections are loop-bound).
    """
    global _redis_client, _redis_loop
    try:
        running: asyncio.AbstractEventLoop | None = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if _redis_client is None or (
        running is not None and _redis_loop is not None and _redis_loop is not running
    ):
        _redis_client = redis.from_url(
            url or get_settings().REDIS_URL, decode_responses=True
        )
        _redis_loop = running
    return _redis_client


async def close_redis_client() -> None:
    """Close and forget the shared Redis client (called on app shutdown)."""
    global _redis_client, _redis_loop
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None
        _redis_loop = None
