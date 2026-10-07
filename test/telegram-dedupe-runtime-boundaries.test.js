import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramDedupeRuntime } from '../src/telegram-dedupe.js';

function buildRuntime(overrides = {}) {
  const memory = {
    telegramUpdateDedupe: new Map(),
    telegramBurst: new Map(),
  };
  const api = createTelegramDedupeRuntime({
    memory,
    pruneMemoryState: () => {},
    bumpTelemetry: () => {},
    hasSupabase: () => false,
    supaRpc: async () => true,
    redactOpsString: (value, limit = 160) => String(value ?? '').slice(0, limit),
    ...overrides,
  });
  return { api, memory };
}

function validHealthPayload(overrides = {}) {
  return {
    window_minutes: 60,
    ledger_rows: 0,
    claims_recent: 0,
    completed_recent: 0,
    failed_recent: 0,
    failed_current: 0,
    active_processing: 0,
    stale_processing: 0,
    duplicate_attempts_retained: 0,
    duplicate_rows_recent: 0,
    last_duplicate_at: null,
    oldest_stale_seconds: 0,
    generated_at: new Date().toISOString(),
    ...overrides,
  };
}

test('Telegram dedupe factory rejects non-object dependency bags', () => {
  assert.throws(
    () => createTelegramDedupeRuntime([]),
    /dependencies are required/,
  );
  assert.throws(
    () => createTelegramDedupeRuntime(null),
    /dependencies are required/,
  );
});

test('Telegram dedupe treats dependency failures as degraded state instead of crashing', async () => {
  const { api } = buildRuntime({
    bumpTelemetry: () => { throw new Error('telemetry offline'); },
    hasSupabase: () => { throw new Error('config probe failed'); },
  });

  const result = await api.claimTelegramUpdatePersistent(
    {},
    'b:id-111111111:u:10',
    { callback_query:{ data:'favorite:toggle:1:2' } },
  );

  assert.equal(result.status, 'fail_closed');
  assert.equal(result.claimed, false);
  assert.equal(result.retry, true);
  assert.equal(await api.completeTelegramUpdatePersistent({}, 'b:id-111111111:u:10'), false);
  assert.equal(await api.releaseTelegramUpdatePersistent({}, 'b:id-111111111:u:10'), false);

  const health = await api.readTelegramDedupeHealth({}, 60);
  assert.equal(health.available, false);
  assert.equal(health.state, 'watch');
});

test('Telegram dedupe persistent completion and release report the RPC boolean result', async () => {
  const calls = [];
  const { api } = buildRuntime({
    hasSupabase: () => true,
    supaRpc: async (_cfg, name) => {
      calls.push(name);
      return false;
    },
  });

  assert.equal(await api.completeTelegramUpdatePersistent({}, 'b:id-111111111:u:11'), false);
  assert.equal(await api.releaseTelegramUpdatePersistent({}, 'b:id-111111111:u:11'), false);
  assert.deepEqual(calls, ['complete_telegram_update', 'release_telegram_update']);
});

test('Telegram dedupe health never reports malformed evidence as healthy', () => {
  const { api } = buildRuntime();

  const malformed = api.normalizeTelegramDedupeHealth({
    ...validHealthPayload(),
    ledger_rows: 'not-a-counter',
  }, true);

  assert.equal(malformed.available, false);
  assert.equal(malformed.evidenceValid, false);
  assert.equal(malformed.state, 'watch');
  assert.equal(malformed.detail, 'invalid_dedupe_health_payload');

  const valid = api.normalizeTelegramDedupeHealth(validHealthPayload(), true);
  assert.equal(valid.available, true);
  assert.equal(valid.evidenceValid, true);
  assert.equal(valid.state, 'healthy');
});

test('Telegram dedupe rejects keys longer than the persistent RPC contract', async () => {
  let rpcCalls = 0;
  const { api } = buildRuntime({
    hasSupabase: () => true,
    supaRpc: async () => {
      rpcCalls += 1;
      return true;
    },
  });

  const oversized = 'x'.repeat(181);
  const result = await api.claimTelegramUpdatePersistent(
    {},
    oversized,
    { callback_query:{ data:'match:review:44' } },
  );

  assert.equal(result.status, 'fail_closed');
  assert.equal(result.claimed, false);
  assert.equal(result.risk, 'external_side_effect');
  assert.equal(await api.completeTelegramUpdatePersistent({}, oversized), false);
  assert.equal(await api.releaseTelegramUpdatePersistent({}, oversized), false);
  assert.equal(rpcCalls, 0);
});

test('Telegram dedupe ignores corrupted future local timestamps', () => {
  const { api, memory } = buildRuntime();
  const cfg = { botToken:'111111111:test-secret' };
  const update = { update_id:99 };
  const key = api.telegramUpdateDedupeKey(update, cfg);

  memory.telegramUpdateDedupe.set(key, {
    at: Date.now() + 60_000,
    state:'processing',
  });
  assert.equal(api.claimTelegramUpdate(update, cfg).duplicate, false);

  memory.telegramBurst.set('7:message', {
    startedAt: Date.now() + 60_000,
    count: 99,
  });
  const blocked = api.enforceTelegramBurst({
    message:{ from:{ id:7 }, text:'/today' },
  });
  assert.equal(blocked, null);
  assert.equal(memory.telegramBurst.get('7:message').count, 1);
});

test('Telegram dedupe pruning failures cannot break an accepted local claim', () => {
  const memory = {
    telegramUpdateDedupe: new Map(),
    telegramBurst: new Map(),
  };
  for (let index = 0; index < 4001; index += 1) {
    memory.telegramUpdateDedupe.set('seed-' + index, { at:Date.now(), state:'done' });
  }
  const api = createTelegramDedupeRuntime({
    memory,
    pruneMemoryState: () => { throw new Error('prune failed'); },
    bumpTelemetry: () => {},
    hasSupabase: () => false,
    supaRpc: async () => true,
    redactOpsString: value => String(value ?? ''),
  });

  const result = api.claimTelegramUpdate(
    { update_id:100 },
    { botToken:'111111111:test-secret' },
  );
  assert.equal(result.duplicate, false);
  assert.ok(result.key);
});
