# Установка v6.0.0 RC8

## GitHub

Заменить:

1. `src/worker.js`
2. `public/app.js`
3. `public/index.html`
4. `public/styles.css`
5. `package.json`
6. `README_CLOUDFLARE_RU.md`
7. `QA_RELEASE_CHECKLIST_RU.md`

Добавить `V6_0_INSTALL_RU.md`.

SQL не нужен. `wrangler.jsonc` и Cloudflare Secrets не менять.

## После Deploy

Открыть:

`https://football-analytics-cloudflare.wok-side.workers.dev/health`

Ожидаемые поля:

- `version`: `6.0.0-rc8`
- `releaseCandidate`: `RC8`
- `predictionIntegrity`: `enabled`
- `modelVersionCohorts`: `enabled`
- `calibrationDiagnostics`: `enabled`
- `monetization`: `paused`

## Telegram QA

Профиль → `Качество модели / Model Dashboard`.

Проверить:

1. `Snapshot timestamps` использует `captured_at` и показывает PASS на корректных строках.
2. `Pre-match snapshot timing` показывает FAIL для snapshot в момент kickoff или позже.
3. `Фактический результат`, `Predicted outcome` и `Correct flag` отображаются отдельными checks.
4. При наличии FAIL количество исключённых строк видно в статусе dashboard.
5. Accuracy / Brier / log loss считаются только по проверенным settled snapshots.

Затем:

Профиль → `Release Candidate RC8` → `Запустить QA`.

`Prediction Integrity self-test` должен быть PASS.

INFO по legacy version/signal metadata допустим. Любой FAIL по probabilities, timestamps или consistency требует проверки данных до релиза.
