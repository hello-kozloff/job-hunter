// W5 · Parse letter — ответ нейросети → текст письма.
// Нода: Code, режим «Run Once for All Items».
// Вход: ответы HTTP Request «Gemini» или «Claude» по порядку items «Build letter» (в запуске один провайдер),
//       прошлое письмо — из «Vacancy» (строка до записи нового).
// Выход: { id, mode, ok, letter | problem, same? } для «Format letter».
// Контакт и подпись — из профиля (⚙️ → 👤, 13.10.2026): если модель их пропустила, дописываем.
// same (14.10.2026) — нейросеть повторилась: правка вернула то же письмо (revise) или «🔄» почти как прошлый вариант
// (redo). Письмо всё равно уходит — на сообщение «⚠️ не получилось» правкой не ответить (W3 ищет письмо по
// tg_letter_id), — под ним предупреждение (n8n/shared/letter.js).

// @include n8n/shared/settings.js

const prompts = $('Build letter').all().map((i) => i.json);
const rows = new Map($('Vacancy').all().map((i) => [i.json.id, i.json]));
const settings = loadSettings($('Settings').all());
const CONTACT = settings['profile.contact'];
const SIGNATURE = settings['profile.signature'];
const COMPANIES = settings['profile.facts'].companies ?? [];
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Контакт уже есть в письме, если там есть его «ключ»: @ник, e-mail или телефон из строки контакта
const contactKey = (CONTACT.match(/[\w.+-]+@[\w-]+\.[\w.-]+|@\w+|\+?\d[\d\s()-]{6,}\d/) ?? [CONTACT])[0];
const signatureEnd = new RegExp(`${escapeRe(SIGNATURE)}\\s*$`);

function bodyOf(res) {
  const b = res.body ?? res.data;
  if (typeof b !== 'string') return b ?? {};
  try {
    return JSON.parse(b);
  } catch {
    return { raw: b.slice(0, 300) };
  }
}

// Навык, о котором кандидат пишет сам («я знаю PHP», said из «Build letter»), — не «готов быстро погрузиться»:
// предложение убираем целиком (14.10.2026: Flash-Lite через раз оставлял его из прошлого письма)
const knows = (sentence, skill) =>
  new RegExp(`(^|[^a-zа-яё0-9])${escapeRe(skill.toLowerCase())}([^a-zа-яё0-9]|$)`).test(sentence.toLowerCase());
const dropReady = (text, said) =>
  said?.length
    ? text.replace(/[^.!?\n]*(погрузиться|разобраться) в [^.!?\n]*[.!?]/gi, (sentence) =>
        said.some((skill) => knows(sentence, skill)) ? '' : sentence,
      )
    : text;

// Новое письмо и «🔄» приходят тремя абзацами (first, second, closing; build-letter.js) — склеиваем, приветствие
// ставит код. Правка — письмо целиком (letter)
function letterOf(answer) {
  if (typeof answer.letter === 'string') return answer.letter;
  const parts = [answer.first, answer.second, answer.closing].map((part) => String(part ?? '').trim()).filter(Boolean);
  return parts.length ? `Здравствуйте!\n\n${parts.join('\n\n').replace(/^Здравствуйте!?\s*/i, '')}` : '';
}

