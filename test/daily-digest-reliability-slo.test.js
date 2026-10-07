import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DAILY_DIGEST_RELIABILITY_SLO,
  assessDailyDigestReliabilitySlo,
  planDailyDigestReliabilitySloEvent,
  summarizeDailyDigestReliability,
} from '../src/daily-digest-incidents.js';
import { createProductionMonitorRuntime } from '../src/production-monitor-runtime.js';
import { createReleaseMonitorApiRuntime } from '../src/release-monitor-api-runtime.js';

function event(date, code='DAILY_DIGEST_RUN_OK', metadata={}, severity='info', time='07:55:00Z') {
  return {
    created_at:`${date}T${time}`,
    severity,
    source:'telegram',
    event_type:'daily_digest',
    code,
    metadata:{date,...metadata},
  };
}

function sampleDays({completion=1, backlogDates=[], rateLimitDates=[]}={}) {
  const dates=['2026-09-27','2026-09-28','2026-09-29'];
  return dates.map((date,index)=>{
    const claimed=100;
    const sent=Math.round(claimed*completion);
    const remaining=backlogDates.includes(date) ? 10 : 0;
    const rateLimited=rateLimitDates.includes(date) ? 2 : 0;
    return event(date,remaining?'DAILY_DIGEST_RUN_DEFERRED':'DAILY_DIGEST_RUN_OK',{
      sent,
      claimed,
      remaining,
      backlog:remaining,
      rateLimited,
      failed:0,
      completionRate:completion,
    },'info',index===2?'07:55:00Z':'07:50:00Z');
  });
}

function sloRow(plan, createdAt) {
  return {
    created_at:createdAt,
    severity:plan.severity,
    source:plan.source,
    event_type:plan.eventType,
    code:plan.code,
    metadata:plan.meta,
  };
}

function releaseHistoryReader(fetchWithTimeout) {
  return createReleaseMonitorApiRuntime({
    fetchWithTimeout,
    hasSupabase:()=>true,
    memory:{opsEvents:[],releaseMonitor:null},
    supaHeaders:()=>({}),
  });
}

test('missing run stays collecting before 08:15 UTC and becomes watch at the cutoff',()=>{
  const before=assessDailyDigestReliabilitySlo([],{
    nowMs:Date.parse('2026-09-29T08:14:59Z'),
  });
  const after=assessDailyDigestReliabilitySlo([],{
    nowMs:Date.parse('2026-09-29T08:15:00Z'),
  });

  assert.equal(DAILY_DIGEST_RELIABILITY_SLO.missingRunHourUtc,8);
  assert.equal(DAILY_DIGEST_RELIABILITY_SLO.missingRunMinuteUtc,15);
  assert.equal(before.state,'collecting');
  assert.equal(before.reason,'before_delivery_window_completion');
  assert.equal(after.state,'watch');
  assert.equal(after.code,'DAILY_DIGEST_SLO_MISSING_RUN');
  assert.equal(after.reason,'missing_run');
  assert.deepEqual(after.diagnostics.window,{
    startUtc:'07:00',
    endUtc:'07:55',
    cutoffUtc:'08:15',
    timezone:'UTC',
  });
});

test('future, impossible and date-mismatched rows cannot suppress a missing-run watch',()=>{
  const now=Date.parse('2026-09-29T08:15:00Z');
  const rows=[
    event('2026-09-29','DAILY_DIGEST_RUN_OK',{
      sent:100,claimed:100,remaining:0,completionRate:1,
    },'info','09:00:00Z'),
    {
      ...event('2026-09-28','DAILY_DIGEST_RUN_OK',{
        sent:100,claimed:100,remaining:0,completionRate:1,
      }),
      metadata:{date:'2026-09-29',sent:100,claimed:100,remaining:0,completionRate:1},
    },
    {
      ...event('2026-09-29','DAILY_DIGEST_RUN_OK',{
        sent:100,claimed:100,remaining:0,completionRate:1,
      }),
      created_at:'2026-02-30T07:55:00Z',
    },
  ];

  const result=assessDailyDigestReliabilitySlo(rows,{nowMs:now});

  assert.equal(result.state,'watch');
  assert.equal(result.code,'DAILY_DIGEST_SLO_MISSING_RUN');
  assert.equal(result.diagnostics.todayRunObserved,false);
  assert.equal(result.diagnostics.lastSuccessfulDigestRun,null);
});

