# MatchRadar

MatchRadar is a Telegram-first football analytics Mini App built on Cloudflare Workers. It combines match discovery, Match Center, team and player context, AI-assisted match interpretation, reminders, lineup notifications, important-change notifications, post-match return loops, and an administrative operations surface.

## Current architecture

- **Runtime:** Cloudflare Worker (`src/worker.js`)
- **Static frontend:** `public/`
- **Public entrypoint:** `public/index.html`
- **Admin entrypoint:** `public/admin.html`
- **Shared public client:** `public/app.js`
- **Frontend modules:** `public/modules/`
- **Database:** Supabase
- **Football data provider:** API-Football
- **Messaging:** Telegram Bot API / Telegram Mini App
- **Scheduler:** Cloudflare Cron every 5 minutes
- **CI:** GitHub Actions
- **Production deploy:** Cloudflare via verified GitHub Actions workflow

The public and admin HTML surfaces are separate. Shared runtime code remains intentionally centralized in `public/app.js` while feature modules continue to be extracted incrementally.

## Product surfaces

### Public Mini App

The public surface includes:

- Home match feed
- Global search and discovery
- Match Center
- Radar / “Что изменилось”
- Smart insights and LIVE AI context
- Team Hub
- Tournament view and standings
- Player Hub
- Favorites / “Мои команды”
- Match watchlist
- Reminders
- Analysis history
- User profile and UI preferences
- Radar Feed

### Admin surface

The admin entrypoint is isolated at `public/admin.html` and exposes operational controls and diagnostics only to authorized admin users. Server-side authorization remains authoritative; frontend hiding is not treated as a security boundary.

## Match Center

Match Center is the primary product surface. Its information hierarchy is:

1. Match identity, status and score
2. “Что изменилось” Radar signals
3. LIVE AI / smart match context
4. Key metrics
5. Latest events
6. Detailed statistics, lineups, players, market data and chronology

The UI must not fabricate probabilities. Market movement, pressure and change narratives are derived from existing validated payload fields.

## Player Hub

Player Hub provides player context from current squad/match data and season statistics where available. Player routes are part of the public navigation contract and should remain reachable from relevant team and match surfaces.

## Notifications

Notification delivery is built around explicit claim / send / finish state so retries cannot silently duplicate Telegram messages.

Current notification flows include:

- Prematch reminder
- Kickoff notification
- Published lineup notification
- Important pre-match change notification
- Post-match return / AI review loop

### Scheduled execution order

The Cloudflare cron runs every 5 minutes. `src/scheduled-jobs.js` coordinates task ordering and load smoothing.

The latency-sensitive notification chain is serialized:

`reminders -> lineup_notifications -> important_change_notifications`

Other scheduled tasks include backtest settlement, post-match return, daily digest, production monitoring, cleanup jobs and settlement verification.

## Data quality rules

The project follows fail-closed semantics for confidence-bearing football data.

Examples:

- A lineup is not considered confirmed unless both teams have exactly 11 unique starters.
- Stale or unattributed lineup data must not be promoted to confirmed.
- Important-change notifications require a meaningful movement threshold and sufficient saved market history.
- Unknown Telegram delivery outcomes suppress unsafe automatic retry until state is reconciled.

## Frontend modules

Current shared modules include:

- `client-core.js` — transport/bootstrap helpers and API client
- `navigation.js` — canonical public view routing/back navigation
- `app-runtime.js` — client/release identity and runtime constants
- `ui-preferences.js` — interface preference controller
- `first-run-guide.js` — onboarding controller

The frontend is being decomposed incrementally. New feature work should prefer focused modules over adding unrelated logic directly to `public/app.js`.

## Local development

Requirements:

- Node.js 22
- npm
- Wrangler
- A Cloudflare account for deployment
- Supabase project
- Telegram bot
- Required provider/API credentials

Install dependencies:

```bash
npm ci
```

Start the local Worker:

```bash
npm run dev
```

## Validation

Run the full local validation sequence before opening or merging a PR:

```bash
npm audit --audit-level=high
npm run security:scan
npm run lint
npm run check
npm test
node scripts/bottom-nav-render-smoke.js
npm run verify:release
npm run verify:worker
```

The GitHub **Quality** workflow runs the same core checks on pull requests and pushes to `main`.

## Production deployment

Production deploy is handled by `.github/workflows/deploy-production.yml`.

The deployment workflow:

1. waits for a successful Quality run on `main`;
2. verifies the exact commit SHA;
3. blocks stale deployment attempts;
4. re-runs audit, security, lint, checks, tests, render smoke and release verification;
5. verifies Cloudflare credentials;
6. compares the active production release with the verified artifact;
7. deploys only the verified current `main` revision;
8. performs post-deploy validation.

Do not bypass the production workflow for ordinary releases.

## Cloudflare configuration

`wrangler.jsonc` defines:

- Worker entrypoint: `src/worker.js`
- Static assets: `public/`
- API/health/Telegram requests routed through the Worker
- Cron: every 5 minutes
- version metadata binding
- non-secret runtime variables

Secrets must not be committed to the repository.

## Supabase

Supabase is used for persistent user and operational data including favorites, reminders, preferences, history, notification delivery state and other product/ops records.

Schema changes must be additive and migration-driven. Do not hand-edit production tables without adding the matching migration and regression coverage.

When adding a new notification type, define its persistence/deduplication contract explicitly before enabling delivery.

## Release identity

Current release identity is intentionally represented by several contracts:

- npm package version
- client version / release channel
- frontend asset revision
- production release identity

These values are checked by release verification. Do not update one identity marker in isolation without updating its associated regression contracts.

## Pull request discipline

Keep PRs narrowly scoped.

Preferred sequence:

1. create a feature/fix branch from current `main`;
2. change one bounded behavior;
3. add or update regression tests;
4. open a PR;
5. wait for Quality;
6. fix failures in the same PR;
7. merge only after Quality is green;
8. start the next stage from the new `main`.

Avoid mixing schema migrations, provider behavior, frontend redesign and deploy-policy changes in one PR unless the change cannot be safely separated.

## Reliability principles

- Fail closed on uncertain authorization, schema or delivery state.
- Prefer cached validated data to duplicate provider calls.
- Group notification recipients by fixture before provider probing.
- Do not retry ambiguous Telegram sends automatically.
- Preserve provider quota guards.
- Keep admin APIs server-authorized.
- Treat `main` + green Quality as the source of truth.
- Never deploy a stale SHA.

## Repository map

```text
.
├── .github/workflows/
│   ├── quality.yml
│   └── deploy-production.yml
├── public/
│   ├── index.html
│   ├── admin.html
│   ├── app.js
│   ├── styles.css
│   └── modules/
├── src/
│   ├── worker.js
│   ├── scheduled-jobs.js
│   ├── reminder-delivery-service.js
│   ├── reminder-delivery-store.js
│   ├── lineup-notification-service.js
│   └── important-change-notification-service.js
├── supabase/
│   └── migrations/
├── test/
├── scripts/
├── wrangler.jsonc
└── package.json
```

## Current development priority

The project already has strong CI, deployment hardening and operational controls. The main technical priority is now frontend maintainability: continue extracting cohesive public/admin feature logic from the large shared `public/app.js` while preserving existing UX and regression contracts.
