import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const quality=fs.readFileSync('.github/workflows/quality.yml','utf8');
const hygiene=fs.readFileSync('scripts/source-hygiene.js','utf8');

test('source hygiene lint is part of the release CI gate',()=>{
  assert.equal(pkg.scripts.lint,'node scripts/source-hygiene.js');
  assert.match(quality,/npm run lint/);
  assert.match(hygiene,/debugger/);
  assert.match(hygiene,/merge_conflict/);
  assert.match(hygiene,/unfinished_marker/);
});
