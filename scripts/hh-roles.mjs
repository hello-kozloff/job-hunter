#!/usr/bin/env node
// Справочник профессиональных ролей hh.ru (параметр поиска professional_role) → n8n/shared/hh-roles.js.
// Источник — professionalRoleTree из InitialState любой сохранённой страницы поиска hh:
//
//   node scripts/hh-roles.mjs fixtures/search-p0.html
//
// Нужен онбордингу (нейросеть выбирает роли из списка), сообщению о сборе и ⚙️ → 🔎 Поиск (названия ролей).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [page] = process.argv.slice(2);
if (!page) {
  console.error('usage: node scripts/hh-roles.mjs <сохранённая страница поиска hh.html>');
  process.exit(2);
}

const html = readFileSync(page, 'utf8');
const tpl = html.match(/<template[^>]*id="HH-Lux-InitialState"[^>]*>([\s\S]*?)<\/template>/);
if (!tpl) throw new Error('Нет HH-Lux-InitialState — это не страница поиска hh');
// HTML-сущности — за один проход, как в n8n/w1-collector/parse-search.js
const NAMED = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' };
const json = tpl[1].replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return NAMED[e.toLowerCase()] ?? m;
});
const tree = JSON.parse(json).professionalRoleTree?.items;
if (!Array.isArray(tree) || !tree.length) throw new Error('Нет professionalRoleTree.items');

const roles = {};
const groups = tree.map((g) => ({
  name: g.text,
  roles: (g.items ?? []).map((r) => {
    roles[r.id] = r.text;
    return Number(r.id);
  }),
}));

const out = `// Справочник профессиональных ролей hh.ru (параметр поиска professional_role): группы и роли.
// Сгенерирован: node scripts/hh-roles.mjs <страница поиска hh> — руками не править.
// Общий код W1 «Score job» и W7 «Render» (названия ролей), W11 (онбординг: нейросеть выбирает роли из списка):
// строка «// @include n8n/shared/hh-roles.js».

const HH_ROLES = ${JSON.stringify(roles, null, 2)};

const HH_ROLE_GROUPS = ${JSON.stringify(groups)};
`;
const target = fileURLToPath(new URL('../n8n/shared/hh-roles.js', import.meta.url));
writeFileSync(target, out);
console.log(`${target}: ${groups.length} групп, ${Object.keys(roles).length} ролей`);
