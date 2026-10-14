# Проверка инфраструктуры через существующие GitHub secrets

Workflow **Audit Infrastructure Capacity** запускается вручную на main. Он читает те же secrets `production`, что и Deploy Production: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, SUPABASE_ACCESS_TOKEN; ref базы берётся из vars.SUPABASE_PROJECT_REF, как в проверке миграций. Переносить их значения в Codex не нужно. Workflow не создаёт ресурсы, не запускает SQL/нагрузку, не покупает тарифы и не меняет production.

После слияния PR: GitHub → Actions → Audit Infrastructure Capacity → Run workflow → main. В Summary будет обезличенный отчёт, artifact infrastructure-capacity-audit хранится 7 дней. Запуск с другой ветки пропускается, исходники берутся только из main. У job permissions.contents:read; секреты доступны только отдельному шагу. Значения, заголовки, сырые ответы, billing details и ошибки transport не выводятся.

## Что проверяется

- GET Cloudflare /accounts/{account_id}/workers/account-settings: default_usage_model. Это модель учёта, а не доказательство Free/paid.
- GET Cloudflare /accounts/{account_id}/subscriptions: только ярлыки подписок Workers и их состояния, без цен/счетов/платёжных данных. Пустой список не означает Free. Endpoint требует Billing Read; успешный деплой не доказывает наличие этого права.
- GET Supabase /v1/projects/{ref}: статус выбранного проекта, регион и версия PostgreSQL. Идентификатор ответа должен соответствовать настроенному ref; произвольные projects не перебираются.
- GET Supabase /v1/projects/{ref}/billing/addons: только выбранный compute variant, например ci_micro. Compute не равен тарифу организации. Тариф Supabase/настоящие ограничения пула/производительность БД использованные публичные endpoints не подтверждают.

Схемы сверены по официальным OpenAPI Cloudflare api-schemas/openapi.json и Supabase apps/docs/spec/api_v1_openapi.json. Никаких guessed billing endpoints.

## Как читать результат

`observed` — конкретный endpoint прочитан и минимальная структура проверена; `unavailable` + HTTP status — отказ API (401/403/429/5xx), `invalid_response` — неожиданный формат, `not_configured` — обязательная пара настроек отсутствует/невалидна. В configuredInputs только true/false наличия каждой настройки. Missing не означает, что нужно создавать новый токен: сначала проверить существующие bindings окружения production.

Если хотя бы один endpoint не прочитан, job завершится ошибкой, но безопасный JSON и Summary сохраняются. Это незавершённое обследование, а не отказ работающего приложения. Все API-наблюдения могут быть получены, но organizationPlan останется unknown: это явно отдельный результат. Даже зелёный job никогда не означает готовность к 1000 concurrent — productionCapacityConfirmed всегда false.

Отказ чтения подписок при рабочем deployment token обычно требует проверить Billing Read для этого endpoint; не менять рабочий секрет автоматически и не расширять права вслепую. Неизвестный тариф Supabase подтверждается владельцем в Billing организации. Нагрузку выполнять только после подготовки отдельного Worker/Supabase с явным бюджетом API-Football; к этому workflow она не привязана.

## Локальные проверки

`node --test test/infrastructure-capacity-audit.test.js test/privileged-access-audit.test.js` проверяет только подставные API: фиксированные GET и destinations, отсутствие значений credentials/лишних fields в отчёте, запрет догадок по пустым подпискам, missing/invalid config без запросов, 401/403/429/500/redirect/transport/malformed errors, привязку workflow к main/production и allowlist secrets. Локальная среда не имеет credentials провайдеров; настоящий аудит выполняется внутри GitHub после слияния workflow.
