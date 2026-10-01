import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const css = fs.readFileSync('public/styles/premium-ui.css', 'utf8');
const headers = fs.readFileSync('public/_headers', 'utf8');

test('Issue #323 removes repeated screenshot hotfix layers in favor of one component contract', () => {
  assert.doesNotMatch(css, /Screenshot UX fixes — Issue #31[79]/);
  assert.doesNotMatch(css, /Consolidated production UI regression pass — Issue #321/);
  const contract = css.slice(css.indexOf('/* Public component contracts — Issue #323'));
  assert.ok(contract.length > 1000);
  assert.match(contract, /--mr-touch-target:\s*44px/);
  assert.doesNotMatch(contract, /!important/);
});

test('public HTML contains no admin DOM or raw infrastructure terminology', () => {
  assert.doesNotMatch(html, /data-admin-only/);
  for (const phrase of ['provider quota', 'retry-after', 'cache key', 'API contract', 'route limit', 'cooldown', 'Supabase']) {
    assert.equal(html.toLowerCase().includes(phrase.toLowerCase()), false, phrase);
  }
});

test('near-tied maximum probabilities are described neutrally', () => {
  const start = app.indexOf('function likelyOutcomeDisplay');
  const end = app.indexOf('\nfunction formCard', start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /rows\[0\] - rows\[1\] < 1/);
  assert.match(block, /Нет явного фаворита/);
});

test('frontend cache policy revalidates every mutable public code layer', () => {
  for (const asset of ['/app.js', '/app-public.js', '/styles.css', '/styles/public-shell.css', '/styles/premium-ui.css', '/modules/*']) {
    assert.ok(headers.includes(asset), asset);
  }
  const modules = headers.slice(headers.indexOf('/modules/*'));
  assert.match(modules, /Cache-Control: public, max-age=0, must-revalidate/);
});
