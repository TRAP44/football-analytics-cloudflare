# Closed Beta Readiness — FM AI

Статус кода: **PRE-BETA VALIDATED / MANUAL FIELD CHECKS PENDING**  
Базовая версия клиента: **6.120.0-rc144**  
Цель этапа: подготовить существующий продукт к небольшой группе реальных пользователей без добавления новых аналитических функций.

## 1. Критический пользовательский путь

- [x] Telegram Mini App запускается через существующий проверенный handoff-контракт.
- [x] Boot screen имеет recovery-путь и не оставляет пользователя на бесконечной загрузке.
- [x] Поиск показывает локальные результаты сразу и ограничивает ожидание удалённого источника.
- [x] Поиск имеет отдельные состояния: loading / success / empty / timeout / error / retry.
- [x] Список матчей использует snapshot-first загрузку и сохраняет доступные данные при ошибке обновления.
- [x] Пустой список матчей объясняет причину и ведёт пользователя обратно в поиск.
- [x] Открытие матча показывает отдельное loading-состояние.
- [x] Ошибка открытия матча остаётся на понятном recovery-экране с кнопкой «Повторить».
- [x] AI-анализ показывает отдельное loading-состояние при переходе из поиска/матчей.
- [x] Ошибка AI не оставляет пустой экран: показывается recovery-состояние и retry.
- [x] LIVE сохраняет последний успешно загруженный снимок при фоновой ошибке.
- [x] Ошибка фонового LIVE refresh не спамит toast; интерфейс сообщает, что повторит обновление автоматически.
- [x] История имеет loading / empty / error / stale-data состояния и recovery.
- [x] Профиль имеет отдельный loading/error/retry путь, если /api/me временно недоступен.
- [x] Нижняя навигация и Telegram BackButton сохраняют возврат по пользовательскому пути.

## 2. Безопасная продуктовая аналитика beta

Используется существующий endpoint `/api/client-telemetry` и существующая таблица `growth_events`. Новая таблица или сторонний SDK не добавляются.

Фиксируются только allowlisted события:

- `matches_open`
- `search_used`
- `search_found`
- `search_empty`
- `match_open`
- `live_open`
- `ai_start`
- `ai_complete`
- `history_open`
- `history_item_open`
- `profile_open`
- `action_error` с allowlisted action/error category

Privacy contract:

- [x] Не отправляется поисковый запрос пользователя.
- [x] Не отправляются названия команд/турниров.
- [x] Не отправляется текст ошибок как свободный текст.
- [x] Не отправляется содержимое профиля/избранного/истории.
- [x] Сервер повторно валидирует event/action/error/view по allowlist.
- [x] Неизвестные product actions отклоняются.
- [x] События не блокируют пользовательский сценарий при недоступности telemetry endpoint.
- [x] Сохраняется существующая политика retention для growth events.
- [x] Сторонние рекламные/аналитические SDK не добавлены.

## 3. Beta monitoring

Во время закрытой beta ежедневно проверять:

- процент успешных Mini App запусков;
- boot recovery / compatibility block;
- `miniapp_search_used` → `miniapp_search_found`;
- `miniapp_match_open`;
- `miniapp_ai_start` → `miniapp_ai_complete`;
- `miniapp_live_open`;
- `miniapp_history_open`;
- `miniapp_profile_open`;
- `miniapp_error` по action + errorKind;
- provider quota / timeout / rate-limit состояние;
- release monitor и production monitor.

Рекомендуемый критерий остановки beta rollout: повторяемая ошибка критического шага у нескольких пользователей, compatibility block, массовый provider/rate-limit сбой или невозможность завершить AI-путь.

## 4. Blocking before beta

Эти пункты требуют реальной среды/операционного решения и не могут быть честно закрыты только CI:

- [ ] Провести smoke на реальном Telegram минимум с двумя **не-админскими** аккаунтами по сценарию из `PRE_BETA_VALIDATION_RU.md`: Telegram → Mini App → Матчи → поиск → матч → AI → история → профиль → тема/акцент → избранное → напоминание.
- [ ] Проверить LIVE на реальном идущем матче: первичная загрузка, счёт, события, статистика, составы/потери, ручное обновление, минимум один успешный auto-refresh, временная потеря сети и восстановление с сохранением последнего snapshot.
- [ ] Подтвердить текущую **квоту/тариф** API-Football и фактические plan / dailyRemaining / minuteRemaining непосредственно перед приглашением. В production уже наблюдалось достижение минутного rate limit, поэтому до проверки первая cohort ограничена двумя пользователями.
- [ ] Реально назначить Beta-01 и Beta-02 и создать приватный feedback channel по шаблону из `PRE_BETA_VALIDATION_RU.md`. Runbook и формат обратной связи подготовлены, но личности/Telegram ID тестировщиков в репозиторий не записываются.
- [ ] Подтвердить Telegram `getWebhookInfo`: production URL совпадает с `/telegram/webhook`, нет устойчивой очереди pending updates и актуальной ошибки.
- [ ] Принять решение по строгости доступа: invite-only operational beta либо server-side Telegram ID allowlist. Оценка выполнена: если «закрытая beta» означает технический запрет доступа всем, кроме приглашённых Telegram ID, server-side allowlist обязателен после проверки Telegram-подписи и должен применяться ко всем обычным user API routes; frontend-скрытия недостаточно. Без реальных Beta-01/Beta-02 ID и явного решения владельца allowlist намеренно не включён, чтобы не заблокировать production.

