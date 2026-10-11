import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedCacheRuntime } from '../src/cache-runtime.js';

function runtime(overrides = {}) {
  const memory={cache:new Map()};
  const telemetry=[];
  const usage=[];
  const ops=[];
  const deps={
    memory,
    bumpTelemetry:(key)=>telemetry.push(key),
    phase5ProviderCacheUsage:(_cfg,key,kind)=>usage.push([key,kind]),
    hasSupabase:()=>false,
    supaSelectOne:async()=>null,
    supaUpsert:async()=>{},
    pruneMemoryState:()=>{},
    recordOpsEvent:async(_cfg,event)=>{ops.push(event);},
    ...overrides,
  };
  return {api:createSharedCacheRuntime(deps),memory,telemetry,usage,ops};
}

test('Phase 2 cache boundary validates its L1 storage contract eagerly',()=>{
  assert.throws(
    ()=>createSharedCacheRuntime({memory:{}}),
    /requires memory\.cache Map-like storage/,
  );
  assert.throws(
    ()=>createSharedCacheRuntime({memory:{cache:null}}),
    /requires memory\.cache Map-like storage/,
  );
});


test('Phase 2 cache boundary preserves L1 hit and stale behavior',async()=>{
  const fresh=runtime();
  fresh.memory.cache.set('fresh',{payload:{ok:true},expiresAt:Date.now()+60_000});
  assert.deepEqual(await fresh.api.getCache('fresh',{}),{ok:true});
  assert.ok(fresh.telemetry.includes('cacheHits'));

  const stale=runtime();
  stale.memory.cache.set('old',{payload:{old:true},expiresAt:Date.now()-60_000});
  assert.equal(await stale.api.getCache('old',{}),null);
  assert.deepEqual(await stale.api.getStaleCache('old',{}),{old:true});
  assert.ok(stale.telemetry.includes('staleCacheHits'));
});

test('Phase 2 cache boundary preserves valid falsy payloads',async()=>{
  for (const payload of [false,0,'']) {
    const rt=runtime();
    rt.memory.cache.set('falsy',{payload,expiresAt:Date.now()+60_000});
    assert.equal(await rt.api.getCache('falsy',{}),payload);
  }
});

test('Phase 2 cache boundary discards ambiguous or malformed L1 expiry without throwing',async()=>{
  for (const expiresAt of [NaN,Infinity,null,false,'']) {
    const rt=runtime();
    rt.memory.cache.set('broken',{payload:{bad:true},expiresAt});
    assert.equal(await rt.api.getCache('broken',{}),null);
    assert.equal(rt.memory.cache.has('broken'),false);
  }
});

test('Phase 2 cache boundary keeps Supabase as shared cache with L1 hydration',async()=>{
  const row={payload:{shared:true},expires_at:new Date(Date.now()+60_000).toISOString()};
  const rt=runtime({
    hasSupabase:()=>true,
    supaSelectOne:async()=>row,
  });
  assert.deepEqual(await rt.api.getCache('shared',{}),{shared:true});
  assert.equal(rt.memory.cache.get('shared').payload.shared,true);
});

test('Phase 2 cache boundary rejects malformed shared expiry instead of serving corrupted shared rows',async()=>{
  const rt=runtime({
    hasSupabase:()=>true,
    supaSelectOne:async()=>({payload:{shared:true},expires_at:'not-a-date'}),
  });
  assert.equal(await rt.api.getCache('shared-bad-expiry',{}),null);
  assert.equal(rt.memory.cache.has('shared-bad-expiry'),false);
  assert.ok(rt.telemetry.includes('cacheMisses'));
  assert.equal(rt.ops.length,1);
  assert.equal(rt.ops[0].code,'CACHE_DB_INVALID_ROW');

  rt.memory.cache.set('shared-bad-expiry',{payload:{local:true},expiresAt:Date.now()-1000});
  assert.deepEqual(await rt.api.getStaleCache('shared-bad-expiry',{}),{local:true});
});

test('Phase 2 cache boundary treats telemetry, phase5 and prune hooks as best-effort',async()=>{
  const rt=runtime({
    bumpTelemetry:()=>{throw new Error('telemetry down');},
    phase5ProviderCacheUsage:()=>{throw new Error('phase5 down');},
    pruneMemoryState:()=>{throw new Error('prune down');},
  });
  rt.memory.cache.set('fresh',{payload:{ok:true},expiresAt:Date.now()+60_000});
  await assert.doesNotReject(()=>rt.api.getCache('fresh',{}));
  assert.deepEqual(await rt.api.getCache('fresh',{}),{ok:true});

  for(let i=0;i<601;i+=1) rt.memory.cache.set('seed:'+i,{payload:i,expiresAt:Date.now()+60_000});
  await assert.doesNotReject(()=>rt.api.setCache('overflow',1,{ok:true},{cacheMinutes:5},5));
  assert.deepEqual(rt.memory.cache.get('overflow').payload,{ok:true});
});

