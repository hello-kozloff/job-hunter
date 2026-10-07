// Меню бота: кнопки под полем ввода и вкладки списка вакансий (решения пользователя 07.10.2026).
// Общий код W3 «Route» и W7 «Render»: строка «// @include n8n/shared/menu.js».
//
// callback_data кнопок панели (Telegram — не длиннее 64 байт):
//   p:l:<tab>:<page>  — список: вкладка и страница;   p:s — статистика;   p:x — неактивная кнопка
//   p:n — новая панель со списком там, где был (кнопка «📋 К вакансиям» под отправленным письмом)
//   pv:<id>:<apply|maybe|skip|earlier|edit>:<tab>:<page> — решение в карточке на панели: W3 правит исходную карточку
//   в ленте, потом W7 перерисовывает панель. <tab>:<page> — куда вернёт «⬅️ К списку».

// Кнопки под полем ввода: Telegram присылает их текст обычным сообщением
const MENU = { list: '📋 Вакансии', stats: '📊 Статистика' };

// Вкладки списка: статусы строк (statuses = null — всё, кроме бэкфилла seen), порядок кнопок — порядок ключей
const TABS = {
  wait: { icon: '⏳', name: 'Ждут решения', statuses: ['waiting'] },
  todo: { icon: '✅', name: 'Откликнусь и 🤔', statuses: ['approved', 'maybe'] },
  sent: { icon: '📨', name: 'Отправлено', statuses: ['applied'] },
  skip: { icon: '❌', name: 'Мимо и устаревшие', statuses: ['skipped', 'expired', 'archived'] },
  rej: { icon: '🚫', name: 'Отсеяно фильтром', statuses: ['rejected'] },
  all: { icon: '📋', name: 'Все', statuses: null },
};

// Значки строки списка: решение нейросети + статус
const VERDICT_ICON = { apply: '🟢', maybe: '🟡', skip: '🔴', error: '⚠️' };
const STATUS_ICON = {
  new: '⚙️',
  detailed: '⚙️',
  scoring: '⚙️',
  waiting: '⏳',
  approved: '✅',
  maybe: '🤔',
  skipped: '❌',
  applied: '📨',
  expired: '⌛',
  archived: '🔒',
  rejected: '🚫',
};
