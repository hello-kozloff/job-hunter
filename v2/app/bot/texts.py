"""Все тексты бота v2. Один словарь RU — чтобы потом добавить другие языки без правки обработчиков.

Подстановки — str.format; всё, что пришло от людей (имена, комментарии), экранируется до подстановки (html.escape).
"""

RU = {
    # Вход
    "start.closed": "🔒 <b>Job Hunter работает по приглашениям.</b>\n\n"
    "Есть ссылка-приглашение — открой её. Нет — оставь заявку, администратор посмотрит.",
    "start.bad_invite": "😕 Приглашение недействительно: истекло, отозвано или уже использовано.\n\n"
    "Попроси новую ссылку или оставь заявку.",
    "start.blocked": "⛔ Доступ закрыт.",
    "start.welcome": "👋 <b>Добро пожаловать в Job Hunter!</b>\n\n"
    "Бот сам ищет вакансии под твои резюме, отсеивает лишнее, оценивает нейросетью и пишет сопроводительные письма. "
    "Резюме может быть несколько — у каждого свои поиск и правила.\n\nСначала пара настроек.",
    "start.welcome_back": "👋 С возвращением!",
    "start.admin": "👋 Ты администратор. Панель — /admin",
    "btn.request": "🙋 Запросить доступ",
    "request.sent": "📨 Заявка отправлена. Как только администратор её одобрит, я напишу.",
    "request.already": "⏳ Заявка уже у администратора — жди ответа.",
    "request.member": "У тебя уже есть доступ — /start",
    "request.approved": "✅ <b>Доступ открыт!</b>",
    "request.rejected": "😕 Заявку на доступ отклонили.",
    # Онбординг: часовой пояс
    "tz.ask": "🕐 <b>Твой часовой пояс</b>\n\nПо нему — тихие часы (карточки без звука ночью), утренняя сводка "
    "и оценка «работа ночью». Выбери или нажми «✏️ Другой».",
    "tz.ask_text": "✏️ Напиши город, пояс или смещение: <code>Бангкок</code>, <code>Asia/Bangkok</code>, "
    "<code>UTC+7</code>, <code>мск+4</code>.",
    "tz.bad": "🤔 Не понял пояс «{text}». Примеры: <code>Asia/Bangkok</code>, <code>UTC+7</code>, <code>мск+4</code>.",
    "tz.saved": "✅ Часовой пояс: <b>{tz}</b>. Поменять — /tz",
    "tz.btn_other": "✏️ Другой",
    "onboarding.done": "🎉 <b>Готово!</b> Теперь резюме.",
    # Резюме (профили)
    "resume.ask": "📄 <b>Пришли резюме</b> одним из способов:\n"
    "• файлом — PDF или DOCX (с hh: «Скачать» → PDF);\n"
    "• ссылкой на резюме hh (если оно открыто всем);\n"
    "• текстом — просто вставь сообщением.\n\n"
    "По нему я соберу черновик настроек: что искать, что отсеивать, как оценивать. Всё можно будет поправить.",
    "resume.reading": "⏳ Читаю резюме и собираю настройки — до минуты…",
    "resume.error": "😕 {error}",
    "resume.too_big": "😕 Файл больше 5 МБ — пришли поменьше или текстом.",
    "resume.short_text": "🤔 Это не похоже на резюме — слишком коротко. Пришли файл, ссылку на hh или полный текст.",
    "resume.created": "✅ Черновик готов. Проверь настройки — и запускай.",
    "resume.limit": "😕 Достигнут лимит резюме: {n}.",
    "menu.resumes": "📄 Резюме",
    "profiles.title": "📄 <b>Твои резюме</b>\n\nУ каждого — свои поиск, фильтр и правила оценки.",
    "profiles.empty": "📄 Резюме пока нет.",
    "profiles.add": "➕ Добавить резюме",
    "status.draft": "черновик",
    "status.active": "работает",
    "status.paused": "на паузе",
    "profile.card": "{emoji} <b>{title}</b> · {status} · v{version}\n<i>{headline}</i>\n\n"
    "🔎 <b>Поиск</b> ({period}, {formats})\n"
    "Роли: {roles}\nВезде в тексте: {anywhere}\nВ названии: {in_name}\n\n"
    "🧹 <b>Фильтр</b> (больше {max_responses} откликов{only_rf})\n{rules}\n\n"
    "🤖 <b>Нейросеть</b>{shadow}\n✅ {apply}\n🤔 {maybe}\n❌ {skip}{cases}\n\n"
    "✉️ Подпись письма: {contact}",
    "profile.only_rf": ", «только из РФ»",
    "profile.shadow_on": " · теневой режим",
    "profile.no_rules": "правил нет",
    "profile.none": "—",
    "profile.days": "{n} дн.",
    "profile.btn_edit": "✏️ Изменить текстом",
    "profile.btn_rules": "🧹 Правила",
    "profile.btn_start": "▶️ Запустить",
    "profile.btn_pause": "⏸ Пауза",
    "profile.btn_shadow_on": "👁 Теневой: вкл",
    "profile.btn_shadow_off": "👁 Теневой: выкл",
    "profile.btn_delete": "🗑 Удалить",
    "profile.btn_list": "‹ К резюме",
    "profile.btn_back": "‹ Назад",
    "profile.started": "▶️ Резюме запущено. Сбор вакансий подключится в следующем обновлении — тогда пойдут карточки.",
    "profile.rules": "🧹 <b>Правила фильтра</b>\n\nНажми, чтобы включить или выключить. Новое правило — «✏️ Изменить текстом»: "
    "например «не брать вакансии с Selenium без Playwright».",
    "profile.delete_confirm": "🗑 Удалить резюме «{title}» со всеми настройками? Это не отменить.",
    "profile.btn_delete_yes": "🗑 Да, удалить",
    "profile.deleted": "Резюме удалено.",
    "profile.not_found": "Резюме не найдено.",
    "edit.ask": "✏️ Напиши, что поменять — обычными словами. Например:\n"
    "• «не брать вакансии с Selenium без Playwright»\n"
    "• «ищи ещё SDET и автотестировщиков»\n"
    "• «гибрид тоже подходит»\n"
    "• «вакансии с Java в автотестах — maybe»\n\n/cancel — отмена.",
    "edit.thinking": "⏳ Думаю над правкой…",
    "edit.question": "🤔 {question}\n\nНапиши иначе или /cancel.",
    "edit.nothing": "🤷 Нейросеть ничего не поменяла. Сформулируй иначе или /cancel.",
    "edit.preview": "✏️ <b>Изменения</b>\n{changes}\n\nПрименить?",
    "edit.btn_apply": "✅ Применить",
    "edit.btn_cancel": "Отмена",
    "edit.applied": "✅ Применено: версия {version}.",
    "edit.cancelled": "Отменено.",
    # Общее
    "unknown": "Не понял. Резюме — /resumes, часовой пояс — /tz. Резюме можно прислать файлом в любой момент.",
    "not_member": "🔒 Нет доступа. Открой ссылку-приглашение или /start",
    "stale": "Это сообщение устарело.",
    "error": "⚠️ Что-то сломалось — администратор уже знает. Попробуй ещё раз позже.",
    "error.admin": "🚨 <b>Ошибка в боте v2</b>\n<code>{kind}</code>: {message}",
    # Админка: уведомления
    "admin.new_request": "🙋 <b>Заявка на доступ</b>\n{who}",
    "admin.request_done": "{status} {who}\nРешил: {admin}",
    "admin.request_taken": "Заявку уже решили.",
    "admin.joined": "🆕 По приглашению #{invite} пришёл {who}",
    "admin.approve": "✅ Пустить",
    "admin.reject": "❌ Отклонить",
    # Админка: панель
    "admin.home": "🛠 <b>Администрирование</b>\n\n"
    "👥 Пользователей: {users} (заблокировано {blocked})\n"
    "📨 Заявок ждёт: {pending}\n"
    "🎟 Активных приглашений: {invites}\n"
    "🌐 Запросов к hh за сутки: {fetches}\n"
    "🚨 Открытых тревог: {alerts}",
    "admin.btn_invites": "🎟 Приглашения",
    "admin.btn_requests": "📨 Заявки ({n})",
    "admin.btn_users": "👥 Пользователи",
    "admin.btn_broadcast": "📢 Рассылка",
    "admin.btn_back": "‹ Назад",
    "admin.btn_close": "✖️ Закрыть",
    "admin.invites": "🎟 <b>Активные приглашения</b>\n\n{list}",
    "admin.invites_empty": "Нет активных приглашений.",
    "admin.invite_line": "#{id} · {used}/{max} · {expires}\n<code>{link}</code>",
    "admin.invite_forever": "бессрочно",
    "admin.invite_until": "до {date}",
    "admin.btn_new_invite": "➕ Создать",
    "admin.btn_revoke": "🗑 #{id}",
    "admin.invite_uses": "Сколько человек пройдут по ссылке?",
    "admin.invite_days": "Сколько дней действует?",
    "admin.invite_forever_btn": "∞",
    "admin.invite_created": "🎟 <b>Приглашение #{id}</b> ({uses} чел., {expires})\n\n<code>{link}</code>\n\n"
    "Перешли ссылку человеку — по ней он сразу попадёт в бота.",
    "admin.revoked": "Приглашение отозвано.",
    "admin.requests": "📨 <b>Заявки</b>\n\n{list}",
    "admin.requests_empty": "Заявок нет.",
    "admin.users": "👥 <b>Пользователи</b> ({total})\n\n{list}",
    "admin.user_line": "{status} {who} · резюме: {profiles}",
    "admin.user": "👤 <b>{who}</b>\n\nid: <code>{tg_id}</code>\nРоль: {role}\nСтатус: {status}\nПояс: {tz}\n"
    "Пришёл: {created}\nОнбординг: {onboarded}\nРезюме: {profiles}",
    "admin.btn_block": "⛔ Заблокировать",
    "admin.btn_unblock": "✅ Разблокировать",
    "admin.blocked_note": "⛔ Доступ к боту закрыт администратором.",
    "admin.unblocked_note": "✅ Доступ к боту снова открыт — /start",
    "admin.broadcast_ask": "📢 Пришли сообщение для рассылки — текст, фото, что угодно. Уйдёт всем активным "
    "пользователям как есть. /cancel — отмена.",
    "admin.broadcast_preview": "👆 Так увидят {n} чел. Отправить?",
    "admin.btn_send": "📤 Отправить",
    "admin.btn_cancel": "Отмена",
    "admin.broadcast_cancelled": "Рассылка отменена.",
    "admin.broadcast_started": "📤 Рассылка пошла…",
    "admin.broadcast_done": "📢 Рассылка: доставлено {ok}, не доставлено {failed}.",
    "admin.only": "Только для администратора.",
    "yes": "да",
    "no": "нет",
}


def t(key: str, **kwargs: object) -> str:
    text = RU[key]
    return text.format(**kwargs) if kwargs else text
