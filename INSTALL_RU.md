# Установка Football Analytics v6.9.0 RC17

## Новый Supabase-проект

1. Откройте Supabase SQL Editor.
2. Выполните `supabase_baseline_v6_9.sql` целиком.
3. Не запускайте после baseline старые numbered migrations: их изменения уже включены.
4. В Supabase Data API убедитесь, что таблицы схемы `public` доступны роли `service_role`. Прямой доступ `anon` и `authenticated` миграция отзывает.

## Обновление существующего проекта v6.8

1. Сделайте резервную копию базы.
2. Выполните `supabase_migration_v6_9.sql`.
3. Не запускайте `supabase_baseline_v6_9.sql` на существующей базе.
4. После deploy откройте защищённую RC Regression панель и убедитесь, что доступны:
   - `model_calibration_profiles`;
   - `model_calibration_state`;
   - `model_predictions.calibration_profile_fingerprint`.

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

```bash
npm ci
npm run check
npm test
npm run verify:release
npm run deploy
```

После deploy:

1. `/health` сообщает `6.9.0-rc17` и `RC17`.
2. RC Regression не содержит blocking failures.
3. В разделе качества модели показаны active fingerprint и состояние challenger.
4. До накопления нужной выборки production остаётся на baseline champion.
