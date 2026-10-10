import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBetaPhase5Runtime } from '../src/beta-phase5-runtime.js';

const BETA_COHORT='closed_beta_v1';
const PHASE5_COHORT='phase5_public_v2';
const SUBJECT_A='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SUBJECT_B='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SESSION_A='11111111111111111111111111111111';

function createHarness(overrides = {}) {
  const events=[];
  const now=new Date();
  const runtime=createBetaPhase5Runtime({
    APP_VERSION:'6.120.0',
    CLOSED_BETA_COHORT:BETA_COHORT,
    PHASE5_VALIDATION_COHORT:PHASE5_COHORT,
    RC_NAME:'RC144',
    RELEASE_CHANNEL:'production',
    billingWebhookStatus:async()=>({ready:true,pendingUpdates:0,reason:''}),
    collectDiagnostics:async()=>({
      supabase:{ok:true,status:'ok'},
      telegramWebhook:{state:'healthy'},
    }),
    hasSupabase:()=>true,
    isClosedBetaUser:user=>Number(user?.id)===101,
    json:(body,status=200)=>({body,status}),
    providerSnapshot:()=>({
      plan:'PRO',
      dailyLimit:7500,
      dailyRemaining:7000,
      minuteLimit:300,
      minuteRemaining:280,
      updatedAt:now.toISOString(),
    }),
    readOpsEventsRange:async()=>({items:[],persistent:true,truncated:false}),
    recordOpsEvent:async(_cfg,event)=>{events.push(event); return event;},
    redactOpsString:(value,max=500)=>String(value ?? '').slice(0,max),
    ...overrides,
  });
  return {runtime,events,now};
}

function betaMeta(subject=SUBJECT_A, extra={}) {
  return {
    betaCohort:BETA_COHORT,
    betaMembershipVerified:true,
    betaSubject:subject,
    ...extra,
  };
}

function betaClientRow({at,code,reason='',durationMs,subject=SUBJECT_A,metadata={}}) {
  return {
    created_at:at,
    source:'client',
    event_type:'client_telemetry',
    code,
    ...(durationMs !== undefined ? {duration_ms:durationMs} : {}),
    metadata:betaMeta(subject,{
      ...(reason ? {reason} : {}),
      ...metadata,
    }),
  };
}

function phase5Meta(extra={}) {
  return {
    validationCohort:PHASE5_COHORT,
    validationVerified:true,
    validationSubject:SUBJECT_A,
    validationSession:SESSION_A,
    ...extra,
  };
}

test('closed beta timing evidence ignores ambiguous and out-of-range durations', () => {
  const {runtime}=createHarness();
  const valid=[100,200,300,400,500,600,700,800,900,1000];
  const rows=[
    ...valid.map(duration_ms=>({
      source:'client',
      event_type:'client_telemetry',
      code:'OPERATION_TIMING',
      duration_ms,
      metadata:{reason:'search'},
    })),
    ...[false,null,'',-1,120001,Infinity].map(duration_ms=>({
      source:'client',
      event_type:'client_telemetry',
      code:'OPERATION_TIMING',
      duration_ms,
      metadata:{reason:'search'},
    })),
    {
      source:'client',
      event_type:'client_telemetry',
      code:'OPERATION_TIMING',
      duration_ms:1,
      metadata:{reason:'ai'},
    },
  ];

  const summary=runtime.betaTimingSummary(rows,'search');
  assert.equal(summary.samples,10);
  assert.equal(summary.medianMs,550);
  assert.equal(summary.p90Ms,910);
  assert.equal(runtime.betaPercentileMs([false,null,'',100,200,300],0.5),200);
  assert.equal(runtime.betaPercentileMs({not:'an array'},0.5),null);
});

