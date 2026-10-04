import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dispatchApiRoute } from '../src/router.js';

const request = method => ({ method });
const url = pathname => ({ pathname });
const baseDeps = () => ({
  json: (body, status = 200) => ({ body, status }),
  publicDataCapabilities: () => ({ ok: true }),
  isAdminUser: () => false,
  adminForbidden: () => ({ status: 403, body: { error: 'forbidden' } }),
  memory: { providerAudit: { last: null } },
});

test('router resolves normal-user API route without changing handler arguments', async () => {
  const calls = [];
  const deps = { ...baseDeps(), apiMe: async (...args) => { calls.push(args); return { ok: 'me' }; } };
  const req = request('GET');
  const cfg = { marker: 'cfg' };
  const user = { id: 42 };
  const result = await dispatchApiRoute(req, url('/api/me'), cfg, user, deps);
  assert.deepEqual(result, { ok: 'me' });
  assert.deepEqual(calls[0], [req, cfg, user]);
});

test('admin routes remain isolated inside router boundary', async () => {
  let handlerCalled = false;
  const deps = { ...baseDeps(), apiDiagnostics: async () => { handlerCalled = true; } };
  const result = await dispatchApiRoute(request('GET'), url('/api/diagnostics'), {}, { id: 7 }, deps);
  assert.equal(result.status, 403);
  assert.equal(handlerCalled, false);
});

test('unknown API route keeps response compatibility', async () => {
  const result = await dispatchApiRoute(request('GET'), url('/api/not-real'), {}, { id: 7 }, baseDeps());
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'Маршрут не найден.');
});

test('billing stays unavailable while monetization is disabled', async () => {
  const result = await dispatchApiRoute(request('GET'), url('/api/billing/plans'), { monetizationEnabled: false }, { id: 7 }, baseDeps());
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'Монетизация отложена до финального этапа проекта.');
});


test('router blocks exact replay of a successful sensitive admin mutation', async () => {
  let calls=0;
  const memory={ providerAudit:{last:null} };
  const distributed=new Map();
  let lease=0;
  const sensitiveMutationCoordinator={
    claim:async identity=>{
      const existing=distributed.get(identity.operationKey);
      if (existing) return {claimed:false,state:existing.state,reason:existing.state==='completed'?'duplicate_completed':'duplicate_inflight'};
      const leaseToken='router-lease-'+(++lease);
      distributed.set(identity.operationKey,{state:'inflight',leaseToken});
      return {claimed:true,state:'inflight',reason:'claimed',leaseToken};
    },
    complete:async (identity,claim)=>{
      const row=distributed.get(identity.operationKey);
      if (!row || row.leaseToken!==claim.leaseToken) return {ok:false};
      distributed.set(identity.operationKey,{...row,state:'completed'});
      return {ok:true};
    },
    fail:async()=>({ok:true}),
  };
  const deps={
    ...baseDeps(),
    memory,
    sensitiveMutationCoordinator,
    isAdminUser:()=>true,
    apiRuntimeControls:async()=>{ calls+=1; return {status:200,body:{ok:true}}; },
  };
  const makeRequest=()=>new Request('https://example.com/api/runtime-controls',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({providerEnabled:false}),
  });
  const user={id:42};

  const firstReq=makeRequest();
  const first=await dispatchApiRoute(firstReq,new URL(firstReq.url),{},user,deps);
  assert.equal(first.status,200);

  const replayReq=makeRequest();
  const replay=await dispatchApiRoute(replayReq,new URL(replayReq.url),{},user,deps);
  assert.equal(replay.status,409);
  assert.equal(replay.body.code,'SENSITIVE_MUTATION_REPLAY_BLOCKED');
  assert.equal(calls,1);
});

test('worker authenticates and applies beta/runtime/burst guards before router dispatch', () => {
  const source = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const auth = source.indexOf('const user = await getRequestUser(request, cfg)');
  const beta = source.indexOf('const betaAccess = closedBetaAccessDecision(user, cfg)', auth);
  const runtime = source.indexOf('const runtimeResponse = runtimeGuard(request, user, cfg', beta);
  const burst = source.indexOf('const burstResponse = enforceRouteBurst(request, user)', runtime);
  const dispatch = source.indexOf('dispatchApiRoute(request, url, cfg, user, API_ROUTE_DEPS)', burst);
  assert.ok(auth > -1 && auth < beta && beta < runtime && runtime < burst && burst < dispatch);
});
