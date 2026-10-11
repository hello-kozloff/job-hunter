// Тесты разбора ответов hh на действия живого отклика (src/hh/xhr.mjs) и адресов предохранителя.
// Записанные ответы лежат в fixtures/applier/record-… (не в git: там письмо и токены) — тесты с ними пропускаются.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import {
  chatResult,
  errorCode,
  letterResult,
  multipartField,
  respondResult,
  sameText,
  screenText,
} from '../src/hh/xhr.mjs';
import { ACTION_URL, CHAT_FRAME, GUARD_ALLOW, GUARD_URL, HH_PAGE } from '../src/hh/selectors.mjs';
import { GROUP } from '../src/hh/state.mjs';

const RECORD = new URL('../../fixtures/applier/record-20261010-181350/', import.meta.url);
// Файл записи: «МЕТОД адрес», «status N», пусто, тело запроса (multipart — с пустыми строками), пусто, ответ
function recorded(prefix) {
  const name = readdirSync(RECORD).find((f) => f.startsWith(prefix));
  const text = readFileSync(new URL(name, RECORD), 'utf8');
  const lines = text.split('\n');
  const status = Number(lines[1].replace('status ', ''));
  const rest = lines.slice(3).join('\n');
  const i = rest.lastIndexOf('\n{');
  const bodyText = i >= 0 ? rest.slice(i + 1) : '';
  let body = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = null;
  }
  return { url: lines[0].split(' ')[1], status, post: i >= 0 ? rest.slice(0, i) : rest, body };
}