function answerText(provider, b) {
  if (provider === 'claude') {
    if (b.stop_reason === 'refusal') return { problem: 'модель отказалась отвечать' };
    if (b.stop_reason === 'max_tokens') return { problem: 'ответ обрезан по max_tokens' };
    return { text: (b.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('') };
  }
  const cand = b.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  return text ? { text } : { problem: `пустой ответ (${cand?.finishReason ?? b.promptFeedback?.blockReason ?? 'нет кандидатов'})` };
}

// Штампы, которые Flash-Lite пропускает несмотря на запрет в промпте: чиним кодом, смысл не меняется
const CLEANUP = [
  [/,?\s+а также\s+/gi, ' и '],
  [/(^|[.!?]\s+|\n)Также,?\s+/g, '$1'],
  [/\s+с использованием\s+/gi, ' на '],
  [/([Вв]) работе использую\s+/g, '$1 работе пишу на '],
  [/[ \t]*(высоконагруженн|масштабируем)(ых|ые|ый|ого|ым|ой|ую|ая|ое)(?=\s)/gi, ''],
  [/[ \t]*успешно(?=\s)/gi, ''],
  // «Git использую в каждом проекте», «использовал Git для веток» — пустая фраза для senior: убираем предложение целиком
  // (\b в JS работает только с латиницей — перед русскими словами его нет)
  [/(^|(?<=[.!?])[ \t]+)[^.!?\n]*(\bGit\b[^.!?\n]*(использую|пользуюсь|работаю)|(использую|пользуюсь|использовала?|применяла?|работала? с)[^.!?\n]*\bGit\b)[^.!?\n]*[.!?]/gm, ''],
  // «UI-компонентах.js» — сбой Flash-Lite (14.10.2026): «.js» после русского слова не бывает
  [/(?<=[а-яё])\.js(?![a-z])/gi, ''],
  // «в компании Руб Икс» → «в Руб Икс» (14.10.2026: Flash-Lite пишет так через раз)
  ...COMPANIES.map((c) => [new RegExp(`([Вв]) компании (${escapeRe(c)})`, 'g'), '$1 $2']),
  // после вырезания слова в начале строки остаётся пробел
  [/\n[ \t]+/g, '\n'],
  [/^[ \t]+/, ''],
];
// После вырезания слова в начале предложения — заглавная буква
const capitalize = (text) => text.replace(/(^|[.!?]\s+|\n)([а-яёa-z])/g, (m, before, c) => before + c.toUpperCase());

// Контакт и подпись — всегда в конце, даже если модель их пропустила.
// Типографика нейросети → как печатают с клавиатуры: тире → дефис, «ёлочки» → прямые кавычки, «…» → «...»
function finish(letter) {
  let text = String(letter ?? '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/(\d)\s*[—–]\s*(\d)/g, '$1-$2')
    .replace(/[ \t]+[—–][ \t]+/g, ' - ')
    .replace(/[—–]/g, '-')
    .replace(/[«»]/g, '"')
    .replace(/…/g, '...')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  text = capitalize(CLEANUP.reduce((t, [pattern, replacement]) => t.replace(pattern, replacement), text))
    // Приветствие — отдельной строкой, даже если модель продолжила текст на той же строке
    .replace(/^Здравствуйте!\s*/, 'Здравствуйте!\n\n');
  // Контакт и подпись — всегда отдельными строками в конце (14.10.2026: модель приклеивала контакт к последнему
  // абзацу). Убираем их из текста, где бы модель их ни написала, и ставим заново
  if (CONTACT) {
    const keyAt = text.indexOf(contactKey);
    if (keyAt >= 0) {
      const lineStart = text.lastIndexOf('\n', keyAt) + 1;
      const before = text.slice(lineStart, keyAt);
      // Строка контакта — от начала её фразы («Для быстрой связи…») до конца строки
      const sentenceAt = Math.max(before.search(/[^.!?]*$/), 0);
      text = (text.slice(0, lineStart + sentenceAt) + text.slice(text.indexOf('\n', keyAt) < 0 ? text.length : text.indexOf('\n', keyAt))).replace(/[ \t]+$/gm, '');
    }
  }
  if (SIGNATURE) text = text.replace(signatureEnd, '');
  text = text.replace(/\s+$/, '');
  if (CONTACT) text += `\n\n${CONTACT}`;
  if (SIGNATURE) text += CONTACT ? `\n${SIGNATURE}` : `\n\n${SIGNATURE}`;
  return text;
}

// Повтор: тексты без контакта и подписи; правка — слово в слово, «🔄» — доля общих троек слов (было 0.57–1.00,
// с новым промптом 0.07–0.29)
const core = (text) => (CONTACT ? String(text ?? '').split(CONTACT)[0] : String(text ?? ''));
const words = (text) => core(text).toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9+#]+/g) ?? [];
function overlap(a, b) {
  const grams = (text) => {
    const w = words(text);
    return new Set(w.slice(2).map((_, i) => w.slice(i, i + 3).join(' ')));
  };
  const [A, B] = [grams(a), grams(b)];
  if (!A.size || !B.size) return 0;
  return [...A].filter((g) => B.has(g)).length / Math.min(A.size, B.size);
}
function sameAs(mode, before, after) {
  if (!before) return '';
  if (mode === 'revise') return words(before).join(' ') === words(after).join(' ') ? 'revise' : '';
  if (mode === 'redo') return overlap(before, after) >= 0.8 ? 'redo' : '';
  return '';
}

return $input.all().map((item, i) => {
  const prompt = prompts[i];
  const res = item.json;
  const base = { id: prompt.id, mode: prompt.mode };
  if (res.statusCode === undefined) return { json: { ...base, ok: false, problem: `сеть: ${String(res.error?.message ?? res.error ?? 'нет ответа').slice(0, 200)}` } };
  const b = bodyOf(res);
  if (res.statusCode === 429) return { json: { ...base, ok: false, problem: 'лимит запросов к нейросети (429), попробуй через минуту' } };
  if (res.statusCode !== 200) return { json: { ...base, ok: false, problem: `HTTP ${res.statusCode}: ${String(b?.error?.message ?? b?.raw ?? '').slice(0, 200)}` } };
  const { text, problem } = answerText(prompt.provider, b);
  if (problem) return { json: { ...base, ok: false, problem } };
  try {
    const letter = letterOf(JSON.parse(text));
    if (!String(letter ?? '').trim()) throw new Error('пустое письмо');
    const clean = finish(dropReady(letter, prompt.said));
    const same = sameAs(prompt.mode, rows.get(prompt.id)?.letter, clean);
    return { json: { ...base, ok: true, letter: clean, ...(same && { same }) } };
  } catch (e) {
    return { json: { ...base, ok: false, problem: `ответ не по схеме: ${e.message}`.slice(0, 200) } };
  }
});
