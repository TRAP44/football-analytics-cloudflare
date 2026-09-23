# QA Release Checklist — v6.98.0 RC106

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

- `package.json` и `package-lock.json`: `6.98.0`.
- Worker и client: `6.98.0-rc106`.
- Release candidate: `RC106`.
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

## RC106 — Telegram + Mini App E2E

- Persistent Telegram keyboard сохраняет вход через «🔎 Найти матч».
- Результат поиска открывает тот же fixture через callback `match:menu:<fixtureId>`.
- Quick AI и полный Mini App handoff сохраняют `fixtureId`, `action=analysis`, `tab=brief`, `handoff=1`.
- Перед Telegram handoff Mini App синхронизирует избранное и напоминания пользователя.
- После полного AI локальная история обновляется сразу, а history/reminders/favorites синхронизируются в фоне.
- Cached Quick AI → полный анализ не должен повторно списывать дневной лимит.
- Полный анализ позволяет добавить обе команды в избранное, управлять напоминанием и вернуться в Telegram через `Telegram.WebApp.close()`.
- История открывает сохранённый анализ read-only и не вызывает `incrementUsage`.
- Worker self-test: `telegramMiniAppE2EDrill()`.
- Release Readiness содержит blocking check `telegram_miniapp_e2e_selftest`.
- `/health`: `telegramMiniAppE2E=enabled` и `telegramMiniAppE2ESelfTest=enabled`.
- Regression: `test/telegram-miniapp-e2e-rc106.test.js`.
- Supabase migration не требуется.

## Исторические RC72–RC105

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
- `version = 6.98.0-rc106`;
- `releaseCandidate = RC106`;
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
