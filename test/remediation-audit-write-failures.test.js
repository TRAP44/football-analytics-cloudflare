import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('src/worker.js', 'utf8');

test('failed remediation audit finalization records an ops write failure', () => {
  assert.match(
    worker,
    /finalizeRemediationAction\(cfg, actionId, failurePatch\)\.catch\(async auditError => \{[\s\S]*code:'REMEDIATION_AUDIT_FINALIZE_WRITE_FAILED'[\s\S]*recordCriticalWriteFailure/,
  );
});

test('failed remediation audit creation records an ops write failure', () => {
  assert.match(
    worker,
    /recordRemediationAction\(cfg, null,[\s\S]*\)\.catch\(async auditError => \{[\s\S]*code:'REMEDIATION_AUDIT_CREATE_WRITE_FAILED'[\s\S]*recordCriticalWriteFailure/,
  );
});
