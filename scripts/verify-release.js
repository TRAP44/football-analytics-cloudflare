import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const worker = fs.readFileSync('src/worker.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const staticHeaders = fs.readFileSync('public/_headers', 'utf8');
const styles = fs.readFileSync('public/styles.css', 'utf8');
const deployWorkflow = fs.readFileSync('.github/workflows/deploy-production.yml', 'utf8');
const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');
const expected = `${pkg.version}-rc53`;
const failures = [];

if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) failures.push('package-lock version must match package.json');

if (!worker.includes(`const APP_VERSION = '${expected}'`)) failures.push(`Worker version must be ${expected}`);
if (!worker.includes("const RC_NAME = 'RC53'")) failures.push('Worker RC name must be RC53');
if (!app.includes(`const CLIENT_VERSION = '${expected}'`)) failures.push(`Client version must be ${expected}`);
if (!app.includes("const CLIENT_RELEASE_CHANNEL = 'rc53'")) failures.push('Client release channel must be rc53');
if (!html.includes(`/app.js?v=${pkg.version}`) || !html.includes(`/styles.css?v=${pkg.version}`)) failures.push('Static asset versions must match package version');
if (!fs.existsSync('supabase_migration_v6_9.sql')) failures.push('Missing v6.9 migration');
if (!fs.existsSync('supabase_migration_v6_10.sql')) failures.push('Missing v6.10 migration');
if (!fs.existsSync('supabase_migration_v6_11.sql')) failures.push('Missing v6.11 migration');
if (!fs.existsSync('supabase_migration_v6_11_1.sql')) failures.push('Missing v6.11.1 default-ACL migration');
if (!fs.existsSync('supabase_migration_v6_12.sql')) failures.push('Missing v6.12 bot-digest migration');
if (!fs.existsSync('supabase_migration_v6_13.sql')) failures.push('Missing v6.13 referee-history migration');
if (!fs.existsSync('supabase_migration_v6_14.sql')) failures.push('Missing v6.14 persistent-AI-history migration');
if (!fs.existsSync('supabase_migration_v6_15.sql')) failures.push('Missing v6.15 media-launch attribution migration');
if (!fs.existsSync('supabase_baseline_v6_9.sql')) failures.push('Missing v6.9 baseline');
if (!fs.existsSync('src/access-control.js')) failures.push('Missing access-control module');
if (!fs.existsSync('scripts/post-deploy-smoke.js')) failures.push('Missing post-deploy smoke test');
if (!fs.existsSync('.github/workflows/deploy-production.yml')) failures.push('Missing production deploy workflow');
if (!fs.existsSync('.github/workflows/rollback-production.yml')) failures.push('Missing production rollback workflow');
if (!staticHeaders.includes('Content-Security-Policy:')) failures.push('Missing static asset Content-Security-Policy');
if (!staticHeaders.includes("script-src 'self' https://telegram.org")) failures.push('CSP must allow the official Telegram Mini App SDK');
if (!deployWorkflow.includes('exit 1')) failures.push('Production deployment must fail closed without Cloudflare credentials');
if (!deployWorkflow.includes('--message "RC53 ${{ env.DEPLOY_SHA }}"')) failures.push('Production deploy message must identify RC53');
if (!deployWorkflow.includes('post-deploy-smoke.js "$SMOKE_URL" "6.45.0-rc53"')) failures.push('Production smoke must verify 6.45.0-rc53');
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

const migration = fs.readFileSync('supabase_migration_v6_10.sql', 'utf8');
if (!migration.includes('transition_model_calibration')) failures.push('Missing atomic calibration transition RPC');
if (!migration.includes('alter table public.model_calibration_validations enable row level security')) failures.push('Missing validation-table RLS remediation');

const securityMigration = fs.readFileSync('supabase_migration_v6_11.sql', 'utf8');
if (!securityMigration.includes('backend_security_contract')) failures.push('Missing backend security contract RPC');
if (!securityMigration.includes('revoke all privileges on all tables in schema public')) failures.push('Missing backend-table privilege lockdown');

const defaultAclMigration = fs.readFileSync('supabase_migration_v6_11_1.sql', 'utf8');
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
if (!deployWorkflow.includes('6.45.0-rc53')) failures.push('RC53 production workflow version is missing');

if (!worker.includes("mediaLaunchPackage: 'enabled'") || !worker.includes("mediaDeepLinkAttribution: 'enabled'")) failures.push('RC53 media launch health contract is missing');
if (!worker.includes("firstPartyGrowthAnalytics: 'enabled'") || !worker.includes("launchFunnelAnalytics: 'enabled'")) failures.push('RC53 first-party funnel health contract is missing');
if (!worker.includes('parseLaunchStartParam') || !worker.includes('ensureLaunchAttribution') || !worker.includes('recordGrowthEvent')) failures.push('RC53 attribution engine is missing');
if (!worker.includes("url.pathname === '/api/launch-funnel'") || !app.includes('function renderLaunchFunnel')) failures.push('RC53 admin launch funnel is missing');
if (!app.includes("origin:'miniapp'") || !worker.includes("origin:'telegram_quick'")) failures.push('RC53 full-vs-quick AI conversion split is missing');
if (!fs.existsSync('MEDIA_LAUNCH_RU.md')) failures.push('Missing RC53 media launch kit');
if (!fs.readFileSync('public/privacy.html','utf8').includes('События launch-аналитики хранятся до 90 дней')) failures.push('RC53 privacy attribution disclosure is missing');

const launchMigration = fs.readFileSync('supabase_migration_v6_15.sql','utf8');
if (!launchMigration.includes('create table if not exists public.growth_events')) failures.push('RC53 growth_events table is missing');
if (!launchMigration.includes('alter table public.growth_events enable row level security')) failures.push('RC53 growth_events RLS is missing');
if (!launchMigration.includes('revoke all on table public.growth_events from anon, authenticated')) failures.push('RC53 growth_events anon/auth lockdown is missing');
if (!launchMigration.includes('grant select, insert, delete on table public.growth_events to service_role')) failures.push('RC53 growth_events backend grant is missing');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`RC53 launch contracts verified for ${expected}.`);
