// W13 · Resume file — резюме бота целиком файлом (кнопка «📄 Резюме файлом», 15.10.2026): сообщение Telegram — до
// 4096 знаков, а резюме — до 30 000. Нода: Code, режим «Run Once for All Items». Вход: «Settings».
// Выход: { text, caption } → «To file» (Convert to File: text → binary data, resume.md) → «Send file».

// @include n8n/shared/time.js

// @include n8n/shared/card.js

// @include n8n/shared/settings.js

// @include n8n/shared/resumes.js

// @include n8n/shared/skills.js

// @include n8n/shared/resume.js

// @include n8n/shared/cv.js

const all = loadSettings($('Settings').all());
const scope = resumeScope(all, $getWorkflowStaticData('global').target);
const s = scope.s;
const text = resumeJoin(resumeDraft(s));
const h = s['resume.history'][0];
const at = h && Date.parse(h.at) ? ` · правка ${localDM(Date.parse(h.at))} ${localHM(Date.parse(h.at))}` : '';
return [
  {
    json: {
      text: text || '(резюме пусто: пришли PDF боту)',
      caption: `📄 Резюме ${scope.several ? `«${scope.name}» ` : ''}бота · ${text.length} знаков${at}. По нему нейросеть оценивает вакансии и пишет письма.`,
    },
  },
];
