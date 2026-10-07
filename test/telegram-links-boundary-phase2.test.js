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


test('Telegram links boundary rejects malformed dependency bags and missing sanitizer', () => {
  assert.throws(
    () => createTelegramLinksRuntime(null),
    /dependencies are required/,
  );
  assert.throws(
    () => createTelegramLinksRuntime([]),
    /dependencies are required/,
  );
  assert.throws(
    () => createTelegramLinksRuntime({}),
    /requires cleanLaunchPart/,
  );
});

test('Telegram Mini App links require bounded HTTPS request origins', () => {
  const {api}=runtime();

  for (const url of [
    'http://app.example/',
    'https://user:pass@app.example/',
    'not-a-url',
    'https://app.example/' + 'x'.repeat(2050),
  ]) {
    assert.throws(
      () => api.telegramWebAppUrl({url},{view:'search'}),
      /Некорректный URL Mini App/,
      url,
    );
  }

  const valid=new URL(api.telegramWebAppUrl(
    new Request('https://app.example/deep/path?old=1#old'),
    {view:'search'},
  ));
  assert.equal(valid.protocol,'https:');
  assert.equal(valid.origin,'https://app.example');
  assert.equal(valid.pathname,'/');
  assert.equal(valid.searchParams.get('view'),'search');
  assert.equal(valid.hash,'');
});

test('Telegram Mini App query boundary rejects malformed containers keys and oversized values', () => {
  const {api}=runtime();
  const request=new Request('https://app.example/');

  assert.throws(
    () => api.telegramWebAppUrl(request,null),
    /Некорректные параметры Telegram-ссылки/,
  );
  assert.throws(
    () => api.telegramWebAppUrl(request,[]),
    /Некорректные параметры Telegram-ссылки/,
  );
  assert.throws(
    () => api.telegramWebAppUrl(request,{'bad key':'value'}),
    /Некорректное имя параметра Telegram-ссылки/,
  );
  assert.throws(
    () => api.telegramWebAppUrl(request,{q:'x'.repeat(513)}),
    /Некорректный параметр Telegram-ссылки/,
  );
  assert.throws(
    () => api.telegramWebAppUrl(request,{q:'safe\u0000unsafe'}),
    /Некорректный параметр Telegram-ссылки/,
  );

  const url=new URL(api.telegramWebAppUrl(request,{
    view:'search',
    q:'  Интер — Милан  ',
    page:2,
    compact:true,
  }));
  assert.equal(url.searchParams.get('q'),'Интер — Милан');
  assert.equal(url.searchParams.get('page'),'2');
  assert.equal(url.searchParams.get('compact'),'true');
});

test('Telegram analysis handoff rejects unsafe tab identifiers', () => {
  const {api}=runtime();
  for (const tab of ['brief/../../admin','live view','вкладка','x'.repeat(33),'bad\u0000tab']) {
    assert.throws(
      () => api.telegramAnalysisHandoffParams(12345,tab),
      /Некорректная вкладка Telegram Mini App/,
      tab,
    );
  }
  assert.equal(api.telegramAnalysisHandoffParams(12345,'live_stats').tab,'live_stats');
});

test('Telegram campaign and fixture share builders tolerate malformed option containers', () => {
  const {api}=runtime();

  assert.equal(
    api.fixtureShareStartParam(12345,null),
    'fx12345__social__match_share__analysis',
  );
  assert.equal(
    api.fixtureShareStartParam(12345,[]),
    'fx12345__social__match_share__analysis',
  );
  assert.equal(
    api.campaignStartParam(null),
    'media__social__launch__promo',
  );
  assert.equal(
    api.campaignStartParam([]),
    'media__social__launch__promo',
  );
});

test('Telegram share composer only accepts bounded credential-free HTTPS targets', () => {
  const {api}=runtime();

  for (const target of [
    'http://example.test/path',
    'javascript:alert(1)',
    'https://user:pass@example.test/path',
    'not-a-url',
    'https://example.test/' + 'x'.repeat(2050),
  ]) {
    assert.throws(
      () => api.telegramShareComposerUrl(target,'share'),
      /Некорректный URL для Telegram Share/,
      target,
    );
  }

  const share=new URL(api.telegramShareComposerUrl(
    new URL('https://example.test/path?a=1'),
    '  строка\u0000с управляющим символом  ',
  ));
  assert.equal(share.origin,'https://t.me');
  assert.equal(share.pathname,'/share/url');
  assert.equal(share.searchParams.get('url'),'https://example.test/path?a=1');
  assert.equal(share.searchParams.get('text'),'строка с управляющим символом');
});

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


test('Issue #410 analysis handoff rejects non-positive, fractional, junk and unsafe fixture IDs', () => {
  const {api}=runtime();
  const request=new Request('https://app.example/path?old=1');
  const invalid=[0,-1,1.5,NaN,'not-a-fixture',Number.MAX_SAFE_INTEGER+1];

  for (const value of invalid) {
    assert.throws(
      ()=>api.telegramAnalysisHandoffParams(value),
      error=>error?.code==='TELEGRAM_FIXTURE_ID_INVALID',
      String(value),
    );
    assert.throws(
      ()=>api.telegramFullAnalysisUrl(request,value,'brief'),
      error=>error?.code==='TELEGRAM_FIXTURE_ID_INVALID',
      String(value),
    );
    assert.throws(
      ()=>api.telegramWebAppUrl(request,{fixtureId:value,action:'analysis'}),
      error=>error?.code==='TELEGRAM_FIXTURE_ID_INVALID',
      String(value),
    );
  }
});

test('Issue #410 analysis and share fixture boundaries accept the same canonical fixture IDs', () => {
  const {api}=runtime();
  const request=new Request('https://app.example/');
  const params=api.telegramAnalysisHandoffParams('12345','brief');
  assert.equal(params.fixtureId,12345);
  assert.equal(api.fixtureShareStartParam('12345').startsWith('fx12345__'),true);

  const url=new URL(api.telegramFullAnalysisUrl(request,'12345','brief'));
  assert.equal(url.searchParams.get('fixtureId'),'12345');

  for (const value of [0,-5,2.25,NaN,'junk',Number.MAX_SAFE_INTEGER+1]) {
    assert.equal(api.fixtureShareStartParam(value),'',String(value));
  }
});

test('Telegram links boundary keeps compact attributed fixture start payload', () => {
  const {api}=runtime();
  assert.equal(
    api.fixtureShareStartParam(12345,{source:'Social Feed',campaign:'Match Share',content:'MiniApp'}),
    'fx12345__social_feed__match_share__miniapp',
  );
  assert.equal(api.fixtureShareStartParam(0),'');
  assert.equal(api.fixtureShareStartParam(-1),'');
  assert.equal(api.fixtureShareStartParam(1.5),'');
  assert.equal(api.fixtureShareStartParam('junk'),'');
  assert.equal(api.fixtureShareStartParam(Number.MAX_SAFE_INTEGER+1),'');
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
