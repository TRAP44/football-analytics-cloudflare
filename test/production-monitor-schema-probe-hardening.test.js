import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('src/worker.js', 'utf8');

test('production monitor distinguishes confirmed drift from transient schema probe outages', () => {
  assert.match(worker, /function schemaProbeStatusKind\(/);
  assert.match(worker, /function classifySupabaseSchemaProbeFailures\(/);
  assert.match(worker, /schemaStatus === 'unavailable'/);
  assert.match(worker, /schemaFailureMode:/);
  assert.match(worker, /Schema probe недоступен/);
  assert.match(worker, /Release остаётся fail-closed, но потеря схемы не утверждается/);
});

test('production monitor waits for reminder reads before deep Supabase schema probes', () => {
  assert.match(worker, /const remindersTask = processDueReminders\(cfg\);/);
  assert.match(worker, /const monitorAfterReminders = remindersTask\.catch\(\(\)=>null\)\.then\(\(\) => runProductionMonitor\(cfg, scheduledAt\)\);/);
  assert.match(worker, /tasks\.push\(\['production_monitor', monitorAfterReminders\]\);/);
});
