# QA Release Checklist — v6.76.0 RC84

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

- `package.json` и `package-lock.json`: `6.76.0`.
- Worker и client: `6.76.0-rc84`.
- Release candidate: `RC84`.
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

## RC84 — News Impact Recovery Transition History & Admin Alerts

- История строится по фактически применённым `news_impact_outcome_failure` событиям из того же 30-дневного shared strategy loader.
- Переключение фиксируется только при реальном изменении strategy или recovery для одинаковой пары failure reason + action.
- Admin показывает fixed → adaptive, adaptive → fixed, смену recovery, guard-причину и timestamp; Telegram ID наружу не возвращается.
- Active alerts строятся из текущего strategy matrix: `performance_drift` и `recent_regression` — warning, `stability_sample` — info.
- Если strategy evidence недоступен или усечён, админ получает warning, а runtime остаётся на fixed fallback.
- RC84 не меняет routing-логику RC81–RC83; это слой наблюдаемости и объяснимости.
- Новая Supabase migration не требуется; используются существующие `growth_events` и `metadata`.
- Regression: `test/news-impact-recovery-transition-alerts-rc84.test.js`.
- Production smoke требует `newsImpactRecoveryTransitionHistory=enabled`, `newsImpactRecoveryAdminAlerts=enabled`, `newsImpactRecoveryTransitionPrivacyGuard=enabled`, `newsImpactRecoveryTransitionSelfTest=enabled`.

## RC83 — News Impact Recovery Drift Circuit Breaker

- RC82 остаётся первым gate: adaptive должен сначала пройти 30-дневный strict guard и свежий 7-дневный stability guard.
- RC83 проверяет деградацию уже выбранного adaptive recovery относительно предыдущей части того же 30-дневного окна.
- Drift-анализ требует минимум 20 зрелых попыток кандидата в prior-окне и минимум 10 в recent-окне.
- Circuit breaker срабатывает только если success rate упал минимум на 15 п.п. и верхняя граница 95% Wilson recent ниже нижней границы prior.
- При подтверждённом drift runtime немедленно возвращается на fixed recovery; proposed adaptive остаётся видимым только для диагностики.
- Admin Launch Funnel показывает prior → recent recovery success, величину падения и число автоматически заблокированных adaptive-правил.
- `news_impact_outcome_failure.metadata.strategy_guard` хранит только разрешённый категориальный guard-код; raw error, URL, query и stack не сохраняются.
- Новая Supabase migration не требуется; используются существующие `growth_events.metadata`.
- Regression: `test/news-impact-recovery-drift-guard-rc83.test.js`.
- Production smoke требует `newsImpactRecoveryDriftGuard=enabled`, `newsImpactRecoveryDriftAudit=enabled`, `newsImpactRecoveryDriftSelfTest=enabled`.

## RC82 — News Impact Recovery Stability & Parity Guard

- Runtime и Admin Launch Funnel используют один shared loader 30-дневного recovery evidence; UI больше не строит стратегию из произвольного выбранного периода.
- RC81 strict guard остаётся обязательным: минимум 30 зрелых попыток у baseline и кандидата, +5 п.п. lift и непересекающиеся 95% Wilson-интервалы.
- После RC81 кандидат проходит свежий 7-дневный stability guard: минимум по 10 зрелых попыток у baseline и кандидата.
- Если свежий кандидат хуже baseline по success rate или его нижняя граница Wilson ниже baseline, adaptive override блокируется как `recent_regression`.
- Если свежей выборки недостаточно, runtime остаётся на fixed fallback с `stability_sample`; потенциальный кандидат показывается только как proposed.
- При доступном подтверждении guard возвращает `stable_significant_better` и только тогда включает adaptive routing.
- Admin показывает 30-дневные и свежие показатели, причину блокировки и proposed recovery без раскрытия Telegram ID.
- Новая Supabase migration не требуется; используются существующие `growth_events`.
- Regression: `test/news-impact-recovery-stability-parity-rc82.test.js`.
- Production smoke требует `newsImpactRecoveryStrategyParity=enabled`, `newsImpactRecoveryStabilityGuard=enabled` и `newsImpactRecoveryStabilitySelfTest=enabled`.

## RC81 — News Impact Recovery Strategy Guard

- Fixed recovery из RC79 остаётся базовым и используется по умолчанию.
- Adaptive override строится только по событиям той же причины сбоя и того же действия; перенос статистики между разными failure/action запрещён.
- Для базового и альтернативного recovery требуется минимум 30 зрелых попыток.
- Альтернатива должна давать минимум +5 процентных пунктов success rate, а нижняя граница её 95% Wilson-интервала должна быть выше верхней границы baseline.
- Если baseline не набрал выборку, интервалы пересекаются, evidence загрузить не удалось или выборка Supabase усечена — runtime использует fixed fallback.
- Историческое evidence грузится только на failure-path, кэшируется 5 минут и ограничено 30-дневным окном.
- Failure event сохраняет только категориальный `strategy=fixed|adaptive`; raw error по-прежнему не сохраняется.
- Admin Launch Funnel показывает fixed → selected recovery, sample size, success %, lift и причину guard-решения.
- Primary `open_full_ai` recovery теперь действительно открывает Mini App, а не эмулирует retry исходного Telegram action.
- Новая Supabase migration не требуется; используется существующая `growth_events.metadata`.
- Regression: `test/news-impact-recovery-strategy-guard-rc81.test.js`.
- Production smoke требует `newsImpactRecoveryStrategySelfTest=enabled`.

## RC80 — News Impact Recovery Effectiveness Funnel

- `news_impact_recovery_attempt` создаётся только после реальной retry-попытки или запуска полного AI через recovery-fallback.
- Retry callback содержит decision, action и категориальный recovery-код; сырой текст ошибки в callback/analytics не переносится.
- Для каждой уникальной комбинации user + fixture + decision + action + recovery учитывается последняя попытка, чтобы многократные клики не раздували выборку.
- Recovery считается успешным только если после попытки в течение 5 минут появился подтверждённый `news_impact_outcome`.
- Повторный `news_impact_outcome_failure` в том же окне фиксирует неуспешное восстановление; истёкшая без outcome попытка также считается failed.
- Свежая попытка остаётся pending и не снижает success rate до окончания окна.
- Admin Launch Funnel показывает recovered / matured attempts, pending, failed, success %, 95% Wilson-интервал и наиболее результативную стратегию только при достаточной выборке.
- Показ fallback-сообщения сам по себе не считается попыткой или успехом.
- Новая Supabase migration не требуется; используется существующая `growth_events.metadata`.
- Regression: `test/news-impact-recovery-effectiveness-rc80.test.js`.
- Production smoke требует `newsImpactRecoveryEffectivenessSelfTest=enabled`.

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
- `version = 6.73.0-rc81`;
- `releaseCandidate = RC81`;
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
