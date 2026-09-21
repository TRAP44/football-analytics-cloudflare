# Установка v6.2.0 RC10

## Шаг 1 — Supabase

Сначала убедиться, что применён `supabase_migration_v6_1.sql`.

Затем Supabase → SQL Editor → New query → выполнить целиком:

`supabase_migration_v6_2.sql`

Migration добавляет:

- `runtime_controls.auto_settlement_recovery_enabled` с safe default `false`;
- `prediction_integrity_actions.trigger_source`;
- `action_type = auto_recover`;
- `status = started` для audit intent до unattended recovery.

## Шаг 2 — GitHub / Deploy

Заменить:

1. `src/worker.js`
2. `public/app.js`
3. `public/index.html`
4. `public/styles.css`
5. `package.json`
6. `README_CLOUDFLARE_RU.md`
7. `QA_RELEASE_CHECKLIST_RU.md`

Добавить:

8. `supabase_migration_v6_2.sql`
9. `V6_2_INSTALL_RU.md`

`wrangler.jsonc`, Secrets и cron не менять.

## Шаг 3 — Health

После Deploy открыть `/health`.

Ожидается:

- `version`: `6.2.0-rc10`
- `releaseCandidate`: `RC10`
- `predictionIntegrity`: `enabled`
- `predictionRemediation`: `enabled`
- `settlementRecovery`: `enabled`
- `settlementWatchdog`: `enabled`
- `automaticSettlementRecovery`: `runtime-controlled`
- `monetization`: `paused`
- `devMode`: `false`

## Шаг 4 — QA в SHADOW

Сначала НЕ включать automatic recovery.

Профиль → `Runtime Controls & Kill Switches`:

1. убедиться, что `Авто settlement catch-up` выключен;
2. проверить, что revision/history загружаются;
3. сохранить изменение причины или другой безопасный toggle и проверить history/rollback;
4. убедиться, что rollback к старой revision не включает auto recovery самопроизвольно.

Профиль → `Качество модели` → `Integrity Remediation`:

1. выполнить `Обновить dry-run`;
2. карточка `Watchdog` должна показывать `SHADOW`;
3. migration v6.2 должна определяться как готовая;
4. ручной recovery RC9 должен продолжать работать без изменений.

## Шаг 5 — RC10 QA

Профиль → `Release Candidate RC10` → `Запустить QA`.

Обязательные PASS:

- `Prediction Integrity self-test`;
- `Prediction Remediation self-test`;
- `Settlement Watchdog self-test`;
- `Settlement Watchdog schema v6.2`;
- `Prediction remediation audit`;
- Runtime Controls / rollback;
- Supabase schema;
- Production Load Safety;
- Admin Security.

## Шаг 6 — опциональное включение AUTO

Включать только после SHADOW QA и при понятной provider quota.

Профиль → `Runtime Controls & Kill Switches` → включить `Авто settlement catch-up` → указать причину → применить.

Guardrails AUTO:

- запуск только около `04:00 UTC`;
- максимум один успешный watchdog-run в сутки;
- максимум 20 fixture;
- максимум 5 дат / API calls;
- при неизвестной или низкой FREE quota recovery не выполняется;
- перед provider calls создаётся audit intent `started`;
- меняются только stale `pending` с подтверждённым финальным счётом.

Для первого production цикла рекомендуется проверить audit history после ближайшего watchdog window. Если stale pending отсутствуют, никаких provider calls watchdog не делает.
