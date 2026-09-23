# Установка Football Analytics v6.98.0 RC106

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

`SUPABASE_SERVICE_ROLE_KEY` поддерживается для совместимости. Секретные значения никогда не должны попадать в `public/`, Git history или Telegram-клиент. RC102+ автоматически блокирует release, если распознаваемый секрет попал в отслеживаемый Git-файл.

Опциональные переменные перечислены в `.env.example`.

## GitHub / Cloudflare production

Для автоматического production deploy добавьте в GitHub Environment `production` или Repository Secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

API token должен быть ограничен нужным Cloudflare account и правом редактирования Workers. Не добавляйте эти значения в `.env`, `.dev.vars` или файлы репозитория.

Рекомендуется задать Repository/Environment Variable `CLOUDFLARE_WORKER_URL`. Для обычного deploy это запасной стабильный URL, а для защищённого rollback RC103 эта переменная обязательна, потому что после отката нужно независимо проверить восстановленную версию.

Рабочий release-процесс:

`PR → Quality → merge в main → Deploy Production → RC106 smoke`.

## Локальная проверка

```bash
npm ci
npm run security:scan
npm run check
npm test
npm run verify:release
npm run verify:worker
```

Все команды должны завершиться без ошибок до merge.

## После deploy

Проверьте:

1. `/health` возвращает `ok=true`, версию `6.98.0-rc106` и `releaseCandidate=RC106`.
2. RC Regression не содержит blocking failures.
3. `DEV_MODE=false` и `MONETIZATION_ENABLED=false`.
4. Обычный пользователь не видит административные controls.
5. `/health/supabase` не доступен публично.
6. CSP, HSTS, `X-Content-Type-Options: nosniff` и остальные security headers присутствуют.
7. Production smoke подтверждает обязательные RC106 release/self-test flags, включая `providerDataReliability`, `aiAnalysisQualityGate`, `telegramMiniAppE2E` и `telegramMiniAppE2ESelfTest`.

## Rollback

Для аварийного возврата используйте workflow `Rollback Production`:

1. Укажите Cloudflare Worker `version_id`, который нужно восстановить.
2. Укажите `expected_version` в формате вроде `6.94.0-rc102`.
3. Подтвердите действие значением `ROLLBACK`.
4. Workflow до отката проверит credentials, формат version ID, expected version и наличие HTTPS `CLOUDFLARE_WORKER_URL`.
5. После отката `scripts/rollback-smoke.js` подтвердит точную восстановленную версию, `DEV_MODE=false` и отсутствие публичного технического Supabase health.

Rollback меняет только версию Worker и **не откатывает состояние Supabase**. Изменения базы требуют отдельного SQL rollback-плана/резервной копии; RC103 не выполняет автоматический SQL rollback.
