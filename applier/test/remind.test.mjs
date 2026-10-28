// Тесты напоминания об отклике (этап 6.3): можно ли напоминать по топику отклика и по chat_data, разбор ответа на
// отправку, текст. Записи hh — в fixtures/applier (не в git): тесты с ними пропускаются, если файла нет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { REMIND_GROUP, remindFromChat, remindFromTopic, remindTextError, vacancyTopic } from '../src/hh/state.mjs';
import { chatSendResult } from '../src/hh/xhr.mjs';
import { TEXT, chatMessageSel } from '../src/hh/selectors.mjs';

const fixture = (name) => new URL(`../../fixtures/applier/${name}`, import.meta.url);
// Файл записи: «МЕТОД адрес», «status N», пусто, тело запроса, пусто, ответ — JSON ответа с последней строки «{»
const recordedJson = (name) => {
  const text = readFileSync(fixture(name), 'utf8');
  return JSON.parse(text.slice(text.lastIndexOf('\n{') + 1));
};
const TEXT_R = 'Здравствуйте! Напоминаю про свой отклик.';
const NOW = Date.parse('2026-10-28T12:00:00+03:00');
const ago = (days) => new Date(NOW - days * 86400000).toISOString();
const facts = (extra = {}) => ({ archived: false, closed: false, chatWrite: 'ENABLED_AFTER_INVITATION', ...extra });
const topic = (extra = {}) => ({ lastState: 'RESPONSE', viewed: false, declined: false, archived: false, chatArchived: false, inbox: 'AVAILABLE', chatId: '7001', creationTime: ago(5), ...extra });
const outcome = (f, t) => remindFromTopic(f, t, NOW)?.outcome ?? null;

test('remindFromTopic: кому напоминать — по странице вакансии, до открытия чата', () => {
  assert.equal(outcome(facts(), topic()), null, 'ждёт ответа, не просмотрен, 5 дней — открывать чат');
  assert.equal(outcome(facts({ archived: true }), topic()), 'archived');
  assert.equal(outcome(facts({ closed: true }), topic()), 'archived');
  assert.equal(outcome(facts(), null), 'no_topic');
  assert.equal(outcome(facts(), topic({ lastState: 'DISCARD', viewed: true })), 'rejected');
  assert.equal(outcome(facts(), topic({ declined: true })), 'rejected');
  // Статус раньше просмотра: приглашение бывает при viewedByOpponent = false (138505603)
  assert.equal(outcome(facts(), topic({ lastState: 'INTERVIEW' })), 'invited');
  assert.equal(outcome(facts(), topic({ viewed: true })), 'viewed');
  assert.equal(outcome(facts(), topic({ creationTime: ago(2.9) })), 'too_early');
  assert.equal(outcome(facts(), topic({ creationTime: ago(3) })), null, 'ровно 3 дня — уже можно');
  assert.equal(outcome(facts({ chatWrite: 'DISABLED' }), topic()), 'closed');
  assert.equal(outcome(facts(), topic({ inbox: 'DISABLED_BY_EMPLOYER' })), 'closed');
  assert.equal(outcome(facts(), topic({ chatArchived: true })), 'closed');
  assert.equal(outcome(facts(), topic({ chatId: '' })), 'error');
  // Каждый исход — с группой для n8n
  for (const o of ['archived', 'no_topic', 'rejected', 'invited', 'viewed', 'too_early', 'closed', 'error']) assert.ok(REMIND_GROUP[o], o);
});

test('remindFromTopic: страницы вакансий 6.3a (fixtures, если есть)', { skip: !existsSync(fixture('chats-20261028-111316/138802300/state.json')) }, () => {
  const read = (id) => {
    const state = JSON.parse(readFileSync(fixture(`chats-20261028-111316/${id}/state.json`), 'utf8'));
    const t = vacancyTopic(state, id);
    const v = state.vacancyView.vacancyFull.vacancy;
    return remindFromTopic({ archived: false, closed: false, chatWrite: v.chatWritePossibility }, t, Date.parse('2026-10-28T11:15:00Z'))?.outcome ?? null;
  };
  assert.equal(read('138802300'), null, 'кандидат: не просмотрен, «после приглашения», писать можно');
  assert.equal(read('138530778'), 'closed', 'работодатель отключил переписку');
  assert.equal(read('138799176'), 'invited');
  assert.equal(read('138755984'), 'viewed');
});

// chat_data: сообщение отклика (с workflowTransition) и что после него
const chat = (later = [], write = true) => ({
  chat: {
    id: 7001,
    currentParticipantId: 'me',
    writePossibility: { name: write ? 'ENABLED_FOR_ALL' : 'DISABLED_FOR_APPLICANT_BY_VACANCY_SETTINGS', writeDisabledReasons: write ? [] : ['DISABLED_BY_EMPLOYER'] },
    messages: {
      items: [{ id: 1, participantId: 'me', text: 'Письмо', workflowTransition: { applicantState: 'RESPONSE' } }, ...later.map((m, i) => ({ id: 10 + i, ...m }))],
    },
  },
  chatStates: { writeMessageState: { allowed: write, reasons: write ? [] : ['DISABLED_BY_EMPLOYER'] } },
});

