"""callback_data кнопок (лимит Telegram — 64 байта). Префиксы уникальны на весь бот."""

from aiogram.filters.callback_data import CallbackData


class RequestAccess(CallbackData, prefix="req"):
    pass


class Tz(CallbackData, prefix="tz"):
    # Индекс в timezones.POPULAR; -1 — «✏️ Другой»
    i: int


class Decide(CallbackData, prefix="ar"):
    """Решение админа по заявке на доступ."""

    id: int
    ok: bool


class Admin(CallbackData, prefix="adm"):
    """Панель администратора: action — экран или действие, arg — параметр (номер страницы, id, …).

    «:» внутри полей нельзя — это разделитель aiogram; составной arg склеивается через «-».
    """

    action: str
    arg: str = ""


class Prof(CallbackData, prefix="pf"):
    """Резюме (профиль): action — экран или действие, pid — id профиля (0 — список), arg — параметр (id правила)."""

    action: str
    pid: int = 0
    arg: str = ""


class Card(CallbackData, prefix="c"):
    """Карточка вакансии: id — строка user_vacancies (проверяется владелец); action — apply|maybe|skip|earlier|ban|edit;
    arg — id резюме, когда ✅ или «🚫 В ЧС» надо отнести к одному из нескольких резюме («all» — во все)."""

    action: str
    id: int
    arg: str = ""


class LetterBtn(CallbackData, prefix="l"):
    """Кнопки под письмом: id — строка user_vacancies (проверяется владелец); action — redo | sent | unsent."""

    action: str
    id: int
