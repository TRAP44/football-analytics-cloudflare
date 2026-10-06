// Football news discovery, trust, match-linking and Telegram presentation extracted from worker.js.
// Search, cache, Telegram and fixture primitives are injected by the composition root.
export function createFootballNewsRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Football news runtime dependencies are required.');
  }
  const {
    NEWS_BLOCKED_HOST_RE,
    NEWS_MAJOR_SOURCE_RE,
    NEWS_OFFICIAL_SOURCE_RE,
    TOP_TEAM_SEARCH_CATALOG,
    botTeamIdMatches,
    fetchWithTimeout,
    getCache,
    getFavorites,
    normalizeBotFixtureCard,
    recordGrowthEvent,
    searchText,
    setCache,
    telegramApi,
    telegramHtmlEscape,
    todayUtc,
  } = deps;

  function externalNewsUrl(value = '') {
    try {
      const u=new URL(String(value || ''));
      return /^https?:$/.test(u.protocol) ? u.toString() : '';
    } catch { return ''; }
  }
  
  function newsSourceDomain(value = '') {
    try { return new URL(String(value || '')).hostname.replace(/^www\./,''); }
    catch { return ''; }
  }
  
  function newsSourceTrust(url = '') {
    const value=String(url || '');
    if (NEWS_OFFICIAL_SOURCE_RE.test(value)) return {tier:'official',score:95,label:'Официальный источник'};
    if (NEWS_MAJOR_SOURCE_RE.test(value)) return {tier:'major',score:88,label:'Крупный источник'};
    return {tier:'web',score:58,label:'Веб-источник'};
  }
  
  function applyNewsTrustGate(item = {}) {
    const trust=newsSourceTrust(item.url);
    const originalImpact=String(item?.category?.impact || 'low');
    const needsConfirmation=originalImpact==='high' && !['official','major'].includes(trust.tier);
    return {
      ...item,
      trust,
      verification:needsConfirmation ? 'needs_confirmation' : 'source_backed',
      category:needsConfirmation ? {...item.category,impact:'medium'} : item.category,
    };
  }
  
  function footballNewsCategory(article = {}) {
    const hay=searchText(`${article.title || ''} ${article.content || ''}`);
    const groups=[
      {code:'injury',icon:'🚑',label:'Травмы',impact:'high',re:/injur|injured|fitness|ruled out|doubt|surgery|hamstring|ankle|knee|травм|поврежден|повреждён|пропустит|под вопросом/},
      {code:'suspension',icon:'🟥',label:'Дисквалификации',impact:'high',re:/suspend|suspension|ban\b|red card|дисквалиф|отстранен|отстранён/},
      {code:'coach',icon:'🧑‍💼',label:'Тренер',impact:'high',re:/manager|head coach|coach|sacked|dismissed|appointed|тренер|уволен|увольнен|увольнён|назначен/},
      {code:'lineup',icon:'👥',label:'Состав',impact:'medium',re:/lineup|starting xi|team news|returns to squad|available|состав|стартов|вернулся в состав|готов сыграть/},
      {code:'transfer',icon:'🔄',label:'Трансферы',impact:'medium',re:/transfer|signing|signs|signed|joins|contract|loan|трансфер|подписал|аренд/},
      {code:'referee',icon:'🧑‍⚖️',label:'Судья',impact:'medium',re:/referee|officials|арбитр|судья/},
      {code:'weather',icon:'🌦️',label:'Условия',impact:'medium',re:/weather|storm|snow|rain|heat|pitch|погод|дожд|снег|жар|поле/},
      {code:'club',icon:'⚽',label:'Клуб',impact:'low',re:/club|president|owner|board|клуб|президент|владелец/},
    ];
    return groups.find(x=>x.re.test(hay)) || {code:'general',icon:'📰',label:'Футбол',impact:'low'};
  }
  
  function footballNewsImpactText(category = {}, hasUpcomingMatch = false) {
    if (!hasUpcomingMatch) {
      if (category.impact === 'high') return 'Событие может заметно изменить спортивный контекст команды.';
      if (category.impact === 'medium') return 'Событие стоит учитывать в следующем матче команды.';
      return 'Контекстная новость: следим, но не меняем AI-сценарий автоматически.';
    }
    if (category.code === 'injury' || category.code === 'suspension') return 'Может изменить состав и баланс сил. Перед матчем стоит обновить AI-разбор.';
    if (category.code === 'coach') return 'Смена тренерского контекста может менять стиль и неопределённость. AI-разбор стоит перепроверить.';
    if (category.code === 'lineup') return 'Может уточнить стартовый состав. Это один из ключевых сигналов перед матчем.';
    if (category.code === 'referee') return 'Назначение судьи может влиять на карточки, фолы и темп — проверяем в контексте матча.';
    if (category.code === 'weather') return 'Условия могут влиять на темп и качество игры. Это вспомогательный фактор, не самостоятельный прогноз.';
    return 'Проверяем, меняет ли новость входные данные AI-разбора ближайшего матча.';
  }
  
  
  function newsTeamToken(team = {}) {
    return String(team?.canonical || '').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,32);
  }
  
  function newsTeamByToken(token = '') {
    const clean=String(token || '').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,32);
    if (!clean) return null;
    return TOP_TEAM_SEARCH_CATALOG.find(team=>newsTeamToken(team)===clean) || null;
  }
  
  function newsPublishedDayToken(item = {}) {
    const ms=newsPublishedMs(item);
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toISOString().slice(0,10).replace(/-/g,'');
  }
  
  function newsPublishedAtFromDayToken(token = '') {
    const value=String(token || '');
    if (!/^\d{8}$/.test(value)) return '';
    const iso=`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T12:00:00Z`;
    return Number.isFinite(Date.parse(iso)) ? iso : '';
  }
  
  function newsTeamHint(item = {}) {
    const hay=` ${searchText(`${item?.title || ''} ${item?.content || ''}`)} `;
    if (!hay.trim()) return null;
    let best=null;
    for (const team of TOP_TEAM_SEARCH_CATALOG) {
      const terms=[team.canonical,...(team.aliases || [])]
        .map(searchText)
        .filter(term=>term && (term.length>=4 || ['psg','bvb','psv','ajax','juve','lafc','rma','fcb'].includes(term)));
      for (const term of terms) {
        if (!hay.includes(` ${term} `)) continue;
        const score=(term.includes(' ')?120:60)+Math.min(80,term.length*4);
        if (!best || score>best.score) best={canonical:team.canonical,country:team.country,token:newsTeamToken(team),score};
      }
    }
    return best;
  }
  
  function newsPublishedMs(item = {}) {
    const value=Date.parse(String(item?.publishedAt || item?.published_date || ''));
    return Number.isFinite(value) ? value : null;
  }
  
  function newsFixtureRelevance(item = {}, fixture = {}) {
    const match=normalizeBotFixtureCard(fixture);
    const fixtureMs=Date.parse(match.date || '');
    if (!match.fixtureId || !Number.isFinite(fixtureMs)) return {score:-Infinity,fixture:match,timing:'invalid',hoursFromNews:null};
    const publishedMs=newsPublishedMs(item);
    const now=Date.now();
    const baseMs=publishedMs ?? now;
    const hours=(fixtureMs-baseMs)/3600000;
    let score=0;
    let timing='next_match';
  
    if (match.live) {
      score=520;
      timing='live';
    } else if (!match.finished && hours>=-3) {
      if (hours<=24) { score=460-Math.max(0,hours)*2; timing='pre_match'; }
      else if (hours<=72) { score=390-(hours-24); timing='near_match'; }
      else if (hours<=24*14) { score=310-(hours/24)*5; timing='next_match'; }
      else { score=190-Math.min(120,hours/24); timing='future'; }
    } else if (!match.finished && publishedMs===null) {
      const hoursFromNow=(fixtureMs-now)/3600000;
      score=hoursFromNow>=-3 ? 260-Math.min(180,Math.max(0,hoursFromNow)/2) : 20;
      timing='next_match';
    } else {
      const ageHours=Math.abs(hours);
      score=Math.max(5,80-Math.min(75,ageHours/3));
      timing='past_match';
    }
  
    const category=String(item?.category?.code || '');
    if (['lineup','injury','suspension','referee','weather'].includes(category) && !match.finished) score+=35;
    if (category==='coach' && !match.finished) score+=20;
    return {score,fixture:match,timing,hoursFromNews:Number.isFinite(hours)?hours:null};
  }
  
  function newsRelevantFixture(item = {}, fixtures = []) {
    const ranked=(fixtures || [])
      .map(fixture=>newsFixtureRelevance(item,fixture))
      .filter(x=>Number.isFinite(x.score) && x.fixture?.fixtureId)
      .sort((a,b)=>b.score-a.score || Date.parse(a.fixture.date||0)-Date.parse(b.fixture.date||0));
    const best=ranked[0] || null;
    if (!best) return null;
    if (best.timing==='past_match' && ranked.some(x=>x.timing!=='past_match')) return ranked.find(x=>x.timing!=='past_match') || best;
    return best;
  }
  
  function newsFixtureTimingLabel(link = {}) {
    if (!link?.fixture?.fixtureId) return '';
    if (link.timing==='live') return 'LIVE';
    const hours=Number(link.hoursFromNews);
    if (!Number.isFinite(hours)) return 'ближайший матч';
    if (hours>=0 && hours<2) return 'в течение 2 часов после новости';
    if (hours>=0 && hours<24) return `через ${Math.max(1,Math.round(hours))} ч после новости`;
    if (hours>=24) return `через ${Math.max(1,Math.round(hours/24))} дн. после новости`;
    return 'матч рядом по времени с новостью';
  }
  
  function newsFixtureChangeGuide(item = {}, link = null) {
    const category=String(item?.category?.code || '');
    if (!link?.fixture?.fixtureId) return '';
    if (category==='injury' || category==='suspension') return 'состав · глубина скамейки · баланс сил · рынок';
    if (category==='lineup') return 'стартовый состав · роли игроков · вероятности · рынок';
    if (category==='referee') return 'карточки · фолы · пенальти · темп';
    if (category==='weather') return 'темп · качество поля · интенсивность · тоталы';
    if (category==='coach') return 'схема · стиль · неопределённость · форма';
    if (category==='transfer') return 'доступность игрока · ротация · глубина состава';
    return 'состав · форма · рынок · AI-оценка';
  }
  
  function smartNewsMatchLinkDrill() {
    const item={publishedAt:'2026-09-20T12:00:00Z',category:{code:'injury'}};
    const fixtures=[
      {fixtureId:1,date:'2026-09-19T18:00:00Z',status:'FT',finished:true,homeName:'A',awayName:'B'},
      {fixtureId:2,date:'2026-09-21T18:00:00Z',status:'NS',homeName:'A',awayName:'C'},
      {fixtureId:3,date:'2026-09-28T18:00:00Z',status:'NS',homeName:'A',awayName:'D'},
    ];
    const best=newsRelevantFixture(item,fixtures);
    const label=newsFixtureTimingLabel(best);
    const guide=newsFixtureChangeGuide(item,best);
    const dayToken=newsPublishedDayToken(item);
    return {
      pass:best?.fixture?.fixtureId===2
        && best?.timing==='near_match'
        && label.includes('дн.')
        && guide.includes('состав')
        && dayToken==='20260920'
        && newsPublishedAtFromDayToken(dayToken)==='2026-09-20T12:00:00Z'
        && newsFixtureRelevance(item,fixtures[0]).score<newsFixtureRelevance(item,fixtures[1]).score,
      cases:7,
    };
  }
  
  function newsConversionHook(item = {}, { fixtureId=0, teamName='', fixtureLink=null } = {}) {
    const category=item?.category || {};
    const team=String(teamName || newsTeamHint(item)?.canonical || '').trim();
    if (fixtureId || fixtureLink?.fixture?.fixtureId) {
      const guide=newsFixtureChangeGuide(item,fixtureLink);
      if (guide) return `Перепроверить: ${guide}.`;
      if (category.code==='injury' || category.code==='suspension' || category.code==='lineup') return 'Проверить, меняет ли это состав, рынок и AI-оценку ближайшего матча.';
      if (category.code==='referee') return 'Проверить судью, карточки и темп в AI-контексте ближайшего матча.';
      if (category.code==='coach') return 'Проверить, изменился ли игровой контекст и уровень неопределённости перед матчем.';
      return 'Сверить новость с данными ближайшего матча и получить короткую AI-оценку.';
    }
    if (team) return `Найти ближайший матч ${team} и проверить, влияет ли новость на AI-разбор.`;
    return 'Сначала сверяем источник; без привязки к конкретному матчу AI-оценку не меняем.';
  }
  
  function newsConversionKeyboard(items = [], extraRows = [], { fixtureId=0, fixtures=[] } = {}) {
    const rows=[];
    for (const [index,item] of (items || []).slice(0,4).entries()) {
      const row=[{text:`↗ Источник ${index+1}`,url:item.url}];
      const smartLink=(fixtures || []).length ? newsRelevantFixture(item,fixtures) : null;
      const linkedFixtureId=Number(smartLink?.fixture?.fixtureId || fixtureId || 0);
      if (linkedFixtureId>0) {
        const dayToken=newsPublishedDayToken(item);
        row.push({text:'🧠 Проверить с AI',callback_data:`news:ai_match:${linkedFixtureId}${dayToken ? `:${dayToken}` : ''}`});
      } else {
        const hint=newsTeamHint(item);
        if (hint?.token) {
          const dayToken=newsPublishedDayToken(item);
          row.push({text:`🧠 ${String(hint.canonical).slice(0,18)}`,callback_data:`news:ai_team:${hint.token}${dayToken ? `:${dayToken}` : ''}`});
        }
      }
      rows.push(row);
    }
    return {inline_keyboard:[...rows,...extraRows]};
  }
  
  function newsConversionDrill() {
    const arsenal=newsTeamHint({title:'Arsenal injury update before Champions League match',content:''});
    const barca=newsTeamHint({title:'Барселона объявила состав на матч',content:''});
    const keyboard=newsConversionKeyboard([{title:'Arsenal team news',url:'https://example.com/a',content:'',category:{code:'lineup'}}],[],{});
    const callback=keyboard.inline_keyboard?.[0]?.[1]?.callback_data || '';
    const direct=newsConversionKeyboard([{title:'Club update',url:'https://example.com/b',content:'',category:{code:'club'}}],[],{fixtureId:998877});
    return {
      pass:arsenal?.canonical==='Arsenal'
        && barca?.canonical==='Barcelona'
        && callback==='news:ai_team:arsenal'
        && direct.inline_keyboard?.[0]?.[1]?.callback_data==='news:ai_match:998877'
        && newsTeamByToken('arsenal')?.canonical==='Arsenal',
      cases:5,
    };
  }
  
  function normalizeFootballNewsResult(row = {}) {
    const url=externalNewsUrl(row.url);
    const title=String(row.title || '').trim().slice(0,220);
    const content=String(row.content || '').replace(/\s+/g,' ').trim().slice(0,700);
    if (!url || !title || NEWS_BLOCKED_HOST_RE.test(url)) return null;
    const category=footballNewsCategory({title,content});
    return {
      title,url,content,
      source:newsSourceDomain(url),
      publishedAt:String(row.published_date || row.publishedAt || ''),
      category,
      sourceTier:newsSourceTrust(url).tier,
    };
  }
  
  function dedupeFootballNews(rows = [], limit = 6) {
    const seenUrl=new Set(), seenTitle=new Set();
    const out=[];
    for (const row of rows || []) {
      const item=normalizeFootballNewsResult(row);
      if (!item) continue;
      const tk=searchText(item.title).replace(/[^a-zа-я0-9 ]/gi,'').slice(0,90);
      if (seenUrl.has(item.url) || (tk && seenTitle.has(tk))) continue;
      seenUrl.add(item.url); if (tk) seenTitle.add(tk);
      out.push(applyNewsTrustGate(item));
    }
    const tierScore=x=>x.sourceTier==='official'?3:x.sourceTier==='major'?2:1;
    const impactScore=x=>x.category?.impact==='high'?3:x.category?.impact==='medium'?2:1;
    return out.sort((a,b)=>tierScore(b)-tierScore(a) || impactScore(b)-impactScore(a)).slice(0,limit);
  }
  
  async function tavilyNewsSearch(query, cfg, { days = 3, maxResults = 7 } = {}) {
    if (!cfg.tavilyKey) return { results:[], available:false, reason:'tavily_missing' };
    try {
      const r=await fetchWithTimeout('https://api.tavily.com/search',{
        method:'POST',
        headers:{Authorization:`Bearer ${cfg.tavilyKey}`,'Content-Type':'application/json'},
        body:JSON.stringify({
          query:String(query || '').slice(0,500),
          topic:'news',
          search_depth:'basic',
          max_results:Math.max(1,Math.min(10,Number(maxResults || 7))),
          days:Math.max(1,Math.min(14,Number(days || 3))),
          include_answer:false,
        }),
      }, 8000, 'Tavily news');
      if (!r.ok) return {results:[],available:false,reason:`http_${r.status}`};
      const body=await r.json();
      return {results:dedupeFootballNews(body.results || [],maxResults),available:true,reason:''};
    } catch (error) {
      return {results:[],available:false,reason:'network'};
    }
  }
  
  async function currentGeneralFootballNews(cfg, force = false) {
    const bucket=Math.floor(Date.now()/(30*60*1000));
    const key=`bot:news:general:${force ? bucket : 'current'}:v1`;
    if (!force) {
      const cached=await getCache('bot:news:general:current:v1',cfg).catch(()=>null);
      if (cached?.items) return {...cached,cached:true};
    }
    const search=await tavilyNewsSearch(
      'soccer football latest news injuries suspensions lineups coaches Champions League Premier League La Liga Serie A Bundesliga Ligue 1',
      cfg,{days:2,maxResults:7}
    );
    const payload={items:search.results || [],available:search.available,reason:search.reason,generatedAt:new Date().toISOString()};
    await setCache('bot:news:general:current:v1',0,payload,cfg,30).catch(()=>null);
    if (force) await setCache(key,0,payload,cfg,30).catch(()=>null);
    return {...payload,cached:false};
  }
  
  async function favoriteTeamFootballNews(team = {}, cfg, force = false) {
    const id=Number(team.team_id || team.id || 0);
    const name=String(team.team_name || team.name || '').trim();
    if (!id || !name) return {items:[],available:false,reason:'team_missing'};
    const key=`bot:news:team:${id}:v1`;
    if (!force) {
      const cached=await getCache(key,cfg).catch(()=>null);
      if (cached?.items) return {...cached,cached:true};
    }
    const search=await tavilyNewsSearch(`${name} football latest injuries suspension lineup coach team news`,cfg,{days:5,maxResults:6});
    const payload={teamId:id,teamName:name,items:search.results || [],available:search.available,reason:search.reason,generatedAt:new Date().toISOString()};
    await setCache(key,id,payload,cfg,30).catch(()=>null);
    return {...payload,cached:false};
  }
  
  function newsImpactBadge(impact = 'low') {
    if (impact === 'high') return '🔴 возможное сильное влияние';
    if (impact === 'medium') return '🟡 возможное влияние';
    return '⚪ контекст';
  }
  
  function newsFeedText(items = [], { title='MatchRadar AI · Новости', teamName='', fixture=null, fixtures=[] } = {}) {
    if (!items.length) return `📰 <b>${telegramHtmlEscape(title)}</b>\n\nСвежих новостей по этому запросу сейчас не найдено или источник новостей временно недоступен.`;
    const rows=items.slice(0,4).map((item,index)=>{
      const smartLink=(fixtures || []).length ? newsRelevantFixture(item,fixtures) : null;
      const linkedFixture=smartLink?.fixture || fixture || null;
      const why=footballNewsImpactText(item.category,Boolean(linkedFixture?.fixtureId));
      const hint=newsTeamHint(item);
      const hook=newsConversionHook(item,{fixtureId:Number(linkedFixture?.fixtureId || 0),teamName:teamName || hint?.canonical || '',fixtureLink:smartLink});
      const timing=smartLink ? newsFixtureTimingLabel(smartLink) : '';
      return [
        `${index+1}. ${item.category.icon} <b>${telegramHtmlEscape(item.title)}</b>`,
        `${telegramHtmlEscape(item.category.label)} · ${newsImpactBadge(item.category.impact)}`,
        `Почему важно: ${telegramHtmlEscape(why)}`,
        ...(linkedFixture?.fixtureId ? [`🎯 Матч: ${telegramHtmlEscape(linkedFixture.homeName || '')} — ${telegramHtmlEscape(linkedFixture.awayName || '')}${timing ? ` · ${telegramHtmlEscape(timing)}` : ''}`] : []),
        `🧠 Что проверить: ${telegramHtmlEscape(hook)}`,
        `Источник: ${telegramHtmlEscape(item.source || 'веб-источник')} · ${telegramHtmlEscape(item.trust?.label || 'Веб-источник')}`,
        ...(item.verification==='needs_confirmation' ? ['Проверка: требуется подтверждение ещё одним надёжным источником.'] : []),
      ].join('\n');
    });
    const intro=teamName ? `Новости по <b>${telegramHtmlEscape(teamName)}</b>` : '<b>Главное в футболе</b>';
    return [`📰 <b>${telegramHtmlEscape(title)}</b>`,intro,'',...rows.map(x=>x+'\n'),'MatchRadar AI не меняет прогноз только из-за заголовка: новость учитывается в анализе лишь вместе с подтверждёнными футбольными данными.'].join('\n');
  }
  
  async function sendGeneralFootballNews(request,cfg,userId,chatId,{force=false}={}) {
    void recordGrowthEvent(cfg,{userId,eventName:'news_open',channel:'telegram',metadata:{refresh:Boolean(force)}});
    const news=await currentGeneralFootballNews(cfg,force);
    const favorites=await getFavorites(userId,cfg).catch(()=>[]);
    const extra=[];
    if (favorites.length) {
      const teamButtons=favorites.slice(0,4).map(x=>({text:`⭐ ${String(x.team_name || 'Команда').slice(0,18)}`,callback_data:`news:team:${Number(x.team_id)}`}));
      for (let i=0;i<teamButtons.length;i+=2) extra.push(teamButtons.slice(i,i+2));
    }
    extra.push([{text:'🔄 Обновить новости',callback_data:'news:refresh'}]);
    await telegramApi('sendMessage',cfg,{
      chat_id:chatId,parse_mode:'HTML',
      text:newsFeedText(news.items,{title:'MatchRadar AI · Новости'}),
      reply_markup:newsConversionKeyboard(news.items,extra),
      disable_web_page_preview:true,
    });
  }
  
  async function sendFavoriteTeamNews(request,cfg,userId,chatId,teamId,{force=false}={}) {
    const favorites=await getFavorites(userId,cfg);
    const team=favorites.find(x=>Number(x.team_id)===Number(teamId));
    if (!team) {
      await telegramApi('sendMessage',cfg,{chat_id:chatId,text:'Эта команда не найдена в вашем избранном.'});
      return;
    }
    const [news,matches]=await Promise.all([
      favoriteTeamFootballNews(team,cfg,force),
      botTeamIdMatches(teamId,cfg).catch(()=>[]),
    ]);
    const fixture=newsRelevantFixture(news.items?.[0] || {},matches || [])?.fixture
      || (matches || []).find(x=>x.live || (!x.finished && Date.parse(x.date || 0)>=Date.now()-2*60*60*1000))
      || null;
    const extra=[];
    if (fixture?.fixtureId) extra.push([{text:'⚽ Проверить ближайший матч',callback_data:`news:match:${Number(fixture.fixtureId)}`}]);
    extra.push([{text:'🔄 Обновить',callback_data:`news:team_refresh:${Number(teamId)}`},{text:'📰 Все новости',callback_data:'news:general'}]);
    await telegramApi('sendMessage',cfg,{
      chat_id:chatId,parse_mode:'HTML',
      text:newsFeedText(news.items,{title:'MatchRadar AI · Новости',teamName:team.team_name || '',fixture,fixtures:matches || []}),
      reply_markup:newsConversionKeyboard(news.items,extra,{fixtureId:Number(fixture?.fixtureId || 0),fixtures:matches || []}),
      disable_web_page_preview:true,
    });
  }
  
  async function currentMorningFootballNews(cfg) {
    const date=todayUtc();
    const key=`bot:news:morning:${date}:v1`;
    const cached=await getCache(key,cfg).catch(()=>null);
    if (cached?.items) return cached;
    const news=await currentGeneralFootballNews(cfg,false);
    const payload={date,items:(news.items || []).slice(0,2),generatedAt:new Date().toISOString()};
    await setCache(key,0,payload,cfg,360).catch(()=>null);
    return payload;
  }
  
  function morningNewsText(items = []) {
    if (!items.length) return '';
    return ['📰 <b>Главное за утро</b>','',...items.slice(0,2).map((item,i)=>`${i+1}. ${item.category.icon} <b>${telegramHtmlEscape(item.title)}</b>\n${telegramHtmlEscape(item.category.label)} · ${newsImpactBadge(item.category.impact)}\nИсточник: ${telegramHtmlEscape(item.source || 'веб-источник')} · ${telegramHtmlEscape(item.trust?.label || 'Веб-источник')}`),'','Откройте источник или нажмите «Новости», чтобы увидеть объяснение MatchRadar AI.'].join('\n');
  }
  
  async function tavilySearch(query, cfg) {
    if (!cfg.tavilyKey) return { answer: '', results: [] };
    try {
      const r = await fetchWithTimeout('https://api.tavily.com/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.tavilyKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `${query}. Дай только проверяемые факты. Итоговую краткую сводку сформулируй на русском языке.`,
          topic: 'general',
          search_depth: 'basic',
          max_results: 5,
          include_answer: true,
        }),
      }, 8000, 'Tavily search');
      if (!r.ok) return { answer: '', results: [] };
      const body = await r.json();
      return {
        answer: String(body.answer || ''),
        results: (body.results || []).slice(0, 5).map(x => ({
          title: x.title || '', url: x.url || '', content: x.content || '',
        })),
      };
    } catch {
      return { answer: '', results: [] };
    }
  }

  return {
    externalNewsUrl,
    newsSourceDomain,
    newsSourceTrust,
    applyNewsTrustGate,
    footballNewsCategory,
    footballNewsImpactText,
    newsTeamToken,
    newsTeamByToken,
    newsPublishedDayToken,
    newsPublishedAtFromDayToken,
    newsTeamHint,
    newsPublishedMs,
    newsFixtureRelevance,
    newsRelevantFixture,
    newsFixtureTimingLabel,
    newsFixtureChangeGuide,
    smartNewsMatchLinkDrill,
    newsConversionHook,
    newsConversionKeyboard,
    newsConversionDrill,
    normalizeFootballNewsResult,
    dedupeFootballNews,
    tavilyNewsSearch,
    currentGeneralFootballNews,
    favoriteTeamFootballNews,
    newsImpactBadge,
    newsFeedText,
    sendGeneralFootballNews,
    sendFavoriteTeamNews,
    currentMorningFootballNews,
    morningNewsText,
    tavilySearch,
  };
}