test('remindFromChat: уже напомнили, писали сами, работодатель на связи, писать нельзя', () => {
  assert.equal(remindFromChat(chat(), TEXT_R), null, 'только отклик — отправлять');
  assert.equal(remindFromChat(chat([{ participantId: 'hr', text: 'Спасибо за отклик!', participantDisplay: { isBot: true } }]), TEXT_R), null, 'автоответ бота не мешает');
  assert.equal(remindFromChat(chat([{ participantId: 'me', text: ` ${TEXT_R}\n` }]), TEXT_R).outcome, 'already');
  assert.equal(remindFromChat(chat([{ participantId: 'me', text: 'Есть вопрос' }]), TEXT_R).outcome, 'wrote');
  assert.equal(remindFromChat(chat([{ participantId: 'hr', text: 'Здравствуйте!', participantDisplay: { isBot: false } }]), TEXT_R).outcome, 'viewed');
  const closed = remindFromChat(chat([], false), TEXT_R);
  assert.equal(closed.outcome, 'closed');
  assert.match(closed.note, /DISABLED_BY_EMPLOYER/);
  assert.equal(remindFromChat(null, TEXT_R), null, 'chat_data нет — решит разметка');
});

test('remindFromChat: записанные chat_data (fixtures, если есть)', { skip: !existsSync(fixture('record-20261028-112135')) }, () => {
  // 28.10.2026 до отправки: только сообщение отклика, писать можно
  const before = recordedJson('record-20261028-112135/002-xhr-GET-chatik-api-chat-data-chatId-5732907803-applicantId-12143166.txt');
  assert.equal(remindFromChat(before, TEXT_R), null);
  // 10.10.2026: работодатель отключил переписку
  const disabled = recordedJson('record-20261010-181350/049-xhr-GET-chatik-api-chat-data-chatId-5700103809-applicantId-12143166.txt');
  assert.equal(remindFromChat(disabled, TEXT_R).outcome, 'closed');
});

test('chatSendResult: сообщение ушло — id; спам и правила — блок; остальное — ошибка', () => {
  const ok = chatSendResult(200, { id: 16033098677, chatId: 5732907803, text: TEXT_R });
  assert.deepEqual([ok.ok, ok.outcome, ok.messageId, ok.text], [true, 'sent', '16033098677', TEXT_R]);
  assert.deepEqual([chatSendResult(400, { errors: [{ type: 'spamDetected' }] }).outcome, chatSendResult(400, { error: 'resourcePolicyViolation' }).outcome], ['blocked', 'blocked']);
  const bad = chatSendResult(500, {});
  assert.deepEqual([bad.ok, bad.outcome, bad.code], [false, 'error', 'HTTP 500']);
  assert.equal(chatSendResult(200, { enable_dark_theme: false }).code, 'в ответе hh нет сообщения');
  assert.equal(chatSendResult(0, null).code, 'HTTP нет ответа');
});

test('chatSendResult: записанная отправка 28.10.2026 (fixtures, если есть)', { skip: !existsSync(fixture('record-20261028-112135')) }, () => {
  const r = chatSendResult(200, recordedJson('record-20261028-112135/008-xhr-POST-chatik-api-send-hhtmSourceLabel-chat-hhtmSource-chat.txt'));
  assert.deepEqual([r.ok, r.messageId, r.text], [true, '16033098677', TEXT_R]);
  assert.equal(chatMessageSel(r.messageId), '[data-qa~="chatik-chat-message-16033098677"]');
});

test('remindTextError: текст напоминания — непустой, до 500 знаков, без ссылок', () => {
  assert.equal(remindTextError(TEXT_R), '');
  assert.match(remindTextError('  '), /нужен text/);
  assert.match(remindTextError('а'.repeat(501)), /500/);
  assert.match(remindTextError('Портфолио: https://example.com'), /ссылки/);
});

test('TEXT.chatClosed и TEXT.stop: предупреждения и ошибки чата на обоих языках', () => {
  for (const s of ['Работодатель отключил переписку по данной вакансии', 'The employer has turned off the chat for this vacancy', 'You have sent 5 messages in a row. Wait for a response to write more', 'Переписка будет доступна после приглашения работодателя']) {
    assert.ok(TEXT.chatClosed.test(s), s);
  }
  for (const s of ['Недопустимое сообщение', 'Inappropriate message', 'Failed to send — violation of the service rules']) assert.ok(TEXT.stop.test(s), s);
  assert.ok(!TEXT.chatClosed.test('Здравствуйте! Напоминаю про свой отклик.'));
});
