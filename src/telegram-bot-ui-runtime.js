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

  function safeMessageText(value,max=3900,fallback='') {
    if (typeof value!=='string') return fallback;
    try {
      const text=value
        .normalize('NFKC')
        .replace(/\r\n?/g,'\n')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,' ')
        .trim()
        .slice(0,max);
      return text || fallback;
    } catch {
      return fallback;
    }
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
        || (typeof source.league==='string' ? source.league : '')
        || source.leagueShort,
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

  async function rememberBotFixtureCards(matches=[],cfg) {
    const tasks=[];
    for (const match of rowsOrEmpty(matches,100)) {
      const card=normalizeBotFixtureCard(match);
      if (!card.fixtureId) continue;

      const savedAt=new Date().toISOString();
      tasks.push(optionalAsync(
        setCache,
        `bot:fixture-card:${card.fixtureId}:v2`,
        card.fixtureId,
        {match:card,savedAt},
        cfg,
        180,
      ));

      for (const team of [card.home,card.away]) {
        if (!team.id || !team.name) continue;
        tasks.push(optionalAsync(
          setCache,
          `bot:team-card:${team.id}:v1`,
          team.id,
          {team,savedAt},
          cfg,
          720,
        ));
      }
    }
    await Promise.allSettled(tasks);
  }

  async function loadBotTeamCard(teamId,cfg) {
    const id=positiveSafeInteger(teamId);
    if (id===null) return null;

    const cached=objectValue(
      await optionalAsync(getCache,`bot:team-card:${id}:v1`,cfg),
    );
    const team=safeTeam(cached?.team,'');
    if (team.id!==id || !team.name) return null;
    return team;
  }

  function fallbackFixtureCard(id) {
    return {
      fixtureId:id,
      date:'',
      status:'',
      statusLabel:'',
      live:false,
      finished:false,
      elapsed:null,
      home:{id:0,name:'Матч',logo:''},
      away:{id:0,name:String(id),logo:''},
      homeName:'Матч',
      awayName:String(id),
      league:'Футбол',
      leagueId:0,
      country:'',
      round:'',
    };
  }

  async function loadBotFixtureCard(fixtureId,cfg) {
    const id=positiveSafeInteger(fixtureId);
    if (id===null) return null;

    const saved=objectValue(
      await optionalAsync(getCache,`bot:fixture-card:${id}:v2`,cfg),
    );
    if (objectValue(saved?.match)) {
      const card=normalizeBotFixtureCard(saved.match);
      if (card.fixtureId===id) return card;
    }

    const analyzed=objectValue(
      await optionalAsync(getCache,`fixture:${id}:v10-ai-instructor`,cfg),
    );
    if (objectValue(analyzed?.match)) {
      const card=normalizeBotFixtureCard(analyzed.match);
      if (card.fixtureId===id) {
        await rememberBotFixtureCards([card],cfg);
        return card;
      }
    }

    if (!safePredicate(freeQuotaHealthy,6,1)) {
      return fallbackFixtureCard(id);
    }

    const fixture=objectValue(
      await optionalAsync(loadProviderFixture,id,cfg),
    );
    if (!fixture) return null;

    const card=normalizeBotFixtureCard(fixture);
    if (card.fixtureId!==id) return null;
    await rememberBotFixtureCards([card],cfg);
    return card;
  }

  function botFixtureDateTime(iso='') {
    const raw=safeText(iso,80);
    if (!raw) return 'время уточняется';
    const d=new Date(raw);
    if (!Number.isFinite(d.getTime())) return 'время уточняется';
    try {
      return new Intl.DateTimeFormat('ru-RU',{
        day:'2-digit',
        month:'2-digit',
        hour:'2-digit',
        minute:'2-digit',
        timeZone:'UTC',
      }).format(d)+' UTC';
    } catch {
      return 'время уточняется';
    }
  }

  function botFixtureCardText(match={},options={}) {
    const card=normalizeBotFixtureCard(match);
    const opts=objectValue(options) || {};
    const aiReady=opts.aiReady===true;
    const status=card.live
      ? `🔴 ${card.statusLabel || 'Матч идёт'}`
      : card.finished
        ? '✅ Матч завершён'
        : `🗓 ${botFixtureDateTime(card.date)}`;
    const round=card.round ? ` · ${escapeHtml(card.round,120)}` : '';
    const aiState=card.finished
      ? '📋 Доступен центр матча'
      : aiReady
        ? '🧠 AI-разбор уже сохранён'
        : '🧠 AI готов собрать полный разбор';

    return [
      '⚽ <b>MatchRadar AI · MATCH</b>',
      '',
      `<b>${escapeHtml(card.homeName,120)} — ${escapeHtml(card.awayName,120)}</b>`,
      `${escapeHtml(card.league,160)}${round}`,
      escapeHtml(status,160),
      `<i>${escapeHtml(aiState,180)}</i>`,
      '',
      'Выберите нужный блок. ☆/★ добавляет клуб в «Мои команды».',
    ].join('\n');
  }

  async function botAnalyzeFixtureDefault(request,cfg,userId,fixtureId) {
    return await botAnalyzeFixture(request,cfg,userId,fixtureId);
  }

  async function sendBotFixtureMenu(
    request,
    cfg,
    userId,
    chatId,
    fixtureId,
    options={},
  ) {
    const user=positiveSafeInteger(userId);
    const chat=chatIdValue(chatId);
    const id=positiveSafeInteger(fixtureId);
    if (user===null || chat===null || id===null) {
      throw new TypeError('Некорректный Telegram user/chat/fixture ID.');
    }

    const opts=objectValue(options) || {};
    const attribution=objectValue(opts.attribution);
    const source=safeText(opts.source,48,'match_select');

    backgroundCall(recordGrowthEvent,cfg,{
      userId:user,
      eventName:'match_open',
      channel:'telegram',
      fixtureId:id,
      attribution,
      metadata:{source},
    });

    const [match,favoriteRows]=await Promise.all([
      loadBotFixtureCard(id,cfg),
      optionalAsync(getFavorites,user,cfg),
    ]);
    const favorites=rowsOrEmpty(favoriteRows,500);

    if (!match) {
      await telegramApi('sendMessage',cfg,{
        chat_id:chat,
        text:'Матч больше не найден в доступных данных.',
        reply_markup:footballBotKeyboard(request),
      });
      return false;
    }

    await rememberBotFixtureCards([match],cfg);

    if (match.live || match.finished) {
      const analysis=objectValue(
        await optionalAsync(
          getCache,
          `fixture:${id}:v10-ai-instructor`,
          cfg,
        ),
      );
      const analysisMatch=objectValue(analysis?.match)
        ? normalizeBotFixtureCard(analysis.match)
        : null;
      const aiReady=Boolean(
        analysis
        && (!analysisMatch || analysisMatch.fixtureId===id),
      );

      await telegramApi('sendMessage',cfg,{
        chat_id:chat,
        parse_mode:'HTML',
        text:botFixtureCardText(match,{aiReady}),
        reply_markup:footballMatchActionKeyboard(
          request,
          match,
          '',
          favorites,
        ),
      });
      return true;
    }

    try {
      // Record the unsafe quota/history mutation in an active webhook attempt.
      // A thrown bookkeeping failure aborts before the analysis mutation.
      markTelegramWebhookMutation(cfg,'analysis_quota_or_history');

      const newsImpactDelta=opts.newsImpactDelta===true;
      const data=objectValue(
        newsImpactDelta
          ? await botAnalyzeFixture(request,cfg,user,id,{
              newsImpactRecheck:true,
              newsPublishedAt:safeText(opts.newsPublishedAt,40),
            })
          : await botAnalyzeFixtureDefault(request,cfg,user,id),
      ) || {};

      const analyzedCandidate=objectValue(data.match)
        ? normalizeBotFixtureCard(data.match)
        : match;
      const analyzedMatch=analyzedCandidate.fixtureId===id
        ? analyzedCandidate
        : match;

      await rememberBotFixtureCards([analyzedMatch],cfg);

      backgroundCall(recordGrowthEvent,cfg,{
        userId:user,
        eventName:'quick_ai',
        channel:'telegram',
        fixtureId:id,
        attribution,
        metadata:{
          section:'handoff',
          cached:data.cached===true,
          source,
        },
      });

      if (newsImpactDelta) {
        let decision=null;
        try {
          decision=objectValue(
            newsImpactDecisionCard(objectValue(data.newsImpact)),
          );
        } catch {}

        const newsImpact=objectValue(data.newsImpact) || {};
        backgroundCall(recordGrowthEvent,cfg,{
          userId:user,
          eventName:'news_impact_delta',
          channel:'telegram',
          fixtureId:id,
          metadata:{
            compared:newsImpact.compared===true,
            material:newsImpact.material===true,
            stable:newsImpact.stable===true,
            reason:safeText(newsImpact.reasonCode,32),
            decision:safeText(decision?.code,24),
            changeCount:rowsOrEmpty(newsImpact.items,100).length,
          },
        });
      }

      backgroundCall(recordGrowthEvent,cfg,{
        userId:user,
        eventName:'ai_handoff',
        channel:'telegram',
        fixtureId:id,
        ...(attribution ? {attribution} : {}),
        metadata:{
          cached:data.cached===true,
          source:attribution ? source : 'match_select',
        },
      });

      const replyMarkup=newsImpactDelta
        ? newsImpactDecisionKeyboard(
            request,
            analyzedMatch,
            favorites,
            objectValue(data.newsImpact),
          )
        : footballQuickAiHandoffKeyboard(
            request,
            analyzedMatch,
            favorites,
          );

      await telegramApi('sendMessage',cfg,{
        chat_id:chat,
        parse_mode:'HTML',
        text:safeMessageText(
          botAiHandoffText(data),
          3900,
          'AI-разбор готов.',
        ),
        reply_markup:replyMarkup,
      });
      return true;
    } catch (error) {
      const status=nonNegativeSafeInteger(error?.status,599) || 0;
      const message=status===429
        ? 'Короткий AI-разбор сейчас недоступен из-за лимита. Матч выбран — можно повторить позже.'
        : status===409
          ? 'Данные матча сейчас противоречивы, поэтому AI временно не строит вывод.'
          : safeText(
              error?.message,
              600,
              'Не удалось собрать короткую AI-оценку.',
            );

      await telegramApi('sendMessage',cfg,{
        chat_id:chat,
        parse_mode:'HTML',
        text:`⚠️ ${escapeHtml(message,600)}\n\n${botFixtureCardText(match,{aiReady:false})}`,
        reply_markup:footballMatchActionKeyboard(
          request,
          match,
          '',
          favorites,
        ),
      });
      return false;
    }
  }

  async function botAnalyzeFixture(
    request,
    cfg,
    userId,
    fixtureId,
    options={},
  ) {
    const user=positiveSafeInteger(userId);
    const id=positiveSafeInteger(fixtureId);
    const base=requestUrl(request);
    if (user===null || id===null || !base) {
      throw new TypeError('Некорректные параметры Telegram AI-разбора.');
    }

    const opts=objectValue(options) || {};
    const newsImpactRecheck=opts.newsImpactRecheck===true;
    const body={
      fixtureId:id,
      origin:'telegram_quick',
      recheck:true,
      ...(newsImpactRecheck ? {
        newsImpactRecheck:true,
        newsPublishedAt:safeText(opts.newsPublishedAt,40),
      } : {}),
    };

    let inner;
    try {
      inner=createRequest(base.toString(),{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(body),
      });
    } catch {
      throw new TypeError('Не удалось создать внутренний запрос AI-разбора.');
    }

    const response=objectValue(await apiAnalyze(inner,cfg,{id:user}));
    if (!response || typeof response.json!=='function') {
      const error=new Error('Сервис AI вернул некорректный ответ.');
      error.status=502;
      throw error;
    }

    let payload={};
    try {
      payload=objectValue(await response.json()) || {};
    } catch {}

    const status=nonNegativeSafeInteger(response.status,599) || 502;
    if (response.ok!==true) {
      const error=new Error(
        safeText(
          payload.error,
          600,
          'Не удалось получить AI-разбор матча.',
        ),
      );
      error.status=status;
      error.payload=payload;
      throw error;
    }

    const payloadMatch=objectValue(payload.match)
      ? normalizeBotFixtureCard(payload.match)
      : null;
    if (payloadMatch && payloadMatch.fixtureId!==id) {
      const error=new Error('AI вернул данные другого матча.');
      error.status=409;
      error.code='TELEGRAM_ANALYSIS_FIXTURE_MISMATCH';
      throw error;
    }
    return payload;
  }

  function botAiVerdictText(data={}) {
    const source=objectValue(data) || {};
    const match=objectValue(source.match) || {};
    const ai=objectValue(source.aiInstructor) || {};
    const signal=objectValue(ai.betSignal) || {};
    const verdict=objectValue(ai.verdict) || {};
    const trust=objectValue(ai.dataTrust) || {};
    const refereeHistory=objectValue(ai.refereeHistory);
    const refereeProfile=objectValue(ai.refereeProfile);

    let referee='ещё не назначен';
    if (refereeHistory?.available===true) {
      const name=safeText(
        refereeHistory.name
          ?? refereeProfile?.name
          ?? match.referee,
        120,
        'Судья',
      );
      const style=safeText(
        refereeHistory.styleLabel,
        120,
        'стиль уточняется',
      );
      const avg=finiteNumber(refereeHistory.avgYellow);
      referee=`${name} · ${style}${avg!==null && avg>=0 && avg<=20
        ? ` · ${Math.round(avg*10)/10} жёлт./матч`
        : ''}`;
    } else {
      referee=safeText(
        refereeProfile?.name ?? ai.referee ?? match.referee,
        180,
        'ещё не назначен',
      );
    }

    const skip=safeText(signal.code,24).toLowerCase()==='skip';
    const headline=skip
      ? '⛔ <b>Лучше пропустить</b>'
      : '🧠 <b>AI-вердикт</b>';

    const confidenceValue=finiteNumber(ai.confidenceScore);
    const confidence=confidenceValue!==null
      && confidenceValue>=0
      && confidenceValue<=100
        ? `${Math.round(confidenceValue)}/100`
        : '—';

    const trustValue=finiteNumber(trust.score);
    const trustScore=trustValue!==null
      && trustValue>=0
      && trustValue<=100
        ? `${Math.round(trustValue)}%`
        : '—';

    const home=objectValue(match.home);
    const away=objectValue(match.away);
    return [
      headline,
      `<b>${escapeHtml(home?.name,120) || 'Хозяева'} — ${escapeHtml(away?.name,120) || 'Гости'}</b>`,
      '',
      `🎯 Идея: <b>${escapeHtml(signal.label,180) || 'Нет выраженного сигнала'}</b>`,
      `📊 Исход: ${escapeHtml(verdict.outcome,120) || '—'}`,
      `⚽ Тотал: ${escapeHtml(verdict.total,120) || '—'}`,
      `🥅 Обе забьют: ${escapeHtml(verdict.btts,120) || '—'}`,
      `🧠 Уверенность: <b>${escapeHtml(ai.confidenceLabel,120) || '—'}</b> · ${confidence}`,
      `🗂 Качество данных: <b>${escapeHtml(trust.label,120) || '—'}</b> · ${trustScore}`,
      `⚠️ Риск: <b>${escapeHtml(ai.riskLabel,120) || '—'}</b>`,
      `🧑‍⚖️ Судья: ${escapeHtml(referee,360)}`,
      '',
      `Почему: ${escapeHtml(
        signal.reason ?? ai.riskNote,
        900,
      ) || 'Оцениваю доступные данные матча.'}`,
      skip
        ? 'Сильного перевеса нет — не нужно искать ставку любой ценой.'
        : 'Перед стартом ещё раз проверьте составы и движение рынка.',
      '',
      '<i>AI-сигнал основан на доступных данных и не гарантирует результат.</i>',
    ].join('\n');
  }

  return Object.freeze({
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
    botAiVerdictText,
  });
}
