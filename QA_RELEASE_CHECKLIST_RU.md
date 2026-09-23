# QA Release Checklist — v6.71.0 RC79

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

- `package.json` и `package-lock.json`: `6.71.0`.
- Worker и client: `6.71.0-rc79`.
- Release candidate: `RC79`.
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

## RC79 — News Impact Outcome Failure Diagnostics & Recovery

- `news_impact_outcome_failure` записывается после уже зафиксированного News Impact action, если запрошенный результат не был доставлен.
- Разрешены только категориальные причины: provider rate limit/unavailable, quota exhausted, analysis warming, missing/invalid fixture, data invalid, Telegram delivery, timeout, server error.
- В `growth_events.metadata` сохраняются только decision, action, reason, recovery и числовой HTTP status; сырой текст исключения, URL и пользовательский запрос не сохраняются.
- Telegram получает recovery-кнопку «Повторить» и fallback на полный AI; Mini App получает `newsImpactRecovery` с безопасным сообщением и действием.
- `sendBotFixtureSection` теперь возвращает явный delivery result, поэтому RC78 больше не считает outcome успешным после внутренне обработанной ошибки.
- Admin Launch Funnel показывает частоту причин, число затронутых пользователей, действия и recovery-коды.
- Сбой доставки не трактуется как недовольство пользователя.
- Новая Supabase migration не требуется; используется существующая `growth_events.metadata`.
- Regression: `test/news-impact-outcome-failure-recovery-rc79.test.js`.
- Production smoke требует `newsImpactFailureDiagnosticsSelfTest=enabled`.

## RC78 — News Impact Action Outcome Quality

- `news_impact_action` означает попытку пользователя продолжить сценарий; `news_impact_outcome` создаётся только после успешной серверной доставки результата.
- Outcome отслеживается для `full_ai`, `squads`, `market`, `recheck`, `news`, `share`.
- Для каждого действия считаются observed journeys, зрелые attempts, pending и confirmed outcomes.
- Outcome должен идти после соответствующего action и не позднее 5 минут; действие и outcome совпадают по пользователю, fixture, decision и action.
- Недавняя незавершённая попытка не считается неуспехом, пока не закончилось 5-минутное окно.
- Admin Launch Funnel показывает confirmed / attempts, completion %, 95% Wilson-интервал и слабое место только при достаточной выборке.
- «Confirmed outcome» означает успешную доставку запрошенного результата, а не удовлетворённость пользователя и не качество/точность AI-прогноза.
- Новая Supabase migration не требуется; используется существующая `growth_events.metadata`.
- Regression: `test/news-impact-action-outcome-quality-rc78.test.js`.
- Production smoke требует `newsImpactOutcomeQualitySelfTest=enabled`.

## RC77 — News Impact Temporal Attribution Guard

- Действие считается конверсией только если оно произошло после News Impact Decision Card.
- Окно атрибуции — 30 минут после решения; более поздние действия не приписываются старому решению.
- Решения младше 30 минут временно исключаются из знаменателя, чтобы не создавать right-censoring и искусственно низкую конверсию.
- Для каждого decision state API возвращает observedUsers, matured users и immatureUsers.
- Для предыдущего периода разрешено учитывать действие, которое произошло сразу после границы периода, если оно попадает в 30-минутное окно соответствующего решения.
- Действие до решения никогда не засчитывается.
- Новая Supabase migration не требуется; используется существующий created_at в growth_events.
- Regression: `test/news-impact-temporal-attribution-rc77.test.js`.
- Production smoke требует `newsImpactTemporalAttributionSelfTest=enabled`.

## RC76 — News Impact Funnel Trend Guard

- Launch Funnel сравнивает текущие N дней с предыдущими N днями.
- Для каждого News Impact decision state показываются previous %, current %, Δ в процентных пунктах и размер выборки обоих периодов.
- «Подтверждённый рост» / «подтверждённое снижение» разрешены только при минимум 10 пользователях в обоих периодах и непересекающихся 95% Wilson-интервалах.
- При пересекающихся интервалах показывается «изменение не подтверждено», даже если точечный процент изменился.
- При недостаточной выборке показывается «мало данных».
- Ошибка загрузки предыдущего периода не ломает текущую аналитику: trend деградирует отдельно.
- Новая Supabase migration не требуется.
- Regression: `test/news-impact-funnel-trend-rc76.test.js`.
- Production smoke требует `newsImpactActionTrendSelfTest=enabled`.

## RC75 — News Impact Funnel Confidence Guard

- Узкое место News Impact не выбирается, пока конкретное decision state не набрало минимум 10 уникальных пользователей.
- 10–29 пользователей помечаются как «ранний сигнал»; 30+ — как «устойчивая выборка».
- Для conversion показывается 95% Wilson-интервал, чтобы не выдавать точечный процент за точное знание.
- Повторные действия одного пользователя по-прежнему не увеличивают conversion.
- Если выборка мала, админка прямо сообщает, сколько пользователей требуется до включения bottleneck.
- Новая Supabase migration не требуется.
- Regression: `test/news-impact-funnel-confidence-rc75.test.js`.
- Production smoke требует `newsImpactFunnelConfidenceSelfTest=enabled`.

## RC74 — News Impact Action Funnel

- Для каждого decision state считаются уникальные пользователи, которые увидели решение.
- Дальнейшие действия считаются только для пользователей с тем же decision state в выбранном окне аналитики.
- Показываются `actedUsers / users`, conversion %, наиболее частое следующее действие и action breakdown.
- Admin Launch Funnel показывает состояние с самой низкой конверсией без Telegram ID.
- Повторные действия одного пользователя не раздувают conversion: используется unique-user aggregation.
- Новая Supabase migration не требуется; используются существующие `growth_events`.
- Regression: `test/news-impact-action-funnel-rc74.test.js`.
- Production smoke требует `newsImpactActionFunnelSelfTest=enabled`.

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
- `version = 6.71.0-rc79`;
- `releaseCandidate = RC79`;
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
