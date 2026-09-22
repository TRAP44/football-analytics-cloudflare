# QA Release Checklist — v6.18.0 RC26

## Deploy

- применены `supabase_migration_v6_9.sql`, `supabase_migration_v6_10.sql`, `supabase_migration_v6_11.sql` и `supabase_migration_v6_11_1.sql`;
- Worker/client = `6.18.0-rc26`;
- package = `6.18.0`;
- cache generation = `4.0-atomic1`;
- Secrets проверены по `.env.example`;
- `DEV_MODE=false`;
- `MONETIZATION_ENABLED=false` до отдельного решения о запуске оплаты.
- production environment содержит `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID`;
- Cloudflare token ограничен нужным account и Workers Edit;
- `Deploy Production` запускается только после успешного `Quality` на `main`;
- deploy использует `--keep-vars` и не удаляет dashboard variables;
- отсутствие любого Cloudflare credential завершает deploy workflow ошибкой;
- `public/_headers` содержит Telegram-compatible CSP и обязательные browser security headers;

## Champion–Challenger

- в `model_calibration_state` существует строка `global`;
- задан ровно один `active_fingerprint`;
- fingerprint зависит только от production-параметров профиля;
- challenger не меняет прогноз до двух успешных holdout-окон;
- каждое окно содержит минимум 20 trusted матчей;
- на каждом окне Brier gain >= 0.001 и log loss не ухудшается;
- новый прогноз сохраняет `calibration_profile_fingerprint`;
- post-promotion guard ждёт минимум 20 trusted матчей;
- rollback возвращает `previous_fingerprint` и создаёт `ops_events` audit.
- transition RPC блокирует stale revision с SQLSTATE `40001`;
- promotion/rollback и смена статусов профилей атомарны;
- freeze блокирует автоматические переходы;
- manual rollback разрешён только на `previous_fingerprint`;
- каждый переход записан в `model_calibration_transitions`.

## Admin Access

- реальный Telegram-пользователь без allowlist не получает admin даже при `DEV_MODE=true`;
- синтетический dev-admin помечается сервером и имеет ID `999001`;
- PREMIUM и другие тарифы не дают admin-права;
- клиент показывает бейдж только когда сервер одновременно вернул `isAdmin=true` и `role=admin`;
- `/api/calibration-control` возвращает `403` обычному пользователю.

## Database

- все server-only таблицы имеют RLS;
- `anon` и `authenticated` не имеют прямого доступа;
- `service_role` имеет необходимые права Data API;
- `PUBLIC`, `anon` и `authenticated` не имеют прав на backend tables/sequences/RPC;
- default privileges сохраняют тот же запрет для будущих объектов;
- `backend_security_contract()` и `backend_default_acl_contract()` возвращают `ok=true` только через `service_role`;
- Release Readiness и RC Regression блокируются при нарушении security contract;
- foreign key и filtered-query колонки индексированы;
- fresh-install baseline v6.9 и migrations v6.10–v6.11.1 применяются к пустой базе без ручного добавления таблиц.

## Automated checks

Обязательный PASS:

```bash
npm run check
npm test
npm run verify:release
npm run verify:worker
```

Также обязательны встроенные проверки:

- Prediction Integrity;
- Trusted Metrics Gate;
- Two-Pass Settlement Finality;
- Settlement Adjudication;
- Calibration Promotion self-test;
- Calibration Lifecycle schema;
- Production Load Safety;
- Admin Security.
- Cloudflare post-deploy smoke.

## Post-deploy

- `/health` возвращает `6.18.0-rc26`, `RC26` и `devMode=false`;
- `cloudflareDeploymentGate=enabled`;
- `browserSecurityPolicy=enabled` и `failClosedDeployment=enabled`;
- `/api/app-manifest` соответствует версии Worker;
- `/`, CSS и JS доступны после обновления asset cache key;
- `/` содержит CSP с официальным Telegram SDK, `object-src 'none'` и `X-Content-Type-Options: nosniff`;
- `/api/me`, `/api/release-readiness` и `/api/calibration-control` без Telegram initData возвращают `401`;
- `/health/supabase` публично недоступен;
- при ошибке используется `Rollback Production` с предыдущим version ID.


## RC26 UI/роль
- обычный пользователь не видит и не может сфокусировать admin-only элементы;
- администратор после загрузки профиля видит технические панели;
- Telegram-фото профиля загружается через безопасный URL, при ошибке остаётся ⚽;
- на ширине 320–360 px длинные диагностические строки не выходят за карточки;
- основные подписи админ-панели не смешивают русские фразы с английскими статусами.


## RC26 User Flow / Mobile UX
- BackButton Telegram показан только на вложенных экранах и возвращает к реальному предыдущему экрану;
- кнопка «Назад» из анализа, открытого из истории/команды/турнира, не отправляет пользователя принудительно на список матчей;
- открытие записи истории не вызывает POST /api/analyze и не увеличивает дневной счётчик анализа;
- устаревший ответ поиска не может заменить результаты более нового запроса;
- на мобильном открытие вкладки «Поиск» не вызывает клавиатуру без действия пользователя;
- неактивные view/tab panels скрыты, inert и aria-hidden;
- touch-target основных мобильных кнопок не меньше 44 px.


## RC26 Interaction Safety
- два быстрых нажатия «Предматчевый анализ» не запускают параллельные POST /api/analyze;
- при быстром открытии двух разных матчей более старый ответ Match Center не заменяет новый;
- повторное нажатие звезды одной команды блокируется до завершения мутации;
- повторное включение/отключение одного напоминания блокируется до завершения мутации;
- временный сбой /api/me после уже успешной авторизации не скрывает подтверждённый профиль и admin UI;
- кнопка «Открыть турнирную таблицу» со страницы команды открывает таблицу текущего primaryCompetition;
- favorite/reminder controls сообщают состояние через disabled/aria-pressed.


## RC26 Async Entity / Personal Data
- быстрый переход Команда A → Команда B не позволяет ответу A перерисовать страницу B;
- тот же контракт проверяется для вкладок «Статистика» и «Состав»;
- быстрый переход Турнир A → Турнир B не позволяет таблице A появиться в B;
- кнопка перехода в турнир из строки матча команды вызывает openTournamentFromTeam(false), а не передаёт click event;
- до первого ответа избранное и напоминания показывают загрузку, а не ложное «пусто»;
- ошибка первого чтения показывает retry-карточку;
- ошибка повторного чтения сохраняет последние загруженные данные и показывает stale-предупреждение.
