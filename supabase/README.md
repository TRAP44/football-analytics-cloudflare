# Supabase SQL

Этот каталог содержит versioned SQL-контракт базы данных MatchRadar / Football Analytics Mini App.

## Источник истины

Единый источник release/schema требований — `/release-contract.json`.

Текущее состояние контракта:

- production schema: `6.29`;
- fresh-install baseline: `supabase/baseline/supabase_baseline_v6_19.sql`;
- latest migration: `supabase/migrations/supabase_migration_v6_29_11.sql`;
- database contract: `databaseContract.version = 2`;
- readiness RPC: `backend_readiness_contract_v2`.

При расхождении этого README с `/release-contract.json` приоритет всегда имеет `/release-contract.json`.

## Структура каталога

### `baseline/`

Только для нового пустого Supabase-проекта.

Актуальный baseline:

`supabase/baseline/supabase_baseline_v6_19.sql`

После baseline для новой БД последовательно применяются все numbered migrations начиная с `supabase_migration_v6_20.sql` и заканчивая текущей `supabase_migration_v6_29_11.sql`.

**Никогда не запускайте fresh-install baseline поверх существующей production БД.** Baseline содержит дополнительный guard, который должен остановить bootstrap при обнаружении рабочей схемы.

### `migrations/`

Последовательная история обновлений существующей базы данных.

Для существующей БД:

1. не запускайте baseline;
2. определите уже применённую версию;
3. применяйте только отсутствующие migrations;
4. соблюдайте числовой порядок версий, а не лексикографический порядок имён файлов;
5. после каждого schema-changing rollout проверяйте readiness/schema contract.

Исторические migrations являются частью upgrade-контракта. Их нельзя удалять, переименовывать или переписывать после применения в production. Исправления уже выпущенной migration должны оформляться новой forward migration.

## Schema contract v2

Worker проверяет `backend_readiness_contract_v2`.

`backend_schema_contract_v2` формирует versioned fingerprint физической public-схемы и учитывает:

- relations и columns;
- constraints;
- indexes;
- functions;
- RLS policies;
- triggers;
- effective grants для `anon`, `authenticated` и `service_role`.

Исторически развивавшаяся production schema и детерминированный fresh-install baseline могут иметь разные, но явно зарегистрированные полные fingerprints в `databaseContract.compatibleFingerprints`.

Production fingerprint остаётся primary. Fresh-install fingerprint принимается только при точном совпадении. Любой незарегистрированный fingerprint считается schema drift и должен блокировать readiness.

Исторический `backend_schema_fingerprint()` сохранён только для rollout-совместимости со старым Worker и не является текущим полным контрактом.

## Безопасность и эксплуатационные правила

- RLS и least-privilege обязательны для exposed schema.
- Backend-only объекты предпочтительно размещать в private/unexposed schema.
- `service_role` и другие секреты нельзя помещать в этот каталог или коммитить в Git.
- Новые public RPC/functions должны получать только минимально необходимые `EXECUTE` grants.
- `SECURITY DEFINER` нельзя использовать как обход проблем с правами; если он действительно необходим, функция должна иметь минимальный scope, безопасный `search_path` и явные grants.
- Private durable analysis-usage ledger не входит в public fingerprint v2, поэтому отдельно проверяется `backend_readiness_contract_v2` как `schema.privateAnalysisUsage`.
- Atomic runtime-control history rule живёт в `pg_rewrite`, поэтому отдельно проверяется `backend_security_contract()`/readiness и не считается частью public fingerprint v2.
- `personal_write_guard_contract()` v2 проверяется целиком в Worker и `backend_readiness_contract_v2`: три лимита, canonical reminders, explicit rearm и retention 90 дней.
- `read_provider_slo_buckets()` обязан сохранять `STABLE`-совместимую границу чтения через `statement_timestamp()`; body-level drift отдельно блокирует readiness.
- Sensitive mutation `complete/fail` допускаются только при ещё активном `locked_until`; body-level drift этого ownership guard блокирует readiness.
- Schema-changing SQL должен оставаться идемпотентным там, где это требуется rollout-контрактом.
- После DDL/RLS/grants изменений необходимо запускать schema/readiness checks и Supabase security/performance advisors.
- Executable CI schema checks являются обязательной частью release contract.

Production-секреты в `supabase/` не добавляются.
