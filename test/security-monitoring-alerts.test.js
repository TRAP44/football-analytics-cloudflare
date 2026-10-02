import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  assessSecuritySignals,
  formatSecurityIncidentAlert,
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
