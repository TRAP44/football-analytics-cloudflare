import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBetaPhase5Runtime } from '../src/beta-phase5-runtime.js';

function runtime() {
  return createBetaPhase5Runtime({
    APP_VERSION:'6.120.0',
    CLOSED_BETA_COHORT:'closed_beta_v1',
    PHASE5_VALIDATION_COHORT:'phase5_public_v2',
    RC_NAME:'RC144',
    RELEASE_CHANNEL:'production',
    billingWebhookStatus:async()=>({ready:true}),
    collectDiagnostics:async()=>({}),
    hasSupabase:()=>true,
    isClosedBetaUser:()=>true,
    json:(body,status=200)=>({body,status}),
    providerSnapshot:()=>({}),
    readOpsEventsRange:async()=>({items:[],persistent:true,truncated:false}),
    recordOpsEvent:async()=>({}),
    redactOpsString:value=>String(value ?? ''),
  });
}

function providerQuota(overrides={}) {
  return {
    confirmed:true,
    plan:'PRO',
    dailyLimit:7500,
    dailyRemaining:7000,
    minuteLimit:300,
    minuteRemaining:280,
    ...overrides,
  };
}

function input(overrides={}) {
  return {
    expansionDecision:{
      expansionAllowed:true,
      dataCoverageDecision:'keep_current_provider',
      requirements:{
        betaUsers:{pass:true},
        sessionStarts:{pass:true},
        fullJourneys:{pass:true},
      },
      hardBlockers:[],
    },
    assignedBetaUsers:2,
    journey:{betaUsers:2,fullCompleted:1,stages:{reentry:1}},
    metrics:{
      miniAppLaunch:{events:2},
      searchUsed:{events:2},
      searchFound:{events:2},
      searchEmpty:{events:0},
      matchOpen:{events:2},
      aiStart:{events:2},
      aiComplete:{events:2},
      liveOpen:{events:1},
    },
    timings:{
      search:{samples:5},
      match:{samples:5},
      ai:{samples:5},
      live:{samples:3},
    },
    coverage:{
      samples:20,
      live:{samples:5,missing:{}},
    },
    issues:[],
    errorRows:[],
    clientErrorRows:[],
    providerQuota:providerQuota(),
    productionMonitor:{state:'healthy'},
    supabaseOk:true,
    telegramConfirmed:true,
    ...overrides,
  };
}

test('controlled beta expansion is manual and advances only through exact 2 → 4 → 6 waves',()=>{
  const api=runtime();

  const baseline=api.controlledBetaExpansionDecision(input());
  assert.equal(baseline.finalDecision,'BETA CONTINUE');
  assert.equal(baseline.automaticExpansion,false);
  assert.equal(baseline.waveSize,2);
  assert.deepEqual(baseline.nextWave,{targetAssigned:4,add:2,allowed:true});
  assert.deepEqual(baseline.waves,{
    baseline:{target:2,observed:true},
    wave1:{target:4,observed:false},
    wave2:{target:6,observed:false},
  });

  const wave1=api.controlledBetaExpansionDecision(input({
    assignedBetaUsers:4,
    journey:{betaUsers:4,fullCompleted:2,stages:{reentry:1}},
    metrics:{...input().metrics,miniAppLaunch:{events:4}},
  }));
  assert.equal(wave1.finalDecision,'BETA CONTINUE');
  assert.deepEqual(wave1.nextWave,{targetAssigned:6,add:2,allowed:true});

  const wave2=api.controlledBetaExpansionDecision(input({
    assignedBetaUsers:6,
    journey:{betaUsers:6,fullCompleted:4,stages:{reentry:2}},
    metrics:{...input().metrics,miniAppLaunch:{events:6}},
  }));
  assert.equal(wave2.finalDecision,'BETA READY FOR PUBLIC PRE-LAUNCH');
  assert.equal(wave2.nextWave,null);
});

test('irregular assignment counts cannot silently turn a +2 wave into a +1 or uncontrolled expansion',()=>{
  const api=runtime();

  for (const assigned of [3,5,7]) {
    const result=api.controlledBetaExpansionDecision(input({
      assignedBetaUsers:assigned,
      journey:{betaUsers:assigned,fullCompleted:4,stages:{reentry:2}},
    }));

    assert.equal(result.finalDecision,'BETA HOLD',String(assigned));
    assert.equal(result.nextWave,null,String(assigned));
    assert.ok(result.fieldBlockers.includes('beta_assignment_wave_mismatch'),String(assigned));
    assert.equal(result.nextRequiredAction,'reconcile_beta_assignments',String(assigned));
  }
});

