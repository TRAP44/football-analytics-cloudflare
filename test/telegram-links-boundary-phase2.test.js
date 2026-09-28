import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramLinksRuntime } from '../src/telegram-links.js';

function cleanLaunchPart(value, maxLength = 24) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g,'_')
    .replace(/^_+|_+$/g,'')
    .slice(0,maxLength);
}

function runtime(overrides = {}) {
  const cache=new Map();
  const calls=[];
  const api=createTelegramLinksRuntime({
    cleanLaunchPart,
    getCache:async key=>cache.get(key),
    setCache:async (key,_fixtureId,payload)=>cache.set(key,payload),
    telegramApi:async (method)=> {
      calls.push(method);
      return {id:202,username:'MatchRadarAIBot'};
    },
    ...overrides,
  });
  return {api,cache,calls};
}

test('Telegram links boundary preserves Mini App handoff contract', () => {
  const {api}=runtime();
  const request=new Request('https://app.example/some/path?old=1');
  assert.deepEqual(api.telegramAnalysisHandoffParams(12345),{
    fixtureId:12345,
    action:'analysis',
    tab:'brief',
    handoff:'1',
  });
  const url=new URL(api.telegramFullAnalysisUrl(request,12345,'brief'));
  assert.equal(url.origin,'https://app.example');
  assert.equal(url.pathname,'/');
  assert.equal(url.searchParams.get('fixtureId'),'12345');
  assert.equal(url.searchParams.get('action'),'analysis');
  assert.equal(url.searchParams.get('tab'),'brief');
  assert.equal(url.searchParams.get('handoff'),'1');
  assert.equal(api.oneTapHandoffDrill().pass,true);
});

test('Telegram links boundary keeps compact attributed fixture start payload', () => {
  const {api}=runtime();
  assert.equal(
    api.fixtureShareStartParam(12345,{source:'Social Feed',campaign:'Match Share',content:'MiniApp'}),
    'fx12345__social_feed__match_share__miniapp',
  );
  assert.equal(api.fixtureShareStartParam(0),'');
  assert.ok(api.fixtureShareStartParam(12345,{source:'x'.repeat(80)}).length<=64);
});

test('Telegram links boundary resolves current primary bot identity through cache-aware getMe', async () => {
  const {api,calls}=runtime();
  const cfg={botToken:'test-primary-token-B'};
  const link=await api.fixtureTelegramDeepLink(cfg,12345,{source:'social',campaign:'migration',content:'test'});
  assert.equal(link.username,'MatchRadarAIBot');
  assert.match(link.url,/^https:\/\/t\.me\/MatchRadarAIBot\?start=/);
  assert.match(link.startParam,/^fx12345__/);
  assert.deepEqual(calls,['getMe']);
});

test('Telegram share composer preserves URL and truncates oversized text', () => {
  const {api}=runtime();
  const target='https://t.me/MatchRadarAIBot?start=fx12345';
  const share=new URL(api.telegramShareComposerUrl(target,'x'.repeat(900)));
  assert.equal(share.origin,'https://t.me');
  assert.equal(share.pathname,'/share/url');
  assert.equal(share.searchParams.get('url'),target);
  assert.equal(share.searchParams.get('text').length,700);
});

test('worker composes Telegram links boundary instead of owning link helper implementations', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  assert.match(worker,/import \{ createTelegramLinksRuntime \} from '\.\/telegram-links\.js';/);
  assert.match(worker,/const \{[\s\S]{0,500}telegramWebAppUrl[\s\S]{0,500}fixtureTelegramDeepLink[\s\S]{0,500}\} = createTelegramLinksRuntime\(/);
  for (const name of [
    'telegramWebAppUrl',
    'telegramAnalysisHandoffParams',
    'telegramFullAnalysisUrl',
    'oneTapHandoffDrill',
    'fixtureShareStartParam',
    'telegramBotUsername',
    'fixtureTelegramDeepLink',
    'telegramShareComposerUrl',
  ]) {
    assert.doesNotMatch(worker,new RegExp(`(?:async\\s+)?function\\s+${name}\\(`));
  }
});
