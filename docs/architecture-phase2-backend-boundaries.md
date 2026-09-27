# Phase 2 backend dependency map

Baseline inspected: main at `0fa47739c6f583f1fcd4d981dc42455523532c98`.

## Runtime dependency direction

`worker.js (composition root) -> router -> domain handlers`

`worker.js (composition root) -> telegram-transport -> Telegram update processor -> domain handlers`

Domain flow observed in the monolith:

- **router / request dispatch** depends on authenticated `user`, beta access decision, runtime controls and burst protection before dispatch. Admin routes additionally depend on `isAdminUser` / `adminForbidden`.
- **telegram** depends on webhook-secret verification, in-memory and Supabase-backed update dedupe, burst protection, Telegram API transport, user upsert, football search/match handlers, favorites/history/reminders and deferred billing handlers. Command and deep-link semantics remain in `processTelegramUpdate`.
- **auth** depends on Telegram initData HMAC validation, `access-control.js`, config, and best-effort user persistence. It must execute before protected API routing.
- **football-data** depends on provider configuration, shared provider quota/cooldown state, distributed budget claims, cache, singleflight/request dedupe, provider adapters and Supabase persistence.
- **analysis** depends on football-data, trusted/quality-normalized feature inputs, AI quota reservation/refund, history/cache persistence and provider reliability metadata.
- **users** depends on auth identity plus Supabase/local fallback state; favorites, history, reminders and preferences are user-scoped.
- **billing** depends on users and Telegram payment events, but public API routing remains disabled while monetization is disabled.
- **admin** depends on auth plus independent `ADMIN_TELEGRAM_IDS` authority and exposes diagnostics/runtime/provider/model operations only after server-side authorization.
- **ops** is cross-cutting: telemetry, release/readiness checks, runtime controls, rollback/monitoring, Supabase health and scheduled jobs observe the domains above without becoming their authorization source.

## Shared state and side effects that constrain extraction

The current `memory` object is shared by cache, inflight singleflight, route burst, Telegram burst/dedupe, user sync, provider telemetry/audit and operational state. Provider quota/cooldown additionally has persistent/shared state and must not be converted to module-local state. Supabase RPC/table writes, Telegram API calls, provider HTTP calls, Cloudflare `waitUntil`, cache writes and telemetry/ops events are observable side effects.

For this phase, extracted modules therefore receive dependencies from `worker.js` instead of importing the composition root. This prevents circular imports and preserves singleton/shared state ownership.

## Phase 2 boundaries extracted

- `src/router.js`: protected API route selection and admin-route isolation. Authentication, beta/public access, runtime guard, burst guard and top-level error compatibility remain in `worker.js`.
- `src/telegram-transport.js`: Telegram webhook transport/orchestration: secret verification, update parse, memory/persistent dedupe lifecycle, burst handling and delegation to the existing update processor. Telegram commands, callbacks, deep links and football/business handlers remain unchanged in `worker.js`.
- `src/user-favorites.js`: user-scoped favorites storage boundary: guarded Supabase add/read/delete semantics, 50-item fallback cap and memory fallback are injected from `worker.js`; API and Telegram callers remain unchanged.
- `src/user-reminders.js`: user-scoped reminder CRUD boundary: preference-derived defaults, guarded Supabase writes, 50-active-item fallback cap, reads/deletes and memory fallback are injected from `worker.js`. Reminder delivery claims, Telegram send/retry behavior and cron orchestration intentionally remain in `worker.js` for a later side-effect boundary.
- `src/user-preferences.js`: user-scoped preferences normalization/read/write boundary: default filter, reminder timing, kickoff notification, youth hiding and favorite-first semantics are preserved; Supabase and memory storage dependencies remain injected from `worker.js`.
- `src/user-history.js`: user-scoped analysis history storage boundary: row normalization, fail-soft Supabase upsert/read semantics, fixture dedupe and 20-item memory fallback are injected from `worker.js`; API history formatting and read-only cached-analysis reopening remain in `worker.js`.
- `src/reminder-delivery-store.js`: reminder delivery persistence boundary: public delivery-state normalization plus stale-claim recovery and claim/finish/release PATCH semantics are injected from `worker.js`; the store has no Telegram transport or scheduler policy.\n- `src/reminder-delivery-service.js`: reminder delivery orchestration boundary: due-row selection, retry-window filtering, kickoff/prematch message construction, claim/send/finish-or-release sequencing and delivery/scheduler ops events are injected from `worker.js`; the shared Telegram transport function remains owned by the composition root.

No API URL, JSON contract, Telegram command/deep-link contract, Supabase schema, provider quota/cooldown policy, cache/dedupe policy, AI quota, monetization flag or frontend behavior is changed by these boundaries.
