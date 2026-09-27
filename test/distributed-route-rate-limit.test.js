import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');

function block(start,end){
  const a=worker.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=worker.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return worker.slice(a,b);
}

test('distributed route guard reuses the existing atomic fixed-window RPC',()=>{
  const guard=block('const DISTRIBUTED_ROUTE_BURST_POLICIES','function productionSafetySnapshot');
  assert.match(guard,/async function enforceDistributedRouteBurst/);
  assert.match(guard,/supaRpc\(cfg, 'claim_provider_request'/);
  assert.match(guard,/p_bucket_key: `route:\$\{Number\(user\.id\)\}:\$\{policy\.label\}`/);
  assert.match(guard,/DISTRIBUTED_BURST_GUARD/);
  assert.match(guard,/distributedBurstBlocks/);
  assert.match(guard,/distributedBurstFallbacks/);
});

test('distributed route guard protects expensive and mutation routes',()=>{
  const guard=block('const DISTRIBUTED_ROUTE_BURST_POLICIES','function distributedRouteBurstPolicy');
  for(const token of [
    "'/api/analyze'",
    "'/api/match-center'",
    "'/api/search'",
    "'/api/team'",
    "'/api/favorites'",
    "'/api/reminders'",
    "'/api/preferences'",
    "'/api/billing/'",
  ]) assert.ok(guard.includes(token),token);
  assert.match(guard,/m !== 'GET'/);
});

test('local burst guard remains the first and cheapest protection layer',()=>{
  const routing=block('const burstResponse = enforceRouteBurst','try {\n        return await dispatchApiRoute');
  const localAt=routing.indexOf('enforceRouteBurst');
  const distributedAt=routing.indexOf('enforceDistributedRouteBurst');
  assert.ok(localAt>=0 && distributedAt>localAt);
  assert.match(routing,/if \(burstResponse\) return burstResponse/);
  assert.match(routing,/if \(distributedBurstResponse\) return distributedBurstResponse/);
});

test('distributed guard fails soft to the existing local limiter if Supabase is unavailable',()=>{
  const guard=block('async function enforceDistributedRouteBurst','function productionSafetySnapshot');
  assert.match(guard,/if \(!policy \|\| !user\?\.id \|\| !hasSupabase\(cfg\)\) return null/);
  assert.match(guard,/catch \(error\)/);
  assert.match(guard,/DISTRIBUTED_ROUTE_GUARD_DEGRADED/);
  assert.match(guard,/return null/);
});

test('stale shared rate windows are cleaned without touching active buckets',()=>{
  assert.match(worker,/async function cleanupRateWindows/);
  assert.match(worker,/Date\.now\(\) - 2 \* 86400_000/);
  assert.match(worker,/supaDelete\(cfg, 'provider_rate_windows', \{ updated_at: `lt\.\$\{cutoff\}` \}\)/);
  assert.match(worker,/\['rate_window_cleanup', cleanupRateWindows\(cfg\)\]/);
});
