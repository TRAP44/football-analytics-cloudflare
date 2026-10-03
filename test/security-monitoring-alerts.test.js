import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  assessSecuritySignals,
  formatSecurityIncidentAlert,
  isSecuritySignal,
  securityIncidentOpsEvent,
  securityIncidentTimeline,
} from '../src/security-incidents.js';

function event(minutesAgo, code, {
  source='security',
  severity='warning',
  metadata={},
  nowMs=Date.parse('2026-10-02T21:00:00Z'),
} = {}) {
  return {
    created_at:new Date(nowMs-minutesAgo*60_000).toISOString(),
    source,
    severity,
    event_type:'request_guard',
    code,
    metadata,
  };
}

test('single blocked request is watch noise, not an incident', () => {
  const nowMs=Date.parse('2026-10-02T21:00:00Z');
  const result=assessSecuritySignals([
    event(1,'CROSS_SITE_MUTATION_BLOCKED',{nowMs}),
  ],{nowMs});
  assert.equal(result.state,'watch');
  assert.equal(result.counts.crossSiteBlocks,1);
});

test('sustained cross-site blocks open a security incident', () => {
  const nowMs=Date.parse('2026-10-02T21:00:00Z');
  const result=assessSecuritySignals([
    event(1,'CROSS_SITE_MUTATION_BLOCKED',{nowMs}),
    event(2,'CROSS_ORIGIN_MUTATION_BLOCKED',{nowMs}),
    event(3,'CROSS_SITE_MUTATION_BLOCKED',{nowMs}),
  ],{nowMs});
  assert.equal(result.state,'incident');
  assert.equal(result.counts.crossSiteBlocks,3);
});

test('admin invalid-auth burst escalates immediately while normal auth needs repetition', () => {
  const nowMs=Date.parse('2026-10-02T21:00:00Z');
  const normal=assessSecuritySignals([
    event(1,'INVALID_AUTH_BURST_BLOCKED',{nowMs,metadata:{scope:'public'}}),
  ],{nowMs});
  assert.equal(normal.state,'watch');

  const admin=assessSecuritySignals([
    event(1,'INVALID_AUTH_BURST_BLOCKED',{nowMs,metadata:{scope:'admin'}}),
  ],{nowMs});
  assert.equal(admin.state,'incident');
  assert.equal(admin.severity,'critical');
});

test('provider rate limits do not become security incidents', () => {
  const nowMs=Date.parse('2026-10-02T21:00:00Z');
  const result=assessSecuritySignals([
    event(1,'FOOTBALL_RATE_LIMIT',{nowMs,source:'provider'}),
    event(2,'FOOTBALL_RATE_LIMIT_BODY',{nowMs,source:'provider'}),
  ],{nowMs});
  assert.equal(result.state,'healthy');
  assert.equal(result.signalCount,0);
});

test('security lifecycle stays open through watch and recovers only on a clean window', () => {
  const nowMs=Date.parse('2026-10-02T21:00:00Z');
  const incidentAssessment=assessSecuritySignals([
    event(1,'CROSS_SITE_MUTATION_BLOCKED',{nowMs}),
    event(2,'CROSS_SITE_MUTATION_BLOCKED',{nowMs}),
    event(3,'CROSS_SITE_MUTATION_BLOCKED',{nowMs}),
  ],{nowMs});
  const opened=securityIncidentTimeline(incidentAssessment,[],{nowMs});
  assert.equal(opened.transition?.kind,'opened');
  const openedEvent=securityIncidentOpsEvent(opened.transition);
  assert.equal(openedEvent.code,'SECURITY_INCIDENT_OPENED');

  const storedOpen={
    created_at:new Date(nowMs).toISOString(),
    source:'security_monitor',
    event_type:'security_incident',
    code:'SECURITY_INCIDENT_OPENED',
    metadata:{
      incidentId:opened.activeIncident.incidentId,
      startedAt:opened.activeIncident.startedAt,
    },
  };
  const watchAssessment=assessSecuritySignals([
    event(1,'CROSS_SITE_MUTATION_BLOCKED',{nowMs:nowMs+15*60_000}),
  ],{nowMs:nowMs+15*60_000});
  const watch=securityIncidentTimeline(watchAssessment,[storedOpen],{nowMs:nowMs+15*60_000});
  assert.equal(watch.transition,null);
  assert.equal(watch.activeIncident?.active,true);

  const healthy=assessSecuritySignals([],{nowMs:nowMs+30*60_000});
  const recovered=securityIncidentTimeline(healthy,[storedOpen],{nowMs:nowMs+30*60_000});
  assert.equal(recovered.transition?.kind,'recovered');
  assert.equal(securityIncidentOpsEvent(recovered.transition)?.code,'SECURITY_INCIDENT_RECOVERED');
});

test('security alert text contains aggregate diagnostics but no client identifiers', () => {
  const text=formatSecurityIncidentAlert({
    kind:'incident',
    incident:{
      incidentId:'security-test',
      severity:'incident',
      diagnostics:{
        reason:'test',
        primaryCode:'INVALID_AUTH_BURST_BLOCKED',
        signalCount:4,
        counts:{invalidAuthBursts:2,crossSiteBlocks:1,oversizedBlocks:1,webhookAnomalies:0,billingAnomalies:0},
        windowMinutes:15,
      },
    },
  });
  assert.match(text,/SECURITY incident/i);
  assert.match(text,/INVALID_AUTH_BURST_BLOCKED/);
  assert.doesNotMatch(text,/203\.0\.113\.|telegram_id|chat_id/i);
});

