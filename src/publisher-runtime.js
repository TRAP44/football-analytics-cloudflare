import { neutralSignalText } from './signal-wording.js';
export function createPublisherRuntime(deps = {}) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Publisher runtime dependencies are required.');
  }
  const {
    adminForbidden,
    botFixtureDateTime,
    campaignStartParam,
    channelPublisherState,
    claimChannelPublishIdempotency,
    cleanLaunchPart,
    completeChannelPublishIdempotency,
    ensureReferralCode,
    fixtureShareStartParam,
    fixtureTelegramDeepLink,
    getCache,
    isAdminUser,
    json,
    loadBotFixtureCard,
    normalizeBotFixtureCard,
    parseLaunchStartParam,
    publishChannelMessage,
    readJson,
    recordGrowthEvent,
    recordOpsEvent,
    redactOpsString,
    releaseChannelPublishIdempotency,
    telegramApi,
    telegramCampaignDeepLink,
    telegramFullAnalysisUrl,
    telegramHtmlEscape,
    telegramShareComposerUrl
  } = deps;

  for (const [name,fn] of Object.entries({
    adminForbidden,
    botFixtureDateTime,
    campaignStartParam,
    channelPublisherState,
    claimChannelPublishIdempotency,
    cleanLaunchPart,
    completeChannelPublishIdempotency,
    ensureReferralCode,
    fixtureShareStartParam,
    fixtureTelegramDeepLink,
    getCache,
    isAdminUser,
    json,
    loadBotFixtureCard,
    normalizeBotFixtureCard,
    parseLaunchStartParam,
    publishChannelMessage,
    readJson,
    recordGrowthEvent,
    recordOpsEvent,
    redactOpsString,
    releaseChannelPublishIdempotency,
    telegramApi,
    telegramCampaignDeepLink,
    telegramFullAnalysisUrl,
    telegramHtmlEscape,
    telegramShareComposerUrl,
  })) {
    if (typeof fn !== 'function') throw new TypeError(`Publisher runtime requires ${name}.`);
  }

  function integerCandidate(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== 'string' || value.length > 24) return null;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  }

  function positiveId(value) {
    const number=integerCandidate(value);
    return number !== null && number > 0 ? number : null;
  }

  function optionalFixtureId(value) {
    if (value === null || value === undefined || value === '') return 0;
    return positiveId(value);
  }

  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function safeText(value,max=1200) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0,max);
  }

  function finiteNumber(value,min=-Infinity,max=Infinity) {
    let number=null;
    if (typeof value === 'number') number=Number.isFinite(value) ? value : null;
    else if (typeof value === 'string' && value.length<=48 && /^-?(?:\d+|\d+\.\d+|\.\d+)$/.test(value.trim())) {
      number=Number(value.trim());
    }
    return number!==null && number>=min && number<=max ? number : null;
  }

  async function apiFixtureShareLink(request, cfg, user) {
    const url=new URL(request.url);
    const fixtureId=positiveId(url.searchParams.get('fixtureId'));
    if (fixtureId===null) return json({error:'Номер матча обязателен.'},400);
    const source=cleanLaunchPart(url.searchParams.get('source') || 'social',14) || 'social';
    const campaign=cleanLaunchPart(url.searchParams.get('campaign') || 'match_share',22) || 'match_share';
    const content=cleanLaunchPart(url.searchParams.get('content') || 'miniapp',16) || 'miniapp';
    try {
      const referralCode=await ensureReferralCode(user.id,cfg).catch(()=>'');
      const link=await fixtureTelegramDeepLink(cfg,fixtureId,{source,campaign,content,referralCode});
      void recordGrowthEvent(cfg,{
        userId:user.id,
        eventName:'share_created',
        channel:'miniapp',
        fixtureId,
        metadata:{source,campaign,content,surface:'miniapp',referral:Boolean(referralCode)},
      });
      return json({
        ok:true,
        fixtureId,
        url:link.url,
        startParam:link.startParam,
        telegramShareUrl:telegramShareComposerUrl(link.url,'Открой матч в MatchRadar — ссылка сразу приведёт к матчу и доступному AI-разбору.'),
        referral:{enabled:Boolean(referralCode),code:referralCode || null},
      });
    } catch (error) {
      return json({error:'Не удалось подготовить ссылку на матч.',detail:redactOpsString(error?.message || error,120)},503);
    }
  }
  
  function fixtureShareCardText(match = {}, analysis = null) {
    const card=normalizeBotFixtureCard(match || {});
    const ai=analysis?.aiInstructor || {};
    const signal=ai.betSignal || {};
    const confidenceValue=finiteNumber(ai.confidenceScore,0,100);
    const confidence=confidenceValue===null ? '' : `${Math.round(confidenceValue)}/100`;
    return [
      '⚽ <b>MatchRadar AI · МАТЧ</b>',
      '',
      `<b>${telegramHtmlEscape(card.homeName)} — ${telegramHtmlEscape(card.awayName)}</b>`,
      telegramHtmlEscape(card.league || 'Футбол'),
      card.date ? `🗓 ${telegramHtmlEscape(botFixtureDateTime(card.date))}` : '',
      // Нейтральный вывод по коду сигнала вместо ставочной метки («ТБ 2.5», «П1»).
      neutralSignalText(signal.code,{home:card.homeName,away:card.awayName})
        ? `🧠 AI: <b>${telegramHtmlEscape(neutralSignalText(signal.code,{home:card.homeName,away:card.awayName}))}</b>${confidence?` · ${confidence}`:''}`
        : '🧠 AI-разбор откроется сразу по ссылке.',
      '',
      '<i>Информационная аналитика, не гарантия результата.</i>',
    ].filter(Boolean).join('\n');
  }
  
  async function sendBotFixtureShareCard(request,cfg,userId,chatId,fixtureId) {
    const safeFixtureId=positiveId(fixtureId);
    if (safeFixtureId===null) throw new TypeError('Invalid fixture ID.');
    const referralCode=await ensureReferralCode(userId,cfg).catch(()=>'');
    const [match,analysis,link]=await Promise.all([
      loadBotFixtureCard(safeFixtureId,cfg),
      getCache(`fixture:${safeFixtureId}:v17-starting-xi-rc146`,cfg).catch(()=>null),
      fixtureTelegramDeepLink(cfg,safeFixtureId,{source:'social',campaign:'match_share',content:'telegram',referralCode}),
    ]);
    if (!match) throw new Error('Матч не найден.');
    const plain=`${match.homeName} — ${match.awayName}\nMatchRadar: открыть матч и доступный AI-разбор`;
    void recordGrowthEvent(cfg,{
      userId,
      eventName:'share_created',
      channel:'telegram',
      fixtureId:safeFixtureId,
      metadata:{surface:'match_card',referral:Boolean(referralCode)},
    });
    await telegramApi('sendMessage',cfg,{
      chat_id:chatId,
      parse_mode:'HTML',
      text:fixtureShareCardText(match,analysis),
      reply_markup:{inline_keyboard:[
        [{text:'↗ Отправить другу / в канал',url:telegramShareComposerUrl(link.url,plain)}],
        [{text:'🧠 Открыть самому',web_app:{url:telegramFullAnalysisUrl(request,safeFixtureId,'brief')}}],
      ]},
    });
  }
  
  
  async function apiChannelPublisherTest(request,cfg,user) {
    if (!isAdminUser(user,cfg)) return adminForbidden();
    const body=plainObject(await readJson(request));
    if (!body) return json({error:'Некорректное тело запроса.'},400);
    const fixtureId=positiveId(body.fixtureId);
    if (fixtureId===null) return json({error:'Укажите корректный fixture ID.'},400);
    const text=safeText(body.text,3900);
    if (!text) return json({error:'Текст тестового поста обязателен.'},400);
  
    const publisher=channelPublisherState(cfg);
    const link=await fixtureTelegramDeepLink(cfg,fixtureId,{source:'channel',campaign:'publisher_mvp',content:'manual'});
    const dryRun=body?.dryRun !== false;
    const preview={
      channelId:publisher.channelId || cfg.telegramChannelId || '',
      fixtureId,
      text,
      cta:{text:'Открыть матч в MatchRadar',url:link.url},
      publisher:{enabled:Boolean(publisher.enabled),reason:publisher.reason},
    };
  
    if (dryRun) return json({ok:true,dryRun:true,published:false,preview});
  
    if (!publisher.enabled) {
      return json({
        ok:false,
        published:false,
        disabled:true,
        code:'PUBLISHER_DISABLED',
        reason:publisher.reason,
      },503);
    }
  
    try {
      const result=await publishChannelMessage({
        cfg,
        fixtureId,
        text,
        ctaUrl:link.url,
        idempotencyKey:safeText(body.idempotencyKey,160),
      },{
        claimIdempotency:(key,meta)=>claimChannelPublishIdempotency(key,meta,cfg),
        completeIdempotency:(key,meta)=>completeChannelPublishIdempotency(key,meta,cfg),
        releaseIdempotency:(key,meta)=>releaseChannelPublishIdempotency(key,meta,cfg),
      });
      return json({...result,dryRun:false,fixtureId,cta:preview.cta},result.ok?200:503);
    } catch (error) {
      void recordOpsEvent(cfg,{
        severity:'error',
        source:'channel_publisher',
        eventType:'manual_publish',
        code:String(error?.code || 'CHANNEL_PUBLISH_FAILED'),
        message:error?.message || error,
        endpoint:'/api/admin/channel-publisher/test',
        status:502,
        meta:{fixtureId},
      }).catch(()=>null);
      return json({
        ok:false,
        published:false,
        code:String(error?.code || 'CHANNEL_PUBLISH_FAILED'),
        error:'Не удалось отправить тестовый пост в Telegram-канал.',
      },502);
    }
  }
  
  
  function fixtureDeepLinkDrill() {
    const p=fixtureShareStartParam(123456,{source:'media',campaign:'launch',content:'sportnews'});
    const parsed=parseLaunchStartParam(p);
    return {pass:p.length<=64 && parsed.fixtureId===123456 && parsed.source==='media' && parsed.campaign==='launch' && parsed.content==='sportnews',length:p.length};
  }
  
  
  function mediaPublisherCopy(match = {}, deepLink = '', attribution = {}) {
    const card=normalizeBotFixtureCard(match || {});
    const title=card.fixtureId && card.homeName && card.awayName
      ? `${card.homeName} — ${card.awayName}`
      : `Матч #${positiveId(card.fixtureId) || '—'}`;
    const meta=[card.league,card.date ? botFixtureDateTime(card.date) : ''].filter(Boolean).join(' · ');
    const body=[
      `⚽ ${title}`,
      meta,
      '',
      'MatchRadar AI: составы, судья, рынок, риски и AI-разбор матча.',
      deepLink ? `Открыть матч: ${deepLink}` : '',
      '',
      'Информационная аналитика. Не гарантия результата.',
    ].filter(Boolean).join('\n');
    return {
      title,
      body,
      source:String(attribution.source || ''),
      campaign:String(attribution.campaign || ''),
      content:String(attribution.content || ''),
    };
  }
  
  function campaignPublisherCopy(deepLink = '', attribution = {}) {
    const body=[
      '⚽ MatchRadar — футбольная аналитика в Telegram',
      '',
      'Матчи, форма команд, составы, события, статистика и AI-разбор — в одном Mini App.',
      'Открой MatchRadar, выбери матч и посмотри доступный разбор.',
      deepLink ? `Открыть MatchRadar: ${deepLink}` : '',
      '',
      'Информационная аналитика. Не гарантия результата.',
    ].filter(Boolean).join('\n');
    return {
      title:'MatchRadar — футбольная аналитика',
      body,
      source:String(attribution.source || ''),
      campaign:String(attribution.campaign || ''),
      content:String(attribution.content || ''),
    };
  }
  
  async function apiMediaPublisherLink(request,cfg,user) {
    if (!isAdminUser(user,cfg)) return adminForbidden();
    const body=plainObject(await readJson(request));
    if (!body) return json({error:'Некорректное тело запроса.'},400);
    const fixtureId=optionalFixtureId(body.fixtureId);
    if (fixtureId===null) return json({error:'Укажите корректный fixture ID или оставьте поле пустым.'},400);
    const source=cleanLaunchPart(body?.source || 'social',fixtureId>0?14:24) || 'social';
    const campaign=cleanLaunchPart(body?.campaign || 'soft_launch',fixtureId>0?22:28) || 'soft_launch';
    const content=cleanLaunchPart(body?.content || 'promo1',fixtureId>0?16:20) || 'promo1';
  
    let link;
    let copy;
    let mode='campaign';
    if (fixtureId>0) {
      mode='fixture';
      link=await fixtureTelegramDeepLink(cfg,fixtureId,{source,campaign,content});
      const cached=await getCache(`bot:fixture-card:${fixtureId}:v2`,cfg).catch(()=>null);
      const analyzed=await getCache(`fixture:${fixtureId}:v17-starting-xi-rc146`,cfg).catch(()=>null);
      const match=normalizeBotFixtureCard(cached?.match || analyzed?.match || {fixtureId,homeName:'Матч',awayName:String(fixtureId),league:'Футбол'});
      copy=mediaPublisherCopy(match,link.url,{source,campaign,content});
    } else {
      link=await telegramCampaignDeepLink(cfg,{source,campaign,content});
      copy=campaignPublisherCopy(link.url,{source,campaign,content});
    }
  
    void recordGrowthEvent(cfg,{
      userId:user.id,
      eventName:'media_link_created',
      channel:'miniapp',
      fixtureId:fixtureId || null,
      metadata:{source,campaign,content,admin:true,mode},
      attribution:{source,campaign,content,startParam:link.startParam},
    });
    return json({
      ok:true,
      mode,
      fixtureId:fixtureId || null,
      startParam:link.startParam,
      deepLink:link.url,
      telegramShareUrl:telegramShareComposerUrl(link.url,copy.title),
      copy,
    });
  }
  
  function mediaPublisherDrill() {
    const fixtureParam=fixtureShareStartParam(998877,{source:'press',campaign:'ucl_launch',content:'article1'});
    const fixtureParsed=parseLaunchStartParam(fixtureParam);
    const campaignParam=campaignStartParam({source:'telegram_channel',campaign:'soft_launch',content:'post1'});
    const campaignParsed=parseLaunchStartParam(campaignParam);
    const fixtureCopy=mediaPublisherCopy({fixtureId:998877,homeName:'A',awayName:'B',league:'Cup'},'https://t.me/test?start='+fixtureParam,{source:'press',campaign:'ucl_launch',content:'article1'});
    const campaignCopy=campaignPublisherCopy('https://t.me/test?start='+campaignParam,{source:'telegram_channel',campaign:'soft_launch',content:'post1'});
    return {pass:fixtureParsed.fixtureId===998877
      && fixtureParsed.source==='press'
      && fixtureParsed.campaign==='ucl_launch'
      && campaignParsed.source==='telegram_channel'
      && campaignParsed.campaign==='soft_launch'
      && campaignParsed.content==='post1'
      && fixtureCopy.body.includes('A — B')
      && campaignCopy.body.includes('MatchRadar'),cases:8};
  }

  return Object.freeze({
    apiFixtureShareLink,
    fixtureShareCardText,
    sendBotFixtureShareCard,
    apiChannelPublisherTest,
    fixtureDeepLinkDrill,
    mediaPublisherCopy,
    campaignPublisherCopy,
    apiMediaPublisherLink,
    mediaPublisherDrill
  });
}
