# QA Release Checklist — v6.65.0 RC73

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

- `package.json` и `package-lock.json`: `6.65.0`.
- Worker и client: `6.65.0-rc73`.
- Release candidate: `RC73`.
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

## RC73 — News Impact Action Tracking

- Decision Card использует tracked callback только с категориальными `decision` и `action`.
- Поддерживаются действия: `full_ai`, `squads`, `market`, `recheck`, `news`, `share`.
- Mini App получает только безопасные query-параметры `newsImpactDecision` и `newsImpactAction`.
- `growth_events` получает `news_impact_action` без заголовка новости, URL, query и произвольного текста.
- Launch Funnel возвращает `newsImpactActionSummary` и показывает действия после решения.
- Новая Supabase migration не требуется.
- Regression: `test/news-impact-action-tracking-rc73.test.js`.
- Production smoke требует `newsImpactActionSelfTest=enabled`.

## RC72 — News Impact Decision Card

- News Impact запускается только после явного пользовательского действия.
- Для причинностного сравнения предыдущий AI snapshot должен быть старше новости.
- Decision Card различает material / partial / stable / causality-unavailable состояния.
- Telegram-кнопки зависят от decision state.
- Analytics сохраняет безопасный decision code без текста новости, URL и пользовательского запроса.
- Новость сама по себе не переписывает AI-прогноз.
- Regression: `test/news-impact-decision-card-rc72.test.js`.

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
- `version = 6.65.0-rc73`;
- `releaseCandidate = RC73`;
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
