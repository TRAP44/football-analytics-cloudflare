import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserDataApiRuntime } from '../src/user-data-api-runtime.js';
import { createUserHistoryService } from '../src/user-history.js';
import { userDataDependencies } from '../test-support/runtime-deps.js';

// Сбой хранилища истории — это «история недоступна», а не «у вас нет анализов».

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json' },
});

function historyService(supaSelectMany) {
  return createUserHistoryService({
    memory: { history: new Map() },
    hasSupabase: () => true,
    supaUpsert: async (_cfg, _table, row) => row,
    supaSelectMany,
    retryDelayMs: 0,
  });
}

function api(getHistory, extra = {}) {
  return createUserDataApiRuntime(userDataDependencies({ getHistory, json, ...extra }));
}

test('strict history read throws a tagged error when storage fails, default stays fail-soft', async () => {
  const service = historyService(async () => { throw new Error('Supabase down'); });
  assert.deepEqual(await service.getHistory(7, {}), []);
  await assert.rejects(service.getHistory(7, {}, { strict: true }), error => error.code === 'HISTORY_UNAVAILABLE');
});

test('strict history read rejects malformed storage rows instead of reporting empty history', async () => {
  const service = historyService(async () => ({ rows: [] }));
  assert.deepEqual(await service.getHistory(7, {}), []);
  await assert.rejects(service.getHistory(7, {}, { strict: true }), error => error.code === 'HISTORY_UNAVAILABLE');
});

test('strict history read keeps a real empty history empty', async () => {
  const service = historyService(async () => []);
  assert.deepEqual(await service.getHistory(7, {}, { strict: true }), []);
});

test('/api/history answers 503 HISTORY_UNAVAILABLE instead of an empty list on storage failure', async () => {
  let options = null;
  const runtime = api(async (_userId, _cfg, opts) => {
    options = opts;
    const error = new Error('down');
    error.code = 'HISTORY_UNAVAILABLE';
    throw error;
  });
  const response = await runtime.apiHistory(new Request('https://x.test/api/history'), {}, { id: 7 });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'HISTORY_UNAVAILABLE');
  assert.equal(body.items, undefined);
  assert.deepEqual(options, { strict: true });
});

test('/api/history-analysis answers 503 instead of "not in your history" on storage failure', async () => {
  const runtime = api(async () => { throw new Error('down'); });
  const response = await runtime.apiHistoryAnalysis(
    new Request('https://x.test/api/history-analysis?fixtureId=11'), {}, { id: 7 },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'HISTORY_UNAVAILABLE');
});

test('/api/history keeps returning items when storage answers', async () => {
  const runtime = api(async () => [{ fixture_id: 11, home_name: 'A', away_name: 'B' }]);
  const response = await runtime.apiHistory(new Request('https://x.test/api/history'), {}, { id: 7 });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).items.length, 1);
});
