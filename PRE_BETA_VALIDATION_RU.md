# Pre-Beta Operational Validation — FM AI 6.120.0-rc144

Цель: провести закрытую beta на существующем продукте без добавления новых футбольных функций.

## 1. Зафиксированная release identity

- Validation snapshot GitHub `main` от 15:18 UTC: `5519b98049ae6a74212897cf261ef2d8bc550a5c`. Последующие docs-only merges обязаны повторно пройти Quality + production provenance gate.
- Версия клиента/Worker: `6.120.0-rc144`.
- Release candidate: `RC144`.
- Cloudflare version в этом validation snapshot: `8c922e24-4e4d-431a-9515-47d649606f15`. Актуальный version ID генерируется на каждом deploy и берётся из latest successful `Deploy Production`.
- Production URL: `https://football-analytics-cloudflare.wok-side.workers.dev`.
- Production SHA/version ID подтверждаются deploy workflow для текущего `main`; RC120 требует 100% traffic на ожидаемую release identity, post-deploy smoke — 25/25.

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

Текущий код распознаёт API-Football FREE как ориентир **100 запросов/день и 10/мин** и сохраняет резерв 20 запросов/день и 3/мин. Это программный защитный профиль, а не замена фактическим provider headers.

Наблюдаемый production факт: ранее был получен `FOOTBALL_RATE_LIMIT_BODY` с текстом превышения минутного лимита. Поэтому первая cohort не должна расширяться до подтверждения реального `dailyRemaining/minuteRemaining`.

Перед приглашением:
- [ ] администратор открывает Provider status после свежего успешного API-Football запроса;
- [ ] фиксирует detected plan;
- [ ] фиксирует daily limit / remaining;
- [ ] фиксирует minute limit / remaining;
- [ ] убеждается, что cooldown=false и budget mode не emergency.

До этой проверки безопасная первая cohort: **ровно 2 non-admin тестировщика**. Третий пользователь добавляется только после подтверждения здорового остатка. Платный тариф не подключается без отдельного подтверждения владельца проекта.

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

## 8. Server-side beta allowlist

Механизм подготовлен полностью, но production-список не заполнен фиктивными значениями.

- `BETA_TELEGRAM_IDS` — server-side список фактически приглашённых Telegram ID. Он используется только после успешной Telegram initData signature validation.
- `BETA_ACCESS_ENABLED=false` — безопасное значение по умолчанию. При таком состоянии приложение не блокирует остальных валидных Telegram-пользователей, но Beta Dashboard помечает `closed_beta_v1` только для реальных ID из `BETA_TELEGRAM_IDS`.
- `BETA_ACCESS_ENABLED=true` — strict closed beta: после Telegram validation все normal-user API routes доступны только участникам `BETA_TELEGRAM_IDS`; admin проходит через server-side bypass.
- Admin никогда не получает `closed_beta_v1` и не загрязняет Beta Dashboard.
- Beta client telemetry не содержит Telegram ID: после verified membership сервер вычисляет HMAC-псевдоним `betaSubject`; исходный ID и allowlist не возвращаются в UI/Beta Dashboard и не добавляются в ops logs.
- Для beta client telemetry legacy `growth_events` не используется, потому что его схема требует сырой `telegram_id`; Beta Dashboard считает client metrics из verified `ops_events` и никогда не возвращает `betaSubject`.
- События со старой одной меткой `closed_beta_v1` без `betaMembershipVerified=true`, а также старые client telemetry rows без валидного `betaSubject`, в beta-user/journey метрики не входят.

До реального назначения Beta-01/Beta-02 оставить `BETA_TELEGRAM_IDS` пустым и `BETA_ACCESS_ENABLED=false`. После получения реальных ID владелец задаёт их только в server-side environment, затем отдельно принимает решение, включать ли strict access.

## 9. Go / no-go

GO возможен только когда:
1. release gate и production consistency зелёные;
2. production monitor не в `incident`;
3. Beta-01 и Beta-02 прошли весь normal-user smoke;
4. LIVE validation выполнена на реальном матче;
5. фактические provider remaining/limits подтверждены;
6. Telegram getWebhookInfo подтверждён;
7. cohort и feedback channel реально созданы;
8. реальные Beta-01/Beta-02 внесены в server-side `BETA_TELEGRAM_IDS`, а режим доступа (`BETA_ACCESS_ENABLED`) выбран владельцем.


## 10. Снимок повторной автоматической проверки 25 сентября 2026, 15:18 UTC

Подтверждено без изменения аналитической логики:

- GitHub main / production deploy SHA согласованы.
- Cloudflare release identity: `6.120.0-rc144 / RC144`, 100% traffic на version `8c922e24-4e4d-431a-9515-47d649606f15`.
- Full Quality: 756/756 tests; audit/security/lint/check/release/worker PASS.
- Supabase: `ACTIVE_HEALTHY`; v6.19/RC129 migration присутствует; fingerprint совпадает.
- Backend security/default ACL contracts: PASS, violations=0.
- Runtime controls: analysis/search/live/reminders включены, maintenance выключен.
- Telegram dedupe persistence: stale=0, failedCurrent=0, failedRecent=0.
- За последний час на момент проверки нет новых non-monitor warning/error/critical ops events.
- Persisted production monitor ещё содержит `watch` от 15:00 UTC; текущие проверенные входы соответствуют healthy, но это не отмечается как PASS до следующего фактического monitor run.

Остаются только полевые/секрет-зависимые проверки: два non-admin Telegram smoke, реальный LIVE, свежие provider quota headers, Telegram `getWebhookInfo`, фактическое назначение Beta-01/Beta-02 и создание feedback channel.

## 11. Closed Beta Access & Field Validation — privacy boundary

Подтверждено автоматическим gate PR #92 без изменения футбольной аналитики, providers или монетизации:

- server-side allowlist применяется только к Telegram-пользователю с успешно проверенной initData signature;
- admin bypass остаётся server-side и admin не считается участником `closed_beta_v1`;
- Beta Dashboard client metrics требуют `betaMembershipVerified=true` и HMAC `betaSubject`, поэтому admin/non-beta и старые pre-boundary client rows не загрязняют cohort;
- beta client telemetry не пишет сырой Telegram ID в `growth_events` и не возвращает pseudonymous subject через Dashboard API;
- Quality: 767/767 tests, fail 0; audit/security/lint/check/release/worker — PASS.

Ручные пункты ниже **не подтверждены** и остаются blocker до фактического выполнения: два non-admin Telegram smoke, реальный LIVE validation, свежие API-Football plan/dailyRemaining/minuteRemaining, Telegram `getWebhookInfo`, фактическое назначение Beta-01/Beta-02, создание feedback channel и финальное GO/NO-GO после этих подтверждений.
