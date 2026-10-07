// Search and team-discovery orchestration extracted from worker.js.
// Provider/cache/domain primitives are injected by the composition root.
export function createSearchDiscoveryRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Search discovery runtime dependencies are required.');
  }
  const {
    COMPETITIONS,
    apiFootball,
    freeQuotaHealthy,
    getCache,
    getStaleCache,
    isFootballRateLimitError,
    isRetryableFootballTransportError,
    isYouthReserveMatch,
    json,
    loadProviderTeamDiscoveryFixtures,
    normalizeCountryName,
    normalizeTeamHubMatch,
    publicDataCapabilities,
    setCache,
  } = deps;

  const requiredFunctions={
    apiFootball,
    freeQuotaHealthy,
    getCache,
    getStaleCache,
    isFootballRateLimitError,
    isRetryableFootballTransportError,
    isYouthReserveMatch,
    json,
    loadProviderTeamDiscoveryFixtures,
    normalizeCountryName,
    normalizeTeamHubMatch,
    publicDataCapabilities,
    setCache,
  };
  for (const [name,fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }
  if (!(COMPETITIONS instanceof Map)) throw new TypeError('COMPETITIONS is required');

  function rows(value) {
    return Array.isArray(value) ? value : [];
  }

  function safeText(value, max = 160) {
    if (!['string','number','bigint'].includes(typeof value)) return '';
    return String(value).trim().slice(0,max);
  }

  function positiveSafeInteger(value) {
    if (value === null || value === undefined || value === '') return null;
    const number=Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function safeSeason(value, fallback = new Date().getUTCFullYear()) {
    const number=Number(value);
    const current=new Date().getUTCFullYear();
    if (Number.isSafeInteger(number) && number>=1900 && number<=current+2) return number;
    const fallbackNumber=Number(fallback);
    return Number.isSafeInteger(fallbackNumber) && fallbackNumber>=1900 && fallbackNumber<=current+2
      ? fallbackNumber
      : null;
  }

  function finiteScore(value, fallback = 0) {
    const number=Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function safeLimit(value, fallback, max = 20) {
    const number=positiveSafeInteger(value);
    return number ? Math.min(max,number) : fallback;
  }

  function providerRows(value, label = 'search') {
    if (Array.isArray(value)) return value;
    const error=new Error(`API-Football returned an invalid ${label} payload.`);
    error.code='FOOTBALL_INVALID_RESPONSE';
    throw error;
  }

  function recoverableProviderError(error) {
    return isFootballRateLimitError(error)
      || isRetryableFootballTransportError(error)
      || String(error?.code || '') === 'FOOTBALL_INVALID_RESPONSE';
  }

  function quotaHealthy(reserve, cost) {
    try { return freeQuotaHealthy(reserve,cost) === true; }
    catch { return false; }
  }

  function capabilities() {
    try {
      const value=publicDataCapabilities();
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function competitionCachePayload(value, leagueId) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.matches)) return null;
    const sourceId=positiveSafeInteger(value?.matchSource?.id);
    if (sourceId && sourceId !== leagueId) return null;
    return value;
  }

  function teamFixtureCachePayload(value, teamId) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.fixtures)) return null;
    const sourceId=positiveSafeInteger(value?.teamId);
    if (sourceId && sourceId !== teamId) return null;
    return value;
  }

  function teamSearchCachePayload(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.teams)) return null;
    return value;
  }

  const SEARCH_COMPETITION_ALIASES = new Map([
    [1, 'world cup чемпионат мира чм fifa'],
    [2, 'champions league ucl лига чемпионов лч'],
    [3, 'europa league uel лига европы ле'],
    [4, 'euro european championship евро'],
    [9, 'copa america копа америка'],
    [15, 'club world cup клубный чемпионат мира кчм'],
    [39, 'premier league epl english premier league апл премьер лига англия'],
    [40, 'championship efl championship чемпионшип англия'],
    [45, 'fa cup кубок англии'],
    [48, 'efl cup carabao cup league cup кубок лиги англия'],
    [61, 'ligue 1 лига 1 франция'],
    [62, 'ligue 2 лига 2 франция'],
    [66, 'coupe de france кубок франции'],
    [71, 'brasileirao serie a brazil бразилия серия а'],
    [78, 'bundesliga бундеслига германия'],
    [79, '2 bundesliga вторая бундеслига германия'],
    [81, 'dfb pokal кубок германии'],
    [88, 'eredivisie эредивизи нидерланды'],
    [94, 'primeira liga португалия примейра лига'],
    [128, 'argentina liga profesional аргентина'],
    [135, 'serie a italy серия а италия'],
    [136, 'serie b italy серия b италия'],
    [137, 'coppa italia кубок италии'],
    [140, 'la liga laliga примера испания ла лига'],
    [141, 'segunda division сегунда испания'],
    [143, 'copa del rey кубок испании'],
    [203, 'super lig turkey суперлига турция'],
    [253, 'mls major league soccer сша'],
    [307, 'saudi pro league саудовская про лига'],
    [848, 'conference league uecl лига конференций лк'],
  ]);
  
  const TOP_TEAM_SEARCH_CATALOG = Object.freeze([
    { canonical:'Arsenal', country:'England', aliases:['арсенал','arsenal'] },
    { canonical:'Chelsea', country:'England', aliases:['челси','chelsea'] },
    { canonical:'Liverpool', country:'England', aliases:['ливерпуль','liverpool'] },
    { canonical:'Manchester City', country:'England', aliases:['ман сити','манчестер сити','man city','mancity','manchester city','сити'] },
    { canonical:'Manchester United', country:'England', aliases:['ман юнайтед','манчестер юнайтед','man united','man utd','manchester united','мю'] },
    { canonical:'Tottenham', country:'England', aliases:['тоттенхэм','тоттенхем','шпоры','tottenham','spurs'] },
    { canonical:'Newcastle', country:'England', aliases:['ньюкасл','newcastle'] },
    { canonical:'Aston Villa', country:'England', aliases:['астон вилла','aston villa','вилла'] },
    { canonical:'Real Madrid', country:'Spain', aliases:['реал','реал мадрид','real madrid','real','rma'] },
    { canonical:'Barcelona', country:'Spain', aliases:['барселона','барса','barcelona','barca','fcb'] },
    { canonical:'Atletico Madrid', country:'Spain', aliases:['атлетико','атлетико мадрид','atletico','atletico madrid'] },
    { canonical:'Athletic Club', country:'Spain', aliases:['атлетик бильбао','атлетик','athletic bilbao','athletic club'] },
    { canonical:'Sevilla', country:'Spain', aliases:['севилья','sevilla'] },
    { canonical:'Villarreal', country:'Spain', aliases:['вильярреал','villarreal'] },
    { canonical:'Real Sociedad', country:'Spain', aliases:['реал сосьедад','сосьедад','real sociedad'] },
    { canonical:'Inter', country:'Italy', aliases:['интер','интер милан','inter','inter milan','internazionale'] },
    { canonical:'AC Milan', country:'Italy', aliases:['милан','ac milan','milan'] },
    { canonical:'Juventus', country:'Italy', aliases:['ювентус','юве','juventus','juve'] },
    { canonical:'Napoli', country:'Italy', aliases:['наполи','napoli'] },
    { canonical:'AS Roma', country:'Italy', aliases:['рома','roma','as roma'] },
    { canonical:'Lazio', country:'Italy', aliases:['лацио','lazio'] },
    { canonical:'Atalanta', country:'Italy', aliases:['аталанта','atalanta'] },
    { canonical:'Bayern Munich', country:'Germany', aliases:['бавария','bayern','bayern munich','bayern munchen','бавария мюнхен'] },
    { canonical:'Borussia Dortmund', country:'Germany', aliases:['боруссия дортмунд','дортмунд','borussia dortmund','dortmund','bvb'] },
    { canonical:'Bayer Leverkusen', country:'Germany', aliases:['байер','байер леверкузен','bayer leverkusen','leverkusen'] },
    { canonical:'RB Leipzig', country:'Germany', aliases:['лейпциг','rb leipzig','leipzig'] },
    { canonical:'Eintracht Frankfurt', country:'Germany', aliases:['айнтрахт','айнтрахт франкфурт','eintracht frankfurt','frankfurt'] },
    { canonical:'Paris Saint Germain', country:'France', aliases:['псж','пари сен жермен','psg','paris saint germain','paris'] },
    { canonical:'Marseille', country:'France', aliases:['марсель','marseille','om'] },
    { canonical:'Monaco', country:'France', aliases:['монако','monaco'] },
    { canonical:'Lyon', country:'France', aliases:['лион','lyon'] },
    { canonical:'Lille', country:'France', aliases:['лиль','lille'] },
    { canonical:'Benfica', country:'Portugal', aliases:['бенфика','benfica'] },
    { canonical:'FC Porto', country:'Portugal', aliases:['порту','porto','fc porto'] },
    { canonical:'Sporting CP', country:'Portugal', aliases:['спортинг','sporting','sporting cp','спортинг лиссабон'] },
    { canonical:'Ajax', country:'Netherlands', aliases:['аякс','ajax'] },
    { canonical:'PSV Eindhoven', country:'Netherlands', aliases:['псв','psv','psv eindhoven'] },
    { canonical:'Feyenoord', country:'Netherlands', aliases:['фейеноорд','feyenoord'] },
    { canonical:'Galatasaray', country:'Turkey', aliases:['галатасарай','galatasaray'] },
    { canonical:'Fenerbahce', country:'Turkey', aliases:['фенербахче','fenerbahce','fenerbahçe'] },
    { canonical:'Besiktas', country:'Turkey', aliases:['бешикташ','besiktas','beşiktaş'] },
    { canonical:'Celtic', country:'Scotland', aliases:['селтик','celtic'] },
    { canonical:'Rangers', country:'Scotland', aliases:['рейнджерс','rangers'] },
    { canonical:'Club Brugge', country:'Belgium', aliases:['брюгге','club brugge','brugge'] },
    { canonical:'Shakhtar Donetsk', country:'Ukraine', aliases:['шахтер','шахтёр','шахтер донецк','shakhtar','shakhtar donetsk'] },
    { canonical:'Dynamo Kyiv', country:'Ukraine', aliases:['динамо киев','динамо київ','dynamo kyiv','dynamo kiev'] },
    { canonical:'Al-Hilal Saudi FC', country:'Saudi-Arabia', aliases:['аль хилаль','ал хилаль','al hilal','al-hilal'] },
    { canonical:'Al-Nassr', country:'Saudi-Arabia', aliases:['аль наср','ал наср','al nassr','al-nassr'] },
    { canonical:'Al-Ittihad FC', country:'Saudi-Arabia', aliases:['аль иттихад','ал иттихад','al ittihad','al-ittihad'] },
    { canonical:'Inter Miami', country:'USA', aliases:['интер майами','inter miami','майами'] },
    { canonical:'Los Angeles FC', country:'USA', aliases:['лафк','lafc','los angeles fc'] },
    { canonical:'Flamengo', country:'Brazil', aliases:['фламенго','flamengo'] },
    { canonical:'Palmeiras', country:'Brazil', aliases:['палмейрас','palmeiras'] },
    { canonical:'Corinthians', country:'Brazil', aliases:['коринтианс','corinthians'] },
    { canonical:'Sao Paulo', country:'Brazil', aliases:['сао паулу','сан паулу','sao paulo','são paulo'] },
    { canonical:'Fluminense', country:'Brazil', aliases:['флуминенсе','fluminense'] },
    { canonical:'Botafogo', country:'Brazil', aliases:['ботафого','botafogo'] },
    { canonical:'River Plate', country:'Argentina', aliases:['ривер плейт','ривер','river plate','river'] },
    { canonical:'Boca Juniors', country:'Argentina', aliases:['бока хуниорс','бока','boca juniors','boca'] },
    { canonical:'Racing Club', country:'Argentina', aliases:['расинг','racing club','racing'] },
    { canonical:'Independiente', country:'Argentina', aliases:['индепендьенте','independiente'] },
    { canonical:'Zenit', country:'Russia', aliases:['зенит','zenit','zenit saint petersburg'] },
    { canonical:'Spartak Moscow', country:'Russia', aliases:['спартак','спартак москва','spartak','spartak moscow'] },
    { canonical:'CSKA Moscow', country:'Russia', aliases:['цска','цска москва','cska','cska moscow'] },
    { canonical:'Dynamo Moscow', country:'Russia', aliases:['динамо москва','dynamo moscow'] },
    { canonical:'Olympiakos Piraeus', country:'Greece', aliases:['олимпиакос','olympiakos','olympiacos'] },
    { canonical:'Panathinaikos', country:'Greece', aliases:['панатинаикос','panathinaikos'] },
    { canonical:'Red Bull Salzburg', country:'Austria', aliases:['зальцбург','salzburg','red bull salzburg'] },
    { canonical:'FK Crvena Zvezda', country:'Serbia', aliases:['црвена звезда','красная звезда','red star belgrade','crvena zvezda'] },
  ]);
  
  function topTeamSearchCandidates(query = '') {
    const q=searchText(query);
    if (!q) return [];
    return TOP_TEAM_SEARCH_CATALOG.map(item=>{
      const canonical=searchText(item.canonical);
      const aliases=(item.aliases || []).map(searchText);
      let score=0;
      if (canonical===q) score=300;
      else if (aliases.includes(q)) score=280;
      else if (q.length>=4 && canonical.startsWith(q)) score=180;
      else if (q.length>=4 && aliases.some(x=>x.startsWith(q))) score=170;
      else if (q.length>=5 && (canonical.includes(q) || aliases.some(x=>x.includes(q)))) score=110;
      return {...item,score};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score || a.canonical.localeCompare(b.canonical,'en')).slice(0,5);
  }
  
  function topTeamSearchPlan(query = '') {
    const candidates=topTeamSearchCandidates(query);
    const best=candidates[0] || null;
    const rawQuery=safeText(query,60);
    const providerQuery=best && best.score>=170 ? best.canonical : rawQuery;
    return {providerQuery,candidates,resolved:Boolean(best && searchText(providerQuery)!==searchText(rawQuery)),best};
  }
  
  function knownTopTeamFallbacks(query = '') {
    return topTeamSearchCandidates(query).map(item=>({
      id:0,
      name:item.canonical,
      country:normalizeCountryName(item.country || ''),
      logo:'',
      national:false,
      catalogOnly:true,
      score:Number(item.score || 0),
    }));
  }
  
  function searchText(value = '') {
    const source=safeText(value,120);
    if (!source) return '';
    return source
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g,' ')
      .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g,'')
      .trim()
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[çćč]/g, 'c')
      .replace(/[şš]/g, 's')
      .replace(/ğ/g, 'g')
      .replace(/[üúùû]/g, 'u')
      .replace(/[öóòôõ]/g, 'o')
      .replace(/[äáàâãå]/g, 'a')
      .replace(/[éèêë]/g, 'e')
      .replace(/[íìîï]/g, 'i')
      .replace(/ñ/g, 'n')
      .replace(/ž/g, 'z')
      .replace(/[‐‑‒–—―\-_/\\|+.,!?;:()[\]{}'’‘"\`´“”„«»]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  const SEARCH_QUALITY_DRILL_CASES = Object.freeze([
    ['МЮ','Manchester United'],
    ['мю!!!','Manchester United'],
    ['ПСЖ?','Paris Saint Germain'],
    ['Барса.','Barcelona'],
    ['Бока-Хуниорс','Boca Juniors'],
    ['Ривер-Плейт','River Plate'],
    ['Al‑Nassr','Al-Nassr'],
    ['Fenerbahçe','Fenerbahce'],
    ['Beşiktaş','Besiktas'],
    ['São Paulo','Sao Paulo'],
    ['Bayern München','Bayern Munich'],
    ['Red-Star Belgrade','FK Crvena Zvezda'],
    ['Crvena Zvezda','FK Crvena Zvezda'],
    ['Интер-Майами','Inter Miami'],
    ['ЛАФК','Los Angeles FC'],
    ['Шахтёр','Shakhtar Donetsk'],
    ['Олимпиакос!','Olympiakos Piraeus'],
    ['Динамо Киев','Dynamo Kyiv'],
    ['Sa\u0303o Paulo','Sao Paulo'],
    ['Ｒｅａｌ　Ｍａｄｒｉｄ','Real Madrid'],
    ['Интер\u200BМайами','Inter Miami'],
  ]);
  
  function searchQualityDrill() {
    const failed=[];
    for (const [query,expected] of SEARCH_QUALITY_DRILL_CASES) {
      const best=topTeamSearchPlan(query).best;
      if (!best || best.canonical!==expected || Number(best.score || 0)<170) {
        failed.push({query,expected,actual:best?.canonical || '',score:Number(best?.score || 0)});
      }
    }
    return {pass:failed.length===0,total:SEARCH_QUALITY_DRILL_CASES.length,failed:failed.length};
  }
  
  function competitionCountryByGroup(group = '') {
    const map = {
      england: 'Англия', spain: 'Испания', italy: 'Италия', germany: 'Германия', france: 'Франция',
      portugal: 'Португалия', netherlands: 'Нидерланды', brazil: 'Бразилия', argentina: 'Аргентина',
      turkey: 'Турция', usa: 'США', saudi: 'Саудовская Аравия', international: 'Международные',
    };
    return map[safeText(group,40).toLowerCase()] || 'Мир';
  }
  
  function searchKnownCompetitions(query = '') {
    const q=searchText(query);
    const season=new Date().getUTCFullYear();
    const results=[];
    for (const [rawId,rawItem] of COMPETITIONS.entries()) {
      const id=positiveSafeInteger(rawId);
      const item=rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem) ? rawItem : {};
      if (!id) continue;
      const aliases=SEARCH_COMPETITION_ALIASES.get(id) || '';
      const name=safeText(item.name,160);
      const short=safeText(item.short,80);
      const group=safeText(item.group,40) || 'other';
      const hay=searchText(`${name} ${short} ${aliases} ${competitionCountryByGroup(group)}`);
      if (q && !hay.includes(q)) continue;
      const priority=Math.max(0,Math.min(100,finiteScore(item.priority,0)));
      let score=priority;
      if (q) {
        const normalizedName=searchText(name);
        const normalizedShort=searchText(short);
        if (normalizedName===q || normalizedShort===q) score+=120;
        else if (normalizedName.startsWith(q) || normalizedShort.startsWith(q)) score+=70;
        else if (hay.includes(q)) score+=30;
      }
      results.push({
        leagueId:id,
        season,
        name:name || `Турнир ${id}`,
        shortName:short || name || `Турнир ${id}`,
        country:competitionCountryByGroup(group),
        category:safeText(item.category,40) || 'league',
        tier:safeText(item.tier,40) || 'standard',
        group,
        priority,
        score,
      });
    }
    return results.sort((a,b)=>b.score-a.score || b.priority-a.priority).slice(0,q ? 8 : 10);
  }
  
  function normalizeSearchTeam(row = {}, query = '', preferred = []) {
    const team=(row?.team && typeof row.team === 'object' && !Array.isArray(row.team))
      ? row.team
      : row && typeof row === 'object' && !Array.isArray(row) ? row : {};
    const name=safeText(team.name,160);
    const q=searchText(query);
    const n=searchText(name);
    const preferredRows=rows(preferred);
    let score=0;
    if (q && n===q) score+=140;
    else if (q && n.startsWith(q)) score+=90;
    else if (q && n.includes(q)) score+=50;
    const catalogMatch=TOP_TEAM_SEARCH_CATALOG.some(item=>searchText(item.canonical)===n);
    if (catalogMatch) score+=25;
    const rawCountry=searchText(team.country);
    for (const item of preferredRows) {
      const canonical=searchText(item?.canonical);
      const country=searchText(item?.country);
      if (canonical && n===canonical) score+=120;
      else if (canonical && n && (n.includes(canonical) || canonical.includes(n))) score+=60;
      if (country && rawCountry===country) score+=35;
    }
    const youthReserve=isYouthReserveMatch('',name,'');
    if (youthReserve) score-=45;
    if (team.national === true) score+=10;
    const venue=row?.venue && typeof row.venue === 'object' && !Array.isArray(row.venue)
      ? {name:safeText(row.venue.name,160),city:safeText(row.venue.city,120)}
      : null;
    const founded=positiveSafeInteger(team.founded);
    return {
      id:positiveSafeInteger(team.id),
      name,
      code:safeText(team.code,24),
      country:normalizeCountryName(safeText(team.country,120)),
      countryRaw:safeText(team.country,120),
      logo:safeText(team.logo,1000),
      national:team.national === true,
      founded,
      youthReserve,
      venue,
      score,
    };
  }
  
  async function loadSearchCompetitionMatches(competition, cfg) {
    const leagueId=positiveSafeInteger(competition?.leagueId);
    const rawSeason=competition?.season;
    const season=rawSeason === null || rawSeason === undefined || rawSeason === ''
      ? safeSeason(new Date().getUTCFullYear(),null)
      : safeSeason(rawSeason,null);
    if (!leagueId || !season) return {matches:[],matchSource:null,warning:''};
  
    const fromDate = new Date(); fromDate.setUTCDate(fromDate.getUTCDate() - 45);
    const toDate = new Date(); toDate.setUTCDate(toDate.getUTCDate() + 45);
    const from = fromDate.toISOString().slice(0, 10);
    const to = toDate.toISOString().slice(0, 10);
    const cacheKey = `search:competition-fixtures:${leagueId}:${season}:${from}:${to}:v1`;
    const cached=competitionCachePayload(await getCache(cacheKey,cfg).catch(()=>null),leagueId);
    if (cached) return {...cached,cached:true,stale:false};
  
    if (!quotaHealthy(8,1)) {
      const stale=competitionCachePayload(await getStaleCache(cacheKey,cfg).catch(()=>null),leagueId);
      if (stale) return {...stale,cached:true,stale:true,warning:'Матчи лиги показаны из сохранённых данных: бережём лимит источника данных.'};
      return {
        matches: [],
        matchSource:{kind:'competition',id:leagueId,name:safeText(competition?.name,160) || 'Лига'},
        warning: 'Матчи лиги временно не загружаются: бережём остаток лимита источника данных.',
      };
    }
  
    try {
      const fixtures=providerRows(
        await apiFootball('/fixtures',{league:leagueId,season,from,to},cfg),
        'competition-fixtures',
      );
      const normalized=fixtures
        .filter(f=>!['CANC','PST','ABD','AWD','WO'].includes(safeText(f?.fixture?.status?.short,16).toUpperCase()))
        .map(f=>{
          try { return normalizeTeamHubMatch(f,0); }
          catch { return null; }
        })
        .filter(match=>positiveSafeInteger(match?.fixtureId));
      const now = Date.now();
      const recent = normalized.filter(x => x.finished)
        .sort((x, y) => Date.parse(y.date || 0) - Date.parse(x.date || 0)).slice(0, 8);
      const upcoming = normalized.filter(x => !x.finished && (x.live || Date.parse(x.date || 0) >= now - 3 * 60 * 60 * 1000))
        .sort((x, y) => (x.live === y.live ? Date.parse(x.date || 0) - Date.parse(y.date || 0) : x.live ? -1 : 1)).slice(0, 8);
      const payload = {
        matches: [...upcoming, ...recent],
        matchSource:{kind:'competition',id:leagueId,name:safeText(competition?.name,160) || safeText(normalized[0]?.league,160) || 'Лига'},
        refreshedAt: new Date().toISOString(),
        warning: '',
      };
      await setCache(cacheKey,0,payload,cfg,300).catch(()=>null);
      return { ...payload, cached: false, stale: false };
    } catch (error) {
      const stale=competitionCachePayload(await getStaleCache(cacheKey,cfg).catch(()=>null),leagueId);
      if (stale) return {...stale,cached:true,stale:true,warning:'Не удалось обновить матчи лиги — показаны последние сохранённые данные.'};
      return {
        matches: [],
        matchSource:{kind:'competition',id:leagueId,name:safeText(competition?.name,160) || 'Лига'},
        warning:isFootballRateLimitError(error)
          ? 'Источник данных временно ограничил поиск матчей лиги. Повторите чуть позже.'
          : recoverableProviderError(error)
            ? 'Источник матчей лиги временно недоступен. Повторите поиск позже.'
            : 'Матчи выбранной лиги сейчас недоступны.',
      };
    }
  }
  
  function preferCompetitionSearch(competition, teams = []) {
    if (!positiveSafeInteger(competition?.leagueId)) return false;
    const teamRows=rows(teams);
    const competitionScore=finiteScore(competition?.score,0);
    const teamScore=finiteScore(teamRows[0]?.score,0);
    return competitionScore>=120 || !teamRows.length || competitionScore>=teamScore;
  }
  
  function mergeSearchWarnings(...values) {
    return [...new Set(values.map(value=>safeText(value,500)).filter(Boolean))].join(' ').slice(0,1200);
  }
  
  const TEAM_DISCOVERY_PAST_DAYS = 30;
  const TEAM_DISCOVERY_FUTURE_DAYS = 120;
  
  function teamDiscoveryWindow() {
    const fromDate=new Date();
    fromDate.setUTCDate(fromDate.getUTCDate()-TEAM_DISCOVERY_PAST_DAYS);
    const toDate=new Date();
    toDate.setUTCDate(toDate.getUTCDate()+TEAM_DISCOVERY_FUTURE_DAYS);
    return {from:fromDate.toISOString().slice(0,10),to:toDate.toISOString().slice(0,10)};
  }
  
  function matchSelectionProfile(match = {}, now = Date.now()) {
    const competition=match?.competition && typeof match.competition === 'object' && !Array.isArray(match.competition)
      ? match.competition
      : {};
    const category=safeText(competition.category || match?.category,40);
    const homeName=safeText(match?.home?.name || match?.homeName,160);
    const awayName=safeText(match?.away?.name || match?.awayName,160);
    const firstTeam=!isYouthReserveMatch(safeText(match?.league || competition.name,160),homeName,awayName);
    const official=Boolean(firstTeam && category!=='friendly');
    const live=match?.live === true;
    const finished=match?.finished === true;
    const kickoff=Date.parse(safeText(match?.date,80));
    const nowMs=Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const distanceMs=Number.isFinite(kickoff) ? Math.abs(kickoff-nowMs) : Number.MAX_SAFE_INTEGER;
    const lane=live ? 0 : !finished && official ? 1 : !finished ? 2 : official ? 3 : 4;
    const priority=Math.max(0,Math.min(99,finiteScore(competition.priority,0)));
    const reason=live
      ? 'Матч идёт сейчас'
      : lane===1
        ? 'Ближайший официальный матч основной команды'
        : lane===2
          ? 'Ближайший доступный матч; официальный календарь не найден'
          : lane===3
            ? 'Последний официальный матч; будущих игр пока нет'
            : 'Последний доступный матч';
    return {lane,official,firstTeam,priority,distanceMs,reason};
  }
  
  function compareMatchSelection(a, b, now = Date.now()) {
    const pa=matchSelectionProfile(a,now), pb=matchSelectionProfile(b,now);
    if (pa.lane!==pb.lane) return pa.lane-pb.lane;
    const ad=Date.parse(a?.date || 0), bd=Date.parse(b?.date || 0);
    if (pa.lane<=2 && Number.isFinite(ad) && Number.isFinite(bd) && ad!==bd) return ad-bd;
    if (pa.lane>=3 && Number.isFinite(ad) && Number.isFinite(bd) && ad!==bd) return bd-ad;
    if (pa.priority!==pb.priority) return pb.priority-pa.priority;
    return (positiveSafeInteger(a?.fixtureId) || Number.MAX_SAFE_INTEGER)
      -(positiveSafeInteger(b?.fixtureId) || Number.MAX_SAFE_INTEGER);
  }
  
  function rankTeamDiscoveryMatches(matches = [], now = Date.now()) {
    const ranked=rows(matches)
      .filter(match=>positiveSafeInteger(match?.fixtureId))
      .slice()
      .sort((a,b)=>compareMatchSelection(a,b,now));
    return ranked.map((match,index)=>{
      const profile=matchSelectionProfile(match,now);
      return {...match,selection:{primary:index===0,rank:index+1,reason:profile.reason,official:profile.official,firstTeam:profile.firstTeam,lane:profile.lane}};
    });
  }
  
  const MATCH_SELECTION_DRILL_NOW = Date.parse('2026-09-23T00:00:00Z');
  
  function matchSelectionDrill() {
    const base={home:{name:'Example FC'},away:{name:'Opponent'},competition:{category:'league',priority:80}};
    const rows=[
      {...base,fixtureId:1,date:'2026-09-24T18:00:00Z',finished:false,live:false,competition:{category:'friendly',priority:24}},
      {...base,fixtureId:2,date:'2026-09-26T18:00:00Z',finished:false,live:false,competition:{category:'cup',priority:74}},
      {...base,fixtureId:3,date:'2026-09-28T18:00:00Z',finished:false,live:false,competition:{category:'league',priority:94}},
      {...base,fixtureId:4,date:'2026-09-22T18:00:00Z',finished:true,live:false,competition:{category:'league',priority:94}},
      {...base,fixtureId:5,date:'2026-09-25T18:00:00Z',finished:false,live:false,home:{name:'Example FC U21'},competition:{category:'youth',priority:8}},
    ];
    const ranked=rankTeamDiscoveryMatches(rows,MATCH_SELECTION_DRILL_NOW);
    const primary=ranked[0];
    const officialUpcoming=ranked.filter(x=>!x.finished && x.selection?.official).map(x=>x.fixtureId);
    return {pass:Number(primary?.fixtureId)===2 && officialUpcoming.join(',')==='2,3',primaryFixtureId:Number(primary?.fixtureId || 0),total:rows.length};
  }
  function splitTeamDiscoveryMatches(matches = [], secondQuery = '', options = {}) {
    const second=searchText(secondQuery);
    const now=Date.now();
    const filtered=rows(matches).filter(match=>{
      if (!positiveSafeInteger(match?.fixtureId)) return false;
      if (!second) return true;
      return searchText(`${safeText(match?.home?.name,160)} ${safeText(match?.away?.name,160)}`).includes(second);
    });
    const ranked=rankTeamDiscoveryMatches(filtered,now);
    const upcomingLimit=safeLimit(options?.upcomingLimit,8,20);
    const recentLimit=safeLimit(options?.recentLimit,4,20);
    const upcoming=ranked.filter(match=>{
      if (match?.finished === true) return false;
      const kickoff=Date.parse(safeText(match?.date,80));
      return match?.live === true || (Number.isFinite(kickoff) && kickoff>=now-3*60*60*1000);
    }).slice(0,upcomingLimit);
    const recent=ranked.filter(match=>match?.finished === true)
      .slice(0,recentLimit);
    const primary=ranked[0] || null;
    return {upcoming,recent,primary,mode:upcoming.length ? 'upcoming' : recent.length ? 'recent' : 'empty'};
  }
  
  function teamSearchFixturePayload(team, fixtures = [], secondQuery = '', meta = {}) {
    const split=splitTeamDiscoveryMatches(fixtures,secondQuery,{upcomingLimit:8,recentLimit:4});
    const teamId=positiveSafeInteger(team?.id);
    const primaryFixtureId=positiveSafeInteger(split.primary?.fixtureId);
    const refreshedAt=Number.isFinite(Date.parse(safeText(meta?.refreshedAt,80)))
      ? new Date(Date.parse(safeText(meta.refreshedAt,80))).toISOString()
      : new Date().toISOString();
    return {
      matches:[...split.upcoming,...split.recent],
      matchSource:teamId ? {kind:'team',id:teamId,name:safeText(team?.name,160) || 'Команда'} : null,
      primaryFixtureId,
      matchDiscovery:{
        mode:split.mode,
        upcoming:split.upcoming.length,
        recent:split.recent.length,
        primaryFixtureId,
        primaryReason:safeText(split.primary?.selection?.reason,240),
        windowPastDays:TEAM_DISCOVERY_PAST_DAYS,
        windowFutureDays:TEAM_DISCOVERY_FUTURE_DAYS,
        cached:meta?.cached === true,
        stale:meta?.stale === true,
      },
      warning:safeText(meta?.warning,600),
      refreshedAt,
    };
  }
  
  async function loadSearchTeamMatches(team, cfg, options = {}) {
    const teamId=positiveSafeInteger(team?.id);
    if (!teamId) return {matches:[],matchSource:null,matchDiscovery:{mode:'empty',upcoming:0,recent:0,windowPastDays:TEAM_DISCOVERY_PAST_DAYS,windowFutureDays:TEAM_DISCOVERY_FUTURE_DAYS},warning:''};
    const {from,to}=teamDiscoveryWindow();
    const cacheKey=`search:team-fixtures:${teamId}:${from}:${to}:v2`;
    const cached=teamFixtureCachePayload(await getCache(cacheKey,cfg).catch(()=>null),teamId);
    if (cached) return teamSearchFixturePayload(team,cached.fixtures,options?.secondQuery,{cached:true,refreshedAt:cached.refreshedAt});
    if (!quotaHealthy(8,1)) {
      const stale=teamFixtureCachePayload(await getStaleCache(cacheKey,cfg).catch(()=>null),teamId);
      if (stale) return teamSearchFixturePayload(team,stale.fixtures,options?.secondQuery,{cached:true,stale:true,refreshedAt:stale.refreshedAt,warning:'Календарь команды показан из сохранённых данных: бережём лимит источника.'});
      return {matches:[],matchSource:{kind:'team',id:teamId,name:safeText(team?.name,160) || 'Команда'},matchDiscovery:{mode:'empty',upcoming:0,recent:0,windowPastDays:TEAM_DISCOVERY_PAST_DAYS,windowFutureDays:TEAM_DISCOVERY_FUTURE_DAYS,cached:false,stale:false},warning:'Команда найдена, но календарь временно не обновляется: бережём остаток лимита источника.'};
    }
    try {
      const providerFixtures=providerRows(
        await loadProviderTeamDiscoveryFixtures(teamId,cfg),
        'team-discovery-fixtures',
      );
      const fixtures=providerFixtures
        .filter(f=>!['CANC','PST','ABD','AWD','WO'].includes(safeText(f?.fixture?.status?.short,16).toUpperCase()))
        .map(f=>{
          try { return normalizeTeamHubMatch(f,teamId); }
          catch { return null; }
        })
        .filter(match=>positiveSafeInteger(match?.fixtureId));
      const payload={teamId,fixtures,refreshedAt:new Date().toISOString()};
      await setCache(cacheKey,teamId,payload,cfg,180).catch(()=>null);
      return teamSearchFixturePayload(team,fixtures,options.secondQuery,{refreshedAt:payload.refreshedAt});
    } catch (error) {
      const stale=teamFixtureCachePayload(await getStaleCache(cacheKey,cfg).catch(()=>null),teamId);
      if (stale) return teamSearchFixturePayload(team,stale.fixtures,options?.secondQuery,{cached:true,stale:true,refreshedAt:stale.refreshedAt,warning:'Не удалось обновить календарь команды — показаны последние сохранённые матчи.'});
      return {matches:[],matchSource:{kind:'team',id:teamId,name:safeText(team?.name,160) || 'Команда'},matchDiscovery:{mode:'empty',upcoming:0,recent:0,windowPastDays:TEAM_DISCOVERY_PAST_DAYS,windowFutureDays:TEAM_DISCOVERY_FUTURE_DAYS,cached:false,stale:false},warning:isFootballRateLimitError(error)
        ? 'Источник временно ограничил календарь команды. Команда найдена — повторите поиск позже.'
        : recoverableProviderError(error)
          ? 'Команда найдена, но источник календаря временно недоступен.'
          : 'Команда найдена, но её календарь сейчас недоступен.'};
    }
  }
  async function apiSearch(request, cfg) {
    const url=new URL(request.url);
    const query=safeText(url.searchParams.get('q'),60);
    const q = searchText(query);
    const competitions = searchKnownCompetitions(query);
    const teamPlan = topTeamSearchPlan(query);
    const highIntentTeam = Number(teamPlan.best?.score || 0) >= 170;
    const knownTeams = knownTopTeamFallbacks(query);
    if (!q) return json({ query: '', teams: [], knownTeams: [], competitions, matches: [], matchSource: null, provider:capabilities(), hint: 'Введите название команды или турнира.' });
    if (q.length < 3 && Number(teamPlan.best?.score || 0) < 280) return json({ query, teams: [], knownTeams, competitions, matches: [], matchSource: null, provider:capabilities(), hint: 'Введите минимум 3 символа или известное сокращение клуба.' });
  
    if (Number(competitions[0]?.score || 0) >= 120) {
      const fixtureSearch = await loadSearchCompetitionMatches(competitions[0], cfg);
      return json({ query, teams: [], knownTeams, competitions, ...fixtureSearch, provider:capabilities() });
    }
  
    const teamCacheQuery = searchText(teamPlan.providerQuery || query);
    const cacheKey = `search:teams:${encodeURIComponent(teamCacheQuery)}:v2-global`;
    const cached=teamSearchCachePayload(await getCache(cacheKey,cfg).catch(()=>null));
    if (cached) {
      const fixtureSearch=preferCompetitionSearch(competitions[0],cached.teams)
        ? await loadSearchCompetitionMatches(competitions[0],cfg)
        : await loadSearchTeamMatches(cached.teams[0],cfg);
      return json({...cached,query,knownTeams,resolvedQuery:teamPlan.resolved ? teamPlan.providerQuery : safeText(cached.resolvedQuery,60),competitions,...fixtureSearch,warning:mergeSearchWarnings(cached.warning,fixtureSearch.warning),cached:true,provider:capabilities()});
    }
  
    let rows=[];
    let warning='';
    let providerDegraded=false;
    try {
      if (!quotaHealthy(8,2) && !(highIntentTeam && quotaHealthy(2,1))) {
        const stale=teamSearchCachePayload(await getStaleCache(cacheKey,cfg).catch(()=>null));
        const staleTeams=stale?.teams || [];
        const fixtureSearch = preferCompetitionSearch(competitions[0], staleTeams)
          ? await loadSearchCompetitionMatches(competitions[0], cfg)
          : await loadSearchTeamMatches(staleTeams[0], cfg);
        return json({
          ...(stale || { teams: [] }), query, knownTeams, resolvedQuery:teamPlan.resolved ? teamPlan.providerQuery : (stale?.resolvedQuery || ''), competitions, ...fixtureSearch,
          cached: Boolean(stale), stale: Boolean(stale),
          warning: mergeSearchWarnings(
            stale ? 'Поиск показан из сохранённых данных: бережём лимит API-Football.' : 'Поиск команд временно не запущен: бережём остаток бесплатной квоты источника данных.',
            fixtureSearch.warning,
          ),
          provider:capabilities(),
        });
      }
      rows=providerRows(await apiFootball('/teams',{search:teamPlan.providerQuery || query},cfg),'team-search');
    } catch (error) {
      const stale=teamSearchCachePayload(await getStaleCache(cacheKey,cfg).catch(()=>null));
      if (stale) {
        const fixtureSearch = preferCompetitionSearch(competitions[0], stale.teams)
          ? await loadSearchCompetitionMatches(competitions[0], cfg)
          : await loadSearchTeamMatches(stale.teams[0], cfg);
        return json({ ...stale, query, knownTeams, resolvedQuery:teamPlan.resolved ? teamPlan.providerQuery : (stale.resolvedQuery || ''), competitions, ...fixtureSearch, cached: true, stale: true, warning: mergeSearchWarnings('Не удалось обновить поиск — показаны сохранённые результаты.', fixtureSearch.warning), provider:capabilities() });
      }
      if (isFootballRateLimitError(error)) {
        providerDegraded=true;
        warning='API-Football временно ограничил поиск команд. Повторите чуть позже.';
      } else if (recoverableProviderError(error)) {
        providerDegraded=true;
        warning='Поиск команд временно недоступен. Повторите чуть позже.';
      } else {
        throw error;
      }
    }
  
    const seen = new Set();
    const teams=rows.map(x=>normalizeSearchTeam(x,query,teamPlan.candidates))
      .filter(x=>x.id && x.name && !seen.has(x.id) && seen.add(x.id))
      .sort((x, y) => y.score - x.score || x.name.localeCompare(y.name, 'ru')).slice(0, 16);
    const fixtureSearch = preferCompetitionSearch(competitions[0], teams)
      ? await loadSearchCompetitionMatches(competitions[0], cfg)
      : await loadSearchTeamMatches(teams[0], cfg);
    const payload = { query, resolvedQuery:teamPlan.resolved ? teamPlan.providerQuery : '', teams, knownTeams, warning, refreshedAt: new Date().toISOString() };
    if (!providerDegraded) await setCache(cacheKey,0,payload,cfg,1440).catch(()=>null);
    return json({ ...payload, competitions, ...fixtureSearch, warning: mergeSearchWarnings(warning, fixtureSearch.warning), cached: false, provider:capabilities() });
  }
  
  
  const PUBLIC_SEARCH_COMPETITION_ALIASES=new Map(SEARCH_COMPETITION_ALIASES);
  const PUBLIC_TOP_TEAM_SEARCH_CATALOG=Object.freeze(TOP_TEAM_SEARCH_CATALOG.map(item=>Object.freeze({
    ...item,
    aliases:Object.freeze([...rows(item.aliases)]),
  })));
  const PUBLIC_SEARCH_QUALITY_DRILL_CASES=Object.freeze(SEARCH_QUALITY_DRILL_CASES.map(item=>Object.freeze([...item])));

  return Object.freeze({
    SEARCH_COMPETITION_ALIASES:PUBLIC_SEARCH_COMPETITION_ALIASES,
    TOP_TEAM_SEARCH_CATALOG:PUBLIC_TOP_TEAM_SEARCH_CATALOG,
    topTeamSearchCandidates,
    topTeamSearchPlan,
    knownTopTeamFallbacks,
    searchText,
    SEARCH_QUALITY_DRILL_CASES:PUBLIC_SEARCH_QUALITY_DRILL_CASES,
    searchQualityDrill,
    competitionCountryByGroup,
    searchKnownCompetitions,
    normalizeSearchTeam,
    loadSearchCompetitionMatches,
    preferCompetitionSearch,
    mergeSearchWarnings,
    TEAM_DISCOVERY_PAST_DAYS,
    TEAM_DISCOVERY_FUTURE_DAYS,
    teamDiscoveryWindow,
    matchSelectionProfile,
    compareMatchSelection,
    rankTeamDiscoveryMatches,
    MATCH_SELECTION_DRILL_NOW,
    matchSelectionDrill,
    splitTeamDiscoveryMatches,
    teamSearchFixturePayload,
    loadSearchTeamMatches,
    apiSearch,
  });
}
