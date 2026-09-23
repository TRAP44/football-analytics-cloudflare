# QA Release Checklist — v6.91.0 RC99

Этот файл содержит актуальный release gate. Исторические продуктовые RC-контракты остаются в regression-тестах и Git history.

## Перед merge/deploy

```bash
npm ci
npm run check
npm test
npm run verify:release
npm run verify:worker
```

Все команды должны завершиться без ошибок.

## Версия и release contract

- `package.json` и `package-lock.json`: `6.91.0`.
- Worker и client: `6.91.0-rc99`.
- Release candidate: `RC99`.
- Production workflow запускается только после успешного Quality.
- Post-deploy smoke проверяет ту же версию и RC.

## RC99 — Supabase Schema Consolidation

- Новый проект использует один `supabase/baseline.sql`.
- Baseline содержит historical baseline v6.9 и миграции v6.10 → v6.15 в release-порядке.
- Для существующей базы используются только `supabase/migrations/`.
- Исторический baseline v6.9 сохранён в `supabase/history/` для аудита.
- В корне репозитория не должно оставаться `supabase_baseline_*.sql` или `supabase_migration_*.sql`.
- Regression `test/supabase-baseline-rc99.test.js` проверяет состав, порядок и security-контракты baseline.
- RC99 не добавляет новую таблицу/поле поверх v6.15 и не требует миграции production-базы, если v6.15 уже применена.

## Supabase security

Проверить:
- RLS и backend-only объекты не открыты для `anon/authenticated`;
- `backend_security_contract` и `backend_default_acl_contract` доступны только backend/service role;
- service-role/secret key не попадает в клиент;
- `MONETIZATION_ENABLED=false`;
- `DEV_MODE=false`.

## Критический regression-контур

Обязательно зелёные:
- поиск/выбор матча и Quick AI → Mini App;
- freshness/recheck/kickoff handoff;
- post-match review/return;
- AI track record;
- media/deep-link и news impact RC69–RC98;
- русская локализация;
- access/security contracts;
- RC99 consolidated Supabase baseline.

## Production smoke

`scripts/post-deploy-smoke.js` должен подтвердить:
- `/health.ok = true`;
- `version = 6.91.0-rc99`;
- `releaseCandidate = RC99`;
- `devMode = false`;
- обязательные self-test/feature flags = `enabled`;
- `/health/supabase` не доступен публично;
- public status/manifest возвращают текущую версию.

## Ручная проверка

1. Найти клуб и открыть матч.
2. Получить Quick AI и открыть полный анализ.
3. Проверить freshness/recheck и kickoff handoff.
4. Проверить News Impact Decision Card / RC98 Focus Queue в админке.
5. Убедиться, что обычный пользователь не видит admin controls.
6. Убедиться, что интерфейс и админ-панель русскоязычные.
