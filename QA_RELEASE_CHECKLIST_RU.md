# QA Release Checklist — v6.2.0 RC10

## Deploy

- применён `supabase_migration_v6_2.sql`;
- заменены Worker / client файлы;
- Secrets не менялись;
- `wrangler.jsonc` и cron не менялись;
- Telegram Stars остаются paused.

## Health

Проверить:

- version = `6.2.0-rc10`;
- releaseCandidate = `RC10`;
- predictionIntegrity = `enabled`;
- predictionRemediation = `enabled`;
- settlementRecovery = `enabled`;
- settlementWatchdog = `enabled`;
- automaticSettlementRecovery = `runtime-controlled`;
- devMode = `false`.

## Runtime Controls

- новый toggle `Авто settlement catch-up` отображается;
- default = OFF / SHADOW;
- save создаёт новую revision;
- history snapshot содержит auto-settlement state;
- rollback корректно восстанавливает state;
- rollback к pre-RC10 snapshot безопасно трактует auto recovery как OFF.

## Integrity Remediation

- dry-run остаётся read-only;
- stale pending старше 36 часов определяется;
- batch ≤ 20 fixture / ≤ 5 дат;
- candidate token защищает ручной recovery от stale session;
- карточка Watchdog показывает SHADOW или AUTO;
- `trigger_source` виден как `admin` / `cron`, admin Telegram ID не отображается;
- manual recovery не удаляет и не перезаписывает immutable snapshot fields.

## Settlement Watchdog

- migration v6.2 определяется как ready;
- при auto OFF decision = shadow / observe;
- при неизвестной FREE quota unattended recovery блокируется;
- Runtime Controls должны быть подтверждены из Supabase, stale/default state не разрешает auto write;
- перед provider calls создаётся audit row `auto_recover / cron / started`;
- после успешного run status становится completed или partial;
- при ошибке status становится failed либо остаётся started как видимый interrupted intent;
- daily marker предотвращает повторный полноценный run в тот же день;
- watchdog не делает provider calls, если stale pending = 0.

## RC10

Обязательный PASS:

- Prediction Integrity self-test;
- Prediction Remediation self-test;
- Settlement Watchdog self-test;
- Settlement Watchdog schema v6.2;
- Runtime Controls RC10;
- Runtime rollback history;
- Production Load Safety;
- Admin Security;
- Supabase required tables.

## Инварианты

RC10 не меняет probabilities, captured_at, analysis_version, signal snapshots, веса модели или калибратор. Автоматизация касается только settlement recovery stale pending. Монетизация остаётся выключенной.
