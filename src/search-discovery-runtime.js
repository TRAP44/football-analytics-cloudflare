// Search and team-discovery orchestration extracted from worker.js.
// Provider/cache/domain primitives are injected by the composition root.
export function createSearchDiscoveryRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Search discovery runtime dependencies are required.');
  }
  const {
    apiFootball,
    freeQuotaHealthy,
    getCache,
    getStaleCache,
    isFootballRateLimitError,
    isYouthReserveMatch,
    json,
    loadProviderTeamDiscoveryFixtures,
    normalizeCountryName,
    normalizeTeamHubMatch,
    publicDataCapabilities,
    setCache,
  } = deps;

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
    const providerQuery=best && best.score>=170 ? best.canonical : String(query || '').trim();
    return { providerQuery, candidates, resolved:Boolean(best && searchText(providerQuery)!==searchText(query)), best };
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
    return String(value || '')
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
      .replace(/[‐‑‒–—―\-_/\\|+.,!?;:()[\]{}'"\`´“”„«»]+/g, ' ')
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
    return map[String(group || '')] || 'Мир';
  }
  
  function searchKnownCompetitions(query = '') {
    const q = searchText(query);
    const season = new Date().getUTCFullYear();
    const rows = [];
    for (const [id, item] of COMPETITIONS.entries()) {
      const aliases = SEARCH_COMPETITION_ALIASES.get(Number(id)) || '';
      const hay = searchText(`${item.name || ''} ${item.short || ''} ${aliases} ${competitionCountryByGroup(item.group)}`);
      if (q && !hay.includes(q)) continue;
      let score = Number(item.priority || 0);
      if (q) {
        const name = searchText(item.name || '');
        const short = searchText(item.short || '');
        if (name === q || short === q) score += 120;
        else if (name.startsWith(q) || short.startsWith(q)) score += 70;
        else if (hay.includes(q)) score += 30;
      }
      rows.push({
        leagueId: Number(id), season,
        name: item.name || `Турнир ${id}`,
        shortName: item.short || item.name || `Турнир ${id}`,
        country: competitionCountryByGroup(item.group),
        category: item.category || 'league', tier: item.tier || 'standard', group: item.group || 'other',
        priority: Number(item.priority || 0), score,
      });
    }
    return rows.sort((a,b) => b.score - a.score || b.priority - a.priority).slice(0, q ? 8 : 10);
  }
  
  function normalizeSearchTeam(row = {}, query = '', preferred = []) {
    const team = row?.team || row || {};
    const name = String(team.name || '');
    const q = searchText(query);
    const n = searchText(name);
    let score = 0;
    if (q && n === q) score += 140;
    else if (q && n.startsWith(q)) score += 90;
    else if (q && n.includes(q)) score += 50;
    if (BIG_TEAM_RE.test(name)) score += 25;
    for (const item of preferred || []) {
      const canonical=searchText(item?.canonical || '');
      const country=searchText(item?.country || '');
      const rawCountry=searchText(team.country || '');
      if (canonical && n===canonical) score += 120;
      else if (canonical && (n.includes(canonical) || canonical.includes(n))) score += 60;
      if (country && rawCountry===country) score += 35;
    }
    const youthReserve = YOUTH_RESERVE_RE.test(name);
    if (youthReserve) score -= 45;
    if (team.national) score += 10;
    return {
      id: Number(team.id || 0), name,
      code: String(team.code || ''), country: normalizeCountryName(team.country || ''), countryRaw: String(team.country || ''),
      logo: String(team.logo || ''), national: Boolean(team.national), founded: Number(team.founded || 0) || null,
      youthReserve, venue: row?.venue ? { name: row.venue.name || '', city: row.venue.city || '' } : null,
      score,
    };
  }
  
  async function loadSearchCompetitionMatches(competition, cfg) {
    const leagueId = Number(competition?.leagueId || 0);
    const season = Number(competition?.season || new Date().getUTCFullYear());
    if (!leagueId || !season) return { matches: [], matchSource: null, warning: '' };
  
    const fromDate = new Date(); fromDate.setUTCDate(fromDate.getUTCDate() - 45);
    const toDate = new Date(); toDate.setUTCDate(toDate.getUTCDate() + 45);
    const from = fromDate.toISOString().slice(0, 10);
    const to = toDate.toISOString().slice(0, 10);
    const cacheKey = `search:competition-fixtures:${leagueId}:${season}:${from}:${to}:v1`;
    const cached = await getCache(cacheKey, cfg);
    if (cached?.matches) return { ...cached, cached: true, stale: false };
  
    if (!freeQuotaHealthy(8, 1)) {
      const stale = await getStaleCache(cacheKey, cfg);
      if (stale?.matches) return { ...stale, cached: true, stale: true, warning: 'Матчи лиги показаны из сохранённых данных: бережём лимит источника данных.' };
      return {
        matches: [],
        matchSource: { kind: 'competition', id: leagueId, name: competition?.name || 'Лига' },
        warning: 'Матчи лиги временно не загружаются: бережём остаток лимита источника данных.',
      };
    }
  
    try {
      const fixtures = await apiFootball('/fixtures', { league: leagueId, season, from, to }, cfg);
      const normalized = (fixtures || [])
        .filter(f => !['CANC', 'PST', 'ABD', 'AWD', 'WO'].includes(String(f.fixture?.status?.short || '')))
        .map(f => normalizeTeamHubMatch(f, 0))
        .filter(x => x.fixtureId);
      const now = Date.now();
      const recent = normalized.filter(x => x.finished)
        .sort((x, y) => Date.parse(y.date || 0) - Date.parse(x.date || 0)).slice(0, 8);
      const upcoming = normalized.filter(x => !x.finished && (x.live || Date.parse(x.date || 0) >= now - 3 * 60 * 60 * 1000))
        .sort((x, y) => (x.live === y.live ? Date.parse(x.date || 0) - Date.parse(y.date || 0) : x.live ? -1 : 1)).slice(0, 8);
      const payload = {
        matches: [...upcoming, ...recent],
        matchSource: { kind: 'competition', id: leagueId, name: competition?.name || normalized[0]?.league || 'Лига' },
        refreshedAt: new Date().toISOString(),
        warning: '',
      };
      await setCache(cacheKey, 0, payload, cfg, 300);
      return { ...payload, cached: false, stale: false };
    } catch (error) {
      const stale = await getStaleCache(cacheKey, cfg);
      if (stale?.matches) return { ...stale, cached: true, stale: true, warning: 'Не удалось обновить матчи лиги — показаны последние сохранённые данные.' };
      return {
        matches: [],
        matchSource: { kind: 'competition', id: leagueId, name: competition?.name || 'Лига' },
        warning: isFootballRateLimitError(error)
          ? 'Источник данных временно ограничил поиск матчей лиги. Повторите чуть позже.'
          : 'Матчи выбранной лиги сейчас недоступны.',
      };
    }
  }
  
  function preferCompetitionSearch(competition, teams = []) {
    if (!competition?.leagueId) return false;
    const competitionScore = Number(competition.score || 0);
    const teamScore = Number(teams[0]?.score || 0);
    return competitionScore >= 120 || !teams.length || competitionScore >= teamScore;
  }
  
  function mergeSearchWarnings(...values) {
    return [...new Set(values.map(x => String(x || '').trim()).filter(Boolean))].join(' ');
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
    const competition=match?.competition || {};
    const category=String(competition.category || match?.category || '');
    const homeName=String(match?.home?.name || match?.homeName || '');
    const awayName=String(match?.away?.name || match?.awayName || '');
    const firstTeam=!isYouthReserveMatch(match?.league || competition.name || '',homeName,awayName);
    const official=Boolean(firstTeam && category !== 'friendly');
    const live=Boolean(match?.live);
    const finished=Boolean(match?.finished);
    const kickoff=Date.parse(match?.date || 0);
    const distanceMs=Number.isFinite(kickoff) ? Math.abs(kickoff-now) : Number.MAX_SAFE_INTEGER;
    const lane=live ? 0 : !finished && official ? 1 : !finished ? 2 : official ? 3 : 4;
    const priority=Math.max(0,Math.min(99,Number(competition.priority || 0)));
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
    return Number(a?.fixtureId || 0)-Number(b?.fixtureId || 0);
  }
  
  function rankTeamDiscoveryMatches(matches = [], now = Date.now()) {
    const ranked=[...(matches || [])].sort((a,b)=>compareMatchSelection(a,b,now));
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
    const filtered=(matches || []).filter(match=>{
      if (!match?.fixtureId) return false;
      if (!second) return true;
      return searchText(`${match.home?.name || ''} ${match.away?.name || ''}`).includes(second);
    });
    const ranked=rankTeamDiscoveryMatches(filtered,now);
    const upcoming=ranked.filter(match=>!match.finished && (match.live || Date.parse(match.date || 0)>=now-3*60*60*1000))
      .slice(0,Number(options.upcomingLimit || 8));
    const recent=ranked.filter(match=>match.finished)
      .slice(0,Number(options.recentLimit || 4));
    const primary=ranked[0] || null;
    return {upcoming,recent,primary,mode:upcoming.length ? 'upcoming' : recent.length ? 'recent' : 'empty'};
  }
  
  function teamSearchFixturePayload(team, fixtures = [], secondQuery = '', meta = {}) {
    const split=splitTeamDiscoveryMatches(fixtures,secondQuery,{upcomingLimit:8,recentLimit:4});
    return {
      matches:[...split.upcoming,...split.recent],
      matchSource:{kind:'team',id:Number(team?.id || 0),name:String(team?.name || 'Команда')},
      primaryFixtureId:Number(split.primary?.fixtureId || 0) || null,
      matchDiscovery:{mode:split.mode,upcoming:split.upcoming.length,recent:split.recent.length,primaryFixtureId:Number(split.primary?.fixtureId || 0) || null,primaryReason:String(split.primary?.selection?.reason || ''),windowPastDays:TEAM_DISCOVERY_PAST_DAYS,windowFutureDays:TEAM_DISCOVERY_FUTURE_DAYS,cached:Boolean(meta.cached),stale:Boolean(meta.stale)},
      warning:String(meta.warning || ''),
      refreshedAt:meta.refreshedAt || new Date().toISOString(),
    };
  }
  
  async function loadSearchTeamMatches(team, cfg, options = {}) {
    const teamId=Number(team?.id || 0);
    if (!teamId) return {matches:[],matchSource:null,matchDiscovery:{mode:'empty',upcoming:0,recent:0,windowPastDays:TEAM_DISCOVERY_PAST_DAYS,windowFutureDays:TEAM_DISCOVERY_FUTURE_DAYS},warning:''};
    const {from,to}=teamDiscoveryWindow();
    const cacheKey=`search:team-fixtures:${teamId}:${from}:${to}:v2`;
    const cached=await getCache(cacheKey,cfg);
    if (cached?.fixtures) return teamSearchFixturePayload(team,cached.fixtures,options.secondQuery,{cached:true,refreshedAt:cached.refreshedAt});
    if (!freeQuotaHealthy(8,1)) {
      const stale=await getStaleCache(cacheKey,cfg);
      if (stale?.fixtures) return teamSearchFixturePayload(team,stale.fixtures,options.secondQuery,{cached:true,stale:true,refreshedAt:stale.refreshedAt,warning:'Календарь команды показан из сохранённых данных: бережём лимит источника.'});
      return {matches:[],matchSource:{kind:'team',id:teamId,name:String(team?.name || 'Команда')},matchDiscovery:{mode:'empty',upcoming:0,recent:0,windowPastDays:TEAM_DISCOVERY_PAST_DAYS,windowFutureDays:TEAM_DISCOVERY_FUTURE_DAYS,cached:false,stale:false},warning:'Команда найдена, но календарь временно не обновляется: бережём остаток лимита источника.'};
    }
    try {
      const rows=await loadProviderTeamDiscoveryFixtures(teamId,cfg);
      const fixtures=rows.filter(f=>
        !['CANC','PST','ABD','AWD','WO'].includes(String(f.fixture?.status?.short || ''))
      ).map(f=>normalizeTeamHubMatch(f,teamId)).filter(x=>x.fixtureId);
      const payload={fixtures,refreshedAt:new Date().toISOString()};
      await setCache(cacheKey,teamId,payload,cfg,180);
      return teamSearchFixturePayload(team,fixtures,options.secondQuery,{refreshedAt:payload.refreshedAt});
    } catch (error) {
      const stale=await getStaleCache(cacheKey,cfg);
      if (stale?.fixtures) return teamSearchFixturePayload(team,stale.fixtures,options.secondQuery,{cached:true,stale:true,refreshedAt:stale.refreshedAt,warning:'Не удалось обновить календарь команды — показаны последние сохранённые матчи.'});
      return {matches:[],matchSource:{kind:'team',id:teamId,name:String(team?.name || 'Команда')},matchDiscovery:{mode:'empty',upcoming:0,recent:0,windowPastDays:TEAM_DISCOVERY_PAST_DAYS,windowFutureDays:TEAM_DISCOVERY_FUTURE_DAYS,cached:false,stale:false},warning:isFootballRateLimitError(error)?'Источник временно ограничил календарь команды. Команда найдена — повторите поиск позже.':'Команда найдена, но её календарь сейчас недоступен.'};
    }
  }
  async function apiSearch(request, cfg) {
    const url = new URL(request.url);
    const query = String(url.searchParams.get('q') || '').trim().slice(0, 60);
    const q = searchText(query);
    const competitions = searchKnownCompetitions(query);
    const teamPlan = topTeamSearchPlan(query);
    const highIntentTeam = Number(teamPlan.best?.score || 0) >= 170;
    const knownTeams = knownTopTeamFallbacks(query);
    if (!q) return json({ query: '', teams: [], knownTeams: [], competitions, matches: [], matchSource: null, provider: publicDataCapabilities(), hint: 'Введите название команды или турнира.' });
    if (q.length < 3 && Number(teamPlan.best?.score || 0) < 280) return json({ query, teams: [], knownTeams, competitions, matches: [], matchSource: null, provider: publicDataCapabilities(), hint: 'Введите минимум 3 символа или известное сокращение клуба.' });
  
    if (Number(competitions[0]?.score || 0) >= 120) {
      const fixtureSearch = await loadSearchCompetitionMatches(competitions[0], cfg);
      return json({ query, teams: [], knownTeams, competitions, ...fixtureSearch, provider: publicDataCapabilities() });
    }
  
    const teamCacheQuery = searchText(teamPlan.providerQuery || query);
    const cacheKey = `search:teams:${encodeURIComponent(teamCacheQuery)}:v2-global`;
    const cached = await getCache(cacheKey, cfg);
    if (cached?.teams) {
      const fixtureSearch = preferCompetitionSearch(competitions[0], cached.teams)
        ? await loadSearchCompetitionMatches(competitions[0], cfg)
        : await loadSearchTeamMatches(cached.teams[0], cfg);
      return json({ ...cached, query, knownTeams, resolvedQuery:teamPlan.resolved ? teamPlan.providerQuery : (cached.resolvedQuery || ''), competitions, ...fixtureSearch, warning: mergeSearchWarnings(cached.warning, fixtureSearch.warning), cached: true, provider: publicDataCapabilities() });
    }
  
    let rows = [];
    let warning = '';
    try {
      if (!freeQuotaHealthy(8, 2) && !(highIntentTeam && freeQuotaHealthy(2, 1))) {
        const stale = await getStaleCache(cacheKey, cfg);
        const staleTeams = stale?.teams || [];
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
          provider: publicDataCapabilities(),
        });
      }
      rows = await apiFootball('/teams', { search: teamPlan.providerQuery || query }, cfg);
    } catch (error) {
      const stale = await getStaleCache(cacheKey, cfg);
      if (stale?.teams) {
        const fixtureSearch = preferCompetitionSearch(competitions[0], stale.teams)
          ? await loadSearchCompetitionMatches(competitions[0], cfg)
          : await loadSearchTeamMatches(stale.teams[0], cfg);
        return json({ ...stale, query, knownTeams, resolvedQuery:teamPlan.resolved ? teamPlan.providerQuery : (stale.resolvedQuery || ''), competitions, ...fixtureSearch, cached: true, stale: true, warning: mergeSearchWarnings('Не удалось обновить поиск — показаны сохранённые результаты.', fixtureSearch.warning), provider: publicDataCapabilities() });
      }
      if (isFootballRateLimitError(error)) warning = 'API-Football временно ограничил поиск команд. Повторите чуть позже.';
      else throw error;
    }
  
    const seen = new Set();
    const teams = rows.map(x => normalizeSearchTeam(x, query, teamPlan.candidates))
      .filter(x => x.id > 0 && x.name && !seen.has(x.id) && seen.add(x.id))
      .sort((x, y) => y.score - x.score || x.name.localeCompare(y.name, 'ru')).slice(0, 16);
    const fixtureSearch = preferCompetitionSearch(competitions[0], teams)
      ? await loadSearchCompetitionMatches(competitions[0], cfg)
      : await loadSearchTeamMatches(teams[0], cfg);
    const payload = { query, resolvedQuery:teamPlan.resolved ? teamPlan.providerQuery : '', teams, knownTeams, warning, refreshedAt: new Date().toISOString() };
    await setCache(cacheKey, 0, payload, cfg, 1440);
    return json({ ...payload, competitions, ...fixtureSearch, warning: mergeSearchWarnings(warning, fixtureSearch.warning), cached: false, provider: publicDataCapabilities() });
  }
  
  
  return {
    SEARCH_COMPETITION_ALIASES,
    TOP_TEAM_SEARCH_CATALOG,
    topTeamSearchCandidates,
    topTeamSearchPlan,
    knownTopTeamFallbacks,
    searchText,
    SEARCH_QUALITY_DRILL_CASES,
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
  };
}
