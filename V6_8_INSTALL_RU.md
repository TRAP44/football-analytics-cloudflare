# Установка v6.8.0 RC16

## 1 — Supabase

Выполнить `supabase_migration_v6_8.sql`.

Migration создаёт `model_calibration_validations` — журнал решений promotion gate для калибровки.

## 2 — Deploy

Обновить Worker/client/static files из текущего `main`.

Новые версии:
- Worker: `6.8.0-rc16`
- Client: `6.8.0-rc16`
- package: `6.8.0`

Cron, Secrets и `wrangler.jsonc` не меняются.

## 3 — Promotion Gate

RC16 разделяет данные хронологически:
- старые trusted settlement → обучение кандидата;
- новые trusted settlement → holdout;
- адаптивные веса активируются только при улучшении Brier минимум на 0.001 и отсутствии ухудшения log loss;
- минимум 60 trusted матчей для проверки весов;
- минимум 12 holdout матчей для решения по весам.

До выполнения gate базовые веса остаются production-поведением.

## 4 — QA

Profile → Качество модели:
- «Калибратор v3.8»;
- Holdout температуры;
- Holdout весов;
- статус продвижения БАЗА / ТЕНЬ / УДЕРЖАНО / РАЗРЕШЕНО;
- RC16 self-test должен блокировать synthetic overfit.
