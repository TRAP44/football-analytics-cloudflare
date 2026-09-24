# Supabase SQL

- `baseline/` — только для нового пустого Supabase-проекта; актуальный baseline: `supabase_baseline_v6_18.sql` (включая hotfix v6.18.1).
- `migrations/` — последовательные обновления уже существующей базы; после v6.18 применяется `supabase_migration_v6_18_1.sql`.
- Не запускайте baseline поверх production. RC101 baseline содержит fail-closed guard и остановится при обнаружении существующей рабочей схемы.
- Не удаляйте старые migrations: они являются историей upgrade-контракта и используются regression/release checks.

Production-секреты в этот каталог не добавляются.
