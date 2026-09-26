# Phase 5 — Open/Public Validation Reconciliation

Дата начала evidence: только после production deployment кода Phase 5.
Baseline Phase 4: `7ca8d20a5fc173523745071d49d709b8c530bdda`.

## Access control и validation cohort

Доступ и продуктовая выборка разделены.

- `BETA_ACCESS_ENABLED=false` или missing: любой пользователь с валидным Telegram initData получает normal-user access.
- `BETA_ACCESS_ENABLED=true`: действует временный strict-beta access через `BETA_TELEGRAM_IDS`.
- Принадлежность к `BETA_TELEGRAM_IDS` не является условием Phase 5 evidence.
- Администраторы, unsigned/invalid requests, DEV synthetic identity и public health/smoke/release probes не входят в Phase 5 cohort.

Основной cohort: `phase5_public_v1`.

Сервер принимает случайный per-tab/session token только вместе с уже проверенным Telegram initData. Telegram ID и raw session token используются только как вход HMAC и не сохраняются в Phase 5 telemetry. В persistent evidence сохраняются только 32-hex HMAC subject/session.

## Evidence start boundary

Старые `closed_beta_v1` / `betaMembershipVerified` события не мигрируются и не конвертируются.
Старые клиенты без `x-phase5-session` не попадают в новую выборку.
Unit tests, CI, health/smoke/release probes не создают Phase 5 evidence.

## Product journey

Полный journey:

`BOOT_OK → search_used → match_open → ai_complete → Мои команды → history_open → BOOT_OK в новой session`.

Dashboard также показывает reopen/return и abandonment по переходам.

## Initial evidence thresholds

- verified normal users >= 5;
- sessions >= 10;
- completed full journeys >= 5;
- search latency samples >= 10;
- Match Center latency samples >= 10;
- AI latency samples >= 10;
- coverage observations >= 20.

До выполнения всех обязательных thresholds factual status: `COLLECT MORE EVIDENCE`.

LIVE не является глобальным блокером при отсутствии подходящих матчей. Если live sample отсутствует: `INSUFFICIENT_LIVE_SAMPLE`.

## Provider evidence

Для verified normal-user product requests агрегируются:

- network requests;
- cache hits;
- stale-cache hits;
- distributed quota blocks;
- shared cooldown activations;
- cost по search / matches feed / Match Center / AI / LIVE refresh.

Dashboard вычисляет requests/session, requests/completed journey, cache-hit rate, AI requests/user и LIVE requests/active LIVE user. Capacity projection строится только из observed production usage и confirmed provider quota state; документационные лимиты сами по себе не являются evidence.

Capacity decision и data coverage decision независимы. Capacity-сигнал считается только из реальных verified sessions, observed network requests/session, cache behavior и подтверждённого quota state. Даже статус `CAPACITY REVIEW REQUIRED` не означает автоматический upgrade: смена тарифа/provider требует отдельного решения после проверки evidence.

## Coverage

Наблюдаются lineups, injuries, statistics, xG, odds и отдельная LIVE выборка. Отсутствие одного типа данных или один rate-limit не является основанием для provider upgrade.

## Legacy closed beta

`/api/beta-dashboard`, `closed_beta_v1`, `betaMembershipVerified`, allowlist и strict-beta regression сохраняются как исторический/security контур.

Основной Phase 5 readiness использует `/api/phase5-dashboard` и не требует Beta-01/Beta-02 или manual waves 2 → 4 → 6.

## Phase boundary

Phase 4 UX остаётся baseline. Новые football-функции, AI model/weights, новый provider и monetization на этом шаге не вводятся.

Phase 6 не начинается до отдельной явной команды.
