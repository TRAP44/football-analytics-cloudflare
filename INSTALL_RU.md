# Установка Football Analytics v6.92.0 RC100

## Новый Supabase-проект

Все SQL находятся в каталоге `supabase/`: fresh-install baseline — в `baseline/`, последовательные обновления — в `migrations/`.


1. Откройте Supabase SQL Editor.
2. Выполните **только** `supabase/baseline/supabase_baseline_v6_15.sql` целиком.
3. Не запускайте после него numbered migrations v6.9–v6.15: они уже включены в unified baseline.
4. В Supabase Data API убедитесь, что backend-таблицы доступны `service_role`, а прямой доступ `anon` и `authenticated` закрыт.

## Обновление существующего проекта

1. Сделайте резервную копию базы.
2. Примените только отсутствующие миграции, сохраняя порядок версий: v6.9 → v6.10 → v6.11 → v6.11.1 → v6.12 → v6.13 → v6.14 → v6.15.
3. Для существующей базы не запускайте `supabase/baseline/supabase_baseline_v6_15.sql`: он предназначен только для fresh install.
4. Не удаляйте и не переигрывайте уже применённые миграции без отдельного плана rollback.
5. После обновления запустите защищённый RC Regression и проверьте least-privilege контракт Supabase.

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

API token должен быть ограничен нужным Cloudflare account и правом редактирования Workers. Не добавляйте эти значения в `.env`, `.dev.vars` или файлы репозитория.

Опционально задайте Repository Variable `CLOUDFLARE_WORKER_URL`, если smoke-проверка должна использовать custom domain вместо URL, возвращённого Wrangler.

Рабочий release-процесс:

`PR → Quality → merge в main → Deploy Production → RC100 smoke`.

## Локальная проверка

```bash
npm ci
npm run check
npm test
npm run verify:release
npm run verify:worker
```

Все команды должны завершиться без ошибок до merge.

## После deploy

Проверьте:

1. `/health` возвращает `ok=true`, версию `6.92.0-rc100` и `releaseCandidate=RC100`.
2. RC Regression не содержит blocking failures.
3. `DEV_MODE=false` и `MONETIZATION_ENABLED=false`.
4. Обычный пользователь не видит административные controls.
5. `/health/supabase` не доступен публично.
6. CSP, HSTS, `X-Content-Type-Options: nosniff` и остальные security headers присутствуют.
7. Production smoke подтверждает обязательные RC100 release/self-test flags.

## Rollback

Для аварийного возврата используйте workflow `Rollback Production`: укажите Cloudflare version ID и подтвердите действие значением `ROLLBACK`.

Rollback меняет версию Worker, но не откатывает состояние Supabase. Изменения базы требуют отдельного SQL rollback-плана.
