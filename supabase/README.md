# Supabase SQL

- `baseline/` — только для нового пустого Supabase-проекта; актуальный baseline: `supabase_baseline_v6_16.sql`.
- `migrations/` — последовательные обновления уже существующей базы.
- Не запускайте baseline поверх production. RC101 baseline содержит fail-closed guard и остановится при обнаружении существующей рабочей схемы.
- Не удаляйте старые migrations: они являются историей upgrade-контракта и используются regression/release checks.

Production-секреты в этот каталог не добавляются.
