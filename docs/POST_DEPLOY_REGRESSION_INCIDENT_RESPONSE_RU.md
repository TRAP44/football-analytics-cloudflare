# Post-Deploy Regression Incident Response

Этот этап добавляет ручной audit lifecycle для подтверждённых post-deploy regression incidents.

## State machine

`NEW → ACKNOWLEDGED → INVESTIGATING → RESOLVED`

Переходы последовательные. Пропуск состояния сервером запрещён.

### NEW

Подтверждённый regression INCIDENT существует, но администратор ещё не подтвердил, что увидел его.

Допустимое действие: **ACKNOWLEDGED**.

### ACKNOWLEDGED

Администратор подтвердил получение инцидента.

Допустимое действие: **INVESTIGATING**.

### INVESTIGATING

Администратор начал ручное расследование.

Пока regression lifecycle остаётся `INCIDENT`, закрытие заблокировано.

Допустимое действие **RESOLVED** появляется только после фактического `RECOVERED`.

### RESOLVED

Администратор вручную закрыл инцидент после автоматического подтверждения recovery мониторингом.

Повторный RESOLVED для той же deployment generation дедуплицируется.

## Persistence

Response transitions пишутся в существующий `ops_events`:

- source: `release_regression_response`;
- event_type: `incident_response`;
- deterministic `transition_key`;
- deploy SHA;
- incident ID;
- previous/next response state;
- фактический lifecycle state;
- actor role без сохранения Telegram ID администратора.

Существующий UNIQUE constraint на `ops_events.transition_key` обеспечивает cross-isolate idempotency.

Новая таблица и новая миграция не требуются.

## Safety

Endpoint доступен только администратору.

Перед записью сервер повторно проверяет:

1. текущий active deployment SHA;
2. persistent ops history;
3. отсутствие truncation истории;
4. наличие реального regression INCIDENT;
5. допустимость следующего state transition;
6. для RESOLVED — наличие RECOVERED.

Fail-soft не превращается в ложный успех: если persistent write не подтверждён, API возвращает ошибку.

## Что этот этап НЕ делает

- automatic rollback;
- provider switch;
- feature disable;
- runtime-control mutation;
- изменение regression thresholds;
- изменение provider policy.