test('Phase 2 cache boundary treats a throwing Supabase capability probe as local-only',async()=>{
  const rt=runtime({
    hasSupabase:()=>{throw new Error('config probe failed');},
  });
  rt.memory.cache.set('local',{payload:{ok:true},expiresAt:Date.now()+60_000});
  assert.deepEqual(await rt.api.getCache('local',{}),{ok:true});
  await assert.doesNotReject(()=>rt.api.setCache('local-write',1,{ok:true},{cacheMinutes:5},5));
  assert.deepEqual(rt.memory.cache.get('local-write').payload,{ok:true});
});

test('Phase 2 cache boundary keeps read failures fail-soft to L1',async()=>{
  const rt=runtime({
    hasSupabase:()=>true,
    supaSelectOne:async()=>{throw new Error('db down');},
  });
  rt.memory.cache.set('fallback',{payload:{ok:'l1'},expiresAt:Date.now()-60_000});
  const entry=await rt.api.getCacheEntry('fallback',{},true);
  assert.equal(entry.layer,'memory-fallback');
  assert.equal(entry.expired,true);
  assert.deepEqual(entry.payload,{ok:'l1'});
  assert.ok(rt.telemetry.includes('supabaseErrors'));
});

test('Phase 2 cache boundary bounds malformed TTL and fixture ids safely',async()=>{
  const writes=[];
  const rt=runtime({
    hasSupabase:()=>true,
    supaUpsert:async(_cfg,_table,row)=>{writes.push(row);},
  });
  await rt.api.setCache('bad-ttl','not-an-id',{ok:true},{cacheMinutes:'NaN'},'Infinity');
  const local=rt.memory.cache.get('bad-ttl');
  const ttlMs=local.expiresAt-Date.now();
  assert.ok(ttlMs>9*60_000 && ttlMs<=10*60_000+1000);
  assert.equal(writes[0].fixture_id,0);

  for (const ambiguous of [null,false,'']) {
    await rt.api.setCache('ambiguous-'+String(ambiguous),1,{ok:true},{cacheMinutes:12},ambiguous);
    const ambiguousTtl=rt.memory.cache.get('ambiguous-'+String(ambiguous)).expiresAt-Date.now();
    assert.ok(ambiguousTtl>11*60_000 && ambiguousTtl<=12*60_000+1000);
  }

  await rt.api.setCache('huge-ttl',1,{ok:true},{cacheMinutes:20},999999);
  const hugeTtl=rt.memory.cache.get('huge-ttl').expiresAt-Date.now();
  assert.ok(hugeTtl<=24*60*60_000+1000);
});

test('Phase 2 cache boundary keeps read/write fallback alive when ops logging throws synchronously',async()=>{
  const read=runtime({
    hasSupabase:()=>true,
    supaSelectOne:async()=>{throw new Error('db down');},
    recordOpsEvent:()=>{throw new Error('ops down');},
  });
  read.memory.cache.set('fallback',{payload:{ok:true},expiresAt:Date.now()-1000});
  await assert.doesNotReject(()=>read.api.getCacheEntry('fallback',{},true));

  const write=runtime({
    hasSupabase:()=>true,
    supaUpsert:async()=>{throw new Error('db down');},
    recordOpsEvent:()=>{throw new Error('ops down');},
  });
  await assert.doesNotReject(()=>write.api.setCache('x',1,{ok:true},{cacheMinutes:5},5));
});

test('Phase 2 cache boundary persists provenance without making write failures fatal',async()=>{
  const writes=[];
  const rt=runtime({
    hasSupabase:()=>true,
    supaUpsert:async(_cfg,table,row,key)=>{writes.push({table,row,key});},
  });
  await rt.api.setCache('fixture:1',1,{sourceMeta:{provider:'api-football',fetchedAt:'2026-09-27T12:00:00.000Z'}},{cacheMinutes:20},20);
  assert.equal(writes[0].table,'analysis_cache');
  assert.equal(writes[0].row.provider,'api-football');
  assert.equal(writes[0].key,'cache_key');

  const failing=runtime({
    hasSupabase:()=>true,
    supaUpsert:async()=>{throw new Error('write down');},
  });
  await assert.doesNotReject(()=>failing.api.setCache('fixture:2',2,{provider:'api-football'},{cacheMinutes:20},20));
  assert.ok(failing.telemetry.includes('cacheWriteErrors'));
  assert.ok(failing.telemetry.includes('supabaseErrors'));
});


