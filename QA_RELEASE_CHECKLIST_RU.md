# QA Release Checklist — v6.97.0 RC105

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

- `package.json` и `package-lock.json`: `6.97.0`.
- Worker и client: `6.97.0-rc105`.
- Release candidate: `RC105`.
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

## RC105 — AI Analysis Quality Gate

- Confidence coverage считается по каноническим весам: market 42%, API prediction 24%, recent form 26%, H2H 8%; наличие слабого H2H больше не равно наличию рынка.
- Confidence учитывает weighted coverage, agreement лидера, disagreement, выборку формы и margin между первым/вторым исходом.
- Goal model публикует `qualityScore`, `qualityLabel` и размер overall/venue sample.
- ТБ 2.5 и BTTS не могут стать рабочим bet signal при `goalModel.qualityScore < 65`.
- Quality Gate удерживает сигнал при недостатке независимых источников, confidence/dataTrust ниже порога, сильном disagreement или слишком тонком margin.
- В финальные 15 минут без двух подтверждённых стартовых составов рабочий signal удерживается.
- Provider degradation учитывается в том же gate.
- `aiInstructor.qualityGate` объясняет причины `ready/caution/hold/blocked`.
- `/health`: `aiAnalysisQualityGate=enabled` и `aiAnalysisQualityGateSelfTest=enabled`.
- Release Readiness содержит blocking self-test `ai_analysis_quality_gate_selftest`.
- Regression: `test/ai-analysis-quality-rc105.test.js`.
- Supabase migration не требуется.
## Исторические RC72–RC104

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
- `version = 6.97.0-rc105`;
- `releaseCandidate = RC105`;
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
