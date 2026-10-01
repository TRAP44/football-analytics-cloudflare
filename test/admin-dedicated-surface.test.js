import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const publicHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('public and admin surfaces declare distinct identities', () => {
  assert.match(publicHtml, /matchradar-surface" content="public"/);
  assert.match(adminHtml, /matchradar-surface" content="admin"/);
  assert.match(adminHtml, /MatchRadar Admin · Состояние и управление/);
  assert.match(adminHtml, /admin-dedicated-surface/);
});

test('dedicated admin surface is role-gated after startup', () => {
  assert.match(app, /querySelector\('meta\[name="matchradar-surface"\]'\)\?\.content === 'admin'/);
  assert.match(app, /if \(isAdmin\(\)\)/);
  assert.match(app, /openProfileView\(\)/);
  assert.match(app, /location\.replace\('\/'\)/);
});

test('both surfaces share the same frontend asset revision during runtime extraction', () => {
  for (const html of [publicHtml, adminHtml]) {
    assert.match(html, /frontend-asset-revision" content="6\.120\.0-launch\d+"/);
    assert.match(html, /\/app\.js\?v=6\.120\.0-launch\d+/);
  }
});
