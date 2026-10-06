import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDiagnosticsRuntime } from '../src/diagnostics-runtime.js';
import { createPublicHealthRuntime } from '../src/public-health.js';
import { createPublicStatusRouter, createPublicStatusRuntime } from '../src/public-status.js';
import { createReleaseFieldEvidenceRuntime } from '../src/release-field-evidence.js';
import { createAppCapabilitiesRuntime } from '../src/app-capabilities.js';
import { createSettlementRuntime } from '../src/settlement-runtime.js';
import { createProviderDataRuntime } from '../src/provider-data-runtime.js';
import { createProviderFixtureRuntime } from '../src/provider-fixture-runtime.js';
import { createModelIntelligenceRuntime } from '../src/model-intelligence-runtime.js';
import { createLiveMatchIntelligenceRuntime } from '../src/live-match-intelligence-runtime.js';
import { createCompetitionIntegrityRuntime } from '../src/competition-integrity-runtime.js';
import { createMatchFormattingRuntime } from '../src/match-formatting-runtime.js';
import { createSearchDiscoveryRuntime } from '../src/search-discovery-runtime.js';
import { createTeamTournamentRuntime } from '../src/team-tournament-runtime.js';
import { createTeamIntelligenceRuntime } from '../src/team-intelligence-runtime.js';
import { createRefereeIntelligenceRuntime } from '../src/referee-intelligence-runtime.js';
import { createAnalysisQualityRuntime } from '../src/analysis-quality-runtime.js';
import { createAnalysisLifecycleRuntime } from '../src/analysis-lifecycle-runtime.js';
import { createAnalysisContextRuntime } from '../src/analysis-context-runtime.js';
import { createFootballNewsRuntime } from '../src/football-news-runtime.js';
import { createSupabaseSchemaRuntime } from '../src/supabase-schema-runtime.js';
import { createProductionMonitorRuntime } from '../src/production-monitor-runtime.js';
import { createProviderSloRuntime } from '../src/provider-slo-runtime.js';
import { createBetaPhase5Runtime } from '../src/beta-phase5-runtime.js';
import { createClientTelemetryRuntime } from '../src/client-telemetry-runtime.js';
import { createUserDataApiRuntime } from '../src/user-data-api-runtime.js';
import { createOddsSnapshotRuntime } from '../src/odds-snapshot-runtime.js';
import { createSupabaseReadinessRuntime } from '../src/supabase-readiness-runtime.js';
import { createReleaseReadinessRuntime } from '../src/release-readiness-runtime.js';
import { createProviderBudgetRuntime } from '../src/provider-budget-runtime.js';
import { createReleaseMonitorApiRuntime } from '../src/release-monitor-api-runtime.js';
import { createMarketParsingRuntime } from '../src/market-parsing-runtime.js';

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');

test('Worker composition root stays below the post-audit architecture budget',()=>{
  const bytes=Buffer.byteLength(worker,'utf8');
  assert.ok(
    bytes<=552_000,
    `src/worker.js grew to ${bytes} bytes; extract another cohesive runtime instead of growing the composition root`,
  );
});

