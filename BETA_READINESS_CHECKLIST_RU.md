# Closed Beta Readiness — FM AI

Статус: **STRICT BETA HOLD — CONFIG FIX REQUIRED**  
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

Используется существующий endpoint `/api/client-telemetry`. Для участников `closed_beta_v1` client telemetry сохраняется в backend-only `ops_events` без Telegram ID: уникальность пользователя считается по HMAC-псевдониму `betaSubject`, сформированному на сервере после подтверждённой beta-membership и не возвращаемому в API/UI. Beta-пользователи намеренно не записываются этим telemetry-путём в legacy `growth_events`, где требуется сырой `telegram_id`. Новая таблица или сторонний SDK не добавляются.

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
- [x] Квоту/тариф API-Football подтверждает production evidence: plan=FREE, dailyLimit=100, dailyRemaining=97, minuteLimit=10, minuteRemaining=9, cooldown=false, evidenceSource=controlled_release_probe (26 сентября 2026, 11:41:13 UTC).
- [ ] Реально назначить Beta-01 и Beta-02 и создать приватный feedback channel по шаблону из `PRE_BETA_VALIDATION_RU.md`. Runbook и формат обратной связи подготовлены, но личности/Telegram ID тестировщиков в репозиторий не записываются.
- [ ] Подтвердить Telegram `getWebhookInfo`: production URL совпадает с `/telegram/webhook`, нет устойчивой очереди pending updates и актуальной ошибки.
- [x] Server-side strict beta — fail-closed invariant: membership определяется только после успешной Telegram signature validation по `BETA_TELEGRAM_IDS`; admin имеет bypass, но исключён из beta cohort; frontend-скрытия не используются как access control. `BETA_ACCESS_ENABLED=false` или missing **не открывает** normal-user routes.
- [x] Production evidence 26 сентября 2026, 11:41 UTC: `strictEffective=true`, raw `BETA_ACCESS_ENABLED=missing`, `betaAllowlistCount=0`, `adminAllowlistCount=1`, `allowlistOverlapCount=0`.
- [ ] Исправить operational configuration: задать `BETA_ACCESS_ENABLED=true` и реальные Beta-01/Beta-02 в server-side `BETA_TELEGRAM_IDS`; после этого подтвердить `betaAllowlistCount=2`, overlap=0. До этого strict access остаётся безопасно закрытым для всех non-admin.

До выполнения этих пунктов автоматическая часть готовности завершена, но приглашение реальных пользователей остаётся **MANUAL FIELD CHECKS PENDING**.

## 5. Improvements after beta — observation-контур уже реализован

Уже реализованы и **не повторяются** на этапе Field Validation: агрегированный Beta Dashboard, feedback endpoint/UI, latency telemetry и cohort `closed_beta_v1` с проверенной server-side membership.

Не являются блокерами первого закрытого запуска:

- автоматические beta alerts по росту `action_error`;
- улучшение пустых экранов на основании реальных beta-паттернов;
- расширение/ротация server-side beta allowlist после подтверждённой необходимости; базовый механизм уже реализован.

## 6. Release gate

Перед merge/deploy должны пройти:

- [x] `npm ci`
- [x] `npm audit --audit-level=high`
- [x] `npm run security:scan`
- [x] `npm run lint`
- [x] `npm run check`
- [x] `npm test` — 798/798, fail 0 на deployed baseline #100
- [x] `npm run verify:release`
- [x] `npm run verify:worker`
- [x] post-merge Quality на `main` — повторно запущен и пройден
- [x] production deploy SHA/provenance guard — latest successful `Deploy Production` после каждого merge обязан подтвердить `DEPLOY_SHA == current main`; точный SHA фиксируется в соответствующем GitHub Actions run, поэтому checklist не привязан к устаревающему docs-only SHA.
- [x] active release identity verification — `6.120.0-rc144 / RC144`; RC120 подтверждает активную Cloudflare version на 100% traffic после каждого production deploy. Version ID создаётся заново на deploy и берётся из latest successful run.
- [x] production smoke — 25 проверок проходят на latest deployed `main`; подтверждаются `database=supabase`, `monetization=paused`, `DEV_MODE=false` и operational Telegram/Mini App/AI/search/LIVE.


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

### Strict Beta Post-Deploy snapshot — 26 сентября 2026, 11:41 UTC

- [x] GitHub `main` baseline: `d19fc80f1f5c3c42a4761e8c9e51096b32c310ae` (#100).
- [x] Quality #641: PASS.
- [x] Deploy Production #348: PASS; provenance guard подтвердил exact current-main SHA.
- [x] Cloudflare version `f629f925-fdc5-4f5b-b43f-3d0cb1da3962`, release `6.120.0-rc144 / RC144`, 100% traffic.
- [x] Post-deploy smoke: 25/25.
- [x] Deploy re-verification: 798 tests passed, 0 failed.
- [x] Provider evidence: FREE; daily 97/100 remaining; minute 9/10 remaining; cooldown=false.
- [x] Strict access effective=true даже при raw `BETA_ACCESS_ENABLED=missing`.
- [ ] Operational env reconciliation: выставить `BETA_ACCESS_ENABLED=true`.
- [ ] Beta allowlist reconciliation: сейчас `betaAllowlistCount=0`; требуются реальные Beta-01/Beta-02, overlap с admin должен остаться 0.
- [ ] Новый denied non-admin post-deploy smoke ещё не зафиксирован в `CLOSED_BETA_ACCESS_DENIED`.
- [ ] Telegram `getWebhookInfo`, два реальных beta journey smoke и LIVE protocol остаются field checks.

### Closed Beta Access & Field Validation — privacy hardening

- [x] PR #92 Quality на privacy-hardening SHA прошёл полностью: 767/767 tests, fail 0; audit/security/lint/check/release/worker — PASS.
- [x] Beta Dashboard client metrics больше не зависят от `growth_events.telegram_id`; источник beta client metrics — verified `ops_events` с HMAC-псевдонимом.
- [x] Admin и non-beta пользователи не получают `betaMembershipVerified=true` и не входят в client metrics `closed_beta_v1`.
- [x] Исторические client rows без privacy-boundary `betaSubject` не входят в уникальные beta-user/journey метрики.
- [ ] Два non-admin Telegram smoke — требуется реальное выполнение.
- [ ] Реальный LIVE validation — требуется идущий матч.
- [x] Свежие API-Football quota headers подтверждены controlled production probe: FREE, daily 97/100, minute 9/10, cooldown=false.
- [ ] Telegram `getWebhookInfo` — требуется доверенная среда с bot token.
- [ ] Beta-01/Beta-02 и feedback channel — требуется фактическое назначение владельцем.
