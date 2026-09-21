# Football Analytics Mini App v6.0.0 — RC8 Prediction Integrity Hardening

RC8 исправляет контракт времени prediction snapshot и не допускает повреждённые строки в метрики качества. Новых платных функций и новых API-Football запросов нет.

## Что исправлено в RC8

- проверка pre-match времени использует реальное поле таблицы `captured_at` (с fallback на `created_at` для ручных legacy snapshots);
- пустые `null`/`''` probabilities больше не преобразуются в допустимый ноль;
- проверяются согласованность счёта с `actual_outcome`, максимум probabilities с `predicted_outcome` и флаг `correct`;
- строки с integrity FAIL отображаются в диагностике, но исключаются из accuracy / Brier / log loss / calibration cohorts;
- Brier для dashboard пересчитывается из проверенных probabilities, а не доверяет потенциально пустому сохранённому значению.

## Prediction Integrity

Админский Model Dashboard теперь отдельно проверяет качество prediction snapshots:

- вероятности 1X2 конечные, в диапазоне 0–100 и суммируются примерно до 100%;
- pre-match snapshot не создан в момент kickoff или позже;
- `captured_at` и `kickoff_at` присутствуют и корректно читаются;
- pending-прогнозы не зависли более чем на 36 часов после kickoff;
- settled-прогнозы содержат фактический outcome и счёт;
- fixture_id не повторяется в загруженной выборке;
- analysis_version присутствует;
- signal_probabilities присутствует там, где версия их поддерживает.

Ошибки metadata старых версий показываются как INFO и не смешиваются с тяжёлыми integrity-нарушениями.

## Version Cohorts

Model Dashboard показывает отдельные cohorts по `analysis_version`:

- sample;
- 1X2 accuracy;
- Brier;
- log loss;
- weighted calibration error;
- coverage signal snapshots;
- период cohort.

Это описательная аналитика. Приложение НЕ ранжирует версии, не выбирает победителя и ничего не продвигает автоматически.

## Calibration diagnostics

Добавлена метрика:

`Weighted top-probability calibration error`

Она считается как средневзвешенный абсолютный разрыв между средней top-вероятностью и фактическим hit rate по 5 probability buckets.

Меньше — лучше, но эта цифра не является автоматическим release threshold.

## Outcome cohorts

В UI теперь показываются уже существующие server-side разрезы:

- П1
- X
- П2

с sample / accuracy / Brier.

## Weekly chart fix

Исправлена старая подпись графика.

Вторая колонка графика всегда показывала размер выборки, поэтому подпись теперь честно говорит:

`accuracy + размер выборки; Brier указан текстом`

## Regression QA

RC8 smoke-test получил расширенный synthetic `Prediction Integrity self-test`.
Он не делает внешних запросов и проверяет, что движок умеет обнаружить:
- неверную сумму probabilities;
- отсутствующую probability;
- отсутствующий `captured_at`;
- snapshot после kickoff;
- stale pending.
- несогласованный фактический outcome;
- `predicted_outcome`, не совпадающий с максимальной вероятностью.

## Ограничение выборки

`/api/model-quality` загружает максимум:
- 500 settled;
- 500 pending

за выбранный период.

Если лимит достигнут, UI явно предупреждает, что integrity относится к загруженной выборке.

## SQL / Secrets / API

- SQL не нужен.
- Новые Secrets не нужны.
- Новых API-Football запросов нет.
- Telegram Stars остаются `paused`.
