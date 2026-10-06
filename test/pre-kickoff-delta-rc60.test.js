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

function snapshot(overrides={}) {
  return {
    match:{fixtureId:7,referee:''},
    probabilities:{home:44,draw:29,away:27},
    market:{probabilities:{home:43,draw:30,away:27}},
    lineupImpact:{homeConfirmed:false,awayConfirmed:false},
    absences:{home:[],away:[]},
    aiInstructor:{
      betSignal:{code:'skip',label:'Пропустить ставку'},
      confidenceScore:55,
    },
    ...overrides,
  };
}

const lifecycle=createLifecycle();
const analysisRuntime=readRepoFile('src/analysis-runtime.js');
const telegram=readRepoFile('src/telegram-bot-orchestration-runtime.js');
const app=readRepoFile('public/app.js')+'\n'+readRepoFile('public/modules/admin-launch-funnel.js');
const css=readRepoFile('public/styles.css');
const growth=readRepoFile('src/growth-analytics-runtime.js');
const capabilities=readRepoFile('src/app-capabilities.js');
const worker=readRepoFile('src/worker.js');

test('RC60 builds a deterministic delta between old and refreshed analysis',()=>{
  const previous=snapshot();
  const next=snapshot({
    match:{fixtureId:7,referee:'A. Ref'},
    probabilities:{home:53,draw:26,away:21},
    market:{probabilities:{home:49,draw:28,away:23}},
    lineupImpact:{homeConfirmed:true,awayConfirmed:true},
    absences:{home:[{name:'Player'}],away:[]},
    aiInstructor:{
      betSignal:{code:'home',label:'П1'},
      confidenceScore:69,
    },
  });

  const delta=lifecycle.analysisRecheckDelta(previous,next);
  assert.equal(delta.available,true);
  assert.equal(delta.material,true);
  assert.equal(delta.stable,false);
  for (const code of ['signal','probability','confidence','lineups','absences','market','referee']) {
    assert.ok(delta.codes.includes(code),code);
  }
});

test('RC60 stable and incomplete comparisons are explicit and fail safe',()=>{
  const stable=lifecycle.analysisRecheckDelta(snapshot(),snapshot());
  assert.equal(stable.available,true);
  assert.equal(stable.material,false);
  assert.equal(stable.stable,true);
  assert.equal(stable.incomplete,false);
  assert.match(stable.summary,/Значимых изменений/);

  const incomplete=lifecycle.analysisRecheckDelta(
    snapshot({probabilities:{home:Infinity,draw:0,away:0}}),
    snapshot({probabilities:{home:Infinity,draw:0,away:0}}),
  );
  assert.equal(incomplete.available,true);
  assert.equal(incomplete.stable,false);
  assert.equal(incomplete.incomplete,true);
  assert.match(incomplete.summary,/не удалось надёжно сопоставить/);
});

test('RC60 refuses cross-fixture deltas and detects loss of lineup confirmation',()=>{
  const mismatch=lifecycle.analysisRecheckDelta(
    snapshot(),
    snapshot({match:{fixtureId:8,referee:''}}),
  );
  assert.equal(mismatch.available,false);
  assert.equal(mismatch.reasonCode,'fixture_mismatch');

  const lost=lifecycle.analysisRecheckDelta(
    snapshot({lineupImpact:{homeConfirmed:true,awayConfirmed:true}}),
    snapshot({lineupImpact:{homeConfirmed:true,awayConfirmed:false}}),
  );
  assert.equal(lost.material,true);
  assert.ok(lost.codes.includes('lineups'));
  assert.match(lost.items.find(item=>item.code==='lineups')?.title || '',/ухудшилось/);
});

test('delta drill covers signal probability lineups and market',()=>{
  const result=lifecycle.analysisDeltaDrill();
  assert.equal(result.pass,true);
  assert.ok(result.count>=4);
});

test('recheck response and analytics expose bounded delta metadata',()=>{
  assert.match(
    analysisRuntime,
    /const recheckDelta=needsFreshnessRecheck \? analysisRecheckDelta\(staleBefore,payload\) : null/,
  );
  assert.match(analysisRuntime,/delta:recheckDelta/);

  const event=/eventName:'analysis_recheck'[\s\S]{0,900}?metadata:\{free:freeRecheck,reason:previousFreshness\?\.reasonCode \|\| 'age_window',material:Boolean\(recheckDelta\?\.material\),stable:Boolean\(recheckDelta\?\.stable\),changeCount:Number\(recheckDelta\?\.items\?\.length \|\| 0\),codes:\(recheckDelta\?\.codes \|\| \[\]\)\.slice\(0,6\)\}/;
  assert.match(analysisRuntime,event);
  assert.doesNotMatch(event.source,/query|rawText/);
});

test('Telegram and Mini App explain what changed after recheck',()=>{
  assert.match(telegram,/Что изменилось после перепроверки/);
  assert.match(telegram,/\(delta\.items \|\| \[\]\)\.slice\(0,3\)/);
  assert.match(app,/class="analysis-delta/);
  assert.match(app,/Прогноз стабилен/);
  assert.match(app,/item\.before && item\.after/);
  assert.match(css,/\.analysis-delta\.material/);
});

test('launch funnel separates material and stable rechecks',()=>{
  assert.match(growth,/const recheckMaterial=recheckRows\.filter/);
  assert.match(growth,/const recheckStable=recheckRows\.filter/);
  assert.match(growth,/material:recheckMaterial,stable:recheckStable/);
  assert.match(app,/rechecks\.material/);
  assert.match(app,/rechecks\.stable/);
});

test('RC60 capability and Worker contracts expose lifecycle delta support',()=>{
  assert.match(capabilities,/preKickoffChangeDetection:true/);
  assert.match(capabilities,/analysisDeltaSummary:true/);
  assert.match(
    worker,
    /analysisRecheckDelta = \(\.\.\.args\) => getAnalysisLifecycleRuntime\(\)\.analysisRecheckDelta\(\.\.\.args\)/,
  );
  assert.match(
    worker,
    /analysisDeltaDrill = \(\.\.\.args\) => getAnalysisLifecycleRuntime\(\)\.analysisDeltaDrill\(\.\.\.args\)/,
  );
});
