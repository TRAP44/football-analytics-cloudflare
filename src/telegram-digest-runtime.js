export function createTelegramDigestRuntime(deps = {}) {
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
    return (fixtures || []).filter(f => {
      const status = String(f.fixture?.status?.short || '');
      const home = String(f.teams?.home?.name || '');
      const away = String(f.teams?.away?.name || '');
      return !['CANC','PST','ABD','AWD','WO'].includes(status) && !isYouthReserveMatch(f.league?.name || '', home, away);
    }).map(f => {
      const leagueId = Number(f.league?.id || 0);
      const homeName = f.teams?.home?.name || '';
      const awayName = f.teams?.away?.name || '';
      const competition = normalizeCompetition(leagueId, f.league?.name || '', f.league?.country || '', homeName, awayName);
      const status = String(f.fixture?.status?.short || '');
      return {
        fixtureId:Number(f.fixture?.id || 0), date:f.fixture?.date || '', status, live:isLiveStatus(status),
        home:{id:Number(f.teams?.home?.id || 0),name:homeName,logo:String(f.teams?.home?.logo || '')},
        away:{id:Number(f.teams?.away?.id || 0),name:awayName,logo:String(f.teams?.away?.logo || '')},
        homeName, awayName, league:competition.shortName || competition.name || f.league?.name || 'Турнир',
        score:matchInterestScore({ competition, leagueId, leagueName:f.league?.name || '', country:f.league?.country || '', homeName, awayName, status, date:f.fixture?.date || '' }),
        priority:Number(competition.priority || 0), featured:Boolean(competition.featured),
      };
    }).filter(x => x.fixtureId)
      .sort((a,b) => Number(b.live)-Number(a.live) || Number(b.featured)-Number(a.featured) || b.score-a.score || b.priority-a.priority || String(a.date).localeCompare(String(b.date)))
      .slice(0, Math.max(1, Math.min(20, Number(limit || 3))));
  }
  
  function digestTime(iso) {
    const d = new Date(iso || '');
    if (!Number.isFinite(d.getTime())) return '—';
    return new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(d) + ' UTC';
  }
  
  function dailyDigestText(rows = []) {
    if (!rows.length) return '⚽ Сегодня пока нет подходящих матчей для короткой AI-подборки.';
    return ['🧠 <b>3 матча дня · AI-подборка</b>','',...rows.map((x,i)=>`${i+1}. <b>${x.homeName} — ${x.awayName}</b>\n${x.league} · ${x.live ? '🔴 идёт сейчас' : digestTime(x.date)}`),'','Нажмите на матч — короткая AI-оценка придёт сразу в Telegram. Полный разбор откроется одним нажатием.'].join('\n');
  }
  
  function expandedDailyDigestText(rows = [], radarByFixture = new Map()) {
    const base=dailyDigestText(rows);
    const radarLines=(rows || []).slice(0,3).map(match=>{
      const state=radarByFixture.get(Number(match?.fixtureId || 0));
      if (!state || state.reason!=='evaluated' || !state.latest || !state.strongest) return '';
      const sideName=state.strongest.side==='home'
        ? String(match?.homeName || 'Хозяева')
        : state.strongest.side==='away'
          ? String(match?.awayName || 'Гости')
          : 'Ничья';
      const confidence=Number(state.latest.confidence);
      return `• <b>${telegramHtmlEscape(match?.homeName || 'Хозяева')} — ${telegramHtmlEscape(match?.awayName || 'Гости')}</b>: ${telegramHtmlEscape(sideName)} ${Number(state.strongest.probability || 0).toFixed(1)}%${Number.isFinite(confidence) ? ` · Radar ${Math.round(confidence)}/100` : ''}`;
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
    const telegramId=Number(userId || 0);
    if (!telegramId) return null;
    if (hasSupabase(cfg)) {
      return await supaSelectOne(cfg,'bot_digest_subscriptions',{telegram_id:`eq.${telegramId}`});
    }
    return memory.botDigestSubscriptions.get(telegramId) || null;
  }
  
  async function setBotDigestSubscription(userId, chatId, enabled, cfg, appUrl = '') {
    markTelegramWebhookMutation(cfg, 'digest_subscription');
    const telegramId=Number(userId || 0);
    const previous=await getBotDigestSubscription(telegramId,cfg);
    const row = {
      telegram_id:telegramId,
      chat_id:Number(previous?.chat_id || chatId || telegramId),
      enabled:Boolean(enabled),
      hour_utc:DAILY_DIGEST_POLICY.deliveryHourUtc,
      app_url:String(appUrl || previous?.app_url || '').slice(0,500),
      updated_at:new Date().toISOString(),
    };
    if (hasSupabase(cfg)) await supaUpsert(cfg,'bot_digest_subscriptions',row,'telegram_id');
    else memory.botDigestSubscriptions.set(telegramId,{...previous,...row,last_sent_date:previous?.last_sent_date || null});
    return {...previous,...row};
  }
  
  function publicDigestSettings(row = null, plan = 'FREE', favorites = []) {
    const hourUtc=DAILY_DIGEST_POLICY.deliveryHourUtc;
    const normalizedPlan=['FREE','PRO','PREMIUM'].includes(String(plan || '').toUpperCase())
      ? String(plan).toUpperCase()
      : 'FREE';
    return {
      enabled:row?.enabled === true,
      configured:Boolean(row?.telegram_id),
      plan:normalizedPlan,
      delivery:{
        hourUtc,
        label:`${String(hourUtc).padStart(2,'0')}:00 UTC`,
        timezone:'UTC',
        editable:false,
        executionWindow:`${String(hourUtc).padStart(2,'0')}:00–${String(hourUtc).padStart(2,'0')}:55 UTC`,
      },
      favoriteTeams:(favorites || []).map(item=>({
        teamId:Number(item.team_id || item.teamId || 0),
        teamName:String(item.team_name || item.teamName || '').slice(0,80),
      })).filter(item=>item.teamId && item.teamName).slice(0,6),
      capabilities:{
        baseDigest:true,
        morningNews:true,
        favoritePriority:false,
        customDeliveryTime:false,
        planSpecificContent:normalizedPlan!=='FREE',
        smartRadarContext:normalizedPlan!=='FREE',
      },
      updatedAt:row?.updated_at || null,
    };
  }
  
  async function loadBotDigestSubscriptions(cfg) {
    if (hasSupabase(cfg)) {
      return await supaSelectPaged(cfg,'bot_digest_subscriptions',{enabled:'eq.true'},{
        pageSize:500,
        maxRows:10000,
        order:'telegram_id.asc',
      });
    }
    return {
      rows:[...memory.botDigestSubscriptions.values()].filter(x=>x.enabled),
      truncated:false,
    };
  }
  
  async function claimDigestDelivery(row,date,cfg) {
    if (hasSupabase(cfg)) {
      const claimed=Boolean(await supaRpc(cfg,'claim_daily_digest',{p_telegram_id:Number(row.telegram_id),p_delivery_date:date,p_lease_seconds:DAILY_DIGEST_POLICY.claimLeaseSeconds},2500));
      if (claimed) bumpTelemetry('digestDeliveryClaims'); else bumpTelemetry('digestDeliveryDuplicates');
      return claimed;
    }
    const current=memory.botDigestSubscriptions.get(Number(row.telegram_id)) || row;
    const lockedUntil=Date.parse(String(current.delivery_locked_until || ''));
    const activeClaim=String(current.delivery_claim_date || '')===date && Number.isFinite(lockedUntil) && lockedUntil>Date.now();
    if (String(current.last_sent_date || '')===date || activeClaim) {
      bumpTelemetry('digestDeliveryDuplicates');
      return false;
    }
    memory.botDigestSubscriptions.set(Number(row.telegram_id),{
      ...current,
      delivery_claim_date:date,
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
    const lockedUntil=digestDeliverySealUntil(date);
    if (hasSupabase(cfg)) {
      await supaPatch(cfg,'bot_digest_subscriptions',{
        telegram_id:`eq.${Number(row.telegram_id)}`,
        delivery_claim_date:`eq.${date}`,
      },{
        delivery_locked_until:lockedUntil,
        updated_at:new Date().toISOString(),
      });
      return true;
    }
    const current=memory.botDigestSubscriptions.get(Number(row.telegram_id)) || row;
    if (String(current.delivery_claim_date || '')!==date || String(current.last_sent_date || '')===date) return false;
    memory.botDigestSubscriptions.set(Number(row.telegram_id),{...current,delivery_locked_until:lockedUntil});
    return true;
  }
  
  async function markDigestSent(row, date, cfg) {
    if (hasSupabase(cfg)) return await supaRpc(cfg,'complete_daily_digest',{p_telegram_id:Number(row.telegram_id),p_delivery_date:date},2500);
    memory.botDigestSubscriptions.set(Number(row.telegram_id),{...row,last_sent_date:date,delivery_claim_date:null,delivery_locked_until:null,updated_at:new Date().toISOString()});
  }
  
  async function releaseDigestDelivery(row,date,cfg) {
    if (hasSupabase(cfg)) return await supaRpc(cfg,'release_daily_digest',{p_telegram_id:Number(row.telegram_id),p_delivery_date:date},2500).catch(()=>false);
    const current=memory.botDigestSubscriptions.get(Number(row.telegram_id)) || row;
    memory.botDigestSubscriptions.set(Number(row.telegram_id),{...current,delivery_claim_date:null,delivery_locked_until:null});
    return true;
  }
  
  function digestRowsFromMatchCache(matches = [], limit = 3) {
    return (matches || []).map(normalizeBotFixtureCard).filter(match => match.fixtureId).map(match => ({
      fixtureId:Number(match.fixtureId || 0),
      date:String(match.date || ''),
      status:String(match.status || ''),
      live:Boolean(match.live),
      home:{id:Number(match.home?.id || 0),name:String(match.home?.name || match.homeName || ''),logo:String(match.home?.logo || '')},
      away:{id:Number(match.away?.id || 0),name:String(match.away?.name || match.awayName || ''),logo:String(match.away?.logo || '')},
      homeName:String(match.home?.name || match.homeName || ''),
      awayName:String(match.away?.name || match.awayName || ''),
      league:String(match.league || 'Турнир'),
      score:Number(match.interestScore || 0),
      priority:Number(match.competition?.priority || 0),
      featured:Boolean(match.featured),
    })).sort((a,b) =>
      Number(b.live)-Number(a.live)
      || Number(b.featured)-Number(a.featured)
      || b.score-a.score
      || b.priority-a.priority
      || String(a.date).localeCompare(String(b.date))
    ).slice(0,Math.max(1,Math.min(20,Number(limit || 3))));
  }
  
  async function currentDailyDigest(cfg) {
    const date=todayUtc();
    const cacheKey=`bot:digest:${date}:v1`;
    const cached=await getCache(cacheKey,cfg);
    if (cached?.rows) return cached;
    try {
      const fixtures=await loadProviderFixturesForDate(date,cfg);
      const payload={date,rows:digestFixtureRows(fixtures),generatedAt:new Date().toISOString(),source:'provider',providerDegraded:false};
      await setCache(cacheKey,0,payload,cfg,10);
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
    let matches=(cached?.matches || []).map(normalizeBotFixtureCard).filter(x=>x.fixtureId);
    if (!matches.length && freeQuotaHealthy(8,1)) {
      const fixtures=await loadProviderFixturesForDate(date,cfg).catch(()=>[]);
      matches=digestFixtureRows(fixtures,20).map(normalizeBotFixtureCard).filter(x=>x.fixtureId);
    }
    if (liveOnly) matches=matches.filter(x=>x.live);
    matches.sort((a,b)=>Number(b.live)-Number(a.live) || Date.parse(a.date || 0)-Date.parse(b.date || 0));
    return matches.slice(0,Math.max(1,Math.min(12,Number(limit || 8))));
  }
  
  function botDayMatchesText(matches = [], { liveOnly = false } = {}) {
    if (!matches.length) return liveOnly
      ? '🔴 Сейчас в доступных данных нет матчей в прямом эфире.'
      : '⚽ На сегодня подходящие матчи пока не найдены.';
    const title=liveOnly ? '🔴 <b>LIVE сейчас</b>' : '⚽ <b>Матчи сегодня</b>';
    return [title,'',...matches.map((m,i)=>`${i+1}. <b>${telegramHtmlEscape(m.homeName)} — ${telegramHtmlEscape(m.awayName)}</b>\n${telegramHtmlEscape(m.league || 'Турнир')} · ${m.live ? telegramHtmlEscape(m.statusLabel || 'идёт сейчас') : digestTime(m.date)}`),'','Нажмите на матч — сразу покажу короткую AI-оценку и кнопку полного разбора.'].join('\n');
  }
  
  async function sendBotDayMatches(request,cfg,chatId,{liveOnly=false}={}) {
    const matches=await loadBotDayMatches(cfg,{liveOnly,limit:8});
    await rememberBotFixtureCards(matches,cfg);
    const rows=matches.map(m=>[{text:`${m.live?'🔴':'⚽'} ${String(m.homeName || '').slice(0,20)} — ${String(m.awayName || '').slice(0,20)}`,callback_data:`match:menu:${Number(m.fixtureId)}`}]);
    if (!rows.length) rows.push([{text:'🔄 Обновить',callback_data:liveOnly?'feed:live':'feed:today'}]);
    await telegramApi('sendMessage',cfg,{chat_id:chatId,parse_mode:'HTML',text:botDayMatchesText(matches,{liveOnly}),reply_markup:{inline_keyboard:rows}});
  }
  
  async function botTeamIdMatches(teamId,cfg) {
    const id=Number(teamId || 0);
    if (!id) return [];
    const fromDate=new Date(); fromDate.setUTCDate(fromDate.getUTCDate()-7);
    const toDate=new Date(); toDate.setUTCDate(toDate.getUTCDate()+30);
    const from=fromDate.toISOString().slice(0,10), to=toDate.toISOString().slice(0,10);
    const cacheKey=`bot:team-id-matches:${id}:${from}:${to}:v1`;
    const cached=await getCache(cacheKey,cfg).catch(()=>null);
    if (cached?.matches) return cached.matches.map(normalizeBotFixtureCard);
    if (!freeQuotaHealthy(8,1)) return [];
    let fixtures=await apiFootball('/fixtures',{team:id,next:8},cfg).catch(()=>[]);
    if (!fixtures.length) fixtures=await apiFootball('/fixtures',{team:id,last:6},cfg).catch(()=>[]);
    const matches=(fixtures || []).filter(f=>!['CANC','PST','ABD','AWD','WO'].includes(String(f.fixture?.status?.short||''))).map(f=>normalizeBotFixtureCard(f)).filter(x=>x.fixtureId)
      .sort((a,b)=>Number(b.live)-Number(a.live) || Number(a.finished)-Number(b.finished) || Date.parse(a.date||0)-Date.parse(b.date||0)).slice(0,6);
    await setCache(cacheKey,id,{matches,refreshedAt:new Date().toISOString()},cfg,120).catch(()=>null);
    await rememberBotFixtureCards(matches,cfg);
    return matches;
  }
  
  async function sendBotFavoriteTeams(request,cfg,userId,chatId) {
    const favorites=await getFavorites(userId,cfg);
    if (!favorites.length) {
      await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'⭐ <b>Мои команды пока пусты</b>\n\nОткройте любой матч и нажмите ☆ рядом с нужным клубом. После этого здесь появятся его ближайшие игры, а в MatchRadar AI · Новости — персональные новости.',parse_mode:'HTML',reply_markup:footballBotKeyboard(request)});
      return;
    }
    const rows=favorites.slice(0,12).map(x=>[{text:`⭐ ${String(x.team_name || 'Команда').slice(0,40)}`,callback_data:`favorite:team:${Number(x.team_id)}`}]);
    await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'⭐ Мои команды\n\nВыберите клуб — покажу его ближайшие матчи прямо в чате.',reply_markup:{inline_keyboard:rows}});
  }
  
  async function sendBotFavoriteTeamMatches(request,cfg,userId,chatId,teamId) {
    const favorites=await getFavorites(userId,cfg);
    const team=favorites.find(x=>Number(x.team_id)===Number(teamId));
    if (!team) {
      await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'Команда не найдена в вашем избранном.'});
      return;
    }
    const matches=await botTeamIdMatches(teamId,cfg);
    const rows=matches.map(m=>[{text:botMatchButtonText(m),callback_data:`match:menu:${Number(m.fixtureId)}`}]);
    const body=matches.length
      ? matches.map((m,i)=>`${i+1}. <b>${telegramHtmlEscape(m.homeName)} — ${telegramHtmlEscape(m.awayName)}</b> · ${m.live?'LIVE':digestTime(m.date)}`).join('\n')
      : 'Ближайшие матчи сейчас не найдены или источник данных временно ограничен.';
    const buttons=rows.length?rows:[[{text:'🔄 Повторить',callback_data:`favorite:team:${Number(teamId)}`}]];
    buttons.push([{text:'📰 Новости клуба',callback_data:`news:team:${Number(teamId)}`}]);
    await telegramApi('sendMessage',cfg,{chat_id:chatId,parse_mode:'HTML',text:`⭐ <b>${telegramHtmlEscape(team.team_name || 'Команда')}</b>\n\n${body}`,reply_markup:{inline_keyboard:buttons}});
  }
  
  async function sendDailyPicks(request,cfg,chatId) {
    const digest=await currentDailyDigest(cfg);
    await rememberBotFixtureCards(digest.rows || [], cfg);
    const rows=(digest.rows || []).map(match => [{
      text:`⚽ ${String(match.homeName || 'Хозяева').slice(0,20)} — ${String(match.awayName || 'Гости').slice(0,20)}`,
      callback_data:`match:menu:${Number(match.fixtureId)}`,
    }]);
    rows.push([{text:'⚽ Все матчи сегодня',callback_data:'feed:today'}]);
    await telegramApi('sendMessage',cfg,{
      chat_id:chatId, parse_mode:'HTML', text:dailyDigestText(digest.rows),
      reply_markup:{inline_keyboard:rows},
    });
  }
  
  async function processDailyDigests(cfg,scheduledAt=new Date()) {
    if (!cfg.botToken) return {sent:0,skipped:'bot_token_missing'};
    const startedAt=Date.now();
    const hour=scheduledAt.getUTCHours();
    const date=scheduledAt.toISOString().slice(0,10);
    const subscriptionPage=await loadBotDigestSubscriptions(cfg);
    const plan=planDailyDigestRecipients(subscriptionPage.rows || [],{
      date,
      hourUtc:hour,
      pageSize:DAILY_DIGEST_POLICY.pageSize,
      maxRecipients:DAILY_DIGEST_POLICY.maxRecipientsPerRun,
      truncated:Boolean(subscriptionPage.truncated),
    });
  
    if (subscriptionPage.truncated) {
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
      const health=assessDailyDigestRun(summary,scheduledAt);
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
      const health=assessDailyDigestRun(summary,scheduledAt);
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
    const matchButtons=(digest.rows || []).slice(0,3).map(match=>[{
      text:`⚽ ${String(match.homeName || '').slice(0,18)} — ${String(match.awayName || '').slice(0,18)}`,
      callback_data:`match:menu:${Number(match.fixtureId)}`,
    }]);
    matchButtons.push([{text:'⚽ Все матчи сегодня',callback_data:'feed:today'}]);
    const digestText=dailyDigestText(digest.rows);
    let expandedDigestText=digestText;
    let expandedDigestRecipientIds=new Set();
    let expandedDigestMatches=0;
    try {
      const paidDigestAudience=await filterSmartNotificationRecipients(plan.pending || [],'ai.digest_expanded',cfg);
      expandedDigestRecipientIds=new Set((paidDigestAudience?.rows || []).map(row=>Number(row?.telegram_id || 0)).filter(Boolean));
      if (expandedDigestRecipientIds.size) {
        const radarEntries=await Promise.all((digest.rows || []).slice(0,3).map(async match=>{
          const fixtureId=Number(match?.fixtureId || 0);
          if (!fixtureId) return [0,null];
          const snapshots=await getAnalysisTimelineSnapshots(fixtureId,cfg,10).catch(()=>[]);
          const state=radarStrongSignalState(snapshots,{
            confidenceThreshold:SMART_NOTIFICATION_POLICY.radarConfidenceThreshold,
            outcomeThreshold:SMART_NOTIFICATION_POLICY.radarOutcomeThreshold,
            maxSignalAgeMinutes:SMART_NOTIFICATION_POLICY.maxSignalAgeMinutes,
            now:scheduledAt.getTime(),
          });
          return [fixtureId,state];
        }));
        const radarByFixture=new Map(radarEntries.filter(([fixtureId,state])=>fixtureId && state?.reason==='evaluated'));
        expandedDigestMatches=radarByFixture.size;
        expandedDigestText=expandedDailyDigestText(digest.rows,radarByFixture);
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
    const newsText=morningNews.items?.length ? morningNewsText(morningNews.items) : '';
    const newsKeyboard=morningNews.items?.length
      ? newsConversionKeyboard(morningNews.items,[[{text:'📰 Новости MatchRadar AI',callback_data:'news:general'}]])
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
      news:Number(morningNews.items?.length || 0),
      newsDegraded:Boolean(morningNews.degraded),
      expandedDigestRecipients:expandedDigestRecipientIds.size,
      expandedDigestMatches,
      providerDegraded:Boolean(digest.providerDegraded),
      providerRateLimited:Boolean(digest.providerRateLimited),
      payloadSource:String(digest.source || 'provider'),
      completionRate:result.claimed>0 ? Number((result.sent/result.claimed).toFixed(4)) : 1,
      duration:Date.now()-startedAt,
    };
    const health=assessDailyDigestRun(summary,scheduledAt);
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

  return {
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
  };
}
