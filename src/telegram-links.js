import {
  resolvePrimaryTelegramBotUsername,
  telegramBotStartUrl,
} from './telegram-primary-identity.js';
import { normalizeReferralCode } from './referral-attribution.js';

// Phase 2 Telegram boundary: Mini App handoff and primary-bot deep-link construction only.
// Messaging, webhook orchestration, growth events and route handlers stay in the composition root.
export function createTelegramLinksRuntime({
  cleanLaunchPart,
  getCache,
  setCache,
  telegramApi,
} = {}) {
  function canonicalFixtureId(value) {
    const id=Number(value);
    return Number.isSafeInteger(id) && id>0 ? id : null;
  }

  function invalidFixtureIdError() {
    const error=new TypeError('Некорректный fixture ID для Telegram-ссылки.');
    error.code='TELEGRAM_FIXTURE_ID_INVALID';
    return error;
  }

  function telegramWebAppUrl(request, params = {}) {
    const url = new URL(request.url);
    url.pathname = '/';
    url.search = '';
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      const normalizedValue=key === 'fixtureId' ? canonicalFixtureId(value) : value;
      if (key === 'fixtureId' && normalizedValue === null) throw invalidFixtureIdError();
      url.searchParams.set(key, String(normalizedValue));
    }
    return url.toString();
  }

  function telegramAnalysisHandoffParams(fixtureId, tab = 'brief') {
    const id=canonicalFixtureId(fixtureId);
    if (id === null) throw invalidFixtureIdError();
    return {
      fixtureId:id,
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
    referralCode='',
  } = {}) {
    const id=canonicalFixtureId(fixtureId);
    if (id === null) return '';
    const src=cleanLaunchPart(source,14) || 'social';
    const cmp=cleanLaunchPart(campaign,22) || 'match_share';
    const cnt=cleanLaunchPart(content,16) || 'analysis';
    const referral=normalizeReferralCode(referralCode);
    if (referralCode && !referral) return '';

    const prefix=`fx${id}`;
    if (!referral) return `${prefix}__${src}__${cmp}__${cnt}`.slice(0,64);

    const suffix=`__r${referral}`;
    const values=[src,cmp,cnt];
    const minimum=[1,1,0];
    while (`${prefix}__${values.join('__')}${suffix}`.length>64) {
      let reduced=false;
      for (const index of [2,1,0]) {
        if (values[index].length>minimum[index]) {
          values[index]=values[index].slice(0,-1);
          reduced=true;
          break;
        }
      }
      if (!reduced) return '';
    }
    return `${prefix}__${values.join('__')}${suffix}`;
  }

  function campaignStartParam({
    source='social',
    campaign='launch',
    content='promo',
  } = {}) {
    const src=cleanLaunchPart(source,24) || 'social';
    const cmp=cleanLaunchPart(campaign,28) || 'launch';
    const cnt=cleanLaunchPart(content,20) || 'promo';
    const prefix='media';
    const values=[src,cmp,cnt];
    while (`${prefix}__${values.join('__')}`.length>64) {
      let reduced=false;
      for (const index of [2,1,0]) {
        if (values[index].length>1) {
          values[index]=values[index].slice(0,-1);
          reduced=true;
          break;
        }
      }
      if (!reduced) return '';
    }
    return `${prefix}__${values.join('__')}`;
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

  async function telegramCampaignDeepLink(cfg, options = {}) {
    const startParam=campaignStartParam(options);
    if (!startParam) throw new Error('Некорректные параметры рекламной кампании.');
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
    campaignStartParam,
    telegramBotUsername,
    fixtureTelegramDeepLink,
    telegramCampaignDeepLink,
    telegramShareComposerUrl,
  });
}
