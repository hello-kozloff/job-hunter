// W5 · Parse letter — ответ нейросети → текст письма.
// Нода: Code, режим «Run Once for All Items».
// Вход: ответы HTTP Request «Gemini» или «Claude» по порядку items «Build letter» (в запуске один провайдер).
// Выход: { id, mode, ok, letter | problem } для «Format letter».

const prompts = $('Build letter').all().map((i) => i.json);
const CONTACT = 'Для быстрой связи тг: @freshraveprince';

function bodyOf(res) {
  const b = res.body ?? res.data;
  if (typeof b !== 'string') return b ?? {};
  try {
    return JSON.parse(b);
  } catch {
    return { raw: b.slice(0, 300) };
  }
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

// Контакт и подпись — всегда в конце, даже если модель их пропустила
function finish(letter) {
  let text = String(letter ?? '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text.includes('@freshraveprince')) text += `\n\n${CONTACT}`;
  if (!/Никита\s*$/.test(text)) text += '\nНикита';
  return text;
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
    const letter = JSON.parse(text).letter;
    if (!String(letter ?? '').trim()) throw new Error('пустое письмо');
    return { json: { ...base, ok: true, letter: finish(letter) } };
  } catch (e) {
    return { json: { ...base, ok: false, problem: `ответ не по схеме: ${e.message}`.slice(0, 200) } };
  }
});
