# QA Release Checklist — v6.95.0 RC103

Этот файл содержит только актуальный gate. Исторические RC-контракты проверяются regression-тестами и Git history.

## Перед merge/deploy

```bash
npm ci
npm test
npm run verify:release
npm run verify:worker
```

Все команды должны завершиться без ошибок.

## Версия и release contract

- `package.json` и `package-lock.json`: `6.95.0`.
- Worker и client: `6.95.0-rc103`.
- Release candidate: `RC103`.
- Production workflow запускается только после успешного Quality.
- Post-deploy smoke проверяет ту же версию и RC.

## Supabase

Для нового проекта используется только `supabase/baseline/supabase_baseline_v6_15.sql`.

Для существующей базы должны быть применены:
`supabase/migrations/supabase_migration_v6_9.sql`, `v6_10`, `v6_11`, `v6_11_1`, `v6_12`, `v6_13`, `v6_14`, `v6_15`.

Проверить:
- RLS и закрытые backend-only таблицы не открыты для `anon/authenticated`;
- service-role ключ не попадает в клиент;
- `MONETIZATION_ENABLED=false`;
- `DEV_MODE=false`.

## RC103 — Production Monitoring & Recovery

- Cloudflare cron запускает production monitor каждые 15 минут.
- Monitor не расходует API-Football и не меняет пользовательские данные или runtime controls.
- Проверяются Supabase, актуальная схема v6.15 и operational errors за последний час.
- `incident` становится блокирующим `production_monitor` в Release Readiness.
- Monitor записывает только изменение состояния или редкий heartbeat; собственные monitor-события исключены из error budget.
- `/api/production-monitor` доступен только администратору.
- Исправлен `apiProductionReadiness`: `checks` объявляется до любых добавлений self-test результатов.
- `/health` обязан публиковать `productionMonitor=enabled`, `productionMonitorSelfTest=enabled`, `rollbackVerification=enabled`.
- `Rollback Production` требует Cloudflare version ID, ожидаемую app version и настроенный `CLOUDFLARE_WORKER_URL`.
- После rollback обязательна независимая проверка точной версии, `DEV_MODE=false` и закрытого `/health/supabase`.
- Автоматический rollback намеренно не включён: восстановление остаётся подтверждаемым ручным действием.
- Regression: `test/production-monitor-recovery-rc103.test.js`.
## Исторические RC72–RC102

Детальные исторические release-контракты удалены из текущего checklist, чтобы не дублировать Git history и regression-тесты. Их поведение продолжает проверяться соответствующими файлами `test/*-rcXX.test.js`, а продуктовая сводка сохранена в `README_CLOUDFLARE_RU.md`.

## Критический regression-контур

Обязательно должны оставаться зелёными тесты:
- поиск и выбор матча;
- Telegram quick AI → Mini App handoff;
- freshness/recheck/delta;
- kickoff handoff;
- post-match review/return;
- AI track record;
- fixture deep-link + distributed lock;
- media publisher/control room;
- news conversion → smart fixture → impact delta → decision card;
- русская локализация и access/security contracts.

## Production smoke

`scripts/post-deploy-smoke.js` должен подтвердить:
- `/health.ok = true`;
- `version = 6.95.0-rc103`;
- `releaseCandidate = RC103`;
- `devMode = false`;
- обязательные self-test/feature flags = `enabled`;
- `/health/supabase` не доступен публично;
- public status/manifest возвращают текущую версию.

## Ручная проверка Telegram / Mini App

1. Найти клуб и открыть основной матч.
2. Получить Quick AI в Telegram и открыть полный анализ без повторного списания.
3. Проверить freshness/recheck перед стартом.
4. Проверить корректный handoff после начала матча.
5. Открыть новость клуба → AI-проверку → News Impact Decision Card.
6. Убедиться, что профиль обычного пользователя не показывает админские controls.
7. Убедиться, что весь пользовательский и административный интерфейс остаётся русскоязычным.
