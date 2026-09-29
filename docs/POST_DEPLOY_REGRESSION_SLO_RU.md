# Post-Deploy Regression Operational SLO

Этот этап добавляет измерение скорости ручной реакции и автоматического recovery для post-deploy regression incidents.

## Переиспользуемые SLO

Новые пороги не вводятся. Используются уже действующие operational incident targets проекта:

- ACK: 30 минут;
- critical overdue ACK: 120 минут;
- recovery: 360 минут.

Источник политики: существующий incident SLO контур проекта.

## Измеряемые интервалы

Для каждого deployment generation с подтверждённым INCIDENT считаются:

- INCIDENT → ACKNOWLEDGED;
- INCIDENT → INVESTIGATING;
- INCIDENT → RECOVERED;
- INCIDENT → RESOLVED;
- RECOVERED → RESOLVED.

## Что является SLO

ACK и recovery сравниваются с существующими targets.

INVESTIGATING и RESOLVED пока являются только latency metrics. Для них не вводится новый SLA без отдельного решения по operational policy.

## Статусы

ACK:

- pending — target ещё не истёк;
- met — ACK записан не позднее 30 минут;
- breached — ACK отсутствует после 30 минут или записан позже;
- critical overdue — активный incident остаётся без ACK 120 минут и более.

Recovery:

- pending — прошло менее 360 минут и RECOVERED ещё нет;
- met — recovery произошёл не позднее 360 минут;
- breached — active incident старше 360 минут либо recovery был позже target.

## Admin UI

Release Monitor показывает:

- текущие ACK / investigation / recovery / resolution latency;
- ACK SLO status;
- recovery SLO status;
- critical overdue ACK;
- агрегированный ACK SLO %;
- агрегированный recovery SLO %;
- число incident episodes в доступном operational window.

## Persistence

Новых записей для SLO metrics не создаётся.

Метрики вычисляются read-only из существующих:

- release_regression lifecycle events;
- release_regression_response audit events.

Новая таблица и миграция не требуются.

## Safety

Этап не выполняет:

- automatic rollback;
- provider switch;
- feature disable;
- runtime-control mutation;
- изменение regression thresholds;
- изменение alert policy.