test('feedback is open to every verified Telegram user and records no automatic identity fields', async () => {
  const {runtime,events}=createHarness();

  // Без подтверждённого Telegram (нет initData / отладочная личность) — отказ.
  const unverified=await runtime.apiBetaFeedback(
    {method:'POST',json:async()=>({category:'search',severity:'MAJOR',note:'Search is empty'})},
    {},
    {id:202},
  );
  assert.equal(unverified.status,401);
  assert.equal(unverified.body.code,'AUTH_REQUIRED');
  assert.equal(events.length,0);

  const invalid=await runtime.apiBetaFeedback(
    {method:'POST',json:async()=>({category:'unknown',severity:'MAJOR',note:'Search is empty'})},
    {},
    {id:101,__telegramValidated:true},
  );
  assert.equal(invalid.status,400);
  assert.equal(events.length,0);

  // Участник закрытой beta — как раньше, в beta-метрики.
  const beta=await runtime.apiBetaFeedback(
    {method:'POST',json:async()=>({category:' Search ',severity:'major',note:'Search result is empty'})},
    {},
    {id:101,username:'private-user',__telegramValidated:true},
  );
  assert.deepEqual(beta,{status:200,body:{ok:true}});
  assert.equal(events.length,1);
  const betaEvent=events[0];
  assert.equal(betaEvent.source,'beta');
  assert.equal(betaEvent.code,'BETA_FEEDBACK');
  assert.equal(betaEvent.meta.category,'search');
  assert.equal(betaEvent.meta.betaSeverity,'MAJOR');
  assert.equal(betaEvent.meta.explicitUserFeedback,true);
  assert.equal(betaEvent.meta.betaMembershipVerified,true);

  // Любой другой подтверждённый пользователь — отдельный тип, не смешивается с beta.
  const publicBlocker=await runtime.apiBetaFeedback(
    {method:'POST',json:async()=>({category:'ai',severity:'BLOCKER',note:'AI tab does not open'})},
    {},
    {id:202,username:'another-user',__telegramValidated:true},
  );
  assert.deepEqual(publicBlocker,{status:200,body:{ok:true}});
  assert.equal(events.length,2);
  const userEvent=events[1];
  assert.equal(userEvent.source,'feedback');
  assert.equal(userEvent.eventType,'user_feedback');
  assert.equal(userEvent.code,'USER_FEEDBACK');
  assert.equal(userEvent.severity,'warning');
  assert.equal(userEvent.meta.betaMembershipVerified,false);
  assert.equal('betaCohort' in userEvent.meta,false);

  for (const event of events) {
    assert.equal('userId' in event.meta,false);
    assert.equal('telegramId' in event.meta,false);
    assert.equal('username' in event.meta,false);
  }
  assert.doesNotMatch(JSON.stringify(events),/private-user|another-user|"202"|:202\b/);
});

test('one subjective feedback remains evidence-pending until repeated or correlated evidence exists', () => {
  const {runtime}=createHarness();
  const base={
    metrics:{
      searchUsed:{events:5},
      matchOpen:{events:0},
      aiStart:{events:0},
      liveOpen:{events:0},
      miniAppLaunch:{events:5},
      historyOpen:{events:0},
      profileOpen:{events:0},
    },
    errorRows:[],
    timings:{},
    clientErrorRows:[],
  };

  const single=runtime.buildBetaIssueGroups({
    ...base,
    feedbackRows:[{metadata:{category:'search',betaSeverity:'MAJOR'}}],
  }).find(issue=>issue.category==='search');

  assert.equal(single.classification,'NEEDS_MORE_EVIDENCE');
  assert.equal(single.active,false);
  assert.equal(single.evidence,'needs_more_evidence');

  const repeated=runtime.buildBetaIssueGroups({
    ...base,
    feedbackRows:[
      {metadata:{category:'search',betaSeverity:'MAJOR'}},
      {metadata:{category:'search',betaSeverity:'MAJOR'}},
    ],
  }).find(issue=>issue.category==='search');

  assert.equal(repeated.classification,'MAJOR');
  assert.equal(repeated.active,true);
  assert.equal(repeated.evidence,'repeated_feedback');
});

test('closed beta dashboard aggregates only verified in-window cohort rows and exposes truncation', async () => {
  const {now}=createHarness();
  const inside=new Date(now.getTime()-60_000).toISOString();
  const future=new Date(now.getTime()+10*60_000).toISOString();
  const rows=[
    betaClientRow({at:inside,code:'BOOT_OK'}),
    betaClientRow({at:inside,code:'PRODUCT_ACTION',reason:'search_used'}),
    betaClientRow({at:inside,code:'OPERATION_TIMING',reason:'search',durationMs:250}),
    {
      created_at:inside,
      source:'beta',
      event_type:'beta_feedback',
      code:'BETA_FEEDBACK',
      message:'sensitive-feedback-text',
      metadata:betaMeta(SUBJECT_A,{category:'search',betaSeverity:'MINOR',explicitUserFeedback:true}),
    },
    {
      ...betaClientRow({at:inside,code:'BOOT_OK',subject:SUBJECT_B}),
      metadata:betaMeta(SUBJECT_B,{betaMembershipVerified:false,rawQuery:'should-not-return'}),
    },
    betaClientRow({at:inside,code:'BOOT_OK',subject:'not-a-valid-subject'}),
    betaClientRow({at:'not-a-date',code:'BOOT_OK',subject:SUBJECT_B}),
    betaClientRow({at:future,code:'BOOT_OK',subject:SUBJECT_B}),
  ];

  const {runtime}=createHarness({
    readOpsEventsRange:async()=>({items:rows,persistent:true,truncated:true}),
  });
  const result=await runtime.apiBetaDashboard(
    {url:'https://example.test/api/beta-dashboard?days=garbage'},
    {
      betaAccessEnabled:true,
      betaTelegramIds:[101,102],
      adminTelegramIds:[],
      botToken:'configured',
    },
  );

  assert.equal(result.status,200);
  assert.equal(result.body.periodDays,7);
  assert.equal(result.body.metrics.miniAppLaunch.events,1);
  assert.equal(result.body.metrics.searchUsed.events,1);
  assert.equal(result.body.journey.betaUsers,1);
  assert.equal(result.body.timings.search.samples,1);
  assert.equal(result.body.sample.opsSampleLimited,true);
  assert.ok(result.body.expansionDecision.hardBlockers.includes('beta_ops_sample_truncated'));

  assert.equal(result.body.privacy.telegramIdsReturned,false);
  assert.equal(result.body.privacy.searchQueriesReturned,false);
  assert.equal(result.body.privacy.errorTextsReturned,false);
  assert.equal(result.body.privacy.feedbackTextsReturned,false);
  const serialized=JSON.stringify(result.body);
  assert.doesNotMatch(serialized,/sensitive-feedback-text|should-not-return/);
});

