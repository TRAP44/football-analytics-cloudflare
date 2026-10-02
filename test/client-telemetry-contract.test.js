import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  BOOT_TELEMETRY_REQUIRED_METADATA,
  CLIENT_TELEMETRY_EVENT_TYPE,
  CLIENT_TELEMETRY_EVENTS,
  bootTelemetryEvidence,
  clientTelemetryCode,
  clientTelemetryOpsFilter,
  isClientTelemetryOpsRow,
} from '../src/client-telemetry-contract.js';

test('client telemetry has one canonical ops envelope and deterministic codes', () => {
  assert.equal(CLIENT_TELEMETRY_EVENT_TYPE, 'client_telemetry');
  assert.ok(CLIENT_TELEMETRY_EVENTS.includes('boot_ok'));
  assert.equal(clientTelemetryCode('boot_ok'), 'BOOT_OK');
  assert.equal(clientTelemetryCode('product_action'), 'PRODUCT_ACTION');
  assert.deepEqual(clientTelemetryOpsFilter('boot_ok'), {
    source: 'client',
    eventType: 'client_telemetry',
    code: 'BOOT_OK',
  });
  assert.equal(clientTelemetryOpsFilter('unsupported'), null);
});

test('BOOT_OK evidence validator requires release, viewport and core startup timings', () => {
  const row = {
    source: 'client',
    event_type: 'client_telemetry',
    code: 'BOOT_OK',
    metadata: {
      deploySha: '01eca8f155db8908aec2d1083c600061ed4dcd66',
      bootMs: 1260,
      moduleReadyMs: 717,
      navigationReadyMs: 1977,
      responseEndMs: 188,
      domContentLoadedMs: 720,
      firstContentfulPaintMs: 601,
      manifestMs: 77,
      identityMs: 461,
      feedMs: 590,
      revealDelayMs: 121,
      viewportWidth: 402,
    },
  };
  const evidence = bootTelemetryEvidence(row);
  assert.equal(evidence.valid, true);
  assert.deepEqual(evidence.errors, []);
  assert.equal(evidence.viewportWidth, 402);
  assert.equal(evidence.timings.bootMs, 1260);
  assert.equal(isClientTelemetryOpsRow(row, 'boot_ok'), true);
  for (const key of BOOT_TELEMETRY_REQUIRED_METADATA) assert.ok(key in row.metadata, key);
});

test('BOOT_OK evidence rejects a wrong envelope instead of silently treating it as no samples', () => {
  const wrong = {
    source: 'client',
    event_type: 'boot_ok',
    code: '',
    metadata: {
      deploySha: '01eca8f155db8908aec2d1083c600061ed4dcd66',
      bootMs: 1260,
      moduleReadyMs: 717,
      navigationReadyMs: 1977,
      manifestMs: 77,
      identityMs: 461,
      feedMs: 590,
      revealDelayMs: 121,
      viewportWidth: 402,
    },
  };
  const evidence = bootTelemetryEvidence(wrong);
  assert.equal(evidence.valid, false);
  assert.ok(evidence.errors.includes('row_contract'));
});

test('worker and client both use the canonical telemetry contract', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(worker, /CLIENT_TELEMETRY_EVENT_TYPE/);
  assert.match(worker, /clientTelemetryCode\(event\)/);
  assert.match(app, /sendClientTelemetry\('boot_ok'/);
  for (const field of BOOT_TELEMETRY_REQUIRED_METADATA.filter(key => key !== 'deploySha')) {
    assert.ok(app.includes(field), field);
  }
  assert.match(worker, /currentReleaseIdentity\(cfg\)/);
});

test('repo verification material does not use BOOT_OK as the event_type filter', () => {
  const roots = ['docs', 'scripts', 'test'];
  const forbidden = new RegExp("event_type\\s*=\\s*['\"]" + 'BOOT_OK' + "['\"]", 'i');
  const offenders = [];
  const visit = target => {
    if (!fs.existsSync(target)) return;
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target)) visit(path.join(target, entry));
      return;
    }
    if (!/\.(?:js|md|sql)$/i.test(target)) return;
    const source = fs.readFileSync(target, 'utf8');
    if (forbidden.test(source)) offenders.push(target);
  };
  roots.forEach(visit);
  assert.deepEqual(offenders, []);
});

test('documentation includes the canonical BOOT_OK query and zero-sample warning', () => {
  const docs = fs.readFileSync('docs/CLIENT_TELEMETRY_CONTRACT.md', 'utf8');
  assert.match(docs, /source = 'client'/);
  assert.match(docs, /event_type = 'client_telemetry'/);
  assert.match(docs, /code = 'BOOT_OK'/);
  assert.match(docs, /zero-row result/i);
  assert.match(docs, /metadata\.deploySha/);
  assert.match(docs, /metadata\.viewportWidth/);
});
