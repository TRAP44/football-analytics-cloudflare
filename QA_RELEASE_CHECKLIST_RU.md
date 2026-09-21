# QA Release Checklist — v6.1.0 RC9

## Deploy
- заменены 5 файлов;
- выполнена `supabase_migration_v6_1.sql`;
- Secrets не менялись;
- Telegram Stars остаются paused.

## Health
Проверить:
- version = `6.1.0-rc9`
- releaseCandidate = `RC9`
- predictionIntegrity = `enabled`
- modelVersionCohorts = `enabled`
- calibrationDiagnostics = `enabled`
- predictionRemediation = `enabled`
- settlementRecovery = `enabled`
- devMode = `false`

## Model Dashboard
- Prediction Integrity отображается;
- probabilities check PASS;
- snapshot timestamps PASS;
- snapshot timing PASS;
- settled outcome PASS;
- predicted outcome PASS;
- correct flag PASS;
- duplicate fixture PASS;
- stale pending = 0 или объяснимый WARN;
- legacy version/signal metadata может быть INFO;
- Version cohorts отображаются без ranking/winner;
- Outcome cohorts П1/X/П2 отображаются;
- Cal error подписан как диагностическая метрика;
- weekly chart подпись соответствует реальным bars.

## Integrity Remediation
- migration status готов;
- read-only dry-run загружается без API-Football запросов;
- scan показывает размер и truncated status;
- stale pending candidates ограничены 20 fixture / 5 дат;
- кнопка recovery требует причину;
- изменение списка кандидатов приводит к `REMEDIATION_STALE`, а не к записи;
- recovery меняет только `pending` с подтверждённым финальным счётом;
- completed / partial / failed action появляется в audit history;
- Telegram ID администратора не отображается в UI;
- удаление prediction snapshots отсутствует.

## RC9
Обязательный PASS:
- Prediction Integrity self-test;
- Prediction Remediation self-test;
- Prediction remediation audit table;
- предыдущие Runtime Controls / rollback checks;
- Supabase schema;
- Production Load Safety;
- Admin Security.

## Важно
RC9 исправляет только settlement-поля stale pending после повторной проверки API-Football. Immutable probabilities, captured_at и model version не перезаписываются. Веса/калибратор не меняются.
