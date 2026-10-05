import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEndpoint } from '../scripts/external-production-monitor.js';
import {
  classifyPrimaryRunJobs,
  decideDiagnosticActions,
  parseTrackingIssueNumber,
  selectInfrastructureIncidentTarget,
} from '../scripts/external-monitor-control-plane.js';

const workflow = fs.readFileSync('.github/workflows/external-production-monitor.yml', 'utf8');
const diagnosticsWorkflow = fs.readFileSync('.github/workflows/external-production-monitor-diagnostics.yml', 'utf8');
const monitorScript = fs.readFileSync('scripts/external-production-monitor.js', 'utf8');
const controlPlaneScript = fs.readFileSync('scripts/external-monitor-control-plane.js', 'utf8');
const runbook = fs.readFileSync('docs/EXTERNAL_MONITORING_RUNBOOK_RU.md', 'utf8');

test('external monitor accepts healthy production contracts', () => {
  assert.equal(evaluateEndpoint('health',{statusCode:200,body:{ok:true}}).passed,true);
  assert.equal(evaluateEndpoint('health',{statusCode:200,body:{ok:true,version:'leak'}}).passed,false);

  assert.equal(evaluateEndpoint('live', {
    statusCode: 200,
    body: { ok: true, status: 'alive', version: '6.120.0' },
  }).passed, true);

  const ready = evaluateEndpoint('ready', {
    statusCode: 200,
    elapsedMs: 420,
    body: { ok: true, status: 'ready', version: '6.120.0', latencyMs: 390 },
  });
  assert.equal(ready.passed, true);
  assert.equal(ready.warning, false);

  const publicStatus = evaluateEndpoint('public_status', {
    statusCode: 200,
    body: { ok: true, status: 'operational' },
  });
  assert.equal(publicStatus.passed, true);
  assert.equal(publicStatus.warning, false);
});

test('external monitor warns on slow readiness without treating it as an outage', () => {
  const slowReady = evaluateEndpoint('ready', {
    statusCode: 200,
    elapsedMs: 3200,
    body: { ok: true, status: 'ready', version: '6.120.0', latencyMs: 3100 },
  }, { readyWarningMs: 3000 });
  assert.equal(slowReady.passed, true);
  assert.equal(slowReady.warning, true);
  assert.match(slowReady.reason, /exceeds warning budget 3000 ms/);
  assert.equal(slowReady.observed.latencyMs, 3100);
});

test('external monitor fails closed on readiness 503 but treats maintenance as a public-status warning', () => {
  const ready = evaluateEndpoint('ready', {
    statusCode: 503,
    body: { ok: false, status: 'not_ready' },
  });
  assert.equal(ready.passed, false);

  const maintenance = evaluateEndpoint('public_status', {
    statusCode: 200,
    body: { ok: false, status: 'maintenance' },
  });
  assert.equal(maintenance.passed, true);
  assert.equal(maintenance.warning, true);
});

test('external monitoring workflow is independent, retried and incident-aware without gh CLI', () => {
  assert.match(workflow, /cron: "17 \* \* \* \*"/);
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \["Deploy Production"\]/);
  assert.match(workflow, /types: \[completed\]/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /EXTERNAL_MONITOR_RETRIES: "3"/);
  assert.match(workflow, /EXTERNAL_MONITOR_READY_WARNING_MS: "3000"/);
  assert.match(monitorScript, /path: '\/health'/);
  assert.match(monitorScript, /\/health\/live/);
  assert.match(monitorScript, /\/health\/ready/);
  assert.match(monitorScript, /\/api\/public-status/);
  assert.match(workflow, /external-production-monitor\.js/);
  assert.match(workflow, /external-monitor-control-plane\.js primary/);
  assert.doesNotMatch(workflow, /\bgh issue\b/);
  assert.match(controlPlaneScript, /\/issues\?state=open&per_page=100/);
  assert.match(workflow, /retention-days: 7/);
  assert.doesNotMatch(workflow, /API_FOOTBALL_KEY|THE_ODDS_API_KEY|TAVILY_KEY|SUPABASE_SECRET_KEY/);
  assert.match(runbook, /failure domain/i);
  assert.match(runbook, /не выполняет rollback автоматически/i);
});

