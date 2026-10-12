"""Repository tests against real PostgreSQL (Fase 3, T3.1-T3.6)."""

import numpy as np
import pytest

from app.infrastructure.db.models import from_blob
from app.infrastructure.db.repository import (
    AuditLogRepository,
    DuplicateEmailError,
    EmbeddingRepository,
    UserRepository,
    load_embedding,
)


def _vec(seed: float = 1.0) -> np.ndarray:
    """Deterministic 512-dim float32 test vector."""
    return (np.arange(512, dtype=np.float32) + seed) / 512.0


async def test_create_user_succeeds(db_session, unique_email):
    """T3.1: creating a user persists id + email."""
    repo = UserRepository(db_session)
    user = await repo.create(unique_email, "hash-abc")
    await db_session.commit()

    assert user.id is not None
    found = await repo.find_by_email(unique_email)
    assert found is not None
    assert found.id == user.id
    assert (await repo.find_by_id(user.id)) is not None


async def test_create_user_duplicate_email_raises(db_session, unique_email):
    """T3.2: a second user with the same email raises DuplicateEmailError."""
    repo = UserRepository(db_session)
    await repo.create(unique_email, "hash-1")
    await db_session.commit()

    with pytest.raises(DuplicateEmailError):
        await repo.create(unique_email, "hash-2")


async def test_save_embedding_succeeds(db_session, unique_email):
    """T3.3: saving an embedding round-trips the vector bytes."""
    users = UserRepository(db_session)
    user = await users.create(unique_email, "hash")
    await db_session.commit()

    saved = await EmbeddingRepository(db_session).save(
        user.id, _vec(), 0.92, "insightface_arcface_v1"
    )
    await db_session.commit()

    assert saved.id is not None
    assert np.allclose(from_blob(saved.embedding), _vec())
    assert np.allclose(load_embedding(saved), _vec())


async def test_find_embeddings_by_user_returns_list(db_session, unique_email):
    """T3.4: find_by_user returns the active rows for that user only."""
    users = UserRepository(db_session)
    user = await users.create(unique_email, "hash")
    other = await users.create("other-" + unique_email, "hash")
    await db_session.commit()

    embeddings = EmbeddingRepository(db_session)
    await embeddings.save(user.id, _vec(1.0), 0.9, "v1")
    await embeddings.save(user.id, _vec(2.0), 0.8, "v1")
    await embeddings.save(other.id, _vec(3.0), 0.7, "v1")
    await db_session.commit()

    rows = await embeddings.find_by_user(user.id)
    assert len(rows) == 2
    assert all(row.user_id == user.id for row in rows)


async def test_deactivate_embedding_sets_is_active_false(db_session, unique_email):
    """T3.5: deactivated rows disappear from find_by_user results."""
    users = UserRepository(db_session)
    user = await users.create(unique_email, "hash")
    await db_session.commit()

    embeddings = EmbeddingRepository(db_session)
    saved = await embeddings.save(user.id, _vec(), 0.9, "v1")
    await db_session.commit()

    await embeddings.deactivate(saved.id)
    await db_session.commit()

    assert await embeddings.find_by_user(user.id) == []


async def test_log_audit_entry_succeeds(db_session, unique_email):
    """T3.6: audit log entries persist with details and are queryable."""
    users = UserRepository(db_session)
    user = await users.create(unique_email, "hash")
    await db_session.commit()

    audits = AuditLogRepository(db_session)
    entry = await audits.log(
        user.id, "VERIFY", True, 0.97, {"model": "insightface_arcface_v1"}
    )
    await db_session.commit()

    assert entry.id is not None
    rows = await audits.find_by_user(user.id)
    assert len(rows) == 1
    assert rows[0].action == "VERIFY"
    assert rows[0].success is True
    assert rows[0].confidence_score == pytest.approx(0.97)
    assert rows[0].details == {"model": "insightface_arcface_v1"}
