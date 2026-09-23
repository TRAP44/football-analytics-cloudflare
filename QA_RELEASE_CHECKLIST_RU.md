# QA Release Checklist — v6.83.0 RC91

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

- `package.json` и `package-lock.json`: `6.83.0`.
- Worker и client: `6.83.0-rc91`.
- Release candidate: `RC91`.
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

## RC91 — News Impact Recovery Incident SLO Breach Triage Queue

- Triage Queue строится только из RC90 watchlist и включает только активные breach-эпизоды.
- Стадии не вводят новых правил: `ack_overdue` использует ACK breach после 30 минут, `ack_critical` — существующий critical ACK 120 минут, `recovery_overdue` — существующий Recovery SLO 360 минут.
- Recovery overdue имеет более высокий приоритет сортировки, затем ACK critical, затем ACK overdue; внутри стадии старые эпизоды идут первыми.
- Triage — только административное представление; recovery-routing, acknowledgement semantics и incident lifecycle не меняются.
- Производные triage-данные не сохраняются, Supabase migration не требуется.
- Privacy: Telegram ID, raw error и произвольный free text не возвращаются.
- Regression: `test/news-impact-recovery-incident-breach-triage-rc91.test.js`.
- Production smoke требует `newsImpactRecoveryIncidentSloBreachTriage=enabled`, `newsImpactRecoveryIncidentBreachStageBuckets=enabled`, `newsImpactRecoveryIncidentSloBreachTriageSelfTest=enabled`.

## RC90 — News Impact Recovery Incident SLO Breach Watchlist & Aging

- Watchlist строится только из RC89 SLO Breach Feed и показывает только активные breach-эпизоды.
- Сводка включает active, critical, active ACK breaches, active Recovery breaches, возраст самого старого активного breach и число повторяющихся активных пар.
- Сортировка приоритизирует critical, затем более старые активные эпизоды.
- Aging не вводит новых порогов: используются RC87 30 / 120 / 360 минут.
- Данные не сохраняются отдельно, Supabase migration не требуется, recovery-routing не меняется.
- Privacy: Telegram ID, raw error и произвольный free text не возвращаются.
- Regression: `test/news-impact-recovery-incident-breach-watchlist-rc90.test.js`.
- Production smoke требует `newsImpactRecoveryIncidentSloBreachWatchlist=enabled`, `newsImpactRecoveryIncidentBreachAging=enabled`, `newsImpactRecoveryIncidentSloBreachWatchlistSelfTest=enabled`.

## RC89 — News Impact Recovery Incident SLO Breach Feed & Drilldown

- Breach Feed строится только из существующего `incidentEpisodeHistory` и использует те же ACK/Recovery SLO-пороги RC87: 30 / 120 / 360 минут.
- В feed попадают только эпизоды с подтверждённым `ackBreached` и/или `recoveryBreached`; pending и короткий auto-recovery не считаются breach.
- Severity является административным представлением: active Recovery breach и active ACK ≥120 минут → critical; active ACK breach → high; recovered Recovery breach → high.
- Drilldown показывает только санитизированные reason/action, timestamps, occurrences, guard-коды и latency. Telegram ID, raw error и произвольный free text не возвращаются.
- Repeated breach pairs агрегируются по `reason + action` при минимум двух breach-эпизодах.
- RC89 не меняет recovery routing, acknowledgement semantics или incident lifecycle и не добавляет Supabase migration.
- Regression: `test/news-impact-recovery-incident-breach-feed-rc89.test.js`.
- Production smoke требует `newsImpactRecoveryIncidentSloBreachFeed=enabled`, `newsImpactRecoveryIncidentBreachDrilldown=enabled`, `newsImpactRecoveryIncidentBreachPrivacyGuard=enabled`, `newsImpactRecoveryIncidentSloBreachFeedSelfTest=enabled`.

## RC88 — News Impact Recovery Incident SLO Dashboard & Trend

- Dashboard использует только фактические adverse episodes из 30-дневного shared recovery loader; один episode может содержать несколько failure-событий и закрывается первым последующим non-adverse guard для той же `reason + action`.
- История acknowledgement сохраняется в памяти ответа только как санитизированные `reason`, `action`, `incident_guard`, `incident_seen_at`, `acknowledgedAt`; Telegram ID и raw error не попадают в dashboard.
- First-review latency считается от начала episode до первого acknowledgement, относящегося к любому adverse occurrence этого episode.
- 4-недельный trend разбит на четыре последовательных 7-дневных окна по `startedAt`.
- ACK compliance denominator включает acknowledged episodes и episodes, которые прожили ≥30 минут. Автоматически восстановившийся менее чем за 30 минут episode без acknowledgement не считается ACK breach.
- Recovery compliance denominator включает recovered episodes и active episodes возрастом ≥360 минут.
- Weekly строки показывают episodes, active/recovered, eligible/met/breached, ACK %, Recovery %, avg ACK и avg recovery.
- Recurrence группирует episodes по `reason + action`; в список попадают пары минимум с двумя episodes за 28 дней, с числом active, ACK breaches, Recovery breaches и guard codes.
- Weekly/recurrence — только аналитика; они не меняют acknowledgement state, `effectivePriority`, strategy или selected recovery.
- Производные SLO dashboard-метрики не сохраняются в Supabase и новая migration не требуется.
- Regression: `test/news-impact-recovery-incident-slo-dashboard-rc88.test.js`.
- Production smoke требует `newsImpactRecoveryIncidentSloDashboard=enabled`, `newsImpactRecoveryIncidentWeeklyTrend=enabled`, `newsImpactRecoveryIncidentRecurrence=enabled`, `newsImpactRecoveryIncidentSloDashboardSelfTest=enabled`.

