import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeOpsEventsToDeployment } from '../src/release-event-attribution.js';

const current='51e52bae716e0469e95bc4f1523bebaac413317f';
const previous='df5bd3bdf56bb84a8a38b9ef8bb65236f7cd11be';
const identity={
  deploySha:current,
  cloudflareVersionTimestamp:'2026-09-29T12:59:15.000Z',
};

function row(created_at,deploySha,message=''){
  return {created_at,message,metadata:deploySha ? {deploySha} : {}};
}

test('release attribution rejects JavaScript coercion at identity and event boundaries',()=>{
  const result=scopeOpsEventsToDeployment([
    {created_at:'2026-09-29T13:00:00Z',message:'object-sha',metadata:{deploySha:{toString:()=>current}}},
    {created_at:{toString:()=> '2026-09-29T13:01:00Z'},message:'object-time',metadata:{deploySha:current}},
    row('2026-09-29T13:02:00Z',current,'exact'),
  ],{
    deploySha:{toString:()=>current},
    cloudflareVersionTimestamp:'2026-09-29T12:59:15.000Z',
  },{
    nowMs:Date.parse('2026-09-29T13:05:00Z'),
  });

  assert.equal(result.deploySha,null);
  assert.equal(result.invalidTime.length,1);
  assert.deepEqual(result.unattributed.map(item=>item.message),['object-sha','exact']);
  assert.deepEqual(result.actionable.map(item=>item.message),['object-sha','exact']);
  assert.equal(result.attributionComplete,false);
});

test('release attribution rejects boolean window coercion and bounds oversized windows',()=>{
  const now=Date.parse('2026-09-29T13:00:00Z');
  const tooOld=row('2026-09-29T11:30:00Z',current,'too-old');
  const recent=row('2026-09-29T12:30:00Z',current,'recent');

  const fallback=scopeOpsEventsToDeployment([tooOld,recent],{deploySha:current},{
    nowMs:now,
    windowMs:true,
  });
  assert.deepEqual(fallback.actionable.map(item=>item.message),['recent']);

  const bounded=scopeOpsEventsToDeployment([
    row('2026-09-20T13:00:00Z',current,'beyond-seven-days'),
    row('2026-09-23T13:00:00Z',current,'at-seven-days'),
  ],{deploySha:current},{
    nowMs:now,
    windowMs:999999999999,
  });
  assert.deepEqual(bounded.actionable.map(item=>item.message),['at-seven-days']);
});

test('future or malformed deployment timestamps fall back to the bounded attribution window',()=>{
  const now=Date.parse('2026-09-29T13:00:00Z');
  for(const cloudflareVersionTimestamp of [
    'not-a-date',
    '2026-09-29T14:00:00Z',
    {toString:()=> '2026-09-29T12:59:00Z'},
  ]){
    const result=scopeOpsEventsToDeployment([
      row('2026-09-29T12:30:00Z',current,'recent'),
    ],{deploySha:current,cloudflareVersionTimestamp},{nowMs:now,windowMs:60*60_000});
    assert.deepEqual(result.actionable.map(item=>item.message),['recent']);
    assert.equal(result.deploymentStartedAt,'2026-09-29T12:00:00.000Z');
  }
});

test('actionable events preserve source order when timestamps are equal',()=>{
  const at='2026-09-29T13:00:00Z';
  const result=scopeOpsEventsToDeployment([
    row(at,null,'unknown-first'),
    row(at,current,'exact-second'),
    row(at,null,'unknown-third'),
  ],identity,{nowMs:Date.parse('2026-09-29T13:05:00Z')});
  assert.deepEqual(
    result.actionable.map(item=>item.message),
    ['unknown-first','exact-second','unknown-third'],
  );
});

test('release attribution isolates the current deployment from older SHAs',()=>{
  const result=scopeOpsEventsToDeployment([
    row('2026-09-29T13:00:00Z',current,'current'),
    row('2026-09-29T13:01:00Z',previous,'old'),
  ],identity,{nowMs:Date.parse('2026-09-29T13:05:00Z')});
  assert.equal(result.exact.length,1);
  assert.equal(result.priorDeployment.length,1);
  assert.deepEqual(result.actionable.map(item=>item.message),['current']);
  assert.equal(result.attributionComplete,true);
});

test('release attribution keeps unattributed post-deploy events fail-closed',()=>{
  const result=scopeOpsEventsToDeployment([
    row('2026-09-29T13:00:00Z',null,'unknown'),
  ],identity,{nowMs:Date.parse('2026-09-29T13:05:00Z')});
  assert.equal(result.unattributed.length,1);
  assert.deepEqual(result.actionable.map(item=>item.message),['unknown']);
  assert.equal(result.attributionComplete,false);
});

test('release attribution ignores events before the active deployment timestamp',()=>{
  const result=scopeOpsEventsToDeployment([
    row('2026-09-29T12:58:59Z',null,'legacy-unattributed'),
    row('2026-09-29T12:58:59Z',previous,'legacy-old'),
    row('2026-09-29T13:00:00Z',current,'current'),
  ],identity,{nowMs:Date.parse('2026-09-29T13:05:00Z')});
  assert.equal(result.actionable.length,1);
  assert.equal(result.actionable[0].message,'current');
  assert.equal(result.priorDeployment.length,0);
});

test('release attribution falls back to bounded time window when version timestamp is absent',()=>{
  const result=scopeOpsEventsToDeployment([
    row('2026-09-29T11:30:00Z',previous,'too-old'),
    row('2026-09-29T12:30:00Z',current,'recent'),
  ],{deploySha:current},{nowMs:Date.parse('2026-09-29T13:00:00Z'),windowMs:60*60_000});
  assert.deepEqual(result.actionable.map(item=>item.message),['recent']);
  assert.equal(result.deploymentStartedAt,'2026-09-29T12:00:00.000Z');
});
