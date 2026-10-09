import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNewsImpactRecoveryRuntime } from '../src/news-impact-recovery-runtime.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const recovery=fs.readFileSync('src/news-impact-recovery-runtime.js','utf8');
const telegramUpdate=fs.readFileSync('src/telegram-update-orchestration.js','utf8');
const analysis=fs.readFileSync('src/analysis-runtime.js','utf8');
const analysisController=fs.readFileSync('public/modules/analysis-controller.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const growth=fs.readFileSync('src/growth-analytics-runtime.js','utf8');
const admin=fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC73 creates tracked callbacks and a tracked full-AI handoff',()=>{
  assert.match(recovery,/function newsImpactActionCallback\(/);
  assert.match(recovery,/function newsImpactTrackedAnalysisUrl\(/);
  assert.match(recovery,/news:impact:\$\{d\}:\$\{a\}:\$\{id\}/);
  assert.match(recovery,/newsImpactDecision:d,\s*newsImpactAction:'full_ai'/);
  for (const action of ['squads','market','recheck','news','share']) {
    assert.ok(recovery.includes(`tracked('${action}'`), action);
  }
});

test('Telegram action tracking stores categorical decision/action and optional recovery only',()=>{
  const event=/backgroundGrowthEvent\(cfg,\{userId:callbackUserId,eventName:'news_impact_action',channel:'telegram',fixtureId,metadata:\{([\s\S]*?)\}\}\);/.exec(telegramUpdate);
  assert.ok(event,'Telegram News Impact action event missing');
  assert.match(event[1],/decision,action/);
  assert.match(event[1],/recovery/);
  assert.doesNotMatch(event[1],/title|headline|url|query|content|error\.message|stack/);
});

test('Mini App carries decision attribution into full AI without article text',()=>{
  assert.match(analysisController,/newsImpactDecision:safeText\(/);
  assert.match(analysisController,/newsImpactAction:safeText\(/);
  assert.match(app,/params\.get\('newsImpactDecision'\)/);
  assert.match(app,/params\.get\('newsImpactAction'\)/);
  assert.match(analysis,/newsImpactAction==='full_ai'/);

  const fullAiEvent=/eventName:'news_impact_action',[\s\S]{0,160}?channel:'miniapp',[\s\S]{0,220}?metadata:\{([^}]*)\}/.exec(analysis);
  assert.ok(fullAiEvent,'Mini App News Impact action event missing');
  assert.match(fullAiEvent[1],/decision:newsImpactDecision/);
  assert.match(fullAiEvent[1],/action:'full_ai'/);
  assert.doesNotMatch(fullAiEvent[1],/title|headline|url|query|content|error\.message|stack/);
});

test('launch analytics exposes News Impact follow-up actions',()=>{
  assert.match(growth,/const newsImpactActionSummary=/);
  for (const key of ['fullAi','squads','market','recheck','news','share']) {
    assert.match(growth,new RegExp(key+"\\s*:\\s*newsImpactActionRows"));
  }
  assert.match(growth,/newsImpactActionSummary,/);
  assert.match(admin,/const impactActions=d\.newsImpactActionSummary \|\| \{\}/);
  assert.match(admin,/действия: полный AI/);
});

test('RC73 deterministic action contract remains wired through the recovery runtime',()=>{
  assert.match(recovery,/function newsImpactActionDrill\(/);
  assert.match(recovery,/callback==='news:impact:material:market:12345'/);
  assert.match(recovery,/newsImpactActionCallback\('material','market',true\)===''/);
  assert.match(recovery,/cases:7/);
  assert.match(worker,/function newsImpactActionDrill\(\.\.\.args\).*getNewsImpactRecoveryRuntime\(\)\.newsImpactActionDrill/s);
  assert.match(worker,/createNewsImpactRecoveryRuntime/);
});

test('RC73 tracked callbacks and Mini App links reject coercive identities and malformed attribution',()=>{
  const calls=[];
  const runtime=createNewsImpactRecoveryRuntime({
    NEWS_IMPACT_ACTION_CODES:new Set(['full_ai','market','share']),
    NEWS_IMPACT_ACTION_LABELS:{full_ai:'Полный AI',market:'Рынок',share:'Поделиться'},
    NEWS_IMPACT_DECISION_CODES:new Set(['material','stable']),
    NEWS_IMPACT_RECOVERY_CODES:new Set(['retry','open_full_ai']),
    telegramAnalysisHandoffParams:(fixtureId,tab)=>{
      calls.push(['params',fixtureId,tab]);
      return {fixtureId,action:'analysis',tab,handoff:'1'};
    },
    telegramWebAppUrl:(_request,params)=>{
      calls.push(['url',params]);
      return 'https://example.test/?fixtureId='+encodeURIComponent(String(params.fixtureId));
    },
  });

  assert.equal(runtime.newsImpactActionCallback('material','market',true),'');
  assert.equal(runtime.newsImpactActionCallback('material','market',[123]),'');
  assert.equal(runtime.newsImpactActionCallback('material','market','123'),'news:impact:material:market:123');

  assert.equal(runtime.newsImpactRecoveryCallback('material','market',{toString(){throw new Error('must not coerce');}},123),'');
  assert.equal(runtime.newsImpactRecoveryCallback('material','market','retry',true),'');

  assert.equal(runtime.newsImpactTrackedAnalysisUrl({},true,'material'),'');
  assert.equal(runtime.newsImpactTrackedAnalysisUrl({},123,{toString(){throw new Error('must not coerce');}}),'');
  assert.equal(calls.length,0);

  assert.match(runtime.newsImpactTrackedAnalysisUrl({},'123','material'),/^https:\/\/example\.test\//);
  assert.deepEqual(calls[0],['params',123,'brief']);
  assert.equal(calls[1][1].newsImpactDecision,'material');
  assert.equal(calls[1][1].newsImpactAction,'full_ai');
});
