# Установка v6.4.0 RC12

## 1. Supabase

Выполнить `supabase_migration_v6_4.sql`.

Migration идемпотентна: если RC11 run-ledger поля уже существуют, они сохраняются, а constraints/indexes приводятся к RC12.

## 2. GitHub / Deploy

Обновить:
- `src/worker.js`
- `public/app.js`
- `public/index.html`
- `package.json`
- `README_CLOUDFLARE_RU.md`
- `QA_RELEASE_CHECKLIST_RU.md`

Добавить:
- `supabase_migration_v6_4.sql`
- `V6_4_INSTALL_RU.md`

`wrangler.jsonc`, cron и Secrets не менять.

## 3. Проверка

После Deploy:
- открыть `/health`;
- Профиль → Качество модели → Integrity Remediation;
- Run ledger должен быть `CLEAR`, если активных или stale started нет;
- Release Candidate RC12 → Запустить QA.

## Policy

- stale started threshold: 30 минут;
- active started блокирует параллельный AUTO run;
- exact-batch retry: максимум 3 попытки;
- stale started → interrupted;
- interrupted reconciliation учитывается reliability circuit breaker.
