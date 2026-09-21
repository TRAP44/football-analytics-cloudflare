# QA Release Checklist — v6.9.0 RC17

## Deploy

- применён `supabase_migration_v6_9.sql` либо fresh baseline;
- Worker/client = `6.9.0-rc17`;
- package = `6.9.0`;
- cache generation = `3.9-champion1`;
- Secrets проверены по `.env.example`;
- `DEV_MODE=false`;
- `MONETIZATION_ENABLED=false` до отдельного решения о запуске оплаты.

## Champion–Challenger

- в `model_calibration_state` существует строка `global`;
- задан ровно один `active_fingerprint`;
- fingerprint зависит только от production-параметров профиля;
- challenger не меняет прогноз до двух успешных holdout-окон;
- каждое окно содержит минимум 20 trusted матчей;
- на каждом окне Brier gain >= 0.001 и log loss не ухудшается;
- новый прогноз сохраняет `calibration_profile_fingerprint`;
- post-promotion guard ждёт минимум 20 trusted матчей;
- rollback возвращает `previous_fingerprint` и создаёт `ops_events` audit.

## Database

- все server-only таблицы имеют RLS;
- `anon` и `authenticated` не имеют прямого доступа;
- `service_role` имеет необходимые права Data API;
- foreign key и filtered-query колонки индексированы;
- fresh-install baseline применяется к пустой базе без ручного добавления таблиц.

## Automated checks

Обязательный PASS:

```bash
npm run check
npm test
npm run verify:release
```

Также обязательны встроенные проверки:

- Prediction Integrity;
- Trusted Metrics Gate;
- Two-Pass Settlement Finality;
- Settlement Adjudication;
- Calibration Promotion self-test;
- Calibration Lifecycle schema;
- Production Load Safety;
- Admin Security.
