import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramDedupeRuntime } from '../src/telegram-dedupe.js';

function runtime(overrides = {}) {
  const telemetry = [];
  const memory = {
    telegramUpdateDedupe: new Map(),
    telegramBurst: new Map(),
  };
  const deps = {
    memory,
    pruneMemoryState: () => {},
    bumpTelemetry: key => telemetry.push(key),
    hasSupabase: () => false,
    supaRpc: async () => true,
    redactOpsString: (value, limit = 160) => String(value || '').slice(0, limit),
    ...overrides,
  };
  return { memory, telemetry, api:createTelegramDedupeRuntime(deps) };
}

test('Phase 2 Telegram dedupe boundary keeps bot-scoped update identity', () => {
  const { api } = runtime();
  const cfg = { botToken:'111111111:primary-secret' };
  assert.equal(api.telegramUpdateDedupeKey({update_id:123},cfg),'b:id-111111111:u:123');
  assert.equal(api.telegramPersistentDedupeSelfTest().pass,true);
});

test('Phase 2 Telegram dedupe boundary keeps in-memory duplicate semantics', () => {
  const { api, telemetry } = runtime();
  const cfg = { botToken:'111111111:primary-secret' };
  const update = { update_id:123 };
  assert.equal(api.claimTelegramUpdate(update,cfg).duplicate,false);
  assert.equal(api.claimTelegramUpdate(update,cfg).duplicate,true);
  assert.deepEqual(telemetry,['telegramDuplicateUpdates']);
});

test('Phase 2 Telegram dedupe boundary keeps Supabase fail-open fallback semantics', async () => {
  const { api } = runtime();
  assert.deepEqual(
    await api.claimTelegramUpdatePersistent({},'b:id-111111111:u:123'),
    { persistent:false, claimed:true, duplicate:false, status:'fallback' },
  );
});

test('Phase 2 Telegram dedupe boundary keeps health classification semantics', () => {
  const { api } = runtime();
  assert.equal(api.telegramDedupeHealthState({available:true}).state,'healthy');
  assert.equal(api.telegramDedupeHealthState({available:true,staleProcessing:1}).state,'watch');
  assert.equal(api.telegramDedupeHealthState({available:true,staleProcessing:5}).state,'incident');
  assert.equal(api.telegramDedupeObservabilitySelfTest().pass,true);
});

test('Phase 2 Telegram burst guard keeps existing per-user message threshold', () => {
  const { api, telemetry } = runtime();
  const update = { message:{from:{id:7},text:'/start'} };
  for(let i=0;i<10;i++) assert.equal(api.enforceTelegramBurst(update),null);
  const blocked=api.enforceTelegramBurst(update);
  assert.equal(blocked.blocked,true);
  assert.equal(blocked.userId,7);
  assert.equal(blocked.kind,'message');
  assert.deepEqual(telemetry,['telegramBurstBlocks']);
});
