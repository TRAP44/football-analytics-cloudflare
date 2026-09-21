# Football Analytics Mini App v6.6.0 — RC14 Settlement Drift Review & Explicit Adjudication

RC14 завершает manual review-контур после RC13 Settlement Finality Verification.

## Что нового

- unresolved drift появляется в отдельной admin queue;
- для каждого drift-event доступны только три явных решения:
  - `keep_stored` — оставить исходный settlement;
  - `accept_provider` — явно принять новый provider score/outcome и пересчитать backtest outcome-метрики;
  - `void_prediction` — исключить prediction из backtest-метрик;
- каждое действие требует причины;
- stale snapshot/token guard запрещает решение по устаревшему drift;
- один source drift-event получает только одно зафиксированное решение;
- сохраняется immutable before/provider/after audit;
- admin Telegram ID может храниться backend-аудитом, но не выводится в UI;
- `accept_provider` разрешён только для безопасного финального FT/AET/PEN с валидным счётом;
- CANC/ABD/AWD/WO нельзя автоматически принять как новый score через adjudication;
- resolved settlement получает state `adjudicated`.

## Safety

Автомат RC13 по-прежнему никогда не исправляет score. Любое изменение settlement возможно только явным admin action RC14 с подтверждением, reason и audit trail.

## Supabase

Перед Deploy выполнить `supabase_migration_v6_6.sql`.

## Health

Ожидается:
- version = `6.6.0-rc14`;
- releaseCandidate = `RC14`;
- settlementFinalityVerification = enabled;
- settlementDriftGuard = enabled;
- settlementDriftReview = enabled;
- settlementAdjudication = enabled;
- monetization = paused.

Telegram Stars остаются paused.
