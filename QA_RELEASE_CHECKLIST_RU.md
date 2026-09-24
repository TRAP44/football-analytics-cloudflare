# QA Release Checklist — v6.100.0 RC108

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

- `package.json` и `package-lock.json`: `6.100.0`.
- Worker и client: `6.100.0-rc108`.
- Release candidate: `RC108`.
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

## RC108 — Telegram Webhook Dedupe Observability

- `telegram_update_claims` хранит `duplicate_count` и `last_duplicate_at`, не сохраняя текст сообщений пользователя.
- Повторный активный/завершённый claim увеличивает только агрегированный счётчик и остаётся заблокированным.
- Service-role-only RPC `telegram_webhook_dedupe_health` возвращает claims, completed, failed, stale и агрегированные duplicate counters.
- Нормальные Telegram retry/delivery duplicates считаются метрикой, а не инцидентом.
- Один stale/failed claim переводит dedupe health в `watch`; 5+ stale или recent failed — в `incident`.
- Production Monitor учитывает dedupe health; Release Readiness блокируется, если health RPC отсутствует или observability self-test не проходит.
- Админская диагностика показывает claims / duplicates / stale / failed.
- `/health`: `telegramWebhookDedupeObservability=enabled` и `telegramWebhookDedupeObservabilitySelfTest=enabled`.
- Regression: `test/telegram-webhook-observability-rc108.test.js`.
- Для существующей базы обязательна миграция `supabase_migration_v6_17.sql`.

## Исторические RC72–RC107

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
- `version = 6.100.0-rc108`;
- `releaseCandidate = RC108`;
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
