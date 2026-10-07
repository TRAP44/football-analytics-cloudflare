import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const schemaRuntime = fs.readFileSync('src/supabase-schema-runtime.js', 'utf8');
const monitorRuntime = fs.readFileSync('src/production-monitor-runtime.js', 'utf8');
const scheduled = fs.readFileSync('src/scheduled-jobs.js', 'utf8');

test('production monitor distinguishes confirmed drift from transient schema probe outages', () => {
  assert.match(schemaRuntime, /function schemaProbeStatusKind\(/);
  assert.match(schemaRuntime, /function classifySupabaseSchemaProbeFailures\(/);
  assert.match(monitorRuntime, /schemaStatus === 'unavailable'/);
  assert.match(monitorRuntime, /schemaFailureMode:/);
  assert.match(monitorRuntime, /schemaUnavailable:/);
  assert.match(monitorRuntime, /Production работает, но нужен контроль/);
});

test('production monitor waits for reminder reads before deep Supabase schema probes', () => {
  assert.match(scheduled, /const remindersTask = run\('reminders', \(\) => processDueReminders\(cfg\)\);/);
  assert.match(scheduled, /const monitorAfterReminders = remindersTask[\s\S]*?\.then\(\(\) => run\('production_monitor', \(\) => runProductionMonitor\(cfg, scheduledAt\)\)\);/);
  assert.match(scheduled, /tasks\.push\(\['production_monitor', monitorAfterReminders\]\);/);
});
