# QA Release Checklist — v6.7.2 RC15

## Deploy
- применён `supabase_migration_v6_7.sql`;
- Worker/client = `6.7.2-rc15`;
- cron, Secrets, wrangler не менялись;
- monetization paused.

## Two-Pass Finality
- новый settlement имеет unverified + count 0;
- first matching check после 6h → verified + count 1;
- first_verified_at фиксируется один раз;
- verified не проходит second pass раньше 24h;
- second matching check → confirmed + count 2;
- изменение score/outcome на втором check → drift;
- изменение terminal status FT/AET/PEN между passes → drift;
- confirmed больше не участвует в verification queue.

## Trusted Metrics Gate
- confirmed settled включается;
- adjudicated settled включается;
- verified first-pass исключается;
- unverified исключается;
- drift исключается;
- void исключается;
- calibration использует тот же gate;
- новый cache generation не принимает RC14 calibration cache.

## Regression
Обязательный PASS:
- Prediction Integrity self-test;
- Settlement Watchdog self-test;
- Settlement Run Ledger self-test;
- Settlement Finality self-test;
- Settlement Adjudication self-test;
- Trusted Metrics schema v6.7;
- Trusted Metrics Gate self-test;
- Production Load Safety;
- Admin Security.

## Инварианты
Автоматический finality verifier не переписывает provider drift. Prediction snapshots immutable. Telegram Stars остаются paused.


## RC15 hotfix 6.7.1
- при нормальном runtime `#runtimeBanner[hidden]` визуально отсутствует;
- maintenance/limited по-прежнему показывают runtime banner после снятия `hidden`;
- cache-bust CSS/JS = 6.7.1.


## RC15 UI cleanup 6.7.2
- startup показывает актуальный RC из manifest, а не RC10;
- декоративная метка QA-панели = RC15;
- Runtime banner скрыт при hidden;
- основные пользовательские и административные подписи русифицированы;
- устаревшие v5.0/HOLD placeholder-тексты удалены;
- provider/runtime/release/remediation панели используют понятные русские статусы;
- JS/HTML/CSS contract не потерял обязательные ID.