test('extracted runtime factories are executable contracts, not source-only placeholders',async()=>{
  assert.equal(typeof createPublicHealthRuntime,'function');
  assert.equal(typeof createPublicStatusRuntime,'function');
  assert.equal(typeof createPublicStatusRouter,'function');
  assert.equal(typeof createReleaseFieldEvidenceRuntime,'function');
  assert.equal(typeof createDiagnosticsRuntime,'function');
  assert.equal(typeof createAppCapabilitiesRuntime,'function');
  assert.equal(typeof createSettlementRuntime,'function');

  const publicStatus=createPublicStatusRuntime({
    loadRuntimeControls:async()=>({value:{maintenanceMode:false,analysisEnabled:true,searchEnabled:true,liveEnabled:true,message:''}}),
    publicRuntimeControls:value=>value,
    providerCooldownUntil:()=>0,
    currentReleaseIdentity:()=>({}),
    readCompositeReadiness:async()=>({
      valid:true,
      ok:true,
      connectivity:{ok:true,status:'ok'},
      schema:{ok:true,status:'ok',contractVersion:2},
      backendSecurity:{ok:true,status:'ok'},
      authFailures:{available:true,count:0},
    }),
    version:'test',
    releaseCandidate:'RC0',
    expectedSchemaContractVersion:2,
    expectedSchemaFingerprint:'fingerprint',
  });
  assert.equal((await publicStatus.computeReadinessSnapshot({botToken:'x',webhookSecret:'y'})).ok,true);

  const releaseEvidence=createReleaseFieldEvidenceRuntime({
    hasSupabase:()=>false,
    appVersion:'test',
    fetchWithTimeout:async()=>{throw new Error('not expected');},
    supaHeaders:()=>({}),
    supaSelectMany:async()=>[],
    recordOpsEvent:async()=>{},
    loadSharedProviderState:async()=>{},
    apiFootball:async()=>{},
    isFootballRateLimitError:()=>false,
    providerSnapshot:()=>({}),
    randomUUID:()=> 'test-claim',
  });
  assert.equal(releaseEvidence.scheduleReleaseFieldEvidence({}),null);

  const health=createPublicHealthRuntime({
    version:'test',
    releaseCandidate:'RC0',
    computeReadiness:async()=>({
      ok:true,
      status:'ready',
      checks:{
        supabase:{ok:true,status:'ok'},
        schema:{ok:true,status:'ok'},
        backendSecurity:{ok:true,status:'ok'},
        telegramConfigured:true,
      },
    }),
  });
  assert.equal((await health.readinessSnapshot({})).ok,true);

  const diagnostics=createDiagnosticsRuntime({
    memory:{opsEvents:[],telemetry:{}},
    appVersion:'test',
    supabaseSchemaGuidance:'schema',
    hasSupabase:()=>false,
    fetchWithTimeout:async()=>{throw new Error('not expected');},
    supaHeaders:()=>({}),
    probeSupabaseConfirmed:async()=>({configured:false,ok:true,status:'not_configured'}),
    readIntegrityDiagnostics:async()=>({migrationReady:true,lastRun:{health:'ok'}}),
    readTelegramDedupeHealth:async()=>({available:true,state:'healthy'}),
    providerSloReport:async()=>({overall:{state:'healthy'},incident:{activeIncident:null}}),
    providerSnapshot:()=>({health:'ok',cooldownActive:false,dailyUsedPct:0}),
    footballCooldownRemaining:()=>0,
    telemetrySnapshot:()=>({}),
  });
  const result=await diagnostics.collectDiagnostics({opsRetentionDays:14});
  assert.equal(result.available,true);

  const capabilities=createAppCapabilitiesRuntime({
    memory:{provider:{plan:'FREE'}},
    appVersion:'test',
    minClientVersion:'test',
    apiContractVersion:5,
    releaseChannel:'test',
    releaseCandidate:'RC0',
    paidQuotaHealthy:()=>true,
    providerPublicBudgetMode:()=>({mode:'normal',label:'ok',liveRefreshSeconds:90}),
    runtimeControlsSnapshot:()=>({maintenanceMode:false,liveEnabled:true,expandedDataEnabled:true}),
    isSecurityLockdownControls:()=>false,
    publicRuntimeControls:value=>value || {},
    currentReleaseIdentity:()=>({}),
  });
  assert.equal(capabilities.publicDataCapabilities().mode,'standard');
  assert.equal(capabilities.appManifest({monetizationEnabled:false}).monetization,'paused');

  const settlement=createSettlementRuntime(new Proxy({}, {get:()=>()=>null}));
  const providerData=createProviderDataRuntime(new Proxy({}, {get:()=>()=>null}));
  const providerFixture=createProviderFixtureRuntime(new Proxy({}, {get:()=>()=>null}));
  const modelIntelligence=createModelIntelligenceRuntime(new Proxy({}, {get:()=>()=>null}));
  const liveIntelligence=createLiveMatchIntelligenceRuntime({numericValue:value=>Number(value)});
  const competitionIntegrity=createCompetitionIntegrityRuntime(new Proxy({}, {get:()=>()=>null}));
  const matchFormatting=createMatchFormattingRuntime({assessLineupQuality:()=>({}),normalizeFixtureAbsences:()=>({home:[],away:[]})});
  const searchDiscovery=createSearchDiscoveryRuntime(new Proxy({}, {get:()=>()=>null}));
  const teamTournament=createTeamTournamentRuntime(new Proxy({}, {get:()=>()=>null}));
  const teamIntelligence=createTeamIntelligenceRuntime(new Proxy({}, {get:()=>()=>null}));
  const refereeIntelligence=createRefereeIntelligenceRuntime({hasSupabase:()=>false,memory:{refereeMatchHistory:new Map()},numericValue:value=>Number(value),supaSelectMany:async()=>[],supaUpsert:async()=>{}});
  const analysisQuality=createAnalysisQualityRuntime({absenceAdjustmentUnits:()=>0,assessMatchLineups:()=>({home:{confirmed:false},away:{confirmed:false},partialSides:0}),probabilityLeaderMargin:()=>10});
  const analysisLifecycle=createAnalysisLifecycleRuntime({hasSupabase:()=>false,isFinishedStatus:()=>false,isLiveStatus:()=>false,memory:{history:new Map()},supaSelectOne:async()=>null});
  const analysisContext=createAnalysisContextRuntime({analysisQualityGate:()=>({allowSignal:true,reasons:[]}),freeQuotaHealthy:()=>true,getCache:async()=>null,getStaleCache:async()=>null,marketMovementNote:()=>'',refereeProfile:()=>({}),resolveTeamSeasonPlayers:async()=>({available:false}),setCache:async()=>true});
  const footballNews=createFootballNewsRuntime({NEWS_BLOCKED_HOST_RE:/^$/,NEWS_MAJOR_SOURCE_RE:/^$/,NEWS_OFFICIAL_SOURCE_RE:/^$/,TOP_TEAM_SEARCH_CATALOG:[],botTeamIdMatches:async()=>[],fetchWithTimeout:async()=>({ok:false}),getCache:async()=>null,getFavorites:async()=>[],normalizeBotFixtureCard:value=>value || {},recordGrowthEvent:async()=>{},searchText:value=>String(value||'').toLowerCase(),setCache:async()=>true,telegramApi:async()=>{},telegramHtmlEscape:value=>String(value||''),todayUtc:()=> '2026-10-06'});
  const supabaseSchema=createSupabaseSchemaRuntime({EXPECTED_SCHEMA_FINGERPRINT:'test',PERSONAL_WRITE_LIMITS:{favorites:1,favoritePlayers:1,reminders:1},bumpTelemetry:()=>{},fetchWithTimeout:async()=>({ok:true,status:200}),hasSupabase:()=>false,readProviderIncidentAlertDeliveryContract:async()=>({ok:true,status:'ok'}),redactOpsString:value=>String(value||''),sleepMs:async()=>{},supaHeaders:()=>({}),supaRpc:async()=>({})});
  const productionMonitor=createProductionMonitorRuntime(new Proxy({}, {get:()=>()=>null}));
  const providerSlo=createProviderSloRuntime(new Proxy({}, {get:()=>()=>null}));
  const betaPhase5=createBetaPhase5Runtime(new Proxy({}, {get:()=>()=>null}));
  const clientTelemetry=createClientTelemetryRuntime(new Proxy({}, {get:()=>()=>null}));
  const userDataApi=createUserDataApiRuntime(new Proxy({}, {get:()=>()=>null}));
  const oddsSnapshot=createOddsSnapshotRuntime({hasSupabase:()=>false,memory:{oddsSnapshots:new Map()},normalizeThree:()=>({home:33.3,draw:33.3,away:33.4}),sanitizeOddsSnapshotsForMovement:x=>x || [],supaSelectMany:async()=>[],supaUpsert:async()=>{}});
  const supabaseReadiness=createSupabaseReadinessRuntime({bumpTelemetry:()=>{},fetchWithTimeout:async()=>({ok:true,headers:{get:()=>''},json:async()=>[]}),hasSupabase:()=>false,redactOpsString:value=>String(value||''),sleepMs:async()=>{},supaHeaders:()=>({})});
  const releaseReadiness=createReleaseReadinessRuntime(new Proxy({}, {get:()=>()=>null}));
  const providerBudget=createProviderBudgetRuntime({clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),freeQuotaHealthy:()=>true,getCache:async()=>null,hasSupabase:()=>false,memory:{provider:{},providerFeatureFetch:{},telemetry:{}},phase5ProviderUsage:()=>{},recordOpsEvent:async()=>{},runtimeControlsSnapshot:()=>({}),setCache:async()=>true});
  const releaseMonitorApi=createReleaseMonitorApiRuntime(new Proxy({}, {get:()=>()=>null}));
  const marketParsing=createMarketParsingRuntime();
  assert.equal(typeof settlement.runSettlementWatchdog,'function');
  assert.equal(typeof settlement.runSettlementFinalityVerification,'function');
  assert.equal(typeof providerData.providerDataState,'function');
  assert.equal(typeof providerData.providerFeatureFetch,'function');
  assert.equal(typeof providerFixture.loadProviderFixturesForDate,'function');
  assert.equal(typeof providerFixture.apiMatches,'function');
  assert.equal(typeof modelIntelligence.blendProbabilitySignals,'function');
  assert.equal(typeof modelIntelligence.buildPreMatchIntelligence,'function');
  assert.equal(typeof liveIntelligence.buildLiveAiCoach,'function');
  assert.equal(typeof liveIntelligence.buildSmartMatchInsights,'function');
  assert.equal(typeof competitionIntegrity.normalizeCompetition,'function');
  assert.equal(typeof competitionIntegrity.validateFixtureIntegrity,'function');
  assert.equal(typeof matchFormatting.formatLineups,'function');
  assert.equal(typeof matchFormatting.formatLiveEvents,'function');
  assert.equal(typeof searchDiscovery.loadSearchTeamMatches,'function');
  assert.equal(typeof searchDiscovery.apiSearch,'function');
  assert.equal(typeof teamTournament.apiTournament,'function');
  assert.equal(typeof teamTournament.apiTeam,'function');
  assert.equal(typeof teamIntelligence.apiTeamIntelligence,'function');
  assert.equal(typeof teamIntelligence.apiTeamSquad,'function');
  assert.equal(typeof refereeIntelligence.refereeProfile,'function');
  assert.equal(typeof refereeIntelligence.saveRefereeMatchHistory,'function');
  assert.equal(typeof refereeIntelligence.loadRefereeHistoryProfile,'function');
  assert.equal(typeof analysisQuality.buildLineupImpact,'function');
  assert.equal(typeof analysisQuality.marketMovementNote,'function');
  assert.equal(typeof analysisQuality.analysisQualityGate,'function');
  assert.equal(typeof analysisLifecycle.analysisFreshness,'function');
  assert.equal(typeof analysisLifecycle.analysisKickoffHandoff,'function');
  assert.equal(typeof analysisLifecycle.analysisRecheckDelta,'function');
  assert.equal(typeof analysisContext.cachedTeamIntelligenceForAnalysis,'function');
  assert.equal(typeof analysisContext.buildMatchComparison,'function');
  assert.equal(typeof analysisContext.buildAiInstructor,'function');
  assert.equal(typeof footballNews.currentGeneralFootballNews,'function');
  assert.equal(typeof footballNews.newsRelevantFixture,'function');
  assert.equal(typeof footballNews.sendGeneralFootballNews,'function');
  assert.equal(typeof supabaseSchema.probeSupabaseSchemaDrift,'function');
  assert.equal(typeof supabaseSchema.probeSupabaseSchemaDriftConfirmed,'function');
  assert.equal(typeof supabaseSchema.readSupabaseSchemaFingerprint,'function');
  assert.equal(typeof productionMonitor.summarizeReleaseWindow,'function');
  assert.equal(typeof productionMonitor.productionMonitorState,'function');
  assert.equal(typeof productionMonitor.runProductionMonitor,'function');
  assert.equal(typeof providerSlo.flushProviderSloWindow,'function');
  assert.equal(typeof providerSlo.providerSloReport,'function');
  assert.equal(typeof providerSlo.claimProviderIncidentAlertDelivery,'function');
  assert.equal(typeof betaPhase5.apiBetaDashboard,'function');
  assert.equal(typeof betaPhase5.apiPhase5Dashboard,'function');
  assert.equal(typeof betaPhase5.controlledBetaExpansionDecision,'function');
  assert.equal(typeof clientTelemetry.phase5ValidationContext,'function');
  assert.equal(typeof clientTelemetry.clientTelemetryMetadata,'function');
  assert.equal(typeof clientTelemetry.apiClientTelemetry,'function');
  assert.equal(typeof userDataApi.apiMe,'function');
  assert.equal(typeof userDataApi.apiHistory,'function');
  assert.equal(typeof userDataApi.apiFavorites,'function');
  assert.equal(typeof userDataApi.apiPreferences,'function');
  assert.equal(typeof oddsSnapshot.getOddsSnapshots,'function');
  assert.equal(typeof oddsSnapshot.saveOddsSnapshot,'function');
  assert.equal(typeof oddsSnapshot.buildOddsMovement,'function');
  assert.equal(typeof supabaseReadiness.probeSupabase,'function');
  assert.equal(typeof supabaseReadiness.probeSupabaseReadinessConfirmed,'function');
  assert.equal(typeof releaseReadiness.apiProductionReadiness,'function');
  assert.equal(typeof releaseReadiness.runSingleFlightSelfTest,'function');
  assert.equal(typeof releaseReadiness.rcReadRoute,'function');
  assert.equal(typeof providerBudget.providerSnapshot,'function');
  assert.equal(typeof providerBudget.providerBudgetProfile,'function');
  assert.equal(typeof providerBudget.providerFeaturePolicy,'function');
  assert.equal(typeof releaseMonitorApi.readOpsEventsRange,'function');
  assert.equal(typeof releaseMonitorApi.apiPostDeployRegressionResponse,'function');
  assert.equal(typeof releaseMonitorApi.apiReleaseMonitor,'function');
  assert.equal(typeof marketParsing.normalizeThree,'function');
  assert.equal(typeof marketParsing.extractMarket,'function');
  assert.equal(typeof marketParsing.extractLiveMarket,'function');
});

