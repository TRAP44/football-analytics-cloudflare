import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createTelegramCampaignRuntime } from '../src/telegram-campaign-runtime.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const publisher=fs.readFileSync('src/publisher-runtime.js','utf8');
const admin=fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');
const html=fs.readFileSync('public/admin.html','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

const campaignRuntime=createTelegramCampaignRuntime({
  cleanLaunchPart(value,max=48) {
    return String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g,'_')
      .replace(/^_+|_+$/g,'')
      .slice(0,max);
  },
});

function sourceSection(source,start,end) {
  const from=source.indexOf(start);
  assert.notEqual(from,-1,`missing section start: ${start}`);
  const to=source.indexOf(end,from+start.length);
  assert.notEqual(to,-1,`missing section end: ${end}`);
  assert.ok(to>from,`invalid section order: ${start} -> ${end}`);
  return source.slice(from,to);
}

test('RC68 aggregates media attribution down to content level',()=>{
  const rows=[
    {telegram_id:1,event_name:'bot_start',source:'press',campaign:'ucl_launch',content:'article1'},
    {telegram_id:1,event_name:'fixture_deep_link_open',source:'press',campaign:'ucl_launch',content:'article1'},
    {telegram_id:1,event_name:'quick_ai',source:'press',campaign:'ucl_launch',content:'article1'},
    {telegram_id:1,event_name:'full_ai',source:'press',campaign:'ucl_launch',content:'article1'},
    {telegram_id:9,event_name:'media_link_created',source:'press',campaign:'ucl_launch',content:'article1'},
    {telegram_id:2,event_name:'bot_start',source:'press',campaign:'ucl_launch',content:'article2'},
  ];

  const result=campaignRuntime.buildMediaCampaignPerformance(rows);
  const article1=result.find(row=>row.content==='article1');
  const article2=result.find(row=>row.content==='article2');

  assert.equal(result.length,2);
  assert.deepEqual(
    {
      entries:article1?.entries,
      deepLinkOpens:article1?.deepLinkOpens,
      quickAi:article1?.quickAi,
      fullAi:article1?.fullAi,
      linksCreated:article1?.linksCreated,
      fullAiConversionPct:article1?.fullAiConversionPct,
    },
    {
      entries:1,
      deepLinkOpens:1,
      quickAi:1,
      fullAi:1,
      linksCreated:1,
      fullAiConversionPct:100,
    },
  );
  assert.equal(article2?.entries,1);
  assert.match(
    worker,
    /function buildMediaCampaignPerformance\(\.\.\.args\)[\s\S]*?getTelegramCampaignRuntime\(\)\.buildMediaCampaignPerformance\(\.\.\.args\)/,
  );
});

test('publisher creation event is attributed to the generated campaign',()=>{
  const fn=sourceSection(
    publisher,
    'async function apiMediaPublisherLink',
    'function mediaPublisherDrill',
  );
  assert.match(fn,/eventName:'media_link_created'/);
  assert.match(fn,/attribution:\{source,campaign,content,startParam:link\.startParam\}/);
  assert.match(
    worker,
    /function apiMediaPublisherLink\(\.\.\.args\)[\s\S]*?getPublisherRuntime\(\)\.apiMediaPublisherLink\(\.\.\.args\)/,
  );
});

test('admin launch panel renders material-level campaign performance',()=>{
  assert.match(html,/id="launchFunnelMediaCampaigns"/);
  assert.match(admin,/const mediaRows=d\.mediaCampaigns \|\| \[\]/);
  assert.match(admin,/Материалы СМИ/);
  assert.match(admin,/fullAiConversionPct/);
  assert.match(css,/\.media-campaign-row/);
});

test('RC68 exposes deterministic health gate',()=>{
  const drill=campaignRuntime.mediaCampaignControlDrill();
  assert.equal(drill.pass,true);
  assert.equal(drill.cases,8);
  assert.match(
    worker,
    /function mediaCampaignControlDrill\(\.\.\.args\)[\s\S]*?getTelegramCampaignRuntime\(\)\.mediaCampaignControlDrill\(\.\.\.args\)/,
  );
});
