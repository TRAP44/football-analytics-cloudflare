# Football Analytics Mini App v6.65.0 — RC73

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
- Новостной контур RC69–RC73: новость → релевантный матч → явная AI-перепроверка → News Impact Delta → **News Impact Decision Card** → **News Impact Action Tracking**.
- News Impact не утверждает причинность по заголовку: сравнение разрешено только с корректным AI-снимком, созданным до публикации новости.
- RC73 считает только категориальные действия после Decision Card: полный AI, составы, рынок, повторная проверка, возврат к новостям и share. Текст новости, URL и пользовательский запрос в эту аналитику не записываются.

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

Production smoke дополнительно проверяет `/health`, версию `6.65.0-rc73`, `releaseCandidate=RC73`, отключённый `DEV_MODE` и обязательные health/self-test флаги.

## Документация

- `INSTALL_RU.md` — установка и конфигурация.
- `QA_RELEASE_CHECKLIST_RU.md` — актуальный release checklist.
- `MEDIA_LAUNCH_RU.md` — запуск через СМИ/Telegram и правила атрибуции.
- `.env.example` — список переменных окружения без секретов.

История изменений остаётся в Git commits и regression-тестах; отдельные `RCxx.md` больше не хранятся в корне, чтобы репозиторий не дублировал одну и ту же информацию.
