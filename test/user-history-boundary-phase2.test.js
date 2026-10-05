import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createUserHistoryService } from '../src/user-history.js';

function runtime(overrides = {}) {
  const memory={history:new Map()};
  const writes=[];
  const reads=[];
  const service=createUserHistoryService({
    memory,
    hasSupabase:overrides.hasSupabase || (()=>false),
    supaUpsert:overrides.supaUpsert || (async(_cfg,table,row,onConflict)=>{
      writes.push({table,row,onConflict});
      return row;
    }),
    supaSelectMany:overrides.supaSelectMany || (async(_cfg,table,filters,options)=>{
      reads.push({table,filters,options});
      return [];
    }),
    recordOpsEvent:overrides.recordOpsEvent,
    bumpTelemetry:overrides.bumpTelemetry,
    redactOpsString:overrides.redactOpsString,
    correlationId:overrides.correlationId,
    retryDelayMs:overrides.retryDelayMs ?? 0,
    sleep:overrides.sleep,
  });
  return {memory,writes,reads,service};
}

function payload(fixtureId=101) {
  return {
    match:{
      fixtureId,
      home:{name:'Home',logo:'https://img.test/home.png'},
      away:{name:'Away',logo:'https://img.test/away.png'},
      league:'League',
      date:'2026-09-28T18:00:00.000Z',
    },
    aiInstructor:{
      confidenceScore:87.6,
      riskLabel:'medium',
      betSignal:{code:'HOME_EDGE',label:'Home edge'},
      verdict:{outcome:'1X',total:'Over 1.5',btts:'Yes'},
    },
    analysisVersion:'v10',
  };
}

test('history service preserves in-memory row shape, dedupe and 20-item cap', async () => {
  const {memory,service}=runtime();
  await service.recordHistory(7,payload(101),{});
  let rows=await service.getHistory(7,{});
  assert.equal(rows.length,1);
  assert.equal(rows[0].telegram_id,7);
  assert.equal(rows[0].fixture_id,101);
  assert.equal(rows[0].home_name,'Home');
  assert.equal(rows[0].away_name,'Away');
  assert.equal(rows[0].ai_signal_code,'HOME_EDGE');
  assert.equal(rows[0].ai_confidence,88);
  assert.equal(rows[0].analysis_version,'v10');
  assert.ok(rows[0].viewed_at);

  for(let i=102;i<=122;i++) await service.recordHistory(7,payload(i),{});
  rows=await service.getHistory(7,{});
  assert.equal(rows.length,20);
  assert.equal(rows[0].fixture_id,122);

  await service.recordHistory(7,payload(122),{});
  rows=await service.getHistory(7,{});
  assert.equal(rows.length,20);
  assert.equal(rows.filter(x=>x.fixture_id===122).length,1);
});

test('history service preserves Supabase upsert contract and field bounds', async () => {
  const {writes,service}=runtime({hasSupabase:()=>true});
  const p=payload(55);
  p.aiInstructor.betSignal.code='C'.repeat(100);
  p.aiInstructor.betSignal.label='L'.repeat(300);
  p.aiInstructor.riskLabel='R'.repeat(100);
  p.aiInstructor.verdict.outcome='O'.repeat(120);
  p.analysisVersion='V'.repeat(120);
  await service.recordHistory(11,p,{supabaseUrl:'https://db.test'});
  assert.equal(writes.length,1);
  assert.equal(writes[0].table,'analysis_history');
  assert.equal(writes[0].onConflict,'telegram_id,fixture_id');
  assert.equal(writes[0].row.telegram_id,11);
  assert.equal(writes[0].row.fixture_id,55);
  assert.equal(writes[0].row.ai_signal_code.length,40);
  assert.equal(writes[0].row.ai_signal_label.length,160);
  assert.equal(writes[0].row.ai_risk.length,60);
  assert.equal(writes[0].row.ai_outcome.length,80);
  assert.equal(writes[0].row.analysis_version.length,80);
});

