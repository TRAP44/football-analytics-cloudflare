import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  assessDailyDigestReliabilitySlo,
  summarizeDailyDigestReliability,
} from '../src/daily-digest-incidents.js';
import { createReleaseMonitorApiRuntime } from '../src/release-monitor-api-runtime.js';

const NOW=Date.parse('2026-09-29T08:00:00Z');

function event(at,code,metadata={},severity='info') {
  return {
    created_at:at,
    severity,
    source:'telegram',
    event_type:'daily_digest',
    code,
    metadata,
  };
}

function healthyRun(date,sent=100,claimed=100,time='07:55:00Z') {
  return event(`${date}T${time}`,'DAILY_DIGEST_RUN_OK',{
    date,
    sent,
    claimed,
    failed:0,
    rateLimited:0,
    remaining:0,
    backlog:0,
    completionRate:claimed>0 ? Number((sent/claimed).toFixed(4)) : 1,
  });
}

function releaseReader(fetchWithTimeout,memoryOps=[]) {
  return createReleaseMonitorApiRuntime({
    fetchWithTimeout,
    hasSupabase:()=>true,
    memory:{opsEvents:[...memoryOps],releaseMonitor:null},
    supaHeaders:()=>({Authorization:'Bearer test'}),
  });
}

test('reliability aggregates delivery volume and tracks backlog plus rate-limit days',()=>{
  const rows=[
    event('2026-09-28T07:50:00Z','DAILY_DIGEST_BACKLOG_LATE',{
      date:'2026-09-28',
      sent:90,
      claimed:100,
      failed:1,
      rateLimited:2,
      remaining:10,
      backlog:10,
      completionRate:0.9,
    },'warning'),
    healthyRun('2026-09-28',10,10),
    healthyRun('2026-09-29'),
  ];

  const result=summarizeDailyDigestReliability(rows,{days:7,nowMs:NOW});

  assert.equal(result.available,true);
  assert.equal(result.days,7);
  assert.equal(result.sampleDays,2);
  assert.equal(result.runs,3);
  assert.equal(result.observedEvents,3);
  assert.deepEqual(result.totals,{
    sent:200,
    claimed:210,
    failed:1,
    rateLimited:2,
  });
  assert.equal(result.completionRate,0.9524);
  assert.deepEqual(result.backlog,{
    occurrences:1,
    days:1,
    maxRecipients:10,
  });
  assert.equal(result.rateLimitDays,1);
  assert.equal(result.evidenceValid,true);
});

test('multiple same-day incident episodes preserve incident-day SLO semantics',()=>{
  const rows=[
    healthyRun('2026-09-27'),
    healthyRun('2026-09-28'),
    event('2026-09-29T07:20:00Z','DAILY_DIGEST_BACKLOG_LATE',{
      date:'2026-09-29',
      remaining:5,
      backlog:5,
    },'warning'),
    event('2026-09-29T07:25:00Z','DAILY_DIGEST_RUN_OK',{
      date:'2026-09-29',
      remaining:0,
      backlog:0,
    }),
    event('2026-09-29T07:30:00Z','DAILY_DIGEST_SEALED_CLAIMS',{
      date:'2026-09-29',
      sealedClaims:1,
      remaining:0,
      backlog:0,
    },'warning'),
    event('2026-09-29T07:32:00Z','DAILY_DIGEST_RUN_OK',{
      date:'2026-09-29',
      remaining:0,
      backlog:0,
    }),
    healthyRun('2026-09-29',100,100,'07:55:00Z'),
  ];

  const reliability=summarizeDailyDigestReliability(rows,{days:7,nowMs:NOW});
  assert.equal(reliability.incidents.count,1);
  assert.equal(reliability.incidents.episodes,2);
  assert.equal(reliability.incidents.recovered,2);
  assert.equal(reliability.incidents.active,0);
  assert.equal(reliability.incidents.averageRecoveryMinutes,3.5);
  assert.equal(reliability.incidents.maxRecoveryMinutes,5);
  assert.equal(reliability.policy.incidentCountUnit,'days');

  const slo=assessDailyDigestReliabilitySlo(rows,{
    nowMs:Date.parse('2026-09-29T08:15:00Z'),
  });
  assert.equal(slo.reliability.incidents.count,1);
  assert.equal(slo.reliability.incidents.episodes,2);
  assert.notEqual(slo.code,'DAILY_DIGEST_SLO_INCIDENT_REPEATED');
});

