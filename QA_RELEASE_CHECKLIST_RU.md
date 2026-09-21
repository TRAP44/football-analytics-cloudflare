# QA Release Checklist — v6.4.0 RC12

## Deploy
- применён `supabase_migration_v6_4.sql`;
- версия Worker/client = `6.4.0-rc12`;
- cron, Secrets и wrangler не менялись;
- monetization paused.

## Run Ledger
- schema fields updated_at / finished_at / attempt_no / retry_of_action_id доступны;
- default attempt_no = 1;
- status допускает interrupted;
- active started блокирует новый unattended run;
- started старше 30 минут переводится в interrupted;
- reconciliation не удаляет audit row;
- exact batch retry получает attempt 2/3 и retry_of_action_id;
- после attempt 3 следующий retry блокируется;
- другая fixture batch начинает новую lineage с attempt 1;
- terminal status записывает finished_at.

## Circuit Breaker
- interrupted reconciliation считается failed reliability outcome;
- AUTO toggle не обходит OPEN breaker;
- manual circuit reset остаётся admin-only с обязательной причиной.

## UI
- Run ledger показывает CLEAR / BUSY / STALE;
- история показывает interrupted;
- виден номер attempt и признак retry;
- admin Telegram ID не отображается.

## RC12
Обязательный PASS:
- Prediction Integrity self-test;
- Prediction Remediation self-test;
- Settlement Watchdog self-test;
- Settlement Run Ledger schema v6.4;
- Settlement Run Ledger self-test;
- Runtime Controls / rollback;
- Production Load Safety;
- Admin Security.

## Инварианты
Prediction snapshots остаются immutable. Telegram Stars остаются paused.
