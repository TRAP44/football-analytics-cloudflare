import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const worker = fs.readFileSync('src/worker.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const staticHeaders = fs.readFileSync('public/_headers', 'utf8');
const styles = fs.readFileSync('public/styles.css', 'utf8');
const deployWorkflow = fs.readFileSync('.github/workflows/deploy-production.yml', 'utf8');
const rollbackWorkflow = fs.readFileSync('.github/workflows/rollback-production.yml', 'utf8');
const rollbackSmoke = fs.readFileSync('scripts/rollback-smoke.js', 'utf8');
const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');
const readme = fs.readFileSync('README_CLOUDFLARE_RU.md', 'utf8');
const qaChecklist = fs.readFileSync('QA_RELEASE_CHECKLIST_RU.md', 'utf8');
const baselinePath = 'supabase/baseline/supabase_baseline_v6_15.sql';
const baseline = fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, 'utf8') : '';
const expected = `${pkg.version}-rc103`;
const failures = [];
const rootSql = fs.readdirSync('.').filter(name => /^supabase_(?:baseline|migration)_.*\.sql$/i.test(name));
if (rootSql.length) failures.push(`Supabase SQL must live under supabase/: ${rootSql.join(', ')}`);


if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) failures.push('package-lock version must match package.json');

if (!worker.includes(`const APP_VERSION = '${expected}'`)) failures.push(`Worker version must be ${expected}`);
if (!worker.includes("const RC_NAME = 'RC103'")) failures.push('Worker RC name must be RC103');
if (!app.includes(`const CLIENT_VERSION = '${expected}'`)) failures.push(`Client version must be ${expected}`);
if (!app.includes("const CLIENT_RELEASE_CHANNEL = 'rc103'")) failures.push('Client release channel must be rc103');
if (!html.includes(`/app.js?v=${pkg.version}`) || !html.includes(`/styles.css?v=${pkg.version}`)) failures.push('Static asset versions must match package version');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_9.sql')) failures.push('Missing v6.9 migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_10.sql')) failures.push('Missing v6.10 migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_11.sql')) failures.push('Missing v6.11 migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_11_1.sql')) failures.push('Missing v6.11.1 default-ACL migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_12.sql')) failures.push('Missing v6.12 bot-digest migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_13.sql')) failures.push('Missing v6.13 referee-history migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_14.sql')) failures.push('Missing v6.14 persistent-AI-history migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_15.sql')) failures.push('Missing v6.15 media-launch attribution migration');
if (!fs.existsSync(baselinePath)) failures.push('Missing unified v6.15 baseline');
if (fs.existsSync('supabase/baseline/supabase_baseline_v6_9.sql')) failures.push('Obsolete v6.9 fresh-install baseline must be removed');
if (!fs.existsSync('test/supabase-baseline-rc99.test.js')) failures.push('Missing RC99 Supabase baseline regression test');
for (const marker of [
  'create table if not exists public.model_calibration_transitions',
  'create or replace function public.backend_security_contract()',
  'create or replace function public.backend_default_acl_contract()',
  'create table if not exists public.bot_digest_subscriptions',
  'create table if not exists public.referee_match_history',
  'add column if not exists ai_signal_code',
  'create table if not exists public.growth_events'
]) {
  if (!baseline.toLowerCase().includes(marker.toLowerCase())) failures.push(`RC99 unified baseline is missing: ${marker}`);
}
if (!fs.existsSync('src/access-control.js')) failures.push('Missing access-control module');
if (!fs.existsSync('scripts/post-deploy-smoke.js')) failures.push('Missing post-deploy smoke test');
if (!fs.existsSync('.github/workflows/deploy-production.yml')) failures.push('Missing production deploy workflow');
if (!fs.existsSync('.github/workflows/rollback-production.yml')) failures.push('Missing production rollback workflow');
if (!staticHeaders.includes('Content-Security-Policy:')) failures.push('Missing static asset Content-Security-Policy');
if (!staticHeaders.includes("script-src 'self' https://telegram.org")) failures.push('CSP must allow the official Telegram Mini App SDK');
if (!deployWorkflow.includes('exit 1')) failures.push('Production deployment must fail closed without Cloudflare credentials');
if (!deployWorkflow.includes('--message "RC103 ${{ env.DEPLOY_SHA }}"')) failures.push('Production deploy message must identify RC103');
if (!deployWorkflow.includes('post-deploy-smoke.js "$SMOKE_URL" "6.95.0-rc103"')) failures.push('Production smoke must verify 6.95.0-rc103');
if (!wrangler.includes('"/health/*"')) failures.push('All health probes must be routed through the Worker');
if (!/id="adminRoleBadge"[^>]*data-admin-only[^>]*hidden/.test(html)) failures.push('Admin role badge must use the fail-closed admin-only visibility contract');
if (!/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*\}/i.test(styles)) failures.push('Global hidden elements must remain display:none');
if (!app.includes("badge.textContent = admin ? '🔐 Администратор' : '';")) failures.push('Client must clear the admin badge for non-admin users');
if (!app.includes("el.toggleAttribute('inert', !admin)")) failures.push('Admin-only elements must be inert for non-admin users');
if (!app.includes('const photoUrl = safeUrl(user.photoUrl);')) failures.push('profile photo must use Telegram photoUrl through safeUrl');
if (!styles.includes('.avatar img')) failures.push('Profile avatar image styling is missing');
if (!fs.existsSync('test/user-flow-contract.test.js')) failures.push('Missing user-flow regression test');
if (!fs.existsSync('test/accessibility-navigation.test.js')) failures.push('Missing accessibility navigation regression test');
if (!fs.existsSync('test/unified-search.test.js')) failures.push('Missing unified search regression test');
if (!worker.includes("url.pathname === '/api/history-analysis'")) failures.push('Missing quota-safe history analysis route');
if (!app.includes('tg.BackButton.onClick(handleBackNavigation)')) failures.push('Telegram BackButton navigation is not wired');
if (!app.includes('state.globalSearch.requestSeq')) failures.push('Global search stale-response guard is missing');
if (!worker.includes('searchLeagueFixtures: true')) failures.push('League fixture search capability is missing');
if (!worker.includes('loadSearchCompetitionMatches')) failures.push('League fixture search loader is missing');
if (!app.includes('data.matches || []')) failures.push('Client does not hydrate server-side league matches');
if (!fs.existsSync('test/interaction-safety.test.js')) failures.push('Missing interaction-safety regression test');
if (!app.includes('analysisActionPending: false')) failures.push('Analysis duplicate-submit guard is missing');
if (!app.includes('matchCenterRequestSeq: 0')) failures.push('Match-center stale-response guard is missing');
if (!app.includes('favoriteMutations: new Set()')) failures.push('Favorite mutation guard is missing');
if (!app.includes('reminderMutations: new Set()')) failures.push('Reminder mutation guard is missing');
if (!fs.existsSync('test/quick-reminder-onboarding.test.js')) failures.push('Missing RC44 quick-reminder/onboarding regression test');
if (!fs.existsSync('test/main-screen-focus.test.js')) failures.push('Missing RC44 focused-home regression test');
if (!fs.existsSync('test/ai-instructor-bot.test.js')) failures.push('Missing RC44 AI-instructor/bot regression test');
if (!fs.existsSync('test/ai-instructor-rc41.test.js')) failures.push('Missing RC41 AI-intelligence regression test');
if (!fs.existsSync('test/live-ai-rc44.test.js')) failures.push('Missing RC44 AI LIVE regression test');
if (!fs.existsSync('test/ai-experience-rc45.test.js')) failures.push('Missing RC45 ranking/bot regression test');
if (!fs.existsSync('test/ai-instructor-rc46.test.js')) failures.push('Missing RC46 AI trust/intent regression test');
if (!fs.existsSync('test/telegram-button-ui-rc47.test.js')) failures.push('Missing RC47 Telegram button-first regression test');
if (!fs.existsSync('test/telegram-inline-ai-rc48.test.js')) failures.push('Missing RC48 Telegram inline-AI regression test');
if (!fs.existsSync('test/public-product-rc49.test.js')) failures.push('Missing RC49 public-product regression test');
if (!fs.existsSync('test/fm-ai-news-rc50.test.js')) failures.push('Missing RC50 FM AI News regression test');
if (!fs.existsSync('test/media-launch-ux-rc51.test.js')) failures.push('Missing RC51 media-launch UX regression test');
if (!fs.existsSync('test/media-launch-hardening-rc52.test.js')) failures.push('Missing RC52 media-launch hardening regression test');
if (!fs.existsSync('test/media-launch-package-rc53.test.js')) failures.push('Missing RC53 media-launch package regression test');
if (!fs.existsSync('test/launch-conversion-rc54.test.js')) failures.push('Missing RC54 launch conversion regression test');
if (!fs.existsSync('test/launch-search-quality-rc55.test.js')) failures.push('Missing RC55 search-quality regression test');
if (!fs.existsSync('test/match-discovery-rc56.test.js')) failures.push('Missing RC56 match-discovery regression test');
if (!fs.existsSync('test/match-selection-rc57.test.js')) failures.push('Missing RC57 match-selection regression test');
if (!fs.existsSync('test/one-tap-ai-handoff-rc58.test.js')) failures.push('Missing RC58 one-tap handoff regression test');
if (!fs.existsSync('test/ai-freshness-rc59.test.js')) failures.push('Missing RC59 AI freshness regression test');
if (!fs.existsSync('test/pre-kickoff-delta-rc60.test.js')) failures.push('Missing RC60 pre-kickoff delta regression test');
if (!fs.existsSync('test/kickoff-handoff-rc61.test.js')) failures.push('Missing RC61 kickoff handoff regression test');
if (!fs.existsSync('test/post-match-review-rc62.test.js')) failures.push('Missing RC62 post-match review regression test');
if (!fs.existsSync('test/post-match-return-rc63.test.js')) failures.push('Missing RC63 post-match return regression test');
if (!fs.existsSync('test/ai-track-record-rc64.test.js')) failures.push('Missing RC64 AI track record regression test');
if (!fs.existsSync('test/media-share-deeplink-rc65.test.js')) failures.push('Missing RC65 media share regression test');
if (!fs.existsSync('test/media-traffic-guard-rc66.test.js')) failures.push('Missing RC66 media traffic guard regression test');
if (!fs.existsSync('test/media-publisher-kit-rc67.test.js')) failures.push('Missing RC67 media publisher regression test');
if (!fs.existsSync('test/ai-instructor-rc43.test.js')) failures.push('Missing RC43 persistent-AI regression test');
if (!fs.existsSync('test/ai-instructor-rc42.test.js')) failures.push('Missing RC42 referee/AI-focus regression test');
if (!worker.includes('function loadRefereeHistoryProfile')) failures.push('RC44 referee history loader is missing');
if (!worker.includes('saveRefereeMatchHistory')) failures.push('RC44 referee history collector is missing');
if (!app.includes('function renderAiFocus')) failures.push('RC44 AI focus card is missing');
if (!worker.includes("verifiedRefereeHistory: 'enabled'") || !worker.includes("aiFocusOfDay: 'enabled'")) failures.push('RC44 health contract is missing');
if (!worker.includes('function buildLineupImpact')) failures.push('RC44 lineup impact engine is missing');
if (!worker.includes('function marketMovementNote')) failures.push('RC44 market movement explanation is missing');
if (!worker.includes('processDailyDigests')) failures.push('RC44 daily bot digest is missing');
if (!worker.includes("aiTenSecondVerdict: 'enabled'") || !worker.includes("dailyBotDigest: 'enabled'")) failures.push('RC44 AI health contract is missing');
if (!worker.includes('function buildAiInstructor')) failures.push('AI football instructor engine is missing');
if (!worker.includes("referee: fixture.fixture?.referee || ''")) failures.push('Pre-match referee context is missing');
if (!app.includes('function aiInstructorHtml')) failures.push('AI instructor UI is missing');
if (!html.includes('FM AI') || !html.includes('AI ФУТБОЛЬНЫЙ ИНСТРУКТОР') || !html.includes('boot-feature-row')) failures.push('AI startup experience is missing');
if (!worker.includes("telegramBotHub: 'enabled'") || !worker.includes("aiFootballInstructor: 'enabled'")) failures.push('RC44 AI/bot health contract is missing');
if (!html.includes('id="dailyOverviewKicker"')) failures.push('Contextual overview kicker is missing');
if (!html.includes('id="quotaText" hidden')) failures.push('Main-screen quota must be hidden by default');
if (!worker.includes("focusedMatchHome: 'enabled'") || !worker.includes("contextualLeagueFilter: 'enabled'")) failures.push('RC44 focused-home health contract is missing');
if (!html.includes('id="firstRunGuide"') || !html.includes('id="firstRunGuideDismiss"')) failures.push('First-run guide markup is missing');
if (!app.includes('data-quick-reminder')) failures.push('Quick reminder action is missing from match cards');
if (!worker.includes("quickMatchReminders: 'enabled'") || !worker.includes("firstRunGuide: 'enabled'")) failures.push('RC44 health contract is missing');
if (!app.includes('profileStale: false')) failures.push('Profile fail-soft state is missing');
if (!fs.existsSync('test/entity-state-safety.test.js')) failures.push('Missing entity-state safety regression test');
if (!app.includes('teamHubRequestSeq: 0')) failures.push('Team hub stale-response guard is missing');
if (!app.includes('tournamentStandingsRequestSeq: 0')) failures.push('Tournament standings stale-response guard is missing');
if (!app.includes("favoritesLoading: false")) failures.push('Favorites explicit loading state is missing');
if (!app.includes("remindersLoading: false")) failures.push('Reminders explicit loading state is missing');
if (!fs.existsSync('test/personal-data-write-consistency.test.js')) failures.push('Missing personal-data write consistency regression test');
if (!app.includes('favoritesRevision: 0')) failures.push('Favorites read/write revision guard is missing');
if (!app.includes('remindersRevision: 0')) failures.push('Reminders read/write revision guard is missing');
if (!worker.includes('function publicReminder')) failures.push('Reminder write response must expose the normalized reminder item');
if (!fs.existsSync('test/analysis-history-transition.test.js')) failures.push('Missing analysis/history transition regression test');
if (!app.includes('historyOpenRequestSeq: 0')) failures.push('History-open stale response guard is missing');
if (!app.includes('historyRevision: 0')) failures.push('History read/write revision guard is missing');
if (!app.includes('void Promise.allSettled([loadHistory(false), loadReminders()])')) failures.push('Analysis result must not wait for secondary history/reminder refresh');
if (app.includes('state.currentAnalysis = data;\n    if (isAdmin()')) failures.push('analyzeMatch must let renderAnalysis compare the previous fixture before assignment');
if (!fs.existsSync('test/russian-ui-localization.test.js')) failures.push('Missing Russian UI localization regression test');
if (!html.includes('id="quotaFeatureSkipped"') || html.includes('quotaFeatureПропущено')) failures.push('Provider skipped-counter DOM id is inconsistent');
if (!app.includes('function humanizeTechnicalText(value)')) failures.push('Admin technical-text localization helper is missing');
if (!app.includes("const assetVersion = CLIENT_VERSION.split('-')[0]")) failures.push('Client contract smoke must derive the current asset version dynamically');
if (app.includes('6.14.0-rc22') || worker.includes('6.14.0-rc22')) failures.push('Stale RC22 release checks remain');
if (!worker.includes("russianUiLocalization: 'enabled'")) failures.push('Russian UI localization health contract is missing');
if (!worker.includes("adminRussianLocalization: 'enabled'")) failures.push('Admin Russian localization health contract is missing');
if (!worker.includes("prematchRussianLocalization: 'enabled'")) failures.push('Prematch Russian localization health contract is missing');
if (!worker.includes("dynamicRussianLocalization: 'enabled'")) failures.push('Dynamic Russian localization health contract is missing');
if (!worker.includes("adminTextHumanization: 'enabled'")) failures.push('Admin text humanization health contract is missing');
if (!worker.includes("matchCenterRussianLocalization: 'enabled'")) failures.push('Match-center Russian localization health contract is missing');

