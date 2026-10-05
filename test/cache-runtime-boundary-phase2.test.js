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

test('Phase 2 cache boundary keeps Supabase as shared cache with L1 hydration',async()=>{
  const row={payload:{shared:true},expires_at:new Date(Date.now()+60_000).toISOString()};
  const rt=runtime({
    hasSupabase:()=>true,
    supaSelectOne:async()=>row,
  });
  assert.deepEqual(await rt.api.getCache('shared',{}),{shared:true});
  assert.equal(rt.memory.cache.get('shared').payload.shared,true);
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


test('cache ops metadata keeps namespaces but never persists user-scoped cache keys or overloaded ids',async()=>{
  const userScoped='postmatch:return:disabled:987654321:v1';

  const readFailure=runtime({
    hasSupabase:()=>true,
    supaSelectOne:async()=>{throw new Error('db down');},
  });
  assert.equal(await readFailure.api.getCache(userScoped,{}),null);
  const readEvent=readFailure.ops.at(-1);
  assert.equal(readEvent.code,'CACHE_DB_READ_NO_L1');
  assert.equal(readEvent.meta.cacheNamespace,'postmatch:return');
  assert.equal(Object.hasOwn(readEvent.meta,'cacheKey'),false);
  assert.equal(JSON.stringify(readEvent.meta).includes('987654321'),false);

  const writeFailure=runtime({
    hasSupabase:()=>true,
    supaUpsert:async()=>{throw new Error('db down');},
  });
  await writeFailure.api.setCache(userScoped,987654321,{provider:'api-football'},{cacheMinutes:20},20);
  const writeEvent=writeFailure.ops.at(-1);
  assert.equal(writeEvent.code,'CACHE_DB_WRITE');
  assert.equal(writeEvent.meta.cacheNamespace,'postmatch:return');
  assert.equal(Object.hasOwn(writeEvent.meta,'cacheKey'),false);
  assert.equal(Object.hasOwn(writeEvent.meta,'fixtureId'),false);
  assert.equal(JSON.stringify(writeEvent.meta).includes('987654321'),false);
});
