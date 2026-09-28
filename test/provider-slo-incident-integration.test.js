import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('src/worker.js','utf8');
const incidents = fs.readFileSync('src/provider-slo-incidents.js','utf8');
const admin = fs.readFileSync('public/modules/admin-provider.js','utf8');
const html = fs.readFileSync('public/index.html','utf8');
const css = fs.readFileSync('public/styles/admin.css','utf8');
const smoke = fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

test('production monitor persists provider SLO incident transitions only with a fresh SLO window', () => {
  assert.match(worker, /providerSloFlush\?\.ok && providerSloIncident\.transition/);
  assert.match(worker, /providerSloIncidentOpsEvent\(providerSloIncident\.transition\)/);
  assert.match(worker, /eventType:'slo_incident'/);
  assert.match(incidents, /PROVIDER_SLO_WATCH/);
  assert.match(incidents, /PROVIDER_SLO_INCIDENT/);
  assert.match(incidents, /PROVIDER_SLO_RECOVERED/);
});

test('provider incident state affects monitoring visibility but never automatic controls', () => {
  assert.match(worker, /providerSloState: providerSloIncident\.state/);
  assert.match(worker, /\['watch','incident'\]\.includes\(providerSloState\)/);
  assert.match(incidents, /automaticRollback: false/);
  assert.match(incidents, /automaticFeatureDisable: false/);
  assert.doesNotMatch(incidents, /runtimeControls|rollbackRuntime|apiRuntimeRollback/);
});

test('provider API and diagnostics include incident state and runbook', () => {
  assert.match(worker, /incident: buildProviderSloIncidentTimeline\(source\.items\)/);
  assert.match(worker, /providerObservability\?\.incident\?\.activeIncident\?\.runbook/);
  assert.match(worker, /providerSloIncidentIntegration: 'enabled'/);
  assert.match(worker, /providerSloIncidentSelfTest/);
});

test('admin-only provider panel renders incident status, runbook and short history', () => {
  for (const id of [
    'providerSloIncidentPanel',
    'providerSloIncidentBadge',
    'providerSloIncidentTitle',
    'providerSloIncidentMeta',
    'providerSloIncidentRunbook',
    'providerSloIncidentHistory',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(admin, /activeIncident/);
  assert.match(admin, /Подтверждено двумя SLO-окнами/);
  assert.match(admin, /Автоматические rollback и отключение функций не выполняются/);
  assert.match(css, /\.provider-slo-incident/);
});

test('production smoke requires provider SLO incident integration health flags', () => {
  assert.match(smoke, /'providerSloIncidentIntegration'/);
  assert.match(smoke, /'providerSloIncidentSelfTest'/);
});
