# Football Analytics Mini App v6.1.0 — RC9 Integrity Remediation & Settlement Recovery

RC9 добавляет защищённое ручное восстановление зависших `pending`-прогнозов. Система всегда начинает с read-only dry-run, ограничивает provider-нагрузку, повторно проверяет список кандидатов перед записью и сохраняет audit trail.

## Integrity Remediation

Администратор получает отдельный блок в Model Dashboard:

- сканирование до 5000 prediction snapshots без API-Football запросов;
- полный integrity summary по загруженной истории;
- список stale pending старше 36 часов;
- безопасный batch до 20 fixture и не более 5 уникальных дат;
- оценку числа provider-запросов до выполнения;
- обязательную причину ручного recovery;
- историю completed / partial / failed действий.

Кнопка recovery активируется только после актуального dry-run. Worker формирует fingerprint выбранных fixture и возвращает `409 REMEDIATION_STALE`, если другая сессия или cron уже изменили список.

Recovery не удаляет predictions и не переписывает immutable probabilities. Он может только перевести существующую строку из `pending` в `settled`, если API-Football вернул подтверждённый финальный счёт.

## Audit trail

Migration `supabase_migration_v6_1.sql` добавляет таблицу `prediction_integrity_actions`.

Сохраняются причина, status, количество inspected / settled / skipped, fixture IDs и технический detail. Telegram ID администратора хранится только для внутреннего аудита и не возвращается интерфейсу.

## Основа RC8 сохраняется

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

RC9 smoke-test сохраняет расширенный `Prediction Integrity self-test` и добавляет `Prediction Remediation self-test`.
Он не делает внешних запросов и проверяет, что движок умеет обнаружить:
- неверную сумму probabilities;
- отсутствующую probability;
- отсутствующий `captured_at`;
- snapshot после kickoff;
- stale pending;
- несогласованный фактический outcome;
- `predicted_outcome`, не совпадающий с максимальной вероятностью.

Remediation self-test отдельно проверяет выбор stale pending, размер batch и ограничение по уникальным датам. Он не выполняет внешние запросы и не изменяет данные.

## Ограничение выборки

`/api/model-quality` загружает максимум:
- 500 settled;
- 500 pending

за выбранный период.

Если лимит достигнут, UI явно предупреждает, что integrity относится к загруженной выборке.

Remediation dry-run сканирует до 5000 строк. При достижении лимита UI помечает выборку как truncated и не утверждает, что проверена вся история.

## SQL / Secrets / API

- Обязательна migration `supabase_migration_v6_1.sql`.
- Новые Secrets не нужны.
- Dry-run не использует API-Football. Ручной recovery делает не более 5 запросов за запуск и блокируется защитой квоты.
- Telegram Stars остаются `paused`.
