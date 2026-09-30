import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC73 creates tracked callbacks and a tracked full-AI handoff',()=>{
  assert.match(worker,/function newsImpactActionCallback\(/);
  assert.match(worker,/function newsImpactTrackedAnalysisUrl\(/);
  assert.match(worker,/news:impact:\$\{d\}:\$\{a\}:\$\{id\}/);
  assert.match(worker,/newsImpactDecision:d,newsImpactAction:'full_ai'/);
  for (const action of ['squads','market','recheck','news','share']) assert.ok(worker.includes(`tracked('${action}'`));
});

test('Telegram action tracking stores categorical decision/action and optional recovery only',()=>{
  assert.match(worker,/eventName:'news_impact_action',channel:'telegram'/);
  const event=/eventName:'news_impact_action',channel:'telegram'[\s\S]{0,360}?metadata:\{decision,action,[\s\S]{0,180}?\}\}/.exec(worker);
  assert.ok(event,'Telegram News Impact action event missing');
  assert.match(event[0],/decision,action/);
  assert.doesNotMatch(event[0],/title|headline|url|query|content|error\.message|stack/);
});

test('Mini App carries decision attribution into full AI without article text',()=>{
  assert.match(app,/newsImpactDecision:String\(options\.newsImpactDecision \|\| ''\)/);
  assert.match(app,/newsImpactAction:String\(options\.newsImpactAction \|\| ''\)/);
  assert.match(app,/params\.get\('newsImpactDecision'\)/);
  assert.match(app,/params\.get\('newsImpactAction'\)/);
  assert.match(worker,/newsImpactAction==='full_ai'/);
  const fullAiEvent=/eventName:'news_impact_action',channel:'miniapp'[\s\S]{0,360}?metadata:\{decision:newsImpactDecision,action:'full_ai',[\s\S]{0,180}?\}\}/.exec(worker);
  assert.ok(fullAiEvent,'Mini App News Impact action event missing');
  assert.doesNotMatch(fullAiEvent[0],/title|headline|url|query|content|error\.message|stack/);
});

test('launch analytics exposes News Impact follow-up actions',()=>{
  assert.match(worker,/const newsImpactActionSummary=/);
  for (const key of ['fullAi','squads','market','recheck','news','share']) assert.match(worker,new RegExp(key+':newsImpactActionRows'));
  assert.match(worker,/newsImpactActionSummary,/);
  assert.match(app,/const impactActions=d\.newsImpactActionSummary \|\| \{\}/);
  assert.match(app,/действия: полный AI/);
});

test('RC73 health and smoke contract is deterministic',()=>{
  assert.match(worker,/function newsImpactActionDrill\(/);
  assert.match(worker,/newsImpactActionSelfTest: newsImpactActionDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactActionTracking','newsImpactActionAttribution','newsImpactActionAnalytics']) {
    assert.ok(worker.includes(flag + ": 'enabled'"));
  }
});
