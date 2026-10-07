export function createTelegramSearchRuntime(deps = {}) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Telegram search runtime dependencies are required.');
  }

  const {
    apiFootball,
    digestTime,
    footballMatchActionKeyboard,
    footballSearchHandoffKeyboard,
    freeQuotaHealthy,
    getCache,
    getHistory,
    loadPublicAiTrackRecord,
    loadSearchTeamMatches,
    normalizeSearchTeam,
    rankTeamDiscoveryMatches,
    recordGrowthEvent,
    rememberBotFixtureCards,
    searchText,
    setCache,
    telegramApi,
    telegramWebAppUrl,
    todayUtc,
    topTeamSearchPlan,
  } = deps;

  const requiredFunctions={
    apiFootball,
    digestTime,
    footballMatchActionKeyboard,
    footballSearchHandoffKeyboard,
    freeQuotaHealthy,
    getCache,
    getHistory,
    loadPublicAiTrackRecord,
    loadSearchTeamMatches,
    normalizeSearchTeam,
    rankTeamDiscoveryMatches,
    rememberBotFixtureCards,
    searchText,
    setCache,
    telegramApi,
    telegramWebAppUrl,
    todayUtc,
    topTeamSearchPlan,
  };
  for (const [name,fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function rowsOrEmpty(value, limit = 200) {
    return Array.isArray(value) ? value.slice(0,limit) : [];
  }

  function safeText(value, max = 240, fallback = '') {
    if (!['string','number','bigint'].includes(typeof value)) return fallback;
    try {
      const raw=String(value).slice(0,Math.max(max * 4,max));
      const text=raw
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

  function safeMessageText(value, max = 3900, fallback = '') {
    if (typeof value !== 'string') return fallback;
    try {
      const text=value
        .slice(0,max)
        .normalize('NFKC')
        .replace(/\r\n?/g,'\n')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,' ')
        .trim();
      return text || fallback;
    } catch {
      return fallback;
    }
  }

  function finiteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.length > 40) return null;
    const raw=value.trim();
    if (!/^-?(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function safeInteger(value) {
    const number=finiteNumber(value);
    return number !== null && Number.isSafeInteger(number) ? number : null;
  }

  function positiveSafeInteger(value) {
    const number=safeInteger(value);
    return number !== null && number > 0 ? number : null;
  }

  function nonNegativeInteger(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
    const number=safeInteger(value);
    return number !== null && number >= 0 && number <= max ? number : fallback;
  }

  function chatIdValue(value) {
    const number=safeInteger(value);
    return number !== null && number !== 0 ? number : null;
  }

  function optionalCall(fn, fallback, ...args) {
    if (typeof fn !== 'function') return fallback;
    try {
      const value=fn(...args);
      return value === undefined || value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  async function optionalAsync(fn, fallback, ...args) {
    if (typeof fn !== 'function') return fallback;
    try {
      const value=await fn(...args);
      return value === undefined || value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function backgroundCall(fn, ...args) {
    if (typeof fn !== 'function') return;
    try {
      Promise.resolve(fn(...args)).catch(()=>{});
    } catch {}
  }

  async function asyncSucceeded(fn, ...args) {
    if (typeof fn !== 'function') return false;
    try {
      await fn(...args);
      return true;
    } catch {
      return false;
    }
  }

  function normalizedSearch(value, max = 120) {
    const input=safeText(value,max);
    if (!input) return '';
    return safeText(optionalCall(searchText,'',input),max);
  }

  function safeSearchPlan(query) {
    const fallback={providerQuery:query,candidates:[],resolved:false,best:null};
    const raw=plainObject(optionalCall(topTeamSearchPlan,null,query));
    if (!raw) return fallback;
    return {
      providerQuery:safeText(raw.providerQuery,60,query) || query,
      candidates:rowsOrEmpty(raw.candidates,20),
      resolved:raw.resolved === true,
      best:plainObject(raw.best),
    };
  }

  function quotaHealthy(...args) {
    return optionalCall(freeQuotaHealthy,false,...args) === true;
  }

  function requestUrl(request) {
    const raw=safeText(request?.url,2048);
    if (!raw) return null;
    try {
      const url=new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      return url;
    } catch {
      return null;
    }
  }

  function generatedWebAppUrl(request, params = {}) {
    const base=requestUrl(request);
    if (!base) return '';
    try {
      const raw=safeText(telegramWebAppUrl(request,params),4096);
      if (!raw) return '';
      const url=new URL(raw);
      if (
        url.protocol !== 'https:'
        || url.username
        || url.password
        || url.origin !== base.origin
      ) return '';
      return url.toString();
    } catch {
      return '';
    }
  }

  function safeInlineKeyboard(value) {
    const source=plainObject(value);
    return source && Array.isArray(source.inline_keyboard) ? source : null;
  }

  function validMatch(value) {
    const match=plainObject(value);
    return match && positiveSafeInteger(match.fixtureId) ? match : null;
  }

  function telegramHtmlEscape(value = '') {
    return safeText(value,1600)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  function botSearchParts(raw = '') {
    const source=safeText(raw,100);
    const cleaned=source
      .replace(/^\/(?:search|ask)(?:@\w+)?(?:\s+|$)/i,'')
      .trim()
      .slice(0,100);
    const normalized=normalizedSearch(cleaned,100);
    const intent=/^(?:кто\s+судья|судья)(?:\s|$)/.test(normalized)
      ? 'referee'
      : /^(?:что\s+поставить|ставка|идея)(?:\s|$)/.test(normalized)
        ? 'pick'
        : /^(?:разбери|разбор|анализ|прогноз)(?:\s|$)/.test(normalized)
          ? 'analysis'
          : 'search';
    const query=cleaned
      .replace(/^(?:что\s+поставить(?:\s+на)?|кто\s+судья(?:\s+на)?|судья(?:\s+на)?|ставка(?:\s+на)?|идея(?:\s+на)?|разбери(?:\s+матч)?|разбор(?:\s+матча)?|анализ(?:\s+матча)?|прогноз(?:\s+на)?|найди(?:\s+матч)?|покажи(?:\s+матч)?)\s*[:—–-]?\s*/i,'')
      .trim()
      .slice(0,60);
    const parts=query
      .split(/(?:\s*[—–]\s*|\s+-\s+|\s+\bvs\.?\b\s+|\s+\bпротив\b\s+)/i)
      .map(value=>safeText(value,60))
      .filter(Boolean)
      .slice(0,2);
    return {query,first:parts[0] || query,second:parts[1] || '',intent};
  }

  function botIntentLead(parts = {}) {
    const source=plainObject(parts) || {};
    if (source.intent === 'referee') return '🧑‍⚖️ Нашёл матч. В AI-разборе покажу назначенного судью и доступную историю его матчей.';
    if (source.intent === 'pick') return '🧠 Нашёл матч для разбора. Отдельно покажу идею, риск и качество исходных данных.';
    if (source.intent === 'analysis') return '🧠 Нашёл матч. Откройте AI-разбор — там будут вероятности, сценарий, риски, составы, рынок и судья.';
    return '⚽ Нашёл подходящие матчи.';
  }

  function botMatchScore(match, parts = {}) {
    const source=plainObject(match);
    const queryParts=plainObject(parts);
    if (!source || !queryParts) return 0;

    const q=normalizedSearch(queryParts.query,60);
    const first=normalizedSearch(queryParts.first,60);
    const second=normalizedSearch(queryParts.second,60);
    const homeSource=plainObject(source.home) || {};
    const awaySource=plainObject(source.away) || {};
    const home=normalizedSearch(homeSource.name ?? source.homeName,160);
    const away=normalizedSearch(awaySource.name ?? source.awayName,160);
    const league=normalizedSearch(source.league,160);
    let score=0;

    if (second) {
      if (!first) return 0;
      const direct=home.includes(first) && away.includes(second);
      const reverse=away.includes(first) && home.includes(second);
      if (!direct && !reverse) return 0;
      score+=direct ? 280 : 250;
    } else {
      if (!q) return 0;
      if (home === q || away === q) score+=220;
      else if (home.startsWith(q) || away.startsWith(q)) score+=180;
      else if (home.includes(q) || away.includes(q)) score+=140;
      else if (`${home} ${away} ${league}`.includes(q)) score+=55;
      else return 0;
    }

    if (source.live === true) score+=50;
    if (source.finished !== true) score+=24;
    if (source.featured === true) score+=12;
    return score;
  }

  function botMatchButtonText(match) {
    const source=plainObject(match) || {};
    const home=safeText(plainObject(source.home)?.name ?? source.homeName,80,'Хозяева');
    const away=safeText(plainObject(source.away)?.name ?? source.awayName,80,'Гости');
    const selection=plainObject(source.selection);
    const prefix=selection?.primary === true ? '⭐' : source.live === true ? '🔴' : source.finished === true ? '📋' : '🧠';
    const label=`${prefix} ${home} — ${away}`;
    return label.length > 58 ? `${label.slice(0,55)}…` : label;
  }

  function botMatchLine(match, index = 0) {
    const source=validMatch(match);
    if (!source) return '';
    const home=telegramHtmlEscape(safeText(plainObject(source.home)?.name ?? source.homeName,120,'Хозяева'));
    const away=telegramHtmlEscape(safeText(plainObject(source.away)?.name ?? source.awayName,120,'Гости'));
    const league=telegramHtmlEscape(safeText(source.league,160,'Турнир'));

    let status='время уточняется';
    if (source.live === true) {
      status=`🔴 ${telegramHtmlEscape(safeText(source.statusLabel,80,'идёт сейчас'))}`;
    } else if (source.finished === true) {
      const score=plainObject(source.score) || {};
      const homeScore=telegramHtmlEscape(safeText(score.home,12,'—'));
      const awayScore=telegramHtmlEscape(safeText(score.away,12,'—'));
      status=`завершён · ${homeScore}:${awayScore}`;
    } else {
      const rendered=safeText(optionalCall(digestTime,'',safeText(source.date,80)),120,'время уточняется');
      status=telegramHtmlEscape(rendered);
    }

    const selection=plainObject(source.selection);
    const primary=selection?.primary === true
      ? `⭐ <b>Основной матч для анализа</b> · ${telegramHtmlEscape(safeText(selection.reason,240))}\n`
      : '';
    const position=nonNegativeInteger(index,0,100) + 1;
    return `${primary}${position}. <b>${home} — ${away}</b>\n${league} · ${status}`;
  }

  async function botCachedDayMatches(parts, cfg) {
    const day=safeText(optionalCall(todayUtc,''),20);
    if (!day) return [];
    const payload=plainObject(
      await optionalAsync(getCache,null,`matches:${day}:v6-integrity`,cfg),
    );
    return rowsOrEmpty(payload?.matches,200)
      .map(match=>({match:validMatch(match),score:botMatchScore(match,parts)}))
      .filter(item=>item.match && item.score > 0)
      .sort((left,right)=>{
        if (right.score !== left.score) return right.score-left.score;
        return safeText(left.match.date,80).localeCompare(safeText(right.match.date,80));
      })
      .slice(0,3)
      .map(item=>item.match);
  }

  async function botRemoteTeamMatches(parts, cfg) {
    const source=plainObject(parts) || {};
    const query=safeText(source.first,60);
    if (!query) return [];

    const plan=safeSearchPlan(query);
    const bestScore=finiteNumber(plan.best?.score) ?? 0;
    const highIntent=bestScore >= 170;
    if (
      (query.length < 3 && bestScore < 280)
      || (!quotaHealthy(10,2) && !(highIntent && quotaHealthy(2,1)))
    ) return [];

    const providerQuery=safeText(plan.providerQuery,60,query) || query;
    const q=normalizedSearch(providerQuery,60);
    if (!q) return [];
    const teamCacheKey=`search:teams:${encodeURIComponent(q)}:v2-global`;
    const cached=plainObject(await optionalAsync(getCache,null,teamCacheKey,cfg));
    let teams=rowsOrEmpty(cached?.teams,5)
      .map(team=>plainObject(team))
      .filter(team=>positiveSafeInteger(team?.id) && safeText(team?.name,160));

    if (!teams.length) {
      const providerRows=rowsOrEmpty(
        await optionalAsync(apiFootball,[], '/teams',{search:providerQuery},cfg),
        100,
      );
      teams=providerRows
        .map(row=>{
          try {
            return plainObject(normalizeSearchTeam(row,query,plan.candidates));
          } catch {
            return null;
          }
        })
        .filter(team=>positiveSafeInteger(team?.id) && safeText(team?.name,160))
        .sort((left,right)=>(finiteNumber(right.score) ?? 0) - (finiteNumber(left.score) ?? 0))
        .slice(0,5);

      if (teams.length) {
        await optionalAsync(
          setCache,
          null,
          teamCacheKey,
          0,
          {
            query,
            resolvedQuery:plan.resolved ? providerQuery : '',
            teams,
            warning:'',
            refreshedAt:new Date().toISOString(),
          },
          cfg,
          1440,
        );
      }
    }

    const team=teams[0];
    if (!team) return [];
    const discovery=plainObject(
      await optionalAsync(loadSearchTeamMatches,null,team,cfg,{secondQuery:safeText(source.second,60)}),
    );
    return rowsOrEmpty(discovery?.matches,20)
      .map(match=>validMatch(match))
      .filter(Boolean)
      .slice(0,3);
  }

  function inputError(message, code) {
    const error=new TypeError(message);
    error.code=code;
    return error;
  }

  function fallbackSearchKeyboard(match, searchUrl = '') {
    const fixtureId=positiveSafeInteger(match?.fixtureId);
    if (!fixtureId) return searchUrl
      ? {inline_keyboard:[[{text:'🔎 Все результаты поиска',web_app:{url:searchUrl}}]]}
      : undefined;
    const rows=[[{text:'🧠 Короткая AI-оценка',callback_data:`match:menu:${fixtureId}`}]];
    if (searchUrl) rows.push([{text:'🔎 Другие результаты',web_app:{url:searchUrl}}]);
    return {inline_keyboard:rows};
  }

  async function sendBotFootballSearch(request, cfg, userId, chatId, rawText) {
    const uid=positiveSafeInteger(userId);
    const cid=chatIdValue(chatId);
    if (!uid) throw inputError('Telegram user не определён.','TELEGRAM_USER_INVALID');
    if (!cid) throw inputError('Telegram chat не определён.','TELEGRAM_CHAT_INVALID');

    const parts=botSearchParts(rawText);
    if (parts.query.length < 2) {
      const url=generatedWebAppUrl(request,{view:'search'});
      const payload={
        chat_id:cid,
        text:'Напишите название команды или вопрос о матче. Например: «Арсенал», «что поставить на Арсенал — Челси» или «кто судья Интер — Милан».',
      };
      if (url) {
        payload.reply_markup={inline_keyboard:[[{text:'🔎 Открыть поиск',web_app:{url}}]]};
      }
      await telegramApi('sendMessage',cfg,payload);
      return;
    }

    backgroundCall(recordGrowthEvent,cfg,{
      userId:uid,
      eventName:'search',
      channel:'telegram',
      metadata:{intent:parts.intent},
    });

    const searchPlan=safeSearchPlan(parts.first);
    const recognized=Boolean(
      searchPlan.best
      && (finiteNumber(searchPlan.best.score) ?? 0) >= 170
    );

    let matches=await botCachedDayMatches(parts,cfg);
    if (!matches.length) matches=await botRemoteTeamMatches(parts,cfg);
    matches=rowsOrEmpty(optionalCall(rankTeamDiscoveryMatches,[],matches),20)
      .map(match=>validMatch(match))
      .filter(Boolean)
      .slice(0,3);

    const searchUrl=generatedWebAppUrl(request,{view:'search',q:parts.query});
    if (!matches.length) {
      const known=recognized;
      backgroundCall(recordGrowthEvent,cfg,{
        userId:uid,
        eventName:'search_result',
        channel:'telegram',
        metadata:{
          intent:parts.intent,
          outcome:known ? 'recognized_no_match' : 'not_found',
          recognized:known,
        },
      });
      const canonical=telegramHtmlEscape(safeText(searchPlan.best?.canonical,120,parts.first));
      const payload={
        chat_id:cid,
        parse_mode:'HTML',
        text:known
          ? `✅ Клуб распознан: <b>${canonical}</b>. Ближайший матч сейчас не вернулся из источника данных — откройте глобальный поиск, там сохраняется распознанный клуб и доступные матчи из кэша.`
          : `🔎 По запросу <b>${telegramHtmlEscape(parts.query)}</b> подходящий матч сейчас не найден. Попробуйте полное название клуба или глобальный поиск по лигам и странам.`,
      };
      if (searchUrl) {
        payload.reply_markup={inline_keyboard:[[{text:'🌍 Глобальный поиск',web_app:{url:searchUrl}}]]};
      }
      await telegramApi('sendMessage',cfg,payload);
      return;
    }

    const recovery=matches.some(match=>match.finished !== true) ? 'upcoming' : 'recent';
    const primaryFixtureId=positiveSafeInteger(
      matches.find(match=>plainObject(match.selection)?.primary === true)?.fixtureId
      ?? matches[0]?.fixtureId,
    ) || 0;
    backgroundCall(recordGrowthEvent,cfg,{
      userId:uid,
      eventName:'search_result',
      channel:'telegram',
      metadata:{
        intent:parts.intent,
        outcome:'match',
        recognized,
        recovery,
        primaryFixtureId,
        count:matches.length,
      },
    });

    const cardsReady=await asyncSucceeded(rememberBotFixtureCards,matches,cfg);
    const lines=matches.map((match,index)=>botMatchLine(match,index)).filter(Boolean);

    let replyMarkup;
    if (!cardsReady) {
      replyMarkup=searchUrl
        ? {inline_keyboard:[[{text:'🔎 Все результаты поиска',web_app:{url:searchUrl}}]]}
        : undefined;
    } else if (matches.length === 1) {
      replyMarkup=safeInlineKeyboard(
        optionalCall(footballSearchHandoffKeyboard,null,request,matches[0],searchUrl),
      ) || fallbackSearchKeyboard(matches[0],searchUrl);
    } else {
      const inlineKeyboard=matches.map(match=>[{
        text:botMatchButtonText(match),
        callback_data:`match:menu:${positiveSafeInteger(match.fixtureId)}`,
      }]);
      if (searchUrl) {
        inlineKeyboard.push([{text:'🔎 Все результаты поиска',web_app:{url:searchUrl}}]);
      }
      replyMarkup={inline_keyboard:inlineKeyboard};
    }

    await telegramApi('sendMessage',cfg,{
      chat_id:cid,
      parse_mode:'HTML',
      text:safeMessageText([
        `<b>${telegramHtmlEscape(botIntentLead(parts))}</b>`,
        `Запрос: «${telegramHtmlEscape(parts.query)}»`,
        '',
        ...lines,
        '',
        matches.length === 1
          ? 'Матч найден. Нажмите один раз — сразу покажу короткую AI-оценку.'
          : '⭐ Первый матч — основной выбор MatchRadar AI. Нажмите на любой матч — сразу получите короткую AI-оценку.',
      ].join('\n')),
      ...(replyMarkup ? {reply_markup:replyMarkup} : {}),
    });
  }

  function lastAiVerdictText(row = {}) {
    const source=plainObject(row);
    const fixtureId=positiveSafeInteger(source?.fixture_id);
    if (!source || !fixtureId) return 'История AI-разборов пока пуста.';

    const home=safeText(source.home_name,120,'Хозяева');
    const away=safeText(source.away_name,120,'Гости');
    const teams=`${home} — ${away}`;
    const signal=safeText(source.ai_signal_label,300);
    if (!signal) {
      return safeMessageText(
        `Последний анализ: ${teams}. Он был создан до сохранения быстрых AI-вердиктов; откройте историю в приложении.`,
      );
    }

    const confidenceNumber=finiteNumber(source.ai_confidence);
    const confidence=confidenceNumber !== null && confidenceNumber >= 0 && confidenceNumber <= 100
      ? ` · уверенность ${Math.round(confidenceNumber)}/100`
      : '';
    const risk=safeText(source.ai_risk,80);
    const outcome=safeText(source.ai_outcome,300);
    return safeMessageText(
      `🧠 Последний AI-разбор\n${teams}\n${signal}${confidence}${risk ? ` · риск ${risk.toLowerCase()}` : ''}${outcome ? `\nИсход: ${outcome}` : ''}`,
    );
  }

  function botAiTrackRecordText(record = {}) {
    const source=plainObject(record);
    if (!source || source.available !== true) return '📈 Протокол AI временно недоступен.';

    const sample=plainObject(source.sample) || {};
    const probabilityQuality=plainObject(source.probabilityQuality) || {};
    const brier=finiteNumber(probabilityQuality.avgBrier);
    const recent=rowsOrEmpty(source.recent,5);
    const recentLines=recent.map(rawRow=>{
      const row=plainObject(rawRow) || {};
      const marker=row.matched === true ? '✅' : row.matched === false ? '❌' : '•';
      const home=telegramHtmlEscape(safeText(row.home,120,'Хозяева'));
      const away=telegramHtmlEscape(safeText(row.away,120,'Гости'));
      const score=telegramHtmlEscape(safeText(row.score,40,'—'));
      const predicted=telegramHtmlEscape(safeText(row.predictedLabel,120,'—'));
      const actual=telegramHtmlEscape(safeText(row.actualLabel,120,'—'));
      const probability=finiteNumber(row.topProbability);
      const probabilityText=probability !== null && probability >= 0 && probability <= 100
        ? ` · ${Math.round(probability * 1000) / 1000}%`
        : '';
      return `${marker} ${home} — ${away} · ${score}\n   AI: ${predicted}${probabilityText} → факт ${actual}`;
    });

    const periodDays=nonNegativeInteger(source.periodDays,180,3650) || 180;
    const verified=nonNegativeInteger(sample.verified,0,1_000_000);
    const matched=nonNegativeInteger(sample.matched,0,1_000_000);
    const missed=nonNegativeInteger(sample.missed,0,1_000_000);
    return safeMessageText([
      '📈 <b>Протокол MatchRadar AI</b>',
      `Период: последние ${periodDays} дней`,
      '',
      `Проверенных матчей: <b>${verified}</b>`,
      `Совпало / не совпало: <b>${matched} / ${missed}</b>`,
      `Статус выборки: <b>${telegramHtmlEscape(safeText(sample.label,120,'—'))}</b>`,
      telegramHtmlEscape(safeText(sample.message,500)),
      brier !== null && brier >= 0
        ? `Ошибка Брайера: <b>${brier.toFixed(3)}</b> · ниже лучше`
        : 'Ошибка Брайера: пока недостаточно данных',
      ...(recentLines.length ? ['', '<b>Последние подтверждённые:</b>', ...recentLines] : []),
      '',
      '<i>Это история вероятностей модели, а не «винрейт» и не показатель доходности ставок. Прошлые результаты не гарантируют будущие.</i>',
    ].filter(Boolean).join('\n'),3900);
  }

  async function sendBotAiTrackRecord(request, cfg, chatId) {
    const cid=chatIdValue(chatId);
    if (!cid) throw inputError('Telegram chat не определён.','TELEGRAM_CHAT_INVALID');
    const record=await optionalAsync(loadPublicAiTrackRecord,{available:false},cfg,180);
    const historyUrl=generatedWebAppUrl(request,{view:'history'});
    const inlineKeyboard=[];
    if (historyUrl) {
      inlineKeyboard.push([{text:'🧠 Открыть историю AI',web_app:{url:historyUrl}}]);
    }
    inlineKeyboard.push([{text:'⚽ Матчи сегодня',callback_data:'feed:today'}]);

    await telegramApi('sendMessage',cfg,{
      chat_id:cid,
      parse_mode:'HTML',
      text:botAiTrackRecordText(record),
      reply_markup:{inline_keyboard:inlineKeyboard},
    });
  }

  async function sendLastAiVerdict(request, cfg, userId, chatId) {
    const uid=positiveSafeInteger(userId);
    const cid=chatIdValue(chatId);
    if (!uid) throw inputError('Telegram user не определён.','TELEGRAM_USER_INVALID');
    if (!cid) throw inputError('Telegram chat не определён.','TELEGRAM_CHAT_INVALID');

    const history=await optionalAsync(getHistory,[],uid,cfg);
    const row=plainObject(rowsOrEmpty(history,1)[0]);
    const fixtureId=positiveSafeInteger(row?.fixture_id);
    const historyUrl=generatedWebAppUrl(request,{view:'history'});

    let replyMarkup;
    if (fixtureId) {
      replyMarkup=safeInlineKeyboard(optionalCall(
        footballMatchActionKeyboard,
        null,
        request,
        {fixtureId},
        historyUrl,
      ));
    }
    if (!replyMarkup && historyUrl) {
      replyMarkup={inline_keyboard:[[{text:'🕘 Открыть историю',web_app:{url:historyUrl}}]]};
    }

    const payload={
      chat_id:cid,
      text:lastAiVerdictText(row),
    };
    if (replyMarkup) payload.reply_markup=replyMarkup;
    await telegramApi('sendMessage',cfg,payload);
  }

  return Object.freeze({
    telegramHtmlEscape,
    botSearchParts,
    botIntentLead,
    botMatchScore,
    botMatchButtonText,
    botMatchLine,
    botCachedDayMatches,
    botRemoteTeamMatches,
    sendBotFootballSearch,
    lastAiVerdictText,
    botAiTrackRecordText,
    sendBotAiTrackRecord,
    sendLastAiVerdict,
  });
}