test('controlled expansion rejects truthy strings, booleans and string counters as readiness evidence',()=>{
  const api=runtime();

  const result=api.controlledBetaExpansionDecision(input({
    expansionDecision:{
      expansionAllowed:'true',
      dataCoverageDecision:'keep_current_provider',
      requirements:{users:{pass:'true'}},
      hardBlockers:[],
    },
    assignedBetaUsers:'6',
    journey:{betaUsers:'6',fullCompleted:true,stages:{reentry:'9'}},
    metrics:{
      miniAppLaunch:{events:'99'},
      searchUsed:{events:true},
      searchFound:{events:'99'},
      searchEmpty:{events:false},
      matchOpen:{events:'99'},
      aiStart:{events:'99'},
      aiComplete:{events:'99'},
      liveOpen:{events:'99'},
    },
    timings:{
      search:{samples:'99'},
      match:{samples:true},
      ai:{samples:'99'},
      live:{samples:'99'},
    },
    coverage:{samples:'99',live:{samples:'99',missing:{}}},
    supabaseOk:'true',
    telegramConfirmed:'true',
  }));

  assert.equal(result.expansionAllowed,false);
  assert.equal(result.finalDecision,'BETA HOLD');
  assert.equal(result.assignedUsers,0);
  assert.equal(result.verifiedUsers,0);
  assert.equal(result.checks.miniAppLaunch,0);
  assert.equal(result.checks.search.used,0);
  assert.equal(result.checks.live.timingSamples,0);
  assert.ok(result.fieldBlockers.includes('beta_users_not_assigned'));
  assert.ok(result.fieldBlockers.includes('verified_beta_telemetry_missing'));
});

test('unknown or watch production monitoring cannot authorize another beta wave',()=>{
  const api=runtime();

  for (const state of ['unknown','watch','']) {
    const result=api.controlledBetaExpansionDecision(input({
      productionMonitor:{state},
    }));
    assert.equal(result.finalDecision,'BETA HOLD',state);
    assert.equal(result.nextWave?.allowed,false,state);
    assert.ok(result.fieldBlockers.includes('runtime_unhealthy'),state);
  }
});

test('provider quota must be explicitly confirmed and internally consistent',()=>{
  const api=runtime();

  for (const malformed of [
    providerQuota({confirmed:'true'}),
    providerQuota({dailyRemaining:false}),
    providerQuota({minuteLimit:null}),
    providerQuota({dailyRemaining:-1}),
    providerQuota({dailyRemaining:8000}),
    providerQuota({plan:'UNKNOWN'}),
  ]) {
    const result=api.controlledBetaExpansionDecision(input({providerQuota:malformed}));
    assert.equal(result.finalDecision,'BETA HOLD');
    assert.equal(result.providerSignals.quotaConfirmed,false);
    assert.ok(result.fieldBlockers.includes('provider_quota_unconfirmed'));
    assert.equal(result.nextRequiredAction,'confirm_provider_quota');
  }

  assert.equal(api.quotaRemainingPct(false,1),null);
  assert.equal(api.quotaRemainingPct(100,false),null);
  assert.equal(api.quotaRemainingPct(100,101),null);
  assert.equal(api.quotaRemainingPct(100,-1),null);
  assert.equal(api.quotaRemainingPct(100,10),10);
});

test('quota pressure after wave 1 requests provider review instead of allowing expansion',()=>{
  const api=runtime();
  const result=api.controlledBetaExpansionDecision(input({
    assignedBetaUsers:4,
    journey:{betaUsers:4,fullCompleted:2,stages:{reentry:1}},
    providerQuota:providerQuota({dailyRemaining:700}),
  }));

  assert.equal(result.providerSignals.quotaConfirmed,true);
  assert.equal(result.providerSignals.quotaPressure,true);
  assert.equal(result.providerValidationDecision,'review_new_or_paid_provider');
  assert.equal(result.finalDecision,'DATA PROVIDER UPGRADE REQUIRED');
  assert.equal(result.nextWave?.allowed,false);
  assert.ok(result.fieldBlockers.includes('provider_quota_pressure'));
  assert.ok(result.fieldBlockers.includes('provider_review_required'));
});

