import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('src/worker.js', 'utf8');
const scheduled = fs.readFileSync('src/scheduled-jobs.js', 'utf8');

test('production monitor distinguishes confirmed drift from transient schema probe outages', () => {
  assert.match(worker, /function schemaProbeStatusKind\(/);
  assert.match(worker, /function classifySupabaseSchemaProbeFailures\(/);
  assert.match(worker, /schemaStatus === 'unavailable'/);
  assert.match(worker, /schemaFailureMode:/);
  assert.match(worker, /Schema probe недоступен/);
  assert.match(worker, /Release остаётся fail-closed, но потеря схемы не утверждается/);
});

test('production monitor waits for reminder reads before deep Supabase schema probes', () => {
  assert.match(scheduled, /const remindersTask = runTask\('reminders', \(\) => processDueReminders\(cfg\)\);/);
  assert.match(scheduled, /const monitorAfterReminders = remindersTask[\s\S]*?\.then\(\(\) => runTask\('production_monitor', \(\) => runProductionMonitor\(cfg, scheduledAt\)\)\);/);
  assert.match(scheduled, /tasks\.push\(\['production_monitor', monitorAfterReminders\]\);/);
});
