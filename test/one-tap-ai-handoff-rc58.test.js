import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTelegramLinksRuntime } from '../src/telegram-links.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const telegramLinks=fs.readFileSync('src/telegram-links.js','utf8');
const telegramUi=fs.readFileSync('src/telegram-bot-ui-runtime.js','utf8');
const telegramOrchestration=fs.readFileSync('src/telegram-bot-orchestration-runtime.js','utf8');
const telegramSearch=fs.readFileSync('src/telegram-search-runtime.js','utf8');
const analysis=fs.readFileSync('src/analysis-runtime.js','utf8');
const growth=fs.readFileSync('src/growth-analytics-runtime.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const adminFunnel=fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

function linksRuntime() {
  return createTelegramLinksRuntime({
    cleanLaunchPart:(value,maxLength=24)=>String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g,'_')
      .replace(/^_+|_+$/g,'')
      .slice(0,maxLength),
  });
}

test('pre-match match selection still produces an immediate Telegram AI brief after runtime extraction',()=> {
  assert.match(telegramUi,/async function sendBotFixtureMenu\(/);
  assert.match(telegramUi,/await botAnalyzeFixtureDefault\(request,cfg,user,id\)/);
  assert.match(telegramOrchestration,/function botAiHandoffText\(/);
  assert.match(telegramOrchestration,/MatchRadar AI · короткая оценка/);
  assert.match(
    telegramUi,
    /footballQuickAiHandoffKeyboard\([\s\S]{0,120}?request,[\s\S]{0,120}?analyzedMatch,[\s\S]{0,120}?favorites/,
  );
  assert.match(telegramUi,/if \(match\.live \|\| match\.finished\)/);
});

test('full analysis handoff deep-links to the same canonical fixture and brief tab',()=> {
  const runtime=linksRuntime();
  assert.deepEqual(runtime.telegramAnalysisHandoffParams('12345','brief'),{
    fixtureId:12345,
    action:'analysis',
    tab:'brief',
    handoff:'1',
  });

  const url=new URL(runtime.telegramFullAnalysisUrl(
    new Request('https://app.example/telegram/webhook?old=1'),
    '12345',
    'brief',
  ));
  assert.equal(url.origin,'https://app.example');
  assert.equal(url.pathname,'/');
  assert.equal(url.searchParams.get('fixtureId'),'12345');
  assert.equal(url.searchParams.get('action'),'analysis');
  assert.equal(url.searchParams.get('tab'),'brief');
  assert.equal(url.searchParams.get('handoff'),'1');

  assert.match(telegramUi,/telegramFullAnalysisUrl,[\s\S]{0,120}?fixtureId,[\s\S]{0,80}?'brief'/);
  assert.match(telegramUi,/📊 Полный AI-разбор/);
});

test('Mini App handoff validates fixture identity and records full AI through analyze before history shortcut',()=> {
  assert.match(app,/function canonicalLaunchFixtureId\(value\)/);
  assert.match(app,/if \(!\/\^\\d\+\$\/\.test\(raw\)\) return null/);
  assert.match(app,/Number\.isSafeInteger\(id\) && id > 0 \? id : null/);
  assert.match(app,/const id = canonicalLaunchFixtureId\(fixtureId\)/);
  assert.match(app,/const fixtureId = canonicalLaunchFixtureId\(params\.get\('fixtureId'\)\)/);
  assert.match(app,/const handoff = params\.get\('handoff'\) === '1'/);
  assert.match(app,/openLaunchFixture\(fixtureId, action, tab, handoff, newsImpactDecision, newsImpactAction, newsImpactRecoveryCode, newsImpactRecoveryFrom\)/);
  assert.match(app,/if \(handoff\) \{[\s\S]{0,220}?Promise\.allSettled\(\[loadFavorites\(\), loadReminders\(\)\]\)[\s\S]{0,220}?return analyzeMatch\(id, null,/);

  const handoffIndex=app.indexOf('if (handoff) {');
  const analyzeIndex=app.indexOf('return analyzeMatch(id, null, { recheck:true',handoffIndex);
  const historyIndex=app.indexOf('await loadHistory(false);',handoffIndex);
  assert.ok(handoffIndex>=0 && analyzeIndex>handoffIndex && historyIndex>analyzeIndex);
});

test('cached Telegram brief to full Mini App still returns before quota reservation',()=> {
  const start=analysis.indexOf('async function apiAnalyze(request, cfg, user)');
  const cached=analysis.indexOf('if (cached && !needsFreshnessRecheck) {',start);
  const cachedReturn=analysis.indexOf('return json(safeAnalysisResponsePayload(cached',cached);
  const reserve=analysis.indexOf('usageReservation=objectValue(await reserveAnalysisQuota(userId,cfg));',start);
  assert.ok(start>=0 && cached>start && cachedReturn>cached && reserve>cachedReturn);
  assert.match(analysis,/const trackFullAi=analysisOrigin!==\'telegram_quick\'/);
});

test('one-tap analytics keeps categorical source metadata and remains aggregated',()=> {
  assert.match(telegramUi,/const HANDOFF_SOURCE_CODES=new Set\(\[[\s\S]{0,160}?'match_select'[\s\S]{0,160}?'deep_link'[\s\S]{0,160}?'news_impact'/);
  assert.match(telegramUi,/function handoffSource\(value,attributed=false\)/);
  assert.match(telegramUi,/eventName:'ai_handoff',[\s\S]{0,260}?metadata:\{[\s\S]{0,160}?cached:data\.cached===true,[\s\S]{0,160}?source:attribution \? source : 'match_select'/);

  const handoffEventIndex=telegramUi.indexOf("eventName:'ai_handoff'");
  const handoffEventBlock=telegramUi.slice(handoffEventIndex, handoffEventIndex+700);
  assert.doesNotMatch(handoffEventBlock,/query|rawText/i);

  assert.match(growth,/handoff:\{users:handoffUsers\.size,fullAiUsers:handoffToFull\.size,conversionPct:/);
  assert.match(adminFunnel,/One‑tap AI/);
});

test('single-result search uses the same one-tap callback path',()=> {
  assert.match(telegramUi,/function footballSearchHandoffKeyboard\(/);
  assert.match(telegramUi,/callback_data:`match:menu:\$\{fixtureId\}`/);
  assert.match(
    telegramSearch,
    /else if \(matches\.length === 1\) \{[\s\S]{0,260}?footballSearchHandoffKeyboard/,
  );
  assert.match(telegramSearch,/Нажмите один раз — сразу покажу короткую AI-оценку/);
});

test('RC58 core handoff drill remains composed after modular extraction',()=> {
  const runtime=linksRuntime();
  assert.equal(runtime.oneTapHandoffDrill().pass,true);
  assert.match(telegramLinks,/function oneTapHandoffDrill\(/);
  assert.match(worker,/function oneTapHandoffDrill\(\.\.\.args\) \{ return getTelegramLinksRuntime\(\)\.oneTapHandoffDrill\(\.\.\.args\); \}/);
  assert.match(worker,/function sendBotFixtureMenu\(\.\.\.args\) \{ return getTelegramBotUiRuntime\(\)\.sendBotFixtureMenu\(\.\.\.args\); \}/);
  assert.match(worker,/function footballSearchHandoffKeyboard\(\.\.\.args\) \{ return getTelegramBotUiRuntime\(\)\.footballSearchHandoffKeyboard\(\.\.\.args\); \}/);
});