До выполнения этих пунктов автоматическая часть готовности завершена, но приглашение реальных пользователей остаётся **MANUAL FIELD CHECKS PENDING**.

## 5. Improvements after beta

Не являются блокерами первого закрытого запуска:

- агрегированный admin-виджет конверсии по beta-пути;
- latency percentiles по search / match / AI / LIVE;
- сегментация по cohort/build без персональных данных;
- встроенная кнопка «Сообщить о проблеме»;
- автоматические beta alerts по росту action_error;
- улучшение пустых экранов на основании реальных beta-паттернов;
- отдельный серверный invite allowlist, если beta должна оставаться технически закрытой после расширения аудитории.

## 6. Release gate

Перед merge/deploy должны пройти:

- [x] `npm ci`
- [x] `npm audit --audit-level=high`
- [x] `npm run security:scan`
- [x] `npm run lint`
- [x] `npm run check`
- [x] `npm test` — 756/756, fail 0
- [x] `npm run verify:release`
- [x] `npm run verify:worker`
- [x] post-merge Quality на `main` — повторно запущен и пройден
- [x] production deploy SHA/provenance guard — повторно подтверждён на актуальном `main` SHA `5519b98049ae6a74212897cf261ef2d8bc550a5c`
- [x] active release identity verification — `6.120.0-rc144 / RC144`, 100% traffic на Cloudflare version `8c922e24-4e4d-431a-9515-47d649606f15`
- [x] production smoke — 25 проверок пройдены на актуальном SHA `5519b98049ae6a74212897cf261ef2d8bc550a5c`; подтверждены `database=supabase`, `monetization=paused`, `DEV_MODE=false` и operational Telegram/Mini App/AI/search/LIVE


## 7. Pre-Beta Operational Validation

Подтверждено напрямую 25 сентября 2026:

- [x] UX Hotfix (#82) и Beta Readiness (#83) присутствуют в текущем `main`.
- [x] Worker и client используют одну версию `6.120.0-rc144`; RC identity — `RC144`.
- [x] Supabase project находится в `ACTIVE_HEALTHY`.
- [x] Supabase schema v6.19 / RC129 подтверждена по обязательным provenance-колонкам.
- [x] Schema fingerprint `c2c22ec25aacfcf1b9938b0850cebf49` совпадает с Worker contract.
- [x] Backend security contract и default ACL contract — `ok=true`, violations отсутствуют.
- [x] Runtime controls: analysis/search/live/reminders включены, maintenance выключен.
- [x] `DEV_MODE=false` уже является blocking production smoke condition.
- [x] Production configuration/secrets probe пройден без раскрытия значений: readiness подтверждает Supabase и Telegram bot/webhook configuration; production public-status подтверждает operational search/LIVE (API-Football key присутствует); deploy credential guard подтвердил Cloudflare credentials; production smoke подтверждает `MONETIZATION_ENABLED=false`.
- [x] Rollback workflow и его target/provenance/release/postcondition/smoke regression-контракты прошли release gate.
- [x] Последние 15 минут operational-проверки не содержали новых Supabase auth failures или error/critical non-monitor events.
- [x] Production monitor gate закрыт по допустимому условию «причина `watch` подтверждена как transient». Persisted запись 15:00 UTC имеет `releaseState=healthy`, `releaseScore=100`, `supabaseOk=true`, `schemaOk=true`, `providerHealth=waiting`, `telegramDedupeState=watch`, при этом stale/failed claims = 0. Прямой `telegram_webhook_dedupe_health` на повторной проверке доступен и возвращает healthy-входы (ledger/stale/failed = 0); при текущей monitor-логике это подтверждает временную недоступность dedupe-observability, а не устойчивый пользовательский/данный инцидент. Отдельный `getWebhookInfo` остаётся ручным blocker.
- [x] Усиленный production smoke после merge/deploy прошёл и подтвердил фактические `database=supabase`, `monetization=paused` и operational Telegram/Mini App/AI/search/LIVE.

Полный ручной сценарий, LIVE protocol, quota gate, cohort и feedback runbook: `PRE_BETA_VALIDATION_RU.md`.

### Повторная валидация актуального main — 25 сентября 2026, 15:18 UTC

- [x] Текущий `main`: `5519b98049ae6a74212897cf261ef2d8bc550a5c`.
- [x] Quality на этом SHA: 756/756 tests, audit/security/lint/check/release/worker — PASS.
- [x] Cloudflare production version: `8c922e24-4e4d-431a-9515-47d649606f15`; release identity и 100% traffic postcondition — PASS.
- [x] Post-deploy smoke на production: 25/25.
- [x] Supabase project `ACTIVE_HEALTHY`; schema fingerprint `c2c22ec25aacfcf1b9938b0850cebf49`.
- [x] `backend_security_contract()` и `backend_default_acl_contract()`: `ok=true`, violations отсутствуют.
- [x] Runtime controls: analysis/search/live/reminders=true, maintenance=false.
- [x] Telegram persistent dedupe health RPC: stale=0, failedCurrent=0, failedRecent=0.
- [ ] Фактические provider plan / dailyRemaining / minuteRemaining не подтверждены свежими provider headers; `provider_rate_windows` не заменяет provider quota headers.
- [ ] Telegram `getWebhookInfo` не подтверждён напрямую, так как bot token намеренно недоступен через CI/репозиторий.
- [ ] Два реальных non-admin smoke и реальный LIVE protocol требуют живых Telegram-аккаунтов/идущего матча.
- [ ] Beta-01/Beta-02 и приватный feedback channel должны быть реально назначены владельцем вне репозитория.

