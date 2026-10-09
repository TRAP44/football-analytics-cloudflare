import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createTelegramDedupeRuntime } from '../src/telegram-dedupe.js';
import { createFootballNewsRuntime } from '../src/football-news-runtime.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const wrangler=fs.readFileSync('wrangler.jsonc','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');
const statusRouter=fs.readFileSync('src/public-status.js','utf8');
const capabilities=fs.readFileSync('src/app-capabilities.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const privacy=fs.readFileSync('public/privacy.html','utf8');
const terms=fs.readFileSync('public/terms.html','utf8');

const telemetry=[];
const dedupeRuntime=createTelegramDedupeRuntime({
  memory:{telegramUpdateDedupe:new Map(),telegramBurst:new Map()},
  pruneMemoryState(){},
  bumpTelemetry(key){ telemetry.push(key); },
  hasSupabase(){ return false; },
  async supaRpc(){ return false; },
  redactOpsString(value,limit=160){ return String(value ?? '').slice(0,limit); },
});

const newsRuntime=createFootballNewsRuntime({
  NEWS_BLOCKED_HOST_RE:/(?:^|\.)blocked\.example$/i,
  NEWS_MAJOR_SOURCE_RE:/(?:^|\.)reuters\.com$/i,
  NEWS_OFFICIAL_SOURCE_RE:/(?:^|\.)uefa\.com$/i,
  TOP_TEAM_SEARCH_CATALOG:[],
  async botTeamIdMatches(){ return []; },
  async fetchWithTimeout(){ return {ok:false,json:async()=>({})}; },
  async getCache(){ return null; },
  async getFavorites(){ return []; },
  normalizeBotFixtureCard(value){ return value || {}; },
  async recordGrowthEvent(){},
  searchText(value){ return String(value || '').toLowerCase(); },
  async setCache(){},
  async telegramApi(){},
  telegramHtmlEscape(value){ return String(value || ''); },
  todayUtc(){ return '2026-10-07'; },
});

test('Telegram webhook dedupe and burst protection remain operational after modularization',()=> {
  const selfTest=dedupeRuntime.telegramPersistentDedupeSelfTest();
  assert.equal(selfTest.pass,true);
  assert.equal(selfTest.cases,7);

  const update={message:{from:{id:77},text:'status'}};
  let blocked=null;
  for(let i=0;i<11;i+=1) blocked=dedupeRuntime.enforceTelegramBurst(update);
  assert.equal(blocked?.blocked,true);
  assert.equal(blocked?.kind,'message');
  assert.ok(telemetry.includes('telegramBurstBlocks'));

  assert.match(worker,/createTelegramDedupeRuntime/);
});

test('payment lifecycle updates are exempt from generic Telegram burst throttling',()=> {
  for(const update of [
    {pre_checkout_query:{from:{id:77}}},
    {subscription:{user:{id:77}}},
    {message:{from:{id:77},successful_payment:{}}},
    {message:{from:{id:77},refunded_payment:{}}},
  ]) {
    assert.equal(dedupeRuntime.enforceTelegramBurst(update),null);
  }
});

test('news high-impact claims are downgraded when the source is not major or official',()=> {
  const untrusted=newsRuntime.applyNewsTrustGate({
    url:'https://example.com/story',
    category:{impact:'high'},
  });
  assert.equal(untrusted.verification,'needs_confirmation');
  assert.equal(untrusted.category.impact,'medium');

  const major=newsRuntime.applyNewsTrustGate({
    url:'https://www.reuters.com/story',
    category:{impact:'high'},
  });
  assert.equal(major.verification,'source_backed');
  assert.equal(major.category.impact,'high');

  const official=newsRuntime.applyNewsTrustGate({
    url:'https://www.uefa.com/story',
    category:{impact:'high'},
  });
  assert.equal(official.verification,'source_backed');
  assert.equal(official.category.impact,'high');

  assert.match(worker,/createFootballNewsRuntime/);
});

test('public legal pages stay linked while technical status stays outside the Mini App navigation',()=> {
  assert.match(privacy,/Политика конфиденциальности/);
  assert.match(privacy,/Telegram ID/);
  assert.match(privacy,/Cloudflare/);
  assert.match(terms,/Не финансовая рекомендация/);
  assert.match(terms,/не гарантирует исход/i);
  assert.match(html,/\/privacy\.html/);
  assert.match(html,/\/terms\.html/);
  const navigation=html.match(/<nav[\s\S]*?<\/nav>/)?.[0];
  assert.ok(navigation);
  assert.doesNotMatch(navigation,/\/status\.html/);
  assert.equal(fs.existsSync('public/status.html'),true);
  assert.doesNotMatch(html,/id="privacyView"/);
});

test('status and Telegram webhook are forced through the Worker',()=> {
  assert.match(wrangler,/"\/api\/\*"/);
  assert.match(wrangler,/"\/telegram\/\*"/);
  assert.match(statusRouter,/pathname === '\/api\/public-status'/);
  assert.match(smoke,/Telegram webhook must reject a request without its secret/);
  assert.match(smoke,/\/privacy\.html/);
});

test('RC52 hardening remains represented in current production contracts',()=> {
  assert.match(capabilities,/telegramWebhookPersistentDedupe:true/);
  assert.match(capabilities,/telegramWebhookDedupeObservability:true/);
  assert.match(capabilities,/emergencySecurityLockdown:true/);
  assert.match(statusRouter,/pathname === '\/health\/ready'/);
  assert.match(statusRouter,/pathname === '\/health'/);
});
