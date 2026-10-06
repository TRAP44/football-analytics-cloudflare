import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientTelemetryRuntime } from '../src/client-telemetry-runtime.js';
import { createTelemetryOpsRuntime } from '../src/telemetry-ops-runtime.js';
import { runtimeReleaseIdentity } from '../src/release-identity.js';
import {
  BOOT_OK_REQUIRED_METADATA,
  CLIENT_TELEMETRY_CODES,
  CLIENT_TELEMETRY_EVENT_TYPE,
  assessClientTelemetryEvidence,
  canonicalClientTelemetrySelector,
  clientTelemetrySqlWhere,
} from '../src/client-telemetry-contract.js';

const PRODUCT_ACTIONS = new Set([
  'matches_open',
  'search_used',
  'search_found',
  'search_empty',
  'match_open',
  'live_open',
  'ai_start',
  'ai_complete',
  'history_open',
  'history_item_open',
  'profile_open',
  'player_open',
]);

const ACTION_ERROR_REASONS = new Set([
  'matches',
  'search',
  'match',
  'live_refresh',
  'ai',
  'history',
  'profile',
  'profile_modules',
  'billing_ui',
]);

const ACTION_ERROR_KINDS = new Set([
  'offline',
  'maintenance',
  'feature_disabled',
  'auth',
  'timeout',
  'rate_limit',
  'integrity',
  'database',
  'provider',
  'service',
  'unknown',
]);

const TIMING_OPERATIONS = new Set(['search', 'match', 'ai', 'live']);
const TELEMETRY_EVENTS = new Set(
  Object.values(CLIENT_TELEMETRY_CODES).map(code => String(code).toLowerCase()),
);
const DEPLOY_SHA = '0123456789abcdef0123456789abcdef01234567';

function telemetryRequest(body) {
  return { json: async () => body };
}

function validBootMeta(overrides = {}) {
  return {
    clientVersion: '6.120.0',
    apiContract: 5,
    releaseChannel: 'production',
    view: 'matchesView',
    bootMs: 480,
    moduleReadyMs: 24,
    navigationReadyMs: 512,
    feedMs: 190,
    viewportWidth: 390,
    ...overrides,
  };
}

function storedBootMetadata(overrides = {}) {
  return {
    deploySha: DEPLOY_SHA,
    viewportWidth: 390,
    bootMs: 480,
    moduleReadyMs: 24,
    navigationReadyMs: 512,
    feedMs: 190,
    ...overrides,
  };
}

function createHarness() {
  const memory = {
    clientTelemetryDedupe: new Map(),
    opsEvents: [],
    telemetry: {},
  };
  const growth = [];
  const opsRuntime = createTelemetryOpsRuntime({
    MAX_MEMORY_OPS_EVENTS: 100,
    currentReleaseIdentity: cfg => runtimeReleaseIdentity(cfg?.cfVersionMetadata, {
      appVersion: '6.120.0-rc144',
      releaseCandidate: 'RC144',
    }),
    fetchWithTimeout: async () => {
      throw new Error('unexpected persistent ops write');
    },
    hasSupabase: () => false,
    memory,
    observeProviderRequestLocal: () => {},
    supaHeaders: () => ({}),
    supaRpc: async () => ({ ok: true }),
  });

  const runtime = createClientTelemetryRuntime({
    CLIENT_ACTION_ERROR_KINDS: ACTION_ERROR_KINDS,
    CLIENT_ACTION_ERROR_REASONS: ACTION_ERROR_REASONS,
    CLIENT_PRODUCT_ACTIONS: PRODUCT_ACTIONS,
    CLIENT_TELEMETRY_EVENTS: TELEMETRY_EVENTS,
    CLIENT_TIMING_OPERATIONS: TIMING_OPERATIONS,
    CLOSED_BETA_COHORT: 'closed_beta_v1',
    bytesToHex: bytes => [...bytes].map(value => Number(value).toString(16).padStart(2, '0')).join(''),
    enc: new TextEncoder(),
    ensureLaunchAttribution: async () => ({}),
    hmacSha256: async () => new Uint8Array(32).fill(0xab),
    isAdminUser: () => false,
    isClosedBetaUser: () => false,
    isTelegramValidatedUser: () => true,
    json: (body, status = 200) => ({ body, status }),
    memory,
    pruneMemoryState: () => {},
    recordGrowthEvent: async (_cfg, event) => {
      growth.push(event);
    },
    recordOpsEvent: opsRuntime.recordOpsEvent,
    redactOpsString: opsRuntime.redactOpsString,
  });

  const cfg = {
    cfVersionMetadata: {
      id: '12345678-1234-1234-1234-123456789abc',
      tag: DEPLOY_SHA,
      timestamp: '2026-10-06T22:00:00.000Z',
    },
  };

  return { runtime, memory, growth, cfg };
}

test('canonical telemetry contract covers every accepted ingestion event', () => {
  assert.equal(CLIENT_TELEMETRY_EVENT_TYPE, 'client_telemetry');
  assert.deepEqual(
    [...TELEMETRY_EVENTS].sort(),
    [
      'action_error',
      'boot_ok',
      'boot_recovery',
      'client_error',
      'compatibility_block',
      'data_coverage',
      'network_recovery',
      'operation_timing',
      'product_action',
    ],
  );

  for (const code of Object.values(CLIENT_TELEMETRY_CODES)) {
    assert.deepEqual(canonicalClientTelemetrySelector(code.toLowerCase()), {
      eventType: 'client_telemetry',
      code,
    });
  }

  assert.equal(
    clientTelemetrySqlWhere('boot_ok'),
    "event_type = 'client_telemetry' and code = 'BOOT_OK'",
  );
  assert.throws(
    () => canonicalClientTelemetrySelector('NOT_REAL'),
    /Unsupported client telemetry code/,
  );
});

