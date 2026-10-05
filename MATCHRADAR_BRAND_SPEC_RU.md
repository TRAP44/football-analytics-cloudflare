# MatchRadar — публичная спецификация бренда

Этот документ — текущий source of truth для публичного бренда MatchRadar.

## Название и позиционирование

- **Продукт:** MatchRadar
- **Telegram-бот:** MatchRadar AI
- **Telegram-канал:** MatchRadar | Футбол сегодня
- **Основной слоган:** Видим, что меняет матч.
- **Позиционирование:** AI-футбольный ассистент в Telegram.
- **Короткое описание:** Матчи, LIVE и AI-разбор — быстро и по делу.
- **Описание продукта:** AI-футбольный ассистент в Telegram: матчи, команды, LIVE и понятный разбор ключевых факторов.
- **Описание канала:** Матчи дня, составы, важные изменения и короткие AI-инсайты. Без лишнего шума. Полный разбор матчей — в MatchRadar AI.

## Визуальный стиль

Основное направление: современный sports-tech интерфейс с тёмной графитовой базой, electric mint как главным акцентом, дополнительным холодным синим и чистой компактной типографикой.

Знак MatchRadar объединяет:
- геометрию футбольного поля и центральной разметки;
- радар / focus signal;
- холодно-синий sweep/accent;
- компактную форму, читаемую в маленьком Telegram avatar.

Не использовать casino, игровой или букмекерский visual language.

## Текущие бренд-ассеты

- `public/assets/brand/matchradar-mark.svg` — основной знак приложения и favicon.
- `public/assets/brand/matchradar-avatar.svg` — источник Telegram avatar.
- `public/assets/brand/matchradar-wordmark.svg` — горизонтальный wordmark.

## Публичные поверхности

Mini App startup и header используют **MatchRadar** и слоган **«Видим, что меняет матч.»**.

Telegram bot:
- display name: **MatchRadar AI**;
- short description: **Матчи, LIVE и AI-разбор — быстро и по делу.**;
- description: **AI-футбольный ассистент в Telegram: матчи, команды, LIVE и понятный разбор ключевых факторов.**

Telegram channel:
- name: **MatchRadar | Футбол сегодня**;
- description: **Матчи дня, составы, важные изменения и короткие AI-инсайты. Без лишнего шума. Полный разбор матчей — в MatchRadar AI.**

## Deep-link / growth flow

**Channel post → generated fixture link → MatchRadar Mini App → конкретный Match Center / AI-анализ → Share / Back to Telegram.**

Брендинг сам по себе не включает publisher, платежи или новые продуктовые возможности.

## Технические границы

Публичный rebrand не требует переименования внутренних технических идентификаторов, если это может нарушить совместимость.

Без отдельной миграции не изменять:
- repository/package/internal API identifiers;
- database schema;
- telemetry internals;
- Cloudflare Worker technical name;
- совместимые internal feature keys;
- Telegram initData и авторизацию;
- API contracts;
- Supabase schema;
- provider logic;
- AI model;
- monetization state.