test('Phase 5 journey and provider summaries reject untimed or malformed evidence', () => {
  const {runtime}=createHarness();
  const at=new Date().toISOString();

  const journey=runtime.phase5JourneySummary([
    {
      created_at:'not-a-date',
      source:'client',
      event_type:'client_telemetry',
      code:'BOOT_OK',
      metadata:phase5Meta(),
    },
  ]);
  assert.equal(journey.verifiedNormalUsers,0);
  assert.equal(journey.sessions,0);

  const provider=runtime.phase5ProviderSummary([
    {
      created_at:at,
      source:'phase5',
      event_type:'provider_usage',
      code:'PHASE5_PROVIDER_USAGE',
      metadata:phase5Meta({
        requestKind:'search',
        networkRequests:2,
        cacheHits:1,
        staleCacheHits:0,
        quotaBlocks:0,
        sharedCooldowns:0,
      }),
    },
    {
      created_at:at,
      source:'phase5',
      event_type:'provider_usage',
      code:'PHASE5_PROVIDER_USAGE',
      metadata:phase5Meta({
        requestKind:'search',
        networkRequests:true,
        cacheHits:'999',
        quotaBlocks:false,
      }),
    },
    {
      created_at:at,
      source:'phase5',
      event_type:'provider_usage',
      code:'PHASE5_PROVIDER_USAGE',
      metadata:phase5Meta({
        requestKind:'unexpected_kind',
        networkRequests:500,
      }),
    },
  ],{sessions:1,users:1,fullJourneys:1});

  assert.equal(provider.networkRequests,2);
  assert.equal(provider.cacheHits,1);
  assert.equal(provider.requestsPerSession,2);
  assert.equal(provider.byFeature.search.requests,2);
  assert.equal('unexpected_kind' in provider.byFeature,false);
});

test('Phase 5 evidence gate does not coerce boolean or string counters into readiness', () => {
  const {runtime}=createHarness();
  const gate=runtime.phase5EvidenceGate({
    journey:{verifiedNormalUsers:'500',sessions:true,fullCompleted:'500'},
    timings:{
      search:{samples:'500'},
      match:{samples:true},
      ai:{samples:'500'},
      live:{samples:true},
    },
    coverage:{samples:'500',live:{samples:'500'}},
    opsSampleLimited:'false',
  });

  assert.equal(gate.thresholdsMet,false);
  for (const item of Object.values(gate.requirements)) {
    assert.equal(item.actual,0);
    assert.equal(item.pass,false);
  }
  assert.equal(gate.liveStatus,'INSUFFICIENT_LIVE_SAMPLE');
  assert.equal(gate.opsSampleLimited,false);
});

test('Phase 5 dashboard defaults malformed periods and honors backend truncation explicitly', async () => {
  const {runtime}=createHarness({
    readOpsEventsRange:async()=>({items:[],persistent:true,truncated:true}),
  });

  const result=await runtime.apiPhase5Dashboard(
    {url:'https://example.test/api/phase5-dashboard?days=not-a-number'},
    {betaAccessEnabled:false,botToken:'configured'},
  );

  assert.equal(result.status,200);
  assert.equal(result.body.periodDays,7);
  assert.equal(result.body.evidenceGate.opsSampleLimited,true);
  assert.equal(result.body.evidenceGate.thresholdsMet,false);
  assert.equal(result.body.sample.opsSampleLimited,true);
});

test('routing and UI keep observation admin-only while explicit feedback remains user-facing', () => {
  const router=readFileSync(new URL('../src/router.js',import.meta.url),'utf8');
  const publicHtml=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const adminHtml=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
  const dashboardModule=readFileSync(new URL('../public/modules/admin-beta-dashboard.js',import.meta.url),'utf8');

  assert.match(
    router,
    /pathname === '\/api\/beta-dashboard'[\s\S]*?!adminAllowed\(\)[\s\S]*?adminForbidden\(\)/,
  );
  assert.match(router,/pathname === '\/api\/beta-feedback'[\s\S]*?apiBetaFeedback\(request, cfg, user\)/);
  assert.match(publicHtml,/id="betaFeedbackOpenBtn"[^>]*>Сообщить о проблеме<\/button>/);
  assert.doesNotMatch(publicHtml,/id="betaFeedbackOpenBtn"[^>]*data-admin-only/);

  assert.match(adminHtml,/OWNER DASHBOARD/);
  assert.match(adminHtml,/id="betaHealthPanel"/);
  assert.match(adminHtml,/id="betaDashboardPanel"/);
  assert.match(adminHtml,/id="adminAdvancedTools"/);
  assert.match(dashboardModule,/\/api\/phase5-dashboard\?days=/);
});
