# Production-аудит: первая итерация, 28 сентября 2026

База анализа: `80c1da69903835576ffeeaaca72c2d71b403ef37`, PR #163.
Это проверка критических путей и подтверждённый backlog, не заявление о полном покрытии всех функций или нагрузочной сертификации.

## Фактическое состояние до изменения

- Quality 36430140405, Deploy Production 36430228326, External Production Monitor 36430378268: success.
- Deploy подтвердил SHA базы, release 6.120.0-rc144, version c5d6ff83-5e1c-4762-b0c8-4cf65349e9c8; 25 smoke checks и rendered navigation на 360/375/390/430 px прошли.
- Открытые PR: #154, #153, #152 (зависимости), #63, #46, #42, #33. Их изменения не дублируются и не объединяются в этот fix.
- Supabase ACTIVE_HEALTHY. В ops_events после 13:39:14 UTC на момент проверки нет error/critical. Отфильтрованные ERROR/FATAL/PANIC logs за 13:39:14–14:00 UTC пусты. Это не доказательство отсутствия всех ошибок: сохранение observability имеет пробел ниже.
- Все 28 public-таблиц имеют RLS; SELECT для anon/authenticated отсутствует. INFO «RLS без политик» соответствует серверной модели доступа и не является основанием открывать данные клиентам. Performance advisor сообщает неиспользованные индексы; удалять их без наблюдения под нагрузкой нельзя.

## Уже работающие механизмы

Backend имеет выделенные границы auth, HTTP, router, cache, provider requests, Supabase, cron и Telegram. В cron используется allSettled с регистрацией rejected и явного ok:false. Supabase mutations не используют read retry. Provider GET boundary обрабатывает timeout, 429, 502/503/504 и невалидный JSON. Frontend повторяет только GET и удаляет завершённые single-flight requests. Telegram initData проверяется HMAC; admin sensitive paths имеют более короткое время действия. Deploy проверяет provenance и текущий main, затем активную версию и smoke. Actions и Wrangler закреплены, обновления уже предложены Dependabot.

## Подтверждённые проблемы и backlog

Critical: в изученных путях не подтверждены. High здесь означает операционный риск, а не доказанную потерю пользовательских данных.

| Приоритет | Проблема и место | Риск / impact | Решение | Сложность / риск изменения | Migration / новый сервис | Срок |
| --- | --- | --- | --- | --- | --- | --- |
| High | `worker.js`: runProductionMonitor → readProviderIncidentAlertEvents → send → recordOpsEvent | Параллельные исполнения могут прочитать одинаковую историю и отправить дубли. При сбое БД fallback локальный, история не общая. Частота в production не измерена. | Атомарный persistent claim по incident/recipient/kind, явная политика unknown delivery, поведенческие race tests | Средняя / средний | Вероятно migration; сервис не нужен | Следующая отдельная итерация |
| High | `worker.js`: recordOpsEventTask не проверяет response.ok | HTTP 4xx/5xx записи события считается завершением; исчезают история и основания для дедупликации | Возвращать статус persistence и учитывать его в alert orchestration; не ломать пользовательские запросы | Средняя / средний | Нет / нет | Вместе с надёжностью alert store |
| High при росте | `reminder-delivery-service.js`: первые 250 enabled reminders без pagination и без исключения уже доставленных | При >250 совпадающих записей часть получателей может не попасть в окно отправки; последовательная отправка удлиняет cron | Выборка реально pending, keyset pagination, ограниченный бюджет выполнения и fairness tests | Средняя / средний | Уточнить EXPLAIN и индексы / нет | До публичного запуска |
| Medium | `provider-incident-alerts.js`: retry_after=2 урезается до 1500 ms | Преждевременный запрос, повторный 429, отсрочка уведомления | Ожидать 2000 ms в пределах существующего лимита; >2 s по-прежнему откладывать | Низкая / низкий | Нет / нет | Исправлено в этой итерации |
| Medium | `worker.js`: alert history order created_at.asc, limit 300 | После 300 событий в 7-дневном окне новые delivery events не читаются, возможны повторы | Выборка по текущему incident/key либо pagination с контролем полноты | Низкая–средняя / средний | Не обязательно / нет | До роста истории |
| Medium | `provider-incident-alerts.js`: получатели определяются индексом в массиве | Перестановка ADMIN_TELEGRAM_IDS меняет смысл сохранённых deliveredSlots | Стабильные непрозрачные recipient keys, совместимость старой истории | Средняя / средний | Возможно без migration / нет | До изменения состава администраторов |
| Medium | `api-football-gateway.js`: emergency budget локален при отказе Supabase | Несколько isolates суммируют лимиты; 2/min на isolate не гарантирует общий free quota | Проверить strict admission во всех вызывающих путях; согласовать поведение для cache miss при потере shared guard | Средняя / средний | Нет для fail-closed / нет | До публичного запуска |
| Medium | `scheduled-jobs.js` видит ok:false, но reminders возвращает failed>0 без ok | Обёртка cron не отмечает частичный отказ этого задания; отдельные reminder events есть | Явный единый outcome-контракт для задач и failure-path tests | Низкая–средняя / низкий | Нет / нет | Следующие итерации |
| Medium | Integration tests incident-модулей в основном ищут строки исходника | Зелёный CI не доказывает concurrent delivery/persistence semantics | Добавить поведенческие integration tests с fake DB/Telegram и отказами записи | Средняя / низкий | Нет / нет | Вместе с alert store |
| Low | worker ~1.2 MB, app.js ~508 KB, styles.css ~219 KB исходного текста | Сложность сопровождения; реальные download/parse затраты ещё не измерены | Выделять только проверенные границы: alert persistence и orchestration; измерить frontend загрузку до разделения bundle | Средняя / средний | Нет / нет | После reliability |

