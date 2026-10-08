"""Письма: промпт (без тире, разметка навыков), чистка ответа, генерация по ✅, правка, «Отправил», изоляция."""

from datetime import UTC, datetime

from sqlalchemy import select

from app.db.models import UserVacancy
from app.domain.llm import letter as prompts
from app.domain.profile_config import LetterConfig
from app.services import cards, letters, llm, profiles, score
from tests.test_score import fake_llm, make_profile, make_user, make_vacancy, passed

RESUME = {
    "headline": "QA инженер",
    "skills_commercial": ["Playwright", "TypeScript"],
    "skills_other": ["Docker"],
    "experience": [{"company": "Рога", "role": "QA", "period": "2020-2024", "highlights": ["Написал 300 автотестов на Pytest"]}],
}


def test_prompt_has_no_dashes_and_uses_letter_config() -> None:
    cfg = LetterConfig(signature="Аня", contact="тг: @anya", samples=["Образец 1"], notes=["не упоминай фриланс"])
    system = prompts.system_prompt(cfg, RESUME, "текст резюме")
    # Flash-Lite копирует типографику промпта: ни одного длинного или среднего тире
    assert "—" not in system and "–" not in system
    assert "«Для быстрой связи тг: @anya» и «Аня»" in system
    assert "Образец 1" in system and "не упоминай фриланс" in system


def test_skill_map() -> None:
    text = prompts.skill_map(["Playwright", "pytest", "Docker", "Kubernetes", "Agile"], RESUME, "Резюме")
    assert "коммерческом опыте: Playwright, pytest" in text
    assert "своих проектах, фрилансе, учёбе: Docker" in text
    assert "нет в резюме: Kubernetes" in text and "Agile" not in text


def test_finish_cleans_typography_and_adds_ending() -> None:
    cfg = LetterConfig(signature="Аня", contact="тг: @anya")
    out = prompts.finish("Здравствуйте! Писала тесты — «быстро», а также   успешно чинила баги…", cfg)
    assert out.startswith("Здравствуйте!\n\n")
    assert "—" not in out and "«" not in out and "а также" not in out and "успешно" not in out and "..." in out
    assert out.endswith("Для быстрой связи тг: @anya\nАня")
    # Уже есть контакт и подпись — не дублируются
    assert prompts.finish(out, cfg) == out
    # Один абзац с контактом и подписью в строку → два абзаца, концовка отдельно
    glued = prompts.finish("Здравствуйте! Вела клиентов. Делала отчёты. Готовила договоры. Для быстрой связи тг: @anya Аня", cfg)
    assert glued == "Здравствуйте!\n\nВела клиентов. Делала отчёты.\n\nГотовила договоры.\n\nДля быстрой связи тг: @anya\nАня"


async def scored_card(session, monkeypatch, tg_id: int):
    user = await make_user(session, tg_id)
    qa = await make_profile(session, user, "QA")
    v = await make_vacancy(session, tg_id, key_skills=["Playwright"])
    await passed(session, qa, v)
    fake_llm(monkeypatch, {"QA": "apply"})
    await score.run(session, budget=10, pause=0)
    uv = await session.scalar(select(UserVacancy).where(UserVacancy.user_id == user.id))
    return user, qa, uv


def fake_letter(monkeypatch, text="Здравствуйте! Писал автотесты на Playwright."):
    calls = []

    async def ask(session, *, kind, system, prompt, schema, **kw):
        calls.append((kind, prompt, kw.get("temperature")))
        return prompts.Letter(letter=text)

    monkeypatch.setattr(llm, "ask", ask)
    return calls


async def test_apply_writes_letter_redo_revise_and_sent(session, monkeypatch, no_outside_world) -> None:
    user, qa, uv = await scored_card(session, monkeypatch, 601)
    loaded = await profiles.load(session, user.id, qa.id)
    await profiles.set_letter(session, loaded, "signature", "Аня")

    out = await cards.press(session, user, uv.id, "apply")
    assert out.need_letter
    calls = fake_letter(monkeypatch)
    assert await letters.generate(session, uv.id)
    assert uv.letter.endswith("Аня") and uv.letter_lock is None and uv.tg_letter_id
    assert calls[-1][0] == "letter" and "Напиши сопроводительное письмо" in calls[-1][1]
    assert "<pre>" in no_outside_world[-1][1]

    # Повторный ✅ с тем же резюме письмо не переписывает
    await cards.press(session, user, uv.id, "edit")
    assert not (await cards.press(session, user, uv.id, "apply")).need_letter

    first = uv.tg_letter_id
    await letters.generate(session, uv.id, "redo")
    assert calls[-1][2] == 0.9 and "не подошёл" in calls[-1][1] and uv.tg_letter_id != first

    await letters.generate(session, uv.id, "revise", "короче")
    assert "по пожеланию кандидата" in calls[-1][1] and uv.letter_notes == ["короче"]
    assert await letters.by_letter_message(session, user, uv.tg_letter_id) == uv

    text, kb = await letters.mark_sent(session, user, uv, True)
    assert uv.status == "applied" and uv.applied_at and "📨 Отклик отправлен" in text
    assert kb.inline_keyboard[0][0].text == "↩️ Отменить"
    await letters.mark_sent(session, user, uv, False)
    assert uv.status == "approved" and uv.applied_at is None


async def test_lock_blocks_double_letter(session, monkeypatch) -> None:
    user, qa, uv = await scored_card(session, monkeypatch, 602)
    await cards.press(session, user, uv.id, "apply")
    uv.letter_lock = datetime.now(UTC)
    await session.commit()
    fake_letter(monkeypatch)
    assert not await letters.generate(session, uv.id)


async def test_llm_failure_shows_retry(session, monkeypatch, no_outside_world) -> None:
    user, qa, uv = await scored_card(session, monkeypatch, 603)
    await cards.press(session, user, uv.id, "apply")
    fake_llm(monkeypatch, error=llm.LlmError("нейросеть недоступна"))
    assert not await letters.generate(session, uv.id)
    assert "Письмо не получилось" in no_outside_world[-1][1] and uv.letter_lock is None


async def test_other_user_cannot_touch_letter(session, monkeypatch) -> None:
    owner, qa, uv = await scored_card(session, monkeypatch, 604)
    stranger = await make_user(session, 605)
    assert await letters.owned(session, stranger, uv.id) is None
    assert await letters.by_letter_message(session, stranger, 1) is None


async def test_letter_settings(session, monkeypatch) -> None:
    user = await make_user(session, 606)
    qa = await make_profile(session, user, "QA")
    loaded = await profiles.load(session, user.id, qa.id)
    await profiles.set_letter(session, loaded, "contact", "тг: @x")
    await profiles.set_letter(session, await profiles.load(session, user.id, qa.id), "sample", "Пример")
    loaded = await profiles.load(session, user.id, qa.id)
    assert loaded.config.letter.contact == "тг: @x" and loaded.config.letter.samples == ["Пример"]
    await profiles.set_letter(session, loaded, "contact", "-")
    await profiles.set_letter(session, await profiles.load(session, user.id, qa.id), "clear_samples")
    loaded = await profiles.load(session, user.id, qa.id)
    assert loaded.config.letter.contact == "" and loaded.config.letter.samples == []
    assert await profiles.set_letter(session, loaded, "bogus", "x") is None
