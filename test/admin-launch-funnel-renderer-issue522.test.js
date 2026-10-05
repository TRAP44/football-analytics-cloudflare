import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminLaunchFunnelModule } from '../public/modules/admin-launch-funnel.js';
import { createAdminLaunchFunnelRenderer } from '../public/modules/admin-launch-funnel-renderer.js';
import { renderLaunchFunnelStages } from '../public/modules/admin-launch-funnel-stages.js';
import { renderLaunchFunnelCampaignSections } from '../public/modules/admin-launch-funnel-campaigns.js';

const orchestrator=readFileSync(new URL('../public/modules/admin-launch-funnel.js',import.meta.url),'utf8');

test('launch funnel orchestration stays thin and keeps public contract',()=>{
  assert.equal(typeof createAdminLaunchFunnelModule,'function');
  const module=createAdminLaunchFunnelModule({});
  assert.equal(typeof module.renderLaunchFunnel,'function');
  assert.equal(typeof module.acknowledgeRecoveryIncident,'function');
  assert.equal(typeof module.loadLaunchFunnel,'function');
  assert.ok(orchestrator.length < 10_000, `admin-launch-funnel.js should stay below 10k chars, got ${orchestrator.length}`);
});

test('renderer is extracted behind an explicit factory boundary',()=>{
  assert.equal(typeof createAdminLaunchFunnelRenderer,'function');
  const renderer=createAdminLaunchFunnelRenderer({});
  assert.equal(typeof renderer.renderLaunchFunnel,'function');
  assert.ok(orchestrator.includes("from './admin-launch-funnel-renderer.js'"));
  assert.equal(typeof renderLaunchFunnelStages,'function');
  assert.equal(typeof renderLaunchFunnelCampaignSections,'function');
  assert.ok(!orchestrator.includes('function launchFunnelPct(value)'));
});


test('launch funnel renderer remains a compact coordinator',()=>{
  const rendererSource=readFileSync(new URL('../public/modules/admin-launch-funnel-renderer.js',import.meta.url),'utf8');
  assert.ok(rendererSource.length < 20_000, `admin-launch-funnel-renderer.js should stay below 20k chars, got ${rendererSource.length}`);
  assert.ok(rendererSource.includes("from './admin-launch-funnel-stages.js'"));
  assert.ok(rendererSource.includes("from './admin-launch-funnel-campaigns.js'"));
});
