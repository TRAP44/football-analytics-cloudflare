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

Для нового проекта используется только `supabase/baseline/supabase_baseline_v6_16.sql`.

Для существующей базы должны быть применены:
`supabase/migrations/supabase_migration_v6_9.sql`, `v6_10`, `v6_11`, `v6_11_1`, `v6_12`, `v6_13`, `v6_14`, `v6_15`, `v6_16`.

Проверить:
- RLS и закрытые backend-only таблицы не открыты для `anon/authenticated`;
- service-role ключ не попадает в клиент;
- `MONETIZATION_ENABLED=false`;
- `DEV_MODE=false`.

## RC107 — Persistent Telegram Webhook Dedupe

- Быстрый in-memory dedupe остаётся первым слоем защиты.
- После него Worker атомарно резервирует Telegram update через Supabase RPC `claim_telegram_update`, поэтому повторная доставка не обрабатывается повторно даже другим Cloudflare isolate.
- Завершённый update фиксируется как `done` и хранится 24 часа; незавершённый/ошибочный claim можно повторить после короткого lease.
- При временной недоступности Supabase webhook работает fail-open через существующий memory-dedupe, чтобы бот не переставал отвечать.
- `telegram_update_claims` защищена RLS, недоступна `anon/authenticated`; RPC — `SECURITY INVOKER` и разрешены только `service_role`.
- Supabase Schema Drift Guard проверяет обязательный объект `telegram_update_claims`.
- Release Readiness содержит blocking check `telegram_webhook_persistent_dedupe`.
- `/health`: `telegramWebhookPersistentDedupe=enabled` и `telegramWebhookPersistentDedupeSelfTest=enabled`.
- Regression: `test/telegram-webhook-persistent-dedupe-rc107.test.js`.
- Для существующей базы обязательна миграция `supabase_migration_v6_16.sql`.

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
