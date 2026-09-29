import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DAILY_DIGEST_RELIABILITY_SLO,
  assessDailyDigestReliabilitySlo,
  planDailyDigestReliabilitySloEvent,
} from '../src/daily-digest-incidents.js';

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
      sent,claimed,remaining,backlog:remaining,rateLimited,failed:0,completionRate:completion,
    },remaining?'info':'info',index===2?'07:55:00Z':'07:50:00Z');
  });
}

test('A. missing run stays collecting before 08:15 UTC and becomes watch at 08:15',()=>{
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
});

test('B. insufficient historical sample does not enforce trend thresholds',()=>{
  const rows=[
    event('2026-09-29','DAILY_DIGEST_RUN_OK',{sent:10,claimed:10,remaining:0,completionRate:1}),
  ];
  const result=assessDailyDigestReliabilitySlo(rows,{
    nowMs:Date.parse('2026-09-29T08:15:00Z'),
  });
  assert.equal(result.state,'collecting');
  assert.equal(result.reason,'insufficient_sample');
});

test('C. completion rate below 98% becomes a watch after enough volume',()=>{
  const rows=sampleDays({completion:0.95});
  const result=assessDailyDigestReliabilitySlo(rows,{
    nowMs:Date.parse('2026-09-29T08:15:00Z'),
  });
  assert.equal(result.state,'watch');
  assert.equal(result.code,'DAILY_DIGEST_SLO_COMPLETION');
  assert.ok(result.reasons.includes('completion_rate'));
});

test('D. recurring backlog across two days becomes a watch',()=>{
  const rows=sampleDays({completion:1,backlogDates:['2026-09-27','2026-09-28']});
  const result=assessDailyDigestReliabilitySlo(rows,{
    nowMs:Date.parse('2026-09-29T08:15:00Z'),
  });
  assert.equal(result.state,'watch');
  assert.equal(result.code,'DAILY_DIGEST_SLO_BACKLOG_REPEATED');
  assert.ok(result.reasons.includes('backlog_days'));
});

test('E. recurring Telegram rate limits across two days become a watch',()=>{
  const rows=sampleDays({completion:1,rateLimitDates:['2026-09-27','2026-09-28']});
  const result=assessDailyDigestReliabilitySlo(rows,{
    nowMs:Date.parse('2026-09-29T08:15:00Z'),
  });
  assert.equal(result.state,'watch');
  assert.equal(result.code,'DAILY_DIGEST_SLO_RATE_LIMIT_REPEATED');
  assert.ok(result.reasons.includes('rate_limit_days'));
});

test('F. healthy history stays healthy once minimum sample is satisfied',()=>{
  const result=assessDailyDigestReliabilitySlo(sampleDays(),{
    nowMs:Date.parse('2026-09-29T08:15:00Z'),
  });
  assert.equal(result.state,'healthy');
  assert.equal(result.code,'DAILY_DIGEST_SLO_OK');
});

test('G. only one watch transition is recorded per date until recovery',()=>{
  const assessment={
    state:'watch',
    code:'DAILY_DIGEST_SLO_COMPLETION',
    reason:'completion_rate',
    reasons:['completion_rate'],
    date:'2026-09-29',
    message:'watch',
    reliability:{sampleDays:3,totals:{claimed:300},completionRate:0.95,backlog:{days:0},rateLimitDays:0,incidents:{count:0},degradedDays:0},
  };
  const first=planDailyDigestReliabilitySloEvent(assessment,[]);
  const second=planDailyDigestReliabilitySloEvent(
    {...assessment,code:'DAILY_DIGEST_SLO_RATE_LIMIT_REPEATED',reason:'rate_limit_days'},
    [{
      created_at:'2026-09-29T08:15:00Z',
      severity:'warning',
      code:'DAILY_DIGEST_SLO_COMPLETION',
      metadata:{date:'2026-09-29',state:'watch'},
    }],
  );
  assert.equal(first.action,'record');
  assert.equal(second.action,'none');
  assert.equal(second.reason,'watch_already_recorded');
});

test('H. recovery is recorded once after a prior watch transition',()=>{
  const prior=[{
    created_at:'2026-09-29T08:15:00Z',
    severity:'warning',
    code:'DAILY_DIGEST_SLO_COMPLETION',
    metadata:{date:'2026-09-29',state:'watch'},
  }];
  const healthy={
    state:'healthy',
    code:'DAILY_DIGEST_SLO_OK',
    reason:'within_thresholds',
    date:'2026-09-29',
    reliability:{sampleDays:3,totals:{claimed:300},completionRate:1},
  };
  const recovery=planDailyDigestReliabilitySloEvent(healthy,prior);
  assert.equal(recovery.action,'record');
  assert.equal(recovery.code,'DAILY_DIGEST_SLO_RECOVERED');

  const duplicate=planDailyDigestReliabilitySloEvent(healthy,[...prior,{
    created_at:'2026-09-29T08:30:00Z',
    severity:'info',
    code:'DAILY_DIGEST_SLO_RECOVERED',
    metadata:{date:'2026-09-29',state:'healthy'},
  }]);
  assert.equal(duplicate.action,'none');
});

test('I. production monitor reads filtered SLO events and propagates watch state',()=>{
  const worker=fs.readFileSync('src/worker.js','utf8');
  assert.match(worker,/async function readDailyDigestSloEvents/);
  assert.match(worker,/url\.searchParams\.set\('source','eq\.digest_slo'\)/);
  assert.match(worker,/url\.searchParams\.set\('event_type','eq\.reliability_slo'\)/);
  assert.match(worker,/dailyDigestSloState/);
  assert.match(worker,/digestReliabilitySlo\.state/);
  assert.match(worker,/dailyDigestSloWatch/);
});

test('J. admin monitor renders reliability SLO without user identifiers',()=>{
  const app=fs.readFileSync('public/app.js','utf8');
  const start=app.indexOf("const slo = dd.reliabilitySlo || {};");
  const end=app.indexOf("const codes = c.topCodes || [];",start);
  assert.ok(start>=0 && end>start);
  const block=app.slice(start,end);
  assert.match(block,/Reliability SLO/);
  assert.match(block,/SLO требует контроля/);
  assert.doesNotMatch(block,/telegram_id|chat_id|user_id/i);
});
