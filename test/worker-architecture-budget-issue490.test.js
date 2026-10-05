import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDiagnosticsRuntime } from '../src/diagnostics-runtime.js';
import { createPublicHealthRuntime } from '../src/public-health.js';
import { createAppCapabilitiesRuntime } from '../src/app-capabilities.js';

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');

test('Worker composition root stays below the post-audit architecture budget',()=>{
  const bytes=Buffer.byteLength(worker,'utf8');
  assert.ok(
    bytes<=1_175_000,
    `src/worker.js grew to ${bytes} bytes; extract another cohesive runtime instead of growing the composition root`,
  );
});

test('extracted runtime factories are executable contracts, not source-only placeholders',async()=>{
  assert.equal(typeof createPublicHealthRuntime,'function');
  assert.equal(typeof createDiagnosticsRuntime,'function');
  assert.equal(typeof createAppCapabilitiesRuntime,'function');

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
  assert.match(worker,/import \{ createDiagnosticsRuntime \} from '\.\/diagnostics-runtime\.js'/);
  assert.match(worker,/import \{ createAppCapabilitiesRuntime \} from '\.\/app-capabilities\.js'/);
  assert.match(worker,/createDiagnosticsRuntime\(\{/);
  assert.match(worker,/createPublicHealthRuntime\(\{/);
  assert.match(worker,/createAppCapabilitiesRuntime\(\{/);
  assert.doesNotMatch(worker,/async function collectDiagnostics\(/);
  assert.doesNotMatch(worker,/async function readRecentOpsEvents\(/);
});
