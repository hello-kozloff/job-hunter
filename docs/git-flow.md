# Git flow: ветки, PR и коммиты

Решения пользователя (07.10.2026):

- `main` переименован в `production`;
- работа идёт в feature-ветках от `develop`;
- **коммиты, PR и имена веток — только по-английски.**

Репозиторий: `github.com/hello-kozloff/job-hunter` (приватный), ветка по умолчанию — `develop`.

## Ветки

| Ветка | Что в ней | От какой | Куда вливается |
|---|---|---|---|
| `production` | Состояние, проверенное на живых запусках. Точка отката | — | — |
| `develop` | Интеграция. **С неё деплой в n8n** | `production` | `production` (релиз, через PR) |
| `feature/<name>` | Одна задача | `develop` | `develop` (через PR) |
| `hotfix/<name>` | Срочная починка того, что работает в n8n | `production` | `production` (через PR), потом `production` → `develop` |

- Release-ветки не используем: проект ведёт один человек.
- Имя ветки — английский kebab-case по сути задачи: `feature/collect-every-30-min`, `feature/habr-source`, `hotfix/w1-captcha-detector`.
- n8n один, и он боевой. Поэтому `scripts/deploy.sh` разворачивает только `develop` (обычная работа) или `production` (hotfix, откат). С другой ветки он откажется, если не передать `--any-branch`.

## Фича

```bash
git switch develop && git pull
git switch -c feature/<name>

# код → офлайн-проверки (scripts/run-code-node.mjs) → node scripts/build-workflows.mjs
git add <файлы>                       # n8n/workflows/*.json — вместе с исходниками
git commit                            # Conventional Commits, по-английски (ниже)

git push -u origin feature/<name>
gh pr create --base develop --title "feat(w1): …" --body "…"
gh pr merge --merge --delete-branch   # merge commit: коммиты фичи сохраняются

git switch develop && git pull
scripts/deploy.sh                     # в n8n уходит develop
```

После деплоя проверить на живых запусках: `node scripts/n8n-api.mjs executions <id>`, Telegram, таблица.

- Если нашлась проблема, а PR ещё открыт — новый коммит в ту же ветку.
- Если PR уже влит — новая ветка `feature/…` (тип коммита `fix`).

## Релиз: develop → production

Делается, когда `develop` проверен на живых запусках: сборы по расписанию прошли, карточки и письма в порядке, утренняя сводка без сбоев.

```bash
gh pr create --base production --head develop \
  --title "chore(release): v2026.10.07" --body "<что вошло: список PR>"
gh pr merge <N> --merge --subject "chore(release): v2026.10.07 (#<N>)"

git switch production && git pull
git tag -a v2026.10.07 -m "chore(release): v2026.10.07"
git push origin v2026.10.07
git switch develop
```

- Тег ставится на коммит слияния в `production`: `vГГГГ.ММ.ДД` по дате релиза.
- Второй релиз за день — `vГГГГ.ММ.ДД.2`.
- Деплой не нужен: этот код уже работает в n8n с `develop`.

## Hotfix

Срочная починка, когда в `develop` есть непроверенное и выкатывать его нельзя.

```bash
git switch production && git pull
git switch -c hotfix/<name>
# починка → коммит fix(<scope>): …
git push -u origin hotfix/<name>
gh pr create --base production --title "fix(w1): …"
gh pr merge --merge --delete-branch

git switch production && git pull
scripts/deploy.sh                     # в n8n уходит production с починкой
git tag -a v2026.10.07.2 -m "fix(w1): …" && git push origin v2026.10.07.2

# вернуть починку в develop и снова развернуть develop
gh pr create --base develop --head production --title "chore: merge hotfix v2026.10.07.2 into develop"
gh pr merge <N> --merge
git switch develop && git pull && scripts/deploy.sh
```

## Откат

```bash
git switch production && scripts/deploy.sh
```

