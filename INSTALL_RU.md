# Установка Football Analytics v6.91.0 RC99

## Новый Supabase-проект

1. Откройте Supabase SQL Editor.
2. Выполните **только** `supabase/baseline.sql` целиком.
3. Не запускайте после него файлы из `supabase/migrations/`: все изменения до v6.15 уже включены в baseline.
4. Проверьте backend security contract и убедитесь, что прямой доступ `anon` / `authenticated` к backend-таблицам закрыт.

## Обновление существующего проекта

1. Сделайте резервную копию базы.
2. **Не запускайте** `supabase/baseline.sql` поверх рабочей базы.
3. Применяйте только отсутствующие миграции из `supabase/migrations/` в порядке:
   - `v6_9.sql`
   - `v6_10.sql`
   - `v6_11.sql`
   - `v6_11_1.sql`
   - `v6_12.sql`
   - `v6_13.sql`
   - `v6_14.sql`
   - `v6_15.sql`
4. Уже применённую миграцию повторно не запускайте без отдельного rollback-плана.
5. После обновления запустите RC Regression и проверьте least-privilege контракт Supabase.

Подробности: `supabase/README_RU.md`.

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

`SUPABASE_SERVICE_ROLE_KEY` поддерживается для совместимости. Секретные значения никогда не должны попадать в `public/`, Git history или Telegram-клиент.

Опциональные переменные перечислены в `.env.example`.

## GitHub / Cloudflare production

Для автоматического production deploy добавьте в GitHub Environment `production` или Repository Secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Рабочий release-процесс:

`PR → Quality → merge в main → Deploy Production → RC99 smoke`.

## Локальная проверка

```bash
npm ci
npm run check
npm test
npm run verify:release
npm run verify:worker
```

## После deploy

Проверьте:

1. `/health` возвращает `ok=true`, версию `6.91.0-rc99` и `releaseCandidate=RC99`.
2. RC Regression не содержит blocking failures.
3. `DEV_MODE=false` и `MONETIZATION_ENABLED=false`.
4. Обычный пользователь не видит административные controls.
5. `/health/supabase` не доступен публично.
6. CSP, HSTS и `X-Content-Type-Options: nosniff` присутствуют.
7. Production smoke подтверждает обязательные feature/self-test flags.

## Rollback

Workflow `Rollback Production` откатывает Worker, но **не откатывает Supabase**. Для изменений базы нужен отдельный SQL rollback-план.
