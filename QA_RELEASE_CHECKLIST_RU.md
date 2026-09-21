# QA Release Checklist — v6.0.0 RC8

## Deploy
- заменены 5 файлов;
- SQL не запускался;
- Secrets не менялись;
- Telegram Stars остаются paused.

## Health
Проверить:
- version = `6.0.0-rc8`
- releaseCandidate = `RC8`
- predictionIntegrity = `enabled`
- modelVersionCohorts = `enabled`
- calibrationDiagnostics = `enabled`
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

## RC8
Обязательный PASS:
- Prediction Integrity self-test;
- предыдущие Runtime Controls / rollback checks;
- Supabase schema;
- Production Load Safety;
- Admin Security.

## Важно
RC8 исключает строки с integrity FAIL из метрик, но не удаляет и не исправляет их автоматически. Веса/калибратор не меняются, «лучшая» model version не выбирается.
