import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('src/worker.js', 'utf8');

test('failed admin remediation audit persistence is observable', () => {
  assert.match(
    worker,
    /recordRemediationAction\(cfg, user,[\s\S]*code:'ADMIN_REMEDIATION_AUDIT_WRITE_FAILED'[\s\S]*actorRole:'admin'/,
  );
});
