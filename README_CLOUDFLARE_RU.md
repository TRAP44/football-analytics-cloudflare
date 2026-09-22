# Football Analytics Mini App v6.11.0 — RC19

Telegram Mini App для футбольной аналитики на Cloudflare Workers, Supabase и API-Football.

## RC19: Backend Security Contract

- все таблицы `public` остаются server-only: прямые права `anon` и `authenticated` отозваны;
- RLS включается для каждой обычной и partitioned-таблицы как второй защитный слой;
- sequences и RPC также закрыты от браузерных ролей;
- безопасные default privileges не позволяют будущим миграциям вернуть широкие права;
- `backend_security_contract()` проверяет RLS, grants, views и `SECURITY DEFINER` функции;
- `backend_default_acl_contract()` проверяет default privileges владельцев прикладных объектов;
- Release Readiness и RC Regression блокируют выпуск при нарушении контракта;
- Worker использует контракт только через секретный `service_role`/secret key.

## RC18: Atomic Calibration Operations

- promotion, rollback, freeze и unfreeze выполняются одной транзакцией Supabase;
- compare-and-swap по `revision` не даёт двум Worker-инстансам перезаписать решение друг друга;
- каждое изменение сохраняется в неизменяемом `model_calibration_transitions`;
- администратор может заморозить lifecycle или явно вернуть предыдущий champion;
- автоматические promotion/rollback отправляют уведомление администраторам;
- постоянный active-профиль калибровки хранится в Supabase;
- challenger проходит два последовательных непересекающихся trusted holdout-окна;
- продвижение сравнивает challenger с текущим champion, а не только с базовыми весами;
- каждый предматчевый snapshot сохраняет fingerprint применённого профиля;
- post-promotion когорта автоматически возвращает предыдущий champion при существенном ухудшении Brier или log loss;
- при отсутствии схемы lifecycle Worker fail-closed и оставляет production на baseline.

## Надёжность

- Telegram `initData` проверяется сервером;
- `DEV_MODE` даёт admin-права только отдельной синтетической dev-identity, но не реальным Telegram-пользователям;
- тариф FREE/PRO/PREMIUM не влияет на административную роль;
- технические маршруты закрыты admin gate;
- `model_calibration_validations` и новые lifecycle-таблицы защищены RLS и недоступны `anon`/`authenticated`;
- все существующие и будущие backend-таблицы, sequences и RPC недоступны `anon`/`authenticated`;
- прогнозы сохраняются до начала матча и не перезаписываются;
- метрики используют только `confirmed` и `adjudicated` settlement;
- итог матча подтверждается двумя provider-проверками;
- drift требует явного adjudication;
- runtime controls, settlement circuit breaker и cron audit остаются активны.

## Проверки

```bash
npm ci
npm run check
npm test
npm run verify:release
```

GitHub Actions выполняет эти проверки для каждого Pull Request и push в `main`.

## Установка

См. [INSTALL_RU.md](./INSTALL_RU.md).

Telegram Stars по умолчанию остаются выключены через `MONETIZATION_ENABLED=false`.
