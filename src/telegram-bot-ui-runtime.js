export function createTelegramBotUiRuntime(deps = {}) {
  if (!deps || typeof deps!=='object' || Array.isArray(deps)) {
    throw new TypeError('Telegram bot UI runtime dependencies are required.');
  }
  const {
    apiAnalyze,
    botAiHandoffText,
    createRequest,
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

  const requiredFunctions={
    apiAnalyze,
    botAiHandoffText,
    createRequest,
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
    telegramWebAppUrl,
  };
  for (const [name,fn] of Object.entries(requiredFunctions)) {
    if (typeof fn!=='function') throw new TypeError(`${name} is required`);
  }

  function objectValue(value) {
    return value && typeof value==='object' && !Array.isArray(value)
      ? value
      : null;
  }

  function safeText(value,max=240,fallback='') {
    if (!['string','number','bigint'].includes(typeof value)) return fallback;
    try {
      const text=String(value)
        .normalize('NFKC')
        .replace(/[\u0000-\u001F\u007F]/g,' ')
        .replace(/\s+/g,' ')
        .trim()
        .slice(0,max);
      return text || fallback;
    } catch {
      return fallback;
    }
  }

  function finiteNumber(value) {
    if (typeof value==='number') return Number.isFinite(value) ? value : null;
    if (typeof value!=='string') return null;
    const raw=value.trim();
    if (!/^-?(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function positiveSafeInteger(value) {
    const number=finiteNumber(value);
    return number!==null && Number.isSafeInteger(number) && number>0
      ? number
      : null;
  }

  function nonNegativeSafeInteger(value,max=Number.MAX_SAFE_INTEGER) {
    const number=finiteNumber(value);
    return number!==null
      && Number.isSafeInteger(number)
      && number>=0
      && number<=max
      ? number
      : null;
  }

  function chatIdValue(value) {
    const number=finiteNumber(value);
    return number!==null && Number.isSafeInteger(number) && number!==0
      ? number
      : null;
  }

  function rowsOrEmpty(value,limit=500) {
    return Array.isArray(value) ? value.slice(0,limit) : [];
  }

  function safePredicate(fn,...args) {
    try { return fn(...args)===true; }
    catch { return false; }
  }

  async function optionalAsync(fn,...args) {
    try { return await fn(...args); }
    catch { return null; }
  }

  function backgroundCall(fn,...args) {
    try {
      Promise.resolve(fn(...args)).catch(()=>{});
    } catch {}
  }

  function escapeHtml(value,max=1200) {
    const text=safeText(value,max);
    try {
      return String(telegramHtmlEscape(text));
    } catch {
      return text
        .replaceAll('&','&amp;')
        .replaceAll('<','&lt;')
        .replaceAll('>','&gt;')
        .replaceAll('"','&quot;');
    }
  }

  function requestUrl(request) {
    const raw=safeText(request?.url,2000);
    if (!raw) return null;
    try {
      const url=new URL(raw);
      if (!['http:','https:'].includes(url.protocol)) return null;
      if (url.username || url.password) return null;
      return url;
    } catch {
      return null;
    }
  }

  function sameOriginWebAppUrl(request,value) {
    const base=requestUrl(request);
    const raw=safeText(value,2000);
    if (!base || !raw) return '';
    try {
      const url=new URL(raw);
      if (!['http:','https:'].includes(url.protocol)) return '';
      if (url.username || url.password || url.origin!==base.origin) return '';
      return url.toString();
    } catch {
      return '';
    }
  }

  function generatedWebAppUrl(request,factory,...args) {
    try {
      return sameOriginWebAppUrl(request,factory(request,...args));
    } catch {
      return '';
    }
  }

  function safeStatusLabel(status,elapsed) {
    try {
      return safeText(statusLabel(status,elapsed),120,safeText(status,24));
    } catch {
      return safeText(status,24);
    }
  }

  function safeTeam(value,fallbackName='Команда') {
    const source=objectValue(value) || {};
    return {
      id:positiveSafeInteger(source.id) || 0,
      name:safeText(source.name,120,fallbackName),
      logo:sameOriginOrHttpsAsset(source.logo),
    };
  }

  function sameOriginOrHttpsAsset(value) {
    const raw=safeText(value,1000);
    if (!raw) return '';
    try {
      const url=new URL(raw);
      return url.protocol==='https:' && !url.username && !url.password
        ? url.toString().slice(0,1000)
        : '';
    } catch {
      return '';
    }
  }

  function publicSiteUrl(request,pathname='/') {
    const url=requestUrl(request);
    if (!url) throw new TypeError('Некорректный URL Telegram-запроса.');
    const rawPath=safeText(pathname,400,'/');
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawPath)) {
      throw new TypeError('Некорректный путь публичного сайта.');
    }
    url.pathname=rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    url.search='';
    url.hash='';
    return url.toString();
  }

  function footballBotKeyboard(_request) {
    return {
      keyboard:[
        [{text:'⚽ Матчи'},{text:'🔎 Найти матч'}],
        [{text:'🔴 LIVE'},{text:'⭐ Мои команды'}],
        [{text:'🤖 AI-подборка'},{text:'••• Ещё'}],
      ],
      resize_keyboard:true,
      is_persistent:true,
      input_field_placeholder:'Команда, матч или вопрос…',
    };
  }

  function footballBotMoreKeyboard(_request) {
    return {
      keyboard:[
        [{text:'🕘 Последний разбор'},{text:'📰 Новости'}],
        [{text:'📈 Протокол AI'},{text:'☀️ Утренняя подборка'}],
        [{text:'ℹ️ Как это работает'},{text:'← Главное меню'}],
      ],
      resize_keyboard:true,
      is_persistent:true,
    };
  }

  function favoriteTeamIdSet(rows=[]) {
    const ids=new Set();
    for (const row of rowsOrEmpty(rows,500)) {
      const source=objectValue(row);
      const id=positiveSafeInteger(source?.team_id ?? source?.teamId);
      if (id!==null) ids.add(id);
    }
    return ids;
  }

  function favoriteMatchTeamRow(match={},favorites=[]) {
    const fixtureId=positiveSafeInteger(objectValue(match)?.fixtureId);
    if (fixtureId===null) return [];

    const fav=favoriteTeamIdSet(favorites);
    const teams=[
      safeTeam(objectValue(match)?.home,'Хозяева'),
      safeTeam(objectValue(match)?.away,'Гости'),
    ].filter(team=>team.id>0 && team.name);

    const seen=new Set();
    return teams
      .filter(team=>{
        if (seen.has(team.id)) return false;
        seen.add(team.id);
        return true;
      })
      .map(team=>({
        text:`${fav.has(team.id)?'★':'☆'} ${safeText(team.name,22,'Команда')}`,
        callback_data:`favorite:toggle:${team.id}:${fixtureId}`,
      }));
  }

  function centerUrl(request,fixtureId) {
    return generatedWebAppUrl(
      request,
      telegramWebAppUrl,
      {fixtureId,action:'center'},
    );
  }

  function fullAnalysisUrl(request,fixtureId) {
    return generatedWebAppUrl(
      request,
      telegramFullAnalysisUrl,
      fixtureId,
      'brief',
    );
  }

  function trustedSearchUrl(request,searchUrl) {
    return sameOriginWebAppUrl(request,searchUrl);
  }

  function footballMatchActionKeyboard(
    request,
    match={},
    searchUrl='',
    favorites=[],
  ) {
    const source=objectValue(match) || {};
    const fixtureId=positiveSafeInteger(source.fixtureId);
    if (fixtureId===null) return footballBotKeyboard(request);

    const favoriteRow=favoriteMatchTeamRow(source,favorites);
    const finished=source.finished===true;
    const live=!finished && source.live===true;
    const search=trustedSearchUrl(request,searchUrl);
    const center=centerUrl(request,fixtureId);
    const full=fullAnalysisUrl(request,fixtureId);
    const rows=[];

    if (favoriteRow.length) rows.push(favoriteRow);

    if (live || finished) {
      if (finished) {
        const row=[
          {text:'🧠 Итог AI',callback_data:`match:review:${fixtureId}`},
        ];
        if (center) {
          row.push({
            text:'📋 Центр матча',
            web_app:{url:center},
          });
        }
        rows.push(row);
      } else if (center) {
        rows.push([{
          text:'🔴 Открыть LIVE-центр',
          web_app:{url:center},
        }]);
      }

      rows.push([{
        text:'↗ Поделиться матчем',
        callback_data:`match:share:${fixtureId}`,
      }]);
      if (search) {
        rows.push([{
          text:'🔎 Вернуться к поиску',
          web_app:{url:search},
        }]);
      }
      return {inline_keyboard:rows};
    }

    rows.push(
      [
        {text:'🧠 AI-вердикт',callback_data:`match:verdict:${fixtureId}`},
        {text:'🧑‍⚖️ Судья',callback_data:`match:referee:${fixtureId}`},
      ],
      [
        {text:'👥 Составы и потери',callback_data:`match:squads:${fixtureId}`},
        {text:'💹 Рынок и риски',callback_data:`match:market:${fixtureId}`},
      ],
    );

    const refreshRow=[
      {text:'🔄 Обновить AI',callback_data:`match:refresh:${fixtureId}`},
    ];
    if (full) {
      refreshRow.push({
        text:'📊 Полный AI-разбор',
        web_app:{url:full},
      });
    }
    rows.push(refreshRow);
    rows.push([{
      text:'↗ Поделиться матчем',
      callback_data:`match:share:${fixtureId}`,
    }]);

    if (search) {
      rows.push([{
        text:'🔎 Другие результаты',
        web_app:{url:search},
      }]);
    }
    return {inline_keyboard:rows};
  }

  function footballQuickAiHandoffKeyboard(
    request,
    match={},
    favorites=[],
    searchUrl='',
  ) {
    const source=objectValue(match) || {};
    const fixtureId=positiveSafeInteger(source.fixtureId);
    if (fixtureId===null) return footballBotKeyboard(request);

    const rows=[];
    const full=fullAnalysisUrl(request,fixtureId);
    if (full) {
      rows.push([{
        text:'📊 Полный AI-разбор',
        web_app:{url:full},
      }]);
    }

    const favoriteRow=favoriteMatchTeamRow(source,favorites);
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
      [{
        text:'↗ Поделиться матчем',
        callback_data:`match:share:${fixtureId}`,
      }],
    );

    const search=trustedSearchUrl(request,searchUrl);
    if (search) {
      rows.push([{
        text:'🔎 Другие результаты',
        web_app:{url:search},
      }]);
    }
    return {inline_keyboard:rows};
  }

  function footballSearchHandoffKeyboard(request,match={},searchUrl='') {
    const source=objectValue(match) || {};
    const fixtureId=positiveSafeInteger(source.fixtureId);
    if (fixtureId===null) return footballBotKeyboard(request);

    if (source.live===true || source.finished===true) {
      return footballMatchActionKeyboard(request,source,searchUrl,[]);
    }

    const selection=objectValue(source.selection);
    const label=selection?.primary===true
      ? '⭐ Короткая AI-оценка'
      : '🧠 Короткая AI-оценка';
    const rows=[[
      {text:label,callback_data:`match:menu:${fixtureId}`},
    ]];

    const full=fullAnalysisUrl(request,fixtureId);
    if (full) {
      rows.push([{
        text:'📊 Сразу полный AI-разбор',
        web_app:{url:full},
      }]);
    }

    const search=trustedSearchUrl(request,searchUrl);
    if (search) {
      rows.push([{
        text:'🔎 Другие результаты',
        web_app:{url:search},
      }]);
    }
    return {inline_keyboard:rows};
  }

  function normalizeBotFixtureCard(match={}) {
    const source=objectValue(match) || {};
    const fixture=objectValue(source.fixture) || {};
    const fixtureStatus=objectValue(fixture.status) || {};
    const teams=objectValue(source.teams) || {};
    const leagueSource=objectValue(source.league);

    const fixtureId=positiveSafeInteger(source.fixtureId ?? fixture.id) || 0;
    const status=safeText(source.status ?? fixtureStatus.short,24);
    const statusLive=safePredicate(isLiveStatus,status);
    const statusFinished=safePredicate(isFinishedStatus,status);
    const finished=statusFinished || (!statusLive && source.finished===true);
    const live=!finished && (statusLive || source.live===true);

    const homeSource=objectValue(source.home)
      || objectValue(teams.home)
      || {};
    const awaySource=objectValue(source.away)
      || objectValue(teams.away)
      || {};
    const home=safeTeam({
      ...homeSource,
      name:safeText(homeSource.name ?? source.homeName,120,'Хозяева'),
    },'Хозяева');
    const away=safeTeam({
      ...awaySource,
      name:safeText(awaySource.name ?? source.awayName,120,'Гости'),
    },'Гости');

    const elapsed=nonNegativeSafeInteger(
      source.elapsed ?? fixtureStatus.elapsed,
      300,
    );
    const league=safeText(
      leagueSource?.name
        ?? (typeof source.league==='string' ? source.league : '')
        ?? source.leagueShort,
      160,
      'Турнир',
    );

    return {
      fixtureId,
      date:safeText(source.date ?? fixture.date,80),
      status,
      statusLabel:safeText(
        source.statusLabel,
        120,
        safeStatusLabel(status,elapsed),
      ),
      live,
      finished,
      elapsed,
      home,
      away,
      homeName:home.name,
      awayName:away.name,
      league,
      leagueId:positiveSafeInteger(
        source.leagueId ?? leagueSource?.id,
      ) || 0,
      country:safeText(
        source.country ?? leagueSource?.country,
        120,
      ),
      round:safeText(
        source.roundLabel ?? source.round ?? leagueSource?.round,
        120,
      ),
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
