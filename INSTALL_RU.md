# Установка Football Analytics

Актуальные версии и требования всегда смотрите в `release-contract.json`.

## Новый Supabase-проект

1. Откройте Supabase SQL Editor.
2. Выполните fresh-install baseline из поля `freshInstallBaseline` в `release-contract.json`.
3. Затем примените все миграции из `supabase/migrations/`, которые новее baseline, строго по порядку до файла из поля `latestMigration`.
4. Не запускайте старые миграции, уже включённые в baseline.
5. Проверьте, что backend-таблицы доступны только серверной роли, а прямой доступ `anon` и `authenticated` закрыт.

Текущий контракт:
- приложение: `6.120.0`
- runtime: `6.120.0-rc144`
- schema: `6.29`
- baseline: `supabase/baseline/supabase_baseline_v6_19.sql`
- latest migration: `supabase/migrations/supabase_migration_v6_29_1.sql`

## Существующий Supabase-проект

1. Сделайте резервную копию базы.
2. Не запускайте fresh-install baseline поверх существующей production-базы.
3. Применяйте только отсутствующие миграции, строго по порядку версий.
4. Не переигрывайте уже применённые миграции без отдельного rollback-плана.
5. После обновления проверьте schema/readiness contract.

## Обязательные Cloudflare Secrets

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
ADMIN_TELEGRAM_IDS
API_FOOTBALL_KEY
SUPABASE_URL
SUPABASE_SECRET_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` поддерживается для совместимости. Остальные переменные перечислены в `.env.example`.

Секреты нельзя хранить в `public/`, Git history или клиентском коде.

## GitHub / Cloudflare

Для production deploy нужны:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Для защищённого rollback задайте `CLOUDFLARE_WORKER_URL`.

Release-процесс:

```text
PR → Quality → merge в main → Deploy Production → production smoke
```

## Локальная проверка

```bash
npm ci
npm run security:scan
npm run check
npm test
npm run lint
npm run verify:release
npm run verify:worker
```

Все команды должны завершиться без ошибок до merge.

## После deploy

Проверьте:
1. `/health/live` возвращает `ok=true`.
2. `/health/ready` возвращает `ok=true`, `status=ready` и актуальную версию.
3. `DEV_MODE=false`.
4. `MONETIZATION_ENABLED=false`, пока монетизация не включена отдельно.
5. Обычный пользователь не видит admin controls.
6. Технический Supabase health не доступен публично.
7. Production smoke и schema contract проходят без blocking failures.

## Rollback

Используйте workflow `Rollback Production` и укажите нужный Cloudflare Worker `version_id`.

Rollback Worker не откатывает Supabase. Изменения базы требуют отдельного SQL rollback-плана или восстановления из резервной копии.