test('zero matching samples are explicit insufficient evidence', () => {
  const result = assessClientTelemetryEvidence([]);
  assert.equal(result.status, 'insufficient_evidence');
  assert.equal(result.sampleCount, 0);
  assert.equal(result.completeSampleCount, 0);
  assert.deepEqual(result.missingMetadata, BOOT_OK_REQUIRED_METADATA);
});

test('BOOT_OK evidence validates release identity and performance field semantics', () => {
  const valid = assessClientTelemetryEvidence([
    {
      event_type: 'client_telemetry',
      code: 'BOOT_OK',
      metadata: storedBootMetadata(),
    },
  ]);
  assert.equal(valid.status, 'confirmed');
  assert.equal(valid.completeSampleCount, 1);
  assert.deepEqual(valid.missingMetadata, []);

  const invalidCases = [
    ['deploySha', 'not-a-sha'],
    ['viewportWidth', true],
    ['viewportWidth', 199],
    ['bootMs', '480'],
    ['bootMs', -1],
    ['moduleReadyMs', Infinity],
    ['navigationReadyMs', 60001],
    ['feedMs', false],
  ];

  for (const [field, value] of invalidCases) {
    const result = assessClientTelemetryEvidence([
      {
        event_type: 'client_telemetry',
        code: 'BOOT_OK',
        metadata: storedBootMetadata({ [field]: value }),
      },
    ]);
    assert.equal(result.status, 'incomplete_samples', field);
    assert.equal(result.completeSampleCount, 0, field);
    assert.ok(result.missingMetadata.includes(field), field);
  }
});

test('fragmented incomplete BOOT_OK rows report the fields preventing confirmation', () => {
  const first = storedBootMetadata();
  delete first.feedMs;
  const second = storedBootMetadata();
  delete second.bootMs;

  const result = assessClientTelemetryEvidence([
    { event_type: 'client_telemetry', code: 'BOOT_OK', metadata: first },
    { event_type: 'client_telemetry', code: 'BOOT_OK', metadata: second },
  ]);

  assert.equal(result.status, 'incomplete_samples');
  assert.equal(result.completeSampleCount, 0);
  assert.deepEqual(result.missingMetadata, ['bootMs', 'feedMs']);
});

test('malformed metadata containers cannot satisfy BOOT_OK evidence', () => {
  const arrayMetadata = [];
  for (const field of BOOT_OK_REQUIRED_METADATA) {
    arrayMetadata[field] = field === 'deploySha' ? DEPLOY_SHA : 300;
  }

  const result = assessClientTelemetryEvidence([
    { event_type: 'client_telemetry', code: 'BOOT_OK', metadata: arrayMetadata },
  ]);

  assert.equal(result.status, 'incomplete_samples');
  assert.equal(result.completeSampleCount, 0);
  assert.deepEqual(result.missingMetadata, BOOT_OK_REQUIRED_METADATA);
});

test('custom required metadata remains normalized and deduplicated', () => {
  const result = assessClientTelemetryEvidence([
    {
      event_type: 'client_telemetry',
      code: 'PRODUCT_ACTION',
      metadata: { action: 'open_match' },
    },
  ], {
    code: 'product_action',
    requiredMetadata: [' action ', 'action', '', '   '],
  });

  assert.equal(result.status, 'confirmed');
  assert.deepEqual(result.missingMetadata, []);
});

test('real BOOT_OK ingestion plus ops release enrichment satisfies the canonical evidence contract', async () => {
  const { runtime, memory, cfg } = createHarness();

  const response = await runtime.apiClientTelemetry(
    telemetryRequest({
      event: 'boot_ok',
      meta: validBootMeta(),
    }),
    cfg,
    { id: 1001 },
  );

  assert.deepEqual(response, {
    status: 200,
    body: { ok: true, deduped: false },
  });
  assert.equal(memory.opsEvents.length, 1);

  const row = memory.opsEvents[0];
  assert.equal(row.event_type, CLIENT_TELEMETRY_EVENT_TYPE);
  assert.equal(row.code, CLIENT_TELEMETRY_CODES.BOOT_OK);
  assert.equal(row.metadata.deploySha, DEPLOY_SHA);
  for (const field of BOOT_OK_REQUIRED_METADATA) {
    assert.ok(Object.hasOwn(row.metadata, field), field);
  }

  const evidence = assessClientTelemetryEvidence(memory.opsEvents);
  assert.equal(evidence.status, 'confirmed');
  assert.equal(evidence.sampleCount, 1);
  assert.equal(evidence.completeSampleCount, 1);
  assert.deepEqual(evidence.missingMetadata, []);
});

test('incomplete BOOT_OK payload is rejected before it can poison dedupe state', async () => {
  const { runtime, memory, cfg } = createHarness();

  const incomplete = validBootMeta();
  delete incomplete.feedMs;

  const rejected = await runtime.apiClientTelemetry(
    telemetryRequest({
      event: 'boot_ok',
      meta: incomplete,
    }),
    cfg,
    { id: 2002 },
  );

  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, 'Incomplete boot telemetry.');
  assert.equal(memory.clientTelemetryDedupe.size, 0);
  assert.equal(memory.opsEvents.length, 0);

  const accepted = await runtime.apiClientTelemetry(
    telemetryRequest({
      event: 'boot_ok',
      meta: validBootMeta(),
    }),
    cfg,
    { id: 2002 },
  );

  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.deduped, false);
  assert.equal(memory.clientTelemetryDedupe.size, 1);
  assert.equal(memory.opsEvents.length, 1);
});