test('non-array history is safe and reliability aggregation remains aggregate-only',()=>{
  assert.doesNotThrow(()=>summarizeDailyDigestReliability({broken:true},{
    nowMs:Date.parse('2026-09-29T08:15:00Z'),
  }));
  assert.doesNotThrow(()=>assessDailyDigestReliabilitySlo({broken:true},{
    nowMs:Date.parse('2026-09-29T08:15:00Z'),
  }));

  const summary=summarizeDailyDigestReliability(sampleDays(),{
    nowMs:Date.parse('2026-09-29T08:15:00Z'),
  });
  assert.equal(summary.sampleDays,3);
  assert.equal(summary.totals.claimed,300);
  assert.equal(summary.completionRate,1);
  assert.equal(summary.evidenceValid,true);
  assert.equal(summary.policy.aggregateOnly,true);
  assert.equal(summary.policy.userIdentifiers,false);
  assert.doesNotMatch(JSON.stringify(summary),/telegram_id|chat_id|user_id/i);
});

test('incomplete persistent history cannot produce a healthy SLO after cutoff',()=>{
  const result=assessDailyDigestReliabilitySlo(sampleDays(),{
    nowMs:Date.parse('2026-09-29T08:15:00Z'),
    evidenceComplete:false,
  });

  assert.equal(result.state,'watch');
  assert.equal(result.code,'DAILY_DIGEST_SLO_EVIDENCE_INCOMPLETE');
  assert.equal(result.reason,'evidence_incomplete');
  assert.equal(result.diagnostics.evidenceComplete,false);
});

test('healthy, low-completion, recurring backlog and recurring rate limits use real aggregate evidence',()=>{
  const nowMs=Date.parse('2026-09-29T08:15:00Z');

  const healthy=assessDailyDigestReliabilitySlo(sampleDays(),{nowMs});
  assert.equal(healthy.state,'healthy');
  assert.equal(healthy.code,'DAILY_DIGEST_SLO_OK');

  const completion=assessDailyDigestReliabilitySlo(sampleDays({completion:0.95}),{nowMs});
  assert.equal(completion.state,'watch');
  assert.equal(completion.code,'DAILY_DIGEST_SLO_COMPLETION');

  const backlog=assessDailyDigestReliabilitySlo(sampleDays({
    backlogDates:['2026-09-27','2026-09-28'],
  }),{nowMs});
  assert.equal(backlog.state,'watch');
  assert.equal(backlog.code,'DAILY_DIGEST_SLO_BACKLOG_REPEATED');

  const rateLimit=assessDailyDigestReliabilitySlo(sampleDays({
    rateLimitDates:['2026-09-27','2026-09-28'],
  }),{nowMs});
  assert.equal(rateLimit.state,'watch');
  assert.equal(rateLimit.code,'DAILY_DIGEST_SLO_RATE_LIMIT_REPEATED');
});

test('insufficient delivery volume stays collecting instead of enforcing trend thresholds',()=>{
  const result=assessDailyDigestReliabilitySlo([
    event('2026-09-29','DAILY_DIGEST_RUN_OK',{
      sent:10,
      claimed:10,
      remaining:0,
      completionRate:1,
    }),
  ],{
    nowMs:Date.parse('2026-09-29T08:15:00Z'),
  });

  assert.equal(result.state,'collecting');
  assert.equal(result.reason,'insufficient_sample');
});

test('internally impossible or malformed run counters become an evidence-integrity watch',()=>{
  const rows=[
    ...sampleDays(),
    event('2026-09-29','DAILY_DIGEST_RUN_OK',{
      sent:101,
      claimed:100,
      remaining:0,
      completionRate:1,
    },'info','08:00:00Z'),
  ];
  const impossible=assessDailyDigestReliabilitySlo(rows,{
    nowMs:Date.parse('2026-09-29T08:15:00Z'),
  });

  assert.equal(impossible.state,'watch');
  assert.equal(impossible.code,'DAILY_DIGEST_SLO_EVIDENCE_INVALID');
  assert.equal(impossible.reliability.evidenceValid,false);
  assert.equal(impossible.reliability.invalidEvidenceRuns,1);

  const malformed=assessDailyDigestReliabilitySlo([
    event('2026-09-27','DAILY_DIGEST_RUN_OK',{sent:true,claimed:100,completionRate:2}),
    ...sampleDays().slice(1),
  ],{
    nowMs:Date.parse('2026-09-29T08:15:00Z'),
  });
  assert.equal(malformed.state,'watch');
  assert.equal(malformed.code,'DAILY_DIGEST_SLO_EVIDENCE_INVALID');
});

