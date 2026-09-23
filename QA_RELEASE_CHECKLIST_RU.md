# QA Release Checklist — v6.96.0 RC104

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

- `package.json` и `package-lock.json`: `6.96.0`.
- Worker и client: `6.96.0-rc104`.
- Release candidate: `RC104`.
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

## RC104 — API-Football Data Reliability

- Предматчевые optional-запросы больше не используют `catch(() => [])`.
- Для injuries, predictions, odds, H2H и lineups сохраняется отдельное состояние: `available`, `empty_response`, `skipped`, `plan_limited`, `rate_limited`, `timeout`, `network_error` или `provider_error`.
- Пустой ответ injuries не считается доказательством отсутствия травм.
- Неизвестные данные по составу не превращаются в `0:0` подтверждённых потерь.
- Недоступный market/prediction сигнал исключается из probability blend вместо подстановки значения.
- При серьёзной деградации provider reliability ограничивает `dataTrust`; ниже рабочего порога AI возвращает `skip` вместо уверенного сигнала.
- Match Center использует ту же явную metadata-модель для cache/stale/skipped/error feature data.
- `/health` обязан публиковать `providerDataReliability=enabled` и `providerDataReliabilitySelfTest=enabled`.
- Release Readiness содержит blocking self-test `provider_data_reliability_selftest`.
- Regression: `test/provider-data-reliability-rc104.test.js`.
- Новая Supabase migration не требуется.
## Исторические RC72–RC103

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
- `version = 6.96.0-rc104`;
- `releaseCandidate = RC104`;
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
