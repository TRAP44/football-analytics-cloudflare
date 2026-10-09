import assert from 'node:assert/strict';
import test from 'node:test';

import { factories, workerRuntime as worker } from '../test-support/worker-root.js';

for (const name of factories) {
  test(`Worker composes ${name} using real dependencies`, () => {
    const runtime = worker[name]();
    assert.ok(runtime && typeof runtime === 'object');
    assert.equal(worker[name](), runtime, 'lazy initialization must reuse the runtime');
  });
}


test('model dashboard uses the real settlement eligibility policy', () => {
  const runtime = worker.getModelEvaluationRuntime();
  assert.equal(runtime.weightedTopCalibrationError([{fixture_id: 42}]), null);
  const dashboard = runtime.buildModelDashboard([{fixture_id: 42}], 30);
  assert.equal(dashboard.overview.sample, 0);
});

test('post-match delivery finalization and release share Worker cache state', async () => {
  const runtime = worker.getPostMatchReturnRuntime();
  const key = runtime.postMatchReturnDeliveryKey(123, 42);
  await runtime.finishPostMatchReturnClaim(key, 123, 42, {});
  await runtime.releasePostMatchReturnClaim(key, {});
});

const newsRuntime = worker.getNewsImpactRecoveryRuntime();
for (const [name, drill] of Object.entries(newsRuntime)) {
  if (!name.endsWith('Drill')) continue;
  test(`Worker News Impact ${name} passes with production contract values`, async () => {
    const result = await drill();
    assert.equal(result.pass, true);
    assert.ok(result.cases > 0);
  });
}


test('publisher rejects malformed JSON through the real Worker dependency', async () => {
  const runtime = worker.getPublisherRuntime();
  const cfg = { adminTelegramIds: [123] };
  for (const handler of ['apiChannelPublisherTest', 'apiMediaPublisherLink']) {
    const response = await runtime[handler](new Request('https://app.test/api/admin', {
      method: 'POST', body: '{invalid',
    }), cfg, { id: 123 });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Некорректное тело/);
  }
});
