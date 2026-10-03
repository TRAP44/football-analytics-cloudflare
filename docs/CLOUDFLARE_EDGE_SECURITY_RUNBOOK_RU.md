# MatchRadar — Cloudflare WAF + Edge Rate Limits

## Цель

Issue #386 переносит грубое отсечение abuse-трафика максимально близко к Cloudflare edge и не заменяет существующие server-side проверки Telegram auth, request-shape guard, per-user burst guard и Supabase distributed rate limit.

## Текущее состояние production

Production URL сейчас использует `football-analytics-cloudflare.wok-side.workers.dev`.

Для текущего `workers.dev` endpoint в коде включён Cloudflare Workers Rate Limiting binding:

| Контур | Binding | Порог | Назначение |
| --- | --- | ---: | --- |
| AI analyze | `EDGE_ANALYZE_RATE_LIMIT` | 30 / 60 сек | грубый pre-auth ceiling перед более строгими user quota/burst guards |
| billing + admin-sensitive | `EDGE_SENSITIVE_RATE_LIMIT` | 120 / 60 сек | отсечение очевидных бурстов по чувствительным API |
| Telegram webhook | `EDGE_WEBHOOK_RATE_LIMIT` | 6000 / 60 сек | очень высокий аварийный потолок, чтобы не мешать нормальной доставке Telegram |

Ключ счётчика строится из необратимого SHA-256 fingerprint сетевого адреса. Raw IP не пишется в telemetry, ops_events или ответы.

Важно: Workers Rate Limiting API вызывается после старта Worker. Это защита ранней границы Worker и provider/business logic, но **не заменяет zone WAF, который должен отбрасывать запрос до запуска Worker**.

## Почему zone WAF пока не включён автоматически

WAF Custom Rules и zone Rate Limiting Rules относятся к Cloudflare zone. Текущий production hostname находится на `workers.dev`, а не на пользовательском Custom Domain/Route.

Перед широким рекламным трафиком нужен отдельный hostname в Cloudflare zone, например `app.example.com`, подключённый к Worker как Custom Domain. До завершения миграции `workers.dev` нельзя отключать: он нужен как rollback-путь. После проверки нового hostname старый публичный `workers.dev` нужно отключить, иначе он останется обходным путём вокруг zone WAF.

## Рекомендуемая конфигурация zone WAF после подключения Custom Domain

### 1. Scanner/block rule

Action: **Block**, не Challenge.

Применять только к production hostname и очевидным scanner paths, например:

```text
(http.host eq "<PRODUCTION_HOST>" and (
  http.request.uri.path contains "/.env" or
  http.request.uri.path contains "/.git" or
  http.request.uri.path contains "/wp-admin" or
  http.request.uri.path contains "/wp-login" or
  http.request.uri.path contains "/phpmyadmin" or
  http.request.uri.path contains "/vendor/phpunit" or
  http.request.uri.path contains "/actuator" or
  http.request.uri.path contains "/server-status"
))
```

Не добавлять CAPTCHA/Managed Challenge в нормальный Telegram Mini App flow.

### 2. Rate limiting rule для чувствительного API

На Free plan доступна одна zone rate-limiting rule, поэтому в первую очередь защищать дорогие/чувствительные API, а Telegram webhook оставить вне этой низкой квоты:

```text
(http.host eq "<PRODUCTION_HOST>" and (
  http.request.uri.path eq "/api/analyze" or
  starts_with(http.request.uri.path, "/api/billing/") or
  starts_with(http.request.uri.path, "/api/admin/") or
  starts_with(http.request.uri.path, "/api/runtime-controls")
))
```

Стартовый coarse threshold: 120 запросов / 60 секунд на source IP, Action **Block**. Это не пользовательская квота и не заменяет server-side лимиты. После реального soft-launch трафика threshold нужно корректировать по Security Events/Worker telemetry.

Если план даёт несколько rate-limit rules, вынести `/api/analyze` в отдельный более строгий rule, а admin/billing оставить отдельно.

### 3. Telegram webhook

`/telegram/webhook` не должен получать CAPTCHA/Managed Challenge. Webhook уже защищён Telegram secret-token validation, persistent dedupe и Worker burst guard.

Для текущего `workers.dev` дополнительно действует высокий Cloudflare binding ceiling 6000/60 сек на network fingerprint. После перехода на Custom Domain можно добавить отдельный очень высокий zone rate-limit только после наблюдения реального Telegram ingress. Не смешивать webhook с низкой API-квотой.

### 4. Bot Fight Mode

Не включать/не менять Bot Fight Mode как часть #386 без отдельного webhook E2E. На Free plan Bot Fight Mode нельзя выборочно skip-нуть custom rule для Telegram webhook, поэтому он может нарушить требование «не ломать Telegram».

## Миграция на Custom Domain

1. Добавить hostname в Cloudflare zone: Worker → Settings → Domains & Routes → Add → Custom Domain.
2. Оставить `workers.dev` включённым на время проверки.
3. Настроить WAF scanner rule и API rate-limit rule на новом hostname.
4. Обновить production URL в GitHub workflow/monitor и Telegram Mini App/Webhook только после готовности hostname.
5. Проверить:
   - `/health/live`;
   - `/health/ready`;
   - `/api/public-status`;
   - Mini App launch;
   - Telegram webhook;
   - billing plans/invoice без реальной покупки;
   - `/api/analyze` с нормальным пользователем.
6. Дождаться зелёных Quality / Deploy Production / External Production Monitor.
7. Только после этого отключить публичный `workers.dev`, чтобы WAF нельзя было обойти прямым URL.

## Rollback

Если после WAF/rate-limit настройки есть false positive:

1. Сначала отключить/поставить в Log offending zone rule — не менять Worker secrets.
2. Если проблема в Custom Domain, вернуть Telegram WebApp/Webhook/monitor на проверенный `workers.dev` URL.
3. Не удалять Custom Domain и не отключать `workers.dev` до подтверждения восстановления.
4. Проверить `/health/live`, `/health/ready`, `/api/public-status` и External Production Monitor.
5. Worker bindings можно удалить отдельным PR, если они сами вызывают ошибку; их отказ уже fail-open и не должен ронять приложение.

## Ссылки Cloudflare

- Workers Rate Limiting: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Workers routes/domains: https://developers.cloudflare.com/workers/configuration/routing/
- Custom Domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- WAF: https://developers.cloudflare.com/waf/
- WAF Rate Limiting Rules: https://developers.cloudflare.com/waf/rate-limiting-rules/


## Модель идентичности rate limit

Cloudflare Rate Limiting используется только как defense-in-depth до бизнес-логики и не является механизмом аутентификации или авторизации.

- Для Telegram API-запроса с `x-telegram-init-data` edge-key строится из криптографического хэша initData вместе с сетевым контекстом. Два валидных Telegram-пользователя за одним NAT/IP не делят один bucket.
- Сырые IP, initData и Telegram user ID в ключах/логах limiter не сохраняются.
- Если initData отсутствует, используется хэш сетевого IP как coarse fallback.
- Ротация произвольного невалидного initData не отменяет отдельный Worker pre-auth IP burst guard: он остаётся независимым слоем защиты.
- Успешное прохождение edge limiter ничего не говорит о валидности Telegram-подписи; криптографическая проверка initData и серверная авторизация выполняются отдельно.
