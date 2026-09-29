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
});
