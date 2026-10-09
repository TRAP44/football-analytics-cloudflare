import { workerRuntime } from '../test-support/worker-root.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNewsImpactRecoveryRuntime } from '../src/news-impact-recovery-runtime.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const recoverySource=fs.readFileSync('src/news-impact-recovery-runtime.js','utf8');
const growth=fs.readFileSync('src/growth-analytics-runtime.js','utf8');
const router=fs.readFileSync('src/router.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

const FAILURE_CODES=new Set([
  'provider_rate_limit','provider_unavailable','quota_exhausted','analysis_warming',
  'match_missing','invalid_fixture','data_invalid','telegram_delivery','timeout','server_error',
]);
const ACTION_CODES=new Set(['full_ai','squads','market','recheck','news','share']);
const RECOVERY_CODES=new Set(['retry','retry_soon','retry_later','wait_quota_reset','open_search','open_full_ai']);
const GUARD_CODES=new Set(['performance_drift','recent_regression','fixed_default','insufficient_sample']);
const INCIDENT_CODES=new Set(['performance_drift','recent_regression']);

function runtime() {
  return createNewsImpactRecoveryRuntime({
    NEWS_IMPACT_ACTION_CODES:ACTION_CODES,
    NEWS_IMPACT_ACTION_LABELS:Object.fromEntries([...ACTION_CODES].map(code=>[code,code])),
    NEWS_IMPACT_FAILURE_CODES:FAILURE_CODES,
    NEWS_IMPACT_FAILURE_LABELS:Object.fromEntries([...FAILURE_CODES].map(code=>[code,code])),
    NEWS_IMPACT_RECOVERY_CODES:RECOVERY_CODES,
    NEWS_IMPACT_RECOVERY_LABELS:Object.fromEntries([...RECOVERY_CODES].map(code=>[code,code])),
    NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES:GUARD_CODES,
    NEWS_IMPACT_RECOVERY_INCIDENT_CODES:INCIDENT_CODES,
    NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES:30,
    NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES:120,
    NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES:360,
  });
}

test('RC85-RC89 implementations live in the shared recovery runtime and Worker delegates to them',()=>{
  for (const name of [
    'buildNewsImpactRecoveryIncidentEvents',
    'buildNewsImpactRecoveryIncidentCenter',
    'summarizeNewsImpactRecoveryIncidents',
    'buildNewsImpactRecoveryIncidentAcknowledgements',
    'buildNewsImpactRecoveryIncidentEpisodeHistory',
    'newsImpactRecoveryEpisodeSloState',
    'buildNewsImpactRecoveryIncidentSloDashboard',
    'buildNewsImpactRecoveryIncidentSloBreachFeed',
  ]) {
    assert.match(recoverySource,new RegExp('function '+name+'\\('),name+' implementation missing');
    assert.match(worker,new RegExp('function '+name+'\\(\\.\\.\\.args\\).*getNewsImpactRecoveryRuntime\\(\\)\\.'+name),name+' worker delegate missing');
  }
});

test('RC85 incident events are privacy-safe and malformed collections fail closed',()=>{
  const r=runtime();
  assert.deepEqual(r.buildNewsImpactRecoveryIncidentEvents({broken:true}),[]);

  const rows=[
    {created_at:'2026-09-23T10:00:00Z',metadata:{reason:'server_error',action:'full_ai',recovery:'retry',strategy:'fixed',strategy_guard:'performance_drift'}},
    {created_at:'2026-09-23T10:10:00Z',metadata:{reason:'server_error',action:'full_ai',recovery:'retry',strategy:'fixed',strategy_guard:'performance_drift'}},
    {created_at:'2026-09-23T10:20:00Z',metadata:{reason:'server_error',action:'full_ai',recovery:'retry',strategy:'fixed',strategy_guard:'fixed_default'}},
    {created_at:'2026-09-23T10:30:00Z',metadata:{
      reason:{toString(){throw new Error('must not coerce');}},
      action:'share',
      strategy_guard:{toString(){throw new Error('must not coerce');}},
    }},
  ];
  const events=r.buildNewsImpactRecoveryIncidentEvents(rows,{limit:true});
  assert.equal(events.length,2);
  assert.equal(events[0].reason,'server_error');
  assert.equal(events[0].priority,'high');
  assert.equal(events[0].episodeRecoveredAt,'2026-09-23T10:20:00.000Z');
  assert.equal(Object.prototype.hasOwnProperty.call(events[0],'telegram_id'),false);
});

test('RC86 acknowledgements require exact categorical strings and cannot precede the incident',()=>{
  const r=runtime();
  assert.deepEqual(r.buildNewsImpactRecoveryIncidentAcknowledgements({broken:true}),[]);

  const acknowledgements=r.buildNewsImpactRecoveryIncidentAcknowledgements([
    {created_at:'2026-09-23T10:05:00Z',metadata:{reason:'server_error',action:'full_ai',incident_guard:'performance_drift',incident_seen_at:'2026-09-23T10:00:00Z'}},
    {created_at:'2026-09-23T09:59:00Z',metadata:{reason:'server_error',action:'full_ai',incident_guard:'performance_drift',incident_seen_at:'2026-09-23T10:00:00Z'}},
    {created_at:'2026-09-23T10:06:00Z',metadata:{reason:{toString(){throw new Error('must not coerce');}},action:'full_ai',incident_guard:'performance_drift',incident_seen_at:'2026-09-23T10:00:00Z'}},
  ]);
  assert.equal(acknowledgements.length,1);
  assert.equal(acknowledgements[0].acknowledgedAt,'2026-09-23T10:05:00.000Z');

  assert.match(growth,/typeof body\?\.reason==='string'/);
  assert.match(growth,/typeof body\?\.code==='string'/);
  assert.match(growth,/typeof body\?\.lastSeenAt==='string'/);
  assert.match(router,/\/api\/recovery-incident-ack/);
  assert.match(router,/pathname === '\/api\/recovery-incident-ack'[\s\S]*?if \(!adminAllowed\(\)\) return adminForbidden\(\)/);
  assert.match(router,/recovery-incident-ack/);
});

test('RC85 incident center and summary restore the lifecycle contract',()=>{
  const r=runtime();
  const events=r.buildNewsImpactRecoveryIncidentEvents([
    {created_at:'2026-09-23T15:00:00Z',metadata:{reason:'server_error',action:'full_ai',recovery:'retry',strategy:'fixed',strategy_guard:'performance_drift'}},
  ]);
  const incidents=r.buildNewsImpactRecoveryIncidentCenter([
    {reason:'server_error',reasonLabel:'Server',action:'full_ai',actionLabel:'AI',strategy:'fixed',selectedRecovery:'retry',selectedRecoveryLabel:'Retry',guardReason:'performance_drift'},
  ],events,[],'ok',{asOfMs:Date.parse('2026-09-23T18:00:00Z')});
  assert.equal(incidents.length,1);
  assert.equal(incidents[0].status,'active');
  assert.equal(incidents[0].effectivePriority,'critical');
  assert.equal(incidents[0].slo.ageMinutes,180);

  const summary=r.summarizeNewsImpactRecoveryIncidents(incidents);
  assert.equal(summary.active,1);
  assert.equal(summary.criticalActive,1);
  assert.equal(summary.ackSloBreached,1);

  assert.deepEqual(r.summarizeNewsImpactRecoveryIncidents({broken:true}),{
    total:0,active:0,recovered:0,highActive:0,mediumActive:0,
    acknowledgedActive:0,unacknowledgedActive:0,suppressedAlerts:0,escalatedActive:0,
    criticalActive:0,ackSloBreached:0,recoverySloBreached:0,
    ackMeasured:0,recoveryMeasured:0,avgAckMinutes:null,avgRecoveryMinutes:null,latest:null,
  });
});

test('RC87 SLO state rejects malformed chronology instead of reporting a false success',()=>{
  const r=runtime();
  const asOfMs=Date.parse('2026-09-23T11:00:00Z');

  assert.equal(r.newsImpactRecoveryEpisodeSloState({startedAt:{toString(){throw new Error('must not coerce');}}},asOfMs),null);
  assert.equal(r.newsImpactRecoveryEpisodeSloState({
    startedAt:'2026-09-23T10:00:00Z',
    recoveredAt:'2026-09-23T09:59:00Z',
  },asOfMs),null);

  const earlyAck=r.newsImpactRecoveryEpisodeSloState({
    startedAt:'2026-09-23T10:00:00Z',
    firstAcknowledgedAt:'2026-09-23T09:59:00Z',
  },asOfMs);
  assert.equal(earlyAck.ackMet,false);
  assert.equal(earlyAck.ackBreached,true);

  const futureRecovery=r.newsImpactRecoveryEpisodeSloState({
    startedAt:'2026-09-23T10:00:00Z',
    recoveredAt:'2026-09-23T12:00:00Z',
  },asOfMs);
  assert.equal(futureRecovery.recoveryLatencyMinutes,null);
  assert.equal(futureRecovery.recoveryStatus,'pending');
});

test('RC88 dashboard handles malformed options and keeps literal active state',()=>{
  const r=runtime();
  const asOfMs=Date.parse('2026-09-23T18:00:00Z');
  const empty=r.buildNewsImpactRecoveryIncidentSloDashboard({broken:true},null);
  assert.equal(empty.weeks,4);
  assert.equal(empty.summary.episodes,0);

  const dashboard=r.buildNewsImpactRecoveryIncidentSloDashboard([
    {
      reason:'server_error',action:'full_ai',
      startedAt:'2026-09-23T16:00:00Z',
      firstAcknowledgedAt:null,recoveredAt:null,
      active:'false',
      guardCodes:['performance_drift',{toString(){throw new Error('must not coerce');}}],
    },
  ],{asOfMs,weeks:true});
  assert.equal(dashboard.weeks,4);
  assert.equal(dashboard.summary.episodes,1);
  assert.equal(dashboard.summary.active,0);
  assert.equal(dashboard.summary.recovered,1);
  assert.deepEqual(dashboard.repeated,[]);
});

test('RC89 breach feed rejects malformed containers, coercive labels and truthy active strings',()=>{
  const r=runtime();
  const asOfMs=Date.parse('2026-09-23T18:00:00Z');
  assert.deepEqual(
    r.buildNewsImpactRecoveryIncidentSloBreachFeed({broken:true},null).items,
    [],
  );

  const feed=r.buildNewsImpactRecoveryIncidentSloBreachFeed([
    {
      reason:'server_error',reasonLabel:{toString(){throw new Error('must not coerce');}},
      action:'full_ai',actionLabel:'AI',
      startedAt:'2026-09-23T10:00:00Z',
      lastSeenAt:'2026-09-23T12:00:00Z',
      active:'false',
      occurrences:true,
      guardCodes:['performance_drift',{toString(){throw new Error('must not coerce');}}],
    },
    {
      reason:{toString(){throw new Error('must not coerce');}},
      action:'share',startedAt:'2026-09-23T10:00:00Z',active:true,
    },
  ],{asOfMs,limit:true});
  assert.equal(feed.items.length,1);
  assert.equal(feed.items[0].reason,'server_error');
  assert.equal(feed.items[0].reasonLabel,'server_error');
  assert.equal(feed.items[0].active,false);
  assert.equal(feed.items[0].occurrences,0);
  assert.deepEqual(feed.items[0].guards,['performance_drift']);
  assert.equal(feed.privacy.telegramIdsExposed,false);
  assert.equal(feed.privacy.rawErrorsExposed,false);
  assert.equal(feed.privacy.freeTextExposed,false);
  assert.equal(feed.routingChanged,false);
});

test('RC85-RC89 admin, runtime and storage contracts remain present',()=>{
  for (const textValue of [
    'Recovery Incident Center',
    'Incident SLO Dashboard · 4 недели',
    'SLO Breach Feed',
    'ACK SLO просрочено',
    'Recovery SLO просрочено',
  ]) assert.ok(app.includes(textValue),textValue);

  for (const method of ['buildNewsImpactRecoveryIncidentCenter','buildNewsImpactRecoveryIncidentAcknowledgements','buildNewsImpactRecoveryIncidentSloDashboard','buildNewsImpactRecoveryIncidentSloBreachFeed']) {
    assert.equal(typeof workerRuntime.getNewsImpactRecoveryRuntime()[method],'function',method);
  }

  assert.equal(workerRuntime.getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentDrill().pass,true);
  assert.equal(workerRuntime.getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentAckDrill().pass,true);
  assert.equal(workerRuntime.getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloDrill().pass,true);
  assert.equal(workerRuntime.getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloDashboardDrill().pass,true);
  assert.equal(workerRuntime.getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloBreachFeedDrill().pass,true);

  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc8[5-9]/i.test(x)));
});
