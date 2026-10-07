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
  const calls={fetch:0,urls:[]};
  const api=createDiagnosticsRuntime({
    memory,
    appVersion:'6.120.0-rc144',
    supabaseSchemaGuidance:'schema-guidance',
    hasSupabase:()=>true,
    fetchWithTimeout:async url=>{
      calls.fetch+=1;
      calls.urls.push(String(url));
      return {ok:true,json:async()=>[{code:'DB_EVENT'}]};
    },
    supaHeaders:()=>({authorization:'test'}),
    probeSupabaseConfirmed:async()=>({configured:true,ok:true,status:'ok'}),
    readIntegrityDiagnostics:async()=>({
      migrationReady:true,
      lastRun:{health:'ok',warnings:0,quarantined:0},
    }),
    readTelegramDedupeHealth:async()=>({
      available:true,
      state:'healthy',
      staleProcessing:0,
      failedCurrent:0,
    }),
    providerSloReport:async()=>({
      overall:{state:'healthy'},
      incident:{activeIncident:null},
    }),
    providerSnapshot:()=>({
      health:'ok',
      cooldownActive:false,
      dailyUsedPct:20,
    }),
    footballCooldownRemaining:()=>0,
    telemetrySnapshot:()=>({routeErrors:0}),
    now:()=>new Date('2026-10-05T10:30:00.000Z'),
    ...overrides,
  });
  return {api,memory,calls};
}

test('diagnostics runtime returns healthy persisted diagnostics from injected boundaries',async()=>{
  const {api,calls}=runtime();
  const result=await api.collectDiagnostics({
    supabaseUrl:'https://db.test',
    opsRetentionDays:14,
  });

  assert.equal(calls.fetch,1);
  assert.match(calls.urls[0],/^https:\/\/db\.test\/rest\/v1\/ops_events\?/);
  assert.equal(result.available,true);
  assert.equal(result.version,'6.120.0-rc144');
  assert.equal(result.generatedAt,'2026-10-05T10:30:00.000Z');
  assert.deepEqual(result.overall,{state:'ok',label:'Системы работают штатно'});
  assert.equal(result.observability.persistent,true);
  assert.deepEqual(result.observability.recentEvents,[{code:'DB_EVENT'}]);
  assert.deepEqual(result.recommendations,['Критичных действий сейчас не требуется.']);
});

test('diagnostics ops reader fails soft to bounded memory evidence',async()=>{
  const {api}=runtime({
    fetchWithTimeout:async()=>{throw new Error('db down');},
  });
  const result=await api.readRecentOpsEvents(
    {supabaseUrl:'https://db.test'},
    12,
  );

  assert.equal(result.persistent,false);
  assert.equal(result.migrationReady,false);
  assert.deepEqual(result.items,[{code:'MEMORY_EVENT'}]);
});

test('diagnostics ops reader bounds provider output and rejects coercive limits',async()=>{
  const rows=Array.from({length:40},(_,index)=>({
    code:`EVENT_${index + 1}`,
    created_at:'2026-10-05T10:30:00Z',
  }));
  const {api,calls}=runtime({
    fetchWithTimeout:async url=>{
      calls.fetch+=1;
      calls.urls.push(String(url));
      return {ok:true,json:async()=>rows};
    },
  });

  const bounded=await api.readRecentOpsEvents(
    {supabaseUrl:'https://db.test'},
    999,
  );
  assert.equal(bounded.items.length,20);
  assert.ok(calls.urls[0].includes('limit=20'));

  const coercive=await api.readRecentOpsEvents(
    {supabaseUrl:'https://db.test'},
    '20',
  );
  assert.equal(coercive.items.length,10);
  assert.ok(calls.urls[1].includes('limit=10'));
});

test('diagnostics ops reader sanitizes malformed persistent events',async()=>{
  const dangerous={code:'SAFE'};
  Object.defineProperty(dangerous,'message',{
    enumerable:true,
    get(){throw new Error('must not escape diagnostics boundary');},
  });

  const {api}=runtime({
    fetchWithTimeout:async()=>({
      ok:true,
      json:async()=>[
        dangerous,
        null,
        {
          code:'CTRL\u0000EVENT',
          status:999,
          duration_ms:Infinity,
          created_at:'2026-10-05T10:30:00',
        },
      ],
    }),
  });

  const result=await api.readRecentOpsEvents(
    {supabaseUrl:'https://db.test'},
    12,
  );

  assert.deepEqual(result.items,[
    {code:'SAFE'},
    {code:'CTRL EVENT'},
  ]);
});

