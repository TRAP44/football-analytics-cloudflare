export function createTelegramBotUiRuntime(deps = {}) {
  const {
    apiAnalyze,
    botAiHandoffText,
    freeQuotaHealthy,
    getCache,
    getFavorites,
    isFinishedStatus,
    isLiveStatus,
    loadProviderFixture,
    markTelegramWebhookMutation,
    newsImpactDecisionCard,
    newsImpactDecisionKeyboard,
    recordGrowthEvent,
    setCache,
    statusLabel,
    telegramApi,
    telegramFullAnalysisUrl,
    telegramHtmlEscape,
    telegramWebAppUrl
  } = deps;

  function publicSiteUrl(request, pathname = '/') {
    const url=new URL(request.url);
    url.pathname=pathname.startsWith('/') ? pathname : `/${pathname}`;
    url.search='';
    url.hash='';
    return url.toString();
  }
  
  function footballBotKeyboard(request) {
    return {
      keyboard: [
        [{ text: '⚽ Матчи' }, { text: '🔎 Найти матч' }],
        [{ text: '🔴 LIVE' }, { text: '⭐ Мои команды' }],
        [{ text: '🤖 AI-подборка' }, { text: '••• Ещё' }],
      ],
      resize_keyboard: true,
      is_persistent: true,
      input_field_placeholder: 'Команда, матч или вопрос…',
    };
  }
  
  function footballBotMoreKeyboard(request) {
    return {
      keyboard: [
        [{ text: '🕘 Последний разбор' }, { text: '📰 Новости' }],
        [{ text: '📈 Протокол AI' }, { text: '☀️ Утренняя подборка' }],
        [{ text: 'ℹ️ Как это работает' }, { text: '← Главное меню' }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    };
  }
  
  function favoriteTeamIdSet(rows = []) {
    return new Set((rows || []).map(x=>Number(x.team_id || x.teamId || 0)).filter(Boolean));
  }
  
  function favoriteMatchTeamRow(match = {}, favorites = []) {
    const fav=favoriteTeamIdSet(favorites);
    const fixtureId=Number(match?.fixtureId || 0);
    const teams=[match?.home,match?.away].filter(x=>Number(x?.id || 0)>0 && x?.name);
    if (!teams.length) return [];
    return teams.map(team=>({
      text:`${fav.has(Number(team.id))?'★':'☆'} ${String(team.name || 'Команда').slice(0,22)}`,
      callback_data:`favorite:toggle:${Number(team.id)}:${fixtureId}`,
    }));
  }
  
  function footballMatchActionKeyboard(request, match = {}, searchUrl = '', favorites = []) {
    const fixtureId = Number(match?.fixtureId || 0);
    if (!fixtureId) return footballBotKeyboard(request);
    const favoriteRow=favoriteMatchTeamRow(match,favorites);
    if (match?.live || match?.finished) {
      const rows = [];
      if (favoriteRow.length) rows.push(favoriteRow);
      if (match.finished) rows.push([
        { text: '🧠 Итог AI', callback_data: `match:review:${fixtureId}` },
        { text: '📋 Центр матча', web_app: { url: telegramWebAppUrl(request, { fixtureId, action: 'center' }) } },
      ]);
      else rows.push([{ text: '🔴 Открыть LIVE-центр', web_app: { url: telegramWebAppUrl(request, { fixtureId, action: 'center' }) } }]);
      rows.push([{text:'↗ Поделиться матчем',callback_data:`match:share:${fixtureId}`}]);
      if (searchUrl) rows.push([{ text: '🔎 Вернуться к поиску', web_app: { url: searchUrl } }]);
      return { inline_keyboard: rows };
    }
    const rows = [];
    if (favoriteRow.length) rows.push(favoriteRow);
    rows.push(
      [
        { text: '🧠 AI-вердикт', callback_data: `match:verdict:${fixtureId}` },
        { text: '🧑‍⚖️ Судья', callback_data: `match:referee:${fixtureId}` },
      ],
      [
        { text: '👥 Составы и потери', callback_data: `match:squads:${fixtureId}` },
        { text: '💹 Рынок и риски', callback_data: `match:market:${fixtureId}` },
      ],
      [
        { text: '🔄 Обновить AI', callback_data: `match:refresh:${fixtureId}` },
        { text: '📊 Полный AI-разбор', web_app: { url: telegramFullAnalysisUrl(request, fixtureId, 'brief') } },
      ],
      [{text:'↗ Поделиться матчем',callback_data:`match:share:${fixtureId}`}],
    );
    if (searchUrl) rows.push([{ text: '🔎 Другие результаты', web_app: { url: searchUrl } }]);
    return { inline_keyboard: rows };
  }
  
  function footballQuickAiHandoffKeyboard(request, match = {}, favorites = [], searchUrl = '') {
    const fixtureId=Number(match?.fixtureId || 0);
    if (!fixtureId) return footballBotKeyboard(request);
    const rows=[[{text:'📊 Полный AI-разбор',web_app:{url:telegramFullAnalysisUrl(request,fixtureId,'brief')}}]];
    const favoriteRow=favoriteMatchTeamRow(match,favorites);
    if (favoriteRow.length) rows.push(favoriteRow);
    rows.push(
      [
        {text:'🧑‍⚖️ Судья',callback_data:`match:referee:${fixtureId}`},
        {text:'👥 Составы',callback_data:`match:squads:${fixtureId}`},
      ],
      [
        {text:'💹 Рынок и риски',callback_data:`match:market:${fixtureId}`},
        {text:'🔄 Обновить AI',callback_data:`match:refresh:${fixtureId}`},
      ],
      [{text:'↗ Поделиться матчем',callback_data:`match:share:${fixtureId}`}],
    );
    if (searchUrl) rows.push([{text:'🔎 Другие результаты',web_app:{url:searchUrl}}]);
    return {inline_keyboard:rows};
  }
  
  function footballSearchHandoffKeyboard(request, match = {}, searchUrl = '') {
    const fixtureId=Number(match?.fixtureId || 0);
    if (!fixtureId) return footballBotKeyboard(request);
    if (match?.live || match?.finished) return footballMatchActionKeyboard(request,match,searchUrl,[]);
    const label=match?.selection?.primary ? '⭐ Короткая AI-оценка' : '🧠 Короткая AI-оценка';
    const rows=[
      [{text:label,callback_data:`match:menu:${fixtureId}`}],
      [{text:'📊 Сразу полный AI-разбор',web_app:{url:telegramFullAnalysisUrl(request,fixtureId,'brief')}}],
    ];
    if (searchUrl) rows.push([{text:'🔎 Другие результаты',web_app:{url:searchUrl}}]);
    return {inline_keyboard:rows};
  }
  
  function normalizeBotFixtureCard(match = {}) {
    const fixtureId = Number(match?.fixtureId || match?.fixture?.id || 0);
    const status = String(match?.status || match?.fixture?.status?.short || '');
    const homeSource=match?.home || match?.teams?.home || {};
    const awaySource=match?.away || match?.teams?.away || {};
    const homeName = String(homeSource?.name || match?.homeName || 'Хозяева');
    const awayName = String(awaySource?.name || match?.awayName || 'Гости');
    const leagueSource=match?.league;
    const league = String((typeof leagueSource==='object' ? leagueSource?.name : leagueSource) || match?.leagueShort || 'Турнир');
    return {
      fixtureId,
      date:String(match?.date || match?.fixture?.date || ''),
      status,
      statusLabel:String(match?.statusLabel || statusLabel(status, match?.fixture?.status?.elapsed)),
      live:Boolean(match?.live) || isLiveStatus(status),
      finished:Boolean(match?.finished) || isFinishedStatus(status),
      elapsed:Number(match?.elapsed || match?.fixture?.status?.elapsed || 0) || null,
      home:{id:Number(homeSource?.id || 0),name:homeName,logo:String(homeSource?.logo || '')},
      away:{id:Number(awaySource?.id || 0),name:awayName,logo:String(awaySource?.logo || '')},
      homeName,
      awayName,
      league,
      leagueId:Number(match?.leagueId || (typeof leagueSource==='object' ? leagueSource?.id : 0) || 0),
      country:String(match?.country || (typeof leagueSource==='object' ? leagueSource?.country : '') || ''),
      round:String(match?.roundLabel || match?.round || (typeof leagueSource==='object' ? leagueSource?.round : '') || ''),
    };
  }
  
  async function rememberBotFixtureCards(matches = [], cfg) {
    await Promise.allSettled((matches || []).map(async match => {
      const card = normalizeBotFixtureCard(match);
      if (!card.fixtureId) return;
      const writes=[setCache(`bot:fixture-card:${card.fixtureId}:v2`, card.fixtureId, { match:card, savedAt:new Date().toISOString() }, cfg, 180)];
      for (const team of [card.home,card.away]) {
        if (Number(team?.id || 0)>0 && team?.name) writes.push(setCache(`bot:team-card:${Number(team.id)}:v1`,Number(team.id),{team,savedAt:new Date().toISOString()},cfg,720));
      }
      await Promise.allSettled(writes);
    }));
  }
  
  async function loadBotTeamCard(teamId,cfg) {
    const id=Number(teamId || 0);
    if (!id) return null;
    const cached=await getCache(`bot:team-card:${id}:v1`,cfg).catch(()=>null);
    if (cached?.team?.name) return cached.team;
    return null;
  }
  
  async function loadBotFixtureCard(fixtureId, cfg) {
    const id = Number(fixtureId || 0);
    if (!id) return null;
    const saved = await getCache(`bot:fixture-card:${id}:v2`, cfg).catch(()=>null);
    if (saved?.match) return normalizeBotFixtureCard(saved.match);
    const analyzed = await getCache(`fixture:${id}:v10-ai-instructor`, cfg).catch(()=>null);
    if (analyzed?.match) {
      const card=normalizeBotFixtureCard(analyzed.match);
      await rememberBotFixtureCards([card],cfg);
      return card;
    }
    if (!freeQuotaHealthy(6,1)) return { fixtureId:id, home:{id:0,name:'Матч',logo:''}, away:{id:0,name:String(id),logo:''}, homeName:'Матч', awayName:String(id), league:'Футбол', live:false, finished:false };
    const fixture = await loadProviderFixture(id,cfg).catch(()=>null);
    if (!fixture) return null;
    const card = normalizeBotFixtureCard(fixture);
    await rememberBotFixtureCards([card], cfg);
    return card;
  }
  
  function botFixtureDateTime(iso = '') {
    const d=new Date(iso || '');
    if (!Number.isFinite(d.getTime())) return 'время уточняется';
    return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(d)+' UTC';
  }
  
  function botFixtureCardText(match = {}, { aiReady=false } = {}) {
    const card = normalizeBotFixtureCard(match);
    const status = card.live ? `🔴 ${card.statusLabel || 'Матч идёт'}` : card.finished ? '✅ Матч завершён' : `🗓 ${botFixtureDateTime(card.date)}`;
    const round=card.round ? ` · ${telegramHtmlEscape(card.round)}` : '';
    const aiState=card.finished ? '📋 Доступен центр матча' : aiReady ? '🧠 AI-разбор уже сохранён' : '🧠 AI готов собрать полный разбор';
    return [
      '⚽ <b>MatchRadar AI · MATCH</b>',
      '',
      `<b>${telegramHtmlEscape(card.homeName)} — ${telegramHtmlEscape(card.awayName)}</b>`,
      `${telegramHtmlEscape(card.league)}${round}`,
      telegramHtmlEscape(status),
      `<i>${telegramHtmlEscape(aiState)}</i>`,
      '',
      'Выберите нужный блок. ☆/★ добавляет клуб в «Мои команды».',
    ].join('\n');
  }
  
  async function botAnalyzeFixtureDefault(request,cfg,userId,fixtureId) {
    const data=await botAnalyzeFixture(request,cfg,userId,fixtureId);
    return data;
  }
  
  async function sendBotFixtureMenu(request, cfg, userId, chatId, fixtureId, options = {}) {
    void recordGrowthEvent(cfg,{userId,eventName:'match_open',channel:'telegram',fixtureId,attribution:options.attribution || null,metadata:{source:options.source || 'match_select'}});
    const [match,favorites] = await Promise.all([
      loadBotFixtureCard(fixtureId,cfg),
      getFavorites(userId,cfg).catch(()=>[]),
    ]);
    if (!match) {
      await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'Матч больше не найден в доступных данных.',reply_markup:footballBotKeyboard(request)});
      return;
    }
    await rememberBotFixtureCards([match],cfg);
    if (match.live || match.finished) {
      const analysis=await getCache(`fixture:${Number(fixtureId)}:v10-ai-instructor`,cfg).catch(()=>null);
      await telegramApi('sendMessage',cfg,{
        chat_id:chatId,
        parse_mode:'HTML',
        text:botFixtureCardText(match,{aiReady:Boolean(analysis)}),
        reply_markup:footballMatchActionKeyboard(request,match,'',favorites),
      });
      return;
    }
    try {
      markTelegramWebhookMutation(cfg, 'analysis_quota_or_history');
      const data=options.newsImpactDelta
        ? await botAnalyzeFixture(request,cfg,userId,fixtureId,{
            newsImpactRecheck:true,
            newsPublishedAt:options.newsPublishedAt || '',
          })
        : await botAnalyzeFixtureDefault(request,cfg,userId,fixtureId);
      const analyzedMatch=normalizeBotFixtureCard(data.match || match);
      await rememberBotFixtureCards([analyzedMatch],cfg);
      void recordGrowthEvent(cfg,{userId,eventName:'quick_ai',channel:'telegram',fixtureId,attribution:options.attribution || null,metadata:{section:'handoff',cached:Boolean(data.cached),source:options.source || 'match_select'}});
      if (options.newsImpactDelta) {
        const decision=newsImpactDecisionCard(data?.newsImpact || null);
        void recordGrowthEvent(cfg,{userId,eventName:'news_impact_delta',channel:'telegram',fixtureId,metadata:{
          compared:Boolean(data?.newsImpact?.compared),
          material:Boolean(data?.newsImpact?.material),
          stable:Boolean(data?.newsImpact?.stable),
          reason:String(data?.newsImpact?.reasonCode || '').slice(0,32),
          decision:String(decision?.code || '').slice(0,24),
          changeCount:Number(data?.newsImpact?.items?.length || 0),
        }});
      }
      if (options.attribution) {
        void recordGrowthEvent(cfg,{userId,eventName:'ai_handoff',channel:'telegram',fixtureId,attribution:options.attribution,metadata:{cached:Boolean(data.cached),source:options.source || 'deep_link'}});
      } else {
        void recordGrowthEvent(cfg,{userId,eventName:'ai_handoff',channel:'telegram',fixtureId,metadata:{cached:Boolean(data.cached),source:'match_select'}});
      }
      await telegramApi('sendMessage',cfg,{
        chat_id:chatId,
        parse_mode:'HTML',
        text:botAiHandoffText(data),
        reply_markup:options.newsImpactDelta
          ? newsImpactDecisionKeyboard(request,analyzedMatch,favorites,data?.newsImpact || null)
          : footballQuickAiHandoffKeyboard(request,analyzedMatch,favorites),
      });
    } catch (error) {
      const status=Number(error?.status || 0);
      const message=status===429
        ? 'Короткий AI-разбор сейчас недоступен из-за лимита. Матч выбран — можно повторить позже.'
        : status===409
          ? 'Данные матча сейчас противоречивы, поэтому AI временно не строит вывод.'
          : error?.message || 'Не удалось собрать короткую AI-оценку.';
      await telegramApi('sendMessage',cfg,{
        chat_id:chatId,
        parse_mode:'HTML',
        text:`⚠️ ${telegramHtmlEscape(message)}\n\n${botFixtureCardText(match,{aiReady:false})}`,
        reply_markup:footballMatchActionKeyboard(request,match,'',favorites),
      });
    }
  }
  async function botAnalyzeFixture(request, cfg, userId, fixtureId, options = {}) {
    const inner = options.newsImpactRecheck
      ? new Request(request.url, {
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({
            fixtureId:Number(fixtureId),
            origin:'telegram_quick',
            recheck:true,
            newsImpactRecheck:true,
            newsPublishedAt:String(options.newsPublishedAt || '').slice(0,40),
          }),
        })
      : new Request(request.url, {
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({fixtureId:Number(fixtureId),origin:'telegram_quick',recheck:true}),
        });
    const response = await apiAnalyze(inner, cfg, { id:Number(userId) });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload?.error || 'Не удалось получить AI-разбор матча.');
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }
  
  function botAiVerdictText(data = {}) {
    const match = data.match || {};
    const ai = data.aiInstructor || {};
    const signal = ai.betSignal || {};
    const verdict = ai.verdict || {};
    const trust = ai.dataTrust || {};
    const referee = ai.refereeHistory?.available
      ? `${ai.refereeHistory.name || ai.refereeProfile?.name || match.referee || 'Судья'} · ${ai.refereeHistory.styleLabel} · ${ai.refereeHistory.avgYellow} жёлт./матч`
      : ai.refereeProfile?.name || ai.referee || match.referee || 'ещё не назначен';
    const skip = signal.code === 'skip';
    const headline = skip ? '⛔ <b>Лучше пропустить</b>' : '🧠 <b>AI-вердикт</b>';
    const confidence = Number.isFinite(Number(ai.confidenceScore)) ? `${Math.round(Number(ai.confidenceScore))}/100` : '—';
    const trustScore = Number.isFinite(Number(trust.score)) ? `${Math.round(Number(trust.score))}%` : '—';
    return [
      headline,
      `<b>${telegramHtmlEscape(match.home?.name || 'Хозяева')} — ${telegramHtmlEscape(match.away?.name || 'Гости')}</b>`,
      '',
      `🎯 Идея: <b>${telegramHtmlEscape(signal.label || 'Нет выраженного сигнала')}</b>`,
      `📊 Исход: ${telegramHtmlEscape(verdict.outcome || '—')}`,
      `⚽ Тотал: ${telegramHtmlEscape(verdict.total || '—')}`,
      `🥅 Обе забьют: ${telegramHtmlEscape(verdict.btts || '—')}`,
      `🧠 Уверенность: <b>${telegramHtmlEscape(ai.confidenceLabel || '—')}</b> · ${confidence}`,
      `🗂 Качество данных: <b>${telegramHtmlEscape(trust.label || '—')}</b> · ${trustScore}`,
      `⚠️ Риск: <b>${telegramHtmlEscape(ai.riskLabel || '—')}</b>`,
      `🧑‍⚖️ Судья: ${telegramHtmlEscape(referee)}`,
      '',
      `Почему: ${telegramHtmlEscape(signal.reason || ai.riskNote || 'Оцениваю доступные данные матча.')}`,
      skip ? 'Сильного перевеса нет — не нужно искать ставку любой ценой.' : 'Перед стартом ещё раз проверьте составы и движение рынка.',
      '',
      '<i>AI-сигнал основан на доступных данных и не гарантирует результат.</i>',
    ].join('\n');
  }

  return {
    publicSiteUrl,
    footballBotKeyboard,
    footballBotMoreKeyboard,
    favoriteTeamIdSet,
    favoriteMatchTeamRow,
    footballMatchActionKeyboard,
    footballQuickAiHandoffKeyboard,
    footballSearchHandoffKeyboard,
    normalizeBotFixtureCard,
    rememberBotFixtureCards,
    loadBotTeamCard,
    loadBotFixtureCard,
    botFixtureDateTime,
    botFixtureCardText,
    botAnalyzeFixtureDefault,
    sendBotFixtureMenu,
    botAnalyzeFixture,
    botAiVerdictText
  };
}
