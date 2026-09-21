# Установка v6.1.0 RC9

## Шаг 1 — Supabase

Supabase → SQL Editor → New query.

Вставить весь файл:

`supabase_migration_v6_1.sql`

Нажать `Run`.

Появится таблица:

`public.prediction_integrity_actions`

Она хранит audit trail ручного settlement recovery. Telegram ID администратора не возвращается в интерфейс.

## Шаг 2 — GitHub

Заменить:

1. `src/worker.js`
2. `public/app.js`
3. `public/index.html`
4. `public/styles.css`
5. `package.json`
6. `README_CLOUDFLARE_RU.md`
7. `QA_RELEASE_CHECKLIST_RU.md`

Добавить:

8. `supabase_migration_v6_1.sql`
9. `V6_1_INSTALL_RU.md`

`wrangler.jsonc`, Cloudflare Secrets и cron не менять.

## Шаг 3 — после Deploy

Открыть `/health`.

Ожидается:

- `version`: `6.1.0-rc9`
- `releaseCandidate`: `RC9`
- `predictionIntegrity`: `enabled`
- `predictionRemediation`: `enabled`
- `settlementRecovery`: `enabled`
- `monetization`: `paused`
- `devMode`: `false`

## Шаг 4 — безопасный Telegram QA

Профиль → `Качество модели` → `Integrity Remediation`.

1. Нажать `Обновить dry-run`.
2. Убедиться, что сканирование не расходует API-Football.
3. Проверить количество stale pending и оценку API calls.
4. Если кандидатов нет — recovery не запускать.
5. Если кандидаты есть — указать причину, например `RC9 settlement recovery test`.
6. Проверить список fixture и подтвердить запуск.
7. Убедиться, что результат появился в audit history как completed или partial.
8. Обновить Model Dashboard и проверить, что восстановленные строки стали settled только при наличии финального счёта.

Затем:

Профиль → `Release Candidate RC9` → `Запустить QA`.

Обязательные PASS:

- `Prediction Integrity self-test`;
- `Prediction Remediation self-test`;
- `Prediction remediation audit`;
- предыдущие schema / security / load safety checks.

## Ограничения

- один recovery batch: максимум 20 fixture;
- максимум 5 запросов API-Football по уникальным датам;
- при низкой квоте выполнение блокируется;
- изменение candidate token требует нового dry-run;
- predictions не удаляются;
- probabilities, captured_at и analysis_version не переписываются.
