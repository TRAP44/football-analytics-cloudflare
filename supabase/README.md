# Supabase SQL

Единый источник истины для release/schema требований: `/release-contract.json`.

- `baseline/` — только для нового пустого Supabase-проекта. Актуальный fresh-install baseline: `supabase_baseline_v6_19.sql`; после него для новой БД нужно последовательно применить numbered migrations от `supabase_migration_v6_20.sql` до `supabase_migration_v6_27_3.sql`.
- `migrations/` — последовательные обновления существующей базы. Production schema requirement: v6.27; последняя migration: `supabase_migration_v6_27_3.sql`.
- **Никогда не запускайте fresh-install baseline поверх существующей production БД.** Guard в baseline дополнительно останавливает bootstrap при обнаружении рабочей схемы.
- Для существующей БД применяются только отсутствующие numbered migrations в порядке версий.
- Старые migrations не удаляются: это история upgrade-контракта и вход regression/release checks.
- Текущий database contract: `databaseContract.version = 2` из `/release-contract.json`; Worker проверяет `backend_readiness_contract_v2`, а `backend_schema_contract_v2` автоматически охватывает все public relations/columns/constraints/indexes/functions/RLS policies/triggers и effective grants для `anon`, `authenticated`, `service_role`.
- Полный v2 fingerprint versioned по физической схеме. Исторически развивавшаяся production schema и детерминированный fresh-install baseline имеют разные, но явно зарегистрированные полные fingerprints (`databaseContract.compatibleFingerprints`). Production fingerprint остаётся primary; fresh-install fingerprint принимается только при точном совпадении. Любой незарегистрированный fingerprint остаётся schema drift и блокирует readiness.
- Исторический `backend_schema_fingerprint()` сохранён только как rollout-совместимость для старого Worker и намеренно не является текущим полным contract.
- RLS/least-privilege, service-role grants и executable CI schema checks являются обязательной частью schema contract.

Production-секреты в этот каталог не добавляются.
