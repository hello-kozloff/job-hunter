"""Настройки ядра v2 из окружения (v2/.env через docker compose)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    database_url: str
    # Секрет запросов n8n v2 → ядро (заголовок X-Internal-Token)
    internal_token: str = ""
    # Бот v2 (новый бот, не v1); первый администратор
    tg_bot_token: str = ""
    admin_tg_id: int | None = None
    # Нейросеть: общий ключ на всех пользователей
    gemini_api_key: str = ""
    anthropic_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash-lite"
    claude_model: str = "claude-haiku-4-5"


@lru_cache
def get_settings() -> Settings:
    return Settings()