test('worker persists bounded request-guard buckets and wires security monitor to existing alert ledger', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  assert.match(worker,/security-request-guard:/);
  assert.match(worker,/transitionKey:'security-request-guard:'/);
  assert.match(worker,/assessSecuritySignals\(source\.items/);
  assert.match(worker,/securityIncidentTimeline\(securityAssessment/);
  assert.match(worker,/planProviderIncidentAlert\(securityIncident/);
  assert.match(worker,/deliverOperationalIncidentAlert\(\{/);
  assert.match(worker,/formatSecurityIncidentAlert/);
  assert.match(worker,/securityAttackMonitoring: 'enabled'/);
});

test('security monitoring does not create a second alert delivery system', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const block=worker.slice(
    worker.indexOf("if (options.record !== false && securityAlertPlan.action === 'send')"),
    worker.indexOf("if (options.record !== false && providerSloFlush?.ok"),
  );
  assert.match(block,/claimProviderIncidentAlertDelivery/);
  assert.match(block,/finalizeProviderIncidentAlertDelivery/);
  assert.doesNotMatch(block,/new Map\(|new Set\(/);
});


test('Issue #407 preserves critical assessment severity through incident lifecycle and ops event', () => {
  const nowMs=Date.parse('2026-10-03T20:00:00Z');
  const assessment=assessSecuritySignals([
    event(1,'INVALID_AUTH_BURST_BLOCKED',{nowMs,metadata:{scope:'admin'}}),
  ],{nowMs});
  assert.equal(assessment.severity,'critical');

  const timeline=securityIncidentTimeline(assessment,[],{nowMs});
  assert.equal(timeline.activeIncident?.severity,'critical');
  assert.equal(timeline.activeIncident?.diagnostics?.riskLevel,'critical');

  const opsEvent=securityIncidentOpsEvent(timeline.transition);
  assert.equal(opsEvent?.severity,'critical');
  assert.equal(opsEvent?.meta?.severity,'critical');

  const alert=formatSecurityIncidentAlert({kind:'incident',incident:timeline.activeIncident});
  assert.match(alert,/SECURITY incident/);
});

test('Issue #407 deduplicated security rows use true occurrence volume for thresholds', () => {
  const nowMs=Date.parse('2026-10-03T20:00:00Z');
  const row=event(1,'CROSS_SITE_MUTATION_BLOCKED',{nowMs});
  row.occurrence_count=3;
  row.last_occurred_at=new Date(nowMs-30_000).toISOString();
  row.metadata={...row.metadata,occurrenceCount:3,lastOccurredAt:row.last_occurred_at};

  const result=assessSecuritySignals([row],{nowMs});
  assert.equal(result.state,'incident');
  assert.equal(result.recordCount,1);
  assert.equal(result.signalCount,3);
  assert.equal(result.counts.total,3);
  assert.equal(result.counts.crossSiteBlocks,3);
  assert.equal(result.codes.CROSS_SITE_MUTATION_BLOCKED,3);
});

test('Issue #407 ordinary billing warnings do not become security signals', () => {
  const nowMs=Date.parse('2026-10-03T20:00:00Z');
  const row=event(1,'BILLING_MANUAL_REFUND',{
    nowMs,
    source:'billing',
    severity:'warning',
    metadata:{category:'operations'},
  });
  assert.equal(isSecuritySignal(row),false);
  const result=assessSecuritySignals([row],{nowMs});
  assert.equal(result.state,'healthy');
  assert.equal(result.signalCount,0);
  assert.equal(result.counts.billingAnomalies,0);
});

test('Issue #407 explicitly security-coded billing replay remains actionable', () => {
  const nowMs=Date.parse('2026-10-03T20:00:00Z');
  const row=event(1,'BILLING_REFUNDED_CHARGE_REPLAY_BLOCKED',{
    nowMs,
    source:'billing',
    severity:'warning',
  });
  row.occurrence_count=2;

  assert.equal(isSecuritySignal(row),true);
  const result=assessSecuritySignals([row],{nowMs});
  assert.equal(result.state,'incident');
  assert.equal(result.severity,'critical');
  assert.equal(result.signalCount,2);
  assert.equal(result.counts.billingAnomalies,2);
});

test('Issue #407 explicit billing security category is accepted without trusting severity alone', () => {
  const nowMs=Date.parse('2026-10-03T20:00:00Z');
  const row=event(1,'BILLING_PROVIDER_WARNING',{
    nowMs,
    source:'billing',
    severity:'warning',
    metadata:{securityCategory:'fraud'},
  });
  assert.equal(isSecuritySignal(row),true);
  assert.equal(assessSecuritySignals([row],{nowMs}).state,'watch');
});

test('Issue #407 persistence uses an atomic occurrence RPC with backward-compatible fallback', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const migration=fs.readFileSync('supabase/migrations/supabase_migration_v6_26_3.sql','utf8');
  assert.match(worker,/record_ops_event_occurrence/);
  assert.match(worker,/occurrenceCount:1/);
  assert.match(worker,/lastOccurredAt:createdAt/);
  assert.match(worker,/resolution=ignore-duplicates,return=minimal/);
  assert.match(migration,/add column if not exists occurrence_count integer not null default 1/i);
  assert.match(migration,/add column if not exists last_occurred_at timestamptz/i);
  assert.match(migration,/create or replace function public\.record_ops_event_occurrence/i);
  assert.match(migration,/on conflict \(transition_key\) do update/i);
  assert.match(migration,/occurrence_count = public\.ops_events\.occurrence_count \+ 1/i);
  assert.match(migration,/security invoker/i);
  assert.match(migration,/grant execute on function public\.record_ops_event_occurrence/i);
});
