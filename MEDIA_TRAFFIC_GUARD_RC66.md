# RC66 — Media Traffic Guard & Viral Load Safety

## Цель

После RC65 один матч можно массово распространять через СМИ и Telegram-каналы. RC66 защищает бесплатную/ограниченную квоту API-Football от ситуации, когда много пользователей одновременно открывают один холодный fixture и несколько Cloudflare Worker instances начинают одинаковый AI-расчёт.

## Что уже было

`apiFootball` использует in-process `withSingleFlight`, поэтому одинаковые запросы внутри одного Worker isolate объединяются. Per-user Burst Guard также ограничивает повторные действия одного пользователя.

Этого недостаточно для вирусного трафика: Cloudflare может обслуживать разных пользователей несколькими isolate одновременно.

## Distributed fixture lock

Для холодного `/api/analyze` RC66 создаёт короткоживущий lock в существующей таблице `analysis_cache`:

`analysis:compute-lock:<fixtureId>:v1`

Lock создаётся атомарным PostgREST insert с `on_conflict=cache_key` и `resolution=ignore-duplicates`.

- TTL lock: 90 секунд;
- один Worker становится owner;
- остальные Worker instances не начинают одинаковый provider fan-out;
- новая миграция Supabase не нужна.

## Поведение join-запроса

Не-owner ждёт shared analysis cache до 4 раз по 1.6 секунды.

Если расчёт успел завершиться, пользователь получает готовый анализ с `sharedJoin=true`.

Если новый cache ещё не готов, но старый анализ существует, пользователю показывается stale snapshot с объяснением, что свежий расчёт уже выполняется.

Если нет даже stale snapshot, API возвращает `ANALYSIS_WARMING` и `Retry-After: 5` вместо запуска второго тяжёлого расчёта.

## Очистка lock

Owner освобождает lock в `finally`, поэтому обычные success/error/early-return пути не оставляют его висеть. Перед удалением проверяется `claimId`, чтобы один Worker не удалил lock другого.

TTL остаётся последней защитой на случай аварийного завершения Worker.

## Fail-open

Если Supabase lock storage временно недоступен, RC66 не отключает AI. Lock переходит в `fail-open`: запрос продолжает обычный расчёт, а в telemetry/ops фиксируется `ANALYSIS_LOCK_FAIL_OPEN`.

Это осознанный компромисс: при проблеме lock storage важнее сохранить пользовательскую доступность, даже если временно ухудшится cross-instance dedupe.

## Наблюдаемость

`productionSafetySnapshot` показывает:

- claims;
- joins;
- join hits;
- timeouts;
- fail-open;
- текущую lock policy.

`Production Readiness` содержит blocking self-check `distributed_analysis_lock`.

## Что RC66 не делает

RC66 не запускает внешний load generator и не создаёт искусственный трафик в Production. Это важно на бесплатной квоте API-Football. Защита проверяется детерминированными regression/self-tests и реальной telemetry после публикаций.

## Production gate

`distributedAnalysisLockDrill` проверяет key/TTL/max-wait policy. Release требует зелёные regression tests, release verification, Worker dry-run и post-deploy smoke.