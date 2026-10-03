# MatchRadar — Telegram initData security

## Что гарантирует initData

Telegram Mini App `initData` подтверждает Telegram-идентичность и целостность подписанных полей. Один и тот же валидный initData штатно используется Mini App для нескольких API-запросов, поэтому его нельзя глобально помечать одноразовым после первого обращения.

MatchRadar проверяет HMAC-подпись, ограничивает возраст initData согласно типу маршрута и допускает только небольшой будущий clock skew в 30 секунд. Payload с `auth_date` дальше этого допуска отклоняется.

## Replay-защита чувствительных операций

Повторная отправка одного и того же initData сама по себе не должна повторять чувствительную операцию. Для чувствительных mutation routes Worker формирует непрозрачный SHA-256 replay key из:

- Telegram user ID после успешной серверной аутентификации;
- HTTP method;
- route path;
- optional `x-idempotency-key`;
- request body.

Точное повторение успешно выполненной операции блокируется на пять минут. Одновременный повтор блокируется, пока первая операция выполняется. Если операция завершилась ошибкой HTTP 4xx/5xx или handler выбросил исключение, reservation снимается и корректный retry разрешается.

Ledger ограничен по TTL и количеству записей; сырые body, initData, idempotency key и Telegram user ID в replay key не хранятся.

## Защищённые mutation routes

Replay guard применяется к административным/денежным/операционным mutation routes, включая billing refund, channel publisher test, runtime controls/rollback, recovery incident acknowledgement, post-deploy regression response, calibration control, model remediation и billing mutations.

Обычные GET-запросы не блокируются. Пользовательские preferences/favorites/reminders не переводятся на глобальную одноразовость initData: для них сохраняются их собственные server-side idempotent/CAS semantics.

## Дополнительные durable safeguards

Generic replay guard является дополнительным слоем, а не заменой бизнес-инвариантов. Денежные операции по-прежнему проверяют charge ownership/replay, post-deploy response использует transition identity, а remediation использует server-issued candidate/resolution tokens. Эти механизмы остаются авторитетными для меж-инстансной и долговременной целостности.
