import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const codeql = fs.readFileSync('.github/workflows/codeql.yml','utf8');
const dependabot = fs.readFileSync('.github/dependabot.yml','utf8');

test('CodeQL scans JavaScript on PR, main and schedule with pinned actions', () => {
  assert.match(codeql,/pull_request:\s*\n\s*branches:\s*\[main\]/);
  assert.match(codeql,/push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(codeql,/schedule:/);
  assert.match(codeql,/languages:\s*javascript-typescript/);
  assert.match(codeql,/queries:\s*security-extended/);
  assert.match(codeql,/github\/codeql-action\/init@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2/);
  assert.match(codeql,/github\/codeql-action\/analyze@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2/);
  assert.match(codeql,/upload:\s*never/);
  assert.match(codeql,/node scripts\/check-codeql-sarif\.js codeql-results/);
  assert.match(codeql,/actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
  assert.match(codeql,/actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.doesNotMatch(codeql,/uses:\s*[^\n]+@v\d+/);
  assert.doesNotMatch(codeql,/security-events:\s*write/);
});

test('Dependabot covers npm and GitHub Actions without automatic merge policy', () => {
  assert.match(dependabot,/package-ecosystem:\s*"npm"/);
  assert.match(dependabot,/package-ecosystem:\s*"github-actions"/);
  assert.match(dependabot,/interval:\s*"weekly"/);
  assert.match(dependabot,/timezone:\s*"Europe\/Riga"/);
  assert.match(dependabot,/open-pull-requests-limit:\s*5/);
  assert.doesNotMatch(dependabot,/auto-?merge/i);
});

test('Dependabot groups routine minor and patch maintenance but leaves major updates explicit', () => {
  const updateTypes=[...dependabot.matchAll(/-\s*"(minor|patch|major)"/g)].map(match=>match[1]);
  assert.ok(updateTypes.includes('minor'));
  assert.ok(updateTypes.includes('patch'));
  assert.ok(!updateTypes.includes('major'));
});
