// Сверка с «Откликами» hh (20.10.2026, docs/hh-applied.md): какие вакансии без отклика в таблице на самом деле уже с
// откликом на hh. Команда — node scripts/n8n-api.mjs hh-applied <topics.json> [--dry] [--dup]; здесь — логика без сети
// и без n8n. topics.json пишет робот: node scripts/applier.mjs recon --negotiations (applier/src/flows/recon.mjs).
import { join } from 'node:path';
import { readCode } from './code.mjs';
import { ROOT, accessor } from './sandbox.mjs';

// Статусы «отклика нет»: карточки без решения W6 переводит в expired, хвост сборов — new / detailed (иначе пришлёт
// карточку на вакансию с откликом). scoring — W2 оценивает прямо сейчас: не трогаем
export const TARGET = ['waiting', 'approved', 'maybe', 'skipped', 'expired', 'new', 'detailed'];

// Название для dup_key — как у W1 «Parse search» (n8n/w1-collector/parse-search.js → normTitle)
export const normTitle = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9+#]+/g, ' ')
    .trim();

// rows — строки vacancies, topics — отклики hh. Совпадение по id вакансии — mark; только по компании и названию
// (dup_key: отклик на копию вакансии в другом регионе — или новая вакансия с тем же названием) — dups;
// отсеянные фильтром — rejected (только для сведения); робот или письмо в работе — busy
export function planHhApplied({ rows, topics }) {
  const byId = new Map(topics.map((t) => [String(t.vacancyId), t]));
  const byDup = new Map(topics.filter((t) => t.companyId && t.name).map((t) => [`hh:${t.companyId}:${normTitle(t.name)}`, t]));
  const plan = { mark: [], dups: [], rejected: [], busy: [] };
  for (const row of rows) {
    if (row.source && row.source !== 'hh') continue;
    const exact = byId.get(String(row.external_id));
    const topic = exact ?? byDup.get(row.dup_key);
    if (!topic) continue;
    const hit = { row, topic, by: exact ? 'id' : 'dup' };
    if (row.status === 'rejected') plan.rejected.push(hit);
    else if (!TARGET.includes(row.status)) continue;
    else if (row.apply_state || row.letter_lock) plan.busy.push(hit);
    else plan[exact ? 'mark' : 'dups'].push(hit);
  }
  return plan;
}

// Что записать в строку — как робот при «уже откликались» (n8n/w9-robot/result.js): status = applied, apply_by = hh;
// решение пользователя (my_decision) не трогаем. Дата — когда откликнулся на hh; неизвестна — без даты
export function appliedUpdate(row, topic) {
  const at = Date.parse(topic.creationTime ?? '');
  return {
    status: 'applied',
    apply_by: 'hh',
    apply_result: 'already',
    ...(!row.applied_at && Number.isFinite(at) && { applied_at: new Date(at).toISOString() }),
  };
}

// Текст карточки — тот же код, что в n8n (n8n/shared/time.js + card.js): пояс человека — из строк settings (profile.tz)
export function cardRenderer(settingsRows, env = {}) {
  const code = ['n8n/shared/time.js', 'n8n/shared/card.js'].map((file) => readCode(join(ROOT, file))).join('\n');
  const $ = (name) => {
    if (name !== 'Settings') throw new Error(`нет данных для ${name}`);
    return accessor(settingsRows.map((json) => ({ json })));
  };
  return new Function('$', '$env', `${code}\nreturn cardText;`)($, env);
}
