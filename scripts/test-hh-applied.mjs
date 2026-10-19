// Сверка с «Откликами» hh (запуск — node --test scripts/test-hh-applied.mjs): node scripts/n8n-api.mjs hh-applied,
// логика — scripts/lib/hh-applied.mjs. Сеть и n8n не нужны.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TARGET, appliedUpdate, cardRenderer, normTitle, planHhApplied } from './lib/hh-applied.mjs';

const topic = (vacancyId, extra = {}) => ({
  topicId: `t${vacancyId}`,
  vacancyId: String(vacancyId),
  creationTime: '2026-10-08T16:36:39.383+03:00',
  name: '',
  companyId: '',
  ...extra,
});
const row = (id, external_id, status, extra = {}) => ({ id, source: 'hh', external_id: String(external_id), dup_key: `hh:id:${external_id}`, status, title: `T${id}`, ...extra });

test('план: совпадение по id — во всех статусах «без отклика»; applied, archived, scoring — мимо', () => {
  const statuses = [...TARGET, 'applied', 'archived', 'scoring'];
  const rows = statuses.map((status, i) => row(i + 1, 100 + i, status));
  const topics = rows.map((r) => topic(r.external_id));
  const plan = planHhApplied({ rows, topics });
  assert.deepEqual(plan.mark.map((h) => h.row.status), TARGET);
  assert.ok(plan.mark.every((h) => h.by === 'id'));
  assert.deepEqual([plan.dups.length, plan.rejected.length, plan.busy.length], [0, 0, 0]);
});

test('план: нет отклика — ничего; отсеянная фильтром — только в отчёт; робот или письмо в работе — не трогаем', () => {
  const rows = [
    row(1, 501, 'waiting'),
    row(2, 502, 'rejected'),
    row(3, 503, 'approved', { apply_state: 'queued' }),
    row(4, 504, 'approved', { letter_lock: '2026-10-20T10:00:00Z' }),
    row(5, 505, 'waiting', { apply_state: '' }),
  ];
  const plan = planHhApplied({ rows, topics: [502, 503, 504, 505].map((id) => topic(id)) });
  assert.deepEqual(plan.mark.map((h) => h.row.id), [5]);
  assert.deepEqual(plan.rejected.map((h) => h.row.id), [2]);
  assert.deepEqual(plan.busy.map((h) => h.row.id), [3, 4]);
});

test('план: отклик на копию в другом регионе — по dup_key (компания + название, как W1), отдельно от точных', () => {
  const rows = [row(1, 601, 'waiting', { dup_key: `hh:42:${normTitle('Senior Frontend-разработчик (React)')}` }), row(2, 602, 'waiting', { source: 'habr' })];
  const plan = planHhApplied({ rows, topics: [topic(999, { companyId: '42', name: 'Senior Frontend-разработчик (React)' }), topic(602)] });
  assert.equal(plan.mark.length, 0);
  assert.deepEqual(plan.dups.map((h) => [h.row.id, h.by, h.topic.vacancyId]), [[1, 'dup', '999']]);
  assert.equal(normTitle('Фронтенд-разработчик (React/Next.js)'), 'фронтенд разработчик react next js');
  // Та же нормализация, что у W1 «Parse search» — иначе dup_key не совпадут
  const w1 = readFileSync(new URL('../n8n/w1-collector/parse-search.js', import.meta.url), 'utf8');
  for (const part of [".replace(/ё/g, 'е')", ".replace(/[^a-zа-я0-9+#]+/g, ' ')", "dup_key: companyId ? `hh:${companyId}:${normTitle(v.name)}`"]) {
    assert.ok(w1.includes(part), part);
  }
});

test('запись — как у робота при «уже откликались»: решение пользователя не трогаем, дата — с hh, своя дата остаётся', () => {
  assert.deepEqual(appliedUpdate({ my_decision: 'skip' }, topic(1)), {
    status: 'applied',
    apply_by: 'hh',
    apply_result: 'already',
    applied_at: '2026-10-08T13:36:39.383Z',
  });
  assert.equal('applied_at' in appliedUpdate({ applied_at: '2026-10-01T00:00:00.000Z' }, topic(1)), false);
  assert.equal('applied_at' in appliedUpdate({}, topic(1, { creationTime: null })), false);
});

test('карточка без кнопок: «📨 Отклик есть на hh» с датой в поясе человека', () => {
  const cardText = cardRenderer([{ name: 'profile.tz', value_json: JSON.stringify('Asia/Bangkok') }]);
  const text = cardText({
    title: 'Senior Frontend',
    url: 'https://hh.ru/vacancy/1',
    company: 'Рога & копыта',
    decision: 'apply',
    ...appliedUpdate({}, topic(1, { creationTime: '2026-10-08T22:30:00.000+03:00' })),
  });
  assert.match(text, /📨 Отклик есть на hh 09\.10/);
  assert.match(text, /Рога &amp; копыта/);
  assert.doesNotMatch(text, /👤/);
});
