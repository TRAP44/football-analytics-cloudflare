import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVELOPMENT_TELEGRAM_ID,
  closedBetaAccessDecision,
} from '../src/access-control.js';
import { createBetaPhase5Runtime } from '../src/beta-phase5-runtime.js';
import { createProviderBudgetRuntime } from '../src/provider-budget-runtime.js';

const SUBJECT='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function betaRuntime(overrides = {}) {
  return createBetaPhase5Runtime({
    APP_VERSION:'6.120.0-rc144',
    CLOSED_BETA_COHORT:'closed_beta_v1',
    PHASE5_VALIDATION_COHORT:'phase5_public_v2',
    RC_NAME:'RC144',
    RELEASE_CHANNEL:'production',
    billingWebhookStatus:async()=>({ready:true,pendingUpdates:0,reason:''}),
    collectDiagnostics:async()=>({supabase:{ok:true},telegramWebhook:{state:'healthy'}}),
    hasSupabase:()=>true,
    isClosedBetaUser:()=>true,
    json:(body,status=200)=>({body,status}),
    providerSnapshot:()=>({}),
    readOpsEventsRange:async()=>({items:[],persistent:true,truncated:false}),
    recordOpsEvent:async()=>({}),
    redactOpsString:value=>String(value ?? ''),
    ...overrides,
  });
}

function clientRow(at, code, reason = '') {
  return {
    created_at:at,
    source:'client',
    event_type:'client_telemetry',
    code,
    metadata:{
      betaSubject:SUBJECT,
      betaCohort:'closed_beta_v1',
      betaMembershipVerified:true,
      ...(reason ? {reason} : {}),
    },
  };
}

function validQuotaRow(at, overrides = {}) {
  return {
    created_at:at,
    source:'provider',
    event_type:'quota_probe',
    code:'PROVIDER_QUOTA_CONFIRMED',
    metadata:{
      plan:'PRO',
      dailyLimit:7500,
      dailyRemaining:7000,
      minuteLimit:300,
      minuteRemaining:280,
      ...overrides,
    },
  };
}

function providerBudgetHarness(provider = {}) {
  const events=[];
  const memory={
    provider:{...provider},
    providerQuotaEvidenceAt:0,
  };
  const runtime=createProviderBudgetRuntime({
    clamp:(value,min,max)=>Math.max(min,Math.min(max,value)),
    freeQuotaHealthy:()=>true,
    getCache:async()=>null,
    hasSupabase:()=>false,
    memory,
    phase5ProviderUsage:()=>{},
    recordOpsEvent:async(_cfg,event)=>{events.push(event);},
    runtimeControlsSnapshot:()=>({}),
    setCache:async()=>{},
  });
  return {runtime,memory,events};
}

test('closed beta access is public-by-default but strict mode requires a validated beta member', () => {
  const signed={id:101,__telegramValidated:true};
  assert.deepEqual(
    closedBetaAccessDecision(signed,{betaAccessEnabled:false,betaTelegramIds:[]}),
    {allowed:true,adminBypass:false,betaParticipant:false},
  );
  assert.deepEqual(
    closedBetaAccessDecision(signed,{betaAccessEnabled:true,betaTelegramIds:[101]}),
    {allowed:true,adminBypass:false,betaParticipant:true},
  );
  assert.deepEqual(
    closedBetaAccessDecision(signed,{betaAccessEnabled:true,betaTelegramIds:[102]}),
    {allowed:false,adminBypass:false,betaParticipant:false},
  );

  const admin={id:900,__telegramValidated:true};
  assert.deepEqual(
    closedBetaAccessDecision(admin,{betaAccessEnabled:true,adminTelegramIds:[900],betaTelegramIds:[900]}),
    {allowed:true,adminBypass:true,betaParticipant:false},
  );

  const synthetic={id:DEVELOPMENT_TELEGRAM_ID,__developmentIdentity:true,__telegramValidated:false};
  assert.deepEqual(
    closedBetaAccessDecision(synthetic,{betaAccessEnabled:true,devMode:true,betaTelegramIds:[DEVELOPMENT_TELEGRAM_ID]}),
    {allowed:true,adminBypass:true,betaParticipant:false},
  );
});

test('single beta issue remains evidence-pending while repeated evidence becomes active', () => {
  const runtime=betaRuntime();
  const metrics={
    searchUsed:{events:5},
    matchOpen:{events:0},
    aiStart:{events:0},
    liveOpen:{events:0},
    miniAppLaunch:{events:5},
    historyOpen:{events:0},
    profileOpen:{events:0},
  };
  const one=runtime.buildBetaIssueGroups({
    metrics,
    errorRows:[{metadata:{action:'search',errorKind:'provider'}}],
    feedbackRows:[],
    timings:{},
    clientErrorRows:[],
  }).find(issue=>issue.category==='search');

  assert.equal(one.classification,'NEEDS_MORE_EVIDENCE');
  assert.equal(one.active,false);
  assert.equal(one.evidence,'needs_more_evidence');

  const repeated=runtime.buildBetaIssueGroups({
    metrics,
    errorRows:[
      {metadata:{action:'search',errorKind:'provider'}},
      {metadata:{action:'search',errorKind:'provider'}},
    ],
    feedbackRows:[],
    timings:{},
    clientErrorRows:[],
  }).find(issue=>issue.category==='search');

  assert.equal(repeated.classification,'MAJOR');
  assert.equal(repeated.active,true);
});

