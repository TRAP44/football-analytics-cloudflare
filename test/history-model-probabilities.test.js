import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserDataApiRuntime } from '../src/user-data-api-runtime.js';
import { userDataDependencies } from '../test-support/runtime-deps.js';

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json' },
});

function runtime(extra = {}) {
  return createUserDataApiRuntime(userDataDependencies({
    getHistory: async () => [
      { fixture_id: 11, home_name: 'A', away_name: 'B', ai_confidence: 72, viewed_at: '2026-10-10T10:00:00Z' },
      { fixture_id: 12, home_name: 'C', away_name: 'D', viewed_at: '2026-10-10T10:01:00Z' },
    ],
    json,
    ...extra,
  }));
}

const call = async (rt) => (await rt.apiHistory(new Request('https://x.test/api/history'), {}, { id: 7 })).json();

test('history items carry first pre-match model probabilities when available', async () => {
  let asked = null;
  const body = await call(runtime({
    getModelProbabilities: async (ids) => { asked = ids; return { 11: { home: 52.3, draw: 26.1, away: 21.6 } }; },
  }));
  assert.deepEqual(asked, [11, 12]);
  assert.deepEqual(body.items[0].aiProbabilities, { home: 52.3, draw: 26.1, away: 21.6 });
  assert.equal(body.items[1].aiProbabilities, null);
});

test('history stays fully usable when probabilities cannot be loaded or are absent', async () => {
  const failing = await call(runtime({ getModelProbabilities: async () => { throw new Error('db down'); } }));
  assert.equal(failing.items.length, 2);
  assert.ok(failing.items.every(item => item.aiProbabilities === null));

  const garbage = await call(runtime({ getModelProbabilities: async () => [1, 2, 3] }));
  assert.ok(garbage.items.every(item => item.aiProbabilities === null));

  const missingDependency = await call(runtime());
  assert.equal(missingDependency.items[0].aiConfidence, 72);
  assert.equal(missingDependency.items[0].aiProbabilities, null);
});

test('worker model probability loader rejects implausible rows and bounds the request', async () => {
  const source = (await import('node:fs')).readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const loader = source.match(/async function getModelProbabilities[\s\S]*?\n}\n/);
  assert.ok(loader, 'getModelProbabilities must exist');
  assert.match(loader[0], /slice\(0, 200\)/);
  assert.match(loader[0], /sum < 98 \|\| sum > 102/);
  assert.match(loader[0], /select: 'fixture_id,home_prob,draw_prob,away_prob'/);
});
