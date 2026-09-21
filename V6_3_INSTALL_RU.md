# Установка v6.3.0 RC11

## Шаг 1 — Supabase

Сначала должна быть применена migration v6.2.

Выполнить целиком:

`supabase_migration_v6_3.sql`

Она создаёт `public.settlement_watchdog_state` и разрешает audit action `circuit_reset`.

## Шаг 2 — GitHub / Deploy

Обновить Worker, client, HTML, package, README и QA checklist. Добавить migration v6.3 и этот файл.

`wrangler.jsonc`, Secrets и cron менять не нужно.

## Шаг 3 — безопасный режим

AUTO toggle RC10 остаётся отдельным runtime switch. RC11 не включает его автоматически.

Circuit breaker:
- 0–1 последовательный failed AUTO run: CLOSED;
- 2 последовательных failed AUTO run: OPEN;
- OPEN блокирует unattended provider-write на 72 часа;
- completed/partial run сбрасывает failure counter;
- ручной reset доступен только администратору и требует причины;
- reset записывается в audit trail как `circuit_reset`.

## Шаг 4 — Health / QA

Ожидается:
- version = `6.3.0-rc11`
- releaseCandidate = `RC11`
- settlementWatchdog = `enabled`
- automaticSettlementRecovery = `runtime-controlled`
- settlementCircuitBreaker = `enabled`
- settlementReliability = `enabled`
- monetization = `paused`

В профиле → Качество модели → Integrity Remediation проверить карточку Circuit breaker и RC11 regression QA.
