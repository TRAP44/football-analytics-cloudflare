export function createTelegramDigestRuntime(deps = {}) {
  if (!deps || typeof deps!=='object' || Array.isArray(deps)) {
    throw new TypeError('Telegram digest runtime dependencies are required.');
  }

  const {
    DAILY_DIGEST_POLICY,
    SMART_NOTIFICATION_POLICY,
    apiFootball,
    assessDailyDigestRun,
    botMatchButtonText,
    bumpTelemetry,
    currentMorningFootballNews,
    filterSmartNotificationRecipients,
    footballBotKeyboard,
    freeQuotaHealthy,
    getAnalysisTimelineSnapshots,
    getCache,
    getFavorites,
    getStaleCache,
    hasSupabase,
    isFootballRateLimitError,
    isLiveStatus,
    isYouthReserveMatch,
    loadProviderFixturesForDate,
    markTelegramWebhookMutation,
    matchInterestScore,
    memory,
    morningNewsText,
    newsConversionKeyboard,
    normalizeBotFixtureCard,
    normalizeCompetition,
    planDailyDigestRecipients,
    radarStrongSignalState,
    recordOpsEvent,
    rememberBotFixtureCards,
    runBoundedDailyDigest,
    setCache,
    sleepMs,
    supaPatch,
    supaRpc,
    supaSelectOne,
    supaSelectPaged,
    supaUpsert,
    telegramApi,
    telegramHtmlEscape,
    todayUtc
  } = deps;

  const requiredFunctions={
    apiFootball,
    assessDailyDigestRun,
    botMatchButtonText,
    bumpTelemetry,
    currentMorningFootballNews,
    filterSmartNotificationRecipients,
    footballBotKeyboard,
    freeQuotaHealthy,
    getAnalysisTimelineSnapshots,
    getCache,
    getFavorites,
    getStaleCache,
    hasSupabase,
    isFootballRateLimitError,
    isLiveStatus,
    isYouthReserveMatch,
    loadProviderFixturesForDate,
    markTelegramWebhookMutation,
    matchInterestScore,
    morningNewsText,
    newsConversionKeyboard,
    normalizeBotFixtureCard,
    normalizeCompetition,
    planDailyDigestRecipients,
    radarStrongSignalState,
    recordOpsEvent,
    rememberBotFixtureCards,
    runBoundedDailyDigest,
    setCache,
    sleepMs,
    supaPatch,
    supaRpc,
    supaSelectOne,
    supaSelectPaged,
    supaUpsert,
    telegramApi,
    telegramHtmlEscape,
    todayUtc,
  };
  for (const [name,dependency] of Object.entries(requiredFunctions)) {
    if (typeof dependency!=='function') {
      throw new TypeError(`Telegram digest runtime dependency ${name} is required.`);
    }
  }
  if (!DAILY_DIGEST_POLICY || typeof DAILY_DIGEST_POLICY!=='object' || Array.isArray(DAILY_DIGEST_POLICY)) {
    throw new TypeError('Telegram digest runtime DAILY_DIGEST_POLICY is required.');
  }
  if (!SMART_NOTIFICATION_POLICY || typeof SMART_NOTIFICATION_POLICY!=='object' || Array.isArray(SMART_NOTIFICATION_POLICY)) {
    throw new TypeError('Telegram digest runtime SMART_NOTIFICATION_POLICY is required.');
  }
  if (!memory || typeof memory!=='object' || !(memory.botDigestSubscriptions instanceof Map)) {
    throw new TypeError('Telegram digest runtime memory store is required.');
  }

  const CANCELLED_FIXTURE_STATUSES=new Set(['CANC','PST','ABD','AWD','WO']);

  function rowsOf(value) {
    return Array.isArray(value) ? value : [];
  }

  function plainObject(value) {
    return value && typeof value==='object' && !Array.isArray(value) ? value : null;
  }

  function positiveSafeInteger(value) {
    if (typeof value==='number') {
      return Number.isSafeInteger(value) && value>0 ? value : 0;
    }
    if (typeof value!=='string') return 0;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return 0;
    const parsed=Number(raw);
    return Number.isSafeInteger(parsed) && parsed>0 ? parsed : 0;
  }

  function telegramChatId(value) {
    if (typeof value==='number') {
      return Number.isSafeInteger(value) && value!==0 ? value : 0;
    }
    if (typeof value!=='string') return 0;
    const raw=value.trim();
    if (!/^-?\d+$/.test(raw)) return 0;
    const parsed=Number(raw);
    return Number.isSafeInteger(parsed) && parsed!==0 ? parsed : 0;
  }

  function boundedLimit(value,fallback=3,max=20) {
    if (typeof value!=='number' || !Number.isFinite(value)) return fallback;
    return Math.max(1,Math.min(max,Math.trunc(value)));
  }

  function finiteMetric(value,min=-Infinity,max=Infinity) {
    return typeof value==='number'
      && Number.isFinite(value)
      && value>=min
      && value<=max
      ? value
      : null;
  }

  function plainText(value,max=120) {
    if (!['string','number','bigint'].includes(typeof value)) return '';
    try {
      return String(value)
        .replace(/[\u0000-\u001F\u007F]/g,' ')
        .replace(/\s+/g,' ')
        .trim()
        .slice(0,max);
    } catch {
      return '';
    }
  }

  function htmlText(value,max=120,fallback='') {
    const text=plainText(value,max) || fallback;
    return telegramHtmlEscape(text);
  }

  function deliveryDate(value) {
    const raw=typeof value==='string' ? value.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
    const parsed=new Date(`${raw}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10)===raw ? raw : '';
  }

  async function sendDigestControls(request, cfg, chatId) {
    await telegramApi('sendMessage', cfg, {
      chat_id: chatId,
      text: '☀️ Утренняя подборка MatchRadar AI\n\nПримерно в 07:00 UTC: до 3 заметных матчей дня + короткий блок важных футбольных новостей с источниками. Выберите режим:',
      reply_markup: { inline_keyboard: [[
        { text: '✅ Включить', callback_data: 'digest:on' },
        { text: '🔕 Выключить', callback_data: 'digest:off' },
      ]] },
    });
  }
  
  function digestFixtureRows(fixtures = [], limit = 3) {
    return rowsOf(fixtures).filter(f => {
      if (!f || typeof f!=='object' || Array.isArray(f)) return false;
      const status=plainText(f.fixture?.status?.short,16);
      const home=plainText(f.teams?.home?.name,120);
      const away=plainText(f.teams?.away?.name,120);
      return !CANCELLED_FIXTURE_STATUSES.has(status) && !isYouthReserveMatch(plainText(f.league?.name,120),home,away);
    }).map(f => {
      try {
        const leagueId=positiveSafeInteger(f.league?.id);
        const homeName=plainText(f.teams?.home?.name,120);
        const awayName=plainText(f.teams?.away?.name,120);
        const leagueName=plainText(f.league?.name,120);
        const country=plainText(f.league?.country,80);
        const competition=normalizeCompetition(leagueId,leagueName,country,homeName,awayName) || {};
        const status=plainText(f.fixture?.status?.short,16);
        const date=plainText(f.fixture?.date,64);
        const score=finiteMetric(
          matchInterestScore({competition,leagueId,leagueName,country,homeName,awayName,status,date}),
        );
        const priority=finiteMetric(competition.priority);
        return {
          fixtureId:positiveSafeInteger(f.fixture?.id),
          date,
          status,
          live:isLiveStatus(status)===true,
          home:{id:positiveSafeInteger(f.teams?.home?.id),name:homeName,logo:plainText(f.teams?.home?.logo,500)},
          away:{id:positiveSafeInteger(f.teams?.away?.id),name:awayName,logo:plainText(f.teams?.away?.logo,500)},
          homeName,
          awayName,
          league:plainText(competition.shortName || competition.name || leagueName,120) || 'Турнир',
          score:score ?? 0,
          priority:priority ?? 0,
          featured:competition.featured===true,
        };
      } catch {
        return null;
      }
    }).filter(x => positiveSafeInteger(x?.fixtureId))
      .sort((a,b) => Number(b.live)-Number(a.live) || Number(b.featured)-Number(a.featured) || b.score-a.score || b.priority-a.priority || String(a.date).localeCompare(String(b.date)))
      .slice(0,boundedLimit(limit,3,20));
  }
  
  function digestTime(iso) {
    const d = new Date(iso || '');
    if (!Number.isFinite(d.getTime())) return '—';
    return new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(d) + ' UTC';
  }
  
  function dailyDigestText(rows = []) {
    const matches=rowsOf(rows);
    if (!matches.length) return '⚽ Сегодня пока нет подходящих матчей для короткой AI-подборки.';
    return [
      '🧠 <b>3 матча дня · AI-подборка</b>',
      '',
      ...matches.map((x,i)=>`${i+1}. <b>${htmlText(x?.homeName,120,'Хозяева')} — ${htmlText(x?.awayName,120,'Гости')}</b>\n${htmlText(x?.league,120,'Турнир')} · ${x?.live===true ? '🔴 идёт сейчас' : digestTime(x?.date)}`),
      '',
      'Нажмите на матч — короткая AI-оценка придёт сразу в Telegram. Полный разбор откроется одним нажатием.',
    ].join('\n');
  }
  
  function expandedDailyDigestText(rows = [], radarByFixture = new Map()) {
    const matches=rowsOf(rows);
    const radar=radarByFixture && typeof radarByFixture.get==='function' ? radarByFixture : new Map();
    const base=dailyDigestText(matches);
    const radarLines=matches.slice(0,3).map(match=>{
      const state=radar.get(positiveSafeInteger(match?.fixtureId));
      if (!state || state.reason!=='evaluated' || !state.latest || !state.strongest) return '';
      const sideName=state.strongest.side==='home'
        ? String(match?.homeName || 'Хозяева')
        : state.strongest.side==='away'
          ? String(match?.awayName || 'Гости')
          : 'Ничья';
      const confidence=finiteMetric(state.latest.confidence,0,100);
      const probability=finiteMetric(state.strongest.probability,0,100);
      const probabilityLabel=probability!==null
        ? probability.toFixed(1)
        : '—';
      return `• <b>${htmlText(match?.homeName,120,'Хозяева')} — ${htmlText(match?.awayName,120,'Гости')}</b>: ${htmlText(sideName,120,'Ничья')} ${probabilityLabel}%${confidence!==null ? ` · Radar ${Math.round(confidence)}/100` : ''}`;
    }).filter(Boolean);
    if (!radarLines.length) return base;
    return [
      base,
      '',
      '📡 <b>PRO · Radar-контекст</b>',
      ...radarLines,
      '<i>Контекст построен только по сохранённым снимкам модели; это не гарантия результата.</i>',
    ].join('\n');
  }
  
  async function getBotDigestSubscription(userId, cfg) {
    const telegramId=positiveSafeInteger(userId);
    if (!telegramId) return null;
    if (hasSupabase(cfg)) {
      return await supaSelectOne(cfg,'bot_digest_subscriptions',{telegram_id:`eq.${telegramId}`});
    }
    return memory.botDigestSubscriptions.get(telegramId) || null;
  }
  
  async function setBotDigestSubscription(userId, chatId, enabled, cfg, appUrl = '') {
    const telegramId=positiveSafeInteger(userId);
    const requestedChatId=telegramChatId(chatId) || telegramId;
    if (!telegramId || !requestedChatId) {
      throw new TypeError('Telegram digest subscription identity is invalid.');
    }
    if (typeof enabled!=='boolean') {
      throw new TypeError('Telegram digest subscription enabled must be boolean.');
    }
    markTelegramWebhookMutation(cfg,'digest_subscription');
    const previous=plainObject(await getBotDigestSubscription(telegramId,cfg)) || {};
    const previousAppUrl=plainText(previous.app_url,500);
    const requestedAppUrl=plainText(appUrl,500);
    const row = {
      telegram_id:telegramId,
      chat_id:telegramChatId(previous.chat_id) || requestedChatId,
      enabled,
      hour_utc:DAILY_DIGEST_POLICY.deliveryHourUtc,
      app_url:requestedAppUrl || previousAppUrl,
      updated_at:new Date().toISOString(),
    };
    if (hasSupabase(cfg)) {
      await supaUpsert(cfg,'bot_digest_subscriptions',row,'telegram_id');
    } else {
      memory.botDigestSubscriptions.set(telegramId,{
        ...previous,
        ...row,
        last_sent_date:deliveryDate(previous.last_sent_date) || null,
      });
    }
    return {...previous,...row};
  }
  
  function publicDigestSettings(row = null, plan = 'FREE', favorites = []) {
    const source=plainObject(row) || {};
    const hourUtc=DAILY_DIGEST_POLICY.deliveryHourUtc;
    const requestedPlan=plainText(plan,16).toUpperCase();
    const normalizedPlan=['FREE','PRO','PREMIUM'].includes(requestedPlan)
      ? requestedPlan
      : 'FREE';
    const favoriteTeams=[];
    const seenTeamIds=new Set();
    for (const raw of rowsOf(favorites).slice(0,24)) {
      const item=plainObject(raw);
      if (!item) continue;
      const teamId=positiveSafeInteger(item.team_id ?? item.teamId);
      const teamName=plainText(item.team_name ?? item.teamName,80);
      if (!teamId || !teamName || seenTeamIds.has(teamId)) continue;
      seenTeamIds.add(teamId);
      favoriteTeams.push({teamId,teamName});
      if (favoriteTeams.length>=6) break;
    }
    return {
      enabled:source.enabled === true,
      configured:positiveSafeInteger(source.telegram_id)>0,
      plan:normalizedPlan,
      delivery:{
        hourUtc,
        label:`${String(hourUtc).padStart(2,'0')}:00 UTC`,
        timezone:'UTC',
        editable:false,
        executionWindow:`${String(hourUtc).padStart(2,'0')}:00–${String(hourUtc).padStart(2,'0')}:55 UTC`,
      },
      favoriteTeams,
      capabilities:{
        baseDigest:true,
        morningNews:true,
        favoritePriority:false,
        customDeliveryTime:false,
        planSpecificContent:normalizedPlan!=='FREE',
        smartRadarContext:normalizedPlan!=='FREE',
      },
      updatedAt:plainText(source.updated_at,80) || null,
    };
  }
  
  async function loadBotDigestSubscriptions(cfg) {
    if (hasSupabase(cfg)) {
      const page=await supaSelectPaged(cfg,'bot_digest_subscriptions',{enabled:'eq.true'},{
        pageSize:DAILY_DIGEST_POLICY.pageSize,
        maxRows:DAILY_DIGEST_POLICY.scanCap,
        order:'telegram_id.asc',
      });
      if (
        !page
        || typeof page!=='object'
        || Array.isArray(page)
        || !Array.isArray(page.rows)
        || typeof page.truncated!=='boolean'
        || page.rows.length>DAILY_DIGEST_POLICY.scanCap
      ) {
        throw new Error('Daily digest subscription pagination returned an invalid result.');
      }
      return {
        rows:page.rows.filter(row=>
          plainObject(row)
          && row.enabled===true
          && positiveSafeInteger(row.telegram_id)
          && telegramChatId(row.chat_id)
        ),
        truncated:page.truncated,
      };
    }
    return {
      rows:[...memory.botDigestSubscriptions.values()].filter(row=>
        row?.enabled===true
        && positiveSafeInteger(row?.telegram_id)
        && telegramChatId(row?.chat_id)
      ),
      truncated:false,
    };
  }
  
  async function claimDigestDelivery(row,date,cfg) {
    const telegramId=positiveSafeInteger(row?.telegram_id);
    const normalizedDate=deliveryDate(date);
    if (!telegramId || !normalizedDate) return false;
    if (hasSupabase(cfg)) {
      const claimed=(await supaRpc(cfg,'claim_daily_digest',{p_telegram_id:telegramId,p_delivery_date:normalizedDate,p_lease_seconds:DAILY_DIGEST_POLICY.claimLeaseSeconds},2500))===true;
      if (claimed) bumpTelemetry('digestDeliveryClaims'); else bumpTelemetry('digestDeliveryDuplicates');
      return claimed;
    }
    const current=memory.botDigestSubscriptions.get(telegramId) || row;
    const lockedUntil=Date.parse(String(current.delivery_locked_until || ''));
    const activeClaim=String(current.delivery_claim_date || '')===normalizedDate && Number.isFinite(lockedUntil) && lockedUntil>Date.now();
    if (String(current.last_sent_date || '')===normalizedDate || activeClaim) {
      bumpTelemetry('digestDeliveryDuplicates');
      return false;
    }
    memory.botDigestSubscriptions.set(telegramId,{
      ...current,
      delivery_claim_date:normalizedDate,
      delivery_claimed_at:new Date().toISOString(),
      delivery_locked_until:new Date(Date.now()+DAILY_DIGEST_POLICY.claimLeaseSeconds*1000).toISOString(),
    });
    bumpTelemetry('digestDeliveryClaims');
    return true;
  }
  
  function digestDeliverySealUntil(date) {
    const nextDay=new Date(`${String(date || '')}T00:00:00.000Z`);
    if (!Number.isFinite(nextDay.getTime())) return new Date(Date.now()+24*3600_000).toISOString();
    nextDay.setUTCDate(nextDay.getUTCDate()+1);
    return nextDay.toISOString();
  }
  
  async function armDigestDelivery(row,date,cfg) {
    const telegramId=positiveSafeInteger(row?.telegram_id);
    const normalizedDate=deliveryDate(date);
    if (!telegramId || !normalizedDate) return false;
    const lockedUntil=digestDeliverySealUntil(normalizedDate);
    if (hasSupabase(cfg)) {
      await supaPatch(cfg,'bot_digest_subscriptions',{
        telegram_id:`eq.${telegramId}`,
        delivery_claim_date:`eq.${normalizedDate}`,
      },{
        delivery_locked_until:lockedUntil,
        updated_at:new Date().toISOString(),
      });
      return true;
    }
    const current=memory.botDigestSubscriptions.get(telegramId) || row;
    if (String(current.delivery_claim_date || '')!==normalizedDate || String(current.last_sent_date || '')===normalizedDate) return false;
    memory.botDigestSubscriptions.set(telegramId,{...current,delivery_locked_until:lockedUntil});
    return true;
  }
  
  async function markDigestSent(row,date,cfg) {
    const telegramId=positiveSafeInteger(row?.telegram_id);
    const normalizedDate=deliveryDate(date);
    if (!telegramId || !normalizedDate) return false;
    if (hasSupabase(cfg)) {
      return (await supaRpc(cfg,'complete_daily_digest',{p_telegram_id:telegramId,p_delivery_date:normalizedDate},2500))===true;
    }
    const current=memory.botDigestSubscriptions.get(telegramId) || row;
    if (String(current.delivery_claim_date || '')!==normalizedDate) return false;
    memory.botDigestSubscriptions.set(telegramId,{
      ...current,
      last_sent_date:normalizedDate,
      delivery_claim_date:null,
      delivery_claimed_at:null,
      delivery_locked_until:null,
      updated_at:new Date().toISOString(),
    });
    return true;
  }
  
  async function releaseDigestDelivery(row,date,cfg) {
    const telegramId=positiveSafeInteger(row?.telegram_id);
    const normalizedDate=deliveryDate(date);
    if (!telegramId || !normalizedDate) return false;
    if (hasSupabase(cfg)) {
      return (await supaRpc(cfg,'release_daily_digest',{p_telegram_id:telegramId,p_delivery_date:normalizedDate},2500).catch(()=>false))===true;
    }
    const current=memory.botDigestSubscriptions.get(telegramId) || row;
    if (String(current.delivery_claim_date || '')!==normalizedDate || String(current.last_sent_date || '')===normalizedDate) return false;
    memory.botDigestSubscriptions.set(telegramId,{
      ...current,
      delivery_claim_date:null,
      delivery_claimed_at:null,
      delivery_locked_until:null,
    });
    return true;
  }
  
  function digestRowsFromMatchCache(matches = [], limit = 3) {
    return rowsOf(matches).map(raw=>{
      try {
        const match=plainObject(normalizeBotFixtureCard(raw));
        if (!match) return null;
        const fixtureId=positiveSafeInteger(match.fixtureId);
        if (!fixtureId) return null;
        const home=plainObject(match.home) || {};
        const away=plainObject(match.away) || {};
        const competition=plainObject(match.competition) || {};
        return {
          fixtureId,
          date:plainText(match.date,64),
          status:plainText(match.status,16),
          live:match.live===true,
          home:{
            id:positiveSafeInteger(home.id),
            name:plainText(home.name ?? match.homeName,120),
            logo:plainText(home.logo,500),
          },
          away:{
            id:positiveSafeInteger(away.id),
            name:plainText(away.name ?? match.awayName,120),
            logo:plainText(away.logo,500),
          },
          homeName:plainText(home.name ?? match.homeName,120),
          awayName:plainText(away.name ?? match.awayName,120),
          league:plainText(match.league,120) || 'Турнир',
          score:finiteMetric(match.interestScore) ?? 0,
          priority:finiteMetric(competition.priority) ?? 0,
          featured:match.featured===true,
        };
      } catch {
        return null;
      }
    }).filter(Boolean).sort((a,b) =>
      Number(b.live)-Number(a.live)
      || Number(b.featured)-Number(a.featured)
      || b.score-a.score
      || b.priority-a.priority
      || a.date.localeCompare(b.date)
    ).slice(0,boundedLimit(limit,3,20));
  }
  
  async function currentDailyDigest(cfg) {
    const date=todayUtc();
    const cacheKey=`bot:digest:${date}:v1`;
    const cached=await getCache(cacheKey,cfg);
    if (Array.isArray(cached?.rows)) return cached;
    try {
      const fixtures=await loadProviderFixturesForDate(date,cfg);
      const payload={date,rows:digestFixtureRows(fixtures),generatedAt:new Date().toISOString(),source:'provider',providerDegraded:false};
      await setCache(cacheKey,0,payload,cfg,10).catch(()=>null);
      return payload;
    } catch (error) {
      const matchCacheKey=`matches:${date}:v6-integrity`;
      const matchCache=await getCache(matchCacheKey,cfg).catch(()=>null)
        || await getStaleCache(matchCacheKey,cfg).catch(()=>null);
      const rows=digestRowsFromMatchCache(matchCache?.matches || [],3);
      if (rows.length) {
        return {
          date,
          rows,
          generatedAt:new Date().toISOString(),
          source:'matches_cache',
          providerDegraded:true,
          providerRateLimited:isFootballRateLimitError(error),
        };
      }
      throw error;
    }
  }
  
  async function loadBotDayMatches(cfg, { liveOnly = false, limit = 8 } = {}) {
    const date=todayUtc();
    const cached=await getCache(`matches:${date}:v6-integrity`,cfg).catch(()=>null);
    let matches=rowsOf(cached?.matches).map(match=>{
      try { return normalizeBotFixtureCard(match); } catch { return null; }
    }).filter(x=>positiveSafeInteger(x?.fixtureId));
    if (!matches.length && freeQuotaHealthy(8,1)) {
      const fixtures=await loadProviderFixturesForDate(date,cfg).catch(()=>[]);
      matches=digestFixtureRows(fixtures,20).map(match=>{
        try { return normalizeBotFixtureCard(match); } catch { return null; }
      }).filter(x=>positiveSafeInteger(x?.fixtureId));
    }
    if (liveOnly) matches=matches.filter(x=>x.live);
    matches.sort((a,b)=>Number(b.live)-Number(a.live) || Date.parse(a.date || 0)-Date.parse(b.date || 0));
    return matches.slice(0,boundedLimit(limit,8,12));
  }
  
  function botDayMatchesText(matches = [], { liveOnly = false } = {}) {
    const rows=rowsOf(matches);
    if (!rows.length) return liveOnly
      ? '🔴 Сейчас в доступных данных нет матчей в прямом эфире.'
      : '⚽ На сегодня подходящие матчи пока не найдены.';
    const title=liveOnly ? '🔴 <b>LIVE сейчас</b>' : '⚽ <b>Матчи сегодня</b>';
    return [title,'',...rows.map((m,i)=>`${i+1}. <b>${telegramHtmlEscape(m.homeName)} — ${telegramHtmlEscape(m.awayName)}</b>\n${telegramHtmlEscape(m.league || 'Турнир')} · ${m.live ? telegramHtmlEscape(m.statusLabel || 'идёт сейчас') : digestTime(m.date)}`),'','Нажмите на матч — сразу покажу короткую AI-оценку и кнопку полного разбора.'].join('\n');
  }
  
  async function sendBotDayMatches(request,cfg,chatId,{liveOnly=false}={}) {
    const matches=await loadBotDayMatches(cfg,{liveOnly,limit:8});
    await rememberBotFixtureCards(matches,cfg);
    const rows=matches.map(m=>[{text:`${m.live?'🔴':'⚽'} ${String(m.homeName || '').slice(0,20)} — ${String(m.awayName || '').slice(0,20)}`,callback_data:`match:menu:${Number(m.fixtureId)}`}]);
    if (!rows.length) rows.push([{text:'🔄 Обновить',callback_data:liveOnly?'feed:live':'feed:today'}]);
    await telegramApi('sendMessage',cfg,{chat_id:chatId,parse_mode:'HTML',text:botDayMatchesText(matches,{liveOnly}),reply_markup:{inline_keyboard:rows}});
  }
  
  async function botTeamIdMatches(teamId,cfg) {
    const id=positiveSafeInteger(teamId);
    if (!id) return [];
    const fromDate=new Date(); fromDate.setUTCDate(fromDate.getUTCDate()-7);
    const toDate=new Date(); toDate.setUTCDate(toDate.getUTCDate()+30);
    const from=fromDate.toISOString().slice(0,10), to=toDate.toISOString().slice(0,10);
    const cacheKey=`bot:team-id-matches:${id}:${from}:${to}:v1`;
    const cached=await getCache(cacheKey,cfg).catch(()=>null);
    if (Array.isArray(cached?.matches)) {
      return cached.matches.map(match=>{
        try { return normalizeBotFixtureCard(match); } catch { return null; }
      }).filter(match=>positiveSafeInteger(match?.fixtureId));
    }
    if (!freeQuotaHealthy(8,1)) return [];
    let fixtures=await apiFootball('/fixtures',{team:id,next:8},cfg).catch(()=>[]);
    if (!fixtures.length) fixtures=await apiFootball('/fixtures',{team:id,last:6},cfg).catch(()=>[]);
    const matches=rowsOf(fixtures).filter(f=>!CANCELLED_FIXTURE_STATUSES.has(String(f?.fixture?.status?.short||''))).map(f=>{
      try { return normalizeBotFixtureCard(f); } catch { return null; }
    }).filter(x=>positiveSafeInteger(x?.fixtureId))
      .sort((a,b)=>Number(b.live)-Number(a.live) || Number(a.finished)-Number(b.finished) || Date.parse(a.date||0)-Date.parse(b.date||0)).slice(0,6);
    await setCache(cacheKey,id,{matches,refreshedAt:new Date().toISOString()},cfg,120).catch(()=>null);
    await rememberBotFixtureCards(matches,cfg);
    return matches;
  }
  
  async function sendBotFavoriteTeams(request,cfg,userId,chatId) {
    const favorites=rowsOf(await getFavorites(userId,cfg));
    if (!favorites.length) {
      await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'⭐ <b>Мои команды пока пусты</b>\n\nОткройте любой матч и нажмите ☆ рядом с нужным клубом. После этого здесь появятся его ближайшие игры, а в MatchRadar AI · Новости — персональные новости.',parse_mode:'HTML',reply_markup:footballBotKeyboard(request)});
      return;
    }
    const rows=favorites.slice(0,12).map(x=>[{text:`⭐ ${String(x.team_name || 'Команда').slice(0,40)}`,callback_data:`favorite:team:${Number(x.team_id)}`}]);
    await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'⭐ Мои команды\n\nВыберите клуб — покажу его ближайшие матчи прямо в чате.',reply_markup:{inline_keyboard:rows}});
  }
  
  async function sendBotFavoriteTeamMatches(request,cfg,userId,chatId,teamId) {
    const id=positiveSafeInteger(teamId);
    if (!id) {
      await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'Команда не найдена в вашем избранном.'});
      return;
    }
    const favorites=rowsOf(await getFavorites(userId,cfg));
    const team=favorites.find(x=>positiveSafeInteger(x?.team_id)===id);
    if (!team) {
      await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'Команда не найдена в вашем избранном.'});
      return;
    }
    const matches=await botTeamIdMatches(id,cfg);
    const rows=matches.map(m=>[{text:botMatchButtonText(m),callback_data:`match:menu:${Number(m.fixtureId)}`}]);
    const body=matches.length
      ? matches.map((m,i)=>`${i+1}. <b>${telegramHtmlEscape(m.homeName)} — ${telegramHtmlEscape(m.awayName)}</b> · ${m.live?'LIVE':digestTime(m.date)}`).join('\n')
      : 'Ближайшие матчи сейчас не найдены или источник данных временно ограничен.';
    const buttons=rows.length?rows:[[{text:'🔄 Повторить',callback_data:`favorite:team:${id}`}]];
    buttons.push([{text:'📰 Новости клуба',callback_data:`news:team:${Number(teamId)}`}]);
    await telegramApi('sendMessage',cfg,{chat_id:chatId,parse_mode:'HTML',text:`⭐ <b>${telegramHtmlEscape(team.team_name || 'Команда')}</b>\n\n${body}`,reply_markup:{inline_keyboard:buttons}});
  }
  
  async function sendDailyPicks(request,cfg,chatId) {
    const digest=await currentDailyDigest(cfg);
    const digestRows=rowsOf(digest?.rows).filter(match=>positiveSafeInteger(match?.fixtureId));
    await rememberBotFixtureCards(digestRows,cfg);
    const rows=digestRows.map(match => [{
      text:`⚽ ${String(match.homeName || 'Хозяева').slice(0,20)} — ${String(match.awayName || 'Гости').slice(0,20)}`,
      callback_data:`match:menu:${Number(match.fixtureId)}`,
    }]);
    rows.push([{text:'⚽ Все матчи сегодня',callback_data:'feed:today'}]);
    await telegramApi('sendMessage',cfg,{
      chat_id:chatId, parse_mode:'HTML', text:dailyDigestText(digestRows),
      reply_markup:{inline_keyboard:rows},
    });
  }
  
  async function processDailyDigests(cfg,scheduledAt=new Date()) {
    if (!cfg?.botToken) return {sent:0,skipped:'bot_token_missing'};
    const scheduledDate=scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
    if (!Number.isFinite(scheduledDate.getTime())) return {sent:0,skipped:'invalid_schedule'};
    const startedAt=Date.now();
    const hour=scheduledDate.getUTCHours();
    const date=scheduledDate.toISOString().slice(0,10);
    const subscriptionPage=await loadBotDigestSubscriptions(cfg);
    const subscriptionRows=rowsOf(subscriptionPage?.rows);
    const plan=planDailyDigestRecipients(subscriptionRows,{
      date,
      hourUtc:hour,
      pageSize:DAILY_DIGEST_POLICY.pageSize,
      maxRecipients:DAILY_DIGEST_POLICY.maxRecipientsPerRun,
      truncated:Boolean(subscriptionPage?.truncated),
    });
  
    if (subscriptionPage?.truncated) {
      await recordOpsEvent(cfg,{
        severity:'warning',
        source:'telegram',
        eventType:'daily_digest',
        code:'DIGEST_SUBSCRIPTIONS_TRUNCATED',
        message:'Daily digest subscription scan reached the 10000-row safety cap.',
        endpoint:'cron:daily-digest',
        meta:{loaded:plan.scanned,eligible:plan.eligible,cap:DAILY_DIGEST_POLICY.scanCap,pages:plan.pages},
      }).catch(()=>null);
    }
  
    if (!plan.pending.length) {
      const summary={
        date,scanned:plan.scanned,pages:plan.pages,eligible:plan.eligible,claimed:0,sent:0,
        duplicate:plan.duplicate,activeClaims:plan.activeClaims,freshClaims:plan.freshClaims,
        sealedClaims:plan.sealedClaims,oldestActiveClaimAgeMs:plan.oldestActiveClaimAgeMs,
        expiredClaims:plan.expiredClaims,failed:0,rateLimited:0,deferred:0,remaining:0,backlog:0,
        truncated:Boolean(plan.truncated),duration:Date.now()-startedAt,
      };
      const health=assessDailyDigestRun(summary,scheduledDate);
      await recordOpsEvent(cfg,{
        severity:health.severity,
        source:'telegram',
        eventType:'daily_digest',
        code:plan.truncated?'DAILY_DIGEST_RUN_TRUNCATED':health.code,
        message:plan.truncated
          ? 'Daily digest run finished with a truncated subscription scan.'
          : health.reason==='sealed_claims'
            ? `Daily digest has ${summary.sealedClaims} sealed claim(s) requiring observation.`
            : 'Daily digest run completed with no pending recipients.',
        endpoint:'cron:daily-digest',
        meta:{...summary,health},
      }).catch(()=>null);
      return summary;
    }
  
    // Shared provider-backed payloads are resolved once per cron invocation, never
    // once per recipient/page. Main digest data is required, while morning news is
    // optional and must not block the primary delivery path.
    let digest;
    try {
      digest=await currentDailyDigest(cfg);
    } catch (error) {
      const summary={
        date,
        scanned:plan.scanned,
        pages:plan.pages,
        eligible:plan.eligible,
        claimed:0,
        sent:0,
        duplicate:plan.duplicate,
        activeClaims:plan.activeClaims,
        freshClaims:plan.freshClaims,
        sealedClaims:plan.sealedClaims,
        oldestActiveClaimAgeMs:plan.oldestActiveClaimAgeMs,
        expiredClaims:plan.expiredClaims,
        failed:0,
        rateLimited:isFootballRateLimitError(error) ? 1 : 0,
        providerDegraded:true,
        payloadUnavailable:true,
        deferred:plan.pending.length,
        remaining:plan.pending.length,
        backlog:plan.pending.length,
        truncated:Boolean(plan.truncated),
        completionRate:null,
        duration:Date.now()-startedAt,
      };
      const health=assessDailyDigestRun(summary,scheduledDate);
      await recordOpsEvent(cfg,{
        severity:'warning',
        source:'telegram',
        eventType:'daily_digest',
        code:'DAILY_DIGEST_RUN_DEGRADED',
        message:isFootballRateLimitError(error)
          ? 'Daily digest payload unavailable because API-Football is rate limited; recipients remain pending for the next cron slot.'
          : 'Daily digest payload unavailable; recipients remain pending for the next cron slot.',
        endpoint:'cron:daily-digest',
        meta:{...summary,health,payloadSource:'unavailable',retryable:true},
      }).catch(()=>null);
      return summary;
    }
  
    const morningNews=await currentMorningFootballNews(cfg).catch(()=>({
      date,
      items:[],
      generatedAt:new Date().toISOString(),
      degraded:true,
    }));
    const digestRows=rowsOf(digest?.rows).filter(match=>positiveSafeInteger(match?.fixtureId));
    const morningNewsItems=rowsOf(morningNews?.items);
    const matchButtons=digestRows.slice(0,3).map(match=>[{
      text:`⚽ ${String(match.homeName || '').slice(0,18)} — ${String(match.awayName || '').slice(0,18)}`,
      callback_data:`match:menu:${Number(match.fixtureId)}`,
    }]);
    matchButtons.push([{text:'⚽ Все матчи сегодня',callback_data:'feed:today'}]);
    const digestText=dailyDigestText(digestRows);
    let expandedDigestText=digestText;
    let expandedDigestRecipientIds=new Set();
    let expandedDigestMatches=0;
    try {
      const paidDigestAudience=await filterSmartNotificationRecipients(rowsOf(plan?.pending),'ai.digest_expanded',cfg);
      expandedDigestRecipientIds=new Set(rowsOf(paidDigestAudience?.rows).map(row=>positiveSafeInteger(row?.telegram_id)).filter(Boolean));
      if (expandedDigestRecipientIds.size) {
        const radarEntries=await Promise.all(digestRows.slice(0,3).map(async match=>{
          const fixtureId=Number(match?.fixtureId || 0);
          if (!fixtureId) return [0,null];
          const snapshots=await getAnalysisTimelineSnapshots(fixtureId,cfg,10).catch(()=>[]);
          const state=radarStrongSignalState(snapshots,{
            confidenceThreshold:SMART_NOTIFICATION_POLICY.radarConfidenceThreshold,
            outcomeThreshold:SMART_NOTIFICATION_POLICY.radarOutcomeThreshold,
            maxSignalAgeMinutes:SMART_NOTIFICATION_POLICY.maxSignalAgeMinutes,
            now:scheduledDate.getTime(),
          });
          return [fixtureId,state];
        }));
        const radarByFixture=new Map(radarEntries.filter(([fixtureId,state])=>fixtureId && state?.reason==='evaluated'));
        expandedDigestMatches=radarByFixture.size;
        expandedDigestText=expandedDailyDigestText(digestRows,radarByFixture);
      }
    } catch (error) {
      await recordOpsEvent(cfg,{
        severity:'warning',
        source:'smart_notifications',
        eventType:'expanded_digest',
        code:'EXPANDED_DIGEST_CONTEXT_UNAVAILABLE',
        message:error?.message || error,
        endpoint:'cron:daily-digest',
        meta:{date},
      }).catch(()=>null);
    }
    const newsText=morningNewsItems.length ? morningNewsText(morningNewsItems) : '';
    const newsKeyboard=morningNewsItems.length
      ? newsConversionKeyboard(morningNewsItems,[[{text:'📰 Новости MatchRadar AI',callback_data:'news:general'}]])
      : null;
  
    const result=await runBoundedDailyDigest({
      plan,
      date,
      claim:(row,deliveryDate)=>claimDigestDelivery(row,deliveryDate,cfg),
      arm:(row,deliveryDate)=>armDigestDelivery(row,deliveryDate,cfg),
      release:(row,deliveryDate)=>releaseDigestDelivery(row,deliveryDate,cfg),
      complete:(row,deliveryDate)=>markDigestSent(row,deliveryDate,cfg),
      sendDigest:row=>telegramApi('sendMessage',cfg,{
        chat_id:Number(row.chat_id),
        parse_mode:'HTML',
        text:expandedDigestRecipientIds.has(Number(row?.telegram_id || 0)) ? expandedDigestText : digestText,
        reply_markup:{inline_keyboard:matchButtons},
      }),
      sendNews:newsText
        ? row=>telegramApi('sendMessage',cfg,{
            chat_id:Number(row.chat_id),
            parse_mode:'HTML',
            text:newsText,
            reply_markup:newsKeyboard,
            disable_web_page_preview:true,
          })
        : null,
      sleep:sleepMs,
      maxRecipients:DAILY_DIGEST_POLICY.maxRecipientsPerRun,
      concurrency:DAILY_DIGEST_POLICY.concurrency,
      minSendIntervalMs:DAILY_DIGEST_POLICY.minSendIntervalMs,
      executionBudgetMs:DAILY_DIGEST_POLICY.executionBudgetMs,
    });
  
    const summary={
      ...result,
      date,
      freshClaims:plan.freshClaims,
      sealedClaims:plan.sealedClaims,
      oldestActiveClaimAgeMs:plan.oldestActiveClaimAgeMs,
      expiredClaims:plan.expiredClaims,
      news:morningNewsItems.length,
      newsDegraded:Boolean(morningNews.degraded),
      expandedDigestRecipients:expandedDigestRecipientIds.size,
      expandedDigestMatches,
      providerDegraded:Boolean(digest.providerDegraded),
      providerRateLimited:Boolean(digest.providerRateLimited),
      payloadSource:String(digest.source || 'provider'),
      completionRate:result.claimed>0 ? Number((result.sent/result.claimed).toFixed(4)) : 1,
      duration:Date.now()-startedAt,
    };
    const health=assessDailyDigestRun(summary,scheduledDate);
    await recordOpsEvent(cfg,{
      severity:health.severity,
      source:'telegram',
      eventType:'daily_digest',
      code:health.code,
      message:health.reason==='late_backlog'
        ? `Daily digest late backlog: ${summary.remaining} recipient(s) remain near the end of the delivery window.`
        : health.reason==='sealed_claims'
          ? `Daily digest has ${summary.sealedClaims} sealed claim(s); oldest active claim age ${summary.oldestActiveClaimAgeMs}ms.`
          : health.reason==='claim_recovery'
            ? `Daily digest recovered ${summary.recoveredClaims} expired claim(s).`
            : `Daily digest: sent ${summary.sent}/${summary.eligible}, deferred ${summary.deferred}, failed ${summary.failed}.`,
      endpoint:'cron:daily-digest',
      meta:{...summary,health},
    }).catch(()=>null);
    return summary;
  }

  return Object.freeze({
    sendDigestControls,
    digestFixtureRows,
    digestTime,
    dailyDigestText,
    expandedDailyDigestText,
    getBotDigestSubscription,
    setBotDigestSubscription,
    publicDigestSettings,
    loadBotDigestSubscriptions,
    claimDigestDelivery,
    digestDeliverySealUntil,
    armDigestDelivery,
    markDigestSent,
    releaseDigestDelivery,
    digestRowsFromMatchCache,
    currentDailyDigest,
    loadBotDayMatches,
    botDayMatchesText,
    sendBotDayMatches,
    botTeamIdMatches,
    sendBotFavoriteTeams,
    sendBotFavoriteTeamMatches,
    sendDailyPicks,
    processDailyDigests
  });
}
