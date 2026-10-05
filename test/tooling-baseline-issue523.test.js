import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const workflow=readFileSync(new URL('../.github/workflows/quality.yml',import.meta.url),'utf8');
const eslintConfig=readFileSync(new URL('../eslint.config.js',import.meta.url),'utf8');

test('tooling baseline declares Node 22 and real ESLint gate',()=>{
  assert.equal(pkg.engines?.node,'>=22 <23');
  assert.match(pkg.scripts?.lint || '',/eslint@9\.39\.1/);
  assert.equal(pkg.scripts?.['lint:hygiene'],'node scripts/source-hygiene.js');
  assert.match(workflow,/npm run lint\n\s+- run: npm run lint:hygiene/);
  assert.match(eslintConfig,/'no-undef': 'error'/);
  assert.match(eslintConfig,/'no-unused-vars': \['error'/);
});

test('incremental extracted modules opt into ts-check',()=>{
  for(const path of [
    '../public/modules/profile-data-capabilities.js',
    '../public/modules/profile-access-state.js',
    '../public/modules/profile-summary.js',
    '../public/modules/favorite-teams-renderer.js',
    '../public/modules/reminder-list.js',
  ]) {
    const source=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.ok(source.startsWith('// @ts-check'), path);
  }
});
