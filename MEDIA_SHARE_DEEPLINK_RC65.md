# RC65 — Media Share & Deep-Link Loop

## Цель

Сделать матч FM AI распространяемым через Telegram-каналы, СМИ и личные чаты без повторного поиска: пользователь открывает ссылку на конкретный fixture и бот сразу продолжает сценарий на этом матче.

## Deep-link формат

Используется Telegram `/start` payload до 64 символов:

`fx<fixtureId>__<source>__<campaign>__<content>`

Пример:

`fx123456__media__launch__sportnews`

Payload проходит существующую очистку attribution-полей и несёт:

- `fixtureId`;
- источник перехода;
- кампанию;
- content/surface.

## Сценарий входа

При обычном `/start` поведение бота не меняется.

При fixture deep-link:

1. пользователь и first-touch attribution сохраняются как раньше;
2. событие `bot_start` получает атрибуцию текущей ссылки;
3. фиксируется `fixture_deep_link_open`;
4. бот конфигурирует интерфейс;
5. матч загружается по fixture ID;
6. pre-match автоматически получает короткий AI-разбор;
7. LIVE/finished матч сразу получает соответствующий Match Center flow.

Повторный поиск команды не нужен.

## Ссылки

`/api/share-link?fixtureId=...` получает username текущего Telegram-бота через официальный `getMe`, кэширует его на 24 часа и возвращает:

- прямую `t.me/<bot>?start=...` ссылку;
- start payload;
- Telegram native share URL.

Новый secret или ручное хранение username не требуется.

## Mini App

Кнопка `↗ Поделиться матчем` теперь:

- получает fixture deep-link с сервера;
- внутри Telegram открывает нативное окно отправки;
- при поддержке Web Share API использует системное меню;
- иначе копирует текст и ссылку в буфер.

Карточка содержит команды, турнир, вероятности, AI-сигнал/основной исход, уверенность и дисклеймер.

## Telegram

Во всех основных карточках матча добавлена кнопка `↗ Поделиться матчем`.

Бот формирует компактную HTML-карточку и кнопку `↗ Отправить другу / в канал`, которая использует Telegram share composer. Получатель получает deep-link на тот же fixture.

## Attribution

Для deep-link с fixture текущая campaign attribution используется не только на `bot_start`, но и на следующих `match_open`, `quick_ai` и `ai_handoff` событиях текущего входа. First-touch пользователя при этом не перезаписывается.

## Media loop analytics

Админская launch funnel дополнена агрегатами:

- созданные share-ссылки/карточки;
- открытия fixture deep-link;
- уникальные deep-link пользователи;
- пользователи, дошедшие до AI без повторного поиска;
- conversion deep-link → AI.

Telegram ID и текст пользовательских запросов в админский ответ не возвращаются.

## API budget

Создание ссылки не вызывает API-Football. Матч при входе сначала ищется в существующем cache; запрос `/fixtures?id=...` используется только при необходимости и под действующим free-quota guard.

## Production gate

`fixtureDeepLinkDrill` проверяет кодирование fixture ID и source/campaign/content. RC65 также требует regression suite, release verification, Worker dry-run и post-deploy smoke.