В n8n вернётся последнее проверенное. Новые колонки таблиц (`n8n-api.mjs migrate`) откат не удаляет, старый код их просто не использует.

## Коммиты

**Язык — только английский:** заголовок, тело, имена веток, PR.

Формат — [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>)!: <subject>

<body>

<footer>
```

**type** — что за изменение:

| type | Когда |
|---|---|
| `feat` | Новое поведение системы: правило отбора, кнопка, workflow, расписание |
| `fix` | Исправление ошибки или неверного поведения |
| `docs` | Только документация: CLAUDE.md, docs/ |
| `refactor` | Переделка кода без изменения поведения |
| `perf` | Быстрее или дешевле: запросы к hh, токены нейросети |
| `test` | Проверки: `run-code-node`, фикстуры `synthetic-*` |
| `build` | Сборка и окружение: `build-workflows.mjs`, docker-compose, зависимости |
| `chore` | Служебное: релизы, `.gitignore`, мелочи без влияния на работу |
| `revert` | Откат предыдущего коммита |

**scope** — где изменение. Необязателен; если затронуто много мест, не пишется.

| scope | Что |
|---|---|
| `w0`…`w10`, `s0`, `s1` | workflow: код в `n8n/w*-…/` и описание в `build-workflows.mjs` |
| `applier` | робот-отклик: `applier/` (сервис, Dockerfile, тесты) |
| `shared` | `n8n/shared/*.js` |
| `schema` | `n8n/schema.mjs`, таблицы, `blacklist.json` |
| `deploy` | `deploy.sh`, `docker-compose.yml`, ngrok, credentials |
| `scripts` | `n8n-api.mjs`, `run-code-node.mjs` и прочие скрипты |
| `stage-N` | для `docs`: `docs/stages/stage-N.md` |

**subject** — что меняется, а не какие файлы:

- повелительное наклонение (`add`, `fix`, `drop`), со строчной буквы, без точки в конце;
- вся первая строка — не длиннее 72 знаков;
- ✅ `feat(w1): collect every 30 min by day, every 2 h at night`
- ✅ `fix(w5): drop dashes and cliches from cover letters`
- ✅ `docs(stage-5): describe OnCalendar schedule for healthchecks`
- ❌ `update files`, `fixed bug`, `WIP`, `правки` (не по-английски).

**body** — по желанию, через пустую строку, строки до 72 знаков:

- зачем изменение и что в нём неочевидно; список через `-` допустим;
- как проверено, если не очевидно.

**`!` и `BREAKING CHANGE:`** — если после деплоя нужен ручной шаг:

- новая колонка (`node scripts/n8n-api.mjs migrate`);
- новая переменная в `.env`;
- действие пользователя (например, расписание стража на healthchecks.io).

```
feat(schema)!: add card_at column for expired cards

BREAKING CHANGE: run `node scripts/n8n-api.mjs migrate` before deploy.
```

**Трейлеры** — если коммит пишет Claude:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

**Правила:**

- один коммит — одно логическое изменение;
- перед коммитом — `node scripts/build-workflows.mjs`, сгенерированные `n8n/workflows/*.json` коммитятся вместе с исходниками;
- секреты и личное в git не попадают (`.gitignore`): `.env`, `.n8n-session`, `docs/resume.md`, `docs/letter-example*.md`, `fixtures/*`. Перед коммитом смотреть `git status`.

## Pull request

- **Заголовок** — как заголовок коммита (Conventional Commits, по-английски): `feat(w2): …`.
- **Описание** — по-английски, три раздела:
  - **Summary** — что изменилось;
  - **Why** — зачем;
  - **Verification** — как проверено: офлайн-прогоны, живые запуски.
- **Слияние** — `gh pr merge --merge --delete-branch`: merge commit, ветка удаляется. Squash и rebase не используем.
- PR в `develop` вливает Claude сам. Пользователь смотрит изменения на GitHub, когда хочет.