const migration = fs.readFileSync('supabase/migrations/supabase_migration_v6_10.sql', 'utf8');
if (!migration.includes('transition_model_calibration')) failures.push('Missing atomic calibration transition RPC');
if (!migration.includes('alter table public.model_calibration_validations enable row level security')) failures.push('Missing validation-table RLS remediation');

const securityMigration = fs.readFileSync('supabase/migrations/supabase_migration_v6_11.sql', 'utf8');
if (!securityMigration.includes('backend_security_contract')) failures.push('Missing backend security contract RPC');
if (!securityMigration.includes('revoke all privileges on all tables in schema public')) failures.push('Missing backend-table privilege lockdown');

const defaultAclMigration = fs.readFileSync('supabase/migrations/supabase_migration_v6_11_1.sql', 'utf8');
if (!defaultAclMigration.includes('application_owners')) failures.push('Missing application-owner default ACL audit');
if (!defaultAclMigration.includes('backend_default_acl_contract')) failures.push('Missing default ACL security contract RPC');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Release metadata is consistent for ${expected}.`);

if (!worker.includes("persistentAiVerdicts: 'enabled'") || !worker.includes("analyzedMatchHub: 'enabled'")) failures.push('RC44 persistent AI health contract is missing');
if (!worker.includes("historyAnalysisCacheFix: 'enabled'") || !worker.includes("fixture:${fixtureId}:v10-ai-instructor")) failures.push('RC44 history cache contract is missing');
if (!app.includes('function renderAiCenterSummary') || !app.includes('matchAiSnapshotHtml')) failures.push('RC44 analyzed-match UI is missing');

if (!worker.includes("aiLiveCoach: 'enabled'") || !worker.includes("prematchLiveComparison: 'enabled'") || !worker.includes("liveScenarioGuard: 'enabled'")) failures.push('RC44 AI LIVE health contract is missing');
if (!worker.includes('function buildLiveAiCoach') || !worker.includes('v10-ai-live-coach')) failures.push('RC44 AI LIVE engine/cache is missing');
if (!app.includes('function liveAiCoachHtml') || !app.includes('d.liveAiCoach')) failures.push('RC44 AI LIVE interface is missing');

if (!worker.includes("aiMatchRanking: 'enabled'") || !worker.includes("analyzedSkipLane: 'enabled'")) failures.push('RC45 AI ranking contract is missing');
if (!worker.includes("botNaturalFootballSearch: 'enabled'") || !worker.includes("botFixtureDeepLinks: 'enabled'")) failures.push('RC45 bot search contract is missing');
if (!worker.includes('function sendBotFootballSearch') || !worker.includes('function botSearchParts')) failures.push('RC45 natural bot search is missing');
if (!app.includes('AI-РЕЙТИНГ ДНЯ') || !app.includes('openLaunchFixture')) failures.push('RC45 ranked home/deep-link UI is missing');

if (!worker.includes("aiDataTrust: 'enabled'") || !worker.includes("aiMatchPlan: 'enabled'")) failures.push('RC46 AI trust/plan contract is missing');
if (!worker.includes("botFootballIntentUnderstanding: 'enabled'") || !worker.includes("botAskCommand: 'enabled'")) failures.push('RC46 bot intent contract is missing');
if (!worker.includes('function botIntentLead') || !worker.includes('function botSearchParts')) failures.push('RC46 natural football question handling is missing');
if (!app.includes('AI-ПЛАН ДО СТАРТОВОГО СВИСТКА') || !app.includes('Качество данных')) failures.push('RC46 AI match-plan UI is missing');

if (!worker.includes("botPersistentKeyboard: 'enabled'") || !worker.includes("botMatchActionButtons: 'enabled'")) failures.push('RC47 Telegram button UI contract is missing');
if (!worker.includes("botSlashMenuHidden: 'enabled'") || !worker.includes("botProfileBranding: 'enabled'")) failures.push('RC47 Telegram branding contract is missing');
if (!worker.includes("commands: []") || !worker.includes("is_persistent: true")) failures.push('RC47 slash-menu removal/persistent keyboard is missing');
if (!worker.includes('footballMatchActionKeyboard') || !app.includes("params.get('tab')")) failures.push('RC47 match action deep-link contract is missing');

if (!worker.includes("botInlineAiVerdict: 'enabled'") || !worker.includes("botInlineMatchSections: 'enabled'")) failures.push('RC48 inline Telegram AI contract is missing');
if (!worker.includes("botCachedAnalysisReuse: 'enabled'") || !worker.includes("botMatchCardCallbacks: 'enabled'")) failures.push('RC48 cached Telegram analysis contract is missing');
if (!worker.includes('function botAiVerdictText') || !worker.includes('function sendBotFixtureSection')) failures.push('RC48 Telegram verdict renderer is missing');
if (!worker.includes("callback_data: `match:verdict:") || !worker.includes("callback_data:`match:menu:")) failures.push('RC48 match callbacks are missing');

if (!worker.includes("globalTopClubSearch: 'enabled'") || !worker.includes('TOP_TEAM_SEARCH_CATALOG')) failures.push('RC49 global top-club search contract is missing');
if (!worker.includes('topTeamSearchPlan') || !worker.includes("v2-global")) failures.push('RC49 canonical team-search plan is missing');
if (!worker.includes("botContentFirstNavigation: 'enabled'") || !worker.includes('sendBotDayMatches') || !worker.includes('sendBotFavoriteTeams')) failures.push('RC49 chat content navigation is missing');
if (!html.includes('class="miniapp-ai-only"') || !app.includes("const MINIAPP_PRODUCT_MODE = 'ai-analysis-only'")) failures.push('RC49 AI-only Mini App shell is missing');
if (!html.includes('id="navMatches"') || !html.includes('id="navProfile"') || !html.includes('id="navSearch" class="nav-item active"')) failures.push('RC49 minimal navigation contract is missing');

if (!worker.includes("fmAiNews: 'enabled'") || !worker.includes("newsSourceLinks: 'enabled'")) failures.push('RC50 FM AI News health contract is missing');
if (!worker.includes('tavilyNewsSearch') || !worker.includes("topic:'news'")) failures.push('RC50 news provider route is missing');
if (!worker.includes('footballNewsCategory') || !worker.includes('footballNewsImpactText')) failures.push('RC50 news classification/impact contract is missing');
if (!worker.includes('sendFavoriteTeamNews') || !worker.includes('currentMorningFootballNews')) failures.push('RC50 personalized/morning news flows are missing');
if (!worker.includes("newsMiniAppSeparation: 'enabled'") || html.includes('id="newsView"')) failures.push('RC50 news must stay out of the Mini App shell');

if (!worker.includes("publicTelegramOnboarding: 'enabled'") || !worker.includes("mediaLaunchUx: 'enabled'")) failures.push('RC51 public onboarding health contract is missing');
if (!worker.includes('favoriteMatchTeamRow') || !worker.includes('favorite:toggle:')) failures.push('RC51 inline favorites are missing');
if (!worker.includes('editMessageReplyMarkup') || !worker.includes('toggleBotFavorite')) failures.push('RC51 in-place favorite UX is missing');
if (!worker.includes('FM AI · MATCH') || !worker.includes("brandedMatchCards: 'enabled'")) failures.push('RC51 branded match card is missing');
if (!worker.includes("telegramSearchAliasParity: 'enabled'") || !worker.includes("Number(plan.best?.score || 0) < 280")) failures.push('RC51 short Telegram alias parity is missing');

if (!worker.includes("mediaLaunchHardening: 'enabled'") || !worker.includes("telegramWebhookDedupe: 'enabled'") || !worker.includes("telegramWebhookBurstGuard: 'enabled'")) failures.push('RC52 webhook hardening contract is missing');
if (!worker.includes("newsSourceTrustGate: 'enabled'") || !worker.includes('applyNewsTrustGate') || !worker.includes('newsSourceTrust')) failures.push('RC52 news trust gate is missing');
if (!worker.includes("publicLegalPages: 'enabled'") || !worker.includes("publicStatusPage: 'enabled'") || !worker.includes("url.pathname === '/api/public-status'")) failures.push('RC52 public trust contract is missing');
if (!fs.existsSync('public/privacy.html') || !fs.existsSync('public/terms.html') || !fs.existsSync('public/status.html') || !fs.existsSync('public/status.js')) failures.push('RC52 public trust pages are missing');
if (!wrangler.includes('"/telegram/*"') || !wrangler.includes('"/api/*"')) failures.push('RC52 Worker-first webhook/public API routes are missing');
if (!deployWorkflow.includes('6.95.0-rc103')) failures.push('RC103 production workflow version is missing');

if (!worker.includes("mediaLaunchPackage: 'enabled'") || !worker.includes("mediaDeepLinkAttribution: 'enabled'")) failures.push('RC53 media launch health contract is missing');
if (!worker.includes("launchSimulation: 'enabled'") || !worker.includes("conversionUx: 'enabled'") || !worker.includes("highIntentSearchFallback: 'enabled'") || !worker.includes("newsReturnLoop: 'enabled'")) failures.push('RC54 launch conversion health contract is missing');
if (!worker.includes("realLaunchDrill: 'enabled'") || !worker.includes("searchNormalization: 'enabled'") || !worker.includes("searchOutcomeAnalytics: 'enabled'") || !worker.includes("searchRetryUx: 'enabled'") || !worker.includes("searchQualitySelfTest: searchQualityDrill().pass ? 'enabled' : 'failed'")) failures.push('RC55 search quality health contract is missing');
if (!worker.includes("zeroResultRecovery: 'enabled'") || !worker.includes("teamFixtureDiscovery: 'enabled'") || !worker.includes("sharedFixtureDiscoveryCache: 'enabled'") || !worker.includes("extendedTeamCalendar: 'enabled'") || !worker.includes("recentMatchFallback: 'enabled'")) failures.push('RC56 match discovery health contract is missing');
if (!worker.includes("matchSelectionIntelligence: 'enabled'") || !worker.includes("primaryMatchRecommendation: 'enabled'") || !worker.includes("officialMatchPriority: 'enabled'") || !worker.includes("selectionReasonUx: 'enabled'") || !worker.includes("matchSelectionSelfTest: matchSelectionDrill().pass ? 'enabled' : 'failed'")) failures.push('RC57 match selection health contract is missing');
if (!worker.includes("oneTapAiHandoff: 'enabled'") || !worker.includes("telegramAutoQuickBrief: 'enabled'") || !worker.includes("cachedFullAnalysisHandoff: 'enabled'") || !worker.includes("directFixtureDeepLink: 'enabled'") || !worker.includes("handoffFunnelTracking: 'enabled'") || !worker.includes("oneTapHandoffSelfTest: oneTapHandoffDrill().pass ? 'enabled' : 'failed'")) failures.push('RC58 one-tap AI handoff health contract is missing');
if (!worker.includes("aiFreshnessGuard: 'enabled'") || !worker.includes("preKickoffRecheck: 'enabled'") || !worker.includes("userScopedFreeRecheck: 'enabled'") || !worker.includes("lineupFreshnessWindow: 'enabled'") || !worker.includes("adaptiveAnalysisTtl: 'enabled'") || !worker.includes("analysisFreshnessSelfTest: analysisFreshnessDrill().pass ? 'enabled' : 'failed'")) failures.push('RC59 AI freshness health contract is missing');
if (!worker.includes("preKickoffChangeDetection: 'enabled'") || !worker.includes("analysisDeltaSummary: 'enabled'") || !worker.includes("recheckMateriality: 'enabled'") || !worker.includes("telegramRecheckDelta: 'enabled'") || !worker.includes("analysisDeltaSelfTest: analysisDeltaDrill().pass ? 'enabled' : 'failed'")) failures.push('RC60 pre-kickoff delta health contract is missing');
if (!worker.includes("kickoffHandoffGuard: 'enabled'") || !worker.includes("prematchAdviceFreeze: 'enabled'") || !worker.includes("liveContextHandoff: 'enabled'") || !worker.includes("finishedAnalysisArchive: 'enabled'") || !worker.includes("kickoffHandoffSelfTest: analysisKickoffHandoffDrill().pass ? 'enabled' : 'failed'")) failures.push('RC61 kickoff handoff health contract is missing');
if (!worker.includes("postMatchAiReview: 'enabled'") || !worker.includes("immutablePrematchComparison: 'enabled'") || !worker.includes("calibrationFeedbackReview: 'enabled'") || !worker.includes("telegramPostMatchReview: 'enabled'") || !worker.includes("postMatchReviewSelfTest: postMatchReviewDrill().pass ? 'enabled' : 'failed'")) failures.push('RC62 post-match review health contract is missing');
if (!worker.includes("postMatchReturnLoop: 'enabled'") || !worker.includes("analyzedMatchReturn: 'enabled'") || !worker.includes("postMatchReturnDedupe: 'enabled'") || !worker.includes("postMatchReturnOptOut: 'enabled'") || !worker.includes("postMatchReturnQuotaGuard: 'enabled'") || !worker.includes("postMatchReturnSelfTest: postMatchReturnDrill().pass ? 'enabled' : 'failed'")) failures.push('RC63 post-match return health contract is missing');
if (!worker.includes("publicAiTrackRecord: 'enabled'") || !worker.includes("verifiedTrackRecordOnly: 'enabled'") || !worker.includes("smallSampleTrustGuard: 'enabled'") || !worker.includes("noWinRateTrustUx: 'enabled'") || !worker.includes("telegramAiTrackRecord: 'enabled'") || !worker.includes("aiTrackRecordSelfTest: publicAiTrackRecordDrill().pass ? 'enabled' : 'failed'")) failures.push('RC64 AI track record health contract is missing');
if (!worker.includes("mediaFixtureDeepLinks: 'enabled'") || !worker.includes("shareableMatchCards: 'enabled'") || !worker.includes("shareAttribution: 'enabled'") || !worker.includes("deepLinkAutoAnalysis: 'enabled'") || !worker.includes("telegramNativeShare: 'enabled'") || !worker.includes("fixtureDeepLinkSelfTest: fixtureDeepLinkDrill().pass ? 'enabled' : 'failed'")) failures.push('RC65 media share health contract is missing');
if (!worker.includes("distributedAnalysisLock: 'enabled'") || !worker.includes("viralFixtureCollapse: 'enabled'") || !worker.includes("crossInstanceAnalysisDedupe: 'enabled'") || !worker.includes("analysisLockFailOpen: 'enabled'") || !worker.includes("sharedAnalysisWaitFallback: 'enabled'") || !worker.includes("distributedAnalysisLockSelfTest: distributedAnalysisLockDrill().pass ? 'enabled' : 'failed'")) failures.push('RC66 media traffic guard health contract is missing');
if (!worker.includes("mediaPublisherKit: 'enabled'") || !worker.includes("campaignTaggedFixtureLinks: 'enabled'") || !worker.includes("mediaCopyGenerator: 'enabled'") || !worker.includes("adminPublisherOnly: 'enabled'") || !worker.includes("mediaPublisherSelfTest: mediaPublisherDrill().pass ? 'enabled' : 'failed'")) failures.push('RC67 media publisher health contract is missing');
if (!worker.includes("mediaCampaignControlRoom: 'enabled'") || !worker.includes("contentLevelMediaAttribution: 'enabled'") || !worker.includes("mediaCampaignConversion: 'enabled'") || !worker.includes("publisherOutcomeTracking: 'enabled'") || !worker.includes("mediaCampaignControlSelfTest: mediaCampaignControlDrill().pass ? 'enabled' : 'failed'")) failures.push('RC68 media campaign control health contract is missing');
if (!worker.includes('buildMediaCampaignPerformance') || !app.includes('launchFunnelMediaCampaigns') || !html.includes('id="launchFunnelMediaCampaigns"')) failures.push('RC68 media campaign analytics UI contract is missing');
if (!fs.existsSync('test/media-campaign-control-rc68.test.js')) failures.push('Missing RC68 media campaign regression test');
if (!worker.includes("telegramNewsConversionEngine: 'enabled'") || !worker.includes("newsPerItemAiCta: 'enabled'") || !worker.includes("newsTeamIntentResolution: 'enabled'") || !worker.includes("newsConversionTracking: 'enabled'") || !worker.includes("newsConversionSelfTest: newsConversionDrill().pass ? 'enabled' : 'failed'")) failures.push('RC69 Telegram news conversion health contract is missing');
if (!worker.includes('function newsTeamHint') || !worker.includes('function newsConversionKeyboard') || !worker.includes("eventName:'news_ai_intent'")) failures.push('RC69 news conversion engine is missing');
if (!app.includes('Новости → AI') || !fs.existsSync('test/telegram-news-conversion-rc69.test.js')) failures.push('RC69 news conversion analytics or regression test is missing');
if (!worker.includes("smartNewsFixtureLinking: 'enabled'") || !worker.includes("newsTimeRelevanceGuard: 'enabled'") || !worker.includes("perNewsFixtureCta: 'enabled'") || !worker.includes("newsImpactDeltaGuide: 'enabled'") || !worker.includes("smartNewsLinkSelfTest: smartNewsMatchLinkDrill().pass ? 'enabled' : 'failed'")) failures.push('RC70 smart news match linking health contract is missing');
if (!worker.includes('function newsFixtureRelevance') || !worker.includes('function newsRelevantFixture') || !worker.includes('function newsFixtureChangeGuide') || !worker.includes("linking:'smart_fixture'")) failures.push('RC70 smart news fixture linker is missing');
if (!app.includes('smart fixture') || !fs.existsSync('test/smart-news-match-linking-rc70.test.js')) failures.push('RC70 smart news analytics or regression test is missing');
if (!worker.includes("newsImpactDelta: 'enabled'") || !worker.includes("preNewsSnapshotGuard: 'enabled'") || !worker.includes("explicitNewsRecheck: 'enabled'") || !worker.includes("newsImpactMateriality: 'enabled'") || !worker.includes("newsImpactDeltaSelfTest: newsImpactDeltaDrill().pass ? 'enabled' : 'failed'")) failures.push('RC71 news impact delta health contract is missing');
if (!worker.includes('function newsImpactDeltaStatus') || !worker.includes('newsImpactRecheck') || !worker.includes("eventName:'news_impact_delta'") || !worker.includes('News Impact Delta')) failures.push('RC71 news impact delta engine is missing');
if (!app.includes('News Impact:') || !fs.existsSync('test/news-impact-delta-rc71.test.js')) failures.push('RC71 news impact analytics or regression test is missing');
if (!worker.includes("newsImpactDecisionCard: 'enabled'") || !worker.includes("newsImpactActionRouting: 'enabled'") || !worker.includes("newsImpactCausalityGuardUx: 'enabled'") || !worker.includes("newsImpactDecisionAnalytics: 'enabled'") || !worker.includes("newsImpactDecisionSelfTest: newsImpactDecisionDrill().pass ? 'enabled' : 'failed'")) failures.push('RC72 news impact decision health contract is missing');
if (!worker.includes('function newsImpactDecisionCard') || !worker.includes('function newsImpactDecisionKeyboard') || !worker.includes("decision:String(decision?.code || '')")) failures.push('RC72 decision card engine is missing');
if (!app.includes('решения:') || !fs.existsSync('test/news-impact-decision-card-rc72.test.js')) failures.push('RC72 decision analytics or regression test is missing');
if (!worker.includes("newsImpactActionTracking: 'enabled'") || !worker.includes("newsImpactActionAttribution: 'enabled'") || !worker.includes("newsImpactActionAnalytics: 'enabled'") || !worker.includes("newsImpactActionSelfTest: newsImpactActionDrill().pass ? 'enabled' : 'failed'")) failures.push('RC73 News Impact action health contract is missing');
if (!worker.includes('function newsImpactActionCallback') || !worker.includes('function newsImpactTrackedAnalysisUrl') || !worker.includes("eventName:'news_impact_action'") || !worker.includes('const newsImpactActionSummary=')) failures.push('RC73 News Impact action engine is missing');
if (!app.includes('const impactActions=d.newsImpactActionSummary || {}') || !app.includes('действия: полный AI') || !fs.existsSync('test/news-impact-action-tracking-rc73.test.js')) failures.push('RC73 action analytics or regression test is missing');
if (!worker.includes("newsImpactActionFunnel: 'enabled'") || !worker.includes("newsImpactDecisionConversion: 'enabled'") || !worker.includes("newsImpactActionBottleneck: 'enabled'") || !worker.includes("newsImpactActionFunnelSelfTest: newsImpactActionFunnelDrill().pass ? 'enabled' : 'failed'")) failures.push('RC74 News Impact action funnel health contract is missing');
if (!worker.includes('function buildNewsImpactActionFunnel') || !worker.includes('function newsImpactActionFunnelBottleneck') || !worker.includes('const newsImpactActionFunnel=') || !worker.includes('newsImpactActionBottleneck,')) failures.push('RC74 News Impact action funnel engine is missing');
if (!app.includes('const impactFunnel=Array.isArray(d.newsImpactActionFunnel)') || !app.includes('News Impact → действие') || !app.includes('самая низкая конверсия') || !fs.existsSync('test/news-impact-action-funnel-rc74.test.js')) failures.push('RC74 action funnel UI or regression test is missing');
if (!worker.includes("newsImpactFunnelConfidenceGuard: 'enabled'") || !worker.includes("newsImpactWilsonInterval: 'enabled'") || !worker.includes("newsImpactSampleGate: 'enabled'") || !worker.includes("newsImpactFunnelConfidenceSelfTest: newsImpactFunnelConfidenceDrill().pass ? 'enabled' : 'failed'")) failures.push('RC75 funnel confidence health contract is missing');
if (!worker.includes('function newsImpactConversionConfidence') || !worker.includes('NEWS_IMPACT_FUNNEL_MIN_USERS = 10') || !worker.includes("interval:'wilson_95'") || !worker.includes('confidence:new') && !worker.includes('const confidence=newsImpactConversionConfidence')) failures.push('RC75 confidence engine is missing');
if (!app.includes('const impactConfidenceGuard=d.newsImpactActionConfidenceGuard') || !app.includes('95% ДИ') || !app.includes('данных пока мало для определения узкого места') || !fs.existsSync('test/news-impact-funnel-confidence-rc75.test.js')) failures.push('RC75 confidence UI or regression test is missing');
if (!worker.includes("newsImpactFunnelTrend: 'enabled'") || !worker.includes("newsImpactPeriodComparison: 'enabled'") || !worker.includes("newsImpactTrendSignificanceGuard: 'enabled'") || !worker.includes("newsImpactActionTrendSelfTest: newsImpactActionTrendDrill().pass ? 'enabled' : 'failed'")) failures.push('RC76 funnel trend health contract is missing');
if (!worker.includes('function newsImpactTrendSignal') || !worker.includes('function buildNewsImpactActionTrend') || !worker.includes("signalRule:'non_overlapping_wilson_95'") || !worker.includes('previousWindowRows')) failures.push('RC76 trend engine is missing');
if (!app.includes('const impactTrend=Array.isArray(d.newsImpactActionTrend)') || !app.includes('Динамика News Impact') || !app.includes('подтверждённый рост') || !fs.existsSync('test/news-impact-funnel-trend-rc76.test.js')) failures.push('RC76 trend UI or regression test is missing');
if (!worker.includes("newsImpactTemporalAttribution: 'enabled'") || !worker.includes("newsImpactActionWindowGuard: 'enabled'") || !worker.includes("newsImpactMaturityGuard: 'enabled'") || !worker.includes("newsImpactBoundaryAttribution: 'enabled'") || !worker.includes("newsImpactTemporalAttributionSelfTest: newsImpactTemporalAttributionDrill().pass ? 'enabled' : 'failed'")) failures.push('RC77 temporal attribution health contract is missing');
if (!worker.includes('NEWS_IMPACT_ACTION_WINDOW_MINUTES = 30') || !worker.includes('function newsImpactEventTime') || !worker.includes('actionAt>=decisionAt && actionAt<=decisionAt+actionWindowMs') || !worker.includes('previousNewsImpactActionRows=comparisonRows.filter')) failures.push('RC77 temporal attribution engine is missing');
if (!app.includes('const impactAttributionGuard=d.newsImpactActionAttributionGuard') || !app.includes('Атрибуция действий') || !app.includes('свежих решений ещё не вошли') || !fs.existsSync('test/news-impact-temporal-attribution-rc77.test.js')) failures.push('RC77 temporal attribution UI or regression test is missing');
if (!worker.includes("newsImpactActionOutcomeTracking: 'enabled'") || !worker.includes("newsImpactOutcomeTemporalGuard: 'enabled'") || !worker.includes("newsImpactOutcomeQualityAnalytics: 'enabled'") || !worker.includes("newsImpactOutcomeMeaningGuard: 'enabled'") || !worker.includes("newsImpactOutcomeQualitySelfTest: newsImpactOutcomeQualityDrill().pass ? 'enabled' : 'failed'")) failures.push('RC78 outcome quality health contract is missing');
if (!worker.includes("eventName:'news_impact_outcome'") || !worker.includes('function buildNewsImpactActionOutcomeQuality') || !worker.includes('function newsImpactOutcomeBottleneck') || !worker.includes("meaning:'confirmed_delivery_not_satisfaction'")) failures.push('RC78 outcome quality engine is missing');
if (!app.includes('const impactOutcomeQuality=Array.isArray(d.newsImpactActionOutcomeQuality)') || !app.includes('News Impact: действие → результат') || !app.includes('не оценка удовлетворённости пользователя') || !fs.existsSync('test/news-impact-action-outcome-quality-rc78.test.js')) failures.push('RC78 outcome quality UI or regression test is missing');
if (!worker.includes("newsImpactOutcomeFailureTracking: 'enabled'") || !worker.includes("newsImpactFailureTaxonomy: 'enabled'") || !worker.includes("newsImpactRecoveryUx: 'enabled'") || !worker.includes("newsImpactFailurePrivacyGuard: 'enabled'") || !worker.includes("newsImpactFailureDiagnosticsSelfTest: newsImpactFailureDiagnosticsDrill().pass ? 'enabled' : 'failed'")) failures.push('RC79 failure diagnostics health contract is missing');
if (!worker.includes("eventName:'news_impact_outcome_failure'") || !worker.includes('function newsImpactFailureCode') || !worker.includes('function newsImpactRecoveryForFailure') || !worker.includes('function buildNewsImpactFailureDiagnostics') || !worker.includes('rawErrorsStored:false')) failures.push('RC79 failure diagnostics engine is missing');
if (!app.includes('const impactFailureDiagnostics=Array.isArray(d.newsImpactFailureDiagnostics)') || !app.includes('News Impact: диагностика сбоев') || !app.includes('сырой текст ошибки не сохраняется') || !app.includes('e.payload?.newsImpactRecovery') || !fs.existsSync('test/news-impact-outcome-failure-recovery-rc79.test.js')) failures.push('RC79 failure diagnostics UI or regression test is missing');
if (!worker.includes("newsImpactRecoveryAttemptTracking: 'enabled'") || !worker.includes("newsImpactRecoveryEffectiveness: 'enabled'") || !worker.includes("newsImpactRecoveryMaturityGuard: 'enabled'") || !worker.includes("newsImpactRecoverySampleGuard: 'enabled'") || !worker.includes("newsImpactRecoveryEffectivenessSelfTest: newsImpactRecoveryEffectivenessDrill().pass ? 'enabled' : 'failed'")) failures.push('RC80 recovery effectiveness health contract is missing');
if (!worker.includes("eventName:'news_impact_recovery_attempt'") || !worker.includes('function buildNewsImpactRecoveryEffectiveness') || !worker.includes('function newsImpactRecoveryBest') || !worker.includes("meaning:'confirmed_delivery_after_real_recovery_attempt'")) failures.push('RC80 recovery effectiveness engine is missing');
if (!worker.includes('function newsImpactRecoveryCallback') || !worker.includes('newsImpactRecoveryCode') || !app.includes('newsImpactRecoveryCode:String(options.newsImpactRecoveryCode') || !app.includes('Recovery → подтверждённый результат') || !fs.existsSync('test/news-impact-recovery-effectiveness-rc80.test.js')) failures.push('RC80 recovery attribution UI or regression test is missing');
if (!worker.includes("newsImpactRecoveryStrategyGuard: 'enabled'") || !worker.includes("newsImpactAdaptiveRecovery: 'enabled'") || !worker.includes("newsImpactFixedFallbackGuard: 'enabled'") || !worker.includes("newsImpactRecoveryStrategyCache: 'enabled'") || !worker.includes("newsImpactRecoveryStrategySelfTest: newsImpactRecoveryStrategyDrill().pass ? 'enabled' : 'failed'")) failures.push('RC81 recovery strategy health contract is missing');
if (!worker.includes("newsImpactRecoveryStrategyParity: 'enabled'") || !worker.includes("newsImpactRecoveryStabilityGuard: 'enabled'") || !worker.includes("newsImpactRecoveryStabilitySelfTest: newsImpactRecoveryStabilityDrill().pass ? 'enabled' : 'failed'")) failures.push('RC82 recovery stability health contract is missing');
if (!worker.includes("newsImpactRecoveryDriftGuard: 'enabled'") || !worker.includes("newsImpactRecoveryDriftAudit: 'enabled'") || !worker.includes("newsImpactRecoveryDriftSelfTest: newsImpactRecoveryDriftDrill().pass ? 'enabled' : 'failed'")) failures.push('RC83 recovery drift health contract is missing');
if (!worker.includes("newsImpactRecoveryTransitionHistory: 'enabled'") || !worker.includes("newsImpactRecoveryAdminAlerts: 'enabled'") || !worker.includes("newsImpactRecoveryTransitionPrivacyGuard: 'enabled'") || !worker.includes("newsImpactRecoveryTransitionSelfTest: newsImpactRecoveryTransitionDrill().pass ? 'enabled' : 'failed'")) failures.push('RC84 recovery transition health contract is missing');
if (!worker.includes("newsImpactRecoveryIncidentCenter: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentLifecycle: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentPrivacyGuard: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentSelfTest: newsImpactRecoveryIncidentDrill().pass ? 'enabled' : 'failed'")) failures.push('RC85 recovery incident health contract is missing');
if (!worker.includes("newsImpactRecoveryIncidentAcknowledgement: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentRunbook: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentAlertSuppression: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentAckPrivacyGuard: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentAckSelfTest: newsImpactRecoveryIncidentAckDrill().pass ? 'enabled' : 'failed'")) failures.push('RC86 recovery incident acknowledgement health contract is missing');
if (!worker.includes("newsImpactRecoveryIncidentSlo: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentEscalation: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentLatencyMetrics: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentSloSelfTest: newsImpactRecoveryIncidentSloDrill().pass ? 'enabled' : 'failed'")) failures.push('RC87 recovery incident SLO health contract is missing');
if (!worker.includes("newsImpactRecoveryIncidentSloDashboard: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentWeeklyTrend: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentRecurrence: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentSloDashboardSelfTest: newsImpactRecoveryIncidentSloDashboardDrill().pass ? 'enabled' : 'failed'")) failures.push('RC88 recovery incident SLO dashboard health contract is missing');
if (!worker.includes("newsImpactRecoveryIncidentSloBreachFeed: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentBreachDrilldown: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentBreachPrivacyGuard: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentSloBreachFeedSelfTest: newsImpactRecoveryIncidentSloBreachFeedDrill().pass ? 'enabled' : 'failed'")) failures.push('RC89 recovery incident SLO breach feed health contract is missing');
if (!worker.includes("newsImpactRecoveryIncidentSloBreachWatchlist: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentBreachAging: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentSloBreachWatchlistSelfTest: newsImpactRecoveryIncidentSloBreachWatchlistDrill().pass ? 'enabled' : 'failed'")) failures.push('RC90 recovery incident breach watchlist health contract is missing');
if (!worker.includes("newsImpactRecoveryIncidentSloBreachTriage: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentBreachStageBuckets: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentSloBreachTriageSelfTest: newsImpactRecoveryIncidentSloBreachTriageDrill().pass ? 'enabled' : 'failed'")) failures.push('RC91 recovery incident breach triage health contract is missing');
if (!worker.includes("newsImpactRecoveryIncidentSloBreachTriageTrend: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentTriageRecurrence: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentSloBreachTriageTrendSelfTest: newsImpactRecoveryIncidentSloBreachTriageTrendDrill().pass ? 'enabled' : 'failed'")) failures.push('RC92 recovery incident triage trend health contract is missing');
if (!worker.includes("newsImpactRecoveryIncidentSloBreachImpactRanking: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentOverdueContribution: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentSloBreachImpactRankingSelfTest: newsImpactRecoveryIncidentSloBreachImpactRankingDrill().pass ? 'enabled' : 'failed'")) failures.push('RC93 recovery incident breach impact ranking health contract is missing');
if (!worker.includes("newsImpactRecoveryIncidentSloBreachImpactTrend: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentWeeklyOverdueBurden: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentSloBreachImpactTrendSelfTest: newsImpactRecoveryIncidentSloBreachImpactTrendDrill().pass ? 'enabled' : 'failed'")) failures.push('RC94 recovery incident breach impact trend health contract is missing');
if (!worker.includes("newsImpactRecoveryIncidentSloImpactConcentration: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentTopContributionShares: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentSloImpactConcentrationSelfTest: newsImpactRecoveryIncidentSloImpactConcentrationDrill().pass ? 'enabled' : 'failed'")) failures.push('RC95 recovery incident impact concentration health contract is missing');
if (!worker.includes("newsImpactRecoveryIncidentSloImpactConcentrationTrend: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentWeeklyConcentrationShares: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentSloImpactConcentrationTrendSelfTest: newsImpactRecoveryIncidentSloImpactConcentrationTrendDrill().pass ? 'enabled' : 'failed'")) failures.push('RC96 recovery incident impact concentration trend health contract is missing');
if (!worker.includes("newsImpactRecoveryIncidentSloImpactExecutiveSummary: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentSloImpactUnifiedView: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentSloImpactExecutiveSummarySelfTest: newsImpactRecoveryIncidentSloImpactExecutiveSummaryDrill().pass ? 'enabled' : 'failed'")) failures.push('RC97 recovery incident impact executive summary health contract is missing');
if (!worker.includes("newsImpactRecoveryIncidentSloImpactFocusQueue: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentSloImpactFocusOrdering: 'enabled'") || !worker.includes("newsImpactRecoveryIncidentSloImpactFocusQueueSelfTest: newsImpactRecoveryIncidentSloImpactFocusQueueDrill().pass ? 'enabled' : 'failed'")) failures.push('RC98 recovery incident impact focus queue health contract is missing');
if (!worker.includes('function buildNewsImpactRecoveryIncidentSloImpactFocusQueue') || !worker.includes('newsImpactRecoveryIncidentSloImpactFocusQueue=buildNewsImpactRecoveryIncidentSloImpactFocusQueue') || !worker.includes('newsImpactRecoveryIncidentSloImpactFocusQueue,') || !app.includes('SLO Impact Focus Queue') || !app.includes('RC98 — Focus Queue') || !fs.existsSync('test/news-impact-recovery-incident-impact-focus-queue-rc98.test.js')) failures.push('RC98 impact focus queue regression contract is missing');
if (!worker.includes('function buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary') || !worker.includes('newsImpactRecoveryIncidentSloImpactExecutiveSummary=buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary') || !worker.includes('newsImpactRecoveryIncidentSloImpactExecutiveSummary,') || !app.includes('SLO Impact Executive Summary') || !app.includes('RC97 — единая сводка') || !fs.existsSync('test/news-impact-recovery-incident-impact-executive-summary-rc97.test.js')) failures.push('RC97 impact executive summary regression contract is missing');
if (!worker.includes('function buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend') || !worker.includes('newsImpactRecoveryIncidentSloImpactConcentrationTrend=newsImpactRecoveryStrategyLoaded.available') || !worker.includes('newsImpactRecoveryIncidentSloImpactConcentrationTrend,') || !app.includes('SLO Impact Concentration Trend · 4 недели') || !app.includes('RC96 — trend') || !fs.existsSync('test/news-impact-recovery-incident-impact-concentration-trend-rc96.test.js')) failures.push('RC96 impact concentration trend regression contract is missing');
if (!worker.includes('function buildNewsImpactRecoveryIncidentSloImpactConcentration') || !worker.includes('newsImpactRecoveryIncidentSloImpactConcentration=buildNewsImpactRecoveryIncidentSloImpactConcentration') || !worker.includes('newsImpactRecoveryIncidentSloImpactConcentration,') || !app.includes('SLO Impact Concentration') || !app.includes('RC95 — концентрация') || !fs.existsSync('test/news-impact-recovery-incident-impact-concentration-rc95.test.js')) failures.push('RC95 impact concentration regression contract is missing');
if (!worker.includes('function newsImpactRecoveryIncidentOverdueWithinWindow') || !worker.includes('function buildNewsImpactRecoveryIncidentSloBreachImpactTrend') || !worker.includes('newsImpactRecoveryIncidentSloBreachImpactTrend=newsImpactRecoveryStrategyLoaded.available') || !worker.includes('newsImpactRecoveryIncidentSloBreachImpactTrend,') || !app.includes('SLO Impact Trend · 4 недели') || !app.includes('RC94 — недельный trend') || !fs.existsSync('test/news-impact-recovery-incident-impact-trend-rc94.test.js')) failures.push('RC94 breach impact trend regression contract is missing');
if (!worker.includes('function newsImpactRecoveryIncidentSloBurden') || !worker.includes('function buildNewsImpactRecoveryIncidentSloBreachImpactRanking') || !worker.includes('newsImpactRecoveryIncidentSloBreachImpactRanking=newsImpactRecoveryStrategyLoaded.available') || !worker.includes('newsImpactRecoveryIncidentSloBreachImpactRanking,') || !app.includes('SLO Breach Impact Ranking') || !app.includes('RC93 — ranking') || !fs.existsSync('test/news-impact-recovery-incident-impact-ranking-rc93.test.js')) failures.push('RC93 breach impact ranking regression contract is missing');
if (!worker.includes('function newsImpactRecoveryIncidentTriageStageAt') || !worker.includes('function buildNewsImpactRecoveryIncidentSloBreachTriageTrend') || !worker.includes('newsImpactRecoveryIncidentSloBreachTriageTrend=newsImpactRecoveryStrategyLoaded.available') || !worker.includes('newsImpactRecoveryIncidentSloBreachTriageTrend,') || !app.includes('Triage Trend · 4 недели') || !app.includes('RC92 — trend') || !fs.existsSync('test/news-impact-recovery-incident-triage-trend-rc92.test.js')) failures.push('RC92 triage trend/recurrence regression contract is missing');
if (!worker.includes('function buildNewsImpactRecoveryIncidentSloBreachTriage') || !worker.includes('newsImpactRecoveryIncidentSloBreachTriage=buildNewsImpactRecoveryIncidentSloBreachTriage') || !worker.includes('newsImpactRecoveryIncidentSloBreachTriage,') || !app.includes('SLO Breach Triage Queue') || !app.includes('RC91 — triage') || !fs.existsSync('test/news-impact-recovery-incident-breach-triage-rc91.test.js')) failures.push('RC91 breach triage regression contract is missing');
if (!worker.includes('function buildNewsImpactRecoveryIncidentSloBreachWatchlist') || !worker.includes('newsImpactRecoveryIncidentSloBreachWatchlist=buildNewsImpactRecoveryIncidentSloBreachWatchlist') || !worker.includes('newsImpactRecoveryIncidentSloBreachWatchlist,') || !app.includes('SLO Breach Watchlist') || !app.includes('RC90 — watchlist') || !fs.existsSync('test/news-impact-recovery-incident-breach-watchlist-rc90.test.js')) failures.push('RC90 breach watchlist/aging regression contract is missing');
if (!worker.includes('function buildNewsImpactRecoveryIncidentSloBreachFeed') || !worker.includes('newsImpactRecoveryIncidentSloBreachFeed=newsImpactRecoveryStrategyLoaded.available') || !worker.includes('newsImpactRecoveryIncidentSloBreachFeed,') || !app.includes('SLO Breach Feed') || !app.includes('RC89 — drilldown') || !fs.existsSync('test/news-impact-recovery-incident-breach-feed-rc89.test.js')) failures.push('RC89 SLO breach feed/drilldown regression contract is missing');
if (!worker.includes('function buildNewsImpactRecoveryIncidentAcknowledgementHistory') || !worker.includes('function buildNewsImpactRecoveryIncidentEpisodeHistory') || !worker.includes('function buildNewsImpactRecoveryIncidentSloDashboard') || !worker.includes('function newsImpactRecoveryEpisodeSloState')) failures.push('RC88 recovery incident SLO dashboard engine is missing');
if (!worker.includes('incidentEpisodeHistory=buildNewsImpactRecoveryIncidentEpisodeHistory(failures,incidentAckRows)') || !worker.includes('newsImpactRecoveryStrategyLoaded.incidentEpisodeHistory') || !worker.includes('newsImpactRecoveryIncidentSloDashboard=newsImpactRecoveryStrategyLoaded.available') || !worker.includes('buildNewsImpactRecoveryIncidentSloDashboard(') || !app.includes('Incident SLO Dashboard · 4 недели') || !app.includes('Повторяющиеся Recovery-проблемы') || !fs.existsSync('test/news-impact-recovery-incident-slo-dashboard-rc88.test.js')) failures.push('RC88 SLO dashboard/recurrence regression contract is missing');
if (!worker.includes('NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES = 30') || !worker.includes('NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES = 120') || !worker.includes('NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES = 360') || !worker.includes('episodeRecoveredAt') || !worker.includes('effectivePriority')) failures.push('RC87 recovery incident SLO/escalation engine is missing');
if (!worker.includes('newsImpactRecoveryIncidentSloGuard') || !worker.includes('incident_recovery_slo_breach') || !worker.includes('incident_ack_slo_breach') || !app.includes('ACK SLO просрочено') || !app.includes('Recovery SLO просрочено') || !fs.existsSync('test/news-impact-recovery-incident-slo-rc87.test.js')) failures.push('RC87 recovery incident SLO UI/alert regression contract is missing');
if (!worker.includes("NEWS_IMPACT_RECOVERY_INCIDENT_ACK_EVENT = 'news_impact_recovery_incident_ack'") || !worker.includes('function buildNewsImpactRecoveryIncidentAcknowledgements') || !worker.includes('function newsImpactRecoveryIncidentRunbook') || !worker.includes('async function apiNewsImpactRecoveryIncidentAck')) failures.push('RC86 acknowledgement/runbook engine is missing');
if (!worker.includes("url.pathname === '/api/recovery-incident-ack'") || !worker.includes('incident_seen_at:lastSeenAt') || !worker.includes('alertSuppressed:acknowledged') || !app.includes('async function acknowledgeRecoveryIncident') || !app.includes('✓ Просмотрено') || !fs.existsSync('test/news-impact-recovery-incident-ack-rc86.test.js')) failures.push('RC86 admin acknowledgement/suppression regression contract is missing');
if (!worker.includes('function buildNewsImpactRecoveryIncidentEvents') || !worker.includes('function buildNewsImpactRecoveryIncidentCenter') || !worker.includes('function summarizeNewsImpactRecoveryIncidents')) failures.push('RC85 recovery incident lifecycle engine is missing');
if (!worker.includes('incidentEvents=buildNewsImpactRecoveryIncidentEvents(failures') || !worker.includes('newsImpactRecoveryStrategyLoaded.incidentEvents') || !worker.includes('newsImpactRecoveryIncidents=buildNewsImpactRecoveryIncidentCenter') || !worker.includes('newsImpactRecoveryIncidentSummary=summarizeNewsImpactRecoveryIncidents')) failures.push('RC85 shared-loader incident contract is missing');
if (!app.includes('Recovery Incident Center') || !app.includes('Recovery-инциденты') || !app.includes('В Incident Center нет Telegram ID и raw error') || !fs.existsSync('test/news-impact-recovery-incident-center-rc85.test.js')) failures.push('RC85 admin incident center/privacy regression contract is missing');
if (!worker.includes('function buildNewsImpactRecoveryTransitionHistory') || !worker.includes('function summarizeNewsImpactRecoveryTransitions') || !worker.includes('function buildNewsImpactRecoveryAdminAlerts') || !worker.includes('function summarizeNewsImpactRecoveryAlerts')) failures.push('RC84 transition history/alerts engine is missing');
if (!worker.includes('transitionHistory=buildNewsImpactRecoveryTransitionHistory(failures') || !worker.includes('newsImpactRecoveryStrategyLoaded.transitionHistory') || !worker.includes('newsImpactRecoveryTransitionSummary') || !worker.includes('newsImpactRecoveryAlertSummary')) failures.push('RC84 shared-loader transition contract is missing');
if (!app.includes('Recovery: предупреждения') || !app.includes('История Recovery Strategy') || !app.includes('Telegram ID в API истории не возвращаются') || !fs.existsSync('test/news-impact-recovery-transition-alerts-rc84.test.js')) failures.push('RC84 admin transition UI/privacy regression contract is missing');
if (!worker.includes('NEWS_IMPACT_RECOVERY_DRIFT_PRIOR_MIN_ATTEMPTS = 20') || !worker.includes('NEWS_IMPACT_RECOVERY_DRIFT_RECENT_MIN_ATTEMPTS = 10') || !worker.includes('NEWS_IMPACT_RECOVERY_DRIFT_DROP_PCT_POINTS = 15') || !worker.includes("guardReason:'performance_drift'")) failures.push('RC83 recovery drift circuit breaker is missing');
if (!worker.includes('function buildNewsImpactRecoveryDriftMatrix') || !worker.includes('priorEvidence=buildNewsImpactRecoveryStrategyEvidence') || !worker.includes('newsImpactRecoveryDriftDecision(decision,loaded.priorEvidence,loaded.recentEvidence)')) failures.push('RC83 recovery drift evidence routing is missing');
if (!worker.includes('strategy_guard:safeStrategyReason') || !worker.includes('strategyReason:recovery.guardReason') || !app.includes('Drift circuit breaker') || !fs.existsSync('test/news-impact-recovery-drift-guard-rc83.test.js')) failures.push('RC83 recovery drift audit/UI regression contract is missing');
if (!worker.includes('NEWS_IMPACT_RECOVERY_STABILITY_WINDOW_DAYS = 7') || !worker.includes('NEWS_IMPACT_RECOVERY_STABILITY_MIN_ATTEMPTS = 10') || !worker.includes("guardReason:'stability_sample'") || !worker.includes("guardReason:'recent_regression'") || !worker.includes("guardReason:'stable_significant_better'")) failures.push('RC82 dual-window recovery stability guard is missing');
if (!worker.includes('newsImpactRecoveryStrategyLoaded=await loadNewsImpactRecoveryStrategyEvidence(cfg)') || !worker.includes("evidenceSource:'shared_runtime_loader'") || !app.includes('Admin и runtime используют один и тот же 30-дневный evidence loader') || !fs.existsSync('test/news-impact-recovery-stability-parity-rc82.test.js')) failures.push('RC82 admin/runtime strategy parity contract is missing');
if (!worker.includes('NEWS_IMPACT_RECOVERY_STRATEGY_MIN_ATTEMPTS = 30') || !worker.includes('function buildNewsImpactRecoveryStrategyEvidence') || !worker.includes('function newsImpactRecoveryStrategyDecision') || !worker.includes('async function selectNewsImpactRecoveryStrategy') || !worker.includes("fallback:'fixed'")) failures.push('RC81 guarded adaptive strategy engine is missing');
if (!worker.includes('news_impact_outcome_failure,news_impact_recovery_attempt,news_impact_outcome') || !worker.includes('NEWS_IMPACT_RECOVERY_STRATEGY_CACHE_MS = 300_000') || !worker.includes("strategy:safeStrategy")) failures.push('RC81 strategy evidence/cache attribution is missing');
if (!app.includes('const impactRecoveryStrategyMatrix=Array.isArray(d.newsImpactRecoveryStrategyMatrix)') || !app.includes('Recovery Strategy Guard') || !app.includes('fixed fallback → adaptive только при доказательстве') || !fs.existsSync('test/news-impact-recovery-strategy-guard-rc81.test.js')) failures.push('RC81 strategy transparency UI or regression test is missing');
if (!worker.includes("firstPartyGrowthAnalytics: 'enabled'") || !worker.includes("launchFunnelAnalytics: 'enabled'")) failures.push('RC53 first-party funnel health contract is missing');
if (!worker.includes('parseLaunchStartParam') || !worker.includes('ensureLaunchAttribution') || !worker.includes('recordGrowthEvent')) failures.push('RC53 attribution engine is missing');
if (!worker.includes("url.pathname === '/api/launch-funnel'") || !app.includes('function renderLaunchFunnel')) failures.push('RC53 admin launch funnel is missing');
if (!app.includes("origin:'miniapp'") || !worker.includes("origin:'telegram_quick'")) failures.push('RC53 full-vs-quick AI conversion split is missing');
if (!readme.includes('v6.95.0 — RC103') || !readme.includes('Production Monitoring & Recovery')) failures.push('README must describe the current RC103 release');
if (!qaChecklist.includes('v6.95.0 RC103') || !qaChecklist.includes('Production Monitoring & Recovery') || !qaChecklist.includes('npm run verify:release')) failures.push('QA checklist must describe the current RC103 release gate');
if (!fs.existsSync('test/supabase-schema-drift-rc100.test.js')) failures.push('Missing RC100 Supabase schema drift regression test');
if (!fs.existsSync('test/supabase-directory-hardening-rc101.test.js')) failures.push('Missing RC101 Supabase directory hardening regression test');
if (!fs.existsSync('scripts/security-scan.js')) failures.push('Missing RC102 Secret Leak Guard scanner');
if (!fs.existsSync('test/security-scan-rc102.test.js')) failures.push('Missing RC102 Secret Leak Guard regression test');
if (pkg.scripts?.['security:scan'] !== 'node scripts/security-scan.js') failures.push('RC102 security:scan npm contract is missing');
const qualityWorkflow = fs.readFileSync('.github/workflows/quality.yml','utf8');
if (!qualityWorkflow.includes('npm run security:scan')) failures.push('Quality must run Secret Leak Guard');
if (!deployWorkflow.includes('npm run security:scan')) failures.push('Production deploy must re-run Secret Leak Guard');
if (!fs.existsSync('scripts/rollback-smoke.js')) failures.push('Missing RC103 rollback smoke verifier');
if (!fs.existsSync('test/production-monitor-recovery-rc103.test.js')) failures.push('Missing RC103 production monitor/recovery regression test');
if (!worker.includes('async function runProductionMonitor') || !worker.includes('function productionMonitorSelfTest')) failures.push('RC103 production monitor engine is missing');
if (!worker.includes("url.pathname === '/api/production-monitor'")) failures.push('RC103 protected production monitor route is missing');
if (!worker.includes("productionMonitor: 'enabled'") || !worker.includes("rollbackVerification: 'enabled'")) failures.push('RC103 health monitor/recovery flags are missing');
if (!worker.includes("scheduledAt.getUTCMinutes() % 15 === 0")) failures.push('RC103 production monitor must run every 15 minutes');
if (!rollbackWorkflow.includes('expected_version:') || !rollbackWorkflow.includes('Rollback preflight')) failures.push('RC103 rollback preflight contract is missing');
if (!rollbackWorkflow.includes('npx wrangler rollback "$VERSION_ID"') || !rollbackWorkflow.includes('node scripts/rollback-smoke.js "$ROLLBACK_URL" "$EXPECTED_VERSION"')) failures.push('RC103 rollback verification workflow is incomplete');
if (!rollbackSmoke.includes('runRollbackSmoke') || !rollbackSmoke.includes('/health/supabase')) failures.push('RC103 rollback smoke contract is incomplete');
if (!postDeploySmoke.includes("'productionMonitor'") || !postDeploySmoke.includes("'productionMonitorSelfTest'") || !postDeploySmoke.includes("'rollbackVerification'")) failures.push('RC103 post-deploy smoke monitoring flags are missing');

const gitignore = fs.readFileSync('.gitignore','utf8');
for (const item of ['.env','.dev.vars','*.pem','*.key']) if (!gitignore.includes(item)) failures.push(`Git ignore is missing secret pattern: ${item}`);

if (!baseline.includes('Fresh-install baseline refused: existing Football Analytics schema detected.')) failures.push('RC101 baseline existing-schema refusal guard is missing');
if (!fs.existsSync('supabase/README.md')) failures.push('Missing Supabase directory documentation');

if (!worker.includes('function probeSupabaseSchemaDrift') || !worker.includes('function probeTableColumns') || !worker.includes('function supabaseSchemaDriftSelfTest')) failures.push('RC100 Supabase schema drift engine is missing');
if (!worker.includes("releaseCheck('supabase_schema_drift'") || !worker.includes("releaseCheck('supabase_schema_drift_selftest'")) failures.push('RC100 Release Readiness schema drift gates are missing');
if (!worker.includes("supabaseSchemaDriftGuard: 'enabled'") || !worker.includes("supabaseSchemaDriftSelfTest: supabaseSchemaDriftSelfTest().pass ? 'enabled' : 'failed'")) failures.push('RC100 health schema drift flags are missing');
const postDeploySmoke = fs.readFileSync('scripts/post-deploy-smoke.js', 'utf8');
if (!postDeploySmoke.includes("'supabaseSchemaDriftGuard'") || !postDeploySmoke.includes("'supabaseSchemaDriftSelfTest'")) failures.push('RC100 production smoke schema drift flags are missing');
if (!fs.existsSync('MEDIA_LAUNCH_RU.md')) failures.push('Missing RC53 media launch kit');
if (!fs.readFileSync('public/privacy.html','utf8').includes('События launch-аналитики хранятся до 90 дней')) failures.push('RC53 privacy attribution disclosure is missing');

const launchMigration = fs.readFileSync('supabase/migrations/supabase_migration_v6_15.sql','utf8');
if (!launchMigration.includes('create table if not exists public.growth_events')) failures.push('RC53 growth_events table is missing');
if (!launchMigration.includes('alter table public.growth_events enable row level security')) failures.push('RC53 growth_events RLS is missing');
if (!launchMigration.includes('revoke all on table public.growth_events from anon, authenticated')) failures.push('RC53 growth_events anon/auth lockdown is missing');
if (!launchMigration.includes('grant select, insert, delete on table public.growth_events to service_role')) failures.push('RC53 growth_events backend grant is missing');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`RC103 Production Monitoring & Recovery contracts verified for ${expected}.`);
