# Football Analytics Mini App v6.82.0 — RC90

Telegram-бот и Mini App для футбольной аналитики на Cloudflare Workers + Supabase. Основные источники данных: API-Football и Tavily. Интерфейс и админ-панель — на русском языке. Монетизация пока отключена.

## Текущий продукт

- Поиск клуба и матча с нормализацией названий, восстановлением при пустом календаре и выбором основного fixture.
- Короткий AI-бриф в Telegram и полный AI-разбор в Mini App без двойного списания лимита.
- Freshness Guard перед стартом: адаптивный TTL, ручная перепроверка и delta между предыдущим и свежим анализом.
- Kickoff Handoff: после стартового свистка предматчевый сигнал фиксируется как архивный, пользователь переводится в Match Center.
- Post-Match Review и Return Loop: сравнение immutable предматчевого снимка с финальным результатом и возврат пользователя в Telegram.
- Публичный AI Track Record строится только по подтверждённым settled-прогнозам и не выдаёт совпадение исхода за прибыльность ставок.
- Защита от вирусной нагрузки: distributed fixture lock, shared cache и безопасный fallback.
- Медиа deep-link на fixture, publisher kit и агрегированная first-party аналитика source / campaign / content.
- Новостной контур RC69–RC90: новость → релевантный матч → явная AI-перепроверка → News Impact Delta → **News Impact Decision Card** → **News Impact Action Tracking** → **News Impact Action Funnel** → **News Impact Funnel Confidence Guard** → **News Impact Funnel Trend Guard** → **News Impact Temporal Attribution Guard** → **News Impact Action Outcome Quality** → **News Impact Outcome Failure Diagnostics & Recovery** → **News Impact Recovery Effectiveness Funnel** → **News Impact Recovery Strategy Guard** → **News Impact Recovery Stability & Parity Guard** → **News Impact Recovery Drift Circuit Breaker** → **News Impact Recovery Transition History & Admin Alerts** → **News Impact Recovery Incident Center** → **News Impact Recovery Incident Acknowledgement & Runbook** → **News Impact Recovery Incident Escalation & SLO** → **News Impact Recovery Incident SLO Dashboard & Trend** → **News Impact Recovery Incident SLO Breach Feed & Drilldown** → **News Impact Recovery Incident SLO Breach Watchlist & Aging**.
- News Impact не утверждает причинность по заголовку: сравнение разрешено только с корректным AI-снимком, созданным до публикации новости.
- RC73 считает только категориальные действия после Decision Card: полный AI, составы, рынок, повторная проверка, возврат к новостям и share. Текст новости, URL и пользовательский запрос в эту аналитику не записываются.
- RC74 агрегирует эти действия по типу News Impact-решения, считает долю пользователей, которые продолжили сценарий, показывает наиболее частое следующее действие и состояние с самой низкой конверсией. Telegram ID наружу не возвращаются.
- RC75 не объявляет состояние «узким местом» на микровыборке: нужен минимум 10 уникальных пользователей, при 30+ выборка помечается устойчивой; для каждой конверсии показывается 95% Wilson-интервал.
- RC76 сравнивает текущий период с предыдущим периодом той же длины. Рост/снижение помечается подтверждённым только при достаточной выборке в обоих периодах и непересекающихся 95% Wilson-интервалах; иначе показывается «изменение не подтверждено».
- RC77 связывает действие только с предшествующей Decision Card в 30-минутном окне. Решения младше 30 минут исключаются из знаменателя до завершения окна; действия сразу после границы предыдущего периода всё равно могут корректно атрибутироваться к решению.
- RC78 отделяет попытку от подтверждённого результата: `news_impact_outcome` записывается только после успешной доставки полного AI, раздела, перепроверки, новостей или share-карточки. Админка показывает completion по действиям с 95% Wilson-интервалом; это метрика доставки, а не удовлетворённости или точности прогноза.
- RC79 фиксирует только категориальные причины недоставки (`provider_rate_limit`, `quota_exhausted`, `analysis_warming`, `match_missing`, `data_invalid`, `telegram_delivery`, `timeout`, `server_error` и др.), предлагает безопасный recovery и показывает агрегированную диагностику. Сырой текст исключения в growth_events не сохраняется.
- RC80 измеряет только реальные recovery-попытки: retry-кнопка и переход на полный AI получают отдельную атрибуцию. Успех засчитывается лишь при подтверждённой доставке в 5-минутном окне; свежие попытки остаются pending, а сравнение стратегий разрешается только при достаточной выборке.
- RC81 разрешает adaptive recovery только для той же причины сбоя и действия, если базовый и альтернативный recovery имеют минимум по 30 зрелых попыток, альтернативный даёт минимум +5 п.п., а его нижняя граница 95% Wilson-интервала выше верхней границы базового. При недостатке данных, усечённой выборке или ошибке загрузки используется RC79 fixed fallback.
- RC82 добавляет dual-window stability: кандидат, уже прошедший строгий 30-дневный RC81 guard, должен подтвердиться на свежем 7-дневном окне минимум по 10 зрелых попыток у baseline и кандидата и не показывать ухудшение. Admin Launch Funnel теперь использует тот же shared 30-дневный evidence loader, что и runtime, поэтому интерфейс не может показывать стратегию, отличающуюся от фактического routing-решения.
- RC83 добавляет drift circuit breaker поверх RC82. Для реально выбранного adaptive recovery сравнивается свежая 7-дневная выборка с предыдущей частью 30-дневного окна. При минимум 20 зрелых попытках в prior, 10 в recent, падении минимум на 15 п.п. и непересекающихся 95% Wilson-интервалах adaptive автоматически отключается и routing возвращается на fixed fallback. В growth_events для аудита сохраняется только категориальная причина strategy_guard без raw error.
- RC84 строит приватную историю фактически применённых переключений recovery по failure-событиям за 30 дней: fixed → adaptive, adaptive → fixed и смены recovery. Admin Launch Funnel показывает активные warning/info состояния для performance drift, recent regression, недостаточной stability-выборки и недоступного evidence. Telegram ID в историю и предупреждения не возвращаются; новая таблица и миграция не требуются.
- RC85 объединяет подтверждённые `performance_drift` и `recent_regression` в Recovery Incident Center. Инциденты агрегируются по failure reason + action + guard, получают приоритет high/medium, число проявлений и последнее зафиксированное время. Текущий guard определяет lifecycle: инцидент остаётся активным, пока проблема подтверждается, и автоматически помечается восстановленным после нормализации. Incident Center не возвращает Telegram ID, raw error, URL или query и использует существующий 30-дневный `growth_events` loader.
- RC86 добавляет администраторское acknowledgement и встроенный runbook. «Просмотрено» сохраняется как категориальное `news_impact_recovery_incident_ack` событие, привязанное к точному `lastSeenAt` инцидента. Пока новых проявлений нет, соответствующий warning подавляется, но сам активный инцидент остаётся видимым; следующий failure автоматически делает acknowledgement устаревшим и снова требует внимания. Runbook для drift/regression объясняет безопасные проверки и явно сохраняет fixed fallback. Telegram ID и произвольные заметки в Incident Center API не возвращаются.
- RC87 добавляет временные SLO поверх Incident Center: целевой просмотр ≤ 30 минут, критическая непросмотренная просрочка после 120 минут и целевое восстановление ≤ 360 минут. Worker восстанавливает episode timestamps только из фактической последовательности failure guard-событий: начало эпизода, последнее проявление и первое последующее безопасное состояние. На этой базе рассчитываются возраст, время до acknowledgement и время до recovery. Просрочка повышает только административный `effectivePriority` и создаёт SLO-alert; recovery-routing RC81–RC86 не меняется. SLO не записывается отдельными строками и не требует новой таблицы.
- RC88 строит 4-недельный Incident SLO Dashboard по отдельным adverse episodes, а не по каждому failure-событию. Для каждой 7-дневной корзины считаются ACK/Recovery SLO compliance, eligible/met/breached, среднее время до первого просмотра и восстановления. Эпизоды моложе ACK-порога, которые автоматически восстановились до 30 минут без acknowledgement, не считаются ACK breach. Recurrence-блок агрегирует минимум два эпизода одной пары `reason + action`, показывает active, ACK/Recovery breaches и guard-коды. Dashboard использует тот же backend-only 30-дневный `growth_events` loader, не сохраняет производные метрики и не меняет routing.
- RC89 добавляет SLO Breach Feed и drilldown по уже подтверждённым breach-эпизодам. Для каждого эпизода показываются ACK/Recovery breach-типы, активность, severity, возраст, latency, occurrences и безопасные guard-коды; повторяющиеся breach-пары агрегируются по `reason + action`. RC89 использует существующие пороги 30/120/360 минут, не вводит новые SLO-пороги, не пишет производные метрики в Supabase и не меняет recovery-routing.
- RC90 добавляет SLO Breach Watchlist & Aging поверх RC89 feed: отдельный список только активных breach-эпизодов, critical/ACK/Recovery счётчики, возраст самого старого активного эпизода и повторяющиеся активные пары. Watchlist использует те же пороги RC87 (30/120/360 минут), ничего не сохраняет в Supabase и не меняет recovery-routing.