test('closed beta full journey requires the exact ordered path and a later re-entry', () => {
  const runtime=betaRuntime();
  const rows=[
    clientRow('2026-10-06T10:00:00.000Z','BOOT_OK'),
    clientRow('2026-10-06T10:01:00.000Z','PRODUCT_ACTION','search_used'),
    clientRow('2026-10-06T10:02:00.000Z','PRODUCT_ACTION','search_found'),
    clientRow('2026-10-06T10:03:00.000Z','PRODUCT_ACTION','match_open'),
    clientRow('2026-10-06T10:04:00.000Z','PRODUCT_ACTION','ai_start'),
    clientRow('2026-10-06T10:05:00.000Z','PRODUCT_ACTION','ai_complete'),
    clientRow('2026-10-06T10:06:00.000Z','PRODUCT_ACTION','history_open'),
    clientRow('2026-10-06T10:07:00.000Z','BOOT_OK'),
  ];
  const completed=runtime.betaJourneySummary([...rows].reverse());

  assert.equal(completed.betaUsers,1);
  assert.equal(completed.analysisCompleted,1);
  assert.equal(completed.fullCompleted,1);
  assert.equal(completed.stages.reentry,1);

  const wrongOrder=runtime.betaJourneySummary([
    clientRow('2026-10-06T10:00:00.000Z','BOOT_OK'),
    clientRow('2026-10-06T10:01:00.000Z','PRODUCT_ACTION','search_found'),
    clientRow('2026-10-06T10:02:00.000Z','PRODUCT_ACTION','search_used'),
    ...rows.slice(3),
  ]);
  assert.equal(wrongOrder.fullCompleted,0);

  const malformed=runtime.betaJourneySummary([
    ...rows.slice(0,7),
    clientRow('not-a-date','BOOT_OK'),
  ]);
  assert.equal(malformed.fullCompleted,0);

  const invalidOnly=runtime.betaJourneySummary([
    clientRow('not-a-date','BOOT_OK'),
  ]);
  assert.equal(invalidOnly.betaUsers,0);
});

test('provider quota launch evidence rejects future, ambiguous and impossible quota facts', () => {
  const runtime=betaRuntime();
  const now=Date.parse('2026-10-07T12:00:00.000Z');
  const validAt='2026-10-07T11:30:00.000Z';

  assert.equal(runtime.latestConfirmedProviderQuota([
    validQuotaRow(validAt),
  ],now).confirmed,true);

  for (const row of [
    validQuotaRow('2026-10-07T12:05:00.000Z'),
    validQuotaRow(validAt,{dailyRemaining:false}),
    validQuotaRow(validAt,{minuteLimit:null}),
    validQuotaRow(validAt,{dailyLimit:[7500]}),
    validQuotaRow(validAt,{minuteRemaining:['280']}),
    validQuotaRow(validAt,{dailyRemaining:-1}),
    validQuotaRow(validAt,{dailyRemaining:8000}),
    validQuotaRow(validAt,{plan:'UNKNOWN'}),
  ]) {
    assert.equal(runtime.latestConfirmedProviderQuota([row],now).confirmed,false);
  }

  const fallback=runtime.latestConfirmedProviderQuota([
    validQuotaRow('2026-10-07T11:45:00.000Z',{dailyRemaining:false}),
    validQuotaRow(validAt),
  ],now);
  assert.equal(fallback.confirmed,true);
  assert.equal(fallback.confirmedAt,validAt);
});

test('provider header parsing cannot fabricate zero quota values from missing headers', async () => {
  const {runtime,memory,events}=providerBudgetHarness();
  const partialHeaders=new Map([
    ['x-ratelimit-requests-limit','7500'],
    ['x-ratelimit-requests-remaining','7000'],
  ]);
  runtime.updateProviderFromHeaders({
    headers:{get:name=>partialHeaders.get(name) ?? null},
  });

  assert.equal(memory.provider.plan,'PRO');
  assert.equal(memory.provider.minuteLimit,null);
  assert.equal(memory.provider.minuteRemaining,null);
  assert.equal(memory.provider.updatedAt,null);
  assert.equal(runtime.completeProviderQuotaSnapshot(memory.provider),false);

  runtime.providerQuotaEvidence({});
  await Promise.resolve();
  assert.equal(events.length,0);

  const completeHeaders=new Map([
    ['x-ratelimit-requests-limit','7500'],
    ['x-ratelimit-requests-remaining','7000'],
    ['x-ratelimit-limit','300'],
    ['x-ratelimit-remaining','280'],
  ]);
  runtime.updateProviderFromHeaders({
    headers:{get:name=>completeHeaders.get(name) ?? null},
  });
  assert.equal(runtime.completeProviderQuotaSnapshot(memory.provider),true);
  assert.match(memory.provider.updatedAt,/^\d{4}-\d{2}-\d{2}T/);

  runtime.providerQuotaEvidence({});
  await Promise.resolve();
  assert.equal(events.length,1);
  assert.equal(events[0].code,'PROVIDER_QUOTA_CONFIRMED');
  assert.deepEqual(events[0].meta,{
    plan:'PRO',
    dailyLimit:7500,
    dailyRemaining:7000,
    minuteLimit:300,
    minuteRemaining:280,
    evidenceSource:'response_headers',
  });
  assert.doesNotMatch(JSON.stringify(events[0]),/apiFootballKey|x-apisports-key|TELEGRAM_BOT_TOKEN/);
});