test('diagnostics runtime preserves critical and actionable provider/Supabase classification',async()=>{
  const {api}=runtime({
    probeSupabaseConfirmed:async()=>({
      configured:true,
      ok:false,
      status:'http_503',
    }),
    providerSnapshot:()=>({
      health:'critical',
      cooldownActive:true,
      dailyUsedPct:95,
    }),
    footballCooldownRemaining:()=>42,
  });
  const result=await api.collectDiagnostics({
    supabaseUrl:'https://db.test',
    opsRetentionDays:14,
  });

  assert.equal(result.overall.state,'critical');
  assert.equal(result.overall.label,'Нужна проверка Supabase');
  assert.ok(result.recommendations.some(x=>x.includes('Проверьте адрес Supabase')));
  assert.ok(result.recommendations.some(x=>x.includes('42 сек.')));
  assert.ok(result.recommendations.some(x=>x.includes('90%')));
});

test('diagnostics runtime classifies durable analysis-history loss without hidden Worker globals',async()=>{
  const {api,memory}=runtime();
  memory.telemetry.analysisHistoryWriteLosses=3;
  const result=await api.collectDiagnostics({
    supabaseUrl:'https://db.test',
    opsRetentionDays:14,
  });

  assert.equal(result.overall.state,'warning');
  assert.match(result.overall.label,/потери истории/i);
  assert.ok(result.recommendations.some(x=>x.includes('3 записей')));
});

test('diagnostics runtime does not coerce telemetry strings or booleans into incidents',async()=>{
  const memory={
    opsEvents:[],
    telemetry:{
      routeErrors:'1',
      cacheWriteErrors:false,
      analysisHistoryWriteLosses:'3',
      analysisHistoryRetryPending:true,
    },
  };
  const {api}=runtime({memory});
  const result=await api.collectDiagnostics({
    supabaseUrl:'https://db.test',
    opsRetentionDays:14,
  });

  assert.deepEqual(result.overall,{state:'ok',label:'Системы работают штатно'});
  assert.deepEqual(result.recommendations,['Критичных действий сейчас не требуется.']);
});

test('diagnostics runtime isolates optional diagnostic reader failures',async()=>{
  const {api}=runtime({
    readIntegrityDiagnostics:async()=>{throw new Error('integrity unavailable');},
    readTelegramDedupeHealth:async()=>{throw new Error('telegram unavailable');},
    providerSloReport:async()=>{throw new Error('slo unavailable');},
    telemetrySnapshot:()=>{throw new Error('telemetry unavailable');},
  });

  const result=await api.collectDiagnostics({
    supabaseUrl:'https://db.test',
    opsRetentionDays:14,
  });

  assert.equal(result.available,true);
  assert.equal(result.overall.state,'warning');
  assert.equal(result.overall.label,'Provider SLO временно недоступен');
  assert.equal(result.providerObservability.diagnosticsError,true);
  assert.equal(result.integrity.diagnosticsError,true);
  assert.equal(result.telegramWebhook.diagnosticsError,true);
  assert.equal(result.runtime.diagnosticsError,true);
  assert.ok(
    result.recommendations.some(x=>x.includes('Provider SLO')),
    result.recommendations.join('\n'),
  );
  assert.ok(
    result.recommendations.some(x=>x.includes('целостности')),
    result.recommendations.join('\n'),
  );
  assert.doesNotThrow(()=>JSON.stringify(result));
});

test('diagnostics runtime sanitizes hostile provider payloads and runbook entries',async()=>{
  const hostileProvider={
    health:'ok',
    cooldownActive:false,
    dailyUsedPct:20,
  };
  Object.defineProperty(hostileProvider,'secret',{
    enumerable:true,
    get(){throw new Error('hostile getter');},
  });

  const hostileRunbook={
    toString(){throw new Error('must not coerce runbook objects');},
  };

  const {api}=runtime({
    providerSnapshot:()=>hostileProvider,
    providerSloReport:async()=>({
      overall:{state:'watch'},
      incident:{activeIncident:{runbook:[hostileRunbook,'Проверить upstream.']}},
    }),
  });

  const result=await api.collectDiagnostics({
    supabaseUrl:'https://db.test',
    opsRetentionDays:14,
  });

  assert.equal(result.overall.state,'warning');
  assert.equal(result.provider.secret,null);
  assert.ok(result.recommendations.includes('Проверить upstream.'));
  assert.equal(
    result.recommendations.some(item=>item.includes('must not coerce')),
    false,
  );
  assert.doesNotThrow(()=>JSON.stringify(result));
});

test('diagnostics runtime validates structural dependencies at construction',()=>{
  assert.throws(
    ()=>runtime({memory:[]}),
    /memory is required/,
  );
  assert.throws(
    ()=>runtime({now:null}),
    /now is required/,
  );
});
