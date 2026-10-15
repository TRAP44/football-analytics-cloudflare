import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryWriteBatcher} from '../src/history-write-batcher.js';
const cfg={supabaseUrl:'https://project-a.test',supabaseKey:'dummy-local-a'};
const row=(id,fixture=7,at='2026-10-15T10:00:00.000Z')=>({telegram_id:id,fixture_id:fixture,viewed_at:at});

test('1000 history callers persist every unique row in bounded batches and wait for confirmation',async()=>{
  const batches=[],releases=[];
  const enqueue=createHistoryWriteBatcher(async(_cfg,rows)=>{batches.push(Array.isArray(rows)?rows:[rows]);await new Promise(resolve=>releases.push(resolve));});
  let completed=0;
  const pending=Array.from({length:1000},(_,index)=>enqueue({...cfg},row(index+1)).then(()=>{completed++;}));
  await Promise.resolve();await Promise.resolve();
  assert.equal(batches.length,10);assert.equal(completed,0);
  assert.ok(batches.every(rows=>rows.length===100));
  assert.equal(new Set(batches.flat().map(item=>item.telegram_id)).size,1000);
  for(const release of releases)release();
  await Promise.all(pending);assert.equal(completed,1000);
});

test('history batches isolate project/key identities and unknown configs stay individual',async()=>{
  const writes=[];
  const enqueue=createHistoryWriteBatcher(async(config,rows)=>writes.push({config,rows}));
  await Promise.all([
    enqueue(cfg,row(1)),enqueue({...cfg},row(2)),
    enqueue({...cfg,supabaseKey:'dummy-local-b'},row(3)),
    enqueue({...cfg,supabaseUrl:'https://project-b.test'},row(4)),
    enqueue({},row(5)),enqueue({},row(6)),
  ]);
  assert.equal(writes.length,5);
  const grouped=writes.find(write=>Array.isArray(write.rows));
  assert.deepEqual(grouped.rows.map(item=>item.telegram_id),[1,2]);
});

test('history duplicate conflict keys keep newest view and stable lock ordering',async()=>{
  let payload;
  const enqueue=createHistoryWriteBatcher(async(_cfg,rows)=>{payload=rows;});
  await Promise.all([
    enqueue(cfg,row(2,9,'2026-10-15T10:00:03.000Z')),
    enqueue(cfg,row(2,9,'2026-10-15T10:00:01.000Z')),
    enqueue(cfg,row(1,8)),
  ]);
  assert.equal(payload.length,2);
  assert.deepEqual(payload.map(item=>item.telegram_id),[1,2]);
  assert.equal(payload[1].viewed_at,'2026-10-15T10:00:03.000Z');
});

test('failed batch rejects every caller and clears its queue for the next write',async()=>{
  let fail=true,calls=0;
  const enqueue=createHistoryWriteBatcher(async()=>{calls++;if(fail)throw new Error('simulated batch outage');});
  const results=await Promise.allSettled(Array.from({length:100},(_,i)=>enqueue(cfg,row(i+1))));
  assert.ok(results.every(result=>result.status==='rejected'));
  assert.equal(calls,1);
  fail=false;await enqueue(cfg,row(101));assert.equal(calls,2);
});
