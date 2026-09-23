# QA Release Checklist — v6.99.0 RC107

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

- `package.json` и `package-lock.json`: `6.99.0`.
- Worker и client: `6.99.0-rc107`.
- Release candidate: `RC107`.
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

## RC107 — Multi-user / Public Release Hardening

- Existing fixture-level distributed lock по-прежнему объединяет одинаковый матч между разными пользователями.
- Новый distributed per-user analysis lease допускает не более одного fresh AI compute на пользователя одновременно, даже между Worker-инстансами.
- Lease использует существующий `analysis_cache`, TTL 120 секунд и не требует новой Supabase migration.
- При параллельном анализе другого матча возвращается `ANALYSIS_USER_BUSY` + `Retry-After: 8`; второй дорогостоящий compute не запускается.
- Fresh usage increment выполняется внутри user lease, уменьшая риск race-condition в дневном usage read→write.
- `/api/analyze` остаётся ограничен 3 запросами / 30 сек. на пользователя; `/api/search` — 10 / 10 сек.
- Existing same-fixture shared compute и quota-safe cached handoff не меняются.
- Mini App различает `ANALYSIS_USER_BUSY`, `ANALYSIS_WARMING` и `BURST_GUARD` от фактического daily quota exhaustion.
- Production safety diagnostics публикуют счётчики user analysis admission.
- Release Readiness содержит blocking check `public_multi_user_admission_selftest`.
- `/health`: `multiUserAnalysisAdmission=enabled`, `multiUserAnalysisAdmissionSelfTest=enabled`.
- Regression: `test/public-release-hardening-rc107.test.js`.
- Supabase migration не требуется.
## Исторические RC72–RC106

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
- `version = 6.99.0-rc107`;
- `releaseCandidate = RC107`;
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