test('repeated rate-limit and repeated LIVE coverage gaps trigger provider review only from valid evidence',()=>{
  const api=runtime();

  const rateLimited=api.controlledBetaExpansionDecision(input({
    assignedBetaUsers:4,
    journey:{betaUsers:4,fullCompleted:2,stages:{reentry:1}},
    errorRows:[
      {metadata:{errorKind:'rate_limit'}},
      {metadata:{errorKind:'rate_limit'}},
      {metadata:{errorKind:'rate_limit'}},
    ],
  }));
  assert.equal(rateLimited.providerValidationDecision,'review_new_or_paid_provider');
  assert.equal(rateLimited.finalDecision,'DATA PROVIDER UPGRADE REQUIRED');

  const liveGap=api.controlledBetaExpansionDecision(input({
    assignedBetaUsers:4,
    journey:{betaUsers:4,fullCompleted:2,stages:{reentry:1}},
    coverage:{
      samples:20,
      live:{
        samples:5,
        missing:{
          lineups:{samples:5,missingPct:80},
          injuries:{samples:5,missingPct:90},
        },
      },
    },
  }));
  assert.equal(liveGap.providerSignals.liveCoverageDeficit,true);
  assert.equal(liveGap.providerSignals.liveMissingCategories,2);
  assert.equal(liveGap.finalDecision,'DATA PROVIDER UPGRADE REQUIRED');

  const malformedGap=api.controlledBetaExpansionDecision(input({
    assignedBetaUsers:4,
    journey:{betaUsers:4,fullCompleted:2,stages:{reentry:1}},
    coverage:{
      samples:20,
      live:{
        samples:'5',
        missing:{
          lineups:{samples:'5',missingPct:'80'},
          injuries:{samples:true,missingPct:90},
        },
      },
    },
  }));
  assert.equal(malformedGap.providerSignals.liveCoverageDeficit,false);
  assert.equal(malformedGap.providerValidationDecision,'keep_current_provider');
  assert.equal(malformedGap.finalDecision,'BETA CONTINUE');
});

test('production monitor summary ignores stale, future and impossible timestamps',()=>{
  const api=runtime();
  const now=Date.parse('2026-03-02T12:00:00.000Z');

  const result=api.betaProductionMonitorSummary([
    {
      source:'monitor',
      event_type:'production_monitor',
      code:'PRODUCTION_MONITOR_HEALTHY',
      created_at:'2026-03-02T11:59:00.000Z',
    },
    {
      source:'monitor',
      event_type:'production_monitor',
      code:'PRODUCTION_MONITOR_INCIDENT',
      created_at:'2026-03-02T12:05:00.000Z',
    },
    {
      source:'monitor',
      event_type:'production_monitor',
      code:'PRODUCTION_MONITOR_INCIDENT',
      created_at:'2026-02-30T11:59:00.000Z',
    },
    {
      source:'monitor',
      event_type:'production_monitor',
      code:'PRODUCTION_MONITOR_INCIDENT',
      created_at:'2026-03-02T04:00:00.000Z',
    },
  ],now);

  assert.equal(result.state,'healthy');
  assert.equal(result.latestCode,'PRODUCTION_MONITOR_HEALTHY');
  assert.equal(result.samples,1);
  assert.equal(result.incidentCount,0);

  assert.deepEqual(api.betaProductionMonitorSummary([],false),{
    state:'unknown',
    latestCode:'',
    lastSeen:null,
    samples:0,
    incidentCount:0,
    watchCount:0,
  });
});

test('admin primary beta dashboard remains Phase 5 oriented, not a manual wave control surface',()=>{
  const module=readFileSync(new URL('../public/modules/admin-beta-dashboard.js',import.meta.url),'utf8');

  assert.match(module,/\/api\/phase5-dashboard\?days=/);
  assert.match(module,/verifiedNormalUsers/);
  assert.match(module,/Provider requests\/session/);
  assert.match(module,/Capacity decision/);
  assert.match(module,/Coverage decision/);
  assert.match(module,/Phase 5 status/);
  assert.doesNotMatch(module,/Следующая beta-волна|Назначить beta-пользователя/);
});