## Если внешний сервис начнёт сбоить

- Football provider: cache/fallback и cooldown ограничивают последствия; свежие данные и AI на cache miss могут быть недоступны. Incident требует подтверждения SLO-окнами, cron monitor идёт раз в 15 минут. Это десятки минут при достаточном трафике, не гарантированная мгновенная доставка; малые выборки и потеря telemetry увеличивают задержку.
- Supabase: персональные записи и distributed coordination деградируют; криптографически подтверждённые read-only запросы не обязаны падать из-за user sync. Persisted incidents и delivery history сами зависят от БД.
- Telegram: mini app может оставаться доступным, но уведомления не доходят. Тот же Telegram используется для alert delivery, поэтому внешняя проверка доступности не заменяет контроль успешной доставки.
- External monitor проверяет live/ready/public-status каждые 15 минут по расписанию GitHub (возможны задержки). Public degraded/maintenance считается warning с успешным exit; workflow создаёт issue только при failure. Зелёный run сам по себе не означает исправность всех продуктовых функций.

## Готовность к росту

Число зарегистрированных пользователей не равно нагрузке: нужны concurrency, cache hit ratio, число уникальных матчей и напоминаний.

| Пользователи | Следующая необходимая проверка |
| --- | --- |
| 10 | Ошибки доставки, сохранение событий, quota и пользовательский сценарий на реальных матчах |
| 100 | Пиковые одновременные открытия, shared cache и число provider calls; synthetic burst в изоляции |
| 1 000 | Более 250 reminders на одно время, pagination/fairness, DB latency и coordinator failures |
| 10 000 | Нагрузочный стенд, delivery throughput, fan-out и bounded concurrency, измеренный бюджет БД/provider/logging |

Гарантий для этих объёмов пока нет; production load tests не проводились. Новые платные API и инфраструктура в этой итерации не добавляются.

## Проверка исправления

Четыре новых поведенческих теста: retry_after 1/2, длинная задержка и предел двух попыток. До fix два теста падали с actual 1500 / expected 2000; после fix общий suite 1056/1056. Локально прошли lint, syntax, security scan, release verification, Worker dry-run; npm audit — 0 vulnerabilities. Локальный rendered smoke не запустился: Chrome отсутствует. Его обязательное выполнение оставлено в GitHub Quality и production workflow. Скриптов typecheck и build в package.json нет.

Не проверены полностью: restore в отдельную БД, полный schema diff, все IDOR/abuse paths, authenticated визуальный обход mini app, Cloudflare runtime logs и реальные delivery races. Полный аудит остаётся итеративной работой; этот документ не заменяет эти проверки.

Основание retry_after: https://core.telegram.org/bots/api#responseparameters
Supabase INFO: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
