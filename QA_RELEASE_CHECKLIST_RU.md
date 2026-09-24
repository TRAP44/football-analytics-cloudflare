# QA Release Checklist — v6.101.0 RC109

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

- `package.json` и `package-lock.json`: `6.101.0`.
- Worker и client: `6.101.0-rc109`.
- Release candidate: `RC109`.
- Production workflow запускается только после успешного Quality.
- Post-deploy smoke проверяет ту же версию и RC.

## Supabase

Для нового проекта используется только `supabase/baseline/supabase_baseline_v6_17.sql`.

Для существующей базы должны быть применены:
`supabase/migrations/supabase_migration_v6_9.sql`, `v6_10`, `v6_11`, `v6_11_1`, `v6_12`, `v6_13`, `v6_14`, `v6_15`, `v6_16`, `v6_17`.

Проверить:
- RLS и закрытые backend-only таблицы не открыты для `anon/authenticated`;
- service-role ключ не попадает в клиент;
- `MONETIZATION_ENABLED=false`;
- `DEV_MODE=false`.

## RC109 — Supabase Probe Confirmation Guard

- Диагностика и Production Monitor используют `probeSupabaseConfirmed()`.
- Если первый Supabase probe успешен, второго запроса нет.
- Если первый probe не прошёл, выполняется один подтверждающий retry с короткой задержкой.
- Успешный retry сохраняет `ok=true`, `attempts=2`, `recovered=true` и не создаёт ложный production incident.
- Два последовательных отказа остаются fail-closed: `confirmedFailure=true` и блокирующий статус сохраняется.
- Transient recovery записывается отдельно как `SUPABASE_PROBE_RECOVERED`, поэтому нестабильность не скрывается.
- Runtime telemetry считает `supabaseProbeRecoveries` и `supabaseProbeConfirmedFailures`.
- Release Readiness и Production Readiness содержат blocking check `supabase_probe_confirmation`.
- Админская диагностика показывает число попыток, recoveries и confirmed failures.
- `/health`: `supabaseProbeConfirmation=enabled` и `supabaseProbeConfirmationSelfTest=enabled`.
- Regression: `test/supabase-probe-confirmation-rc109.test.js`.
- Новая Supabase migration не требуется; production schema остаётся v6.17.

## Исторические RC72–RC108

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
- `version = 6.101.0-rc109`;
- `releaseCandidate = RC109`;
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
