import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const worker=fs.readFileSync('src/worker.js','utf8');
const alerts=fs.readFileSync('src/provider-incident-alerts.js','utf8');
const incidents=fs.readFileSync('src/provider-slo-incidents.js','utf8');
const admin=fs.readFileSync('public/modules/admin-provider.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

test('provider incident alerting extends existing ops_events and Telegram admin transport', () => {
  assert.match(worker,/readProviderIncidentAlertEvents/);
  assert.match(worker,/source','eq\.provider_alert'/);
  assert.match(worker,/sendMessage:\(chatId,text\) => sendTelegramMessage\(chatId,text,cfg\)/);
  assert.match(worker,/adminTelegramIds:cfg\.adminTelegramIds \|\| \[\]/);
  assert.doesNotMatch(worker,/TELEGRAM_PROVIDER_BOT|PROVIDER_ALERT_BOT_TOKEN/);
  assert.match(alerts,/source:'provider_alert'/);
  assert.match(alerts,/eventType:'alert_delivery'/);
  assert.match(alerts,/PROVIDER_SLO_ALERT_SENT/);
  assert.match(alerts,/PROVIDER_SLO_ALERT_FAILED/);
});

test('alert delivery is best effort and does not change runtime controls', () => {
  assert.match(worker,/try \{\s*delivery = await deliverProviderIncidentAlert/);
  assert.match(worker,/await recordOpsEvent\(cfg, alertEvent\)\.catch\(\(\) => \{\}\)/);
  assert.match(incidents,/automaticRollback:false/);
  assert.match(incidents,/automaticFeatureDisable:false/);
  assert.doesNotMatch(alerts,/rollbackRuntime|runtimeControls|provider switch|billing/i);
});

test('read-only health and admin probes cannot send Telegram incident alerts', () => {
  assert.match(worker,/const incidentAlertPlan = options\.record !== false[\s\S]*read_only_monitor/);
  assert.match(worker,/if \(options\.record !== false && incidentAlertPlan\.action === 'send'\)/);
  assert.match(worker,/runProductionMonitor\(cfg, new Date\(\), \{ record: false \}\)/);
});

test('admin-only incident UI exposes operational lifecycle details without public visibility', () => {
  assert.match(html,/id="providerStatusPanel"[^>]*data-admin-only[^>]*hidden/);
  assert.match(html,/id="providerSloIncidentDetails"/);
  for (const marker of ['Incident ID','Severity','Provider','Operation','Sample size','Последнее healthy окно','Recovery']) {
    assert.ok(admin.includes(marker),marker);
  }
  assert.match(admin,/incidentHistory\.slice\(0,5\)/);
});

test('release health and production smoke gate provider incident alert delivery', () => {
  assert.match(worker,/providerIncidentAlertDelivery: 'enabled'/);
  assert.match(worker,/providerIncidentAlertDeliverySelfTest: providerIncidentAlertSelfTest\(\)\.pass \? 'enabled' : 'failed'/);
  assert.match(smoke,/'providerIncidentAlertDelivery'/);
  assert.match(smoke,/'providerIncidentAlertDeliverySelfTest'/);
});

test('lifecycle events include watch, open, update, recovery and alert delivery state', () => {
  for (const marker of ['provider_watch_started','provider_incident_opened','provider_incident_updated','provider_incident_recovered']) {
    assert.ok(incidents.includes(marker),marker);
  }
  assert.match(alerts,/lifecycleEvent:ok \? 'alert_sent' : 'alert_failed'/);
});
