# Football Analytics Mini App v6.4.0 — RC12 Interrupted Run Reconciliation & Bounded Retry

RC12 закрывает разрыв после RC11: audit intent со статусом `started` больше не может зависнуть навсегда после остановки Worker.

## Что нового

- persistent run-ledger поверх `prediction_integrity_actions`;
- `started` старше 30 минут считается stale и автоматически переводится в `interrupted`;
- пока существует активный `started`, новый unattended run не запускается;
- exact fixture batch после `interrupted` продолжает retry lineage;
- `attempt_no` ограничен значениями 1..3;
- попытка 4 не выполняется: lineage получает `retry_exhausted`;
- `retry_of_action_id` связывает повтор с предыдущим interrupted run;
- terminal actions получают `finished_at`, каждый update — `updated_at`;
- UI показывает состояние Run ledger и номер попытки.

## Safety

RC12 не меняет prediction probabilities, model weights, captured_at, analysis_version или signal snapshots.
Reconciliation касается только audit/run-state автоматического settlement recovery.

## Supabase

Перед deploy выполнить `supabase_migration_v6_4.sql`.

## Health

Ожидается:
- version = `6.4.0-rc12`;
- releaseCandidate = `RC12`;
- settlementWatchdog = enabled;
- settlementCircuitBreaker = enabled;
- settlementRunLedger = enabled;
- interruptedRunRecovery = enabled;
- monetization = paused.

Telegram Stars остаются paused.
