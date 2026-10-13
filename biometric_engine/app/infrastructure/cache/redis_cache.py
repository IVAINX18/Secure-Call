"""Redis cache for user embeddings (Fase 8.1).

Caches exactly what the verify path needs: embedding id + raw float32
blob bytes. Encoding is explicit JSON with base64 blobs (never pickle)
so cached rows round-trip bit-exact and the cached verify path returns
the identical ``verified`` / ``confidence`` / ``embedding_id`` as the
DB path.

Errors are NOT swallowed here: the service layer wraps every cache
call in try/except (fail-open — a cache outage degrades performance,
never availability). ``None`` means "miss"; an empty list is a valid
cached value (user has no embeddings).
"""

from __future__ import annotations

import base64
import json
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from app.domain.services import StoredRow


@dataclass
class CachedEmbeddingRow:
    """Cache-shaped embedding row: id + raw float32 blob bytes.

    Exposes the same ``.id`` / ``.embedding`` attributes the service
    reads from DB rows, so ``load_embedding(row)`` works unchanged.
    (Not frozen: the domain ``StoredRow`` port requires a settable
    ``id``, so a frozen read-only attribute would not satisfy it.)
    """

    id: uuid.UUID
    embedding: bytes


class RedisClientPort(Protocol):
    """Minimal async Redis surface RedisCache needs (real: redis.asyncio)."""

    async def get(self, key: str) -> str | None:
        """Return the cached string for ``key``, or None on miss."""
        ...

    async def set(self, key: str, value: str, ex: int | None = None) -> object:
        """Store ``value`` under ``key`` with an optional TTL in seconds."""
        ...

    async def delete(self, *keys: str) -> object:
        """Remove ``keys`` from the cache."""
        ...


def _cache_key(user_id: uuid.UUID) -> str:
    """Build the namespaced cache key for a user's embeddings."""
    return f"biometric:embeddings:{user_id}"


class RedisCache:
    """Embedding cache backed by an asyncio Redis client.

    Args:
        redis_client: shared loop-aware client (see
            ``app.infrastructure.cache.client.create_redis_client``).
    """

    def __init__(self, redis_client: Any) -> None:
        self._redis = redis_client

    async def get_embeddings(
        self, user_id: uuid.UUID
    ) -> Sequence[StoredRow] | None:
        """Return cached rows for ``user_id``, or None on cache miss."""
        raw = await self._redis.get(_cache_key(user_id))
        if raw is None:
            return None
        # The client is created with decode_responses=True, so values
        # arrive as str; accept bytes too for hand-rolled fakes.
        payload = raw.decode("utf-8") if isinstance(raw, bytes) else raw
        entries = json.loads(payload)
        return [
            CachedEmbeddingRow(
                id=uuid.UUID(entry["id"]),
                embedding=base64.b64decode(entry["blob"]),
            )
            for entry in entries
        ]

    async def set_embeddings(
        self,
        user_id: uuid.UUID,
        embeddings: Any,
        ttl: int = 300,
    ) -> None:
        """Cache ``embeddings`` rows (any objects with ``.id``/``.embedding``)."""
        entries = [
            {
                "id": str(row.id),
                "blob": base64.b64encode(bytes(row.embedding)).decode("ascii"),
            }
            for row in embeddings
        ]
        await self._redis.set(_cache_key(user_id), json.dumps(entries), ex=ttl)

    async def invalidate(self, user_id: uuid.UUID) -> None:
        """Drop the cached embeddings for ``user_id`` (no-op on miss)."""
        await self._redis.delete(_cache_key(user_id))
