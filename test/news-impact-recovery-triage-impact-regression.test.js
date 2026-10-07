import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNewsImpactRecoveryRuntime } from '../src/news-impact-recovery-runtime.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const recoverySource=fs.readFileSync('src/news-impact-recovery-runtime.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

function runtime() {
  return createNewsImpactRecoveryRuntime({
    NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES:30,
    NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES:120,
    NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES:360,
  });
}

test('RC90-RC94 implementations live in recovery runtime and Worker delegates',()=>{
  for (const name of [
    'buildNewsImpactRecoveryIncidentSloBreachWatchlist',
    'buildNewsImpactRecoveryIncidentSloBreachTriage',
    'newsImpactRecoveryIncidentTriageStageAt',
    'buildNewsImpactRecoveryIncidentSloBreachTriageTrend',
    'newsImpactRecoveryIncidentSloBurden',
    'buildNewsImpactRecoveryIncidentSloBreachImpactRanking',
    'newsImpactRecoveryIncidentOverdueWithinWindow',
    'buildNewsImpactRecoveryIncidentSloBreachImpactTrend',
  ]) {
    assert.match(recoverySource,new RegExp('function '+name+'\\('),name+' implementation missing');
    assert.match(worker,new RegExp('function '+name+'\\(\\.\\.\\.args\\).*getNewsImpactRecoveryRuntime\\(\\)\\.'+name),name+' Worker delegate missing');
  }
});

