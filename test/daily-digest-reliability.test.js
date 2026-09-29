import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { summarizeDailyDigestReliability } from '../src/daily-digest-incidents.js';

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

test('A. reliability uses aggregate sent/claimed volume and tracks backlog + rate limits',()=>{
  const rows=[
    event('2026-09-28T07:50:00Z','DAILY_DIGEST_BACKLOG_LATE',{
      date:'2026-09-28',sent:90,claimed:100,failed:1,rateLimited:2,remaining:10,backlog:10,completionRate:0.9,
    },'warning'),
    event('2026-09-28T07:55:00Z','DAILY_DIGEST_RUN_OK',{
      date:'2026-09-28',sent:10,claimed:10,failed:0,rateLimited:0,remaining:0,backlog:0,completionRate:1,
    }),
    event('2026-09-29T07:55:00Z','DAILY_DIGEST_RUN_OK',{
      date:'2026-09-29',sent:100,claimed:100,failed:0,rateLimited:0,remaining:0,backlog:0,completionRate:1,
    }),
  ];
  const r=summarizeDailyDigestReliability(rows,{days:7,nowMs:NOW});

  assert.equal(r.available,true);
  assert.equal(r.days,7);
  assert.equal(r.sampleDays,2);
  assert.equal(r.runs,3);
  assert.equal(r.totals.sent,200);
  assert.equal(r.totals.claimed,210);
  assert.equal(r.completionRate,0.9524);
  assert.equal(r.backlog.occurrences,1);
  assert.equal(r.backlog.days,1);
  assert.equal(r.backlog.maxRecipients,10);
  assert.equal(r.rateLimitDays,1);
  assert.equal(r.totals.rateLimited,2);
  assert.equal(r.totals.failed,1);
});

test('B. incident frequency and recovery duration are date-scoped',()=>{
  const rows=[
    event('2026-09-28T07:50:00Z','DAILY_DIGEST_BACKLOG_LATE',{
      date:'2026-09-28',sent:90,claimed:100,remaining:10,
    },'warning'),
    event('2026-09-28T07:55:00Z','DAILY_DIGEST_RUN_OK',{
      date:'2026-09-28',sent:10,claimed:10,remaining:0,
    }),
    event('2026-09-29T07:55:00Z','DAILY_DIGEST_RUN_OK',{
      date:'2026-09-29',sent:25,claimed:25,remaining:0,
    }),
  ];
  const r=summarizeDailyDigestReliability(rows,{days:7,nowMs:NOW});

  assert.equal(r.incidents.count,1);
  assert.equal(r.incidents.recovered,1);
  assert.equal(r.incidents.active,0);
  assert.equal(r.incidents.averageRecoveryMinutes,5);
  assert.equal(r.incidents.maxRecoveryMinutes,5);
});

test('C. sealed/degraded/truncated days are counted once per delivery date',()=>{
  const rows=[
    event('2026-09-27T07:10:00Z','DAILY_DIGEST_SEALED_CLAIMS',{
      date:'2026-09-27',sealedClaims:2,remaining:0,
    },'warning'),
    event('2026-09-27T07:15:00Z','DAILY_DIGEST_SEALED_CLAIMS',{
      date:'2026-09-27',sealedClaims:1,remaining:0,
    },'warning'),
    event('2026-09-28T07:20:00Z','DAILY_DIGEST_RUN_DEGRADED',{
      date:'2026-09-28',failed:2,remaining:0,
    },'warning'),
    event('2026-09-29T07:20:00Z','DAILY_DIGEST_RUN_TRUNCATED',{
      date:'2026-09-29',truncated:true,remaining:0,
    },'warning'),
  ];
  const r=summarizeDailyDigestReliability(rows,{days:7,nowMs:NOW});

  assert.equal(r.sealedClaimDays,1);
  assert.equal(r.degradedDays,1);
  assert.equal(r.truncatedDays,1);
});

