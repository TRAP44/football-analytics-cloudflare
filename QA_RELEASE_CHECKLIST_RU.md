# QA Release Checklist — v6.6.0 RC14

## Deploy
- применён `supabase_migration_v6_6.sql`;
- Worker/client = `6.6.0-rc14`;
- cron, Secrets и wrangler не менялись;
- monetization paused.

## Drift Review
- drift queue доступна только admin UI;
- queue читает только `status=settled + verification_state=drift`;
- latest drift event используется как source event;
- resolution token меняется при изменении stored/provider snapshot;
- reason минимум 5 символов;
- source_event_id разрешается только один раз;
- before/provider/after сохраняются в audit;
- admin Telegram ID не выводится в интерфейс.

## Actions
- keep_stored не меняет score/outcome;
- accept_provider разрешён только FT/AET/PEN с валидным score/outcome;
- accept_provider пересчитывает correct/Brier/Over2.5/BTTS outcome fields;
- CANC/ABD/AWD/WO блокируются для accept_provider;
- void_prediction переводит status в void;
- успешное решение переводит verification state в adjudicated.

## Regression
Обязательный PASS:
- Prediction Integrity self-test;
- Prediction Remediation self-test;
- Settlement Watchdog self-test;
- Settlement Run Ledger self-test;
- Settlement Finality self-test;
- Settlement Adjudication schema v6.6;
- Settlement Adjudication self-test;
- Production Load Safety;
- Admin Security.

## Инварианты
Автоматические процессы не переписывают drift settlement. Изменение возможно только explicit admin adjudication. Telegram Stars остаются paused.