## Архитектура

- `src/worker.js` — Cloudflare Worker, Telegram webhook, API и серверная бизнес-логика.
- `src/access-control.js` — контроль доступа.
- `src/calibration-lifecycle.js` — lifecycle калибровки модели.
- `src/security-headers.js` — security headers.
- `public/` — Mini App и публичные страницы.
- `test/` — regression suite. Старые RC-тесты намеренно сохранены: они защищают уже выпущенные контракты от регрессии.
- `scripts/verify-release.js` — статический release gate.
- `scripts/post-deploy-smoke.js` — production smoke после deploy.
- `.github/workflows/` — quality, production deploy и rollback.

## Supabase

Для уже существующего production-проекта миграции сохраняются как история схемы и применяются по порядку:

`supabase_migration_v6_9.sql` → `v6_10` → `v6_11` → `v6_11_1` → `v6_12` → `v6_13` → `v6_14` → `v6_15`.

`supabase_baseline_v6_9.sql` оставлен как отдельный baseline/bootstrap-файл и не заменяет историю миграций существующей базы.

## Проверка релиза

```bash
npm ci
npm test
npm run verify:release
npm run verify:worker
```

Production smoke дополнительно проверяет `/health`, версию `6.82.0-rc90`, `releaseCandidate=RC90`, отключённый `DEV_MODE` и обязательные health/self-test флаги.

## Документация

- `INSTALL_RU.md` — установка и конфигурация.
- `QA_RELEASE_CHECKLIST_RU.md` — актуальный release checklist.
- `MEDIA_LAUNCH_RU.md` — запуск через СМИ/Telegram и правила атрибуции.
- `.env.example` — список переменных окружения без секретов.

История изменений остаётся в Git commits и regression-тестах; отдельные `RCxx.md` больше не хранятся в корне, чтобы репозиторий не дублировал одну и ту же информацию.
