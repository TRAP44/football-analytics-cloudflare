# RC60 — Pre-Kickoff Change Detection

## Цель

После pre-kickoff recheck пользователь должен увидеть не только свежий timestamp, а конкретный ответ на вопрос: что изменилось относительно предыдущего AI-снимка.

## Delta contract

`analysisRecheckDelta(previous,next)` сравнивает два готовых analysis payload и возвращает:

- `available`;
- `material / stable`;
- `codes`;
- `items[]` с `code/title/before/after/importance`;
- краткий `summary`.

Новых запросов к API-Football функция не делает.

## Что сравнивается

- AI signal (`skip`, `П1`, `X2`, total и т.д.);
- итоговые вероятности П1/Н/П2;
- confidence;
- подтверждение стартовых составов;
- количество подтверждённых потерь;
- market probabilities;
- появление назначения судьи.

Порог шума: probability ≥3 п.п., market ≥2.5 п.п., confidence ≥8 пунктов.

## material / stable

`stable=true`, когда после перепроверки нет ни одного meaningful delta-item.

`material=true`, когда есть high-importance item или изменения signal/probability/lineups/market. Это не утверждение о результате матча — только описание того, что входные данные и AI-вывод изменились.

## Telegram

После фактического recheck short brief добавляет блок `Что изменилось после перепроверки` и максимум 3 пункта.

## Mini App

Freshness-card показывает delta list. Для stable состояния отображается `Прогноз стабилен`; для material — заметный блок `Что изменилось`.

## Analytics

`analysis_recheck` хранит `free`, `reason`, `material`, `stable`, `changeCount`, `codes`. Текст поиска и произвольный пользовательский ввод не сохраняются.

## Production gate

`analysisDeltaDrill` должен детерминированно обнаружить signal, probability, lineups и market. `/health.analysisDeltaSelfTest` и RC60 post-deploy smoke должны быть зелёными.