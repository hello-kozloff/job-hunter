// Журнал JSON-строками в stdout (docker compose logs claude-cli). Тексты промптов и ответов не пишем — только
// задачу, модель, исход, время и токены
export function log(event, fields = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
}