## RC87 — News Impact Recovery Incident Escalation & SLO

- ACK SLO: active factual incident должен быть просмотрен в пределах 30 минут от начала текущего adverse episode.
- Если active incident не просмотрен 30 минут, административный приоритет повышается на один уровень; после 120 минут без acknowledgement он становится critical.
- Recovery SLO: active episode должен нормализоваться в пределах 360 минут; превышение автоматически даёт critical administrative priority даже после acknowledgement.
- Эскалация не изменяет `selectedRecovery`, strategy или RC81–RC86 routing; это только observability/admin layer.
- Episode timestamps выводятся из фактической хронологии `news_impact_outcome_failure.metadata.strategy_guard`: adverse guard открывает/продолжает episode, следующий non-adverse guard для той же reason + action закрывает его.
- Для recovered episode показывается фактическое время до восстановления только когда есть последующее failure-событие, подтверждающее смену guard; timestamp не выдумывается.
- Для current-only incident без фактического failure timestamp SLO имеет состояние unavailable и не эскалируется по времени.
- Admin показывает age, ACK latency, recovery latency, SLO status, base → effective priority, число escalated/critical incidents и SLO breaches.
- `incident_ack_slo_breach` и `incident_recovery_slo_breach` — производные admin-alerts; они не сохраняются отдельными growth_events.
- Regression: `test/news-impact-recovery-incident-slo-rc87.test.js`.
- Production smoke требует `newsImpactRecoveryIncidentSlo=enabled`, `newsImpactRecoveryIncidentEscalation=enabled`, `newsImpactRecoveryIncidentLatencyMetrics=enabled`, `newsImpactRecoveryIncidentSloSelfTest=enabled`.
- Новая Supabase migration не требуется; используются существующие backend-only `growth_events`.

## RC86 — News Impact Recovery Incident Acknowledgement & Runbook

- Admin может отметить фактический active drift/regression incident как «Просмотрено»; current-only инцидент без failure-event подтверждать нельзя.
- Acknowledgement пишется в существующий `growth_events` как `news_impact_recovery_incident_ack` с только категориальными `reason`, `action`, `incident_guard`, `incident_seen_at`, `ack_state`.
- API acknowledgement доступен только администратору и перед записью повторно проверяет, что incident всё ещё active и `lastSeenAt` не изменился; stale запрос получает HTTP 409.
- Ack действует только для точного occurrence: следующий новый failure с более новым `lastSeenAt` автоматически снимает suppression и снова требует внимания.
- Просмотренный active incident не скрывается из Incident Center; подавляется только дублирующий warning.
- Runbook фиксирован в коде и не содержит произвольного пользовательского текста: отдельные шаги для `performance_drift`, `recent_regression` и недоступного strategy evidence.
- Fixed fallback и RC81–RC85 routing guard-логика не изменяются acknowledgement-действием.
- Telegram ID, raw error, URL, query, stack и свободная admin-note не возвращаются в Incident Center API.
- Regression: `test/news-impact-recovery-incident-ack-rc86.test.js`.
- Production smoke требует `newsImpactRecoveryIncidentAcknowledgement=enabled`, `newsImpactRecoveryIncidentRunbook=enabled`, `newsImpactRecoveryIncidentAlertSuppression=enabled`, `newsImpactRecoveryIncidentAckPrivacyGuard=enabled`, `newsImpactRecoveryIncidentAckSelfTest=enabled`.
- Новая Supabase migration не требуется; используется существующая backend-only `growth_events`.

## RC85 — News Impact Recovery Incident Center

- Incident Center использует тот же 30-дневный shared recovery loader; отдельная таблица и дублирующий источник состояния не создаются.
- В журнал попадают только категориальные `performance_drift` и `recent_regression`; raw error, stack, URL, query и Telegram ID исключены.
- Инциденты агрегируются по failure reason + action + guard и содержат first/last seen, количество проявлений, текущую strategy/recovery и priority.
- `performance_drift` получает priority=high, `recent_regression` — priority=medium.
- Инцидент считается active, пока текущий strategy matrix возвращает тот же guard; после нормализации этой пары reason + action исторический инцидент становится recovered.
- Текущий adverse guard без исторического failure-события всё равно отображается как current-only active incident, без выдуманного timestamp.
- При недоступном strategy evidence Incident Center показывает отдельный active medium incident, а runtime сохраняет fixed fallback.
- Admin показывает число активных, high и восстановленных инцидентов и lifecycle каждой записи.
- Regression: `test/news-impact-recovery-incident-center-rc85.test.js`.
- Production smoke требует `newsImpactRecoveryIncidentCenter=enabled`, `newsImpactRecoveryIncidentLifecycle=enabled`, `newsImpactRecoveryIncidentPrivacyGuard=enabled`, `newsImpactRecoveryIncidentSelfTest=enabled`.
- Новая Supabase migration не требуется; используются существующие `growth_events` и `metadata`.

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
