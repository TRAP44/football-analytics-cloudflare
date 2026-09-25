# Closed Beta Launch & Evidence-Based Optimization

Дата снимка: 2026-09-25  
Когорта: `closed_beta_v1`

## Исходная точка

Этап **Closed Beta Access & Field Validation** не повторяется. Его серверная граница, privacy-isolation и тестовые контракты остаются базой. Этот документ фиксирует только запуск настоящей закрытой beta и работу с доказательствами.

## Что подтверждено перед этим этапом

- server-side beta membership проверяется после валидированной Telegram initData;
- admin имеет отдельный bypass и не считается beta-участником;
- обычный пользователь не получает admin-доступ;
- Beta Dashboard читает только `closed_beta_v1` с `betaMembershipVerified=true`;
- beta telemetry использует HMAC-псевдоним и не пишет raw Telegram ID в legacy growth analytics;
- admin и non-beta события не входят в beta-метрики;
- последний проверенный production release перед этим этапом прошёл Quality 767/767 и post-deploy smoke 25/25.

## Фактические blockers на старте этапа

На момент снимка в production `ops_events`:

- verified beta events: **0**;
- verified beta users: **0**;
- verified beta feedback: **0**.

Поэтому этап нельзя считать запущенным или завершённым только по наличию Beta Dashboard.

До первой реальной когорты обязательно подтвердить:

1. минимум два реальных non-admin аккаунта Beta-01 и Beta-02 в `BETA_TELEGRAM_IDS`;
2. `BETA_ACCESS_ENABLED=true` в production;
3. реальный Telegram webhook через `getWebhookInfo`;
4. API-Football quota через существующий admin provider probe; подтверждение сохраняется как `PROVIDER_QUOTA_CONFIRMED` без ключей и персональных данных;
5. ручной LIVE field validation на реальном LIVE матче;
6. зелёный Quality/Security/Release gate текущего commit и production smoke.

Ни один из пунктов выше не считается выполненным по предположению.

## Измерение beta

Используется только существующий контур: `ops_events`, Beta Dashboard, privacy-safe client telemetry, operation timing, beta feedback, action_error, provider monitoring и production monitoring. Второй analytics pipeline не создаётся.

Полный путь теперь считается последовательно, а не просто по наличию отдельных событий:

`open → search_used → search_found → match_open → ai_start → ai_complete → history_open → reopen`.

Повторный вход — отдельный второй `BOOT_OK` после прохождения истории. Это исключает ложное завершение funnel из событий, пришедших в неправильном порядке.

Одиночный telemetry/feedback сигнал получает классификацию `NEEDS_MORE_EVIDENCE` и не становится активной проблемой. Подтверждёнными считаются только `BLOCKER`, `MAJOR` и `MINOR` по существующим правилам корреляции/повторяемости.

Client/UI errors учитываются отдельно и входят в UX evidence.\n\nПосле успешного открытия match center существующий `/api/client-telemetry` получает только пять privacy-safe boolean coverage-сигналов: составы, травмы/availability, статистика, xG и коэффициенты. Fixture ID, названия команд, поисковые строки и raw ошибки в этот сигнал не входят. Dashboard показывает частоту отсутствия каждого типа данных отдельно.

## Порядок реакции

`BLOCKER → MAJOR → повторяющийся UX → performance → MINOR`.

После каждого исправления обязательны связанные тесты, полный Quality/Security/Release gate, проверка beta boundary, privacy-safe telemetry и production smoke.

Новый football provider или платный источник не добавляется по единичным пропускам данных. Решение возможно только после систематического beta-evidence по coverage/rate-limit/LIVE или конкретному критичному типу данных. Веса аналитической модели в этом этапе не меняются.

## Критерий завершения

Этап завершается только после достаточного числа реальных beta-сессий, когда можно доказательно посчитать full journey, drop-off, latency, повторяющиеся ошибки, feedback, missing-data patterns и принять решение о расширении когорты.

До появления реальных beta-сессий корректный операционный статус: **BETA HOLD — FIXES REQUIRED**.
