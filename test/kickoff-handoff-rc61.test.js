import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');
const playbook=fs.readFileSync('KICKOFF_HANDOFF_RC61.md','utf8');

test('RC61 classifies prematch imminent live and finished phases',()=> {
  assert.match(worker,/function analysisKickoffHandoff\(/);
  assert.match(worker,/state:'prematch',locked:false/);
  assert.match(worker,/state:'imminent',locked:false/);
  assert.match(worker,/state:'live',locked:true/);
  assert.match(worker,/state:'finished',locked:true/);
  assert.match(worker,/function analysisKickoffHandoffDrill\(/);
  assert.match(worker,/cases:4/);
});

test('analysis response always carries kickoff handoff metadata',()=> {
  assert.match(worker,/kickoffHandoff:analysisKickoffHandoff\(payload\)/);
  assert.match(worker,/kickoffHandoffSelfTest: analysisKickoffHandoffDrill\(\)\.pass \? 'enabled' : 'failed'/);
});

test('Telegram freezes the prematch signal after kickoff',()=> {
  assert.match(worker,/Предматчевый сигнал зафиксирован/);
  assert.match(worker,/не превращает предматчевый сигнал в live-рекомендацию/);
  assert.match(worker,/Используйте центр матча для счёта, событий и статистики/);
});

test('Mini App exposes a kickoff handoff card and match-center action',()=> {
  assert.match(app,/function kickoffHandoffHtml\(/);
  assert.match(app,/kickoffMatchCenterBtn/);
  assert.match(app,/openMatchCenter\(Number\(m\.fixtureId\)/);
  assert.match(app,/Предматчевый разбор зафиксирован/);
  assert.match(css,/\.kickoff-handoff/);
  assert.match(css,/\.ai-instructor-card\.archived/);
});

test('RC61 health contract is release-gated',()=> {
  for (const flag of ['kickoffHandoffGuard','prematchAdviceFreeze','liveContextHandoff','finishedAnalysisArchive']) {
    assert.ok(worker.includes(`${flag}: 'enabled'`), `missing ${flag}`);
  }
  assert.match(playbook,/Kickoff Handoff/);
  assert.match(playbook,/live-рекомендац/);
});
