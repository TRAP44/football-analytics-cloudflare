# Football Analytics Mini App v6.74.0 — RC82

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
- Новостной контур RC69–RC82: новость → релевантный матч → явная AI-перепроверка → News Impact Delta → **News Impact Decision Card** → **News Impact Action Tracking** → **News Impact Action Funnel** → **News Impact Funnel Confidence Guard** → **News Impact Funnel Trend Guard** → **News Impact Temporal Attribution Guard** → **News Impact Action Outcome Quality** → **News Impact Outcome Failure Diagnostics & Recovery** → **News Impact Recovery Effectiveness Funnel** → **News Impact Recovery Strategy Guard** → **News Impact Recovery Stability & Parity Guard**.
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

Production smoke дополнительно проверяет `/health`, версию `6.74.0-rc82`, `releaseCandidate=RC82`, отключённый `DEV_MODE` и обязательные health/self-test флаги.

## Документация

- `INSTALL_RU.md` — установка и конфигурация.
- `QA_RELEASE_CHECKLIST_RU.md` — актуальный release checklist.
- `MEDIA_LAUNCH_RU.md` — запуск через СМИ/Telegram и правила атрибуции.
- `.env.example` — список переменных окружения без секретов.

История изменений остаётся в Git commits и regression-тестах; отдельные `RCxx.md` больше не хранятся в корне, чтобы репозиторий не дублировал одну и ту же информацию.
