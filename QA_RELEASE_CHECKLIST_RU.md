# QA Release Checklist — v6.104.0 RC128

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

- `package.json` и `package-lock.json`: `6.104.0`.
- Worker и client: `6.104.0-rc128`.
- Release candidate: `RC128`.
- Production workflow запускается только после успешного Quality.
- Post-deploy smoke проверяет ту же версию и RC.

## Supabase

Для нового проекта используется только `supabase/baseline/supabase_baseline_v6_18.sql`.

Для существующей базы должны быть применены:
`supabase/migrations/supabase_migration_v6_9.sql`, `v6_10`, `v6_11`, `v6_11_1`, `v6_12`, `v6_13`, `v6_14`, `v6_15`, `v6_16`, `v6_17`, `v6_18`, `v6_18_1`.

Проверить:
- RLS и закрытые backend-only таблицы не открыты для `anon/authenticated`;
- service-role ключ не попадает в клиент;
- `MONETIZATION_ENABLED=false`;
- `DEV_MODE=false`.

## RC128 — Multi-Provider Data Service & Provenance

- API-Football остаётся primary provider; резервный источник не заменяет рабочий primary без причины.
- Турнирные таблицы используют единый provider chain и нормализованный внутренний формат.
- OpenLigaDB разрешён только для явно поддерживаемых соревнований; provider IDs не выдаются за API-Football team IDs.
- football-data.org не вызывается без `FOOTBALL_DATA_TOKEN`; токен остаётся только в Worker secrets.
- OpenLigaDB и football-data.org проходят через distributed minute guard `claim_provider_request`.
- Fallback-таблица сохраняется на 30 минут, primary-таблица — на 6 часов; stale cache остаётся последним безопасным слоем.
- Mini App показывает provider attribution и data provenance; неизвестность источника не преобразуется в нулевые аналитические сигналы.
- RC128 не требует DDL: schema fingerprint остаётся `c2c22ec25aacfcf1b9938b0850cebf49`.
- Regression: `test/data-service-rc128.test.js`.

## RC127 — Production Hardening

- AI-квота списывается через atomic RPC `consume_analysis_quota`; два параллельных запроса не могут оба пройти последний слот. Hotfix v6.18.1 дополнительно создаёт минимальную строку `users` до `usage_daily`, закрывая FK-race первого анализа.
- Неуспешный свежий расчёт возвращает зарезервированный слот через `refund_analysis_quota`.
- API-Football получает distributed minute guard `claim_provider_request`, общий для Cloudflare isolates.
- Daily digest использует `claim_daily_digest → complete_daily_digest/release_daily_digest`, поэтому retry/parallel cron не отправляет дубли.
- Полный schema fingerprint `backend_schema_fingerprint` дополняет точечные compatibility probes. Ожидаемый fingerprint: `c2c22ec25aacfcf1b9938b0850cebf49`.
- `/health/live` проверяет только Worker liveness; `/health/ready` проверяет Supabase, schema fingerprint, backend ACL, Telegram config и свежие Supabase auth failures.
- Production smoke обязан пройти `/health/ready`; старый декларативный `ok=true` больше недостаточен.
- Supabase `HTTP 401/PGRST303` текущей release identity считается incident.
- Distributed analysis lock при ошибке coordination работает fail-closed и отдаёт stale cache/503 вместо параллельного дорогого compute.
- Telegram initData: admin-sensitive запросы — максимум 15 минут; mutations — 2 часа; read-only — до 24 часов.
- Backend RPC доступны только `service_role`; у service-role сняты ненужные `TRUNCATE/REFERENCES/TRIGGER`.
- Supabase schema: v6.18; regression: `test/production-hardening-rc127.test.js`.

## Исторические RC72–RC126

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
- `/health/ready` возвращает `ok=true`, `status=ready`;
- `version = 6.103.0-rc127`;
- `releaseCandidate = RC127`;
- `devMode = false`;
- Supabase/PostgREST, schema fingerprint и backend security checks = `ok`;
- свежих Supabase auth failures текущей версии нет;
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
