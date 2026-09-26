# Architecture & Product Structure Consolidation — Phase 2 extraction map

Цель Phase 2 — уменьшать монолиты небольшими behavior-preserving PR, по одному домену за раз. Никакого массового rewrite.

## Порядок extraction

1. **Worker config/auth boundary**: `src/worker/config.js`, `src/worker/telegram-auth.js`, `src/worker/admin-auth.js`. Перенести parsing env, Telegram initData validation wiring и admin authorization без изменения access contract.
2. **Worker HTTP/routing**: `src/worker/http.js`, `src/worker/routes/public.js`, `src/worker/routes/user.js`, `src/worker/routes/admin.js`. Сначала pure response/helpers, затем route groups; provider quota/cache/dedup остаются общими зависимостями.
3. **Worker provider orchestration**: `src/worker/provider-gateway.js`, `src/worker/provider-budget.js`, `src/worker/cache.js`, `src/worker/dedup.js`. Только перенос существующей защиты; алгоритмы и лимиты не менять.
4. **Worker product domains**: `src/worker/domains/matches.js`, `analysis.js`, `live.js`, `teams.js`, `history.js`, `favorites.js`, `feedback.js`. Один домен = отдельный PR + regression.
5. **Client core**: `public/js/core/state.js`, `api.js`, `telegram.js`, `navigation.js`, `errors.js`. Сначала stateless helpers/API wrapper, затем state/navigation.
6. **Client domains**: `public/js/domains/search.js`, `matches.js`, `analysis.js`, `live.js`, `teams.js`, `history.js`, `profile.js`, `feedback.js`; admin код отдельно в `public/js/admin/*`.
7. **CSS foundations**: `public/css/tokens.css`, `base.css`, `layout.css`, `components.css`. Сохранять cascade/order через явный import order.
8. **CSS domains**: `public/css/domains/search.css`, `matches.css`, `analysis.css`, `live.css`, `profile.css`, `admin.css`, `responsive.css`.

## Safety rule для каждого extraction PR

До/после extraction должны совпадать API contracts, security checks, provider request counts, cache keys/TTL, dedup semantics, rendered user states и production smoke. RLS, Telegram validation, admin authorization, quota protection и rollback не ослабляются. Каждый PR извлекает один слой/домен и не добавляет football-функции.
