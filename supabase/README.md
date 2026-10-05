# Supabase SQL

Единый источник истины для release/schema требований: `/release-contract.json`.

## Fresh-install baseline

`baseline/supabase_baseline_v6_19.sql` предназначен **только для нового пустого Supabase-проекта**. Он является консолидированным снимком схемы на уровне **v6.19 включительно** и заменяет необходимость последовательно прогонять исторические migrations до v6.19 на чистой базе.

После baseline CI и новый production bootstrap должны последовательно применить все post-baseline migrations в том же порядке, который закреплён в `scripts/prepare-supabase-ci-migrations.js`:

1. `supabase_migration_v6_20.sql`
2. `supabase_migration_v6_21.sql`
3. `supabase_migration_v6_21_1.sql`
4. `supabase_migration_v6_21_2.sql`
5. `supabase_migration_v6_21_3.sql`
6. `supabase_migration_v6_22.sql`
7. `supabase_migration_v6_23.sql`
8. `supabase_migration_v6_24.sql`
9. `supabase_migration_v6_25.sql`
10. `supabase_migration_v6_25_1.sql`
11. `supabase_migration_v6_25_2.sql`
12. `supabase_migration_v6_26.sql`
13. `supabase_migration_v6_26_1.sql`
14. `supabase_migration_v6_26_2.sql`
15. `supabase_migration_v6_26_3.sql`
16. `supabase_migration_v6_27.sql`
17. `supabase_migration_v6_27_1.sql`
18. `supabase_migration_v6_27_2.sql`
19. `supabase_migration_v6_27_3.sql`
20. `supabase_migration_v6_28.sql`
21. `supabase_migration_v6_29.sql`
22. `supabase_migration_v6_29_1.sql`

Текущий `release-contract.json` фиксирует:

- fresh-install baseline: `supabase/baseline/supabase_baseline_v6_19.sql`;
- production schema: `6.29`;
- latest migration: `supabase/migrations/supabase_migration_v6_29_1.sql`.

## Existing databases

- `migrations/` — последовательные обновления существующей базы.
- Для существующей БД применяются только отсутствующие numbered migrations в порядке версий.
- **Никогда не запускайте fresh-install baseline поверх существующей production БД.** Guard в baseline дополнительно останавливает bootstrap при обнаружении рабочей схемы.
- Старые migrations не удаляются: это история upgrade-контракта и вход regression/release checks.

## Schema contract

- Текущий database contract: `databaseContract.version = 2` из `/release-contract.json`.
- Worker проверяет `backend_readiness_contract_v2`.
- `backend_schema_contract_v2` автоматически охватывает public relations/columns/constraints/indexes/functions/RLS policies/triggers и effective grants для `anon`, `authenticated`, `service_role`.
- Полный v2 fingerprint versioned по физической схеме. Исторически развивавшаяся production schema и детерминированный fresh-install baseline имеют разные, но явно зарегистрированные fingerprints в `databaseContract.compatibleFingerprints`.
- Production fingerprint остаётся primary; fresh-install fingerprint принимается только при точном совпадении.
- Любой незарегистрированный fingerprint остаётся schema drift и блокирует readiness.
- Исторический `backend_schema_fingerprint()` сохранён только как rollout-совместимость для старого Worker и намеренно не является текущим полным contract.
- RLS/least-privilege, service-role grants и executable CI schema checks являются обязательной частью schema contract.

Production-секреты в этот каталог не добавляются.
