import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAnalysisLifecycleRuntime } from '../src/analysis-lifecycle-runtime.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createLifecycle() {
  return createAnalysisLifecycleRuntime({
    hasSupabase:()=>false,
    isFinishedStatus:status=>String(status || '').toUpperCase()==='FT',
    isLiveStatus:status=>['1H','HT','2H','ET','P'].includes(String(status || '').toUpperCase()),
    memory:{history:new Map()},
    supaSelectOne:async()=>null,
  });
}

function snapshot(fixtureId=71, overrides={}) {
  return {
    match:{fixtureId},
    probabilities:{home:45,draw:30,away:25},
    market:{probabilities:{home:44,draw:31,away:25}},
    lineupImpact:{homeConfirmed:false,awayConfirmed:false},
    absences:{home:[],away:[]},
    aiInstructor:{
      betSignal:{code:'skip',label:'Пропустить ставку'},
      confidenceScore:54,
    },
    ...overrides,
  };
}

const lifecycle=createLifecycle();
const analysisRuntime=readRepoFile('src/analysis-runtime.js');
const telegramUpdate=readRepoFile('src/telegram-update-orchestration.js');
const telegramBot=readRepoFile('src/telegram-bot-orchestration-runtime.js');
const botUi=readRepoFile('src/telegram-bot-ui-runtime.js');
const growth=readRepoFile('src/growth-analytics-runtime.js');
const app=readRepoFile('public/app.js')+'\n'+readRepoFile('public/modules/admin-launch-funnel.js');
const worker=readRepoFile('src/worker.js');

test('RC71 only requests News Impact recheck through explicit Telegram AI actions',()=>{
  assert.match(telegramUpdate,/newsImpactDelta:Boolean\(newsPublishedAt\)/);
  assert.match(telegramUpdate,/newsImpactDelta:true,newsPublishedAt:publishedAt/);
  assert.match(telegramUpdate,/source:'news_impact'/);

  assert.match(botUi,/newsImpactRecheck:true/);
  assert.match(botUi,/newsPublishedAt:String\(options\.newsPublishedAt \|\| ''\)\.slice\(0,40\)/);
});

test('saved AI snapshot must predate the news before attribution is eligible',()=>{
  assert.match(analysisRuntime,/const previousGeneratedMs=Date\.parse/);
  assert.match(analysisRuntime,/const newsPublishedMs=Date\.parse/);
  assert.match(analysisRuntime,/previousGeneratedMs < newsPublishedMs/);

  const guarded=lifecycle.newsImpactDeltaStatus(
    snapshot(),
    snapshot(),
    null,
    {
      requested:true,
      eligible:false,
      performed:false,
      publishedAt:'2026-09-23T12:00:00Z',
    },
  );
  assert.equal(guarded.reasonCode,'snapshot_not_before_news');
  assert.equal(guarded.compared,false);
  assert.match(guarded.summary,/приписывать ей изменение прогноза нельзя/);
});

test('news impact reuses lifecycle delta materiality and fixture identity guards',()=>{
  const previous=snapshot();
  const next=snapshot(71,{
    probabilities:{home:53,draw:27,away:20},
    market:{probabilities:{home:50,draw:29,away:21}},
    lineupImpact:{homeConfirmed:true,awayConfirmed:true},
    absences:{home:[{name:'X'}],away:[]},
    aiInstructor:{
      betSignal:{code:'home',label:'П1'},
      confidenceScore:68,
    },
  });
  const delta=lifecycle.analysisRecheckDelta(previous,next);
  const impact=lifecycle.newsImpactDeltaStatus(
    previous,
    next,
    delta,
    {
      requested:true,
      eligible:true,
      performed:true,
      publishedAt:'2026-09-23T12:00:00Z',
    },
  );

  assert.equal(impact.compared,true);
  assert.equal(impact.material,true);
  assert.ok(impact.codes.includes('signal'));

  const mismatch=lifecycle.newsImpactDeltaStatus(
    previous,
    snapshot(72),
    delta,
    {
      requested:true,
      eligible:true,
      performed:true,
      publishedAt:'2026-09-23T12:00:00Z',
    },
  );
  assert.equal(mismatch.compared,false);
  assert.equal(mismatch.reasonCode,'fixture_mismatch');
});

test('News Impact deterministic drill remains green',()=>{
  const result=lifecycle.newsImpactDeltaDrill();
  assert.equal(result.pass,true);
  assert.ok(result.cases>=5);

  assert.match(analysisRuntime,/analysisRecheckDelta\(staleBefore,payload\)/);
  assert.match(analysisRuntime,/safeNewsImpactDeltaStatus\([\s\S]*?staleBefore,[\s\S]*?payload,[\s\S]*?effectiveRecheckDelta/);
  assert.match(analysisRuntime,/return newsImpactDeltaStatus\(previous,next,delta,options\)/);
});

test('Telegram renders a dedicated before-vs-after News Impact Delta block',()=>{
  assert.match(telegramBot,/📰 <b>News Impact Delta<\/b>/);
  assert.match(telegramBot,/Существенность:/);
  assert.match(telegramBot,/→/);
  assert.match(telegramBot,/существенные изменения/);
  assert.match(telegramBot,/значимых изменений нет/);
});

test('RC71 analytics remain aggregate and exclude article text and URL',()=>{
  assert.match(botUi,/eventName:'news_impact_delta'/);
  const event=/eventName:'news_impact_delta'[\s\S]{0,900}?metadata:\{([\s\S]*?)\}\}\);/.exec(botUi);
  assert.ok(event,'news impact growth event missing');
  assert.match(event[1],/compared/);
  assert.match(event[1],/material/);
  assert.match(event[1],/stable/);
  assert.doesNotMatch(event[1],/title|content|url|query|headline/);

  assert.match(growth,/impactCompared:newsImpactCompared\.size/);
  assert.match(growth,/impactMaterial:newsImpactMaterial\.size/);
  assert.match(app,/News Impact:/);
});

test('RC71 lifecycle contract stays explicitly wired from Worker',()=>{
  assert.match(
    worker,
    /newsImpactDeltaStatus = \(\.\.\.args\) => getAnalysisLifecycleRuntime\(\)\.newsImpactDeltaStatus\(\.\.\.args\)/,
  );
  assert.match(
    worker,
    /newsImpactDeltaDrill = \(\.\.\.args\) => getAnalysisLifecycleRuntime\(\)\.newsImpactDeltaDrill\(\.\.\.args\)/,
  );
});