test('transition metadata sanitizes malformed counters and only trusted SLO history deduplicates',()=>{
  const assessment={
    state:'watch',
    code:'DAILY_DIGEST_SLO_COMPLETION',
    reason:'completion_rate',
    reasons:['completion_rate',{raw:'drop'},' rate_limit_days '],
    date:'2026-09-29',
    message:'watch',
    diagnostics:{evaluatedAt:'2026-09-29T08:15:00Z'},
    reliability:{
      sampleDays:'NaN',
      totals:{claimed:'Infinity'},
      completionRate:2,
      backlog:{days:-1},
      rateLimitDays:1.5,
      incidents:{count:'bad'},
      degradedDays:3,
    },
  };

  const foreignRow={
    created_at:'2026-09-29T08:14:00Z',
    severity:'warning',
    source:'monitor',
    event_type:'production_monitor',
    code:'DAILY_DIGEST_SLO_COMPLETION',
    metadata:{date:'2026-09-29',state:'watch'},
  };
  const futureSloRow={
    ...foreignRow,
    created_at:'2026-09-29T09:00:00Z',
    source:'digest_slo',
    event_type:'reliability_slo',
  };

  const plan=planDailyDigestReliabilitySloEvent(assessment,[foreignRow,futureSloRow]);
  assert.equal(plan.action,'record');
  assert.equal(plan.meta.sampleDays,0);
  assert.equal(plan.meta.claimed,0);
  assert.equal(plan.meta.completionRate,null);
  assert.equal(plan.meta.backlogDays,0);
  assert.equal(plan.meta.rateLimitDays,0);
  assert.deepEqual(plan.meta.reasons,['completion_rate','[object Object]','rate_limit_days']);

  const trusted=sloRow(plan,'2026-09-29T08:15:00Z');
  const duplicate=planDailyDigestReliabilitySloEvent(assessment,[trusted]);
  assert.equal(duplicate.action,'none');
  assert.equal(duplicate.reason,'watch_episode_already_recorded');
});

test('missing-run watch recovers once a late real run is observed and recovery is deduplicated',()=>{
  const missing=assessDailyDigestReliabilitySlo([],{
    nowMs:Date.parse('2026-09-29T08:15:00Z'),
  });
  const first=planDailyDigestReliabilitySloEvent(missing,[]);
  assert.equal(first.action,'record');

  const prior=[sloRow(first,'2026-09-29T08:15:00Z')];
  const late=assessDailyDigestReliabilitySlo([
    event('2026-09-29','DAILY_DIGEST_RUN_OK',{
      sent:10,
      claimed:10,
      remaining:0,
      completionRate:1,
    },'info','08:20:00Z'),
  ],{
    nowMs:Date.parse('2026-09-29T08:30:00Z'),
  });

  assert.equal(late.state,'collecting');
  assert.equal(late.reason,'insufficient_sample');
  assert.equal(late.diagnostics.todayRunObserved,true);

  const recovery=planDailyDigestReliabilitySloEvent(late,prior);
  assert.equal(recovery.action,'record');
  assert.equal(recovery.code,'DAILY_DIGEST_SLO_RECOVERED');
  assert.equal(recovery.meta.reason,'missing_run_recovered');
  assert.equal(recovery.meta.lastSuccessfulDigestRun,'2026-09-29T08:20:00.000Z');

  const duplicate=planDailyDigestReliabilitySloEvent(
    late,
    [...prior,sloRow(recovery,'2026-09-29T08:30:00Z')],
  );
  assert.equal(duplicate.action,'none');
});

