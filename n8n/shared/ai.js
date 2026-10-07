// AI-вакансия — разработка на LLM: агенты, RAG, интеграции нейросетей. Решения пользователя 07.10.2026: берём
// в работу, но только на JS/TS (AI на Python пользователь отклонил). Общий код W1 «Filter search» (AI-названия
// не режет правило «бэкенд»), «Parse vacancy» (AI-вакансии на JS/TS не режет «нет React и Vue») и W2 «Build prompt»
// (подсказка нейросети): строка «// @include n8n/shared/ai.js». Смотрим название и навыки, не описание:
// «пользуемся AI» пишут почти все.

// \b и \w в JS не работают с кириллицей — границы для русских слов задаём явно.
// ChatGPT в навыках — инструмент, а не разработка на AI: «gpt» после буквы не считается
const AI_LATIN = /(^|[^a-z])(ai|llm|llms|genai|gpt|rag|langchain|openai)([^a-z]|$)|agent/i;
// «агентство» — не AI
const AI_CYRILLIC = /(^|[^а-яё])(ии|нейросет[а-яё]*|агент(?!ств)[а-яё]*)([^а-яё]|$)/i;

const isAi = (text) => AI_LATIN.test(String(text ?? '')) || AI_CYRILLIC.test(String(text ?? ''));

// JS/TS в тексте вакансии — AI-вакансию без React и Vue берём только с ним
const JS_STACK = /node\.?js|nest\.?js|typescript|javascript/i;
