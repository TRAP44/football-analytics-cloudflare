# Установка v6.5.0 RC13

## 1 — Supabase

Выполнить `supabase_migration_v6_5.sql`.

Migration добавляет finality-state к `model_predictions` и отдельный audit `settlement_verification_events`.

## 2 — GitHub / Deploy

Обновить:
- `src/worker.js`
- `public/app.js`
- `public/index.html`
- `package.json`
- `README_CLOUDFLARE_RU.md`
- `QA_RELEASE_CHECKLIST_RU.md`

Добавить:
- `supabase_migration_v6_5.sql`
- `V6_5_INSTALL_RU.md`

`wrangler.jsonc`, cron и Secrets не менять: используется существующий cron `*/5 * * * *`.

## 3 — Finality policy

- verifier window: около 05:00–05:14 UTC;
- settlement должен быть старше 6 часов;
- lookback: 7 дней;
- максимум 3 даты / 100 fixture;
- provider quota guard обязателен;
- `verified` разрешён только при совпадении score + outcome;
- `drift` не исправляется автоматически;
- model-quality/calibration исключают drift.

## 4 — QA

После Deploy открыть Profile → Качество модели → Integrity Remediation.
Карточка Settlement finality должна показать schema ready и counters.

Release Candidate RC13 → Запустить QA.
