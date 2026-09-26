# Pre-Beta Operational Validation — FM AI 6.120.0-rc144

Цель: провести закрытую beta на существующем продукте без добавления новых футбольных функций.

## 1. Зафиксированная release identity

- Post-change production snapshot 26 сентября 2026, 12:25 UTC: GitHub `main` / deploy SHA `5e8be483a8722574877047bb8a96952ebdebc649` (PR #101 merged).
- Версия клиента/Worker: `6.120.0-rc144`.
- Release candidate: `RC144`.
- Cloudflare production version: `6797b5c9-4a3b-40db-8a1b-b967b979fbf9`; RC120 подтвердил 100% traffic на этом version ID.
- Production URL: `https://football-analytics-cloudflare.wok-side.workers.dev`.
- GitHub Actions: Quality #645 — PASS; Deploy Production #349 — PASS; post-deploy smoke — 25/25.

## 2. Что уже подтверждено автоматически

- `main` содержит UX Hotfix (#82) и Beta Readiness (#83).
- Полный Quality текущего release-контура повторно пройден: 767/767 тестов, fail 0. Privacy-hardening PR #92 отдельно прошёл тот же audit/security/lint/check/test/release/worker gate.
- Supabase project: ACTIVE_HEALTHY.
- Текущий schema fingerprint: `c2c22ec25aacfcf1b9938b0850cebf49`, совпадает с Worker contract.
- v6.19 / RC129 provenance-колонки присутствуют.
- `backend_security_contract()` и `backend_default_acl_contract()` возвращают `ok=true`, нарушений нет.
- Runtime controls: analysis/search/live/reminders enabled, maintenance disabled.
- Все public tables имеют RLS. Advisor выдаёт только INFO по backend-only таблицам без client policies; broad anon/auth policies намеренно не добавляются.
- `DEV_MODE=false` проверяется post-deploy smoke.
- После этого этапа post-deploy smoke дополнительно обязан подтвердить:
  - persistence = Supabase;
  - monetization = paused;
  - Telegram = operational;
  - Mini App = operational;
  - AI analysis = operational;
  - search = operational;
  - LIVE = operational.
- Rollback workflow имеет exact target confirmation, current-main provenance guard, release-identity guard, 100% traffic postcondition и rollback smoke.

## 3. Реальный smoke двух обычных пользователей

Использовать **два реальных Telegram-аккаунта, которые отсутствуют в ADMIN_TELEGRAM_IDS**.

Для каждого аккаунта выполнить отдельно и записать результат.

| Шаг | Beta-01 | Beta-02 | Критерий PASS |
| --- | --- | --- | --- |
| Открыть бота / Mini App | [ ] | [ ] | Boot завершается, нет compatibility block |
| Открыть «Матчи» | [ ] | [ ] | Список/snapshot/empty state без вечной загрузки |
| Перейти в поиск | [ ] | [ ] | Поле поиска и быстрые разделы доступны |
| Найти команду/матч | [ ] | [ ] | Есть success/empty/error state и retry |
| Открыть найденный матч | [ ] | [ ] | Loading завершается Match Center или recovery |
| Запустить AI-анализ | [ ] | [ ] | Loading → анализ либо понятный retry |
| Открыть историю | [ ] | [ ] | Анализ доступен повторно или корректный fallback |
| Открыть профиль | [ ] | [ ] | Профиль без admin tools |
| Изменить тему | [ ] | [ ] | Применяется сразу и сохраняется после reopen |
| Изменить акцент | [ ] | [ ] | Применяется отдельно от темы и сохраняется |
| Добавить в избранное | [ ] | [ ] | Состояние сохраняется после refresh/reopen |
| Создать напоминание | [ ] | [ ] | Состояние сохраняется и отображается корректно |
| Проверить отсутствие admin UI | [ ] | [ ] | Нет admin console/provider/runtime/release controls |

Если хотя бы один пользователь не может завершить путь до AI/истории/профиля, beta не запускается.

## 4. LIVE validation

Проводить только на реально идущем матче.

| Проверка | Статус | PASS |
| --- | --- | --- |
| Первичное открытие LIVE | [ ] | Матч открывается без infinite loading |
| Счёт | [ ] | Отображается текущий счёт |
| События | [ ] | Хронология доступна либо явно сообщает об отсутствии данных |
| Статистика | [ ] | Доступна либо корректный unavailable state |
| Составы / потери | [ ] | Доступны по наличию, отсутствие не выглядит ошибкой |
| Ручное обновление | [ ] | Обновляет Match Center или сохраняет snapshot при ошибке |
| Один авто-refresh | [ ] | Выполняется после заданного интервала |
| Временная потеря сети | [ ] | Последний рабочий snapshot остаётся на экране |
| Восстановление сети | [ ] | Следующее обновление восстанавливает актуальные данные |
| Нет бесконечного loading | [ ] | После сбоя остаётся usable recovery state |

## 5. Provider quota gate

Production evidence от 26 сентября 2026, 11:41:13 UTC получен контролируемым `/status` probe после deploy #348:

- [x] plan = `FREE`;
- [x] dailyLimit = `100`;
- [x] dailyRemaining = `97`;
- [x] minuteLimit = `10`;
- [x] minuteRemaining = `9`;
- [x] cooldownActive = `false`;
- [x] evidenceSource = `controlled_release_probe`.

Shared quota/cooldown хранится через существующий Supabase cache. Для FREE/UNKNOWN распределённый минутный budget дополнительно оставляет boundary safety margin. Параллельный startup `/api/matches` дедуплицирован; regression contract допускает не более одного API-Football call на один normal startup match-list request.

Текущая provider capacity не является blocker для первой cohort из двух пользователей. Расширять cohort сверх Beta-01/Beta-02 без новой фактической quota-проверки нельзя. Платный тариф не подключается без отдельного решения владельца проекта.

## 6. Telegram webhook

Автоматически подтверждается:
- bot token + webhook secret присутствуют (readiness);
- endpoint `/telegram/webhook` существует и без секрета fail-closed возвращает 403;
- persistent dedupe schema/RPC доступны.

Перед beta дополнительно вручную:
- [ ] вызвать Telegram `getWebhookInfo` из доверенной admin/server среды;
- [ ] `url` должен точно совпадать с production `/telegram/webhook`;
- [ ] `pending_update_count` не растёт постоянно;
- [ ] `last_error_message` пуст или относится к уже устранённому событию.

Не публиковать bot token или webhook secret в отчётах.

## 7. Beta cohort и feedback

Начальная cohort:
- **Beta-01** — non-admin Telegram account, ID фиксируется владельцем вне репозитория.
- **Beta-02** — второй независимый non-admin Telegram account.
- **Beta-03** — резерв; не приглашать до quota validation.

Feedback channel: отдельная приватная Telegram-группа/тема **FM AI Beta Feedback** с владельцем проекта и тестировщиками.

Каждый баг отправлять шаблоном:

```
Tester: Beta-01 / Beta-02
Дата/время:
Экран/шаг:
Матч:
Что ожидалось:
Что произошло:
Повторяется: всегда / иногда / один раз
Сеть: Wi-Fi / mobile / offline-recovery
Severity: BLOCKER / MAJOR / MINOR
Screenshot/video: при наличии
```

BLOCKER: Mini App не открывается; невозможно найти/открыть матч; AI-путь не завершается; данные другого пользователя; admin UI/endpoint доступен non-admin; бесконечная загрузка без recovery.

## 8. Контракт публичного доступа и временной strict beta

Основной режим проекта — публичный вход через Telegram Mini App без ручного одобрения пользователя.

- Telegram `initData` и его server-side signature validation обязательны всегда.
- `BETA_ACCESS_ENABLED=false` — любой пользователь с валидным Telegram initData получает normal-user access. `BETA_TELEGRAM_IDS` не ограничивает доступ.
- Если `BETA_ACCESS_ENABLED` отсутствует, применяется то же поведение, что и при `false`: публичный normal-user режим.
- `BETA_ACCESS_ENABLED=true` — временный strict closed-beta режим: non-admin должен находиться в server-side `BETA_TELEGRAM_IDS`.
- `ADMIN_TELEGRAM_IDS` остаётся единственным списком администраторов; normal-user никогда не получает admin access из beta membership или frontend-состояния.
- Access-control выполняется только на backend после Telegram validation. Frontend может показывать состояние доступа, но не является security boundary.
- Регистрация/обновление валидированного пользователя в Supabase остаётся частью normal-user authentication flow.
- RLS, admin authorization, Telegram signature validation и остальные security controls не ослабляются.
- Provider quota protection, shared cooldown, distributed budget и request deduplication из #98/#99/#100 сохраняются.

## 9. Go / no-go

GO возможен только когда:
1. release gate и production consistency зелёные;
2. production monitor не в `incident`;
3. Beta-01 и Beta-02 прошли весь normal-user smoke;
4. LIVE validation выполнена на реальном матче;
5. фактические provider remaining/limits подтверждены;
6. Telegram getWebhookInfo подтверждён;
7. cohort и feedback channel реально созданы;
8. основной production-режим подтверждает `BETA_ACCESS_ENABLED=false` или missing и успешный normal-user вход нового валидированного Telegram-пользователя; strict beta отдельно проверяется тестом с `BETA_ACCESS_ENABLED=true`.


## 10. Strict Beta Post-Deploy snapshot — 26 сентября 2026, 12:25 UTC

Подтверждено фактическим production deploy:

- `main` и deployed SHA: `5e8be483a8722574877047bb8a96952ebdebc649`;
- Quality #645 — PASS;
- Deploy Production #349 — PASS;
- Cloudflare version `6797b5c9-4a3b-40db-8a1b-b967b979fbf9`, 100% traffic;
- release identity `6.120.0-rc144 / RC144`;
- production smoke 25/25;
- deploy re-verification test suite: 799 passed, 0 failed;
- latest provider evidence for release `6.120.0-rc144`: FREE, daily 97/100 remaining, minute 9/10 remaining, cooldown=false, evidence `controlled_release_probe` (11:41:13 UTC);
- историческое evidence до исправления #100: strict beta effective=true при raw env state `missing` (11:41:13 UTC); после этого изменения такое поведение считается устаревшим и не является целевым контрактом;
- beta allowlist count=0, admin allowlist count=1, overlap=0.

Provider capacity подтверждена. Для публичного режима beta allowlist не является blocker; отдельный strict-beta regression должен подтвердить allowlist только при `BETA_ACCESS_ENABLED=true`.

## 11. Closed Beta Access & Field Validation — privacy boundary

Подтверждено автоматическим gate PR #92 без изменения футбольной аналитики, providers или монетизации:

- server-side allowlist применяется только к Telegram-пользователю с успешно проверенной initData signature;
- admin bypass остаётся server-side и admin не считается участником `closed_beta_v1`;
- Beta Dashboard client metrics требуют `betaMembershipVerified=true` и HMAC `betaSubject`, поэтому admin/non-beta и старые pre-boundary client rows не загрязняют cohort;
- beta client telemetry не пишет сырой Telegram ID в `growth_events` и не возвращает pseudonymous subject через Dashboard API;
- Quality: 767/767 tests, fail 0; audit/security/lint/check/release/worker — PASS.

Provider quota evidence уже подтверждена production probe. Для текущего публичного режима остаются field checks: новый non-admin Telegram journey, отсутствие admin-доступа у него, реальный LIVE validation и Telegram `getWebhookInfo`; strict beta проверяется отдельно как временный opt-in режим.
