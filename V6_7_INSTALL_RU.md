# Установка v6.7.1 RC15

## 1 — Supabase

Выполнить `supabase_migration_v6_7.sql`.

Migration:
- добавляет verification pass counter;
- сохраняет timestamp первого provider match;
- добавляет state `confirmed`;
- создаёт индекс для unverified/verified second-pass queue.

## 2 — Deploy

Обновить:
- `src/worker.js`
- `public/app.js`
- `public/index.html`
- `package.json`
- `README_CLOUDFLARE_RU.md`
- `QA_RELEASE_CHECKLIST_RU.md`

Добавить:
- `supabase_migration_v6_7.sql`
- `V6_7_INSTALL_RU.md`

`wrangler.jsonc`, cron и Secrets не меняются.

## 3 — Finality policy

- first pass: settlement возрастом минимум 6 часов;
- second pass: минимум 24 часа после first pass;
- confirmed требует повторного совпадения score + outcome + final provider status;
- позднее расхождение становится drift;
- model-quality/calibration: только confirmed + adjudicated.

## 4 — QA

Profile → Качество модели → Integrity Remediation:
- Settlement finality показывает VERIFYING, пока есть unverified/verified;
- Trusted metrics показывает только confirmed/adjudicated sample;
- Release Candidate RC15 должен пройти Trusted Metrics schema/self-test.
