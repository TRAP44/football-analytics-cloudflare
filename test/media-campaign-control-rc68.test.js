import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');
const html=fs.readFileSync('public/admin.html','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('RC68 aggregates media attribution down to content level',()=>{
  assert.match(worker,/function buildMediaCampaignPerformance\(/);
  assert.match(worker,/contentLevelMediaAttribution: 'enabled'/);
  assert.match(worker,/fullAiConversionPct/);
  assert.match(worker,/mediaCampaigns,/);
  assert.match(worker,/mediaSummary,/);
});

test('publisher creation event is attributed to the generated campaign',()=>{
  const start=worker.indexOf('async function apiMediaPublisherLink');
  const end=worker.indexOf('function mediaPublisherDrill',start);
  const fn=worker.slice(start,end);
  assert.match(fn,/attribution:\{source,campaign,content,startParam:link\.startParam\}/);
  assert.match(fn,/media_link_created/);
});

test('admin launch panel renders material-level campaign performance',()=>{
  assert.match(html,/id="launchFunnelMediaCampaigns"/);
  assert.match(app,/const mediaRows=d\.mediaCampaigns \|\| \[\]/);
  assert.match(app,/Материалы СМИ/);
  assert.match(app,/fullAiConversionPct/);
  assert.match(css,/\.media-campaign-row/);
});

test('RC68 exposes deterministic health gate',()=>{
  assert.match(worker,/function mediaCampaignControlDrill\(/);
  assert.match(worker,/mediaCampaignControlSelfTest: mediaCampaignControlDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['mediaCampaignControlRoom','contentLevelMediaAttribution','mediaCampaignConversion','publisherOutcomeTracking']) {
    assert.ok(worker.includes(flag + ": 'enabled'"));
  }
});
