import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const telegramLinks=fs.readFileSync('src/telegram-links.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('pre-match match selection produces an immediate Telegram AI brief',()=> {
  assert.match(worker,/async function sendBotFixtureMenu\(/);
  assert.match(worker,/const data=await botAnalyzeFixture\(request,cfg,userId,fixtureId\)/);
  assert.match(worker,/function botAiHandoffText\(/);
  assert.match(worker,/MatchRadar AI · короткая оценка/);
  assert.match(worker,/footballQuickAiHandoffKeyboard\(request,analyzedMatch,favorites\)/);
  assert.match(worker,/if \(match\.live \|\| match\.finished\)/);
});

test('full analysis handoff deep-links to the same fixture and brief tab',()=> {
  assert.match(telegramLinks,/function telegramAnalysisHandoffParams\(/);
  assert.match(telegramLinks,/action:'analysis'/);
  assert.match(telegramLinks,/tab:String\(tab \|\| 'brief'\)/);
  assert.match(telegramLinks,/handoff:'1'/);
  assert.match(worker,/telegramFullAnalysisUrl\(request,fixtureId,'brief'\)/);
  assert.match(worker,/📊 Полный AI-разбор/);
});

test('Mini App handoff records full AI through analyze instead of history shortcut',()=> {
  assert.match(app,/const handoff = params\.get\('handoff'\) === '1'/);
  assert.match(app,/openLaunchFixture\(fixtureId, action, tab, handoff, newsImpactDecision, newsImpactAction, newsImpactRecoveryCode, newsImpactRecoveryFrom\)/);
  assert.match(app,/if \(handoff\) \{/);
  assert.match(app,/Promise\.allSettled\(\[loadFavorites\(\), loadReminders\(\)\]\)/);
  assert.match(app,/return analyzeMatch\(id, null, \{ recheck:true, newsImpactDecision, newsImpactAction, newsImpactRecoveryCode, newsImpactRecoveryFrom \}\)/);
  const handoffIndex=app.indexOf('if (handoff) {');
  const analyzeIndex=app.indexOf('return analyzeMatch(id, null, { recheck:true, newsImpactDecision, newsImpactAction, newsImpactRecoveryCode, newsImpactRecoveryFrom });',handoffIndex);
  const historyIndex=app.indexOf('await loadHistory(false);',handoffIndex);
  assert.ok(handoffIndex>=0 && analyzeIndex>handoffIndex && historyIndex>analyzeIndex);
});

test('cached Telegram brief to full Mini App does not increment usage twice',()=> {
  const start=worker.indexOf('async function apiAnalyze(request, cfg, user)');
  const cached=worker.indexOf('if (cached && !needsFreshnessRecheck) {',start);
  const cachedReturn=worker.indexOf('return json(analysisResponsePayload(cached',cached);
  const reserve=worker.indexOf('usageReservation=await reserveAnalysisQuota(user.id,cfg);',start);
  assert.ok(start>=0 && cached>start && cachedReturn>cached && reserve>cachedReturn);
  assert.match(worker,/trackFullAi=analysisOrigin !== 'telegram_quick'/);
});

test('one-tap handoff analytics is query-text free and aggregated',()=> {
  const event=/eventName:'ai_handoff',channel:'telegram',fixtureId,metadata:\{cached:Boolean\(data\.cached\),source:'match_select'\}/;
  assert.match(worker,event);
  assert.doesNotMatch(event.source,/query|rawText/);
  assert.match(worker,/handoff:\{users:handoffUsers\.size,fullAiUsers:handoffToFull\.size,conversionPct:/);
  assert.match(app,/One‑tap AI/);
});

test('single-result search uses the same one-tap path',()=> {
  assert.match(worker,/function footballSearchHandoffKeyboard\(/);
  assert.match(worker,/callback_data:`match:menu:\$\{fixtureId\}`/);
  assert.match(worker,/\? footballSearchHandoffKeyboard\(request, matches\[0\], searchUrl\)/);
  assert.match(worker,/Нажмите один раз — сразу покажу короткую AI-оценку/);
});

test('RC58 health and deterministic handoff drill are release-gated',()=> {
  for (const flag of ['oneTapAiHandoff','telegramAutoQuickBrief','cachedFullAnalysisHandoff','directFixtureDeepLink','handoffFunnelTracking']) {
    assert.ok(worker.includes(`${flag}: 'enabled'`), `missing ${flag}`);
  }
  assert.match(worker,/oneTapHandoffSelfTest: oneTapHandoffDrill\(\)\.pass \? 'enabled' : 'failed'/);
});