# QA Release Checklist — v6.5.0 RC13

## Deploy
- применён `supabase_migration_v6_5.sql`;
- Worker/client = `6.5.0-rc13`;
- cron, Secrets, wrangler не менялись;
- monetization paused.

## Settlement Finality
- model_predictions имеет settlement_verification_state;
- допустимые state: unverified / verified / drift;
- settlement_verification_events доступна backend service role;
- новый settlement стартует как unverified;
- verifier не трогает settlement моложе 6 часов;
- verified требует совпадение score + outcome;
- provider AWD/WO/CANC/ABD трактуется как drift;
- drift не переписывает actual_home_goals / actual_away_goals / actual_outcome;
- drift создаёт audit event;
- drift исключается из model-quality;
- drift исключается из calibration;
- дневной run ограничен 100 fixture / 3 датами.

## UI
- Settlement finality показывает VERIFIED / PENDING / DRIFT;
- видны verified / pending / drift counters;
- admin Telegram ID по-прежнему не раскрывается.

## RC13
Обязательный PASS:
- Prediction Integrity self-test;
- Prediction Remediation self-test;
- Settlement Watchdog self-test;
- Settlement Run Ledger self-test;
- Settlement Finality schema v6.5;
- Settlement Finality self-test;
- Production Load Safety;
- Admin Security.

## Инварианты
Prediction snapshot и сохранённый settlement не исправляются молча. Telegram Stars остаются paused.
