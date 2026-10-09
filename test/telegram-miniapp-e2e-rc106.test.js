import { workerRuntime } from '../test-support/worker-root.js';
import { readFileSync as readContractSource } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-bot-ui-runtime.js','utf8')+'\n'+fs.readFileSync('src/analysis-runtime.js','utf8')+'\n'+fs.readFileSync('src/user-data-api-runtime.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const analysisController=fs.readFileSync('public/modules/analysis-controller.js','utf8');

test('RC106 locks the Telegram to Mini App handoff contract',()=>{
  assert.match(worker,/function telegramMiniAppE2EDrill\(/);
  assert.match(readContractSource(new URL('../src/telegram-bot-ui-runtime.js', import.meta.url), 'utf8'),/mainButtons\.includes\('🔎 Найти матч'\)/);
  assert.match(readContractSource(new URL('../src/telegram-bot-ui-runtime.js', import.meta.url), 'utf8'),/match:menu:\$\{match\.fixtureId\}/);
  assert.match(worker,/url\.searchParams\.get\('action'\)==='analysis'/);
  assert.match(worker,/url\.searchParams\.get\('handoff'\)==='1'/);
  assert.match(readContractSource(new URL('../src/telegram-bot-ui-runtime.js', import.meta.url), 'utf8'),/favorite:toggle:101:12345/);
  assert.match(readContractSource(new URL('../src/telegram-bot-ui-runtime.js', import.meta.url), 'utf8'),/favorite:toggle:202:12345/);
});

test('RC106 synchronizes user state before a Telegram handoff analysis',()=>{
  const start=app.indexOf('async function openLaunchFixture');
  const end=app.indexOf('\nfunction applyLaunchIntent',start);
  assert.ok(start>=0 && end>start);
  const block=app.slice(start,end);
  assert.match(block,/if \(handoff\) \{/);
  assert.match(block,/Promise\.allSettled\(\[loadFavorites\(\), loadReminders\(\)\]\)/);
  assert.match(block,/return analyzeMatch\(id, null, \{ recheck:true/);
});

test('RC106 keeps history synchronized and avoids redundant personal reads after full AI',()=>{
  const start=analysisController.indexOf('async function analyzeMatch');
  const end=analysisController.indexOf('return Object.freeze',start);
  assert.ok(start>=0 && end>start);
  const block=analysisController.slice(start,end);
  assert.match(block,/safeCall\(rememberHistory,data\)/);
  assert.match(block,/const secondaryTasks=\[\s*Promise.resolve\(\)\s*\.then\(\(\)=>refreshHistory\(false\)\)/);
  assert.match(block,/if \(safeRead\(state,'remindersLoaded'\)!==true\)[\s\S]*?secondaryTasks.push\([\s\S]*?refreshReminders\(\)/);
  assert.match(block,/if \(safeRead\(state,'favoritesLoaded'\)!==true\)[\s\S]*?secondaryTasks.push\([\s\S]*?refreshFavorites\(\)/);
  assert.match(block,/Promise\.allSettled\(secondaryTasks\)/);
});

test('RC106 full analysis exposes favorite actions without a redundant return-to-Telegram control',()=>{
  assert.match(app,/data-analysis-favorite=/);
  assert.match(app,/analysis-favorite-btn/);
  assert.match(app,/analysis-favorite-star/);
  assert.doesNotMatch(app,/returnToTelegramBtn|function returnToTelegram\(/);
});

test('RC106 favorite mutation rerenders an open analysis',()=>{
  const start=app.indexOf('async function toggleFavorite');
  const end=app.indexOf('\nfunction storageGet',start);
  assert.ok(start>=0 && end>start);
  assert.match(app.slice(start,end),/if \(state\.currentAnalysis\) renderAnalysis\(state\.currentAnalysis\)/);
});

test('RC106 keeps cached Telegram brief to full analysis quota-safe and history read-only',()=>{
  const analyzeStart=worker.indexOf('async function apiAnalyze');
  const cached=worker.indexOf('if (cached && !needsFreshnessRecheck)',analyzeStart);
  const cachedReturn=worker.indexOf('return json(safeAnalysisResponsePayload(cached',cached);
  const reserve=worker.indexOf('usageReservation=objectValue(await reserveAnalysisQuota(userId,cfg));',analyzeStart);
  assert.ok(cached>analyzeStart && cachedReturn>cached && reserve>cachedReturn);

  const historyStart=worker.indexOf('async function apiHistoryAnalysis');
  const historyEnd=worker.indexOf('async function apiFavorites',historyStart);
  const historyBlock=worker.slice(historyStart,historyEnd);
  assert.match(historyBlock,/historyReadOnly:true/);
  assert.doesNotMatch(historyBlock,/incrementUsage/);
});

test('RC106 exposes blocking E2E release and health contracts',()=>{
  assert.match(readContractSource(new URL('../src/admin-operational-api.js', import.meta.url), 'utf8'),/releaseCheck\('telegram_miniapp_e2e_selftest'/);
  assert.equal(workerRuntime.getTelegramBotUiRuntime().telegramMiniAppE2EDrill().pass,true);
  assert.ok(workerRuntime.getTelegramBotUiRuntime().telegramMiniAppE2EDrill().cases>0);
  assert.match(readContractSource(new URL('../src/app-capabilities.js', import.meta.url), 'utf8'),/telegramMiniAppE2E:\s*true/);
});

test('RC106 handoff cannot bypass the protected quota reservation on an uncached analysis',()=>{
  const analyzeStart=worker.indexOf('async function apiAnalyze');
  const reserve=worker.indexOf('usageReservation=objectValue(await reserveAnalysisQuota(userId,cfg));',analyzeStart);
  const analyzeEnd=worker.indexOf('async function apiHistoryAnalysis',analyzeStart);
  assert.ok(analyzeStart>=0 && reserve>analyzeStart && analyzeEnd>reserve);
  const block=worker.slice(analyzeStart,analyzeEnd);
  assert.match(block,/if \(cached && !needsFreshnessRecheck\)/);
  assert.match(block,/reserveAnalysisQuota\(userId,cfg\)/);
  assert.match(block,/analysisResponsePayload/);
});
