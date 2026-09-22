# RC57 — Match Selection Intelligence

## Цель

Когда поиск клуба возвращает несколько fixture, FM AI должен сам выделить наиболее полезный матч для анализа, но оставить остальные матчи доступными для сравнения.

## Серверный порядок выбора

Базовая последовательность:

`LIVE → официальный upcoming → прочий upcoming → официальный recent → прочий recent`.

Внутри одного класса upcoming выбирается более ранняя дата. Внутри recent — более свежая дата.

Официальным считается матч основной команды, если он не youth/reserve и не friendly. Турнирный priority используется как tie-breaker, а не как причина поставить далёкую игру выше более близкой официальной.

## Пример

Для одного клуба доступны:

- товарищеский матч завтра;
- официальный кубковый матч через 3 дня;
- официальный матч лиги через 5 дней;
- U21 через 2 дня;
- официальный завершённый матч вчера.

Основным становится кубковый fixture через 3 дня. Friendly завтра и U21 через 2 дня не вытесняют официальный календарь.

## API contract

`teamSearchFixturePayload` возвращает `primaryFixtureId`.

`matchDiscovery` возвращает:

- `primaryFixtureId`;
- `primaryReason`;
- прежние `mode/upcoming/recent/window*` поля.

Каждый ranked fixture содержит `selection.primary`, `selection.rank`, `selection.reason`, `selection.official`, `selection.firstTeam`.

## Mini App

Remote fixtures объединяются перед local fixtures, чтобы локальный дубликат не стирал server selection.

Основной матч получает badge `⭐ ОСНОВНОЙ МАТЧ` и человекочитаемую причину. Клиент не воспроизводит серверную бизнес-логику.

## Telegram

После поиска список повторно проходит тот же `rankTeamDiscoveryMatches`. Первый fixture отмечается звездой и пояснением «Основной матч для анализа». Остальные остаются кнопками для сравнения.

## Privacy / analytics

`search_result` может хранить numeric `primaryFixtureId`, но не текст запроса. RC57 не добавляет новую таблицу аналитики.

## Production gate

Self-test `matchSelectionDrill` должен выбрать fixture 2 в искусственной матрице. `/health.matchSelectionSelfTest` должен быть `enabled`, а production smoke обязан проверить RC57 health-флаги.