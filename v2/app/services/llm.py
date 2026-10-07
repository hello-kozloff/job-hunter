"""Вызов нейросети со строгим JSON-ответом по pydantic-схеме. Gemini (по умолчанию) или Claude.

Каждый вызов пишется в llm_usage (расход по пользователям в /admin, квоты).
"""

import json
import logging
import re
from dataclasses import dataclass
from typing import TypeVar

from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import LlmUsage

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)


class LlmError(Exception):
    """Нейросеть не ответила или ответила не по схеме — сообщение показывается пользователю."""


class LlmUnavailable(LlmError):
    """Сеть, 5xx или лимит провайдера (quota = 429): запрос стоит повторить позже, а не ставить оценку «ошибка»."""

    def __init__(self, message: str, quota: str | None = None):
        super().__init__(message)
        # None — не лимит; "minute" — лимит в минуту (пройдёт сам); "day" — суточный (тревога админу)
        self.quota = quota


def _quota(e: Exception) -> str | None:
    text = f"{type(e).__name__} {e}"
    if not re.search(r"429|RESOURCE_EXHAUSTED|RateLimit|rate.limit", text, re.I):
        return None
    # Gemini пишет в деталях, какой лимит кончился: …PerDay… или …PerMinute…
    return "day" if re.search(r"PerDay", text, re.I) else "minute"


@dataclass
class Usage:
    provider: str
    model: str
    input_tokens: int | None
    output_tokens: int | None


async def _gemini(system: str, prompt: str, schema: type[T], temperature: float) -> tuple[T, Usage]:
    from google import genai
    from google.genai import types

    s = get_settings()
    if not s.gemini_api_key:
        raise LlmError("нет GEMINI_API_KEY")
    client = genai.Client(api_key=s.gemini_api_key)
    response = await client.aio.models.generate_content(
        model=s.gemini_model,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            response_mime_type="application/json",
            response_json_schema=schema.model_json_schema(),
            # Инструментов нет — автовызов функций SDK не нужен (и пишет предупреждение в лог)
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        ),
    )
    meta = response.usage_metadata
    usage = Usage("gemini", s.gemini_model, meta and meta.prompt_token_count, meta and meta.candidates_token_count)
    try:
        return schema.model_validate_json(response.text or ""), usage
    except ValidationError as e:
        log.warning("gemini answer does not match schema: %s", e)
        raise LlmError("нейросеть ответила не по схеме") from e


async def _claude(system: str, prompt: str, schema: type[T], temperature: float) -> tuple[T, Usage]:
    from anthropic import AsyncAnthropic

    s = get_settings()
    if not s.anthropic_api_key:
        raise LlmError("нет ANTHROPIC_API_KEY")
    client = AsyncAnthropic(api_key=s.anthropic_api_key)
    # Структурный ответ через инструмент: модель обязана вызвать его с аргументами по схеме
    message = await client.messages.create(
        model=s.claude_model,
        max_tokens=8000,
        temperature=temperature,
        system=system,
        messages=[{"role": "user", "content": prompt}],
        tools=[{"name": "answer", "description": "Ответ строго по схеме", "input_schema": schema.model_json_schema()}],
        tool_choice={"type": "tool", "name": "answer"},
    )
    usage = Usage("claude", s.claude_model, message.usage.input_tokens, message.usage.output_tokens)
    block = next((b for b in message.content if b.type == "tool_use"), None)
    try:
        return schema.model_validate(block.input if block else {}), usage
    except ValidationError as e:
        log.warning("claude answer does not match schema: %s", json.dumps(block.input if block else None)[:500])
        raise LlmError("нейросеть ответила не по схеме") from e


async def ask(
    session: AsyncSession,
    *,
    kind: str,
    system: str,
    prompt: str,
    schema: type[T],
    provider: str = "gemini",
    user_id: int | None = None,
    profile_id: int | None = None,
    temperature: float = 0.2,
) -> T:
    call = _claude if provider == "claude" else _gemini
    try:
        result, usage = await call(system, prompt, schema, temperature)
    except LlmError as e:
        session.add(LlmUsage(user_id=user_id, profile_id=profile_id, kind=kind, provider=provider, model="?", ok=False, error=str(e)))
        await session.commit()
        raise
    except Exception as e:  # сеть, 429, 5xx у провайдера
        log.exception("llm %s failed", provider)
        session.add(
            LlmUsage(user_id=user_id, profile_id=profile_id, kind=kind, provider=provider, model="?", ok=False, error=str(e)[:500])
        )
        await session.commit()
        quota = _quota(e)
        raise LlmUnavailable("лимит запросов к нейросети" if quota else "нейросеть недоступна, попробуй позже", quota) from e
    session.add(
        LlmUsage(
            user_id=user_id,
            profile_id=profile_id,
            kind=kind,
            provider=usage.provider,
            model=usage.model,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            ok=True,
        )
    )
    await session.commit()
    return result
