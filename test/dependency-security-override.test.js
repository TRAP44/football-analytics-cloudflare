import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

test('security override keeps undici outside the audited vulnerable range', () => {
  assert.equal(pkg.overrides?.undici, '7.30.0');
  assert.equal(lock.packages?.['node_modules/undici']?.version, '7.30.0');
  assert.match(lock.packages?.['node_modules/undici']?.resolved || '', /undici-7\.30\.0\.tgz$/);
});
