# Phase 3 frontend dependency map

Baseline inspected: `main@89e081374bb06326cd399e4cf9b5e193f7fecb81`.

## Runtime flow

`bootstrap / state / API -> navigation -> matches & search -> match center -> AI -> LIVE -> favorites / history / profile -> feedback -> admin / ops`

- **bootstrap/state/API** owns client compatibility, runtime status, network state, request dedupe and the authenticated Telegram request transport.
- **navigation** owns active views, scroll restoration, nested back targets and Telegram BackButton synchronization.
- **matches/search** owns catalog discovery, filters, remote search and fixture selection.
- **match center** owns fixture snapshots, lineups/statistics/availability/provenance presentation and refresh coordination.
- **AI** owns analysis request/render/history handoff while preserving server-side quota and analysis contracts.
- **LIVE** owns refresh timers and current-match refresh behavior; it remains coupled to match-center/analysis state in Phase 3.
- **favorites/history/profile** share authenticated user state and revision guards for async mutations.
- **feedback** shares profile identity, client telemetry and current view context.
- **admin/ops** consumes the authenticated profile role plus admin-only server endpoints. Frontend visibility is not an authorization boundary.

## Shared state

`state` remains the composition root because navigation, match selection, LIVE, AI and personal data intentionally coordinate through it. Request singleflight remains in `inflightGetRequests`. Moving these into isolated module-local stores in this phase would change observable timing and dedupe behavior.

## DOM dependencies

The existing IDs/classes in `index.html` remain contract-compatible. Rendering functions still receive/use the same nodes. Phase 3 does not rename views, navigation IDs, match-center nodes, profile/admin panels or event targets.

## Telegram WebApp dependencies

Telegram bootstrap is now isolated in `public/modules/client-core.js`. The returned WebApp instance remains shared by navigation, initData-authenticated API calls, BackButton, theme/header integration and Telegram return/share flows. Telegram initData validation remains server-side.

## API dependencies

The generic authenticated client transport is now created by `createApiClient` in `public/modules/client-core.js`. URL paths, headers, retry/dedupe behavior, compatibility handling and runtime propagation are unchanged.

Admin provider diagnostics are isolated in `public/modules/admin-provider.js` and loaded with dynamic `import()` only after the server-authenticated profile reports admin role. It covers provider status, quota/coverage audit and expanded-data E2E diagnostics. Server-side admin authorization remains authoritative.

## CSS boundaries

- `public/styles.css`: existing base, tokens and legacy component cascade.
- `public/styles/public-shell.css`: later public-shell/mobile experience layer, loaded after the base stylesheet to preserve cascade order.
- `public/styles/admin.css`: admin-only presentation rules, injected only when the lazy admin provider module is instantiated.

Further domain CSS splitting (matches, match-center, profile/history) is intentionally deferred inside Phase 3 until selector ownership can be separated without reordering the mature cascade. No visual redesign is part of this phase.

## Intentionally still monolithic

Navigation, matches/search, match-center, AI, LIVE and personal-data renderers remain in `app.js` because they have dense shared-state and DOM coupling. This Phase 3 pass establishes low-risk infrastructure and public/admin boundaries first rather than converting those flows into a big-bang module graph.