test('failed primary monitor has a self-hosted diagnostic fallback with read-only Actions access', () => {
  assert.match(diagnosticsWorkflow, /workflows: \["External Production Monitor"\]/);
  assert.match(diagnosticsWorkflow, /conclusion == 'failure'/);
  assert.match(diagnosticsWorkflow, /runs-on: \[self-hosted, Linux, X64\]/);
  assert.match(diagnosticsWorkflow, /actions: read/);
  assert.match(diagnosticsWorkflow, /issues: write/);
  assert.match(diagnosticsWorkflow, /MONITOR_INFRA_TRACKING_ISSUE: "463"/);
  assert.match(diagnosticsWorkflow, /external-monitor-control-plane\.js diagnose/);
  assert.doesNotMatch(diagnosticsWorkflow, /API_FOOTBALL_KEY|THE_ODDS_API_KEY|TAVILY_KEY|SUPABASE_SECRET_KEY/);
});

test('diagnostics classify zero-step and post-probe failures as monitor infrastructure failures', () => {
  const zeroStep = classifyPrimaryRunJobs([{ name: 'monitor', conclusion: 'failure', steps: [] }]);
  assert.deepEqual(zeroStep, {
    category: 'monitor_infrastructure',
    reason: 'zero_step_failure',
    requiresFallback: true,
  });

  const postProbe = classifyPrimaryRunJobs([{
    name: 'monitor',
    conclusion: 'failure',
    steps: [
      { name: 'Check production from external runner', conclusion: 'success' },
      { name: 'Reconcile availability incidents', conclusion: 'failure' },
    ],
  }]);
  assert.deepEqual(postProbe, {
    category: 'monitor_infrastructure',
    reason: 'production_probe_passed_before_workflow_failure',
    requiresFallback: false,
  });
  assert.deepEqual(decideDiagnosticActions(postProbe), {
    availability: 'close',
    infrastructure: 'open',
  });
});

test('diagnostics use fallback health to separate app outage from monitor failure', () => {
  const probeFailure = classifyPrimaryRunJobs([{
    name: 'monitor',
    conclusion: 'failure',
    steps: [
      { name: 'Check production from external runner', conclusion: 'failure' },
    ],
  }]);
  assert.deepEqual(decideDiagnosticActions(probeFailure, true), {
    availability: 'close',
    infrastructure: 'open',
  });
  assert.deepEqual(decideDiagnosticActions(probeFailure, false), {
    availability: 'open',
    infrastructure: 'close',
  });

  const zeroStep = classifyPrimaryRunJobs([{ name: 'monitor', conclusion: 'failure', steps: [] }]);
  assert.deepEqual(decideDiagnosticActions(zeroStep, false), {
    availability: 'open',
    infrastructure: 'open',
  });
});


test('known monitor-infrastructure failures reuse the umbrella runner incident instead of opening duplicates', () => {
  assert.equal(parseTrackingIssueNumber('463'),463);
  assert.equal(parseTrackingIssueNumber('0'),0);
  assert.equal(parseTrackingIssueNumber('bad'),0);

  const openIssues=[
    { number:463, title:'P1 — Eliminate self-hosted runner as a single point of failure' },
    { number:507, title:'[monitor-infra] External Production Monitor execution failure' },
  ];
  assert.deepEqual(selectInfrastructureIncidentTarget(openIssues,463),{
    kind:'tracking',
    number:463,
  });
  assert.deepEqual(selectInfrastructureIncidentTarget(openIssues,999),{
    kind:'dedicated',
    number:0,
  });
  assert.deepEqual(selectInfrastructureIncidentTarget([{number:463,pull_request:{}}],463),{
    kind:'dedicated',
    number:0,
  });
});
