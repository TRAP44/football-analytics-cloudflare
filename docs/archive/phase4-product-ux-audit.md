# Phase 4 — Product UX audit and change map

Baseline: `main@7f57ef83ffbcc7541fab1bf8589fcf5b7d37c549`.

## Audit: new non-admin journey

Before Phase 4 the first visible public view was a dedicated search screen while the bottom navigation separately exposed both “Матчи” and “Найти матч”. Favorites were primarily a match filter/profile block, so the user's core loop was split across product structure rather than football intent. Match Center already contained the required AI probabilities, confidence, factors, risks, detailed data tabs and pre-kickoff change information, but the first level still needed stricter prioritization.

Observed friction:
- duplicated discovery entry points between dedicated Search and Matches;
- favorite teams were not a first-class destination;
- LIVE was present as a filter/overview action but competed with discovery structure;
- profile mixed ordinary settings with favorite-team management;
- empty favorites copy instructed users to navigate by implementation structure rather than by task;
- technical/admin surfaces remain large, but are protected by Phase 3 physical/logical gating and are not part of the public bottom navigation;
- public errors already translate provider/rate-limit failures to user language; this behavior must remain;
- mobile shell had safe-area/touch-target protections, but Phase 4 adds explicit 360/375/390/430 layout guards.

## Dependency/change map

`Telegram /start → Home → search/LIVE/My Teams/today feed → Match Center → AI → history/reopen/profile`

- **Home:** existing `matchesView` becomes the default public landing view. Existing match catalog, filters, LIVE counts and local match search are reused.
- **Search:** remains an internal/nested discovery view for existing search logic and deep links, but is removed from bottom navigation. Home owns the visible search CTA.
- **My Teams:** new public view backed only by existing `state.favorites` and `state.matches`; no new provider/API/schema.
- **Match Center / AI:** existing contracts stay intact. First-level AI glance is constrained to three factors and adds plain-language data completeness beside AI confidence.
- **History/Profile:** remain public destinations. History supports reopen without consuming another AI quota.
- **Admin/Ops:** unchanged authorization and lazy admin boundary from Phase 3. No admin item enters public navigation.
- **Telemetry:** existing privacy-safe `product_action` transport is retained; Phase 4 adds `open`, `home_open` and `favorite_team_open` journey actions without adding identifiers.
- **Backend/security:** initData validation, public/admin access contracts, RLS, Supabase schema, provider/caching/quota/cooldown and API response contracts are unchanged.

## Target information architecture

Bottom navigation: **Главная | Мои команды | История | Профиль**.

Home priority: **Search → My Teams/LIVE signals → Today for you → current match feed**. Search is no longer a bottom-level destination. The existing LIVE quick action stays on Home.

My Teams: favorite club → relevant LIVE/nearest/recent fixture from the already loaded catalog → direct Match Center; otherwise a clear “data unavailable” state.

Match Center first level: teams/time/score → probabilities → AI confidence + data completeness → three main factors → main risks → existing change/delta information when available. Detailed lineups, absences, form, statistics, xG, H2H, market, referee, news and other existing data remain progressively disclosed.

## Explicit non-goals

No backend rewrite, AI model change, provider addition, monetization, schema/RLS change, quota/caching change, or Phase 5 work.
