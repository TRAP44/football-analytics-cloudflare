# Football Analytics Mini App v2.0.3 — Cloudflare Workers

Эта версия подготовлена для Cloudflare Workers + Static Assets и не требует банковской карты для тестового бесплатного запуска.

## Что загружать в GitHub

Загрузите содержимое этой папки в корень репозитория. Реальный `.env` не загружайте.

Ключевые файлы:
- `wrangler.jsonc`
- `src/worker.js`
- `public/`
- `package.json`
- `supabase_schema.sql`

## Cloudflare

1. Workers & Pages → Create application.
2. Import a repository → GitHub.
3. Выберите репозиторий `football-analytics-miniapp`.
4. Production branch: `main`.
5. Build command оставить пустым.
6. Deploy command: `npx wrangler deploy`.
7. Root directory: `/` (или пусто).
8. Save and Deploy.

После первого deploy откройте Worker → Settings → Variables and Secrets и добавьте Secrets:
- `TELEGRAM_BOT_TOKEN`
- `API_FOOTBALL_KEY`
- `TAVILY_KEY`

Необязательно пока:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Не секретные значения уже лежат в `wrangler.jsonc`:
- DEV_MODE=false
- FREE_DAILY_LIMIT=3
- PRO_DAILY_LIMIT=20
- PREMIUM_DAILY_LIMIT=100
- CACHE_MINUTES=20

## Проверка

Откройте:
`https://ВАШ-WORKER.workers.dev/health`

Ожидаемый ответ:
`{"ok":true,"version":"2.0.3-cloudflare",...}`

Обычное открытие сайта в браузере покажет интерфейс, но API будет требовать Telegram, потому что DEV_MODE=false. Это нормально.

## Telegram

После получения HTTPS URL укажите его в @BotFather как Main Mini App URL.

## Supabase

Без Supabase Worker использует временную память, поэтому лимиты и кэш могут сбрасываться. Для публичного запуска подключим Supabase следующим шагом.
