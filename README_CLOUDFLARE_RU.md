# Football Analytics Mini App v6.15.0 — RC23

Telegram Mini App для футбольной аналитики на Cloudflare Workers, Supabase и API-Football.

## RC23: Interface Consistency & Profile Polish

- обычный пользователь получает Telegram-фото в профиле с безопасным URL и fallback на ⚽ при ошибке загрузки;
- admin-only блоки теперь не только скрываются, но и становятся `inert`, а `aria-hidden` дублирует fail-closed контракт;
- исправлены смешанные русско-английские подписи в калибровке, RC-проверках, Runtime Controls, Reminder Health, Release Monitor и диагностике;
- длинные технические строки корректно переносятся на узких экранах;
- добавлены регрессионные тесты роли, профиля и локализации интерфейса;
- Worker/client/production smoke переведены на v6.15.0 RC23.

## RC22: UI Access Integrity

- бейдж «Администратор» теперь подчиняется тому же fail-closed контракту `data-admin-only`, что и вся админ-панель;
- `hidden` принудительно сохраняет `display:none`, поэтому Telegram WebView не покажет скрытый служебный элемент из-за компонентного CSS;
- клиент синхронизирует `hidden` и `aria-hidden` и очищает подпись роли для обычного пользователя;
- регрессионный тест блокирует релиз, если admin-only элементы перестанут быть скрыты по умолчанию;
- версия клиента, Worker и production smoke переведены на v6.14.0 RC22.

## RC21: Release Security Hardening

- отсутствие Cloudflare credentials теперь блокирует production workflow с ошибкой вместо ложного зелёного результата;
- HTML, CSS и JS получают CSP, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy` и same-origin resource policy;
- CSP разрешает официальный Telegram Mini App SDK и встраивание из Telegram Web, но запрещает плагины, внешний API-доступ из браузера и небезопасные inline-скрипты;
- API JSON-ответы получают единый набор защитных заголовков без permissive CORS;
- versioned CSS/JS кешируются как immutable, а смена версии продолжает принудительно обновлять клиент;
- post-deploy smoke проверяет браузерную политику безопасности вместе с версией, production mode и admin isolation.

## RC20: Cloudflare Deployment Gate

- production deploy запускается только после успешного workflow `Quality` на `main`;
- deploy всегда использует точный проверенный commit SHA, Node.js 22 и закреплённые версии GitHub Actions/Wrangler;
- `wrangler deploy --keep-vars` сохраняет переменные, установленные через Cloudflare Dashboard;
- post-deploy smoke ждёт распространения версии и проверяет `/health`, app manifest, HTML shell и admin isolation;
- `DEV_MODE=true`, неверная версия или публичный технический маршрут блокируют workflow;
- при отсутствии Cloudflare credentials deploy безопасно пропускается с записью в Job Summary;
- ручной rollback требует конкретный Cloudflare version ID и явное подтверждение `ROLLBACK`.

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
После успешного `Quality` workflow `Deploy Production` публикует Worker. Если `CLOUDFLARE_API_TOKEN` или `CLOUDFLARE_ACCOUNT_ID` отсутствует, workflow завершается ошибкой и не маскирует отсутствие релиза.

## Установка

См. [INSTALL_RU.md](./INSTALL_RU.md).

Telegram Stars по умолчанию остаются выключены через `MONETIZATION_ENABLED=false`.
