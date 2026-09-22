# QA Release Checklist — v6.14.0 RC22

## Deploy

- применены `supabase_migration_v6_9.sql`, `supabase_migration_v6_10.sql`, `supabase_migration_v6_11.sql` и `supabase_migration_v6_11_1.sql`;
- Worker/client = `6.14.0-rc22`;
- package = `6.14.0`;
- cache generation = `4.0-atomic1`;
- Secrets проверены по `.env.example`;
- `DEV_MODE=false`;
- `MONETIZATION_ENABLED=false` до отдельного решения о запуске оплаты.
- production environment содержит `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID`;
- Cloudflare token ограничен нужным account и Workers Edit;
- `Deploy Production` запускается только после успешного `Quality` на `main`;
- deploy использует `--keep-vars` и не удаляет dashboard variables;
- отсутствие любого Cloudflare credential завершает deploy workflow ошибкой;
- `public/_headers` содержит Telegram-compatible CSP и обязательные browser security headers;

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
- transition RPC блокирует stale revision с SQLSTATE `40001`;
- promotion/rollback и смена статусов профилей атомарны;
- freeze блокирует автоматические переходы;
- manual rollback разрешён только на `previous_fingerprint`;
- каждый переход записан в `model_calibration_transitions`.

## Admin Access

- реальный Telegram-пользователь без allowlist не получает admin даже при `DEV_MODE=true`;
- синтетический dev-admin помечается сервером и имеет ID `999001`;
- PREMIUM и другие тарифы не дают admin-права;
- клиент показывает бейдж только когда сервер одновременно вернул `isAdmin=true` и `role=admin`;
- `/api/calibration-control` возвращает `403` обычному пользователю.

## Database

- все server-only таблицы имеют RLS;
- `anon` и `authenticated` не имеют прямого доступа;
- `service_role` имеет необходимые права Data API;
- `PUBLIC`, `anon` и `authenticated` не имеют прав на backend tables/sequences/RPC;
- default privileges сохраняют тот же запрет для будущих объектов;
- `backend_security_contract()` и `backend_default_acl_contract()` возвращают `ok=true` только через `service_role`;
- Release Readiness и RC Regression блокируются при нарушении security contract;
- foreign key и filtered-query колонки индексированы;
- fresh-install baseline v6.9 и migrations v6.10–v6.11.1 применяются к пустой базе без ручного добавления таблиц.

## Automated checks

Обязательный PASS:

```bash
npm run check
npm test
npm run verify:release
npm run verify:worker
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
- Cloudflare post-deploy smoke.

## Post-deploy

- `/health` возвращает `6.14.0-rc22`, `RC22` и `devMode=false`;
- `cloudflareDeploymentGate=enabled`;
- `browserSecurityPolicy=enabled` и `failClosedDeployment=enabled`;
- `/api/app-manifest` соответствует версии Worker;
- `/`, CSS и JS доступны после обновления asset cache key;
- `/` содержит CSP с официальным Telegram SDK, `object-src 'none'` и `X-Content-Type-Options: nosniff`;
- `/api/me`, `/api/release-readiness` и `/api/calibration-control` без Telegram initData возвращают `401`;
- `/health/supabase` публично недоступен;
- при ошибке используется `Rollback Production` с предыдущим version ID.
