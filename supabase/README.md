# Supabase SQL

Единый источник истины для release/schema требований: `/release-contract.json`.

## Fresh-install baseline v6.19

`baseline/supabase_baseline_v6_19.sql` используется **только для нового пустого Supabase-проекта**. Baseline собран из проверенного schema path и включает состояние следующих numbered migrations в указанном порядке:

1. `supabase_migration_v6_9.sql`
2. `supabase_migration_v6_10.sql`
3. `supabase_migration_v6_11.sql`
4. `supabase_migration_v6_11_1.sql`
5. `supabase_migration_v6_12.sql`
6. `supabase_migration_v6_13.sql`
7. `supabase_migration_v6_14.sql`
8. `supabase_migration_v6_15.sql`
9. `supabase_migration_v6_16.sql`
10. `supabase_migration_v6_17.sql`
11. `supabase_migration_v6_18.sql`
12. `supabase_migration_v6_18_1.sql`
13. `supabase_migration_v6_19.sql`
14. `supabase_migration_v6_19_1.sql`

То есть fresh-install baseline уже содержит schema changes **через v6.19.1 включительно**. Эти migrations повторно поверх baseline не применяются.

После baseline новый проект должен последовательно применить post-baseline migrations:

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

Текущий production schema requirement согласно `release-contract.json`: **v6.29**. Текущая latest migration: `supabase_migration_v6_29_1.sql`.

## Upgrade existing database

- `migrations/` — последовательные обновления существующей базы.
- Для существующей production БД применяются **только отсутствующие** numbered migrations в порядке версий.
- **Никогда не запускайте fresh-install baseline поверх существующей production БД.** Guard в baseline останавливает bootstrap при обнаружении рабочей схемы.
- Старые migrations не удаляются: это история upgrade-контракта и вход regression/release checks.

## Database contract

- Текущий database contract: `databaseContract.version = 2` из `/release-contract.json`.
- Worker проверяет `backend_readiness_contract_v2`.
- `backend_schema_contract_v2` охватывает public relations, columns, constraints, indexes, functions, RLS policies, triggers и effective grants для `anon`, `authenticated`, `service_role`.
- Полный v2 fingerprint versioned по физической схеме. Исторически развивавшаяся production schema и детерминированный fresh-install baseline имеют разные, но явно зарегистрированные fingerprints в `databaseContract.compatibleFingerprints`.
- Production fingerprint остаётся primary; fresh-install fingerprint принимается только при точном совпадении. Любой незарегистрированный fingerprint считается schema drift и блокирует readiness.
- Исторический `backend_schema_fingerprint()` сохранён только как rollout-совместимость для старого Worker и не является текущим полным contract.
- RLS/least-privilege, service-role grants и executable CI schema checks являются обязательной частью schema contract.

Production-секреты в этот каталог не добавляются.
