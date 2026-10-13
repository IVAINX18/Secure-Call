"""Unit tests for the DATABASE_URL driver normalization (Fase 10 fix).

Render Blueprints inject a driver-less ``postgresql://`` connectionString;
the async engine needs ``postgresql+asyncpg://``. These tests pin the
rewrite and its pass-through cases (pure function, no DB needed).
"""

from app.infrastructure.db.session import normalize_database_url


def test_plain_postgres_url_gets_asyncpg_driver():
    """Driver-less Render-style URL is rewritten to the asyncpg dialect."""
    assert (
        normalize_database_url("postgresql://user:pass@host:5432/biometric")
        == "postgresql+asyncpg://user:pass@host:5432/biometric"
    )


def test_already_dialected_url_is_untouched():
    """Local/CI-style URLs that already name asyncpg pass through as-is."""
    url = "postgresql+asyncpg://biometric:biometric@localhost:55432/biometric"
    assert normalize_database_url(url) == url


def test_non_postgres_scheme_is_untouched():
    """Non-postgres schemes (e.g. sqlite test URLs) are never rewritten."""
    url = "sqlite+aiosqlite:///:memory:"
    assert normalize_database_url(url) == url
