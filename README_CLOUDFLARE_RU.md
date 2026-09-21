# Football Analytics Mini App v6.5.0 — RC13 Settlement Finality Verification & Drift Guard

RC13 закрывает следующий риск после безопасного auto-recovery: уже settled результат может позже измениться у provider.

## Что нового

- settled rows получают состояние `unverified | verified | drift`;
- повторная finality-проверка запускается около `05:00 UTC`;
- проверяются только settlement старше 6 часов;
- окно проверки — последние 7 дней;
- максимум 100 fixture и 3 даты/provider calls за run;
- совпавший финальный счёт → `verified`;
- изменившийся счёт/outcome либо terminal provider status `AWD/WO/CANC/ABD` → `drift`;
- drift никогда не переписывает сохранённый settlement автоматически;
- drift записывается в отдельный `settlement_verification_events`;
- строки drift исключаются из model-quality и calibration;
- Integrity Remediation показывает verified / pending / drift.

## Safety

Первый prediction snapshot остаётся immutable. RC13 также не делает silent correction уже записанного результата: поздняя provider-коррекция требует отдельного review-этапа.

## Supabase

Перед Deploy выполнить `supabase_migration_v6_5.sql`.

## Health

Ожидается:
- version = `6.5.0-rc13`;
- releaseCandidate = `RC13`;
- settlementFinalityVerification = enabled;
- settlementDriftGuard = enabled;
- settlementRunLedger = enabled;
- settlementCircuitBreaker = enabled;
- monetization = paused.

Telegram Stars остаются paused.
