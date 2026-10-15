// Навыки: одно и то же под разными названиями. W5 — разметка навыков вакансии по профилю (14.10.2026), W13 — какие
// навыки вакансий есть в резюме (15.10.2026). Общий код: строка «// @include n8n/shared/skills.js».

// Упоминается ли навык в тексте (text — в нижнем регистре): целым словом, с границами и для кириллицы
const mentionsSkill = (text, skill) =>
  new RegExp(`(^|[^a-zа-яё0-9])${skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-zа-яё0-9]|$)`).test(text);
// Другие названия того же: «React.js» = React, SQL ⊂ PostgreSQL, руководство ≈ technical leadership / mentoring
const SKILL_ALIASES = {
  sql: ['postgresql'],
  postgres: ['postgresql'],
  kuber: ['kubernetes'],
  k8s: ['kubernetes'],
  'руководство коллективом': ['technical leadership', 'mentoring'],
  'управление командой': ['technical leadership', 'mentoring'],
  наставничество: ['mentoring'],
  'английский язык': ['английский'],
};
// Все названия навыка в нижнем регистре: «SASS/SCSS», «UI/UX» — и каждое отдельно (14.10.2026: при SCSS в резюме
// письмо писало «готов разобраться в SASS/SCSS»), «React.js» — и «react»
const skillVariants = (skill) => {
  const s = skill.toLowerCase();
  const names = [s, ...(s.includes('/') ? s.split('/').map((p) => p.trim()).filter((p) => p.length > 1) : [])];
  return [...new Set([...names.flatMap((n) => [n, n.replace(/\.?js$/, '')]), ...(SKILL_ALIASES[s] ?? [])])].filter(Boolean);
};
