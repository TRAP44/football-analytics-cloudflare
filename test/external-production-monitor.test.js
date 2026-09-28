import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEndpoint } from '../scripts/external-production-monitor.js';

const workflow = fs.readFileSync('.github/workflows/external-production-monitor.yml', 'utf8');
const monitorScript = fs.readFileSync('scripts/external-production-monitor.js', 'utf8');
const runbook = fs.readFileSync('docs/EXTERNAL_MONITORING_RUNBOOK_RU.md', 'utf8');

test('external monitor accepts healthy production contracts', () => {
  assert.equal(evaluateEndpoint('live', {
    statusCode: 200,
    body: { ok: true, status: 'alive', version: '6.120.0' },
  }).passed, true);

  assert.equal(evaluateEndpoint('ready', {
    statusCode: 200,
    body: { ok: true, status: 'ready', version: '6.120.0' },
  }).passed, true);

  const publicStatus = evaluateEndpoint('public_status', {
    statusCode: 200,
    body: { ok: true, status: 'operational' },
  });
  assert.equal(publicStatus.passed, true);
  assert.equal(publicStatus.warning, false);
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

test('external monitoring workflow is independent, retried and incident-aware', () => {
  assert.match(workflow, /cron: "7,22,37,52 \* \* \* \*"/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /EXTERNAL_MONITOR_RETRIES: "3"/);
  assert.match(monitorScript, /\/health\/live/);
  assert.match(monitorScript, /\/health\/ready/);
  assert.match(monitorScript, /\/api\/public-status/);
  assert.match(workflow, /external-production-monitor\.js/);
  assert.match(workflow, /gh issue create/);
  assert.match(workflow, /gh issue close/);
  assert.match(workflow, /retention-days: 7/);
  assert.doesNotMatch(workflow, /API_FOOTBALL_KEY|THE_ODDS_API_KEY|TAVILY_KEY|SUPABASE_SECRET_KEY/);
  assert.match(runbook, /failure domain/i);
  assert.match(runbook, /не выполняет rollback автоматически/i);
});
