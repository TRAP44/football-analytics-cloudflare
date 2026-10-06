import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const WORKFLOW_DIR = '.github/workflows';
const PROVENANCE_WORKFLOWS = Object.freeze({
  '.github/workflows/deploy-production.yml': {
    ref: 'ref: ${{ env.DEPLOY_SHA }}',
    fetch: 'git fetch --no-tags origin main',
  },
  '.github/workflows/rollback-production.yml': {
    ref: 'ref: ${{ env.ROLLBACK_WORKFLOW_SHA }}',
    fetch: 'git fetch --no-tags origin main',
  },
});

function workflowPaths() {
  return fs.readdirSync(WORKFLOW_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map(entry => path.posix.join(WORKFLOW_DIR, entry.name))
    .sort();
}

function checkoutBlocks(source = '') {
  const lines = String(source).split(/\r?\n/);
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*-?\s*uses:\s*actions\/checkout@/i.test(lines[index])) continue;

    const indent = (lines[index].match(/^(\s*)/) || ['', ''])[1].length;
    let end = index + 1;
    while (end < lines.length) {
      const line = lines[end];
      if (!line.trim()) {
        end += 1;
        continue;
      }

      const nextIndent = (line.match(/^(\s*)/) || ['', ''])[1].length;
      if (line.trimStart().startsWith('- ') && nextIndent <= indent) break;
      end += 1;
    }

    blocks.push({
      line: index + 1,
      source: lines.slice(index, end).join('\n'),
      action: lines[index].trim().replace(/^-\s*/, ''),
    });
  }

  return blocks;
}

test('checkout block parser keeps adjacent workflow steps isolated', () => {
  const blocks = checkoutBlocks(`steps:
  - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    with:
      persist-credentials: false
  - uses: actions/setup-node@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
    with:
      node-version: 22
  - name: second checkout
    uses: actions/checkout@cccccccccccccccccccccccccccccccccccccccc
    with:
      persist-credentials: false
`);

  assert.equal(blocks.length, 2);
  assert.match(blocks[0].source, /persist-credentials:\s*false/);
  assert.doesNotMatch(blocks[0].source, /setup-node/);
  assert.match(blocks[1].source, /cccccccccccccccccccccccccccccccccccccccc/);
});

test('every current workflow checkout disables persisted GitHub credentials', () => {
  const workflows = workflowPaths();
  assert.ok(workflows.length > 0);

  const checkouts = [];
  for (const workflow of workflows) {
    const source = fs.readFileSync(workflow, 'utf8');
    for (const block of checkoutBlocks(source)) {
      checkouts.push({ workflow, ...block });
      assert.match(
        block.source,
        /persist-credentials:\s*false\b/,
        `${workflow}:${block.line} checkout must disable persisted credentials`,
      );
      assert.doesNotMatch(
        block.source,
        /persist-credentials:\s*true\b/,
        `${workflow}:${block.line} must never persist checkout credentials`,
      );
    }
  }

  assert.ok(checkouts.length > 0, 'at least one checkout action must be audited');
});

test('every checkout action is pinned to an immutable full commit SHA', () => {
  for (const workflow of workflowPaths()) {
    const source = fs.readFileSync(workflow, 'utf8');
    for (const block of checkoutBlocks(source)) {
      assert.match(
        block.action,
        /^uses:\s*actions\/checkout@[0-9a-f]{40}(?:\s+#.*)?$/i,
        `${workflow}:${block.line} checkout must be pinned to a full commit SHA`,
      );
    }
  }
});

test('deploy and rollback provenance fetch without persisting checkout credentials', () => {
  for (const [workflow, contract] of Object.entries(PROVENANCE_WORKFLOWS)) {
    const source = fs.readFileSync(workflow, 'utf8');
    const blocks = checkoutBlocks(source);

    assert.equal(blocks.length, 1, `${workflow} must have exactly one checkout`);
    assert.match(blocks[0].source, /persist-credentials:\s*false\b/);
    assert.match(blocks[0].source, /fetch-depth:\s*0\b/);
    assert.ok(blocks[0].source.includes(contract.ref), `${workflow} checkout must bind the verified revision`);
    assert.ok(source.includes(contract.fetch), `${workflow} must compare against current main`);
    assert.match(source, /^permissions:\s*\n\s+contents:\s*read\s*$/m);
  }
});

test('credential hardening discovers the workflow directory instead of relying on deleted workflow names', () => {
  const workflows = workflowPaths();

  assert.ok(workflows.includes('.github/workflows/external-production-monitor.yml'));
  assert.equal(
    workflows.includes('.github/workflows/external-production-monitor-diagnostics.yml'),
    false,
  );

  const monitor = fs.readFileSync('.github/workflows/external-production-monitor.yml', 'utf8');
  const monitorCheckouts = checkoutBlocks(monitor);
  assert.ok(monitorCheckouts.length >= 2, 'primary monitor and diagnostics checkouts must both be covered');
  assert.ok(monitorCheckouts.every(block => /persist-credentials:\s*false\b/.test(block.source)));
});
