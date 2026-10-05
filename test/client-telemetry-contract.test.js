import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BOOT_OK_REQUIRED_METADATA,
  CLIENT_TELEMETRY_CODES,
  CLIENT_TELEMETRY_EVENT_TYPE,
  assessClientTelemetryEvidence,
  canonicalClientTelemetrySelector,
  clientTelemetrySqlWhere,
} from '../src/client-telemetry-contract.js';

const app = fs.readFileSync('public/app.js', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');

function block(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, startNeedle + ' missing');
  assert.ok(end > start, endNeedle + ' missing after ' + startNeedle);
  return source.slice(start, end);
}

test('canonical BOOT_OK selector uses ops event_type plus code, not BOOT_OK as event_type', () => {
  assert.equal(CLIENT_TELEMETRY_EVENT_TYPE, 'client_telemetry');
  assert.deepEqual(canonicalClientTelemetrySelector('boot_ok'), {
    eventType: 'client_telemetry',
    code: 'BOOT_OK',
  });
  assert.equal(
    clientTelemetrySqlWhere('BOOT_OK'),
    "event_type = 'client_telemetry' and code = 'BOOT_OK'",
  );
});

test('zero matching samples are explicit insufficient evidence, never a healthy result', () => {
  const result = assessClientTelemetryEvidence([]);
  assert.equal(result.status, 'insufficient_evidence');
  assert.equal(result.sampleCount, 0);
  assert.equal(result.completeSampleCount, 0);
  assert.deepEqual(result.missingMetadata, BOOT_OK_REQUIRED_METADATA);
});

test('BOOT_OK required metadata is applied after canonical code normalization', () => {
  const result = assessClientTelemetryEvidence([
    { event_type:'client_telemetry', code:'BOOT_OK', metadata:{} },
  ], { code:'boot_ok' });
  assert.equal(result.status,'incomplete_samples');
  assert.equal(result.completeSampleCount,0);
  assert.deepEqual(result.missingMetadata,BOOT_OK_REQUIRED_METADATA);
});

test('malformed requiredMetadata falls back to the canonical contract and arrays are not metadata objects', () => {
  const malformedRequired = assessClientTelemetryEvidence([
    { event_type:'client_telemetry', code:'BOOT_OK', metadata:{} },
  ], { code:'BOOT_OK', requiredMetadata:'deploySha' });
  assert.equal(malformedRequired.status,'incomplete_samples');
  assert.deepEqual(malformedRequired.missingMetadata,BOOT_OK_REQUIRED_METADATA);

  const arrayMetadata = [];
  for (const field of BOOT_OK_REQUIRED_METADATA) arrayMetadata[field] = field === 'deploySha'
    ? '0123456789abcdef0123456789abcdef01234567'
    : 123;
  const arrayResult = assessClientTelemetryEvidence([
    { event_type:'client_telemetry', code:'BOOT_OK', metadata:arrayMetadata },
  ]);
  assert.equal(arrayResult.status,'incomplete_samples');
  assert.equal(arrayResult.completeSampleCount,0);
});

test('custom required metadata is normalized and deduplicated', () => {
  const result=assessClientTelemetryEvidence([
    {event_type:'client_telemetry',code:'PRODUCT_ACTION',metadata:{action:'open_match'}},
  ],{
    code:'product_action',
    requiredMetadata:[' action ','action','','   '],
  });
  assert.equal(result.status,'confirmed');
  assert.deepEqual(result.missingMetadata,[]);
});

test('BOOT_OK evidence is confirmed only when canonical rows carry required release/performance fields', () => {
  const metadata = Object.fromEntries(BOOT_OK_REQUIRED_METADATA.map(field => [field, field === 'deploySha'
    ? '0123456789abcdef0123456789abcdef01234567'
    : 123]));
  const result = assessClientTelemetryEvidence([
    { event_type:'BOOT_OK', code:'', metadata },
    { event_type:'client_telemetry', code:'BOOT_OK', metadata },
  ]);
  assert.equal(result.status, 'confirmed');
  assert.equal(result.sampleCount, 1);
  assert.equal(result.completeSampleCount, 1);
  assert.deepEqual(result.missingMetadata, []);
});

test('client emits BOOT_OK with the required profiling metadata', () => {
  const boot = block(app, 'function hideBootGate', 'function showBootRecovery');
  assert.match(boot, /sendClientTelemetry\('boot_ok'/);
  for (const field of BOOT_OK_REQUIRED_METADATA.filter(field => field !== 'deploySha')) {
    assert.match(boot, new RegExp(field));
  }
  assert.match(app, /clientVersion: CLIENT_VERSION/);
});

test('server telemetry metadata retains viewport and timing fields and stores client telemetry under one event type', () => {
  const metadata = block(worker, 'function clientTelemetryMetadata', 'async function apiClientTelemetry');
  for (const field of [
    'bootMs',
    'moduleReadyMs',
    'navigationReadyMs',
    'responseEndMs',
    'domContentLoadedMs',
    'firstContentfulPaintMs',
    'manifestMs',
    'identityMs',
    'feedMs',
    'revealDelayMs',
    'viewportWidth',
  ]) {
    assert.match(metadata, new RegExp(field));
  }

  const api = block(worker, 'async function apiClientTelemetry', 'async function readOpsEventsRange');
  assert.match(api, /eventType:\s*'client_telemetry'/);
  assert.match(api, /code:\s*event\.toUpperCase\(\)/);
});

test('canonical contract covers release and product telemetry codes used by verification', () => {
  for (const code of ['BOOT_OK','PRODUCT_ACTION','ACTION_ERROR','NETWORK_RECOVERY']) {
    assert.equal(CLIENT_TELEMETRY_CODES[code], code);
  }
  assert.throws(() => canonicalClientTelemetrySelector('NOT_REAL'), /Unsupported client telemetry code/);
});
