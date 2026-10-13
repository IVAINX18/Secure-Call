"""Application configuration via pydantic-settings.

All values come from environment variables / `.env` (see `.env.example`).
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings for the biometric engine service."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    DATABASE_URL: str
    REDIS_URL: str
    JWT_SECRET_KEY: str
    BIOMETRIC_THRESHOLD: float = 0.85
    LIVENESS_THRESHOLD: float = 0.7
    EMBEDDING_CACHE_TTL: int = 300
    LOG_LEVEL: str = "INFO"
    CORS_ORIGINS: str = "http://localhost:5173"

    def cors_origins_list(self) -> list[str]:
        """Parse the comma-separated CORS_ORIGINS into a list of origins."""
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return the cached application settings singleton."""
    return Settings()


settings = get_settings()
