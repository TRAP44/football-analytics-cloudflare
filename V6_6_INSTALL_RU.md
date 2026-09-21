# Установка v6.6.0 RC14

## 1 — Supabase

Выполнить `supabase_migration_v6_6.sql`.

Она:
- добавляет adjudication metadata в `model_predictions`;
- расширяет finality state значением `adjudicated`;
- создаёт backend-only `settlement_drift_resolutions`;
- фиксирует one-resolution-per-drift-event через primary key `source_event_id`.

## 2 — GitHub / Deploy

Обновить Worker, client, HTML, CSS, package, README и QA checklist.
Добавить `supabase_migration_v6_6.sql` и `V6_6_INSTALL_RU.md`.

`wrangler.jsonc`, cron и Secrets не меняются.

## 3 — Admin workflow

Profile → Качество модели → Integrity Remediation → Settlement drift review.

Для любого action сначала ввести reason.

- Оставить stored — score не меняется, state становится adjudicated.
- Принять provider — score/outcome и связанные backtest metrics меняются явно и с audit.
- Исключить из метрик — status становится void.

## 4 — QA

Запустить RC14 Regression QA и проверить Settlement Adjudication schema/self-test.
