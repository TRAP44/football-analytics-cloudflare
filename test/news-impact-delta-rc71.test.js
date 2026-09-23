import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const doc=fs.readFileSync('NEWS_IMPACT_DELTA_RC71.md','utf8');

test('RC71 only triggers news-impact recheck after an explicit Telegram AI action',()=>{
  assert.match(worker,/newsImpactRecheck:true/);
  assert.match(worker,/newsImpactDelta:Boolean\(newsPublishedAt\)/);
  assert.match(worker,/newsImpactDelta:true,newsPublishedAt:publishedAt/);
  assert.match(worker,/source:'news_impact'/);
});

test('saved AI snapshot must predate the news before it can be attributed to the news window',()=>{
  assert.match(worker,/previousGeneratedMs/);
  assert.match(worker,/newsPublishedMs/);
  assert.match(worker,/previousGeneratedMs < newsPublishedMs/);
  assert.match(worker,/reasonCode:'snapshot_not_before_news'/);
  assert.match(worker,/приписывать ей изменение прогноза нельзя/);
});

test('news impact reuses the existing analysis delta materiality engine',()=>{
  assert.match(worker,/function newsImpactDeltaStatus\(/);
  assert.match(worker,/analysisRecheckDelta\(staleBefore,payload\)/);
  assert.match(worker,/material:Boolean\(delta\.material\)/);
  assert.match(worker,/stable:Boolean\(delta\.stable\)/);
  assert.match(worker,/function newsImpactDeltaDrill\(/);
});

test('Telegram renders a dedicated before-vs-after News Impact Delta block',()=>{
  assert.match(worker,/📰 <b>News Impact Delta<\/b>/);
  assert.match(worker,/Существенность:/);
  assert.match(worker,/→/);
  assert.match(worker,/существенные изменения/);
  assert.match(worker,/значимых изменений нет/);
});

test('RC71 analytics are aggregate and do not store article text or URL',()=>{
  assert.match(worker,/eventName:'news_impact_delta'/);
  const event=/eventName:'news_impact_delta'[\s\S]{0,700}?metadata:\{([\s\S]*?)\}\}\);/.exec(worker);
  assert.ok(event,'news impact growth event missing');
  assert.match(event[1],/compared/);
  assert.match(event[1],/material/);
  assert.match(event[1],/stable/);
  assert.doesNotMatch(event[1],/title|content|url|query|headline/);
  assert.match(worker,/impactCompared:newsImpactCompared\.size/);
  assert.match(worker,/impactMaterial:newsImpactMaterial\.size/);
  assert.match(app,/News Impact:/);
});

test('RC71 health contract and release documentation are present',()=>{
  for (const flag of ['newsImpactDelta','preNewsSnapshotGuard','explicitNewsRecheck','newsImpactMateriality']) {
    assert.ok(worker.includes(flag + ": 'enabled'"));
  }
  assert.match(worker,/newsImpactDeltaSelfTest: newsImpactDeltaDrill\(\)\.pass \? 'enabled' : 'failed'/);
  assert.match(doc,/News Impact Delta/);
  assert.match(doc,/не доказывает причинно-следственную связь/i);
});