test('trend watch remains one episode across UTC days, while missing-run resets daily',()=>{
  const priorTrend={
    created_at:'2026-09-29T08:15:00Z',
    severity:'warning',
    source:'digest_slo',
    event_type:'reliability_slo',
    code:'DAILY_DIGEST_SLO_COMPLETION',
    metadata:{date:'2026-09-29',state:'watch',reason:'completion_rate'},
  };
  const trendAssessment={
    state:'watch',
    code:'DAILY_DIGEST_SLO_BACKLOG_REPEATED',
    reason:'backlog_days',
    date:'2026-09-30',
    message:'watch',
    diagnostics:{evaluatedAt:'2026-09-30T08:15:00Z'},
    reliability:{sampleDays:4,totals:{claimed:400},completionRate:1,backlog:{days:2}},
  };
  assert.equal(
    planDailyDigestReliabilitySloEvent(trendAssessment,[priorTrend]).reason,
    'watch_episode_already_recorded',
  );

  const missing=assessDailyDigestReliabilitySlo([],{
    nowMs:Date.parse('2026-09-30T08:15:00Z'),
  });
  const priorMissing={
    ...priorTrend,
    code:'DAILY_DIGEST_SLO_MISSING_RUN',
    metadata:{date:'2026-09-29',state:'watch',reason:'missing_run'},
  };
  const reset=planDailyDigestReliabilitySloEvent(missing,[priorMissing]);
  assert.equal(reset.action,'record');
  assert.equal(reset.code,'DAILY_DIGEST_SLO_MISSING_RUN');
  assert.equal(reset.meta.date,'2026-09-30');
});

test('digest history reader distinguishes exact cap from real truncation',async()=>{
  const baseRows=Array.from({length:1000},(_,index)=>({
    created_at:`2026-09-29T07:${String(index%60).padStart(2,'0')}:00Z`,
    source:'telegram',
    event_type:'daily_digest',
    code:'DAILY_DIGEST_RUN_OK',
    metadata:{date:'2026-09-29'},
  }));

  for (const [probeRows,expected] of [[[],false],[[baseRows[0]],true]]) {
    const calls=[];
    const reader=releaseHistoryReader(async url=>{
      const parsed=new URL(String(url));
      calls.push({
        limit:parsed.searchParams.get('limit'),
        offset:parsed.searchParams.get('offset'),
      });
      const offset=Number(parsed.searchParams.get('offset') || 0);
      return {
        ok:true,
        async json(){return offset===0 ? baseRows : probeRows;},
      };
    });

    const result=await reader.readDailyDigestOpsEvents(
      {supabaseUrl:'https://example.supabase.co'},
      '2026-09-22T00:00:00.000Z',
      '2026-09-30T00:00:00.000Z',
      1000,
    );

    assert.equal(result.persistent,true);
    assert.equal(result.items.length,1000);
    assert.equal(result.truncated,expected);
    assert.deepEqual(calls,[
      {limit:'1000',offset:null},
      {limit:'1',offset:'1000'},
    ]);
  }
});

test('production monitor propagates digest SLO watch state and its built-in lifecycle drill passes',()=>{
  const runtime=createProductionMonitorRuntime({
    assessDailyDigestReliabilitySlo,
    planDailyDigestReliabilitySloEvent,
  });

  const healthy=runtime.productionMonitorState({
    supabaseOk:true,
    schemaOk:true,
    releaseState:'healthy',
    providerHealth:'ok',
    providerSloState:'healthy',
    dailyDigestSloState:'healthy',
    telegramDedupeState:'healthy',
    persistent:true,
  });
  const watch=runtime.productionMonitorState({
    supabaseOk:true,
    schemaOk:true,
    releaseState:'healthy',
    providerHealth:'ok',
    providerSloState:'healthy',
    dailyDigestSloState:'watch',
    telegramDedupeState:'healthy',
    persistent:true,
  });

  assert.equal(healthy.state,'healthy');
  assert.equal(watch.state,'watch');
  assert.equal(runtime.productionMonitorSelfTest().pass,true);
});

test('admin monitor renders digest reliability only as aggregate operational data',()=>{
  const releaseMonitor=fs.readFileSync('public/modules/admin-release-monitor.js','utf8');
  const start=releaseMonitor.indexOf("const slo = dd.reliabilitySlo || {};");
  const end=releaseMonitor.indexOf("const codes = c.topCodes || [];",start);
  assert.ok(start>=0 && end>start);

  const block=releaseMonitor.slice(start,end);
  assert.match(block,/Reliability SLO/);
  assert.match(block,/SLO требует контроля/);
  assert.doesNotMatch(block,/telegram_id|chat_id|user_id|destination_key/i);
});
