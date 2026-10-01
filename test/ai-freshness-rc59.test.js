import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('RC59 computes dynamic freshness from analysis age kickoff lineups and market',()=> {
  assert.match(worker,/function analysisFreshness\(/);
  assert.match(worker,/minutesToKickoff <= 15\) maxAgeMinutes=3/);
  assert.match(worker,/minutesToKickoff <= 45\) maxAgeMinutes=5/);
  assert.match(worker,/minutesToKickoff <= 120\) maxAgeMinutes=10/);
  assert.match(worker,/minutesToKickoff <= 360\) maxAgeMinutes=20/);
  assert.match(worker,/minutesToKickoff <= 90 && !lineupsConfirmed/);
  assert.match(worker,/reasonCode='lineups_window'/);
});

test('freshness drill distinguishes near-kickoff stale fresh and far-away snapshots',()=> {
  assert.match(worker,/ANALYSIS_FRESHNESS_DRILL_NOW/);
  assert.match(worker,/generatedAt:'2026-09-23T17:52:00Z'/);
  assert.match(worker,/generatedAt:'2026-09-23T17:58:00Z'/);
  assert.match(worker,/match:\{date:'2026-09-24T02:00:00Z',status:'NS'\}/);
  assert.match(worker,/stale\.needsRecheck && stale\.reasonCode==='lineups_window' && !fresh\.needsRecheck && !far\.needsRecheck/);
});

test('conditional recheck bypasses cache only when freshness requires it',()=> {
  assert.match(worker,/const recheckRequested=Boolean\(body\?\.recheck\)/);
  assert.match(worker,/const needsFreshnessRecheck=Boolean\(recheckRequested && staleBefore && previousFreshness\?\.needsRecheck\)/);
  assert.match(worker,/if \(cached && !needsFreshnessRecheck\)/);
  assert.match(worker,/body:JSON\.stringify\(\{fixtureId:Number\(fixtureId\),origin:'telegram_quick',recheck:true\}\)/);
});

test('free recheck is scoped to a user who already analyzed the fixture',()=> {
  assert.match(worker,/async function userHasAnalyzedFixture\(/);
  assert.match(worker,/analysis_history/);
  assert.match(worker,/if \(needsFreshnessRecheck\) freeRecheck=await userHasAnalyzedFixture\(user\.id,fixtureId,cfg\)/);
  assert.match(worker,/const passCandidate = entitlementBefore\.source === 'pass' && entitlementBefore\.access\.expandedAi === true/);
  assert.match(worker,/if \(!freeRecheck && !passCandidate && quotaBefore\.left <= 0\)/);
  assert.match(worker,/if \(!freeRecheck && !passAccess\) \{\n    usageReservation=await reserveAnalysisQuota\(user\.id,cfg\)/);
});

test('adaptive analysis TTL tightens toward kickoff',()=> {
  assert.match(worker,/minutesToKickoff !== null && minutesToKickoff <= 15\) ttl = 3/);
  assert.match(worker,/minutesToKickoff !== null && minutesToKickoff <= 45\) ttl = 5/);
  assert.match(worker,/minutesToKickoff !== null && minutesToKickoff <= 120\) ttl = 10/);
  assert.match(worker,/minutesToKickoff !== null && minutesToKickoff <= 360\) ttl = 20/);
  assert.match(worker,/minutesToKickoff !== null && minutesToKickoff > 360\) ttl = 45/);
});

test('Mini App and Telegram expose freshness without hiding stale provider fallback',()=> {
  assert.match(app,/function analysisFreshnessHtml\(/);
  assert.match(app,/Перепроверить AI сейчас/);
  assert.match(app,/recheck: options\.recheck !== false/);
  assert.match(app,/analysisRecheckBtn/);
  assert.match(worker,/Свежесть: <b>/);
  assert.match(css,/\.analysis-freshness\.recheck/);
});

test('history and analytics preserve current freshness semantics',()=> {
  assert.match(worker,/return json\(analysisResponsePayload\(payload,\{cached:true,stale:!fresh,historyReadOnly:true/);
  assert.match(worker,/eventName:'analysis_recheck'/);
  assert.match(worker,/rechecks:\{total:recheckRows\.length,free:recheckFree,charged:/);
});

test('RC59 health release gate exposes freshness contracts',()=> {
  for (const flag of ['aiFreshnessGuard','preKickoffRecheck','userScopedFreeRecheck','lineupFreshnessWindow','adaptiveAnalysisTtl']) {
    assert.ok(worker.includes(`${flag}: 'enabled'`), `missing ${flag}`);
  }
  assert.match(worker,/analysisFreshnessSelfTest: analysisFreshnessDrill\(\)\.pass \? 'enabled' : 'failed'/);
});