test('sealed, degraded and truncated flags count once per calendar delivery day',()=>{
  const rows=[
    event('2026-09-27T07:10:00Z','DAILY_DIGEST_SEALED_CLAIMS',{
      date:'2026-09-27',
      sealedClaims:2,
      remaining:0,
    },'warning'),
    event('2026-09-27T07:15:00Z','DAILY_DIGEST_SEALED_CLAIMS',{
      date:'2026-09-27',
      sealedClaims:1,
      remaining:0,
    },'warning'),
    event('2026-09-28T07:20:00Z','DAILY_DIGEST_RUN_DEGRADED',{
      date:'2026-09-28',
      failed:2,
      remaining:0,
    },'warning'),
    event('2026-09-29T07:20:00Z','DAILY_DIGEST_RUN_TRUNCATED',{
      date:'2026-09-29',
      truncated:true,
      remaining:0,
    },'warning'),
  ];

  const result=summarizeDailyDigestReliability(rows,{days:7,nowMs:NOW});

  assert.equal(result.sealedClaimDays,1);
  assert.equal(result.degradedDays,1);
  assert.equal(result.truncatedDays,1);
});

test('7 and 30 day reliability windows use bounded UTC calendar days',()=>{
  const rows=[
    healthyRun('2026-09-22',10,10,'23:59:00Z'),
    healthyRun('2026-09-23',10,10,'00:01:00Z'),
    healthyRun('2026-09-29',10,10),
    healthyRun('2026-09-10',10,10),
  ];

  const seven=summarizeDailyDigestReliability(rows,{days:7,nowMs:NOW});
  const thirty=summarizeDailyDigestReliability(rows,{days:30,nowMs:NOW});
  const clamped=summarizeDailyDigestReliability(rows,{days:90,nowMs:NOW});

  assert.equal(seven.windowStartedAt,'2026-09-23T00:00:00.000Z');
  assert.deepEqual(seven.daily.map(day=>day.date),['2026-09-23','2026-09-29']);
  assert.equal(seven.sampleDays,2);
  assert.ok(seven.coverageRate<=1);

  assert.equal(thirty.windowStartedAt,'2026-08-31T00:00:00.000Z');
  assert.equal(thirty.sampleDays,4);
  assert.equal(clamped.days,30);
  assert.equal(clamped.sampleDays,4);

  assert.equal(
    summarizeDailyDigestReliability(rows,{days:false,nowMs:NOW}).days,
    7,
  );
});

test('foreign, future and date-mismatched events cannot become valid reliability runs',()=>{
  const rows=[
    healthyRun('2026-09-29',3,3),
    {
      created_at:'2026-09-29T07:56:00Z',
      severity:'error',
      source:'worker',
      event_type:'other',
      code:'DAILY_DIGEST_RUN_OK',
      metadata:{date:'2026-09-29',sent:999,claimed:999},
    },
    healthyRun('2026-09-29',999,999,'09:00:00Z'),
    {
      ...healthyRun('2026-09-28',50,50),
      metadata:{
        date:'2026-09-29',
        sent:50,
        claimed:50,
        completionRate:1,
      },
    },
  ];

  const result=summarizeDailyDigestReliability(rows,{days:7,nowMs:NOW});

  assert.equal(result.available,true);
  assert.equal(result.observedEvents,2);
  assert.equal(result.runs,1);
  assert.equal(result.totals.sent,3);
  assert.equal(result.totals.claimed,3);
  assert.equal(result.evidenceValid,false);
  assert.equal(result.invalidEvidenceRuns,1);
  assert.deepEqual(result.daily.map(day=>day.date),['2026-09-29']);
});

