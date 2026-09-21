# QA Release Checklist — v6.3.0 RC11

## Deploy
- применён `supabase_migration_v6_3.sql`;
- Worker/client обновлены;
- cron, Secrets и wrangler не менялись;
- monetization остаётся paused.

## Settlement Circuit Breaker
- schema `settlement_watchdog_state` доступна;
- default: consecutive_failures=0, circuit CLOSED;
- один failed AUTO run не открывает breaker;
- второй последовательный failed AUTO run открывает breaker на 72 часа;
- при OPEN decision = circuit_open и provider calls отсутствуют;
- completed/partial AUTO run сбрасывает failures и закрывает breaker;
- ручной reset требует admin + reason;
- reset записывается как `circuit_reset / admin / completed`;
- AUTO runtime switch не обходит OPEN breaker.

## UI
- Integrity Remediation показывает CLOSED/OPEN;
- отображается failure counter и open-until;
- кнопка сброса появляется только при OPEN;
- admin Telegram ID не выводится.

## Regression
Обязательный PASS:
- Prediction Integrity self-test;
- Prediction Remediation self-test;
- Settlement Watchdog self-test с circuit_open;
- Settlement reliability schema v6.3;
- Runtime Controls / rollback;
- Production Load Safety;
- Admin Security;
- Supabase required tables.

## Инварианты
Immutable prediction snapshot fields не меняются. Telegram Stars остаются paused.
