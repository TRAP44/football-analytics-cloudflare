import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosticsRuntime } from '../src/diagnostics-runtime.js';

function runtime(overrides={}) {
  const memory={
    opsEvents:[{code:'MEMORY_EVENT'}],
    telemetry:{
      routeErrors:0,
      cacheWriteErrors:0,
      analysisHistoryWriteLosses:0,
      analysisHistoryRetryPending:0,
    },
  };
  const calls={fetch:0};
  const api=createDiagnosticsRuntime({
    memory,
    appVersion:'6.120.0-rc144',
    supabaseSchemaGuidance:'schema-guidance',
    hasSupabase:()=>true,
    fetchWithTimeout:async()=>{
      calls.fetch+=1;
      return {ok:true,json:async()=>[{code:'DB_EVENT'}]};
    },
    supaHeaders:()=>({authorization:'test'}),
    probeSupabaseConfirmed:async()=>({configured:true,ok:true,status:'ok'}),
    readIntegrityDiagnostics:async()=>({migrationReady:true,lastRun:{health:'ok',warnings:0,quarantined:0}}),
    readTelegramDedupeHealth:async()=>({available:true,state:'healthy',staleProcessing:0,failedCurrent:0}),
    providerSloReport:async()=>({overall:{state:'healthy'},incident:{activeIncident:null}}),
    providerSnapshot:()=>({health:'ok',cooldownActive:false,dailyUsedPct:20}),
    footballCooldownRemaining:()=>0,
    telemetrySnapshot:()=>({routeErrors:0}),
    now:()=>new Date('2026-10-05T10:30:00.000Z'),
    ...overrides,
  });
  return {api,memory,calls};
}

test('diagnostics runtime returns healthy persisted diagnostics from injected boundaries',async()=>{
  const {api,calls}=runtime();
  const result=await api.collectDiagnostics({supabaseUrl:'https://db.test',opsRetentionDays:14});
  assert.equal(calls.fetch,1);
  assert.equal(result.available,true);
  assert.equal(result.version,'6.120.0-rc144');
  assert.equal(result.generatedAt,'2026-10-05T10:30:00.000Z');
  assert.deepEqual(result.overall,{state:'ok',label:'Системы работают штатно'});
  assert.equal(result.observability.persistent,true);
  assert.deepEqual(result.observability.recentEvents,[{code:'DB_EVENT'}]);
  assert.deepEqual(result.recommendations,['Критичных действий сейчас не требуется.']);
});

test('diagnostics ops reader fails soft to bounded memory evidence',async()=>{
  const {api}=runtime({fetchWithTimeout:async()=>{throw new Error('db down');}});
  const result=await api.readRecentOpsEvents({supabaseUrl:'https://db.test'},12);
  assert.equal(result.persistent,false);
  assert.equal(result.migrationReady,false);
  assert.deepEqual(result.items,[{code:'MEMORY_EVENT'}]);
});

test('diagnostics runtime preserves critical and actionable provider/Supabase classification',async()=>{
  const {api}=runtime({
    probeSupabaseConfirmed:async()=>({configured:true,ok:false,status:'http_503'}),
    providerSnapshot:()=>({health:'critical',cooldownActive:true,dailyUsedPct:95}),
    footballCooldownRemaining:()=>42,
  });
  const result=await api.collectDiagnostics({supabaseUrl:'https://db.test',opsRetentionDays:14});
  assert.equal(result.overall.state,'critical');
  assert.equal(result.overall.label,'Нужна проверка Supabase');
  assert.ok(result.recommendations.some(x=>x.includes('Проверьте адрес Supabase')));
  assert.ok(result.recommendations.some(x=>x.includes('42 сек.')));
  assert.ok(result.recommendations.some(x=>x.includes('90%')));
});

test('diagnostics runtime classifies durable analysis-history loss without hidden Worker globals',async()=>{
  const {api,memory}=runtime();
  memory.telemetry.analysisHistoryWriteLosses=3;
  const result=await api.collectDiagnostics({supabaseUrl:'https://db.test',opsRetentionDays:14});
  assert.equal(result.overall.state,'warning');
  assert.match(result.overall.label,/потери истории/i);
  assert.ok(result.recommendations.some(x=>x.includes('3 записей')));
});
