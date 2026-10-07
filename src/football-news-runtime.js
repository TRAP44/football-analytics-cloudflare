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

  for (const [name,value] of Object.entries({
    NEWS_BLOCKED_HOST_RE,
    NEWS_MAJOR_SOURCE_RE,
    NEWS_OFFICIAL_SOURCE_RE,
  })) {
    if (!(value instanceof RegExp)) throw new TypeError(`${name} is required`);
  }
  if (!TOP_TEAM_SEARCH_CATALOG || typeof TOP_TEAM_SEARCH_CATALOG[Symbol.iterator]!=='function') {
    throw new TypeError('TOP_TEAM_SEARCH_CATALOG is required');
  }
  for (const [name,fn] of Object.entries({
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
  })) {
    if (typeof fn!=='function') throw new TypeError(`${name} is required`);
  }

  function plainObject(value) {
    try {
      return value && typeof value==='object' && !Array.isArray(value)
        ? value
        : null;
    } catch {
      return null;
    }
  }

  function safeRead(value,key) {
    try {
      return value?.[key];
    } catch {
      return undefined;
    }
  }

  function safeText(value,max=500,fallback='') {
    if (typeof value!=='string') return fallback;
    const text=value
      .replace(/[\u0000-\u001f\u007f]+/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .slice(0,max);
    return text || fallback;
  }

  function positiveInteger(value) {
    if (typeof value==='number') {
      return Number.isSafeInteger(value) && value>0 ? value : 0;
    }
    if (typeof value!=='string') return 0;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return 0;
    const parsed=Number(raw);
    return Number.isSafeInteger(parsed) && parsed>0 ? parsed : 0;
  }

  function boundedInteger(value,fallback,min,max) {
    if (typeof value!=='number' || !Number.isFinite(value)) return fallback;
    return Math.max(min,Math.min(max,Math.trunc(value)));
  }

  function testRegex(regex,value) {
    try {
      regex.lastIndex=0;
      return regex.test(value);
    } catch {
      return false;
    }
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function safeCall(fn,...args) {
    try {
      return fn(...args);
    } catch {
      return undefined;
    }
  }

  function html(value) {
    const text=safeText(value,1200);
    const escaped=safeCall(telegramHtmlEscape,text);
    return typeof escaped==='string' ? escaped : '';
  }

  function strictPublishedMs(value) {
    if (typeof value!=='string' || !value.trim()) return null;
    const raw=value.trim();
    const dateOnly=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (dateOnly) {
      const year=Number(dateOnly[1]);
      const month=Number(dateOnly[2]);
      const day=Number(dateOnly[3]);
      if (month<1 || month>12 || day<1) return null;
      const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
      if (day>maxDay) return null;
      return Date.UTC(year,month-1,day,12,0,0);
    }
    const timestamp=/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(raw);
    if (!timestamp) return null;
    const year=Number(timestamp[1]);
    const month=Number(timestamp[2]);
    const day=Number(timestamp[3]);
    if (month<1 || month>12 || day<1) return null;
    const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
    if (day>maxDay) return null;
    const parsed=Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function externalNewsUrl(value = '') {
    if (typeof value!=='string' || !value.trim()) return '';
    try {
      const u=new URL(value.trim());
      if (!/^https?:$/.test(u.protocol) || u.username || u.password) return '';
      return u.toString();
    } catch {
      return '';
    }
  }
  
  function newsSourceDomain(value = '') {
    const url=externalNewsUrl(value);
    if (!url) return '';
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./,'');
    } catch {
      return '';
    }
  }
  
  function newsSourceTrust(url = '') {
    const host=newsSourceDomain(url);
    if (!host) return {tier:'web',score:0,label:'Источник не подтверждён'};
    if (testRegex(NEWS_OFFICIAL_SOURCE_RE,host)) return {tier:'official',score:95,label:'Официальный источник'};
    if (testRegex(NEWS_MAJOR_SOURCE_RE,host)) return {tier:'major',score:88,label:'Крупный источник'};
    return {tier:'web',score:58,label:'Веб-источник'};
  }
  
  function applyNewsTrustGate(item = {}) {
    const value=plainObject(item) || {};
    const trust=newsSourceTrust(safeRead(value,'url'));
    const category=plainObject(safeRead(value,'category')) || {};
    const originalImpact=safeText(safeRead(category,'impact'),20,'low');
    const needsConfirmation=originalImpact==='high' && !['official','major'].includes(trust.tier);
    return {
      ...value,
      trust,
      verification:needsConfirmation ? 'needs_confirmation' : 'source_backed',
      category:needsConfirmation ? {...category,impact:'medium'} : category,
    };
  }
  
  function footballNewsCategory(article = {}) {
    const value=plainObject(article) || {};
    const title=safeText(safeRead(value,'title'),220);
    const content=safeText(safeRead(value,'content'),700);
    let hay='';
    try {
      const normalized=searchText(`${title} ${content}`);
      hay=typeof normalized==='string' ? normalized : '';
    } catch {}
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
    const value=plainObject(team) || {};
    return safeText(safeRead(value,'canonical'),80)
      .toLowerCase()
      .replace(/[^a-z0-9]/g,'')
      .slice(0,32);
  }
  
  function newsTeamByToken(token = '') {
    if (typeof token!=='string') return null;
    const clean=token
      .toLowerCase()
      .replace(/[^a-z0-9]/g,'')
      .slice(0,32);
    if (!clean) return null;
    for (const team of TOP_TEAM_SEARCH_CATALOG) {
      if (newsTeamToken(team)===clean) return team;
    }
    return null;
  }
  
  function newsPublishedDayToken(item = {}) {
    const ms=newsPublishedMs(item);
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toISOString().slice(0,10).replace(/-/g,'');
  }
  
  function newsPublishedAtFromDayToken(token = '') {
    if (typeof token!=='string' || !/^\d{8}$/.test(token)) return '';
    const iso=`${token.slice(0,4)}-${token.slice(4,6)}-${token.slice(6,8)}T12:00:00Z`;
    return strictPublishedMs(iso)!==null ? iso : '';
  }
  
  function newsTeamHint(item = {}) {
    const value=plainObject(item) || {};
    const title=safeText(safeRead(value,'title'),220);
    const content=safeText(safeRead(value,'content'),700);
    const normalized=safeCall(searchText,`${title} ${content}`);
    const hay=` ${typeof normalized==='string' ? normalized : ''} `;
    if (!hay.trim()) return null;
    let best=null;
    for (const rawTeam of TOP_TEAM_SEARCH_CATALOG) {
      const team=plainObject(rawTeam);
      if (!team) continue;
      const canonical=safeText(safeRead(team,'canonical'),80);
      const aliases=safeArray(safeRead(team,'aliases'));
      const terms=[canonical,...aliases]
        .map(term=>safeCall(searchText,safeText(term,80)))
        .filter(term=>typeof term==='string' && term && (
          term.length>=4
          || ['psg','bvb','psv','ajax','juve','lafc','rma','fcb'].includes(term)
        ));
      for (const term of terms) {
        if (!hay.includes(` ${term} `)) continue;
        const score=(term.includes(' ')?120:60)+Math.min(80,term.length*4);
        if (!best || score>best.score) {
          best={
            canonical,
            country:safeText(safeRead(team,'country'),80),
            token:newsTeamToken(team),
            score,
          };
        }
      }
    }
    return best;
  }
  
  function newsPublishedMs(item = {}) {
    const value=plainObject(item) || {};
    return strictPublishedMs(
      safeText(
        safeRead(value,'publishedAt') || safeRead(value,'published_date'),
        80,
      ),
    );
  }
  
  function newsFixtureRelevance(item = {}, fixture = {}) {
    const normalized=safeCall(normalizeBotFixtureCard,fixture);
    const match=plainObject(normalized) || {};
    const fixtureId=positiveInteger(safeRead(match,'fixtureId'));
    const fixtureMs=strictPublishedMs(safeText(safeRead(match,'date'),80));
    if (!fixtureId || fixtureMs===null) {
      return {
        score:-Infinity,
        fixture:match,
        timing:'invalid',
        hoursFromNews:null,
      };
    }
    const publishedMs=newsPublishedMs(item);
    const now=Date.now();
    const baseMs=publishedMs ?? now;
    const hours=(fixtureMs-baseMs)/3600000;
    let score=0;
    let timing='next_match';
    const live=safeRead(match,'live')===true;
    const finished=safeRead(match,'finished')===true;
  
    if (live) {
      score=520;
      timing='live';
    } else if (!finished && hours>=-3) {
      if (hours<=24) { score=460-Math.max(0,hours)*2; timing='pre_match'; }
      else if (hours<=72) { score=390-(hours-24); timing='near_match'; }
      else if (hours<=24*14) { score=310-(hours/24)*5; timing='next_match'; }
      else { score=190-Math.min(120,hours/24); timing='future'; }
    } else if (!finished && publishedMs===null) {
      const hoursFromNow=(fixtureMs-now)/3600000;
      score=hoursFromNow>=-3
        ? 260-Math.min(180,Math.max(0,hoursFromNow)/2)
        : 20;
      timing='next_match';
    } else {
      const ageHours=Math.abs(hours);
      score=Math.max(5,80-Math.min(75,ageHours/3));
      timing='past_match';
    }
  
    const itemValue=plainObject(item) || {};
    const category=plainObject(safeRead(itemValue,'category')) || {};
    const categoryCode=safeText(safeRead(category,'code'),30);
    if (
      ['lineup','injury','suspension','referee','weather'].includes(categoryCode)
      && !finished
    ) score+=35;
    if (categoryCode==='coach' && !finished) score+=20;
    return {
      score,
      fixture:{...match,fixtureId},
      timing,
      hoursFromNews:Number.isFinite(hours) ? hours : null,
    };
  }
  
  function newsRelevantFixture(item = {}, fixtures = []) {
    const ranked=safeArray(fixtures)
      .map(fixture=>newsFixtureRelevance(item,fixture))
      .filter(entry=>
        typeof safeRead(entry,'score')==='number'
        && Number.isFinite(safeRead(entry,'score'))
        && positiveInteger(safeRead(plainObject(safeRead(entry,'fixture')),'fixtureId'))
      )
      .sort((a,b)=>
        b.score-a.score
        || (
          strictPublishedMs(safeText(safeRead(a.fixture,'date'),80)) ?? Infinity
        ) - (
          strictPublishedMs(safeText(safeRead(b.fixture,'date'),80)) ?? Infinity
        )
      );
    const best=ranked[0] || null;
    if (!best) return null;
    if (best.timing==='past_match') {
      return ranked.find(entry=>entry.timing!=='past_match') || best;
    }
    return best;
  }
  
  function newsFixtureTimingLabel(link = {}) {
    const value=plainObject(link) || {};
    const fixture=plainObject(safeRead(value,'fixture')) || {};
    if (!positiveInteger(safeRead(fixture,'fixtureId'))) return '';
    if (safeRead(value,'timing')==='live') return 'LIVE';
    const rawHours=safeRead(value,'hoursFromNews');
    const hours=typeof rawHours==='number' && Number.isFinite(rawHours)
      ? rawHours
      : null;
    if (hours===null) return 'ближайший матч';
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
  
  function newsConversionKeyboard(items = [], extraRows = [], options = {}) {
    const rows=[];
    const fixtures=safeArray(safeRead(options,'fixtures'));
    const fallbackFixtureId=positiveInteger(safeRead(options,'fixtureId'));
    for (const [index,item] of safeArray(items).slice(0,4).entries()) {
      const value=plainObject(item);
      if (!value) continue;
      const url=externalNewsUrl(safeRead(value,'url'));
      if (!url) continue;
      const row=[{text:`↗ Источник ${index+1}`,url}];
      const smartLink=fixtures.length ? newsRelevantFixture(value,fixtures) : null;
      const linkedFixtureId=
        positiveInteger(safeRead(plainObject(safeRead(smartLink,'fixture')),'fixtureId'))
        || fallbackFixtureId;
      if (linkedFixtureId>0) {
        const dayToken=newsPublishedDayToken(value);
        row.push({text:'🧠 Проверить с AI',callback_data:`news:ai_match:${linkedFixtureId}${dayToken ? `:${dayToken}` : ''}`});
      } else {
        const hint=newsTeamHint(value);
        const token=safeText(safeRead(hint,'token'),32);
        if (token) {
          const dayToken=newsPublishedDayToken(value);
          const canonical=safeText(safeRead(hint,'canonical'),18,'Команда');
          row.push({text:`🧠 ${canonical}`,callback_data:`news:ai_team:${token}${dayToken ? `:${dayToken}` : ''}`});
        }
      }
      rows.push(row);
    }
    return {
      inline_keyboard:[
        ...rows,
        ...safeArray(extraRows).filter(Array.isArray),
      ],
    };
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
    const value=plainObject(row);
    if (!value) return null;
    const url=externalNewsUrl(safeRead(value,'url'));
    const title=safeText(safeRead(value,'title'),220);
    const content=safeText(safeRead(value,'content'),700);
    const host=newsSourceDomain(url);
    if (!url || !host || !title || testRegex(NEWS_BLOCKED_HOST_RE,host)) return null;
    const category=footballNewsCategory({title,content});
    const publishedRaw=safeText(
      safeRead(value,'published_date') || safeRead(value,'publishedAt'),
      80,
    );
    const publishedMs=strictPublishedMs(publishedRaw);
    return {
      title,
      url,
      content,
      source:host,
      publishedAt:publishedMs===null ? '' : new Date(publishedMs).toISOString(),
      category,
      sourceTier:newsSourceTrust(url).tier,
    };
  }
  
  function dedupeFootballNews(rows = [], limit = 6) {
    const seenUrl=new Set();
    const seenTitle=new Set();
    const out=[];
    const safeLimit=boundedInteger(limit,6,1,10);
    for (const row of safeArray(rows).slice(0,50)) {
      const item=normalizeFootballNewsResult(row);
      if (!item) continue;
      let tk='';
      try {
        const normalized=searchText(item.title);
        tk=(typeof normalized==='string' ? normalized : '')
          .replace(/[^a-zа-я0-9 ]/gi,'')
          .slice(0,90);
      } catch {}
      if (seenUrl.has(item.url) || (tk && seenTitle.has(tk))) continue;
      seenUrl.add(item.url);
      if (tk) seenTitle.add(tk);
      out.push(applyNewsTrustGate(item));
    }
    const tierScore=x=>safeRead(x,'sourceTier')==='official'?3:safeRead(x,'sourceTier')==='major'?2:1;
    const impactScore=x=>{
      const category=plainObject(safeRead(x,'category')) || {};
      const impact=safeRead(category,'impact');
      return impact==='high'?3:impact==='medium'?2:1;
    };
    return out
      .sort((a,b)=>tierScore(b)-tierScore(a) || impactScore(b)-impactScore(a))
      .slice(0,safeLimit);
  }
  
  async function tavilyNewsSearch(query, cfg, options = {}) {
    const config=plainObject(cfg) || {};
    const tavilyKey=safeText(safeRead(config,'tavilyKey'),500);
    if (!tavilyKey) return {results:[],available:false,reason:'tavily_missing'};
    const queryText=safeText(query,500);
    if (!queryText) return {results:[],available:false,reason:'query_invalid'};
    const days=boundedInteger(safeRead(options,'days'),3,1,14);
    const maxResults=boundedInteger(safeRead(options,'maxResults'),7,1,10);
    try {
      const r=await fetchWithTimeout('https://api.tavily.com/search',{
        method:'POST',
        headers:{Authorization:`Bearer ${tavilyKey}`,'Content-Type':'application/json'},
        body:JSON.stringify({
          query:queryText,
          topic:'news',
          search_depth:'basic',
          max_results:maxResults,
          days,
          include_answer:false,
        }),
      },8000,'Tavily news');
      if (safeRead(r,'ok')!==true) {
        const status=positiveInteger(safeRead(r,'status'));
        return {
          results:[],
          available:false,
          reason:status ? `http_${status}` : 'http_error',
        };
      }
      const json=safeRead(r,'json');
      if (typeof json!=='function') {
        return {results:[],available:false,reason:'invalid_payload'};
      }
      const body=plainObject(await json.call(r));
      const rows=safeRead(body,'results');
      if (!Array.isArray(rows)) {
        return {results:[],available:false,reason:'invalid_payload'};
      }
      return {
        results:dedupeFootballNews(rows,maxResults),
        available:true,
        reason:'',
      };
    } catch {
      return {results:[],available:false,reason:'network'};
    }
  }
  
  async function currentGeneralFootballNews(cfg, force = false) {
    const refresh=force===true;
    const bucket=Math.floor(Date.now()/(30*60*1000));
    const key=`bot:news:general:${refresh ? bucket : 'current'}:v2`;
    if (!refresh) {
      const cached=plainObject(
        await Promise.resolve(getCache('bot:news:general:current:v2',cfg))
          .catch(()=>null),
      );
      const cachedItems=safeRead(cached,'items');
      if (Array.isArray(cachedItems)) {
        return {
          items:dedupeFootballNews(cachedItems,7),
          available:safeRead(cached,'available')===true,
          reason:safeText(safeRead(cached,'reason'),80),
          generatedAt:safeText(safeRead(cached,'generatedAt'),80),
          cached:true,
        };
      }
    }
    const search=await tavilyNewsSearch(
      'soccer football latest news injuries suspensions lineups coaches Champions League Premier League La Liga Serie A Bundesliga Ligue 1',
      cfg,{days:2,maxResults:7},
    );
    const payload={
      items:safeArray(safeRead(search,'results')),
      available:safeRead(search,'available')===true,
      reason:safeText(safeRead(search,'reason'),80),
      generatedAt:new Date().toISOString(),
    };
    await Promise.resolve(
      setCache('bot:news:general:current:v2',0,payload,cfg,30),
    ).catch(()=>null);
    if (refresh) {
      await Promise.resolve(setCache(key,0,payload,cfg,30)).catch(()=>null);
    }
    return {...payload,cached:false};
  }
  
  async function favoriteTeamFootballNews(team = {}, cfg, force = false) {
    const value=plainObject(team) || {};
    const id=
      positiveInteger(safeRead(value,'team_id'))
      || positiveInteger(safeRead(value,'id'));
    const name=
      safeText(safeRead(value,'team_name'),120)
      || safeText(safeRead(value,'name'),120);
    if (!id || !name) {
      return {items:[],available:false,reason:'team_missing'};
    }
    const key=`bot:news:team:${id}:v2`;
    if (force!==true) {
      const cached=plainObject(
        await Promise.resolve(getCache(key,cfg)).catch(()=>null),
      );
      const cachedItems=safeRead(cached,'items');
      if (Array.isArray(cachedItems)) {
        return {
          teamId:id,
          teamName:name,
          items:dedupeFootballNews(cachedItems,6),
          available:safeRead(cached,'available')===true,
          reason:safeText(safeRead(cached,'reason'),80),
          generatedAt:safeText(safeRead(cached,'generatedAt'),80),
          cached:true,
        };
      }
    }
    const search=await tavilyNewsSearch(
      `${name} football latest injuries suspension lineup coach team news`,
      cfg,
      {days:5,maxResults:6},
    );
    const payload={
      teamId:id,
      teamName:name,
      items:safeArray(safeRead(search,'results')),
      available:safeRead(search,'available')===true,
      reason:safeText(safeRead(search,'reason'),80),
      generatedAt:new Date().toISOString(),
    };
    await Promise.resolve(setCache(key,id,payload,cfg,30)).catch(()=>null);
    return {...payload,cached:false};
  }
  
  function newsImpactBadge(impact = 'low') {
    if (impact === 'high') return '🔴 возможное сильное влияние';
    if (impact === 'medium') return '🟡 возможное влияние';
    return '⚪ контекст';
  }
  
  function newsFeedText(items = [], options = {}) {
    const title=safeText(safeRead(options,'title'),120,'MatchRadar AI · Новости');
    const teamName=safeText(safeRead(options,'teamName'),120);
    const fixture=plainObject(safeRead(options,'fixture'));
    const fixtures=safeArray(safeRead(options,'fixtures'));
    const validItems=safeArray(items)
      .map(normalizeFootballNewsResult)
      .filter(Boolean)
      .map(applyNewsTrustGate)
      .slice(0,4);
    if (!validItems.length) {
      return `📰 <b>${html(title)}</b>\n\nСвежих новостей по этому запросу сейчас не найдено или источник новостей временно недоступен.`;
    }
    const rows=validItems.map((item,index)=>{
      const smartLink=fixtures.length ? newsRelevantFixture(item,fixtures) : null;
      const linkedFixture=plainObject(safeRead(smartLink,'fixture')) || fixture || null;
      const linkedFixtureId=positiveInteger(safeRead(linkedFixture,'fixtureId'));
      const category=plainObject(safeRead(item,'category')) || {};
      const why=footballNewsImpactText(category,linkedFixtureId>0);
      const hint=newsTeamHint(item);
      const hook=newsConversionHook(item,{
        fixtureId:linkedFixtureId,
        teamName:teamName || safeText(safeRead(hint,'canonical'),80),
        fixtureLink:smartLink,
      });
      const timing=smartLink ? newsFixtureTimingLabel(smartLink) : '';
      const trust=plainObject(safeRead(item,'trust')) || {};
      return [
        `${index+1}. ${safeText(safeRead(category,'icon'),8,'📰')} <b>${html(safeRead(item,'title'))}</b>`,
        `${html(safeRead(category,'label') || 'Футбол')} · ${newsImpactBadge(safeRead(category,'impact'))}`,
        `Почему важно: ${html(why)}`,
        ...(linkedFixtureId ? [`🎯 Матч: ${html(safeRead(linkedFixture,'homeName'))} — ${html(safeRead(linkedFixture,'awayName'))}${timing ? ` · ${html(timing)}` : ''}`] : []),
        `🧠 Что проверить: ${html(hook)}`,
        `Источник: ${html(safeRead(item,'source') || 'веб-источник')} · ${html(safeRead(trust,'label') || 'Веб-источник')}`,
        ...(safeRead(item,'verification')==='needs_confirmation' ? ['Проверка: требуется подтверждение ещё одним надёжным источником.'] : []),
      ].join('\n');
    });
    const intro=teamName ? `Новости по <b>${html(teamName)}</b>` : '<b>Главное в футболе</b>';
    return [
      `📰 <b>${html(title)}</b>`,
      intro,
      '',
      ...rows.map(row=>row+'\n'),
      'MatchRadar AI не меняет прогноз только из-за заголовка: новость учитывается в анализе лишь вместе с подтверждёнными футбольными данными.',
    ].join('\n');
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
    const date=safeText(todayUtc(),16);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return {
        date:'',
        items:[],
        available:false,
        degraded:true,
        reason:'date_invalid',
        generatedAt:new Date().toISOString(),
      };
    }
    const key=`bot:news:morning:${date}:v2`;
    const cached=plainObject(
      await Promise.resolve(getCache(key,cfg)).catch(()=>null),
    );
    const cachedItems=safeRead(cached,'items');
    if (Array.isArray(cachedItems)) {
      return {
        date,
        items:dedupeFootballNews(cachedItems,2),
        available:safeRead(cached,'available')===true,
        degraded:safeRead(cached,'degraded')===true,
        reason:safeText(safeRead(cached,'reason'),80),
        generatedAt:safeText(safeRead(cached,'generatedAt'),80),
        cached:true,
      };
    }
    const news=await currentGeneralFootballNews(cfg,false);
    const payload={
      date,
      items:dedupeFootballNews(safeRead(news,'items'),2),
      available:safeRead(news,'available')===true,
      degraded:safeRead(news,'available')!==true,
      reason:safeText(safeRead(news,'reason'),80),
      generatedAt:new Date().toISOString(),
    };
    await Promise.resolve(setCache(key,0,payload,cfg,360)).catch(()=>null);
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
