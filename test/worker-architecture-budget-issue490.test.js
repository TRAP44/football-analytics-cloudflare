import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDiagnosticsRuntime } from '../src/diagnostics-runtime.js';
import { createPublicHealthRuntime } from '../src/public-health.js';
import { createPublicStatusRouter, createPublicStatusRuntime } from '../src/public-status.js';
import { createReleaseFieldEvidenceRuntime } from '../src/release-field-evidence.js';
import { createAppCapabilitiesRuntime } from '../src/app-capabilities.js';

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');

test('Worker composition root stays below the post-audit architecture budget',()=>{
  const bytes=Buffer.byteLength(worker,'utf8');
  // #490 originally tightened this threshold using JavaScript string length,
  // while this guard measures actual UTF-8 bytes. Cyrillic product copy makes
  // those units materially different. Keep a strict byte budget above the
  // verified post-extraction baseline (~1.224 MB), not an impossible limit.
  assert.ok(
    bytes<=1_225_000,
    `src/worker.js grew to ${bytes} UTF-8 bytes; extract another cohesive runtime instead of growing the composition root`,
  );
});

test('extracted runtime factories are executable contracts, not source-only placeholders',async()=>{
  assert.equal(typeof createPublicHealthRuntime,'function');
  assert.equal(typeof createPublicStatusRuntime,'function');
  assert.equal(typeof createPublicStatusRouter,'function');
  assert.equal(typeof createReleaseFieldEvidenceRuntime,'function');
  assert.equal(typeof createDiagnosticsRuntime,'function');
  assert.equal(typeof createAppCapabilitiesRuntime,'function');

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
});

test('Worker composes extracted runtimes through explicit imports',()=>{
  assert.match(worker,/import \{ createPublicHealthRuntime \} from '\.\/public-health\.js'/);
  assert.match(worker,/import \{ createPublicStatusRouter, createPublicStatusRuntime \} from '\.\/public-status\.js'/);
  assert.match(worker,/import \{ createReleaseFieldEvidenceRuntime \} from '\.\/release-field-evidence\.js'/);
  assert.match(worker,/import \{ createDiagnosticsRuntime \} from '\.\/diagnostics-runtime\.js'/);
  assert.match(worker,/import \{ createAppCapabilitiesRuntime \} from '\.\/app-capabilities\.js'/);
  assert.match(worker,/createDiagnosticsRuntime\(\{/);
  assert.match(worker,/createPublicHealthRuntime\(\{/);
  assert.match(worker,/createPublicStatusRuntime\(\{/);
  assert.match(worker,/createPublicStatusRouter\(\{/);
  assert.match(worker,/createReleaseFieldEvidenceRuntime\(\{/);
  assert.match(worker,/createAppCapabilitiesRuntime\(\{/);
  assert.doesNotMatch(worker,/async function collectDiagnostics\(/);
  assert.doesNotMatch(worker,/async function readRecentOpsEvents\(/);
  assert.doesNotMatch(worker,/async function publicServiceStatus\(/);
  assert.doesNotMatch(worker,/async function computeReadinessSnapshot\(/);
  assert.doesNotMatch(worker,/async function claimReleaseEvidenceLock\(/);
  assert.doesNotMatch(worker,/async function recordClosedBetaConfigurationEvidence\(/);
  assert.doesNotMatch(worker,/async function probeReleaseProviderQuotaEvidence\(/);
  assert.doesNotMatch(worker,/async function captureReleaseFieldEvidence\(/);
});
