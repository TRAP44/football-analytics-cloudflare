import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const worker=fs.readFileSync('src/worker.js','utf8');
const alerts=fs.readFileSync('src/provider-incident-alerts.js','utf8');
const incidents=fs.readFileSync('src/provider-slo-incidents.js','utf8');
const migration=fs.readFileSync('supabase/migrations/supabase_migration_v6_20.sql','utf8');
const migration405=fs.readFileSync('supabase/migrations/supabase_migration_v6_26_2.sql','utf8');
const admin=fs.readFileSync('public/modules/admin-provider.js','utf8');
const html=fs.readFileSync('public/admin.html','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

test('incident alert delivery uses a persistent ledger and atomic PostgreSQL claim', () => {
  assert.match(worker,/readProviderIncidentAlertDeliveries/);
  assert.match(worker,/claim_provider_incident_alert_delivery_v2/);
  assert.match(worker,/begin_provider_incident_alert_delivery_send/);
  assert.match(worker,/finalize_provider_incident_alert_delivery/);
  assert.match(worker,/planProviderIncidentAlert\(providerSloIncident, providerAlertLedger\.items/);
  assert.doesNotMatch(worker,/planProviderIncidentAlert\(providerSloIncident, providerAlertSource\.items/);
  assert.match(migration,/create table if not exists public\.provider_incident_alert_deliveries/);
  assert.match(migration,/constraint provider_incident_alert_delivery_identity\s+unique \(incident_id, transition, destination_key\)/);
  assert.match(migration,/on conflict do nothing/);
  assert.match(migration,/for update/);
});

test('claim persistence is fail-closed and ambiguous Telegram outcomes become unknown', () => {
  assert.match(alerts,/state:'persistence_failure'/);
  assert.match(worker,/blockedCandidate:true/);
  assert.match(worker,/Telegram delivery was suppressed/);
  assert.match(worker,/outcome:'unknown'/);
  assert.match(alerts,/state:'unknown'/);
  assert.match(migration,/status = 'unknown'/);
  assert.match(migration,/STALE_SENDING_LEASE/);
  assert.doesNotMatch(alerts,/immediateRetryAttempts/);
});

test('429 and confirmed temporary failures retain the same ledger identity for controlled retry', () => {
  assert.match(alerts,/status === 429/);
  assert.match(alerts,/state:'retry_pending'/);
  assert.match(alerts,/retryAt:new Date/);
  assert.match(migration,/v_row\.status = 'retry_pending'/);
  assert.match(migration,/attempts = attempts \+ 1/);
  assert.match(migration,/v_row\.retry_at is not null and v_row\.retry_at > v_now/);
});

test('one recipient failure cannot discard the other delivery outcomes', () => {
  assert.match(alerts,/Promise\.allSettled/);
  assert.match(worker,/Promise\.allSettled\(alertEvents\.map/);
  assert.match(alerts,/PROVIDER_SLO_ALERT_DUPLICATE_SUPPRESSED/);
  assert.match(alerts,/PROVIDER_SLO_ALERT_RETRY_PENDING/);
  assert.match(alerts,/PROVIDER_SLO_ALERT_TERMINAL_FAILED/);
  assert.match(alerts,/PROVIDER_SLO_ALERT_UNKNOWN/);
  assert.match(alerts,/PROVIDER_SLO_ALERT_PERSISTENCE_FAILED/);
  assert.match(alerts,/PROVIDER_SLO_RECOVERY_ALERT_SENT/);
});

test('v6.20 migration is additive, RLS protected and service-role-only', () => {
  assert.doesNotMatch(migration,/\bdrop\s+(table|column|function)\b/i);
  assert.doesNotMatch(migration,/\balter\s+table[\s\S]{0,120}\bdrop\b/i);
  assert.match(migration,/alter table public\.provider_incident_alert_deliveries enable row level security/);
  assert.match(migration,/revoke all on table public\.provider_incident_alert_deliveries from public, anon, authenticated/);
  assert.match(migration,/grant select, insert, update, delete on table public\.provider_incident_alert_deliveries to service_role/);
  assert.match(migration,/security invoker/g);
  assert.match(migration,/revoke execute on function public\.claim_provider_incident_alert_delivery[\s\S]*from public, anon, authenticated/);
  assert.match(migration,/provider_incident_alert_delivery_contract/);
});

test('destination identity is deterministic without exposing raw Telegram identity in ops metadata', () => {
  assert.match(alerts,/providerIncidentDestinationKey/);
  assert.match(alerts,/crypto\.subtle\.digest\('SHA-256'/);
  assert.match(alerts,/providerIncidentBotIdentity/);
  assert.match(worker,/const botIdentity=providerIncidentBotIdentity\(cfg\.botToken\)/);
  assert.match(worker,/providerIncidentDestinationKey\(chatId,botIdentity\)/);
  assert.doesNotMatch(worker,/providerIncidentDestinationKey\(chatId,cfg\.botToken/);
  assert.doesNotMatch(alerts,/meta:\{[\s\S]{0,600}(chatId|telegramId|botToken)/);
});

test('read-only health and admin probes cannot send Telegram incident alerts', () => {
  assert.match(worker,/incidentAlertCandidate = options\.record !== false[\s\S]*read_only_monitor/);
  assert.match(worker,/if \(options\.record !== false && incidentAlertPlan\.action === 'send'\)/);
  assert.match(worker,/runProductionMonitor\(cfg, new Date\(\), \{ record: false \}\)/);
});

test('admin-only incident UI remains operational and no rollback or provider switching is added', () => {
  assert.match(html,/id="providerStatusPanel"[^>]*data-admin-only[^>]*hidden/);
  assert.match(html,/id="providerSloIncidentDetails"/);
  for (const marker of ['Incident ID','Severity','Provider','Operation','Sample size','Последнее healthy окно','Recovery']) {
    assert.ok(admin.includes(marker),marker);
  }
  assert.match(admin,/incidentHistory\.slice\(0,5\)/);
  assert.match(incidents,/automaticRollback:false/);
  assert.match(incidents,/automaticFeatureDisable:false/);
  assert.doesNotMatch(alerts,/rollbackRuntime|runtimeControls|provider switch|billing/i);
});

test('release health and production smoke require persistent and unknown-safe alert delivery', () => {
  assert.match(worker,/providerIncidentAlertDelivery:'enabled'/);
  assert.match(worker,/providerIncidentAlertPersistence:'enabled'/);
  assert.match(worker,/providerIncidentAlertUnknownSafety:'enabled'/);
  assert.match(worker,/providerIncidentAlertDeliverySelfTest:providerIncidentAlertSelfTest\(\)\.pass \? 'enabled' : 'failed'/);
  for (const marker of [
    'providerIncidentAlertDelivery',
    'providerIncidentAlertPersistence',
    'providerIncidentAlertUnknownSafety',
    'providerIncidentAlertDeliverySelfTest',
  ]) {
    assert.ok(smoke.includes("'" + marker + "'"),marker);
  }
});

test('operational lifecycle includes watch, incident, recovery and delivery states', () => {
  for (const marker of ['provider_watch_started','provider_incident_opened','provider_incident_updated','provider_incident_recovered']) {
    assert.ok(incidents.includes(marker),marker);
  }
  for (const marker of ['alert_claim_acquired','alert_duplicate_suppressed','alert_sent','alert_retry_pending','alert_terminal_failed','alert_unknown','alert_persistence_failure']) {
    assert.ok(alerts.includes(marker),marker);
  }
});


test('v6.26.2 adds two-phase reclaimable alert claims without weakening ambiguous-send safety', () => {
  assert.match(migration405,/delivery_phase in \('legacy','claimed','sending','retry'\)/);
  assert.match(migration405,/destination_identity_version text not null default 'legacy'/);
  assert.match(migration405,/destination_identity_version in \('legacy','stable_v1'\)/);
  assert.match(migration405,/create or replace function public\.claim_provider_incident_alert_delivery_v2/);
  assert.match(migration405,/create or replace function public\.begin_provider_incident_alert_delivery_send/);
  assert.match(migration405,/coalesce\(v_row\.delivery_phase,'legacy'\) = 'claimed'/);
  assert.match(migration405,/stale_claim_reclaimed/);
  assert.match(migration405,/STALE_SENDING_LEASE/);
  assert.match(migration405,/set status='sending'/);
  assert.match(alerts,/beginDelivery/);
  assert.match(alerts,/begin_delivery_unconfirmed/);
  assert.match(worker,/beginDelivery:input => beginProviderIncidentAlertDeliverySend\(cfg,input\)/);
});

test('v6.26.2 keeps the v1 claim RPC for rollback compatibility and hardens table grants', () => {
  assert.match(migration405,/create or replace function public\.claim_provider_incident_alert_delivery\(/);
  assert.match(migration405,/create or replace function public\.claim_provider_incident_alert_delivery_v2\(/);
  assert.match(migration405,/revoke all privileges on table public\.provider_incident_alert_deliveries[\s\S]*service_role/);
  assert.match(migration405,/grant select, insert, update, delete on table public\.provider_incident_alert_deliveries[\s\S]*to service_role/);
  assert.match(migration405,/revoke execute on function public\.claim_provider_incident_alert_delivery_v2[\s\S]*from public, anon, authenticated/);
});
