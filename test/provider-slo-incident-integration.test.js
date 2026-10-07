import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('src/worker.js','utf8');
const providerSloRuntime = fs.readFileSync('src/provider-slo-runtime.js','utf8');
const productionMonitor = fs.readFileSync('src/production-monitor-runtime.js','utf8');
const incidents = fs.readFileSync('src/provider-slo-incidents.js','utf8');
const admin = fs.readFileSync('public/modules/admin-provider.js','utf8');
const html = fs.readFileSync('public/admin.html','utf8');
const css = fs.readFileSync('public/styles/admin.css','utf8');
const smoke = fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

test('production monitor persists provider SLO incident transitions only with a fresh SLO window', () => {
  assert.match(productionMonitor, /providerSloFlush\?\.ok && providerSloIncident\.transition/);
  assert.match(productionMonitor, /providerSloIncidentOpsEvent\(providerSloIncident\.transition\)/);
  assert.match(incidents, /eventType:'slo_incident'/);
  assert.match(incidents, /PROVIDER_SLO_WATCH/);
  assert.match(incidents, /PROVIDER_SLO_INCIDENT/);
  assert.match(incidents, /PROVIDER_SLO_RECOVERED/);
});

test('provider incident state affects monitoring visibility but never automatic controls', () => {
  assert.match(productionMonitor, /providerSloState: providerSloIncident\.state/);
  assert.match(productionMonitor, /\['watch','incident'\]\.includes\(providerSloState\)/);
  assert.match(incidents, /automaticRollback:\s*false/);
  assert.match(incidents, /automaticFeatureDisable:\s*false/);
  assert.doesNotMatch(incidents, /runtimeControls|rollbackRuntime|apiRuntimeRollback/);
});

test('provider API and diagnostics include incident state and runbook', () => {
  assert.match(providerSloRuntime, /incident:buildProviderSloIncidentTimeline\(incidentSource\.items\)/);
  assert.match(providerSloRuntime, /function providerSloSelfTest\(\)/);
  assert.match(worker,/createProviderSloRuntime\(\{/);
  assert.match(worker,/createProductionMonitorRuntime\(\{/);
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

test('provider SLO incident integration remains part of current production monitor composition', () => {
  assert.match(worker,/buildProviderSloIncidentTimeline/);
  assert.match(worker,/providerSloIncidentOpsEvent/);
  assert.match(productionMonitor,/buildProviderSloIncidentTimeline\(providerSloWindows/);
  assert.match(productionMonitor,/providerSloIncidentOpsEvent/);
});
