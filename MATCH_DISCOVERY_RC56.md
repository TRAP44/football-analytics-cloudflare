# RC56 — Match Discovery & Zero-Result Recovery

## Цель

Свести к минимуму ситуацию, когда клуб уже распознан, но пользователь видит пустой результат только потому, что у команды нет матча сегодня или провайдер не вернул короткий календарь.

## Discovery window

Для поиска клуба используется один запрос `/fixtures?team=<id>&from=<date>&to=<date>`:

- 30 дней назад;
- 120 дней вперёд;
- без параметра `next`, который недоступен на используемом free-плане API-Football.

Отменённые, перенесённые, прерванные и awarded-матчи не попадают в discovery.

## Порядок результата

1. LIVE;
2. ближайшие предстоящие;
3. последние завершённые.

Если upcoming отсутствует, последние завершённые матчи являются recovery-результатом, а не «ошибкой поиска».

`matchDiscovery.mode` принимает `upcoming / recent / empty`.

## Один календарь для Telegram и Mini App

Telegram и Mini App используют `loadSearchTeamMatches` и cache:

`search:team-fixtures:<teamId>:<from>:<to>:v2`.

Это исключает прежний сценарий, когда Mini App сначала выполнял `/api/search`, а затем автоматически запускал второй `/api/team` только ради календаря.

Team Hub остаётся доступным по клику пользователя и использует то же окно discovery.

## Zero-result UX

Если команда найдена и upcoming есть — показываются ближайшие матчи.

Если upcoming нет, но recent есть — интерфейс прямо говорит, что показывает последние завершённые игры.

Если в окне нет ничего — команда всё равно остаётся кликабельной, а UI сообщает, что календарь в окне не вернулся. Пользователь может открыть Team Hub или повторить поиск позже.

## Аналитика

Telegram `search_result` получает безопасное поле `recovery`:

- `upcoming`;
- `recent`.

Текст запроса не сохраняется. В launch funnel агрегируется `searchQuality.recoveredRecent`.

## Production gate

RC56 считается готовым, если:

- Quality проходит `npm test`, `verify:release`, `verify:worker`;
- health содержит `zeroResultRecovery`, `teamFixtureDiscovery`, `sharedFixtureDiscoveryCache`, `extendedTeamCalendar`, `recentMatchFallback`;
- post-deploy smoke подтверждает `6.48.0-rc56`;
- поиск известного клуба не делает скрытый второй Team Hub запрос.