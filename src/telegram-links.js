import {
  resolvePrimaryTelegramBotUsername,
  telegramBotStartUrl,
} from './telegram-primary-identity.js';

// Phase 2 Telegram boundary: Mini App handoff and primary-bot deep-link construction only.
// Messaging, webhook orchestration, growth events and route handlers stay in the composition root.
export function createTelegramLinksRuntime({
  cleanLaunchPart,
  getCache,
  setCache,
  telegramApi,
} = {}) {
  function telegramWebAppUrl(request, params = {}) {
    const url = new URL(request.url);
    url.pathname = '/';
    url.search = '';
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  function telegramAnalysisHandoffParams(fixtureId, tab = 'brief') {
    return {
      fixtureId:Number(fixtureId || 0),
      action:'analysis',
      tab:String(tab || 'brief'),
      handoff:'1',
    };
  }

  function telegramFullAnalysisUrl(request, fixtureId, tab = 'brief') {
    return telegramWebAppUrl(request, telegramAnalysisHandoffParams(fixtureId, tab));
  }

  function oneTapHandoffDrill() {
    const p=telegramAnalysisHandoffParams(12345);
    return {
      pass:p.fixtureId===12345 && p.action==='analysis' && p.tab==='brief' && p.handoff==='1',
      fixtureId:p.fixtureId,
    };
  }

  function fixtureShareStartParam(fixtureId, {
    source='social',
    campaign='match_share',
    content='analysis',
  } = {}) {
    const id=Number(fixtureId || 0);
    if (!Number.isSafeInteger(id) || id<=0) return '';
    const src=cleanLaunchPart(source,14) || 'social';
    const cmp=cleanLaunchPart(campaign,22) || 'match_share';
    const cnt=cleanLaunchPart(content,16) || 'analysis';
    return `fx${id}__${src}__${cmp}__${cnt}`.slice(0,64);
  }

  async function telegramBotUsername(cfg) {
    return resolvePrimaryTelegramBotUsername({
      botToken:cfg.botToken,
      getCached:cacheKey=>getCache(cacheKey,cfg),
      setCached:(cacheKey,payload,ttlMinutes)=>setCache(cacheKey,0,payload,cfg,ttlMinutes),
      getMe:()=>telegramApi('getMe',cfg),
    });
  }

  async function fixtureTelegramDeepLink(cfg, fixtureId, options = {}) {
    const startParam=fixtureShareStartParam(fixtureId,options);
    if (!startParam) throw new Error('Некорректный матч для ссылки.');
    const username=await telegramBotUsername(cfg);
    return {url:telegramBotStartUrl(username,startParam),startParam,username};
  }

  function telegramShareComposerUrl(url, text = '') {
    const q=new URLSearchParams();
    q.set('url',String(url || ''));
    if (text) q.set('text',String(text).slice(0,700));
    return `https://t.me/share/url?${q.toString()}`;
  }

  return Object.freeze({
    telegramWebAppUrl,
    telegramAnalysisHandoffParams,
    telegramFullAnalysisUrl,
    oneTapHandoffDrill,
    fixtureShareStartParam,
    telegramBotUsername,
    fixtureTelegramDeepLink,
    telegramShareComposerUrl,
  });
}
