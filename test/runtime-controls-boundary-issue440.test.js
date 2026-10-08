import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRuntimeControlsRuntime } from '../src/runtime-controls.js';

const DEFAULT_RUNTIME_CONTROLS = Object.freeze({
  maintenanceMode: false,
  analysisEnabled: true,
  searchEnabled: true,
  liveEnabled: true,
  remindersEnabled: true,
  expandedDataEnabled: true,
  autoSettlementRecoveryEnabled: false,
  message: '',
  revision: 1,
  updatedAt: null,
});

function runtime(overrides = {}) {
  const memory = { runtimeControls: null };
  const events = [];
  let nowMs = 1_700_000_000_000;
  const api = createRuntimeControlsRuntime({
    memory,
    DEFAULT_RUNTIME_CONTROLS,
    RUNTIME_CONTROLS_CACHE_MS: 30_000,
    SUPABASE_SCHEMA_GUIDANCE: 'schema guidance',
    APP_VERSION: 'test',
    hasSupabase: overrides.hasSupabase || (() => false),
    supaSelectOne: overrides.supaSelectOne || (async () => null),
    supaInsertIgnore: overrides.supaInsertIgnore || (async () => null),
    supaSelectMany: overrides.supaSelectMany || (async () => []),
    fetchWithTimeout: overrides.fetchWithTimeout || (async () => new Response('[]', { status: 200 })),
    supaHeaders: () => ({ authorization: 'test' }),
    recordOpsEvent: async (_cfg, event) => { events.push(event); },
    redactOpsString: value => String(value || '').slice(0, 160),
    json: (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
    isAdminUser: overrides.isAdminUser || (() => false),
    clock: () => nowMs,
  });
  return {
    api,
    memory,
    events,
    setNow(value) { nowMs = value; },
  };
}

test('runtime-controls reject JavaScript boolean and revision coercion',async()=>{
  const {api}=runtime();
  const normalized=api.normalizeRuntimeControls({
    maintenance_mode:'false',
    analysis_enabled:'false',
    search_enabled:1,
    live_enabled:true,
    reminders_enabled:true,
    expanded_data_enabled:true,
    auto_settlement_recovery_enabled:'true',
    message:{toString:()=> 'hidden'},
    revision:true,
    updated_at:{toString:()=> '2026-10-04T12:00:00.000Z'},
  });
  assert.deepEqual(normalized,{
    ...DEFAULT_RUNTIME_CONTROLS,
    liveEnabled:true,
    remindersEnabled:true,
    expandedDataEnabled:true,
  });
});

test('malformed persisted runtime row activates fail-closed control plane',async()=>{
  const {api}=runtime({
    hasSupabase:()=>true,
    supaSelectOne:async()=>({
      id:'global',
      revision:4,
      maintenance_mode:'false',
      analysis_enabled:true,
      search_enabled:true,
      live_enabled:true,
      reminders_enabled:true,
      expanded_data_enabled:true,
      auto_settlement_recovery_enabled:false,
    }),
  });
  const state=await api.loadRuntimeControls({});
  assert.equal(state.schemaReady,false);
  assert.equal(state.source,'fail_closed');
  assert.equal(state.value.controlPlaneFailClosed,true);
  assert.equal(state.value.maintenanceMode,true);
  assert.equal(state.value.analysisEnabled,false);
});

test('runtime control cache rejects force truthiness and clock rollback',async()=>{
  let reads=0;
  const {api,setNow}=runtime({
    hasSupabase:()=>true,
    supaSelectOne:async()=>{
      reads+=1;
      return {
        id:'global',
        revision:4,
        maintenance_mode:false,
        analysis_enabled:true,
        search_enabled:true,
        live_enabled:true,
        reminders_enabled:true,
        expanded_data_enabled:true,
        auto_settlement_recovery_enabled:false,
      };
    },
  });
  await api.loadRuntimeControls({});
  setNow(1_699_999_999_000);
  await api.loadRuntimeControls({}, {force:'true'});
  assert.equal(reads,2);
});

test('runtime-controls domain normalizes database rows and exposes only public control state', () => {
  const { api } = runtime();
  const normalized = api.normalizeRuntimeControls({
    maintenance_mode: true,
    analysis_enabled: false,
    search_enabled: true,
    live_enabled: false,
    reminders_enabled: true,
    expanded_data_enabled: false,
    auto_settlement_recovery_enabled: true,
    message: 'maintenance',
    revision: 7,
    updated_at: '2026-10-04T12:00:00.000Z',
  });

  assert.deepEqual(api.publicRuntimeControls(normalized), {
    maintenanceMode: true,
    analysisEnabled: false,
    searchEnabled: true,
    liveEnabled: false,
    remindersEnabled: true,
    expandedDataEnabled: false,
    autoSettlementRecoveryEnabled: true,
    securityLockdown: false,
    controlPlaneFailClosed: false,
    message: 'maintenance',
    revision: 7,
    updatedAt: '2026-10-04T12:00:00.000Z',
  });
});

test('runtime-controls domain default clock uses Date.now and does not crash production wiring', async () => {
  const memory = { runtimeControls: null };
  const api = createRuntimeControlsRuntime({
    memory,
    DEFAULT_RUNTIME_CONTROLS,
    RUNTIME_CONTROLS_CACHE_MS: 30_000,
    SUPABASE_SCHEMA_GUIDANCE: 'schema guidance',
    APP_VERSION: 'test',
    hasSupabase: () => false,
    supaSelectOne: async () => null,
    supaInsertIgnore: async () => null,
    supaSelectMany: async () => [],
    fetchWithTimeout: async () => new Response('[]', { status: 200 }),
    supaHeaders: () => ({ authorization: 'test' }),
    recordOpsEvent: async () => {},
    redactOpsString: value => String(value || '').slice(0, 160),
    json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    isAdminUser: () => false,
  });

  const state = await api.loadRuntimeControls({});
  assert.equal(state.source, 'fail_closed');
  assert.equal(Number.isFinite(Number(memory.runtimeControls.loadedAt)), true);
});

test('default public snapshot preserves control-plane fail-closed state',async()=>{
  const {api}=runtime({hasSupabase:()=>false});
  await api.loadRuntimeControls({});
  const snapshot=api.runtimeControlsSnapshot();
  const publicSnapshot=api.publicRuntimeControls();
  assert.equal(snapshot.controlPlaneFailClosed,true);
  assert.equal(snapshot.controlPlaneReason,'supabase_not_configured');
  assert.equal(publicSnapshot.controlPlaneFailClosed,true);
  assert.equal(publicSnapshot.securityLockdown,true);
});

test('persisted runtime rows missing control flags fail closed instead of defaulting enabled',async()=>{
  const {api}=runtime({
    hasSupabase:()=>true,
    supaSelectOne:async()=>({id:'global',revision:4,analysis_enabled:true}),
  });
  const state=await api.loadRuntimeControls({});
  assert.equal(state.schemaReady,false);
  assert.equal(state.source,'fail_closed');
  assert.equal(state.value.analysisEnabled,false);
  assert.equal(state.value.searchEnabled,false);
});

test('runtime-controls domain fails closed when the control plane cannot be verified', async () => {
  const { api, memory } = runtime({ hasSupabase: () => false });
  const state = await api.loadRuntimeControls({});

  assert.equal(state.schemaReady, false);
  assert.equal(state.failClosed, true);
  assert.equal(state.source, 'fail_closed');
  assert.equal(state.value.controlPlaneFailClosed, true);
  assert.equal(state.value.controlPlaneReason, 'supabase_not_configured');
  assert.equal(memory.runtimeControls.value.controlPlaneFailClosed, true);
});

test('runtime-controls domain caches a verified control row for the configured TTL', async () => {
  let reads = 0;
  const { api, setNow } = runtime({
    hasSupabase: () => true,
    supaSelectOne: async () => {
      reads += 1;
      return {
        id:'global',
        revision:4,
        maintenance_mode:false,
        analysis_enabled:true,
        search_enabled:true,
        live_enabled:true,
        reminders_enabled:true,
        expanded_data_enabled:true,
        auto_settlement_recovery_enabled:false,
      };
    },
  });

  const first = await api.loadRuntimeControls({});
  setNow(1_700_000_010_000);
  const second = await api.loadRuntimeControls({});

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(reads, 1);
  assert.equal(second.value.revision, 4);
});

test('direct runtime update cannot spoof rollback audit provenance',async()=>{
  const {api}=runtime({
    hasSupabase:()=>true,
    supaSelectOne:async()=>({
      id:'global',
      revision:9,
      maintenance_mode:false,
      analysis_enabled:true,
      search_enabled:true,
      live_enabled:true,
      reminders_enabled:true,
      expanded_data_enabled:true,
      auto_settlement_recovery_enabled:false,
    }),
  });
  const result=await api.saveRuntimeControls({}, {id:123}, {
    expectedRevision:9,
    maintenanceMode:false,
    analysisEnabled:true,
    searchEnabled:true,
    liveEnabled:true,
    remindersEnabled:true,
    expandedDataEnabled:true,
    autoSettlementRecoveryEnabled:false,
    action:'rollback',
    sourceRevision:3,
  });
  assert.equal(result.status,400);
  assert.equal(result.code,'RUNTIME_CONTROLS_ACTION_INVALID');
});

test('runtime control update requires strict booleans and revision identity',async()=>{
  const {api}=runtime({
    hasSupabase:()=>true,
    supaSelectOne:async()=>({
      id:'global',
      revision:9,
      maintenance_mode:false,
      analysis_enabled:true,
      search_enabled:true,
      live_enabled:true,
      reminders_enabled:true,
      expanded_data_enabled:true,
      auto_settlement_recovery_enabled:false,
    }),
  });

  const coercedRevision=await api.saveRuntimeControls({}, {id:123}, {expectedRevision:true});
  assert.equal(coercedRevision.code,'RUNTIME_CONTROLS_CONFLICT');

  const malformed=await api.saveRuntimeControls({}, {id:123}, {
    expectedRevision:9,
    maintenanceMode:'false',
    analysisEnabled:true,
    searchEnabled:true,
    liveEnabled:true,
    remindersEnabled:true,
    expandedDataEnabled:true,
    autoSettlementRecoveryEnabled:false,
  });
  assert.equal(malformed.status,400);
  assert.equal(malformed.code,'RUNTIME_CONTROLS_INPUT');
});

test('rollback rejects inconsistent or malformed history snapshots',async()=>{
  const {api}=runtime({
    hasSupabase:()=>true,
    fetchWithTimeout:async()=>new Response('[]',{status:200}),
    supaSelectOne:async(_cfg,table)=>{
      if(table==='runtime_control_history'){
        return {
          id:5,
          revision:3,
          snapshot:{
            revision:2,
            maintenanceMode:false,
            analysisEnabled:true,
            searchEnabled:true,
            liveEnabled:true,
            remindersEnabled:true,
            expandedDataEnabled:true,
            autoSettlementRecoveryEnabled:false,
          },
        };
      }
      return null;
    },
  });
  const result=await api.rollbackRuntimeControls({supabaseUrl:'https://db.test'}, {id:1}, {
    expectedRevision:9,
    historyId:5,
  });
  assert.equal(result.status,409);
  assert.equal(result.code,'RUNTIME_ROLLBACK_SNAPSHOT_INVALID');
});

test('history listing drops malformed rows instead of exposing rollback targets',async()=>{
  const {api}=runtime({
    supaSelectMany:async()=>[
      {
        id:1,
        revision:3,
        action:'update',
        snapshot:{
          revision:3,
          maintenanceMode:false,
          analysisEnabled:true,
          searchEnabled:true,
          liveEnabled:true,
          remindersEnabled:true,
          expandedDataEnabled:true,
          autoSettlementRecoveryEnabled:false,
        },
      },
      {
        id:true,
        revision:4,
        snapshot:{revision:4},
      },
      {
        id:3,
        revision:5,
        snapshot:{revision:4},
      },
    ],
  });
  const rows=await api.listRuntimeHistory({},true);
  assert.equal(rows.length,1);
  assert.equal(rows[0].id,1);
  assert.equal(rows[0].revision,3);
});

test('runtime-controls domain preserves optimistic revision conflict semantics', async () => {
  const { api } = runtime({
    hasSupabase: () => true,
    supaSelectOne: async () => ({
      id:'global',
      revision:9,
      maintenance_mode:false,
      analysis_enabled:true,
      search_enabled:true,
      live_enabled:true,
      reminders_enabled:true,
      expanded_data_enabled:true,
      auto_settlement_recovery_enabled:false,
    }),
  });

  const result = await api.saveRuntimeControls({}, { id:123 }, { expectedRevision:8 });
  assert.equal(result.status, 409);
  assert.equal(result.code, 'RUNTIME_CONTROLS_CONFLICT');
  assert.equal(result.current.revision, 9);
});

test('corrupted runtime state is treated as fail-closed lockdown by the guard',async()=>{
  const {api}=runtime();
  const response=api.runtimeGuard(
    new Request('https://example.com/api/analyze',{method:'POST'}),
    {id:1},
    {},
    {analysisEnabled:'true'},
  );
  assert.equal(response.status,503);
  const body=await response.json();
  assert.equal(body.category,'security_lockdown');
  assert.equal(body.runtime.controlPlaneFailClosed,true);
});

test('corrupted cached runtime state is not served as a verified cache hit',async()=>{
  let reads=0;
  const {api,memory}=runtime({
    hasSupabase:()=>true,
    supaSelectOne:async()=>{
      reads+=1;
      return {
        id:'global',
        revision:4,
        maintenance_mode:false,
        analysis_enabled:true,
        search_enabled:true,
        live_enabled:true,
        reminders_enabled:true,
        expanded_data_enabled:true,
        auto_settlement_recovery_enabled:false,
      };
    },
  });
  await api.loadRuntimeControls({});
  memory.runtimeControls.value.analysisEnabled='true';
  const second=await api.loadRuntimeControls({});
  assert.equal(second.cached,false);
  assert.equal(reads,2);
  assert.equal(second.value.analysisEnabled,true);
});

test('runtime-controls domain preserves maintenance and feature guards for normal users', async () => {
  const { api } = runtime();

  const maintenance = api.runtimeGuard(
    new Request('https://example.com/api/matches'),
    { id:1 },
    {},
    { ...DEFAULT_RUNTIME_CONTROLS, maintenanceMode:true, message:'planned work' },
  );
  assert.equal(maintenance.status, 503);
  assert.equal((await maintenance.json()).code, 'MAINTENANCE_MODE');

  const analysis = api.runtimeGuard(
    new Request('https://example.com/api/analyze', { method:'POST' }),
    { id:1 },
    {},
    { ...DEFAULT_RUNTIME_CONTROLS, analysisEnabled:false },
  );
  assert.equal(analysis.status, 503);
  assert.equal((await analysis.json()).code, 'ANALYSIS_DISABLED');
});

test('runtime guard requires strict admin boolean and handles malformed request URL fail-closed',async()=>{
  const truthy=runtime({isAdminUser:()=> 'true'});
  const blocked=truthy.api.runtimeGuard(
    new Request('https://example.com/api/search'),
    {id:99},
    {},
    {...DEFAULT_RUNTIME_CONTROLS,maintenanceMode:true,searchEnabled:false},
  );
  assert.equal(blocked.status,503);

  const malformed=runtime();
  const response=malformed.api.runtimeGuard(
    {method:'POST',url:'not a url'},
    {id:1},
    {},
    DEFAULT_RUNTIME_CONTROLS,
  );
  assert.equal(response.status,400);
  assert.equal((await response.json()).code,'RUNTIME_REQUEST_INVALID');
});

test('runtime-controls domain keeps administrators exempt from ordinary feature toggles', () => {
  const { api } = runtime({ isAdminUser: () => true });
  const response = api.runtimeGuard(
    new Request('https://example.com/api/search'),
    { id:99 },
    {},
    { ...DEFAULT_RUNTIME_CONTROLS, maintenanceMode:true, searchEnabled:false },
  );
  assert.equal(response, null);
});

test('worker composition root wires the extracted runtime-controls domain instead of owning its implementation', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  const lines = worker.split('\n').length;

  assert.match(worker, /import \{ createRuntimeControlsRuntime \} from '\.\/runtime-controls\.js';/);
  assert.match(worker, /= createRuntimeControlsRuntime\(\{/);
  assert.doesNotMatch(worker, /^function runtimeControlsSnapshot\(\)/m);
  assert.doesNotMatch(worker, /^async function saveRuntimeControls\(/m);
  assert.doesNotMatch(worker, /^async function apiRuntimeControls\(/m);
  assert.ok(lines < 25500, `expected worker.js below 25,500 lines after extraction, got ${lines}`);
});

test('public runtime-control snapshot exposes fail-closed state without private diagnostics',()=>{
  const {api}=runtime();
  const publicState=api.publicRuntimeControls({
    ...DEFAULT_RUNTIME_CONTROLS,
    controlPlaneFailClosed:true,
    controlPlaneReason:'internal_database_failure',
    secret:'do-not-expose',
  });
  assert.equal(publicState.controlPlaneFailClosed,true);
  assert.equal('controlPlaneReason' in publicState,false);
  assert.equal('secret' in publicState,false);
  assert.equal(publicState.analysisEnabled,true);
  assert.equal(publicState.securityLockdown,false);
});
