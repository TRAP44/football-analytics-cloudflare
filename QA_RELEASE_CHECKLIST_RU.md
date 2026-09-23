# QA Release Checklist — v6.90.0 RC98

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

- `package.json` и `package-lock.json`: `6.90.0`.
- Worker и client: `6.90.0-rc98`.
- Release candidate: `RC98`.
- Production workflow запускается только после успешного Quality.
- Post-deploy smoke проверяет ту же версию и RC.

## Supabase

Для существующей базы должны быть применены:
`supabase_migration_v6_9.sql`, `v6_10`, `v6_11`, `v6_11_1`, `v6_12`, `v6_13`, `v6_14`, `v6_15`.

Проверить:
- RLS и закрытые backend-only таблицы не открыты для `anon/authenticated`;
- service-role ключ не попадает в клиент;
- `MONETIZATION_ENABLED=false`;
- `DEV_MODE=false`.

## RC98 — News Impact Recovery Incident SLO Impact Focus Queue

- Focus Queue объединяет RC93 cumulative ranking, RC94 weekly pair trend и RC97 Executive Summary; новые incident metrics не создаются.
- Очередь ограничена 5 строками и сортируется строго по factual порядку: current week overdue minutes → week delta → cumulative overdue minutes.
- Каждая строка содержит reason/action labels, weekly overdue, week delta, cumulative overdue, contribution %, active episodes и week direction.
- Очередь не вводит severity-score, priority threshold или автоматическое recovery-routing решение.
- Summary показывает queued pairs, breach/active pairs, current week overdue, week delta и число increased/decreased/unchanged строк.
- Privacy: Telegram ID, raw error и произвольный free text не возвращаются.
- RC98 использует существующие RC87 30 / 120 / 360 минут, не создаёт derived persistence и не требует новой Supabase migration.
- Regression: `test/news-impact-recovery-incident-impact-focus-queue-rc98.test.js`.
- Production smoke требует `newsImpactRecoveryIncidentSloImpactFocusQueue=enabled`, `newsImpactRecoveryIncidentSloImpactFocusOrdering=enabled`, `newsImpactRecoveryIncidentSloImpactFocusQueueSelfTest=enabled`.

## Исторические RC72–RC97

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
- `version = 6.90.0-rc98`;
- `releaseCandidate = RC98`;
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
