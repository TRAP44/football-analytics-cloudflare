import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProviderSloIncidentTimeline,
  providerSloIncidentOpsEvent,
} from '../src/provider-slo-incidents.js';

function window(at, state, totals = {}) {
  return {
    created_at: at,
    metadata: {
      windowStartedAt: new Date(Date.parse(at) - 15 * 60_000).toISOString(),
      windowEndedAt: at,
      sloState: state,
      totals: {
        requests: 12,
        successes: state === 'healthy' ? 12 : 10,
        failures: state === 'healthy' ? 0 : 2,
        retries: state === 'healthy' ? 0 : 2,
        successRatePct: state === 'healthy' ? 100 : 83.3,
        timeoutRatePct: state === 'healthy' ? 0 : 8.3,
        rateLimitRatePct: 0,
        retryRatePct: state === 'healthy' ? 0 : 16.7,
        avgAttemptLatencyMs: state === 'healthy' ? 120 : 3100,
        ...totals,
      },
    },
  };
}

test('one degraded SLO window does not open an incident', () => {
  const report = buildProviderSloIncidentTimeline([
    window('2026-09-28T10:00:00Z','healthy'),
    window('2026-09-28T10:15:00Z','healthy'),
    window('2026-09-28T10:30:00Z','watch'),
  ], { nowMs:Date.parse('2026-09-28T10:35:00Z') });

  assert.equal(report.state, 'healthy');
  assert.equal(report.activeIncident, null);
  assert.equal(report.transition, null);
});

test('two consecutive watch windows open one confirmed provider SLO incident', () => {
  const report = buildProviderSloIncidentTimeline([
    window('2026-09-28T10:00:00Z','healthy'),
    window('2026-09-28T10:15:00Z','healthy'),
    window('2026-09-28T10:30:00Z','watch'),
    window('2026-09-28T10:45:00Z','watch'),
  ], { nowMs:Date.parse('2026-09-28T11:00:00Z') });

  assert.equal(report.state, 'watch');
  assert.equal(report.activeIncident?.active, true);
  assert.equal(report.activeIncident?.highestState, 'watch');
  assert.equal(report.transition?.kind, 'opened');
  assert.equal(report.transition?.state, 'watch');

  const event = providerSloIncidentOpsEvent(report.transition);
  assert.equal(event?.code, 'PROVIDER_SLO_WATCH');
  assert.equal(event?.severity, 'warning');
  assert.equal(event?.meta?.automaticRollback, false);
  assert.equal(event?.meta?.automaticFeatureDisable, false);
});

test('mixed watch and incident windows do not escalate until incident repeats', () => {
  const rows = [
    window('2026-09-28T10:00:00Z','healthy'),
    window('2026-09-28T10:15:00Z','healthy'),
    window('2026-09-28T10:30:00Z','watch'),
    window('2026-09-28T10:45:00Z','watch'),
    window('2026-09-28T11:00:00Z','incident'),
  ];
  const mixed = buildProviderSloIncidentTimeline(rows, { nowMs:Date.parse('2026-09-28T11:05:00Z') });
  assert.equal(mixed.state, 'watch');
  assert.equal(mixed.transition, null);

  const escalated = buildProviderSloIncidentTimeline([
    ...rows,
    window('2026-09-28T11:15:00Z','incident'),
  ], { nowMs:Date.parse('2026-09-28T11:20:00Z') });
  assert.equal(escalated.state, 'incident');
  assert.equal(escalated.activeIncident?.highestState, 'incident');
  assert.equal(escalated.transition?.kind, 'escalated');
  assert.equal(providerSloIncidentOpsEvent(escalated.transition)?.code, 'PROVIDER_SLO_INCIDENT');
});

test('incident recovers only after two consecutive healthy windows', () => {
  const degraded = [
    window('2026-09-28T10:00:00Z','watch'),
    window('2026-09-28T10:15:00Z','watch'),
    window('2026-09-28T10:30:00Z','incident'),
    window('2026-09-28T10:45:00Z','incident'),
  ];
  const oneHealthy = buildProviderSloIncidentTimeline([
    ...degraded,
    window('2026-09-28T11:00:00Z','healthy'),
  ], { nowMs:Date.parse('2026-09-28T11:05:00Z') });
  assert.equal(oneHealthy.state, 'incident');
  assert.equal(oneHealthy.activeIncident?.active, true);
  assert.equal(oneHealthy.transition, null);

  const recovered = buildProviderSloIncidentTimeline([
    ...degraded,
    window('2026-09-28T11:00:00Z','healthy'),
    window('2026-09-28T11:15:00Z','healthy'),
  ], { nowMs:Date.parse('2026-09-28T11:20:00Z') });
  assert.equal(recovered.state, 'healthy');
  assert.equal(recovered.activeIncident, null);
  assert.equal(recovered.history[0]?.active, false);
  assert.equal(recovered.transition?.kind, 'recovered');
  assert.equal(providerSloIncidentOpsEvent(recovered.transition)?.code, 'PROVIDER_SLO_RECOVERED');
});

test('collecting windows break confirmation and never generate an alert', () => {
  const report = buildProviderSloIncidentTimeline([
    window('2026-09-28T10:00:00Z','watch'),
    window('2026-09-28T10:15:00Z','collecting',{requests:4}),
    window('2026-09-28T10:30:00Z','watch'),
  ]);
  assert.equal(report.state, 'collecting');
  assert.equal(report.activeIncident, null);
  assert.equal(report.transition, null);
});

test('runbook points to the observed provider failure modes without automatic control changes', () => {
  const report = buildProviderSloIncidentTimeline([
    window('2026-09-28T10:00:00Z','incident',{
      successRatePct:80,
      timeoutRatePct:10,
      rateLimitRatePct:8,
      retryRatePct:30,
      avgAttemptLatencyMs:6000,
    }),
    window('2026-09-28T10:15:00Z','incident',{
      successRatePct:82,
      timeoutRatePct:9,
      rateLimitRatePct:7,
      retryRatePct:28,
      avgAttemptLatencyMs:5800,
    }),
  ]);

  assert.equal(report.state, 'incident');
  assert.ok(report.activeIncident?.runbook?.some(x => /Retry-After/.test(x)));
  assert.ok(report.activeIncident?.runbook?.some(x => /upstream/.test(x)));
  assert.ok(report.activeIncident?.runbook?.some(x => /retry/.test(x)));
  assert.equal(report.policy.automaticRollback, false);
  assert.equal(report.policy.automaticFeatureDisable, false);
});

test('non-actionable transitions do not produce ops incident events', () => {
  assert.equal(providerSloIncidentOpsEvent({state:'healthy',previousState:'healthy'}), null);
  assert.equal(providerSloIncidentOpsEvent({state:'collecting',previousState:'watch'}), null);
});