const multipart = (fields) =>
  Object.entries(fields)
    .map(([k, v]) => `------B\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
    .join('') + '------B--\r\n';

test('respondResult: окно с письмом — успех, письмо ушло с откликом, hh подтвердил', () => {
  const r = respondResult(200, {
    success: 'true',
    topic_id: '701',
    chat_id: '702',
    response_label: 'nonreq-letter-no-test-with-letter',
    responseStatus: { alreadyApplied: true, usedResumeIds: [101] },
  });
  assert.equal(r.ok, true);
  assert.equal(r.outcome, 'applied');
  assert.equal(r.letter, 'attached');
  assert.equal(r.confirmed, true);
  assert.equal(r.topicId, '701');
});

test('respondResult: отклик в один клик — успех без письма', () => {
  const r = respondResult(200, { success: 'true', response_label: 'nonreq-letter-no-test-without-letter', responseStatus: {} });
  assert.equal(r.ok, true);
  assert.equal(r.letter, 'none');
  assert.equal(r.confirmed, false);
});

test('respondResult: без response_label письмо — по полю letter запроса', () => {
  assert.equal(respondResult(200, { success: 'true' }, multipart({ letter: 'Здравствуйте!' })).letter, 'attached');
  assert.equal(respondResult(200, { success: 'true' }, multipart({ letter: '' })).letter, 'none');
  assert.equal(respondResult(200, { success: 'true' }, '').letter, 'none');
});

test('respondResult: коды ошибок hh → исходы, неизвестный код и пустой ответ → error', () => {
  assert.equal(respondResult(400, { error: 'negotiationsLimitExceeded' }).outcome, 'limit');
  assert.equal(respondResult(400, { errors: [{ type: 'spamDetected' }] }).outcome, 'blocked');
  assert.equal(respondResult(403, { error: 'resourcePolicyViolation' }).outcome, 'blocked');
  assert.equal(respondResult(409, { error: 'alreadyApplied.error' }).outcome, 'already');
  assert.equal(respondResult(400, { code: 'changeResumeVisibilityDenied' }).outcome, 'hidden');
  assert.equal(respondResult(400, { error: 'somethingNew' }).outcome, 'error');
  assert.equal(respondResult(0, null).outcome, 'error');
  // success не "true" при 200 — не успех
  assert.equal(respondResult(200, { success: 'false' }).ok, false);
  for (const outcome of ['limit', 'blocked', 'already', 'hidden', 'test', 'error']) assert.ok(GROUP[outcome], outcome);
});

test('errorCode терпим к форме ответа', () => {
  assert.equal(errorCode({ error: ' testServiceDown.error ' }), 'testServiceDown');
  assert.equal(errorCode({ errors: ['tooLongLetter'] }), 'tooLongLetter');
  assert.equal(errorCode({ errors: [{ value: 'unknown' }] }), 'unknown');
  assert.equal(errorCode({ success: 'true' }), '');
  assert.equal(errorCode('oops'), '');
});

test('letterResult и chatResult: 403 notEditable — не приложено; 2xx — да', () => {
  assert.deepEqual(letterResult(403, { error: 'notEditable' }), { ok: false, code: 'notEditable' });
  assert.deepEqual(letterResult(200, {}), { ok: true, code: '' });
  assert.deepEqual(letterResult(200, { error: 'x' }), { ok: false, code: 'x' });
  assert.deepEqual(letterResult(0, null), { ok: false, code: 'HTTP нет ответа' });
  assert.equal(chatResult(200).ok, true);
  assert.equal(chatResult(500).ok, false);
  assert.equal(chatResult(0).code, 'HTTP нет ответа');
});

test('screenText: считается только новый текст после клика', () => {
  const limit = 'В течение 24 часов можно совершить не более 200 откликов. Вы исчерпали лимит откликов';
  assert.deepEqual(screenText(`Вакансия… ${limit}`, 'Вакансия…'), { outcome: 'limit', text: 'не более 200 откликов' });
  // те же слова были в описании до клика — не исход
  assert.equal(screenText(`Описание: Произошла ошибка в ТЗ`, 'Описание: Произошла ошибка в ТЗ'), null);
  assert.equal(screenText('Не отправилось — нарушает правила сервиса', '').outcome, 'blocked');
  assert.equal(screenText('Вы откликнулись', '').outcome, 'responded');
  assert.equal(screenText('Обычная страница', ''), null);
});

test('sameText: переводы строк и края не важны', () => {
  assert.ok(sameText('Привет\r\n\r\nНикита ', 'Привет\n\nНикита'));
  assert.ok(!sameText('Привет', 'Привет!'));
});

test('multipartField достаёт поле формы', () => {
  const body = multipart({ _xsrf: 'x', letter: 'Строка 1\r\n\r\nСтрока 2', lux: 'true' });
  assert.equal(multipartField(body, 'letter'), 'Строка 1\r\n\r\nСтрока 2');
  assert.equal(multipartField(body, 'lux'), 'true');
  assert.equal(multipartField(body, 'nope'), '');
});

test('предохранитель: каждое действие открывает только свои адреса', () => {
  const popup = 'https://hh.ru/applicant/vacancy_response/popup';
  const edit = 'https://spb.hh.ru/applicant/vacancy_response/edit_ajax';
  const save = 'https://chatik.hh.ru/chatik/api/save';
  const opened = 'https://chatik.hh.ru/chatik/api/notify_chat_opened';
  const allows = (name, url) => GUARD_ALLOW[name].some((re) => re.test(url));
  assert.ok(allows('respond', popup) && !allows('respond', edit) && !allows('respond', save));
  assert.ok(allows('letter', edit) && !allows('letter', popup));
  assert.ok(allows('chat', save) && allows('chat', opened) && !allows('chat', 'https://chatik.hh.ru/chatik/api/mark_read'));
  // всё, что открывают действия, предохранитель вообще перехватывает
  for (const url of [popup, edit, save, opened]) assert.ok(GUARD_URL.test(url), url);
  assert.ok(!ACTION_URL.respond.test('https://hh.ru/applicant/vacancy_response/popupx'));
  assert.ok(CHAT_FRAME.test('https://chatik.hh.ru/chat/702?without_list=1'));
  assert.ok(HH_PAGE.test('https://hh.ru/vacancy/1') && HH_PAGE.test('https://spb.hh.ru') && !HH_PAGE.test('https://evilhh.ru/'));
});

test('запись 10.10.2026: отклик с письмом, в один клик, письмо через edit_ajax и чат', { skip: !existsSync(RECORD) }, () => {
  const modal = recorded('006-xhr-POST');
  assert.ok(ACTION_URL.respond.test(modal.url));
  const m = respondResult(modal.status, modal.body, modal.post);
  assert.equal(m.ok, true);
  assert.equal(m.letter, 'attached');
  assert.equal(m.confirmed, true);
  assert.ok(multipartField(modal.post, 'letter').trim().length > 0, 'письмо в запросе отклика');

  const quick = recorded('025-xhr-POST');
  const q = respondResult(quick.status, quick.body, quick.post);
  assert.equal(q.ok, true);
  assert.equal(q.letter, 'none');
  assert.equal(multipartField(quick.post, 'letter'), '', 'у отклика в один клик поля letter нет');

  const edit = recorded('040-xhr-POST');
  assert.ok(ACTION_URL.letter.test(edit.url));
  assert.deepEqual(letterResult(edit.status, edit.body), { ok: false, code: 'notEditable' });

  const save = recorded('052-xhr-POST');
  assert.ok(ACTION_URL.chat.test(save.url));
  assert.equal(chatResult(save.status).ok, true);
});
