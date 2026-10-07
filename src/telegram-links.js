import {
  resolvePrimaryTelegramBotUsername,
  telegramBotStartUrl,
} from './telegram-primary-identity.js';
import { normalizeReferralCode } from './referral-attribution.js';

// Phase 2 Telegram boundary: Mini App handoff and primary-bot deep-link construction only.
// Messaging, webhook orchestration, growth events and route handlers stay in the composition root.
export function createTelegramLinksRuntime(deps = {}) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Telegram links runtime dependencies are required.');
  }
  const {
    cleanLaunchPart,
    getCache,
    setCache,
    telegramApi,
  } = deps;
  if (typeof cleanLaunchPart !== 'function') {
    throw new TypeError('Telegram links runtime requires cleanLaunchPart.');
  }
  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function textValue(value, fallback = '') {
    return typeof value === 'string' ? value.trim() : fallback;
  }

  function canonicalFixtureId(value) {
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    }
    if (typeof value !== 'string' || value.length > 32) return null;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return null;
    const id=Number(raw);
    return Number.isSafeInteger(id) && id>0 ? id : null;
  }

  function safeLaunchPart(value, maxLength, fallback) {
    const raw=typeof value === 'string' ? value : fallback;
    const input=raw.length <= 512 ? (raw.trim() || fallback) : fallback;
    const cleaned=textValue(cleanLaunchPart(input,maxLength))
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g,'_')
      .replace(/^_+|_+$/g,'')
      .slice(0,maxLength);
    return cleaned || fallback;
  }

  function safeParamValue(value, key = '') {
    if (typeof value === 'string') {
      if (value.length > 512) {
        throw new TypeError(`Некорректный параметр Telegram-ссылки: ${key || 'value'}.`);
      }
      const text=value.normalize('NFKC').trim();
      if (
        /[\u0000-\u001f\u007f]/u.test(text)
      ) {
        throw new TypeError(`Некорректный параметр Telegram-ссылки: ${key || 'value'}.`);
      }
      return text;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    throw new TypeError(`Некорректный параметр Telegram-ссылки: ${key || 'value'}.`);
  }

  function requestUrl(request) {
    const requestUrlValue=typeof request?.url === 'string' ? request.url : '';
    if (!requestUrlValue || requestUrlValue.length > 2048) throw new TypeError('Некорректный URL Mini App.');
    const raw=requestUrlValue.trim();
    if (!raw) throw new TypeError('Некорректный URL Mini App.');
    let url;
    try { url=new URL(raw); }
    catch { throw new TypeError('Некорректный URL Mini App.'); }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new TypeError('Некорректный URL Mini App.');
    }
    return url;
  }

  function invalidFixtureIdError() {
    const error=new TypeError('Некорректный fixture ID для Telegram-ссылки.');
    error.code='TELEGRAM_FIXTURE_ID_INVALID';
    return error;
  }

  function telegramWebAppUrl(request, params = {}) {
    const url=requestUrl(request);
    const source=plainObject(params);
    if (!source) throw new TypeError('Некорректные параметры Telegram-ссылки.');
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    const entries=Object.entries(source);
    if (entries.length > 24) throw new TypeError('Слишком много параметров Telegram-ссылки.');
    for (const [rawKey, value] of entries) {
      const key=textValue(rawKey);
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) {
        throw new TypeError('Некорректное имя параметра Telegram-ссылки.');
      }
      if (value === undefined || value === null || value === '') continue;
      if (key === 'fixtureId') {
        const fixtureId=canonicalFixtureId(value);
        if (fixtureId === null) throw invalidFixtureIdError();
        url.searchParams.set(key,String(fixtureId));
        continue;
      }
      url.searchParams.set(key,safeParamValue(value,key));
    }
    const result=url.toString();
    if (result.length > 4096) throw new TypeError('Telegram-ссылка слишком длинная.');
    return result;
  }

  function telegramAnalysisHandoffParams(fixtureId, tab = 'brief') {
    const id=canonicalFixtureId(fixtureId);
    if (id === null) throw invalidFixtureIdError();
    if (typeof tab === 'string' && tab.length > 64) {
      throw new TypeError('Некорректная вкладка Telegram Mini App.');
    }
    const normalizedTab=textValue(tab,'brief') || 'brief';
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(normalizedTab)) {
      throw new TypeError('Некорректная вкладка Telegram Mini App.');
    }
    return {
      fixtureId:id,
      action:'analysis',
      tab:normalizedTab,
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

  function fixtureShareStartParam(fixtureId, options = {}) {
    const sourceOptions=plainObject(options) || {};
    const {
      source='social',
      campaign='match_share',
      content='analysis',
      referralCode='',
    } = sourceOptions;
    const id=canonicalFixtureId(fixtureId);
    if (id === null) return '';
    const src=safeLaunchPart(source,14,'social');
    const cmp=safeLaunchPart(campaign,22,'match_share');
    const cnt=safeLaunchPart(content,16,'analysis');
    if (referralCode !== undefined && referralCode !== null && typeof referralCode !== 'string') return '';
    const rawReferral=textValue(referralCode);
    const referral=normalizeReferralCode(rawReferral);
    if (rawReferral && !referral) return '';

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

  function campaignStartParam(options = {}) {
    const sourceOptions=plainObject(options) || {};
    const {
      source='social',
      campaign='launch',
      content='promo',
    } = sourceOptions;
    const src=safeLaunchPart(source,24,'social');
    const cmp=safeLaunchPart(campaign,28,'launch');
    const cnt=safeLaunchPart(content,20,'promo');
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
    const source=plainObject(cfg) || {};
    const rawBotToken=typeof source.botToken === 'string' ? source.botToken : '';
    const botToken=rawBotToken.length <= 512 ? rawBotToken.trim() : '';
    return resolvePrimaryTelegramBotUsername({
      botToken,
      getCached:typeof getCache === 'function'
        ? cacheKey=>getCache(cacheKey,source)
        : undefined,
      setCached:typeof setCache === 'function'
        ? (cacheKey,payload,ttlMinutes)=>setCache(cacheKey,0,payload,source,ttlMinutes)
        : undefined,
      getMe:async()=>{
        if (typeof telegramApi !== 'function') {
          throw new TypeError('Telegram links runtime requires telegramApi.');
        }
        return await telegramApi('getMe',source);
      },
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
    const targetValue=typeof url === 'string'
      ? url
      : url instanceof URL
        ? url.toString()
        : '';
    if (!targetValue || targetValue.length > 2048) {
      throw new TypeError('Некорректный URL для Telegram Share.');
    }
    const rawTarget=targetValue.trim();
    if (!rawTarget || /[\u0000-\u001f\u007f]/u.test(rawTarget)) {
      throw new TypeError('Некорректный URL для Telegram Share.');
    }
    let targetUrl;
    try { targetUrl=new URL(rawTarget); }
    catch { throw new TypeError('Некорректный URL для Telegram Share.'); }
    if (targetUrl.protocol !== 'https:' || targetUrl.username || targetUrl.password) {
      throw new TypeError('Некорректный URL для Telegram Share.');
    }
    const target=targetUrl.toString();
    const shareText=typeof text === 'string'
      ? text
          .slice(0,700)
          .normalize('NFKC')
          .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,' ')
          .trim()
      : '';
    const q=new URLSearchParams();
    q.set('url',target);
    if (shareText) q.set('text',shareText);
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
