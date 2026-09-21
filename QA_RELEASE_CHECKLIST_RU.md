# QA Release Checklist — v6.8.0 RC16

## Deploy
- применён `supabase_migration_v6_8.sql`;
- Worker/client = `6.8.0-rc16`;
- package = `6.8.0`;
- cron, Secrets и wrangler не менялись;
- monetization paused.

## Calibration Promotion Gate
- cache generation = `3.8-promotion1`;
- при <60 trusted rows adaptive weights не активируются;
- train и holdout разделены по kickoff_at;
- weight candidate строится только на train;
- holdout содержит минимум 12 матчей;
- promotion требует Brier gain >= 0.001;
- promotion запрещён при ухудшении log loss;
- synthetic stable candidate проходит self-test;
- synthetic overfit candidate блокируется;
- baseline weights остаются production при held/shadow;
- temperature и weights имеют отдельные validation результаты.

## Audit
- `model_calibration_validations` доступна;
- candidate_fingerprint уникален;
- decision ∈ baseline/shadow/held/promoted;
- сохраняются sample/train/validation и metric deltas.

## Regression
Обязательный PASS:
- Prediction Integrity;
- Trusted Metrics Gate;
- Two-Pass Settlement Finality;
- Settlement Adjudication;
- Calibration Promotion schema v6.8;
- Calibration Promotion self-test;
- Production Load Safety;
- Admin Security.