test('history write failure remains fail-soft, emits ops signal and recovers idempotently in background', async () => {
  let attempts=0;
  const events=[];
  const metrics={};
  const background=[];
  const writeRuntime=runtime({
    hasSupabase:()=>true,
    supaUpsert:async()=>{
      attempts+=1;
      if(attempts===1) throw new Error('write unavailable');
    },
    recordOpsEvent:async(_cfg,event)=>events.push(event),
    bumpTelemetry:(key,amount=1)=>{ metrics[key]=Number(metrics[key]||0)+amount; },
    correlationId:async()=> 'history-correlation-77',
    retryDelayMs:0,
  });
  const cfg={waitUntil:promise=>background.push(promise)};
  await assert.doesNotReject(()=>writeRuntime.service.recordHistory(13,payload(77),cfg));
  await Promise.all(background);

  assert.equal(attempts,2);
  assert.equal(metrics.analysisHistoryWriteErrors,1);
  assert.equal(metrics.analysisHistoryRetryAttempts,1);
  assert.equal(metrics.analysisHistoryWriteRecovered,1);
  assert.equal(metrics.analysisHistoryWriteLosses,undefined);
  assert.equal(metrics.analysisHistoryRetryPending,0);
  assert.deepEqual(events.map(event=>event.code),[
    'ANALYSIS_HISTORY_WRITE_FAILED',
    'ANALYSIS_HISTORY_WRITE_RECOVERED',
  ]);
  assert.equal(events[0].meta.correlationId,'history-correlation-77');
  assert.equal(events[0].meta.fixtureId,77);
  assert.equal(Object.hasOwn(events[0].meta,'userId'),false);
});

test('history retry exhaustion is explicitly classified as accepted data loss', async () => {
  const events=[];
  const metrics={};
  const background=[];
  const writeRuntime=runtime({
    hasSupabase:()=>true,
    supaUpsert:async()=>{ throw new Error('database unavailable'); },
    recordOpsEvent:async(_cfg,event)=>events.push(event),
    bumpTelemetry:(key,amount=1)=>{ metrics[key]=Number(metrics[key]||0)+amount; },
    correlationId:async()=> 'history-correlation-88',
    retryDelayMs:0,
  });
  await writeRuntime.service.recordHistory(13,payload(88),{
    waitUntil:promise=>background.push(promise),
  });
  await Promise.all(background);

  assert.equal(metrics.analysisHistoryWriteErrors,1);
  assert.equal(metrics.analysisHistoryRetryAttempts,1);
  assert.equal(metrics.analysisHistoryWriteLosses,1);
  assert.equal(metrics.analysisHistoryRetryPending,0);
  const loss=events.find(event=>event.code==='ANALYSIS_HISTORY_WRITE_LOST');
  assert.ok(loss);
  assert.equal(loss.severity,'error');
  assert.equal(loss.meta.acceptedDataLoss,true);
  assert.equal(loss.meta.correlationId,'history-correlation-88');
});

test('history read remains fail-soft when Supabase is unavailable', async () => {
  const readRuntime=runtime({
    hasSupabase:()=>true,
    supaSelectMany:async()=>{ throw new Error('Supabase history unavailable'); },
  });
  assert.deepEqual(await readRuntime.service.getHistory(13,{}),[]);
});

test('history service preserves Supabase read query shape', async () => {
  const {reads,service}=runtime({hasSupabase:()=>true});
  await service.getHistory(15,{supabaseUrl:'https://db.test'});
  assert.equal(reads.length,1);
  assert.deepEqual(reads[0],{
    table:'analysis_history',
    filters:{telegram_id:'eq.15'},
    options:{limit:20,order:'viewed_at.desc'},
  });
});

test('history service ignores payloads without fixture identity', async () => {
  const {memory,writes,service}=runtime();
  await service.recordHistory(17,{match:{home:{name:'A'},away:{name:'B'}}},{});
  assert.equal(memory.history.size,0);
  assert.equal(writes.length,0);
});

test('worker delegates history storage boundary to extracted service', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  assert.match(worker,/import \{ createUserHistoryService \} from '\.\/user-history\.js'/);
  assert.match(worker,/createUserHistoryService\(\{/);
  assert.match(worker,/recordOpsEvent,\s*bumpTelemetry,\s*redactOpsString,/);
  assert.match(worker,/analysis-history:\$\{Number\(userId\)\}:\$\{Number\(fixtureId\)\}/);
  assert.match(worker,/analysisHistoryWriteErrors/);
  assert.match(worker,/analysisHistoryWriteLosses/);
  assert.doesNotMatch(worker,/async function recordHistory\(userId, payload, cfg\)/);
  assert.doesNotMatch(worker,/async function getHistory\(userId, cfg\)/);
  assert.match(worker,/recordHistory\(/);
  assert.match(worker,/getHistory\(user\.id, cfg\)/);
});