test('D. period supports 7 or 30 day historical windows and clamps larger requests',()=>{
  const old=event('2026-09-10T07:55:00Z','DAILY_DIGEST_RUN_OK',{
    date:'2026-09-10',sent:10,claimed:10,remaining:0,
  });
  const recent=event('2026-09-29T07:55:00Z','DAILY_DIGEST_RUN_OK',{
    date:'2026-09-29',sent:10,claimed:10,remaining:0,
  });

  const seven=summarizeDailyDigestReliability([old,recent],{days:7,nowMs:NOW});
  const thirty=summarizeDailyDigestReliability([old,recent],{days:30,nowMs:NOW});
  const clamped=summarizeDailyDigestReliability([old,recent],{days:90,nowMs:NOW});

  assert.equal(seven.sampleDays,1);
  assert.equal(thirty.sampleDays,2);
  assert.equal(clamped.days,30);
  assert.equal(clamped.sampleDays,2);
});

test('E. non-digest operational events and pre-window rows are ignored',()=>{
  const rows=[
    event('2026-09-29T07:55:00Z','DAILY_DIGEST_RUN_OK',{date:'2026-09-29',sent:3,claimed:3}),
    {created_at:'2026-09-29T07:56:00Z',severity:'error',source:'worker',event_type:'other',code:'OTHER',metadata:{}},
    event('2026-08-01T07:55:00Z','DAILY_DIGEST_RUN_OK',{date:'2026-08-01',sent:999,claimed:999}),
    event('2026-09-29T07:54:00Z','DIGEST_SUBSCRIPTIONS_TRUNCATED',{date:'2026-09-29',loaded:10000},'warning'),
  ];
  const r=summarizeDailyDigestReliability(rows,{days:30,nowMs:NOW});
  assert.equal(r.runs,1);
  assert.equal(r.totals.sent,3);
});

test('F. empty history is explicit and privacy contract remains aggregate-only',()=>{
  const r=summarizeDailyDigestReliability([],{days:30,nowMs:NOW});
  assert.equal(r.available,false);
  assert.equal(r.sampleDays,0);
  assert.equal(r.completionRate,null);
  assert.equal(r.policy.aggregateOnly,true);
  assert.equal(r.policy.userIdentifiers,false);
});

test('G. release monitor uses a dedicated filtered digest history read',()=>{
  const worker=fs.readFileSync('src/worker.js','utf8');
  assert.match(worker,/async function readDailyDigestOpsEvents/);
  assert.match(worker,/url\.searchParams\.set\('source','eq\.telegram'\)/);
  assert.match(worker,/url\.searchParams\.set\('event_type','eq\.daily_digest'\)/);
  assert.match(worker,/digestDays = Number\(url\.searchParams\.get\('digestDays'\)/);
  assert.match(worker,/summarizeDailyDigestReliability/);
  assert.match(worker,/historyTruncated:Boolean\(digestHistory\.truncated\)/);
});

test('H. admin UI exposes 7/30 day selector and reliability metrics',()=>{
  const html=fs.readFileSync('public/index.html','utf8');
  const app=fs.readFileSync('public/app.js','utf8');
  assert.match(html,/id="releaseMonitorDigestPeriod"/);
  assert.match(html,/<option value="7" selected>Digest 7д<\/option>/);
  assert.match(html,/<option value="30">Digest 30д<\/option>/);
  assert.match(app,/state\.releaseMonitorDigestDays = digestDays/);
  assert.match(app,/digestDays=\$\{digestDays\}/);
  assert.match(app,/Completion rate/);
  assert.match(app,/Среднее восстановление/);
  assert.match(app,/Daily history/);
});

test('I. trend rendering remains aggregate-only',()=>{
  const app=fs.readFileSync('public/app.js','utf8');
  const start=app.indexOf("const reliability = dd.reliability || {};");
  const end=app.indexOf("const codes = c.topCodes || [];",start);
  assert.ok(start>=0 && end>start);
  const block=app.slice(start,end);
  assert.doesNotMatch(block,/telegram_id|chat_id|user_id/i);
});