test('Issue #494 redacts user-scoped cache keys from read failure ops metadata',async()=>{
  const userKey='postmatch:return:disabled:123456789:v1';
  const rt=runtime({
    hasSupabase:()=>true,
    supaSelectOne:async()=>{throw new Error('db down for '+userKey);},
  });
  await rt.api.getCacheEntry(userKey,{},false);
  assert.equal(rt.ops.length,1);
  assert.equal(rt.ops[0].code,'CACHE_DB_READ_NO_L1');
  assert.equal(rt.ops[0].meta.cacheCategory,'postmatch:return:disabled');
  assert.equal(Object.hasOwn(rt.ops[0].meta,'cacheKey'),false);
  assert.equal(Object.hasOwn(rt.ops[0].meta,'fixtureId'),false);
  assert.equal(JSON.stringify(rt.ops[0].meta).includes('123456789'),false);
  assert.equal(String(rt.ops[0].message).includes('123456789'),false);
  assert.match(rt.ops[0].message,/no local fallback/i);
});

test('Issue #494 redacts user/fixture ids from write failure ops metadata',async()=>{
  const rt=runtime({
    hasSupabase:()=>true,
    supaUpsert:async()=>{throw new Error('write down for postmatch:return:disabled:987654321:v1 fixture 777777');},
  });
  await rt.api.setCache(
    'postmatch:return:disabled:987654321:v1',
    777777,
    {provider:'api-football'},
    {cacheMinutes:20},
    20,
  );
  assert.equal(rt.ops.length,1);
  assert.equal(rt.ops[0].code,'CACHE_DB_WRITE');
  assert.equal(rt.ops[0].meta.cacheCategory,'postmatch:return:disabled');
  assert.equal(rt.ops[0].meta.provider,'api-football');
  assert.equal(Object.hasOwn(rt.ops[0].meta,'cacheKey'),false);
  assert.equal(Object.hasOwn(rt.ops[0].meta,'fixtureId'),false);
  const serialized=JSON.stringify(rt.ops[0].meta);
  assert.equal(serialized.includes('987654321'),false);
  assert.equal(serialized.includes('777777'),false);
  assert.equal(String(rt.ops[0].message).includes('987654321'),false);
  assert.equal(String(rt.ops[0].message).includes('777777'),false);
  assert.match(rt.ops[0].message,/local cache copy remains available/i);
});

test('Issue #494 keeps useful bounded cache categories for ordinary keys',()=>{
  const rt=runtime();
  assert.equal(rt.api.cacheOpsCategory('fixture:12345'),'fixture');
  assert.equal(rt.api.cacheOpsCategory('odds:league:premier:123'),'odds:league:premier');
  assert.equal(rt.api.cacheOpsCategory(''),'unknown');
  assert.ok(rt.api.cacheOpsCategory('x'.repeat(100)).length<=80);
});


test('Global match feed and provider quota survive shared-cache writes with NOT NULL fixture id',async()=>{
  const dbRows=new Map();
  const writes=[];
  const deps={
    hasSupabase:()=>true,
    supaUpsert:async(_cfg,table,row)=>{
      assert.equal(table,'analysis_cache');
      assert.ok(Number.isSafeInteger(row.fixture_id));
      assert.ok(row.fixture_id>=0);
      writes.push(row);
      dbRows.set(row.cache_key,{payload:row.payload,expires_at:row.expires_at});
    },
    supaSelectOne:async(_cfg,_table,params)=>dbRows.get(params.cache_key.slice(3)) || null,
  };
  const author=runtime(deps);
  const feedKey='matches:2026-10-09:v6-integrity';
  const quotaKey='provider-state:api-football:quota:v1';
  const feed={date:'2026-10-09',matches:[{fixtureId:1001}]};
  await author.api.setCache(feedKey,0,feed,{cacheMinutes:20},20);
  await author.api.setCache(quotaKey,null,{remaining:9},{cacheMinutes:1},1);
  await author.api.setCache('provider-fixture:1001:v1',1001,{fixtureId:1001},{cacheMinutes:5},5);
  assert.deepEqual(writes.map(row=>row.fixture_id),[0,0,1001]);
  assert.equal(author.ops.length,0);

  const reader=runtime(deps);
  assert.deepEqual(await reader.api.getCache(feedKey,{}),feed);
  assert.deepEqual(await reader.api.getCache(quotaKey,{}),{remaining:9});
  assert.equal(reader.ops.length,0);
});
