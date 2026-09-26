# MatchRadar — current public brand specification

> Канонический public-facing brand contract после controlled rebrand с FutLens AI. Исторический документ `PHASE4_2_BRAND_IDENTITY_RU.md` сохраняется как запись предыдущего этапа и не является текущим source of truth.

## Public naming

- **Продукт:** MatchRadar
- **Telegram-бот:** MatchRadar AI
- **Telegram-канал:** MatchRadar | Футбол сегодня
- **Основной слоган:** Видим, что меняет матч.
- **Позиционирование:** AI-футбольный ассистент в Telegram.
- **Descriptor:** Матчи, LIVE и AI-разбор — быстро и по делу.
- **About:** AI-футбольный ассистент в Telegram: матчи, команды, LIVE и понятный разбор ключевых факторов.
- **Channel description:** Матчи дня, составы, важные изменения и короткие AI-инсайты. Без лишнего шума. Полный разбор матчей — в MatchRadar AI.

## Visual identity

Сохраняется premium sports-tech direction Phase 4.2: dark graphite / Night Pitch, electric mint, secondary cool blue, clean typography, minimal sports-tech UI и существующая Home / Match Center hierarchy.

Знак MatchRadar объединяет:
- контур футбольного поля / центральную разметку;
- круг радара / focus signal;
- холодно-синий sweep/accent;
- компактную геометрию, читаемую в маленьком Telegram avatar.

Не использовать игровой, casino или букмекерский visual language.

## Current assets

- `public/assets/brand/matchradar-mark.svg` — app/favicon mark.
- `public/assets/brand/matchradar-avatar.svg` — Telegram avatar source.
- `public/assets/brand/matchradar-wordmark.svg` — horizontal wordmark.

## Public surfaces

Mini App startup и header используют **MatchRadar** и слоган **«Видим, что меняет матч.»**.

Telegram bot profile:
- display name: **MatchRadar AI**;
- short description: **Матчи, LIVE и AI-разбор — быстро и по делу.**
- description: **AI-футбольный ассистент в Telegram: матчи, команды, LIVE и понятный разбор ключевых факторов.**

Telegram channel concept:
- name: **MatchRadar | Футбол сегодня**;
- description: **Матчи дня, составы, важные изменения и короткие AI-инсайты. Без лишнего шума. Полный разбор матчей — в MatchRadar AI.**

## Deep-link / growth flow

**Channel post → generated fixture link → MatchRadar Mini App → concrete Match Center / AI analysis → Share / Back to Telegram.**

Этот rebrand не запускает Telegram Publisher и не расширяет Phase 5 evidence. `phase5_public_v2` остаётся без изменений.

## Technical boundaries

Не переименовывать без отдельной миграции:
- repository/package/internal API identifiers;
- database schema;
- telemetry internals;
- Cloudflare Worker technical name;
- historical RC/test filenames и internal feature keys вроде `fmAiNews`.

Не изменять Telegram initData, public access, admin authorization, API contracts, Supabase schema, provider logic, AI model, monetization или Phase 5 evidence scope.