test('ambiguous numeric strings, booleans and inconsistent delivery evidence fail closed',()=>{
  const malformed=summarizeDailyDigestReliability([
    event('2026-09-29T07:55:00Z','DAILY_DIGEST_RUN_OK',{
      date:'2026-09-29',
      sent:'10',
      claimed:10,
      failed:false,
      rateLimited:1.5,
      remaining:'0',
      backlog:0,
      truncated:'false',
      completionRate:'1',
    }),
  ],{days:'NaN',nowMs:NOW});

  assert.equal(malformed.days,7);
  assert.deepEqual(malformed.totals,{
    sent:0,
    claimed:10,
    failed:0,
    rateLimited:0,
  });
  assert.equal(malformed.completionRate,0);
  assert.equal(malformed.truncatedDays,0);
  assert.equal(malformed.evidenceValid,false);
  assert.ok(malformed.invalidEvidenceRuns>=1);

  const inconsistent=summarizeDailyDigestReliability([
    event('2026-09-29T07:55:00Z','DAILY_DIGEST_RUN_OK',{
      date:'2026-09-29',
      eligible:100,
      sent:95,
      claimed:90,
      failed:0,
      rateLimited:0,
      remaining:0,
      backlog:10,
      completionRate:0.5,
      truncated:false,
    }),
  ],{days:7,nowMs:NOW});

  assert.equal(inconsistent.evidenceValid,false);
  assert.equal(inconsistent.invalidEvidenceRuns,1);

  const slo=assessDailyDigestReliabilitySlo([
    healthyRun('2026-09-27'),
    healthyRun('2026-09-28'),
    ...inconsistent.daily.map(()=>event('2026-09-29T07:55:00Z','DAILY_DIGEST_RUN_OK',{
      date:'2026-09-29',
      eligible:100,
      sent:95,
      claimed:90,
      remaining:0,
      backlog:10,
      completionRate:0.5,
    })),
  ],{nowMs:Date.parse('2026-09-29T08:15:00Z')});

  assert.equal(slo.state,'watch');
  assert.equal(slo.code,'DAILY_DIGEST_SLO_EVIDENCE_INVALID');
});

test('empty and non-array histories are explicit aggregate-only evidence',()=>{
  for (const rows of [[],{broken:true},null]) {
    const result=summarizeDailyDigestReliability(rows,{days:30,nowMs:NOW});
    assert.equal(result.available,false);
    assert.equal(result.sampleDays,0);
    assert.equal(result.runs,0);
    assert.equal(result.observedEvents,0);
    assert.equal(result.completionRate,null);
    assert.equal(result.evidenceValid,true);
    assert.equal(result.policy.aggregateOnly,true);
    assert.equal(result.policy.userIdentifiers,false);
  }
});

test('release history reader requests only daily-digest operational rows',async()=>{
  const calls=[];
  const reader=releaseReader(async url=>{
    const parsed=new URL(String(url));
    calls.push({
      source:parsed.searchParams.get('source'),
      eventType:parsed.searchParams.get('event_type'),
      order:parsed.searchParams.get('order'),
      limit:parsed.searchParams.get('limit'),
      createdAt:parsed.searchParams.getAll('created_at'),
    });
    return {
      ok:true,
      async json(){return [];},
    };
  });

  const result=await reader.readDailyDigestOpsEvents(
    {supabaseUrl:'https://example.supabase.co'},
    '2026-09-23T00:00:00.000Z',
    '2026-09-30T00:00:00.000Z',
    1000,
  );

  assert.equal(result.persistent,true);
  assert.equal(result.truncated,false);
  assert.deepEqual(calls,[{
    source:'eq.telegram',
    eventType:'eq.daily_digest',
    order:'created_at.desc',
    limit:'1000',
    createdAt:[
      'gte.2026-09-23T00:00:00.000Z',
      'lt.2026-09-30T00:00:00.000Z',
    ],
  }]);
});

test('admin reliability surface exposes 7/30 day controls and incomplete-history warning',()=>{
  const html=fs.readFileSync('public/admin.html','utf8');
  const module=fs.readFileSync('public/modules/admin-release-monitor.js','utf8');

  assert.match(html,/id="releaseMonitorDigestPeriod"/);
  assert.match(html,/<option value="7" selected>Digest 7д<\/option>/);
  assert.match(html,/<option value="30">Digest 30д<\/option>/);

  const start=module.indexOf("const reliability = dd.reliability || {};");
  const end=module.indexOf("const codes = c.topCodes || [];",start);
  assert.ok(start>=0 && end>start);
  const block=module.slice(start,end);

  assert.match(block,/historyTruncated/);
  assert.match(block,/historyPersistent/);
  assert.match(block,/reliability-метрики за выбранный период неполные/);
  assert.match(block,/Persistent история Daily Digest временно недоступна/);
  assert.match(block,/Completion rate/);
  assert.match(block,/Среднее восстановление/);
  assert.match(block,/Daily history/);
  assert.doesNotMatch(block,/telegram_id|chat_id|user_id|destination_key/i);
});
