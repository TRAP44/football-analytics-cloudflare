# Architecture & Product Structure Consolidation — Phase 2 dependency map

Phase 2 выполняется только отдельными behavior-preserving PR. Один extraction boundary за PR; никаких новых football/AI/provider/monetization функций и никакого big-bang rewrite.

## Worker: dependency-safe порядок

1. **worker/router** — `src/worker/router.js`, `src/worker/http.js`. Сначала вынести pure URL/method dispatch и response helpers. Router получает зависимости через параметры и не владеет auth/provider/storage.
2. **telegram** — `src/worker/telegram/init-data.js`, `webhook.js`, `dedup.js`. Сохранить подпись/initData validation, replay protection и persistent webhook dedup без изменения порядка проверок.
3. **auth** — `src/worker/auth/user.js`, `admin.js`, `access.js`. Public Telegram access остаётся default; strict beta только opt-in. Admin authorization извлекается отдельно от user auth.
4. **football-data** — `src/worker/football-data/gateway.js`, `quota.js`, `cache.js`, `normalizers.js`. Gateway остаётся единственной точкой provider calls; quota/budget/cache/dedup semantics и TTL не меняются.
5. **analysis** — `src/worker/analysis/service.js`, `provenance.js`, `predictions.js`. Зависит от football-data через явный interface и от storage; не получает прямой provider access.
6. **users** — `src/worker/users/profile.js`, `favorites.js`, `history.js`, `usage.js`. Auth context передаётся сверху; RLS/backend-only assumptions сохраняются.
7. **billing** — `src/worker/billing/entitlements.js`, `limits.js`. Только перенос существующей dormant/paused логики; monetization не включать и не расширять.
8. **admin** — `src/worker/admin/routes.js`, `diagnostics.js`, `feedback.js`. Только после extraction admin auth; никакой admin route не импортируется в public route surface.
9. **ops** — `src/worker/ops/health.js`, `monitoring.js`, `release.js`, `rollback.js`. Извлекать последним, сохраняя readiness/schema probes, monitoring и rollback contracts.

## public/app.js

1. `public/js/core/api.js`, `state.js`, `telegram.js`, `navigation.js`, `errors.js`.
2. Public domains: `public/js/public/search.js`, `matches.js`, `analysis.js`, `live.js`, `teams.js`, `history.js`, `favorites.js`, `profile.js`, `feedback.js`.
3. Admin boundary: `public/js/admin/index.js`, `overview.js`, `provider.js`, `diagnostics.js`, `release.js`, `feedback.js`. Admin modules загружаются/активируются только после admin capability check.
4. До физического extraction зафиксировать DOM/API contract tests для каждого переносимого блока. На Phase 1 не менять runtime loading model.

## public/styles.css

1. Foundations: `public/css/tokens.css`, `base.css`, `layout.css`, `components.css`.
2. Public: `public/css/public/search.css`, `matches.css`, `analysis.css`, `live.css`, `profile.css`, `feedback.css`.
3. Admin: `public/css/admin/admin.css`, `diagnostics.css`, `provider.css`, `release.css`.
4. `public/css/responsive.css` извлекать последним. Порядок cascade фиксируется regression snapshot/selector-order test до первого CSS move.

## Invariants каждого extraction PR

API contracts, Telegram initData validation, public access semantics, admin authorization, RLS assumptions, rate limits, provider quota/budget, cache keys/TTL, deduplication, monitoring, rollback, DOM user states и provider request counts должны совпадать до/после extraction. Каждый PR проходит полный quality/security/release gate и production smoke до следующего extraction.