test('Worker composes extracted runtimes through explicit imports',()=>{
  assert.match(worker,/import \{ createPublicHealthRuntime \} from '\.\/public-health\.js'/);
  assert.match(worker,/import \{ createPublicStatusRouter, createPublicStatusRuntime \} from '\.\/public-status\.js'/);
  assert.match(worker,/import \{ createReleaseFieldEvidenceRuntime \} from '\.\/release-field-evidence\.js'/);
  assert.match(worker,/import \{ createDiagnosticsRuntime \} from '\.\/diagnostics-runtime\.js'/);
  assert.match(worker,/import \{ createAppCapabilitiesRuntime \} from '\.\/app-capabilities\.js'/);
  assert.match(worker,/import \{ createSettlementRuntime \} from '\.\/settlement-runtime\.js'/);
  assert.match(worker,/import \{ createMatchCenterRuntime \} from '\.\/match-center-runtime\.js'/);
  assert.match(worker,/import \{ createAnalysisRuntime \} from '\.\/analysis-runtime\.js'/);
  assert.match(worker,/import \{ createProviderDataRuntime \} from '\.\/provider-data-runtime\.js'/);
  assert.match(worker,/import \{ createProviderFixtureRuntime \} from '\.\/provider-fixture-runtime\.js'/);
  assert.match(worker,/import \{ createModelIntelligenceRuntime \} from '\.\/model-intelligence-runtime\.js'/);
  assert.match(worker,/import \{ createLiveMatchIntelligenceRuntime \} from '\.\/live-match-intelligence-runtime\.js'/);
  assert.match(worker,/import \{ createCompetitionIntegrityRuntime \} from '\.\/competition-integrity-runtime\.js'/);
  assert.match(worker,/import \{ createMatchFormattingRuntime \} from '\.\/match-formatting-runtime\.js'/);
  assert.match(worker,/import \{ createSearchDiscoveryRuntime \} from '\.\/search-discovery-runtime\.js'/);
  assert.match(worker,/import \{ createTeamTournamentRuntime \} from '\.\/team-tournament-runtime\.js'/);
  assert.match(worker,/import \{ createTeamIntelligenceRuntime \} from '\.\/team-intelligence-runtime\.js'/);
  assert.match(worker,/import \{ createRefereeIntelligenceRuntime \} from '\.\/referee-intelligence-runtime\.js'/);
  assert.match(worker,/import \{ createAnalysisQualityRuntime \} from '\.\/analysis-quality-runtime\.js'/);
  assert.match(worker,/import \{ createAnalysisLifecycleRuntime \} from '\.\/analysis-lifecycle-runtime\.js'/);
  assert.match(worker,/import \{ createAnalysisContextRuntime \} from '\.\/analysis-context-runtime\.js'/);
  assert.match(worker,/import \{ createFootballNewsRuntime \} from '\.\/football-news-runtime\.js'/);
  assert.match(worker,/import \{ createSupabaseSchemaRuntime \} from '\.\/supabase-schema-runtime\.js'/);
  assert.match(worker,/import \{ createProductionMonitorRuntime \} from '\.\/production-monitor-runtime\.js'/);
  assert.match(worker,/import \{ createProviderSloRuntime \} from '\.\/provider-slo-runtime\.js'/);
  assert.match(worker,/import \{ createBetaPhase5Runtime \} from '\.\/beta-phase5-runtime\.js'/);
  assert.match(worker,/import \{ createClientTelemetryRuntime \} from '\.\/client-telemetry-runtime\.js'/);
  assert.match(worker,/import \{ createUserDataApiRuntime \} from '\.\/user-data-api-runtime\.js'/);
  assert.match(worker,/import \{ createOddsSnapshotRuntime \} from '\.\/odds-snapshot-runtime\.js'/);
  assert.match(worker,/import \{ createSupabaseReadinessRuntime \} from '\.\/supabase-readiness-runtime\.js'/);
  assert.match(worker,/import \{ createReleaseReadinessRuntime \} from '\.\/release-readiness-runtime\.js'/);
  assert.match(worker,/import \{ createProviderBudgetRuntime \} from '\.\/provider-budget-runtime\.js'/);
  assert.match(worker,/import \{ createReleaseMonitorApiRuntime \} from '\.\/release-monitor-api-runtime\.js'/);
  assert.match(worker,/import \{ createMarketParsingRuntime \} from '\.\/market-parsing-runtime\.js'/);
  assert.match(worker,/createDiagnosticsRuntime\(\{/);
  assert.match(worker,/createPublicHealthRuntime\(\{/);
  assert.match(worker,/createPublicStatusRuntime\(\{/);
  assert.match(worker,/createPublicStatusRouter\(\{/);
  assert.match(worker,/createReleaseFieldEvidenceRuntime\(\{/);
  assert.match(worker,/createAppCapabilitiesRuntime\(\{/);
  assert.match(worker,/createSettlementRuntime\(\{/);
  assert.match(worker,/createMatchCenterRuntime\(\{/);
  assert.match(worker,/createAnalysisRuntime\(\{/);
  assert.match(worker,/createProviderDataRuntime\(\{/);
  assert.match(worker,/createProviderFixtureRuntime\(\{/);
  assert.match(worker,/createModelIntelligenceRuntime\(\{/);
  assert.match(worker,/createLiveMatchIntelligenceRuntime\(\{/);
  assert.match(worker,/createCompetitionIntegrityRuntime\(\{/);
  assert.match(worker,/createMatchFormattingRuntime\(\{/);
  assert.match(worker,/createSearchDiscoveryRuntime\(\{/);
  assert.match(worker,/createTeamTournamentRuntime\(\{/);
  assert.match(worker,/createTeamIntelligenceRuntime\(\{/);
  assert.match(worker,/createRefereeIntelligenceRuntime\(\{/);
  assert.match(worker,/createAnalysisQualityRuntime\(\{/);
  assert.match(worker,/createAnalysisLifecycleRuntime\(\{/);
  assert.match(worker,/createAnalysisContextRuntime\(\{/);
  assert.match(worker,/createFootballNewsRuntime\(\{/);
  assert.match(worker,/createSupabaseSchemaRuntime\(\{/);
  assert.match(worker,/createProductionMonitorRuntime\(\{/);
  assert.match(worker,/createProviderSloRuntime\(\{/);
  assert.match(worker,/createBetaPhase5Runtime\(\{/);
  assert.match(worker,/createClientTelemetryRuntime\(\{/);
  assert.match(worker,/createUserDataApiRuntime\(\{/);
  assert.match(worker,/createOddsSnapshotRuntime\(\{/);
  assert.match(worker,/createSupabaseReadinessRuntime\(\{/);
  assert.match(worker,/createReleaseReadinessRuntime\(\{/);
  assert.match(worker,/createProviderBudgetRuntime\(\{/);
  assert.match(worker,/createReleaseMonitorApiRuntime\(\{/);
  assert.match(worker,/createMarketParsingRuntime\(\)/);
  assert.doesNotMatch(worker,/async function collectDiagnostics\(/);
  assert.doesNotMatch(worker,/async function readRecentOpsEvents\(/);
  assert.doesNotMatch(worker,/async function publicServiceStatus\(/);
  assert.doesNotMatch(worker,/async function computeReadinessSnapshot\(/);
  assert.doesNotMatch(worker,/async function claimReleaseEvidenceLock\(/);
  assert.doesNotMatch(worker,/async function recordClosedBetaConfigurationEvidence\(/);
  assert.doesNotMatch(worker,/async function probeReleaseProviderQuotaEvidence\(/);
  assert.doesNotMatch(worker,/async function captureReleaseFieldEvidence\(/);
  assert.doesNotMatch(worker,/async function runSettlementWatchdog\(/);
  assert.doesNotMatch(worker,/async function runSettlementFinalityVerification\(/);
  assert.doesNotMatch(worker,/function buildPredictionIntegrity\(/);
  assert.doesNotMatch(worker,/async function apiMatchCenter\(/);
  assert.doesNotMatch(worker,/async function apiAnalyze\(/);
  assert.doesNotMatch(worker,/async function analysisProviderFetch\(/);
  assert.doesNotMatch(worker,/async function providerFeatureFetch\(/);
  assert.doesNotMatch(worker,/function providerDataReliabilitySummary\(/);
  assert.doesNotMatch(worker,/async function loadProviderFixturesForDate\(/);
  assert.doesNotMatch(worker,/async function loadProviderFixture\(/);
  assert.doesNotMatch(worker,/async function apiMatches\(/);
  assert.doesNotMatch(worker,/function blendProbabilitySignals\(/);
  assert.doesNotMatch(worker,/function poissonGoalModel\(/);
  assert.doesNotMatch(worker,/function buildPreMatchIntelligence\(/);
  assert.doesNotMatch(worker,/function buildLiveAiCoach\(/);
  assert.doesNotMatch(worker,/function buildSmartMatchInsights\(/);
  assert.doesNotMatch(worker,/function livePressure\(/);
  assert.doesNotMatch(worker,/function normalizeCompetition\(/);
  assert.doesNotMatch(worker,/function validateFixtureIntegrity\(/);
  assert.doesNotMatch(worker,/function runMatchIntegrityGuard\(/);
  assert.doesNotMatch(worker,/function formatLineups\(/);
  assert.doesNotMatch(worker,/function formatLiveStatistics\(/);
  assert.doesNotMatch(worker,/function formatLiveEvents\(/);
  assert.doesNotMatch(worker,/async function loadSearchTeamMatches\(/);
  assert.doesNotMatch(worker,/async function apiSearch\(/);
  assert.doesNotMatch(worker,/async function apiTournament\(/);
  assert.doesNotMatch(worker,/async function apiTeam\(/);
  assert.doesNotMatch(worker,/async function resolveTournamentStandings\(/);
  assert.doesNotMatch(worker,/async function apiTeamIntelligence\(/);
  assert.doesNotMatch(worker,/async function apiTeamSquad\(/);
  assert.doesNotMatch(worker,/async function loadLineupNotificationSnapshot\(/);
  assert.doesNotMatch(worker,/function refereeProfile\(/);
  assert.doesNotMatch(worker,/function refereeHistoryKey\(/);
  assert.doesNotMatch(worker,/function refereeCardSummary\(/);
  assert.doesNotMatch(worker,/async function saveRefereeMatchHistory\(/);
  assert.doesNotMatch(worker,/async function loadRefereeHistoryProfile\(/);
  assert.doesNotMatch(worker,/function buildLineupImpact\(/);
  assert.doesNotMatch(worker,/function marketMovementNote\(/);
  assert.doesNotMatch(worker,/function analysisQualityGate\(/);
  assert.doesNotMatch(worker,/function analysisQualityGateSelfTest\(/);
  assert.doesNotMatch(worker,/function analysisFreshness\(/);
  assert.doesNotMatch(worker,/function analysisKickoffHandoff\(/);
  assert.doesNotMatch(worker,/async function userHasAnalyzedFixture\(/);
  assert.doesNotMatch(worker,/function analysisRecheckDelta\(/);
  assert.doesNotMatch(worker,/function newsImpactDeltaStatus\(/);
  assert.doesNotMatch(worker,/function analysisResponsePayload\(/);
  assert.doesNotMatch(worker,/async function cachedTeamIntelligenceForAnalysis\(/);
  assert.doesNotMatch(worker,/async function hydratePlayerRolesForAnalysis\(/);
  assert.doesNotMatch(worker,/function buildMatchComparison\(/);
  assert.doesNotMatch(worker,/function buildAiInstructor\(/);
  assert.doesNotMatch(worker,/function externalNewsUrl\(/);
  assert.doesNotMatch(worker,/function newsFixtureRelevance\(/);
  assert.doesNotMatch(worker,/async function tavilyNewsSearch\(/);
  assert.doesNotMatch(worker,/async function sendGeneralFootballNews\(/);
  assert.doesNotMatch(worker,/async function sendFavoriteTeamNews\(/);
  assert.doesNotMatch(worker,/async function tavilySearch\(/);
  assert.doesNotMatch(worker,/async function probeOptionalTable\(/);
  assert.doesNotMatch(worker,/async function probeSupabaseSchemaDrift\(/);
  assert.doesNotMatch(worker,/async function probeSupabaseSchemaDriftConfirmed\(/);
  assert.doesNotMatch(worker,/function summarizeSupabaseSchemaChecks\(/);
  assert.doesNotMatch(worker,/function releaseTopGroups\(/);
  assert.doesNotMatch(worker,/function summarizeReleaseWindow\(/);
  assert.doesNotMatch(worker,/function productionMonitorState\(/);
  assert.doesNotMatch(worker,/async function runProductionMonitor\(/);
  assert.doesNotMatch(worker,/function providerSloEventRow\(/);
  assert.doesNotMatch(worker,/async function flushProviderSloWindow\(/);
  assert.doesNotMatch(worker,/async function readProviderSloWindows\(/);
  assert.doesNotMatch(worker,/async function providerSloReport\(/);
  assert.doesNotMatch(worker,/async function claimProviderIncidentAlertDelivery\(/);
  assert.doesNotMatch(worker,/function betaPercentileMs\(/);
  assert.doesNotMatch(worker,/function betaExpansionDecision\(/);
  assert.doesNotMatch(worker,/function controlledBetaExpansionDecision\(/);
  assert.doesNotMatch(worker,/async function apiPhase5Dashboard\(/);
  assert.doesNotMatch(worker,/async function apiBetaDashboard\(/);
  assert.doesNotMatch(worker,/async function closedBetaTelemetrySubject\(/);
  assert.doesNotMatch(worker,/function phase5ValidationRequestKind\(/);
  assert.doesNotMatch(worker,/async function phase5ValidationContext\(/);
  assert.doesNotMatch(worker,/function clientTelemetryMetadata\(/);
  assert.doesNotMatch(worker,/async function apiClientTelemetry\(/);
  assert.doesNotMatch(worker,/async function apiMe\(/);
  assert.doesNotMatch(worker,/async function apiHistory\(/);
  assert.doesNotMatch(worker,/async function apiFavorites\(/);
  assert.doesNotMatch(worker,/async function apiFavoritePlayers\(/);
  assert.doesNotMatch(worker,/async function apiReminders\(/);
  assert.doesNotMatch(worker,/async function apiPreferences\(/);
  assert.doesNotMatch(worker,/async function getOddsSnapshots\(/);
  assert.doesNotMatch(worker,/async function saveOddsSnapshot\(/);
  assert.doesNotMatch(worker,/function buildOddsMovement\(/);
  assert.doesNotMatch(worker,/async function probeSupabase\(/);
  assert.doesNotMatch(worker,/async function probeSupabaseConfirmed\(/);
  assert.doesNotMatch(worker,/async function probeSupabaseReadiness\(/);
  assert.doesNotMatch(worker,/async function probeSupabaseReadinessConfirmed\(/);
  assert.doesNotMatch(worker,/function releaseCheck\(/);
  assert.doesNotMatch(worker,/async function runSingleFlightSelfTest\(/);
  assert.doesNotMatch(worker,/async function apiProductionReadiness\(/);
  assert.doesNotMatch(worker,/function rcCheck\(/);
  assert.doesNotMatch(worker,/async function rcReadRoute\(/);
  assert.doesNotMatch(worker,/function inferFootballPlan\(/);
  assert.doesNotMatch(worker,/function providerSnapshot\(/);
  assert.doesNotMatch(worker,/function providerBudgetProfile\(/);
  assert.doesNotMatch(worker,/function providerFeaturePolicy\(/);
  assert.doesNotMatch(worker,/async function readOpsEventsRange\(/);
  assert.doesNotMatch(worker,/async function readDailyDigestOpsEvents\(/);
  assert.doesNotMatch(worker,/async function readDailyDigestSloEvents\(/);
  assert.doesNotMatch(worker,/async function apiPostDeployRegressionResponse\(/);
  assert.doesNotMatch(worker,/async function apiReleaseMonitor\(/);
  assert.doesNotMatch(worker,/function parsePercent\(/);
  assert.doesNotMatch(worker,/function normalizeThree\(/);
  assert.doesNotMatch(worker,/function extractMarket\(/);
  assert.doesNotMatch(worker,/function extractLiveMarket\(/);
  assert.doesNotMatch(worker,/function numericValue\(/);
});
