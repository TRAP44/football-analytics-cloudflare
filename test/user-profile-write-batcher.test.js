import test from 'node:test';
import assert from 'node:assert/strict';
import {createUserProfileWriteBatcher} from '../src/user-profile-write-batcher.js';
const cfg={supabaseUrl:'https://project.test',supabaseKey:'local-test-key'};
const row=id=>({telegram_id:id,username:`user${id}`});

test('profile burst writes every user in bounded batches and awaits DB confirmation',async()=>{
  const batches=[],releases=[];let completed=0;
  const enqueue=createUserProfileWriteBatcher(async(_cfg,rows)=>{batches.push(rows);await new Promise(resolve=>releases.push(resolve));});
  const pending=Array.from({length:1000},(_,i)=>enqueue(cfg,row(1000-i)).then(()=>completed++));
  await Promise.resolve();await Promise.resolve();
  assert.equal(batches.length,10);assert.equal(completed,0);
  assert.ok(batches.every(batch=>batch.length===100));
  assert.equal(new Set(batches.flat().map(item=>item.telegram_id)).size,1000);
  assert.ok(batches.every(batch=>batch.every((item,i)=>i===0 || batch[i-1].telegram_id<item.telegram_id)));
  releases.forEach(release=>release());await Promise.all(pending);assert.equal(completed,1000);
});

test('failed profile batch retries independently so one bad profile cannot poison its neighbours',async()=>{
  const writes=[];
  const enqueue=createUserProfileWriteBatcher(async(_cfg,rows)=>{
    writes.push(rows);
    if(Array.isArray(rows) || rows.telegram_id===2)throw new Error('invalid profile');
  });
  const results=await Promise.allSettled([enqueue(cfg,row(1)),enqueue(cfg,row(2))]);
  assert.deepEqual(results.map(item=>item.status),['fulfilled','rejected']);
  assert.equal(writes.length,3);
  await enqueue(cfg,row(3));assert.equal(writes.length,4);
});

test('profile batches separate connection identities, snapshot config, and keep unknown identities individual',async()=>{
  const writes=[],mutable={...cfg};
  const enqueue=createUserProfileWriteBatcher(async(config,rows)=>writes.push({config,rows}));
  const pending=[enqueue(mutable,row(1)),enqueue(cfg,row(2)),enqueue({...cfg,supabaseKey:'other-key'},row(3)),enqueue({...cfg,supabaseUrl:'https://other.test'},row(4)),enqueue({},row(5)),enqueue({},row(6))];
  mutable.supabaseUrl='https://changed.test';mutable.supabaseKey='changed-key';
  await Promise.all(pending);
  assert.equal(writes.length,5);
  const grouped=writes.find(write=>Array.isArray(write.rows));
  assert.deepEqual(grouped.config,cfg);assert.deepEqual(grouped.rows,[row(1),row(2)]);
});

test('duplicate profile identities never produce a duplicate ON CONFLICT key in one batch',async()=>{
  const writes=[];const enqueue=createUserProfileWriteBatcher(async(_cfg,rows)=>writes.push(rows));
  await Promise.all([enqueue(cfg,row(1)),enqueue(cfg,row(1)),enqueue(cfg,row(2))]);
  assert.equal(writes.length,2);
  assert.ok(writes.every(payload=>!Array.isArray(payload) || new Set(payload.map(item=>item.telegram_id)).size===payload.length));
});
