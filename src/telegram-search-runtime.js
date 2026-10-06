export function createTelegramSearchRuntime(deps = {}) {
  const {
    apiFootball,
    digestTime,
    footballMatchActionKeyboard,
    footballSearchHandoffKeyboard,
    freeQuotaHealthy,
    getCache,
    getFavorites,
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
    topTeamSearchPlan
  } = deps;

  function telegramHtmlEscape(value = '') {
    return String(value || '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }
  
  function botSearchParts(raw = '') {
    const cleaned = String(raw || '').replace(/^\/(?:search|ask)(?:@\w+)?(?:\s+|$)/i,'').trim().slice(0,100);
    const normalized = searchText(cleaned);
    const intent = /^(?:кто\s+судья|судья)(?:\s|$)/.test(normalized)
      ? 'referee'
      : /^(?:что\s+поставить|ставка|идея)(?:\s|$)/.test(normalized)
        ? 'pick'
        : /^(?:разбери|разбор|анализ|прогноз)(?:\s|$)/.test(normalized)
          ? 'analysis'
          : 'search';
    const query = cleaned
      .replace(/^(?:что\s+поставить(?:\s+на)?|кто\s+судья(?:\s+на)?|судья(?:\s+на)?|ставка(?:\s+на)?|идея(?:\s+на)?|разбери(?:\s+матч)?|разбор(?:\s+матча)?|анализ(?:\s+матча)?|прогноз(?:\s+на)?|найди(?:\s+матч)?|покажи(?:\s+матч)?)\s*[:—–-]?\s*/i,'')
      .trim().slice(0,60);
    const parts = query.split(/(?:\s*[—–]\s*|\s+-\s+|\s+\bvs\.?\b\s+|\s+\bпротив\b\s+)/i).map(x => x.trim()).filter(Boolean).slice(0,2);
    return { query, first: parts[0] || query, second: parts[1] || '', intent };
  }
  
  function botIntentLead(parts = {}) {
    if (parts.intent === 'referee') return '🧑‍⚖️ Нашёл матч. В AI-разборе покажу назначенного судью и доступную историю его матчей.';
    if (parts.intent === 'pick') return '🧠 Нашёл матч для разбора. Отдельно покажу идею, риск и качество исходных данных.';
    if (parts.intent === 'analysis') return '🧠 Нашёл матч. Откройте AI-разбор — там будут вероятности, сценарий, риски, составы, рынок и судья.';
    return '⚽ Нашёл подходящие матчи.';
  }
  
  function botMatchScore(match, parts) {
    const q = searchText(parts.query);
    const first = searchText(parts.first);
    const second = searchText(parts.second);
    const home = searchText(match?.home?.name || match?.homeName || '');
    const away = searchText(match?.away?.name || match?.awayName || '');
    const league = searchText(match?.league || '');
    let score = 0;
    if (second) {
      const direct = home.includes(first) && away.includes(second);
      const reverse = away.includes(first) && home.includes(second);
      if (!direct && !reverse) return 0;
      score += direct ? 280 : 250;
    } else {
      if (!q) return 0;
      if (home === q || away === q) score += 220;
      else if (home.startsWith(q) || away.startsWith(q)) score += 180;
      else if (home.includes(q) || away.includes(q)) score += 140;
      else if (`${home} ${away} ${league}`.includes(q)) score += 55;
      else return 0;
    }
    if (match?.live) score += 50;
    if (!match?.finished) score += 24;
    if (match?.featured) score += 12;
    return score;
  }
  
  function botMatchButtonText(match) {
    const home = String(match?.home?.name || match?.homeName || 'Хозяева');
    const away = String(match?.away?.name || match?.awayName || 'Гости');
    const prefix = match?.selection?.primary ? '⭐' : match?.live ? '🔴' : match?.finished ? '📋' : '🧠';
    const label = `${prefix} ${home} — ${away}`;
    return label.length > 58 ? `${label.slice(0,55)}…` : label;
  }
  
  function botMatchLine(match, index) {
    const home = telegramHtmlEscape(match?.home?.name || match?.homeName || 'Хозяева');
    const away = telegramHtmlEscape(match?.away?.name || match?.awayName || 'Гости');
    const league = telegramHtmlEscape(match?.league || 'Турнир');
    const status = match?.live
      ? `🔴 ${telegramHtmlEscape(match.statusLabel || 'идёт сейчас')}`
      : match?.finished
        ? `завершён · ${match?.score?.home ?? '—'}:${match?.score?.away ?? '—'}`
        : digestTime(match?.date);
    const primary=match?.selection?.primary ? `⭐ <b>Основной матч для анализа</b> · ${telegramHtmlEscape(match.selection.reason || '')}\n` : '';
    return `${primary}${index + 1}. <b>${home} — ${away}</b>\n${league} · ${status}`;
  }
  
  async function botCachedDayMatches(parts, cfg) {
    const payload = await getCache(`matches:${todayUtc()}:v6-integrity`, cfg).catch(() => null);
    return (payload?.matches || []).map(match => ({ match, score:botMatchScore(match,parts) }))
      .filter(x => x.score > 0).sort((a,b) => b.score-a.score || String(a.match.date||'').localeCompare(String(b.match.date||''))).slice(0,3).map(x=>x.match);
  }
  
  async function botRemoteTeamMatches(parts, cfg) {
    const query = String(parts.first || '').trim();
    const plan=topTeamSearchPlan(query);
    const highIntent=Number(plan.best?.score || 0)>=170;
    if ((query.length < 3 && Number(plan.best?.score || 0) < 280) || (!freeQuotaHealthy(10,2) && !(highIntent && freeQuotaHealthy(2,1)))) return [];
    const q = searchText(plan.providerQuery || query);
    const teamCacheKey = `search:teams:${encodeURIComponent(q)}:v2-global`;
    let teams = (await getCache(teamCacheKey,cfg).catch(()=>null))?.teams || [];
    if (!teams.length) {
      const rows = await apiFootball('/teams',{search:plan.providerQuery || query},cfg).catch(()=>[]);
      teams = rows.map(x=>normalizeSearchTeam(x,query,plan.candidates)).filter(x=>x.id&&x.name).sort((a,b)=>b.score-a.score).slice(0,5);
      if (teams.length) await setCache(teamCacheKey,0,{query,resolvedQuery:plan.resolved?plan.providerQuery:'',teams,warning:'',refreshedAt:new Date().toISOString()},cfg,1440).catch(()=>null);
    }
    const team = teams[0];
    if (!team?.id) return [];
    const discovery=await loadSearchTeamMatches(team,cfg,{secondQuery:parts.second});
    return (discovery.matches || []).slice(0,3);
  }
  
  async function sendBotFootballSearch(request, cfg, userId, chatId, rawText) {
    const parts=botSearchParts(rawText);
    if (parts.query.length < 2) {
      await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'Напишите название команды или вопрос о матче. Например: «Арсенал», «что поставить на Арсенал — Челси» или «кто судья Интер — Милан».',reply_markup:{inline_keyboard:[[{text:'🔎 Открыть поиск',web_app:{url:telegramWebAppUrl(request,{view:'search'})}}]]}});
      return;
    }
    void recordGrowthEvent(cfg,{userId,eventName:'search',channel:'telegram',metadata:{intent:parts.intent}});
    const searchPlan=topTeamSearchPlan(parts.first);
    const recognized=Boolean(searchPlan.best && Number(searchPlan.best.score || 0)>=170);
    let matches=await botCachedDayMatches(parts,cfg);
    if (!matches.length) matches=await botRemoteTeamMatches(parts,cfg);
    matches=rankTeamDiscoveryMatches(matches).slice(0,3);
    const searchUrl=telegramWebAppUrl(request,{view:'search',q:parts.query});
    if (!matches.length) {
      const known=recognized;
      void recordGrowthEvent(cfg,{userId,eventName:'search_result',channel:'telegram',metadata:{intent:parts.intent,outcome:known?'recognized_no_match':'not_found',recognized:known}});
      await telegramApi('sendMessage',cfg,{
        chat_id:chatId,
        parse_mode:'HTML',
        text:known
          ? `✅ Клуб распознан: <b>${telegramHtmlEscape(searchPlan.best.canonical)}</b>. Ближайший матч сейчас не вернулся из источника данных — откройте глобальный поиск, там сохраняется распознанный клуб и доступные матчи из кэша.`
          : `🔎 По запросу <b>${telegramHtmlEscape(parts.query)}</b> подходящий матч сейчас не найден. Попробуйте полное название клуба или глобальный поиск по лигам и странам.`,
        reply_markup:{inline_keyboard:[[{text:'🌍 Глобальный поиск',web_app:{url:searchUrl}}]]},
      });
      return;
    }
    const recovery=matches.some(match=>!match.finished)?'upcoming':'recent';
    const primaryFixtureId=Number(matches.find(match=>match.selection?.primary)?.fixtureId || matches[0]?.fixtureId || 0);
    void recordGrowthEvent(cfg,{userId,eventName:'search_result',channel:'telegram',metadata:{intent:parts.intent,outcome:'match',recognized,recovery,primaryFixtureId,count:Math.min(3,matches.length)}});
    await rememberBotFixtureCards(matches, cfg);
    const favorites=await getFavorites(userId,cfg).catch(()=>[]);
    const rows=matches.map((match,index)=>botMatchLine(match,index));
    const replyMarkup = matches.length === 1
      ? footballSearchHandoffKeyboard(request, matches[0], searchUrl)
      : { inline_keyboard: [
          ...matches.map(match=>[{text:botMatchButtonText(match),callback_data:`match:menu:${Number(match.fixtureId)}`}]),
          [{text:'🔎 Все результаты поиска',web_app:{url:searchUrl}}],
        ] };
    await telegramApi('sendMessage',cfg,{
      chat_id:chatId,
      parse_mode:'HTML',
      text:[`<b>${telegramHtmlEscape(botIntentLead(parts))}</b>`,`Запрос: «${telegramHtmlEscape(parts.query)}»`,'',...rows,'',matches.length === 1 ? 'Матч найден. Нажмите один раз — сразу покажу короткую AI-оценку.' : '⭐ Первый матч — основной выбор MatchRadar AI. Нажмите на любой матч — сразу получите короткую AI-оценку.'].join('\n'),
      reply_markup:replyMarkup,
    });
  }
  
  function lastAiVerdictText(row = {}) {
    if (!row?.fixture_id) return 'История AI-разборов пока пуста.';
    const teams = `${row.home_name || 'Хозяева'} — ${row.away_name || 'Гости'}`;
    if (!row.ai_signal_label) return `Последний анализ: ${teams}. Он был создан до сохранения быстрых AI-вердиктов; откройте историю в приложении.`;
    const confidence = Number.isFinite(Number(row.ai_confidence)) ? ` · уверенность ${Math.round(Number(row.ai_confidence))}/100` : '';
    const risk = row.ai_risk ? ` · риск ${String(row.ai_risk).toLowerCase()}` : '';
    const outcome = row.ai_outcome ? `\nИсход: ${row.ai_outcome}` : '';
    return `🧠 Последний AI-разбор\n${teams}\n${row.ai_signal_label}${confidence}${risk}${outcome}`;
  }
  
  
  function botAiTrackRecordText(record = {}) {
    if (!record?.available) return '📈 Протокол AI временно недоступен.';
    const sample=record.sample || {};
    const brier=record.probabilityQuality?.avgBrier;
    const recent=(record.recent || []).slice(0,5);
    const recentLines=recent.map(row=>`${row.matched?'✅':'❌'} ${telegramHtmlEscape(row.home)} — ${telegramHtmlEscape(row.away)} · ${telegramHtmlEscape(row.score)}\n   AI: ${telegramHtmlEscape(row.predictedLabel)}${Number.isFinite(Number(row.topProbability))?` · ${Number(row.topProbability)}%`:''} → факт ${telegramHtmlEscape(row.actualLabel)}`);
    return [
      '📈 <b>Протокол MatchRadar AI</b>',
      `Период: последние ${Number(record.periodDays || 180)} дней`,
      '',
      `Проверенных матчей: <b>${Number(sample.verified || 0)}</b>`,
      `Совпало / не совпало: <b>${Number(sample.matched || 0)} / ${Number(sample.missed || 0)}</b>`,
      `Статус выборки: <b>${telegramHtmlEscape(sample.label || '—')}</b>`,
      telegramHtmlEscape(sample.message || ''),
      Number.isFinite(Number(brier)) ? `Ошибка Брайера: <b>${Number(brier).toFixed(3)}</b> · ниже лучше` : 'Ошибка Брайера: пока недостаточно данных',
      ...(recentLines.length ? ['', '<b>Последние подтверждённые:</b>', ...recentLines] : []),
      '',
      '<i>Это история вероятностей модели, а не «винрейт» и не показатель доходности ставок. Прошлые результаты не гарантируют будущие.</i>',
    ].filter(Boolean).join('\n');
  }
  
  async function sendBotAiTrackRecord(request, cfg, chatId) {
    const record=await loadPublicAiTrackRecord(cfg,180).catch(()=>({available:false}));
    await telegramApi('sendMessage',cfg,{
      chat_id:chatId,
      parse_mode:'HTML',
      text:botAiTrackRecordText(record),
      reply_markup:{inline_keyboard:[
        [{text:'🧠 Открыть историю AI',web_app:{url:telegramWebAppUrl(request,{view:'history'})}}],
        [{text:'⚽ Матчи сегодня',callback_data:'feed:today'}],
      ]},
    });
  }
  
  async function sendLastAiVerdict(request, cfg, userId, chatId) {
    const rows = await getHistory(userId, cfg);
    const row = rows[0];
    await telegramApi('sendMessage', cfg, {
      chat_id:chatId,
      text:lastAiVerdictText(row),
      reply_markup: row?.fixture_id
        ? footballMatchActionKeyboard(request, { fixtureId:Number(row.fixture_id) }, telegramWebAppUrl(request,{view:'history'}))
        : {inline_keyboard:[[{text:'🕘 Открыть историю',web_app:{url:telegramWebAppUrl(request,{view:'history'})}}]]},
    });
  }

  return {
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
    sendLastAiVerdict
  };
}