test('RC90 watchlist requires literal active=true and strips unknown sensitive fields',()=>{
  const r=runtime();
  const watchlist=r.buildNewsImpactRecoveryIncidentSloBreachWatchlist({
    available:true,
    generatedAt:'2026-09-23T18:00:00.000Z',
    items:[
      {
        reason:'server_error',reasonLabel:'Server',action:'full_ai',actionLabel:'AI',
        active:true,severity:'critical',ageMinutes:610,breachTypes:['ack','recovery'],
        startedAt:'2026-09-23T08:00:00.000Z',
        telegram_id:777,rawError:'secret',
      },
      {
        reason:'timeout',action:'share',active:'true',severity:'high',
        ageMinutes:500,breachTypes:['ack'],
      },
      {
        reason:'provider_unavailable',action:'market',active:true,severity:'high',
        ageMinutes:70,breachTypes:['ack','bad'],
      },
    ],
    repeated:[
      {reason:'server_error',action:'full_ai',breachEpisodes:3,activeBreaches:1},
    ],
  },{limit:true});

  assert.equal(watchlist.summary.active,2);
  assert.equal(watchlist.items.length,2);
  assert.equal(watchlist.items[0].reason,'server_error');
  assert.equal(watchlist.items.some(row=>row.reason==='timeout'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(watchlist.items[0],'telegram_id'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(watchlist.items[0],'rawError'),false);
  assert.deepEqual(watchlist.items.find(row=>row.reason==='provider_unavailable')?.breachTypes,['ack']);

  const malformed=r.buildNewsImpactRecoveryIncidentSloBreachWatchlist({broken:true},null);
  assert.deepEqual(malformed.items,[]);
  assert.equal(malformed.available,true);
});

test('RC91 triage uses safe RC87 thresholds and does not trust truthy active or numeric coercion',()=>{
  const r=runtime();
  const triage=r.buildNewsImpactRecoveryIncidentSloBreachTriage({
    available:true,
    thresholds:{ackMinutes:true,criticalAckMinutes:true,recoveryMinutes:true},
    items:[
      {reason:'server_error',action:'full_ai',active:true,ageMinutes:610,breachTypes:['ack','recovery']},
      {reason:'provider_unavailable',action:'full_ai',active:true,ageMinutes:180,breachTypes:['ack']},
      {reason:'timeout',action:'share',active:true,ageMinutes:70,breachTypes:['ack']},
      {reason:'match_missing',action:'news',active:'true',ageMinutes:999,breachTypes:['recovery']},
    ],
  },{limit:true});

  assert.equal(triage.summary.total,3);
  assert.equal(triage.summary.recoveryOverdue,1);
  assert.equal(triage.summary.ackCritical,1);
  assert.equal(triage.summary.ackOverdue,1);
  assert.equal(triage.thresholds.ackMinutes,30);
  assert.equal(triage.thresholds.criticalAckMinutes,120);
  assert.equal(triage.thresholds.recoveryMinutes,360);
  assert.deepEqual(triage.items.map(row=>row.triageStage),[
    'recovery_overdue','ack_critical','ack_overdue',
  ]);
});

test('RC92 stage reconstruction rejects malformed chronology and unsafe labels',()=>{
  const r=runtime();
  const asOfMs=Date.parse('2026-09-23T11:00:00Z');

  assert.equal(r.newsImpactRecoveryIncidentTriageStageAt({
    startedAt:{toString(){throw new Error('must not coerce');}},
  },asOfMs),null);

  assert.equal(r.newsImpactRecoveryIncidentTriageStageAt({
    startedAt:'2026-09-23T10:00:00Z',
    recoveredAt:'2026-09-23T09:59:00Z',
  },asOfMs),null);

  assert.equal(r.newsImpactRecoveryIncidentTriageStageAt({
    startedAt:'2026-09-23T10:00:00Z',
    firstAcknowledgedAt:'2026-09-23T09:59:00Z',
  },asOfMs),'ack_overdue');

  const trend=r.buildNewsImpactRecoveryIncidentSloBreachTriageTrend([
    {
      reason:'server_error',action:'full_ai',
      startedAt:'2026-09-01T00:00:00Z',recoveredAt:null,firstAcknowledgedAt:null,
    },
    {
      reason:{toString(){throw new Error('must not coerce');}},
      action:'share',startedAt:'2026-09-01T00:00:00Z',
    },
  ],{asOfMs,weeks:true});
  assert.equal(trend.weeks,4);
  assert.equal(trend.stuck.some(row=>row.action==='share'),false);

  const empty=r.buildNewsImpactRecoveryIncidentSloBreachTriageTrend({broken:true},null);
  assert.equal(empty.weekly.length,4);
  assert.equal(empty.summary.currentTotal,0);
});

test('RC93 burden ignores impossible ACK timestamps and rejects recovery before incident start',()=>{
  const r=runtime();
  const asOfMs=Date.parse('2026-09-23T12:00:00Z');

  assert.equal(r.newsImpactRecoveryIncidentSloBurden({
    startedAt:'2026-09-23T10:00:00Z',
    recoveredAt:'2026-09-23T09:00:00Z',
  },asOfMs),null);

  const burden=r.newsImpactRecoveryIncidentSloBurden({
    startedAt:'2026-09-23T10:00:00Z',
    firstAcknowledgedAt:'2026-09-23T09:59:00Z',
  },asOfMs);
  assert.equal(burden.elapsedMinutes,120);
  assert.equal(burden.ackOverdueMinutes,90);
  assert.equal(burden.recoveryOverdueMinutes,0);

  const ranking=r.buildNewsImpactRecoveryIncidentSloBreachImpactRanking([
    {
      reason:'server_error',reasonLabel:'Server',action:'full_ai',actionLabel:'AI',
      startedAt:'2026-09-23T10:00:00Z',firstAcknowledgedAt:null,
      telegram_id:777,rawError:'secret',
    },
    {
      reason:{toString(){throw new Error('must not coerce');}},
      action:'share',startedAt:'2026-09-23T10:00:00Z',
    },
  ],{asOfMs,limit:true});

  assert.equal(ranking.ranking.length,1);
  assert.equal(ranking.ranking[0].reason,'server_error');
  assert.equal(Object.prototype.hasOwnProperty.call(ranking.ranking[0],'telegram_id'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(ranking.ranking[0],'rawError'),false);
});

test('RC94 weekly impact windows reject malformed containers and impossible chronology',()=>{
  const r=runtime();
  const asOfMs=Date.parse('2026-09-23T18:00:00Z');

  assert.equal(r.newsImpactRecoveryIncidentOverdueWithinWindow({
    startedAt:'2026-09-23T10:00:00Z',
    recoveredAt:'2026-09-23T09:00:00Z',
  },Date.parse('2026-09-23T00:00:00Z'),asOfMs),null);

  const burden=r.newsImpactRecoveryIncidentOverdueWithinWindow({
    startedAt:'2026-09-23T10:00:00Z',
    firstAcknowledgedAt:'2026-09-23T09:59:00Z',
  },Date.parse('2026-09-23T00:00:00Z'),Date.parse('2026-09-23T12:00:00Z'));
  assert.equal(burden.ackOverdueMinutes,90);

  const trend=r.buildNewsImpactRecoveryIncidentSloBreachImpactTrend({broken:true},null);
  assert.equal(trend.weeks,4);
  assert.equal(trend.weekly.length,4);
  assert.equal(trend.summary.currentOverdueMinutes,0);

  const clean=r.buildNewsImpactRecoveryIncidentSloBreachImpactTrend([
    {
      reason:'server_error',action:'full_ai',
      startedAt:'2026-09-01T00:00:00Z',recoveredAt:null,firstAcknowledgedAt:null,
    },
    {
      reason:{toString(){throw new Error('must not coerce');}},
      action:'share',startedAt:'2026-09-01T00:00:00Z',
    },
  ],{asOfMs,weeks:true,limit:true});
  assert.equal(clean.weeks,4);
  assert.equal(clean.pairs.some(row=>row.action==='share'),false);
});

test('RC90-RC94 deterministic runtime drills are restored and passing',()=>{
  const r=runtime();
  for (const [name,result] of [
    ['watchlist',r.newsImpactRecoveryIncidentSloBreachWatchlistDrill()],
    ['triage',r.newsImpactRecoveryIncidentSloBreachTriageDrill()],
    ['triageTrend',r.newsImpactRecoveryIncidentSloBreachTriageTrendDrill()],
    ['impactRanking',r.newsImpactRecoveryIncidentSloBreachImpactRankingDrill()],
    ['impactTrend',r.newsImpactRecoveryIncidentSloBreachImpactTrendDrill()],
  ]) {
    assert.equal(result.pass,true,name+' drill failed');
    assert.ok(result.cases>0,name+' drill has no cases');
  }
});

test('RC90-RC94 preserve factual UI, privacy, routing and methodology contracts',()=>{
  for (const textValue of [
    'SLO Breach Watchlist',
    'SLO Breach Triage Queue',
    'Triage Trend · 4 недели',
    'SLO Breach Impact Ranking',
    'SLO Impact Trend · 4 недели',
  ]) assert.ok(app.includes(textValue),textValue);

  assert.match(recoverySource,/source:'rc87_existing_slo'/);
  assert.match(recoverySource,/methodology:'sum_minutes_above_existing_ack_and_recovery_slo'/);
  assert.match(recoverySource,/methodology:'weekly_overlap_minutes_above_existing_ack_and_recovery_slo'/);
  assert.match(recoverySource,/privacy:\{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false\}/);
  assert.match(recoverySource,/routingChanged:false/);
  assert.match(recoverySource,/persistence:'none'/);
});

test('RC90-RC94 need no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc9[0-4]/i.test(x)));
});
