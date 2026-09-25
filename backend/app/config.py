from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Emergency Driver API"
    environment: str = "development"

    # No defaults on either secret: they come from the environment, or from the
    # gitignored .env. This repository is public, so a working credential must
    # never be committed — and a literal default here would be exactly that.
    # Required-with-no-default also means a missing value fails loudly at boot
    # instead of silently running on a placeholder.
    database_url: str
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_ttl_seconds: int = 15 * 60          # short-lived access token
    refresh_token_ttl_seconds: int = 7 * 24 * 3600   # 7-day refresh token

    # Location validation thresholds (section 8 of the spec)
    max_accuracy_m: float = 100.0
    max_timestamp_skew_seconds: int = 30
    max_speed_kmph: float = 200.0
    jump_tolerance_m: float = 60.0

    # Mock route agent behaviour
    mock_route_avg_speed_kmph: float = 42.0
    junction_spacing_m: float = 600.0

    # Rate limiting (requests per window per identity)
    rate_limit_window_seconds: int = 60
    rate_limit_max_requests: int = 120

    cors_origins: list[str] = ["*"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
