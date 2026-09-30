import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FRONTEND_ASSET_REVISION } from '../public/modules/app-runtime.js';

const publicHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('public surface contains no admin-only DOM', () => {
  assert.doesNotMatch(publicHtml, /data-admin-only/);
  for (const marker of [
    'runtimeControlsPanel',
    'providerStatusPanel',
    'diagnosticsPanel',
    'reminderHealthPanel',
    'releaseMonitorRefreshBtn',
    'launchFunnelRefreshBtn',
    'productionReadinessRefreshBtn',
    'modelQualityRefreshBtn',
  ]) {
    assert.doesNotMatch(publicHtml, new RegExp(`id="${marker}"`));
  }
});

test('dedicated admin surface retains operational controls', () => {
  assert.match(adminHtml, /matchradar-surface" content="admin"/);
  assert.match(adminHtml, /data-admin-only/);
  for (const marker of [
    'runtimeControlsPanel',
    'providerStatusPanel',
    'diagnosticsPanel',
    'reminderHealthRefreshBtn',
    'releaseMonitorRefreshBtn',
    'launchFunnelRefreshBtn',
    'productionReadinessRefreshBtn',
    'modelQualityRefreshBtn',
  ]) {
    assert.match(adminHtml, new RegExp(`id="${marker}"`));
  }
});

test('public startup has no required listener dependency on removed admin DOM', () => {
  const directListenerIds = [...app.matchAll(/\$\('([^']+)'\)\.addEventListener/g)].map(match => match[1]);
  for (const id of directListenerIds) {
    assert.match(publicHtml, new RegExp(`id="${id}"`), `public surface missing required listener target: ${id}`);
  }
});

test('public and admin entrypoints stay on one centralized frontend revision', () => {
  assert.match(FRONTEND_ASSET_REVISION, /^6\.120\.0-launch\d+$/);
  assert.ok(publicHtml.includes(`frontend-asset-revision" content="${FRONTEND_ASSET_REVISION}"`));
  assert.ok(adminHtml.includes(`frontend-asset-revision" content="${FRONTEND_ASSET_REVISION}"`));
  assert.ok(publicHtml.includes(`/app-public.js?v=${FRONTEND_ASSET_REVISION}`));
  assert.ok(adminHtml.includes(`/app-admin.js?v=${FRONTEND_ASSET_REVISION}`));
});
