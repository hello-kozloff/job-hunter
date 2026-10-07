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
    "onboarding.done": "🎉 <b>Готово!</b>\n\nСледующий шаг — резюме: добавишь его ссылкой hh, файлом или текстом. "
    "Эта часть появится в ближайшем обновлении — я напишу.",
    # Общее
    "unknown": "Не понял. Команды: /start, /tz",
    "not_member": "🔒 Нет доступа. Открой ссылку-приглашение или /start",
    "stale": "Это сообщение устарело.",
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
