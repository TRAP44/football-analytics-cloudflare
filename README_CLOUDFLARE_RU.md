# Football Analytics Mini App v6.3.0 — RC11 Settlement Circuit Breaker & Reliability SLO

RC11 добавляет fail-safe поверх автоматического settlement catch-up из RC10.

## Что нового

- persistent состояние reliability в Supabase;
- consecutive failure counter для unattended auto recovery;
- circuit breaker открывается после 2 последовательных failed AUTO run;
- breaker блокирует автоматический provider-write на 72 часа;
- completed или partial recovery закрывает breaker и сбрасывает счётчик;
- admin может вручную закрыть breaker, указав причину;
- reset записывается в prediction remediation audit как `circuit_reset`;
- состояние breaker видно в Integrity Remediation;
- runtime AUTO toggle и circuit breaker независимы: AUTO=ON не обходит OPEN breaker.

## Почему это нужно

RC10 сделал recovery автоматическим, но unattended automation не должна бесконечно повторять потенциально проблемную запись после серии provider/database failures. RC11 превращает watchdog в fail-closed систему.

## Инварианты

RC11 не меняет probabilities, model weights, captured_at, analysis_version и signal snapshots. Breaker управляет только разрешением автоматического settlement recovery.

## Migration

Перед deploy выполнить `supabase_migration_v6_3.sql`.

## Health

`/health`:
- version = `6.3.0-rc11`
- releaseCandidate = `RC11`
- settlementWatchdog = enabled
- automaticSettlementRecovery = runtime-controlled
- settlementCircuitBreaker = enabled
- settlementReliability = enabled
- monetization = paused

## Монетизация

Telegram Stars остаются paused.
