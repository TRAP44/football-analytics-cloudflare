# Phase 4.2 — Brand Identity & Premium UI Polish

Baseline Phase 4: `7ca8d20a5fc173523745071d49d709b8c530bdda`  
Implementation base: `b1cb81cc292ff9d6d8e68899b4d76e3aa09750d7`  
Phase 5: не отменяется. Cohort `phase5_public_v2` сохраняется без расширения product evidence.

## 1. Brand audit

Текущее публичное имя `FM AI` короткое, но аббревиатура `FM` в футбольном контексте легко читается как Football Manager. Это создаёт лишнюю ассоциацию с игрой/симулятором и не объясняет главную ценность продукта: быстро понять матч, следить за командами и получать AI-разбор внутри Telegram.

Целевое восприятие:

> умный футбольный AI-ассистент внутри Telegram — не игра, не букмекерский бот и не dev dashboard.

Внутренние repository/package/API identifiers не переименовываются: ребрендинг ограничен public-facing слоем.

## 2. Три бренд-концепции

### A. FutLens AI — выбранное направление

**Смысл:** football + lens. Продукт помогает «сфокусироваться» на матче и увидеть главное.  
**Слоган:** **Понимай матч глубже.**  
**Тон:** уверенный, спокойный, аналитичный, человеческий.  
**Почему подходит:** футбольная ассоциация считывается без слова Manager; Lens задаёт роль помощника/инструмента понимания, а не игры.  
**В Telegram:** короткий знак-линза, имя FutLens AI, компактные CTA «Открыть матч» / «AI-разбор».

### B. KickScope AI

**Смысл:** football action + scope, быстрый обзор того, что влияет на матч.  
**Слоган:** **Главное в матче — без шума.**  
**Тон:** быстрый, технологичный, editorial.  
**Почему подходит:** хорошо описывает навигацию по матчу и LIVE-контексту.  
**В Telegram:** строгая геометрия, прицел/поле как знак, короткие match-first уведомления.

### C. PitchBrief AI

**Смысл:** brief по матчу и командам прямо с футбольного поля.  
**Слоган:** **Матч. Факторы. Вывод.**  
**Тон:** сдержанный, информационный, профессиональный.  
**Почему подходит:** подчёркивает экономию времени и структурированный AI-разбор.  
**В Telegram:** карточки в стиле спортивного briefing feed, минимум декоративного шума.

## 3. Выбранный бренд

**Public name:** FutLens AI  
**Descriptor:** футбольный AI-ассистент в Telegram  
**Primary slogan:** Понимай матч глубже.  
**Secondary line:** Матчи, LIVE и AI-разбор — быстро и по делу.

Важно: выбор — product direction, а не юридическая регистрация товарного знака. Перед внешней рекламной кампанией нужен отдельный trademark/domain check по целевым рынкам.

## 4. Visual identity

### Palette

- **Night Pitch** — `#07111F`: базовый тёмный brand background.
- **Deep Surface** — `#0F1D2E`: premium surfaces.
- **Electric Mint** — `#43E6A1`: основной акцент.
- **Ice Blue** — `#7CC7FF`: secondary AI/data accent.
- **Paper** — `#EAF2F7`: светлый нейтральный.
- **LIVE Coral** — `#FF5A67`: только LIVE/urgent state, не основной бренд-цвет.

### Typography

Используется системный Telegram-friendly stack без внешней font dependency. Иерархия:

- Brand / hero: 800–900, tight tracking.
- Screen title: 700–800.
- Match teams / primary metric: 700–900.
- Supporting copy: 500–650.
- Metadata: 700–850, маленький размер, без капслока там, где он мешает чтению.

### UI tone

- clean sports-tech;
- большие спокойные поверхности вместо множества мелких рамок;
- один сильный accent CTA на контекст;
- минимум competing labels;
- LIVE красный используется только как состояние;
- betting/market информация не является первым уровнем.

### Icons

Монохромные outline-icons, rounded line caps, визуальный вес около 1.8–2 px. Emoji не используются как главные навигационные иконки.

## 5. Brand assets

- `public/assets/brand/futlens-mark.svg` — основной app/favicon mark.
- `public/assets/brand/futlens-avatar.svg` — квадратный Telegram avatar source.
- `public/assets/brand/futlens-wordmark.svg` — horizontal wordmark.

Знак объединяет футбольный центр поля и линзу: круг = фокус/центр поля, ручка = lens, mint/blue = AI/data layer.

## 6. Public Mini App

### Startup

Показывает только:

- FutLens AI;
- «Понимай матч глубже.»;
- «Загружаем матчи…»;
- минимальный progress.

Release/RC/build/provider/runtime/API terminology не выводится.

### Home

Первый уровень остаётся:

1. поиск;
2. LIVE — только при наличии реальных live-матчей;
3. Мои команды или onboarding;
4. матчи сегодня.

Фильтры остаются secondary disclosure.

### Match cards

Первый scan layer:

- турнир;
- время/LIVE;
- команды;
- счёт;
- один основной CTA.

Favorites/reminder остаются secondary.

### AI Match Center

AI-разбор визуально оформлен как premium decision layer:

- матч и контекст;
- наиболее вероятный исход;
- П1 / Н / П2;
- confidence и data quality;
- максимум 3 главных фактора;
- максимум 3 основных риска;
- подробности раскрываются ниже.

Обычный live/finished Match Center не выдумывает вероятности, если endpoint их не возвращает: smart insight / LIVE AI / post-match review подняты выше подробных вкладок, а полный pre-match AI layer открывается отдельным CTA.

### Profile

Порядок:

пользователь/тариф → Мои команды → напоминания → настройки → **О сервисе**.

`О сервисе` остаётся последним public блоком и содержит:

- Конфиденциальность;
- Условия использования;
- Статус сервиса;
- Сообщить о проблеме;
- Версия приложения.

## 7. Telegram bot presentation

### Display name

**FutLens AI · Футбольный ассистент**

### Short description

**Матчи, LIVE и AI-разбор — быстро и по делу.**

### Full description

**FutLens AI помогает быстро понять футбольный матч: найти игру, следить за любимыми командами, открыть LIVE-контекст и получить понятный AI-разбор ключевых факторов, вероятностей и рисков. Всё внутри Telegram — без лишнего шума.**

### About text

**AI-футбольный ассистент в Telegram: матчи, команды, LIVE и понятный разбор ключевых факторов.**

### Start message

**Добро пожаловать в FutLens AI.**

Здесь можно быстро найти матч, добавить любимые команды и открыть AI-разбор: вероятности исхода, главные факторы, качество данных и риски.

**Основной CTA:** Открыть FutLens AI

### Команды / меню

- `/start` — открыть FutLens AI;
- `/matches` — матчи сегодня;
- `/teams` — мои команды;
- `/help` — помощь.

Команды — fallback. Основной UX должен оставаться button-first / Mini App-first.

BotFather profile metadata не хранится в репозитории; этот документ является канонической public-copy спецификацией для его настройки.

## 8. Telegram channel concept

### Название

**FutLens · Матчи дня**

### Описание

**Матчи дня, составы, изменения и короткие AI-инсайты. Без шума и букмекерского спама. Открывайте конкретный матч в FutLens AI.**

### Tone of voice

- коротко;
- фактически;
- без кликбейта;
- без обещаний результата;
- один вывод = один понятный тезис;
- CTA всегда ведёт в конкретный матч, если fixture известен.

### Рубрики

- **Матчи дня** — 3–5 ключевых матчей и почему за ними стоит следить.
- **Перед стартом** — составы, потери, важные изменения.
- **Что изменилось** — новые подтверждённые данные перед kickoff.
- **LIVE** — короткая заметка по изменившемуся сценарию.
- **AI-фокус** — один сильный фактор + data-confidence.
- **После матча** — что подтвердилось/не подтвердилось в предматчевом сценарии.

### Шаблон CTA

**Открыть матч в FutLens →**

Не «перейти в бота вообще», а fixture-specific deep link.

## 9. Deep-link / growth flow

В приложении уже поддерживается direct launch через:

- `?fixtureId=<id>&action=center` — конкретный Match Center;
- `?fixtureId=<id>&action=analysis` — конкретный AI-разбор;
- `?view=search&q=<query>` — поиск;
- `?view=history` — история.

Для share/growth используется существующий backend endpoint:

`/api/share-link?fixtureId=<id>&source=<source>&campaign=<campaign>&content=<content>`

Он остаётся единственной точкой генерации shareable/Telegram links. Publisher не должен вручную собирать Telegram URL, если backend уже вернул `url` / `telegramShareUrl`.

### Рекомендуемые channel tags

- `source=telegram_channel`
- `campaign=matchday`
- `content=pre_match` / `lineup` / `live` / `post_match`

### Flow

**Channel post → generated fixture link → FutLens Mini App → concrete Match Center / AI analysis → Share / Back to Telegram.**

Для общего входа используется bot profile/Main Mini App button. Для конкретного матча — только fixture-specific generated link.

## 10. Phase 5 boundary

Phase 4.2 не создаёт новый telemetry cohort, не меняет thresholds и не расширяет product evidence. `phase5_public_v2` остаётся текущим clean window.

Не меняются:

- Telegram initData validation;
- public access contract;
- admin authorization;
- API contracts;
- Supabase schema;
- provider routing/quota/cache/cooldown;
- AI model behavior;
- monetization state;
- production monitoring / rollback.
