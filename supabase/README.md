# Supabase SQL

Единый источник истины для release/schema требований: `/release-contract.json`.

- `baseline/` — только для нового пустого Supabase-проекта. Актуальный fresh-install baseline: `supabase_baseline_v6_19.sql`; после него для новой БД нужно применить `supabase_migration_v6_20.sql`.
- `migrations/` — последовательные обновления существующей базы. Production schema requirement: v6.20; последняя migration: `supabase_migration_v6_20.sql`.
- **Никогда не запускайте fresh-install baseline поверх существующей production БД.** Guard в baseline дополнительно останавливает bootstrap при обнаружении рабочей схемы.
- Для существующей БД применяются только отсутствующие numbered migrations в порядке версий.
- Старые migrations не удаляются: это история upgrade-контракта и вход regression/release checks.
- RLS/least-privilege, service-role grants и backend schema probes являются обязательной частью schema contract.

Production-секреты в этот каталог не добавляются.
