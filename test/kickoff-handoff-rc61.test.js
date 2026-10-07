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
    isFinishedStatus:status=>['FT','AET','PEN'].includes(String(status || '').toUpperCase()),
    isLiveStatus:status=>['1H','HT','2H','ET','P'].includes(String(status || '').toUpperCase()),
    memory:{history:new Map()},
    supaSelectOne:async()=>null,
  });
}

const lifecycle=createLifecycle();
const NOW=Date.parse('2026-09-23T18:00:00Z');
const app=readRepoFile('public/app.js');
const css=readRepoFile('public/styles.css');
const telegram=readRepoFile('src/telegram-bot-orchestration-runtime.js');
const worker=readRepoFile('src/worker.js');

test('RC61 classifies prematch imminent live clock-started finished and unknown kickoff phases',()=>{
  const pre=lifecycle.analysisKickoffHandoff(
    {match:{date:'2026-09-23T20:00:00Z',status:'NS'}},
    NOW,
  );
  const imminent=lifecycle.analysisKickoffHandoff(
    {match:{date:'2026-09-23T18:08:00Z',status:'NS'}},
    NOW,
  );
  const live=lifecycle.analysisKickoffHandoff(
    {match:{date:'2026-09-23T17:55:00Z',status:'1H'}},
    NOW,
  );
  const clockStarted=lifecycle.analysisKickoffHandoff(
    {match:{date:'2026-09-23T18:00:00Z',status:'NS'}},
    NOW,
  );
  const justBefore=lifecycle.analysisKickoffHandoff(
    {match:{date:'2026-09-23T18:00:01Z',status:'NS'}},
    NOW,
  );
  const finished=lifecycle.analysisKickoffHandoff(
    {match:{date:'2026-09-23T15:00:00Z',status:'FT'}},
    NOW,
  );
  const unknown=lifecycle.analysisKickoffHandoff(
    {match:{date:'invalid',status:'NS'}},
    NOW,
  );

  assert.deepEqual([pre.state,imminent.state,live.state,clockStarted.state,justBefore.state,finished.state,unknown.state],[
    'prematch','imminent','live','live','imminent','finished','unknown',
  ]);
  assert.equal(pre.locked,false);
  assert.equal(imminent.locked,false);
  assert.equal(live.locked,true);
  assert.equal(clockStarted.locked,true);
  assert.equal(justBefore.locked,false);
  assert.equal(finished.locked,true);
  assert.equal(unknown.locked,true);

  const drill=lifecycle.analysisKickoffHandoffDrill();
  assert.equal(drill.pass,true);
  assert.ok(drill.cases>=6);
});

test('analysis response always carries freshness and kickoff handoff metadata',()=>{
  const payload=lifecycle.analysisResponsePayload({
    generatedAt:'2026-09-23T17:58:00Z',
    match:{fixtureId:7,date:'2026-09-23T18:30:00Z',status:'NS'},
    lineupImpact:{homeConfirmed:false,awayConfirmed:false},
  });

  assert.equal(payload.kickoffHandoff.state,'prematch');
  assert.equal(payload.kickoffHandoff.locked,false);
  assert.equal(payload.freshness.state,'fresh');
});

test('freshness and kickoff handoff agree at the scheduled kickoff even if provider status still says NS',()=>{
  const payload=lifecycle.analysisResponsePayload({
    generatedAt:'2026-09-23T17:59:00Z',
    match:{fixtureId:8,date:'2026-09-23T18:00:00Z',status:'NS'},
    lineupImpact:{homeConfirmed:true,awayConfirmed:true},
  });

  assert.equal(payload.kickoffHandoff.state,'live');
  assert.equal(payload.kickoffHandoff.locked,true);
  assert.equal(payload.freshness.state,'started');
  assert.equal(payload.freshness.needsRecheck,false);
  assert.equal(payload.freshness.reasonCode,'match_started');
});

test('Telegram freezes the prematch signal after kickoff',()=>{
  assert.match(telegram,/Предматчевый сигнал зафиксирован/);
  assert.match(telegram,/не превращает предматчевый сигнал в live-рекомендацию/);
  assert.match(telegram,/Используйте центр матча для счёта, событий и статистики/);
});

test('Mini App exposes a kickoff handoff card and match-center action',()=>{
  assert.match(app,/function kickoffHandoffHtml\(/);
  assert.match(app,/kickoffMatchCenterBtn/);
  assert.match(app,/openMatchCenter\(Number\(m\.fixtureId\)/);
  assert.match(app,/Предматчевый разбор зафиксирован/);
  assert.match(css,/\.kickoff-handoff/);
  assert.match(css,/\.ai-instructor-card\.archived/);
});

test('RC61 lifecycle boundary remains explicitly wired from Worker',()=>{
  assert.match(
    worker,
    /createAnalysisLifecycleRuntime\(\{[\s\S]*?hasSupabase,[\s\S]*?isFinishedStatus,[\s\S]*?isLiveStatus,[\s\S]*?memory,[\s\S]*?supaSelectOne,[\s\S]*?\}\);/,
  );
  assert.match(worker,/analysisKickoffHandoffDrill = \(\.\.\.args\) => getAnalysisLifecycleRuntime\(\)\.analysisKickoffHandoffDrill\(\.\.\.args\)/);
});
