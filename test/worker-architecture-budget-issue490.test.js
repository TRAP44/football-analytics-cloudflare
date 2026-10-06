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

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');

test('Worker composition root stays below the post-audit architecture budget',()=>{
  const bytes=Buffer.byteLength(worker,'utf8');
  assert.ok(
    bytes<=785_000,
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
});
