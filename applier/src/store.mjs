// Состояние робота, которое должно пережить рестарт контейнера: блок (капча, выход из hh, лимит hh, сбои подряд)
// и счётчики «дня» робота. Файл /data/state.json, запись атомарная. Очередь и статусы вакансий — в n8n (W9).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.mjs';
import { log } from './log.mjs';
import { robotDayStart, writeJsonAtomic } from './util.mjs';

const PATH = join(config.dataDir, 'state.json');
const EMPTY = { blocked: null, day: null, lastApplyAt: null, lastInboxAt: null, notices: {} };
let state = null;

function load() {
  if (state) return state;
  try {
    state = { ...EMPTY, ...JSON.parse(readFileSync(PATH, 'utf8')) };
  } catch {
    state = { ...EMPTY };
  }
  return state;
}

function save() {
  try {
    writeJsonAtomic(PATH, state);
  } catch (e) {
    log('store.error', { error: e.message });
  }
}

// Счётчики текущего «дня» робота (с 09:00 по Таиланду): живые отклики, сбои, сбои подряд
function day() {
  const s = load();
  const start = robotDayStart().toISOString();
  if (s.day?.start !== start) s.day = { start, applied: 0, errors: 0, streak: 0 };
  return s.day;
}

export const store = {
  get blocked() {
    const b = load().blocked;
    // Блок «до времени» (лимит hh) снимается сам
    if (b?.until && Date.parse(b.until) <= Date.now()) {
      state.blocked = null;
      save();
      log('block.expired', { kind: b.kind });
      return null;
    }
    return b;
  },
  // Блок: все действия, кроме проверки и снятия, отвечают 423. since — по нему n8n шлёт одну тревогу на блок
  block(kind, fields = {}) {
    const s = load();
    if (s.blocked?.kind === kind) return s.blocked;
    s.blocked = { kind, since: new Date().toISOString(), ...fields };
    save();
    log('block', { kind, ...fields });
    return s.blocked;
  },
  // Поправить поля текущего блока, не меняя since (новая картинка капчи: тревога уже ушла, фото шлёт W9 сам)
  amend(fields) {
    const s = load();
    if (!s.blocked) return null;
    Object.assign(s.blocked, fields);
    save();
    return s.blocked;
  },
  unblock(reason) {
    const s = load();
    if (!s.blocked) return;
    log('unblock', { kind: s.blocked.kind, reason });
    s.blocked = null;
    save();
  },
  today() {
    return { ...day() };
  },
  countApplied() {
    const d = day();
    d.applied++;
    d.streak = 0;
    state.lastApplyAt = new Date().toISOString();
    save();
  },
  countError() {
    const d = day();
    d.errors++;
    d.streak++;
    save();
    return d.streak;
  },
  resetStreak() {
    const d = day();
    if (d.streak) {
      d.streak = 0;
      save();
    }
  },
  // Сообщение с ключом key уже отправляли? Первый спросивший получает true, остальные — false. n8n запускает W9
  // параллельно (расписание раз в минуту + вызов себя), static data n8n не атомарна — одна тревога на блок решается
  // здесь: сервис один и однопоточный. Ключи старше 3 суток забываются
  ackNotice(key) {
    const s = load();
    s.notices ??= {};
    if (s.notices[key]) return false;
    const old = Date.now() - 3 * 24 * 3600 * 1000;
    for (const [k, at] of Object.entries(s.notices)) if (Date.parse(at) < old) delete s.notices[k];
    s.notices[key] = new Date().toISOString();
    save();
    return true;
  },
  markInbox() {
    load().lastInboxAt = new Date().toISOString();
    save();
  },
  get lastApplyAt() {
    return load().lastApplyAt;
  },
  get lastInboxAt() {
    return load().lastInboxAt;
  },
};

// Последний результат /apply по вакансии — в памяти на сутки: n8n повторил запрос после обрыва связи
// (деплой, сон Mac) → отдаём уже известный исход, а не откликаемся заново
const results = new Map();
export function rememberResult(vacancyId, result) {
  results.set(String(vacancyId), { at: Date.now(), result });
  for (const [id, r] of results) if (Date.now() - r.at > 24 * 3600 * 1000) results.delete(id);
}
export function recallResult(vacancyId) {
  const r = results.get(String(vacancyId));
  return r && Date.now() - r.at < 24 * 3600 * 1000 ? r.result : null;
}
