# Football Analytics Mini App v6.2.0 — RC10 Settlement Watchdog & Automatic Catch-up

RC10 закрывает операционный разрыв после RC9: ручной recovery уже умел исправлять stale `pending`, но ежедневный settlement мог пропустить матч после краткого сбоя API-Football или позднего финального статуса. Теперь есть ежедневный watchdog и опциональный автоматический catch-up.

## Что нового в RC10

- ежедневный Settlement Watchdog запускается существующим cron около `04:00 UTC`;
- повторный запуск в тот же день блокируется persistent marker;
- watchdog сканирует prediction history без API-Football;
- по умолчанию работает в `SHADOW`: обнаруживает stale pending и пишет operational event, но ничего не меняет;
- автоматический recovery включается только отдельным Runtime Control;
- авто-режим использует тот же безопасный batch: максимум 20 fixture и 5 уникальных дат;
- для unattended recovery требуется подтверждённое состояние Runtime Controls и известная безопасная provider quota;
- до provider-вызовов создаётся audit intent со статусом `started`;
- cron recovery помечается `action_type=auto_recover`, `trigger_source=cron`;
- ручной RC9 dry-run/recovery полностью сохраняется.

## Почему этот этап нужен

Старый daily settlement проверяет в основном предыдущий день и ставит marker. Если в момент проверки provider был недоступен либо fixture ещё не имел финального статуса, prediction мог остаться `pending` надолго. RC9 дал безопасный ручной способ исправления. RC10 добавляет bounded catch-up, чтобы эта ситуация не требовала постоянного ручного контроля.

## Безопасность автоматического recovery

Автоматический режим не является безусловным cron-write. Для записи одновременно требуются:

- migration v6.2;
- Runtime Controls, успешно прочитанные из Supabase;
- `auto_settlement_recovery_enabled = true`;
- API-Football key;
- известный безопасный остаток quota;
- stale pending старше 36 часов;
- непустой batch до 20 fixture / 5 дат;
- audit intent, успешно записанный до provider-запросов.

Если любое условие не выполнено, watchdog остаётся read-only и пишет диагностический event.

## Audit trail

`supabase_migration_v6_2.sql` расширяет `prediction_integrity_actions`:

- новый `action_type = auto_recover`;
- новый `trigger_source = admin | cron`;
- новый промежуточный status `started`.

Если Worker прервётся после audit intent, в истории останется `started`, что делает незавершённую автоматическую попытку видимой. Telegram ID администратора по-прежнему не возвращается UI.

## Runtime Controls

Добавлен kill switch:

`Авто settlement catch-up`

Safe default — `OFF`. В этом режиме watchdog активен, но работает только как наблюдатель. Rollback к старым revision, где поле отсутствует, также трактуется как `OFF`.

## Integrity Remediation RC9 сохраняется

Администратор по-прежнему может:

- выполнить read-only dry-run;
- увидеть stale pending;
- подтвердить актуальный candidate token;
- вручную восстановить безопасный batch;
- увидеть completed / partial / failed / started actions в истории.

Recovery никогда не удаляет prediction snapshots и не переписывает probabilities, `captured_at`, `analysis_version` или signal snapshots. Меняются только settlement-поля существующей `pending` строки после подтверждённого финального счёта.

## Regression QA

RC10 сохраняет предыдущие self-test и добавляет `Settlement Watchdog self-test`. Он проверяет decision policy без внешних запросов:

- SHADOW при выключенном auto recovery;
- блокировку при quota guard;
- переход в recovery только при разрешённых guardrails;
- clean state при отсутствии stale pending.

## Cron

`wrangler.jsonc` менять не нужно. Уже существующий cron `*/5 * * * *` используется так:

- reminders и обычный settlement — как раньше;
- maintenance cleanup — около `03:00 UTC`;
- Settlement Watchdog — только в окне `04:00–04:14 UTC`, с daily marker.

## Health

`/health` для RC10 возвращает в том числе:

- `version = 6.2.0-rc10`;
- `releaseCandidate = RC10`;
- `settlementWatchdog = enabled`;
- `automaticSettlementRecovery = runtime-controlled`;
- `predictionRemediation = enabled`;
- `settlementRecovery = enabled`;
- `monetization = paused`.

## Ограничения

- один auto recovery batch в сутки;
- максимум 20 fixture;
- максимум 5 уникальных дат / provider calls;
- на FREE автоматический режим не работает при неизвестной quota;
- scan ограничен 5000 prediction rows и явно сообщает `truncated`;
- автоматические изменения весов/калибратора отсутствуют;
- Telegram Stars остаются на паузе.
