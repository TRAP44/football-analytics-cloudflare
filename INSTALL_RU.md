# Установка Football Analytics v6.17.0 RC25

## Новый Supabase-проект

1. Откройте Supabase SQL Editor.
2. Выполните `supabase_baseline_v6_9.sql` целиком.
3. Затем выполните `supabase_migration_v6_10.sql`.
4. Затем выполните `supabase_migration_v6_11.sql`.
5. Затем выполните `supabase_migration_v6_11_1.sql`.
6. Не запускайте после baseline миграции v6.3–v6.9: их изменения уже включены.
7. В Supabase Data API убедитесь, что таблицы схемы `public` доступны роли `service_role`. Прямой доступ `anon` и `authenticated` миграция отзывает.

## Обновление существующего проекта

1. Сделайте резервную копию базы.
2. Для v6.8 выполните сначала `supabase_migration_v6_9.sql`.
3. Выполните `supabase_migration_v6_10.sql`.
4. Выполните `supabase_migration_v6_11.sql`.
5. Выполните `supabase_migration_v6_11_1.sql`.
6. Не запускайте `supabase_baseline_v6_9.sql` на существующей базе.
7. После deploy откройте защищённую RC Regression панель и убедитесь, что доступны:
   - `model_calibration_profiles`;
   - `model_calibration_state`;
   - `model_calibration_transitions`;
   - `model_predictions.calibration_profile_fingerprint`.
   - проверка `Least-privilege контракт Supabase` имеет статус PASS.

Если установка старее v6.8, сначала примените отсутствующие исторические миграции в порядке версий. Не удаляйте уже применённые записи миграций из Supabase.

## Cloudflare Secrets

Обязательные:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
ADMIN_TELEGRAM_IDS
API_FOOTBALL_KEY
SUPABASE_URL
SUPABASE_SECRET_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` поддерживается для совместимости. Секретный ключ никогда не должен попадать в `public/` или Telegram-клиент.

Опциональные переменные перечислены в `.env.example`.

## Проверка и deploy

Для автоматического production deploy добавьте в GitHub Environment `production` или Repository Secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

API token должен быть ограничен нужным Cloudflare account и правом редактирования Workers. Не добавляйте эти значения в `.env`, `.dev.vars` или файлы репозитория.

Опционально задайте Repository Variable `CLOUDFLARE_WORKER_URL`, если smoke-проверка должна использовать custom domain вместо URL, возвращённого Wrangler.

Обычный процесс: PR → `Quality` → merge в `main` → `Deploy Production` → RC25 smoke. Отсутствующие Cloudflare credentials блокируют workflow с ошибкой. Локальный ручной deploy остаётся доступен:

```bash
npm ci
npm run check
npm test
npm run verify:release
npm run verify:worker
npm run deploy
```

После deploy:

1. `/health` сообщает `6.17.0-rc25` и `RC25`.
2. RC Regression не содержит blocking failures.
3. В разделе качества модели показаны active fingerprint и состояние challenger.
4. Обычный аккаунт не показывает бейдж «Администратор» и не видит технические панели.
5. До накопления нужной выборки production остаётся на baseline champion.
6. HTML-ответ содержит RC25 CSP и `X-Content-Type-Options: nosniff`.

Для аварийного возврата откройте workflow `Rollback Production`, укажите version ID из Cloudflare Deployments и введите `ROLLBACK`. Rollback меняет только версию Worker; состояние Supabase он не откатывает.
