import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const quality = fs.readFileSync('.github/workflows/quality.yml', 'utf8');

test('Node runtime contract matches CI and lockfile', () => {
  assert.equal(pkg.engines?.node, '>=22 <23');
  assert.equal(lock.packages?.['']?.engines?.node, '>=22 <23');
  assert.match(quality, /node-version:\s*22/);
});