test('provider quota boundary rejects arrays and coercive objects before they become launch evidence', async () => {
  const {runtime,memory,events}=providerBudgetHarness();
  const coerciveHeaders=new Map([
    ['x-ratelimit-requests-limit',['7500']],
    ['x-ratelimit-requests-remaining',{valueOf:()=>7000}],
    ['x-ratelimit-limit',['300']],
    ['x-ratelimit-remaining',{toString:()=> '280'}],
  ]);

  runtime.updateProviderFromHeaders({
    headers:{get:name=>coerciveHeaders.get(name) ?? null},
  });

  assert.equal(memory.provider.plan,'UNKNOWN');
  assert.equal(memory.provider.dailyLimit,null);
  assert.equal(memory.provider.dailyRemaining,null);
  assert.equal(memory.provider.minuteLimit,null);
  assert.equal(memory.provider.minuteRemaining,null);
  assert.equal(memory.provider.updatedAt,null);
  assert.equal(runtime.completeProviderQuotaSnapshot(memory.provider),false);

  runtime.providerQuotaEvidence({});
  await Promise.resolve();
  assert.equal(events.length,0);
});

test('beta launch dashboard uses only fresh complete provider quota evidence and never returns member ids', async () => {
  const now=new Date();
  const persistedAt=new Date(now.getTime()-5*60_000).toISOString();
  const ops=[validQuotaRow(persistedAt)];
  const runtime=betaRuntime({
    readOpsEventsRange:async()=>({items:ops,persistent:true,truncated:false}),
    providerSnapshot:()=>({
      plan:'PRO',
      dailyLimit:7500,
      dailyRemaining:false,
      minuteLimit:300,
      minuteRemaining:280,
      updatedAt:new Date(now.getTime()+5*60_000).toISOString(),
    }),
  });

  const result=await runtime.apiBetaDashboard(
    {url:'https://example.test/api/admin/beta-dashboard?days=7'},
    {
      betaAccessEnabled:true,
      betaTelegramIds:[101,102],
      adminTelegramIds:[],
      botToken:'configured',
    },
  );

  assert.equal(result.status,200);
  assert.equal(result.body.launchReadiness.status,'runtime_prerequisites_confirmed');
  assert.deepEqual(result.body.launchReadiness.blockers,[]);
  assert.equal(result.body.launchReadiness.providerQuota.source,'provider_monitor');
  assert.equal(result.body.launchReadiness.betaAssignments.assigned,2);
  assert.equal(result.body.launchReadiness.betaAssignments.idsReturned,false);
  assert.equal(result.body.privacy.telegramIdsReturned,false);
  assert.equal('betaTelegramIds' in result.body,false);
  assert.equal('adminTelegramIds' in result.body,false);
});

test('beta launch dashboard fails closed when quota, webhook or strict access evidence is missing', async () => {
  const runtime=betaRuntime({
    billingWebhookStatus:async()=>({ready:false,pendingUpdates:0,reason:'not_configured'}),
    providerSnapshot:()=>({
      plan:'PRO',
      dailyLimit:7500,
      dailyRemaining:null,
      minuteLimit:300,
      minuteRemaining:280,
      updatedAt:new Date().toISOString(),
    }),
  });

  const result=await runtime.apiBetaDashboard(
    {url:'https://example.test/api/admin/beta-dashboard?days=garbage'},
    {
      betaAccessEnabled:false,
      betaTelegramIds:[101],
      adminTelegramIds:[],
      botToken:'',
    },
  );

  assert.equal(result.status,200);
  assert.equal(result.body.periodDays,7);
  assert.equal(result.body.launchReadiness.status,'blocked');
  assert.ok(result.body.launchReadiness.blockers.includes('beta_accounts_not_assigned'));
  assert.ok(result.body.launchReadiness.blockers.includes('strict_beta_access_disabled'));
  assert.ok(result.body.launchReadiness.blockers.includes('telegram_webhook_unconfirmed'));
  assert.ok(result.body.launchReadiness.blockers.includes('provider_quota_unconfirmed'));
});
