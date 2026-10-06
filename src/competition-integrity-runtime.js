// Competition catalog and fixture integrity runtime extracted from worker.js.
// Persistence, status and HTTP primitives are injected by the composition root.
export function createCompetitionIntegrityRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Competition integrity runtime dependencies are required.');
  }
  const {
    APP_VERSION,
    bumpTelemetry,
    hasSupabase,
    isFinishedStatus,
    isLiveStatus,
    json,
    memory,
    recordOpsEvent,
    safeOpsMetadata,
    supaSelectMany,
    supaUpsert,
  } = deps;

  const requiredFunctions={
    bumpTelemetry,
    hasSupabase,
    isFinishedStatus,
    isLiveStatus,
    json,
    recordOpsEvent,
    safeOpsMetadata,
    supaSelectMany,
    supaUpsert,
  };
  for (const [name,fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new TypeError('memory is required');
  }

  function rows(value) {
    return Array.isArray(value) ? value : [];
  }

  function positiveSafeInteger(value) {
    if (value === null || value === undefined || value === '') return null;
    const number=Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function nonNegativeSafeInteger(value, max = Number.MAX_SAFE_INTEGER) {
    if (value === null || value === undefined || value === '') return null;
    const number=Number(value);
    return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null;
  }

  function safeText(value, max = 160) {
    if (!['string','number','bigint'].includes(typeof value)) return '';
    return String(value).trim().slice(0,max);
  }

  function strictUtcDate(value) {
    const raw=safeText(value,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
    const timestamp=Date.parse(`${raw}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp)) return '';
    try {
      return new Date(timestamp).toISOString().slice(0,10) === raw ? raw : '';
    } catch {
      return '';
    }
  }

  function scoreInteger(value) {
    return nonNegativeSafeInteger(value,30);
  }

  function safeTelemetry(key, amount = 1) {
    try { bumpTelemetry(key,amount); } catch {}
  }

  async function safeOps(cfg,event) {
    try {
      await recordOpsEvent(cfg,event);
      return true;
    } catch {
      return false;
    }
  }

  function safeMetadata(value) {
    try {
      const result=safeOpsMetadata(value && typeof value === 'object' && !Array.isArray(value) ? value : {});
      return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
    } catch {
      return {};
    }
  }

  function boundedCount(value, fallback = 0, max = 1_000_000) {
    const number=nonNegativeSafeInteger(value,max);
    return number === null ? fallback : number;
  }

  function boundedQuality(value, fallback = 0) {
    const number=Number(value);
    return Number.isFinite(number) ? Math.max(0,Math.min(100,number)) : fallback;
  }

  function ensureIntegrityMemory() {
    if (!memory.integrity || typeof memory.integrity !== 'object' || Array.isArray(memory.integrity)) {
      memory.integrity={lastRun:null,recentIssues:[]};
    }
    if (!Array.isArray(memory.integrity.recentIssues)) memory.integrity.recentIssues=[];
    return memory.integrity;
  }

  const COMPETITIONS = new Map([
    [1,   { name: 'Чемпионат мира', short: 'ЧМ', group: 'international', category: 'national', tier: 'elite', priority: 100 }],
    [2,   { name: 'Лига чемпионов УЕФА', short: 'ЛЧ', group: 'international', category: 'continental', tier: 'elite', priority: 100 }],
    [3,   { name: 'Лига Европы УЕФА', short: 'ЛЕ', group: 'international', category: 'continental', tier: 'elite', priority: 94 }],
    [4,   { name: 'Евро', short: 'Евро', group: 'international', category: 'national', tier: 'elite', priority: 98 }],
    [9,   { name: 'Копа Америка', short: 'Копа Америка', group: 'international', category: 'national', tier: 'elite', priority: 96 }],
    [15,  { name: 'Клубный чемпионат мира', short: 'КЧМ', group: 'international', category: 'continental', tier: 'elite', priority: 92 }],
    [39,  { name: 'Премьер-лига', short: 'АПЛ', group: 'england', category: 'league', tier: 'elite', priority: 100 }],
    [40,  { name: 'Чемпионшип', short: 'Чемпионшип', group: 'england', category: 'league', tier: 'major', priority: 72 }],
    [45,  { name: 'Кубок Англии', short: 'FA Cup', group: 'england', category: 'cup', tier: 'major', priority: 84 }],
    [48,  { name: 'Кубок английской лиги', short: 'EFL Cup', group: 'england', category: 'cup', tier: 'major', priority: 76 }],
    [61,  { name: 'Лига 1', short: 'Лига 1', group: 'france', category: 'league', tier: 'elite', priority: 92 }],
    [62,  { name: 'Лига 2', short: 'Лига 2', group: 'france', category: 'league', tier: 'major', priority: 60 }],
    [66,  { name: 'Кубок Франции', short: 'Кубок Франции', group: 'france', category: 'cup', tier: 'major', priority: 70 }],
    [71,  { name: 'Серия A Бразилии', short: 'Бразилия A', group: 'brazil', category: 'league', tier: 'major', priority: 78 }],
    [78,  { name: 'Бундеслига', short: 'Бундеслига', group: 'germany', category: 'league', tier: 'elite', priority: 94 }],
    [79,  { name: '2. Бундеслига', short: '2. Бундеслига', group: 'germany', category: 'league', tier: 'major', priority: 62 }],
    [81,  { name: 'Кубок Германии', short: 'DFB-Pokal', group: 'germany', category: 'cup', tier: 'major', priority: 74 }],
    [88,  { name: 'Эредивизи', short: 'Эредивизи', group: 'netherlands', category: 'league', tier: 'major', priority: 78 }],
    [94,  { name: 'Примейра-лига', short: 'Португалия', group: 'portugal', category: 'league', tier: 'major', priority: 78 }],
    [128, { name: 'Профессиональная лига Аргентины', short: 'Аргентина', group: 'argentina', category: 'league', tier: 'major', priority: 76 }],
    [135, { name: 'Серия A', short: 'Серия A', group: 'italy', category: 'league', tier: 'elite', priority: 94 }],
    [136, { name: 'Серия B', short: 'Серия B', group: 'italy', category: 'league', tier: 'major', priority: 62 }],
    [137, { name: 'Кубок Италии', short: 'Кубок Италии', group: 'italy', category: 'cup', tier: 'major', priority: 74 }],
    [140, { name: 'Ла Лига', short: 'Ла Лига', group: 'spain', category: 'league', tier: 'elite', priority: 96 }],
    [141, { name: 'Сегунда', short: 'Сегунда', group: 'spain', category: 'league', tier: 'major', priority: 62 }],
    [143, { name: 'Кубок Испании', short: 'Кубок Испании', group: 'spain', category: 'cup', tier: 'major', priority: 76 }],
    [203, { name: 'Суперлига Турции', short: 'Турция', group: 'turkey', category: 'league', tier: 'major', priority: 68 }],
    [253, { name: 'MLS', short: 'MLS', group: 'usa', category: 'league', tier: 'major', priority: 72 }],
    [307, { name: 'Саудовская Про-лига', short: 'Saudi Pro League', group: 'saudi', category: 'league', tier: 'major', priority: 70 }],
    [848, { name: 'Лига конференций УЕФА', short: 'ЛК', group: 'international', category: 'continental', tier: 'elite', priority: 88 }],
  ]);
  
  const BIG_TEAM_RE = /arsenal|liverpool|chelsea|manchester (city|united)|tottenham|newcastle|real madrid|barcelona|atletico madrid|bayern|dortmund|paris saint|psg|inter|milan|juventus|napoli|roma|benfica|porto|sporting|ajax|psv|feyenoord|inter miami|flamengo|palmeiras|river plate|boca juniors/i;
  const YOUTH_RESERVE_RE = /\bu-?1[789]\b|\bu-?2[013]\b|under ?(17|18|19|20|21|23)|youth|reserve|reserves|development|primavera|juniors?|academy/i;
  const WOMEN_RE = /women|femen|femin|wsl|liga f|frauen|d1 f|feminine/i;
  const FRIENDLY_RE = /friendly|friendlies|club friendly|товарищ/i;
  const CUP_RE = /cup|copa|coppa|pokal|taça|taca|coupe|кубок/i;
  const LOWER_RE = /division 3|division 4|third|fourth|regional|amateur|non league|national league north|national league south/i;
  
  const COUNTRY_RU = new Map(Object.entries({
    England:'Англия', Spain:'Испания', Italy:'Италия', Germany:'Германия', France:'Франция',
    Portugal:'Португалия', Netherlands:'Нидерланды', Belgium:'Бельгия', Turkey:'Турция', Scotland:'Шотландия',
    Brazil:'Бразилия', Argentina:'Аргентина', USA:'США', Mexico:'Мексика', Colombia:'Колумбия',
    Ecuador:'Эквадор', Uruguay:'Уругвай', Chile:'Чили', Paraguay:'Парагвай', Peru:'Перу',
    'Saudi-Arabia':'Саудовская Аравия', 'Saudi Arabia':'Саудовская Аравия', Japan:'Япония', Korea:'Южная Корея',
    Australia:'Австралия', Russia:'Россия', Ukraine:'Украина', Poland:'Польша', Greece:'Греция',
    Austria:'Австрия', Switzerland:'Швейцария', Denmark:'Дания', Sweden:'Швеция', Norway:'Норвегия',
    'Czech-Republic':'Чехия', 'Czech Republic':'Чехия', Romania:'Румыния', Croatia:'Хорватия', Serbia:'Сербия',
    World:'Мир', Europe:'Европа', Africa:'Африка', Asia:'Азия',
  }));
  
  function normalizeCountryName(country = '') {
    const raw=safeText(country,120);
    return COUNTRY_RU.get(raw) || raw || 'Мир';
  }
  
  function isYouthReserveMatch(leagueName = '', homeName = '', awayName = '') {
    return YOUTH_RESERVE_RE.test(
      `${safeText(leagueName,160)} ${safeText(homeName,160)} ${safeText(awayName,160)}`,
    );
  }
  
  function detectCompetitionCategory(leagueId, leagueName = '', country = '', homeName = '', awayName = '') {
    const id=positiveSafeInteger(leagueId);
    const league=safeText(leagueName,160);
    const countryName=safeText(country,120);
    const home=safeText(homeName,160);
    const away=safeText(awayName,160);
    const known=id ? COMPETITIONS.get(id) : null;
    const hay=`${league} ${countryName} ${home} ${away}`;
    if (isYouthReserveMatch(league,home,away)) return 'youth';
    if (WOMEN_RE.test(hay)) return 'women';
    if (FRIENDLY_RE.test(league)) return 'friendly';
    if (known?.category) return known.category;
    if (/champions|europa|conference|world cup|euro|copa america|nations league|club world/i.test(league)) return 'international';
    if (CUP_RE.test(league)) return 'cup';
    if (LOWER_RE.test(league)) return 'lower';
    return 'league';
  }
  
  function leagueGroup(leagueId, leagueName = '', country = '') {
    const id=positiveSafeInteger(leagueId);
    const known=id ? COMPETITIONS.get(id) : null;
    if (known?.group) return known.group;
    const n=safeText(leagueName,160).toLowerCase();
    const c=safeText(country,120).toLowerCase();
    if (/champions|europa|conference|world cup|euro|copa america|nations league|club world/.test(n)) return 'international';
    if (c === 'england') return 'england';
    if (c === 'spain') return 'spain';
    if (c === 'italy') return 'italy';
    if (c === 'germany') return 'germany';
    if (c === 'france') return 'france';
    if (c === 'portugal') return 'portugal';
    if (c === 'netherlands') return 'netherlands';
    if (c === 'brazil') return 'brazil';
    if (c === 'argentina') return 'argentina';
    return 'other';
  }
  
  function normalizeCompetition(leagueId, leagueName = '', country = '', homeName = '', awayName = '') {
    const id=positiveSafeInteger(leagueId) || 0;
    const league=safeText(leagueName,160);
    const rawCountry=safeText(country,120);
    const known=COMPETITIONS.get(id);
    const category=detectCompetitionCategory(id,league,rawCountry,homeName,awayName);
    const youth=category==='youth';
    const friendly=category==='friendly';
    const lower=category==='lower';
    let tier=known?.tier || 'standard';
    let priority=Number.isFinite(Number(known?.priority)) ? Number(known.priority) : 45;
    const lname=league.toLowerCase();
    if (!known && category === 'cup') priority = 52;
    if (!known && category === 'international') priority = 74;
    if (!known && /libertadores/.test(lname)) { tier = 'elite'; priority = 90; }
    if (!known && /sudamericana/.test(lname)) { tier = 'major'; priority = 82; }
    if (!known && /nations league/.test(lname)) { tier = 'major'; priority = 84; }
    if (!known && /afc champions|caf champions|concacaf champions/.test(lname)) { tier = 'major'; priority = 80; }
    if (category === 'women') { tier = 'standard'; priority = Math.max(priority, 50); }
    if (lower) { tier = 'basic'; priority = Math.min(priority, 28); }
    if (friendly) { tier = 'basic'; priority = Math.min(priority, 24); }
    if (youth) { tier = 'basic'; priority = 8; }
    priority=Math.max(0,Math.min(100,Number.isFinite(priority) ? priority : 45));
    const group=known?.group || leagueGroup(id,league,rawCountry);
    return {
      id,
      originalName:league,
      name:known?.name || league || 'Турнир',
      shortName:known?.short || known?.name || league || 'Турнир',
      country:normalizeCountryName(rawCountry),
      countryRaw:rawCountry,
      group,
      category,
      tier,
      priority,
      youth,
      friendly,
      lower,
      featured: priority >= 80 && !youth && !friendly && !lower,
    };
  }
  
  function isTopLeague(leagueId, leagueName = '') {
    const id=positiveSafeInteger(leagueId);
    const known=id ? COMPETITIONS.get(id) : null;
    const league=safeText(leagueName,160);
    if (known) return known.priority>=80;
    if (YOUTH_RESERVE_RE.test(league)) return false;
    return /premier league|la liga|serie a|bundesliga|ligue 1|champions league|europa league|conference league|world cup|copa america|major league soccer|primeira liga/i.test(league);
  }
  
  function normalizeRoundLabel(round = '') {
    const raw=safeText(round,160);
    if (!raw) return '';
    let m = raw.match(/Regular Season\s*-\s*(\d+)/i);
    if (m) return `Тур ${m[1]}`;
    m = raw.match(/Round\s*(\d+)/i);
    if (m) return `Раунд ${m[1]}`;
    m = raw.match(/Group Stage\s*-?\s*(.*)/i);
    if (m) return m[1] ? `Групповой этап · ${m[1]}` : 'Групповой этап';
    if (/Round of 32/i.test(raw)) return '1/16 финала';
    if (/Round of 16/i.test(raw)) return '1/8 финала';
    if (/Quarter/i.test(raw)) return '1/4 финала';
    if (/Semi/i.test(raw)) return '1/2 финала';
    if (/Final/i.test(raw) && !/Semi|Quarter/i.test(raw)) return 'Финал';
    if (/Play-?offs?/i.test(raw)) return raw.replace(/Play-?offs?/i, 'Плей-офф');
    return raw;
  }
  
  function matchInterestScore({ competition, leagueId, leagueName, country, homeName, awayName, status, date } = {}) {
    const normalized=normalizeCompetition(leagueId,leagueName,country,homeName,awayName);
    const comp=competition && typeof competition === 'object' && !Array.isArray(competition)
      ? {...normalized,...competition}
      : normalized;
    const rawPriority=Number(comp.priority);
    let score=Math.max(8,Math.min(72,Number.isFinite(rawPriority) ? rawPriority : 45));
    const home=safeText(homeName,160);
    const away=safeText(awayName,160);
    if (BIG_TEAM_RE.test(home)) score+=12;
    if (BIG_TEAM_RE.test(away)) score+=12;
    if (isLiveStatus(safeText(status,16).toUpperCase())) score+=8;
    const kickoffMs=Date.parse(safeText(date,80));
    if (Number.isFinite(kickoffMs)) {
      const mins=Math.abs((kickoffMs-Date.now())/60000);
      if (mins<=180) score+=5;
    }
    if (comp.youth === true) score-=28;
    if (comp.friendly === true) score-=18;
    if (comp.lower === true) score-=14;
    return Math.max(5,Math.min(99,Math.round(score)));
  }
  
  function catalogRank(match) {
    const cat = match?.competition?.category || match?.category || '';
    // Competition relevance is independent from live status. LIVE is a filter/state,
    // not a reason for a low-value fixture to displace a major upcoming match.
    if (match?.competition?.featured || match?.featured) return 0;
    if (cat === 'continental' || cat === 'national' || cat === 'international') return 1;
    if (cat === 'league' || cat === 'cup') return 2;
    if (cat === 'women') return 3;
    if (cat === 'friendly') return 5;
    if (cat === 'youth' || cat === 'lower') return 6;
    return 4;
  }
  
  function matchStatusRank(status) {
    const normalized=safeText(status,16).toUpperCase();
    if (isLiveStatus(normalized)) return 0;
    if (['NS','TBD'].includes(normalized)) return 1;
    if (isFinishedStatus(normalized)) return 2;
    return 3;
  }
  
  
  const KNOWN_FIXTURE_STATUSES = new Set(['TBD','NS','1H','HT','2H','ET','BT','P','SUSP','INT','FT','AET','PEN','PST','CANC','ABD','AWD','WO','LIVE']);
  const INTEGRITY_SEVERITY_WEIGHT = Object.freeze({ info: 4, warning: 13, error: 38 });
  
  function finiteNonNegative(value) {
    if (value === null || value === undefined || value === '') return null;
    const number=Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }
  
  function fixtureScorePair(fixture) {
    return {
      home:scoreInteger(fixture?.goals?.home),
      away:scoreInteger(fixture?.goals?.away),
    };
  }
  
  function previousMatchMap(payload) {
    const map=new Map();
    for (const row of rows(payload?.matches)) {
      const id=positiveSafeInteger(row?.fixtureId);
      if (id) map.set(id,row);
    }
    return map;
  }
  
  function validateFixtureIntegrity(fixture, requestedDate = '', previous = null) {
    const issues=[];
    const add=(severity,code,message,meta={})=>issues.push({
      severity,
      code,
      message,
      meta:meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {},
    });
    const fixtureId=positiveSafeInteger(fixture?.fixture?.id);
    const date=safeText(fixture?.fixture?.date,80);
    const kickoffMs=Date.parse(date);
    const status=safeText(fixture?.fixture?.status?.short,16).toUpperCase();
    const elapsedRaw=fixture?.fixture?.status?.elapsed;
    const elapsed=nonNegativeSafeInteger(elapsedRaw,180);
    const leagueId=positiveSafeInteger(fixture?.league?.id);
    const leagueName=safeText(fixture?.league?.name,160);
    const homeId=positiveSafeInteger(fixture?.teams?.home?.id);
    const awayId=positiveSafeInteger(fixture?.teams?.away?.id);
    const homeName=safeText(fixture?.teams?.home?.name,160);
    const awayName=safeText(fixture?.teams?.away?.name,160);
    const score=fixtureScorePair(fixture);
    const requested=strictUtcDate(requestedDate);
  
    if (!fixtureId) add('error','FIXTURE_ID_MISSING','Матч не имеет корректного номера.');
    if (!Number.isFinite(kickoffMs)) add('error', 'KICKOFF_INVALID', 'Некорректное время начала матча.', { date });
    if (!homeName || !awayName) add('error', 'TEAM_NAME_MISSING', 'У одной из команд отсутствует название.');
    if (!homeId || !awayId) add('error','TEAM_ID_MISSING','У одной из команд отсутствует корректный номер команды.');
    if ((homeId && homeId===awayId) || (homeName && awayName && homeName.toLowerCase()===awayName.toLowerCase())) {
      add('error','SAME_TEAM','Хозяева и гости определены как одна команда.');
    }
    if (!leagueId || !leagueName) add('warning','LEAGUE_INCOMPLETE','Неполные данные турнира.',{leagueId:leagueId || null,leagueName});
    if (!status || !KNOWN_FIXTURE_STATUSES.has(status)) add('warning', 'STATUS_UNKNOWN', 'Неизвестный статус матча.', { status });
  
    const rawScores=[
      fixture?.goals?.home,
      fixture?.goals?.away,
      fixture?.score?.halftime?.home,
      fixture?.score?.halftime?.away,
      fixture?.score?.fulltime?.home,
      fixture?.score?.fulltime?.away,
      fixture?.score?.extratime?.home,
      fixture?.score?.extratime?.away,
      fixture?.score?.penalty?.home,
      fixture?.score?.penalty?.away,
    ];
    const suppliedScores=rawScores.filter(value=>value !== null && value !== undefined && value !== '');
    if (suppliedScores.some(value=>Number.isFinite(Number(value)) && Number(value)<0)) {
      add('error','SCORE_NEGATIVE','Обнаружено отрицательное значение счёта.');
    }
    if (suppliedScores.some(value=>scoreInteger(value) === null && !(Number.isFinite(Number(value)) && Number(value)<0))) {
      add('error','SCORE_INVALID','Обнаружено некорректное значение счёта.');
    }
  
    if (isLiveStatus(status)) {
      if (Number.isFinite(kickoffMs) && kickoffMs > Date.now() + 20 * 60000) add('error', 'LIVE_BEFORE_KICKOFF', 'Статус «идёт матч» получен задолго до времени начала.', { minutesAhead: Math.round((kickoffMs - Date.now()) / 60000) });
      if (elapsedRaw !== null && elapsedRaw !== undefined && elapsedRaw !== '' && elapsed === null) {
        add('warning','ELAPSED_INVALID','Подозрительное значение игровой минуты.',{elapsed:elapsedRaw});
      }
      if (score.home === null || score.away === null) add('warning', 'LIVE_SCORE_MISSING', 'Матч в реальном времени пришёл без полного текущего счёта.');
    }
  
    if (isFinishedStatus(status)) {
      if (Number.isFinite(kickoffMs) && kickoffMs > Date.now() + 20 * 60000) add('error', 'FINISHED_BEFORE_KICKOFF', 'Завершённый статус получен до времени начала.');
      if (score.home === null || score.away === null) add('warning', 'FINAL_SCORE_MISSING', 'Завершённый матч пришёл без итогового счёта.');
      if (status === 'FT') {
        const ftHome=scoreInteger(fixture?.score?.fulltime?.home);
        const ftAway=scoreInteger(fixture?.score?.fulltime?.away);
        if (ftHome !== null && ftAway !== null && score.home !== null && score.away !== null && (ftHome !== score.home || ftAway !== score.away)) {
          add('warning', 'FINAL_SCORE_CONFLICT', 'Текущий и финальный счёт не совпадают.', { goals: `${score.home}:${score.away}`, fulltime: `${ftHome}:${ftAway}` });
        }
      }
    }
  
    if (['NS','TBD'].includes(status) && Number.isFinite(kickoffMs) && Date.now() - kickoffMs > 6 * 3600000) {
      add('warning', 'STALE_PREMATCH_STATUS', 'Матч давно должен был начаться, но статус всё ещё предматчевый.', { hoursLate: Math.round((Date.now() - kickoffMs) / 3600000) });
    }
    if (['NS','TBD'].includes(status) && ((score.home || 0) > 0 || (score.away || 0) > 0)) add('warning', 'PREMATCH_WITH_SCORE', 'Предматчевый статус содержит ненулевой счёт.');
  
    if (!fixture?.teams?.home?.logo || !fixture?.teams?.away?.logo) add('info', 'TEAM_LOGO_MISSING', 'У одной из команд отсутствует логотип.');
    if (!fixture?.league?.logo) add('info', 'LEAGUE_LOGO_MISSING', 'У турнира отсутствует логотип.');
  
    if (Number.isFinite(kickoffMs) && requested) {
      const requestedNoon=Date.parse(`${requested}T12:00:00Z`);
      if (Number.isFinite(requestedNoon) && Math.abs(kickoffMs-requestedNoon)>38*3600000) {
        add('warning','DATE_WINDOW_MISMATCH','Время матча сильно выходит за запрошенную дату.',{requestedDate:requested,fixtureDate:date});
      }
    }
  
    if (previous && typeof previous === 'object' && !Array.isArray(previous)) {
      const prevStatus=safeText(previous.status,16).toUpperCase();
      const prevElapsed=nonNegativeSafeInteger(previous.elapsed,180);
      const prevHome=scoreInteger(previous?.score?.home);
      const prevAway=scoreInteger(previous?.score?.away);
      if ((isLiveStatus(prevStatus) || isFinishedStatus(prevStatus)) && ['NS','TBD'].includes(status)) {
        add('warning','STATUS_REGRESSION','Статус матча откатился к предматчевому.',{previousStatus:prevStatus,currentStatus:status});
      }
      if (isFinishedStatus(prevStatus) && !isFinishedStatus(status)) {
        add('warning','FINISHED_STATUS_REGRESSION','Ранее завершённый матч вернулся в незавершённый статус.',{previousStatus:prevStatus,currentStatus:status});
      }
      if (isLiveStatus(prevStatus) && isLiveStatus(status) && prevElapsed !== null && elapsed !== null && elapsed+3<prevElapsed) {
        add('warning','ELAPSED_REGRESSION','Игровая минута уменьшилась относительно предыдущего снимка.',{previousElapsed:prevElapsed,currentElapsed:elapsed});
      }
      if (prevHome !== null && prevAway !== null && score.home !== null && score.away !== null && (score.home<prevHome || score.away<prevAway)) {
        add('warning','SCORE_REGRESSION','Счёт уменьшился относительно предыдущего снимка; возможна коррекция после видеопросмотра или конфликт данных.',{previous:`${prevHome}:${prevAway}`,current:`${score.home}:${score.away}`});
      }
    }
  
    const quarantine = issues.some(x => x.severity === 'error');
    const warnings = issues.filter(x => x.severity === 'warning').length;
    const errors = issues.filter(x => x.severity === 'error').length;
    const infos = issues.filter(x => x.severity === 'info').length;
    const qualityScore = Math.max(0, Math.min(100, 100 - warnings * INTEGRITY_SEVERITY_WEIGHT.warning - errors * INTEGRITY_SEVERITY_WEIGHT.error - infos * INTEGRITY_SEVERITY_WEIGHT.info));
    const state = quarantine ? 'error' : warnings ? 'warning' : infos ? 'incomplete' : 'clean';
    return {fixtureId:fixtureId || null,state,qualityScore,quarantine,warnings,errors,infos,issues};
  }
  
  function integritySignature(fixture) {
    const leagueId=positiveSafeInteger(fixture?.league?.id);
    const homeId=positiveSafeInteger(fixture?.teams?.home?.id);
    const awayId=positiveSafeInteger(fixture?.teams?.away?.id);
    const ms=Date.parse(safeText(fixture?.fixture?.date,80));
    if (!homeId || !awayId || !Number.isFinite(ms)) return '';
    const minute=Math.floor(ms/60000);
    return `${leagueId || 0}:${homeId}:${awayId}:${minute}`;
  }
  
  function runMatchIntegrityGuard(fixtures, requestedDate, previousPayload = null) {
    const fixtureRows=rows(fixtures);
    const requested=strictUtcDate(requestedDate);
    const previous=previousMatchMap(previousPayload);
    const accepted=[];
    const issues=[];
    const seenIds=new Set();
    const seenSignatures = new Map();
    let quarantined = 0, duplicates = 0, warningMatches = 0, incompleteMatches = 0, cleanMatches = 0, repaired = 0;
  
    for (const fixture of fixtureRows) {
      const fixtureId=positiveSafeInteger(fixture?.fixture?.id);
      let result=validateFixtureIntegrity(fixture,requested,fixtureId ? previous.get(fixtureId) : null);
      if (fixtureId && seenIds.has(fixtureId)) {
        duplicates++;
        result = { ...result, state: 'error', quarantine: true, errors: result.errors + 1, qualityScore: 0, issues: [...result.issues, { severity: 'error', code: 'DUPLICATE_FIXTURE_ID', message: 'Повтор номера матча в одном ответе источника данных.', meta: { fixtureId } }] };
      }
      const signature = integritySignature(fixture);
      if (!result.quarantine && signature && seenSignatures.has(signature)) {
        duplicates++;
        const firstId = seenSignatures.get(signature);
        result = { ...result, state: 'error', quarantine: true, errors: result.errors + 1, qualityScore: 0, issues: [...result.issues, { severity: 'error', code: 'DUPLICATE_MATCH_SIGNATURE', message: 'Найден дубликат того же матча с другим номером матча.', meta: { firstFixtureId: firstId, duplicateFixtureId: fixtureId } }] };
      }
      if (fixtureId) seenIds.add(fixtureId);
      if (!result.quarantine && signature) seenSignatures.set(signature, fixtureId);
  
      for (const issue of result.issues) {
        if (issue.severity === 'info') continue;
        issues.push({
          fixtureId:fixtureId || null,
          severity:issue.severity,
          code:safeText(issue.code,80),
          message:safeText(issue.message,400),
          meta:issue.meta && typeof issue.meta === 'object' && !Array.isArray(issue.meta) ? issue.meta : {},
          home:safeText(fixture?.teams?.home?.name,120),
          away:safeText(fixture?.teams?.away?.name,120),
          league:safeText(fixture?.league?.name,160),
        });
      }
  
      if (result.quarantine) {
        quarantined++;
        continue;
      }
      if (result.state === 'warning') warningMatches++;
      else if (result.state === 'incomplete') incompleteMatches++;
      else cleanMatches++;
      accepted.push({ fixture, integrity: { state: result.state, score: result.qualityScore, warnings: result.warnings, infos: result.infos, issues: result.issues.filter(x => x.severity !== 'info').slice(0, 3).map(x => ({ severity: x.severity, code: x.code, message: x.message })) } });
    }
  
    const inspected=fixtureRows.length;
    const errors = issues.filter(x => x.severity === 'error').length;
    const warnings = issues.filter(x => x.severity === 'warning').length;
    const qualityScore = inspected ? Math.round((accepted.reduce((sum, x) => sum + Number(x.integrity?.score || 0), 0) / inspected) * 10) / 10 : 100;
    const quarantinePct = inspected ? quarantined / inspected * 100 : 0;
    const health = quarantinePct >= 10 || errors >= 5 ? 'critical' : (quarantined || warnings ? 'warning' : 'ok');
    return {
      accepted,
      report:{requestedDate:requested,inspected,accepted:accepted.length,clean:cleanMatches,incomplete:incompleteMatches,warningMatches,quarantined,duplicates,repaired,warnings,errors,qualityScore,health},
      issues,
    };
  }
  
  async function persistIntegrityRun(cfg, report, issues) {
    const runId=crypto.randomUUID();
    const observedAt=new Date().toISOString();
    const safeReport={
      requestedDate:strictUtcDate(report?.requestedDate),
      inspected:boundedCount(report?.inspected),
      accepted:boundedCount(report?.accepted),
      clean:boundedCount(report?.clean),
      incomplete:boundedCount(report?.incomplete),
      warningMatches:boundedCount(report?.warningMatches),
      quarantined:boundedCount(report?.quarantined),
      duplicates:boundedCount(report?.duplicates),
      repaired:boundedCount(report?.repaired),
      warnings:boundedCount(report?.warnings),
      errors:boundedCount(report?.errors),
      qualityScore:boundedQuality(report?.qualityScore,0),
      health:['ok','warning','critical'].includes(report?.health) ? report.health : 'warning',
    };
    const run={runId,observedAt,...safeReport};
    const integrityMemory=ensureIntegrityMemory();
    integrityMemory.lastRun=run;
    integrityMemory.recentIssues=rows(issues).slice(0,30).map(issue=>({
      fixtureId:positiveSafeInteger(issue?.fixtureId),
      severity:['info','warning','error'].includes(issue?.severity) ? issue.severity : 'warning',
      code:safeText(issue?.code,80) || 'DATA_QUALITY',
      message:safeText(issue?.message,400),
      home:safeText(issue?.home,120),
      away:safeText(issue?.away,120),
      league:safeText(issue?.league,160),
      meta:safeMetadata(issue?.meta),
      observed_at:observedAt,
      run_id:runId,
    }));
    safeTelemetry('integrityRuns');
    safeTelemetry('integrityWarnings',safeReport.warnings);
    safeTelemetry('integrityErrors',safeReport.errors);
    safeTelemetry('integrityQuarantined',safeReport.quarantined);
    safeTelemetry('integrityDuplicates',safeReport.duplicates);
    let persistent=false;
    try { persistent=hasSupabase(cfg) === true; } catch {}
    if (!persistent) return run;
    try {
      await supaUpsert(cfg,'match_integrity_runs',{
        run_id:runId,
        observed_at:observedAt,
        fixture_date:safeReport.requestedDate || null,
        inspected:safeReport.inspected,
        accepted:safeReport.accepted,
        clean:safeReport.clean,
        incomplete:safeReport.incomplete,
        warning_matches:safeReport.warningMatches,
        quarantined:safeReport.quarantined,
        duplicates:safeReport.duplicates,
        repaired:safeReport.repaired,
        warning_count:safeReport.warnings,
        error_count:safeReport.errors,
        quality_score:safeReport.qualityScore,
        health:safeReport.health,
        metadata:{},
      },'run_id');
      const eventRows=rows(issues).slice(0,60).map(issue=>({
        run_id:runId,
        observed_at:observedAt,
        fixture_date:safeReport.requestedDate || null,
        fixture_id:positiveSafeInteger(issue?.fixtureId),
        severity:['info','warning','error'].includes(issue?.severity) ? issue.severity : 'warning',
        issue_code:safeText(issue?.code,80) || 'DATA_QUALITY',
        message:safeText(issue?.message,400),
        home_name:safeText(issue?.home,120),
        away_name:safeText(issue?.away,120),
        league_name:safeText(issue?.league,160),
        metadata:safeMetadata(issue?.meta),
      }));
      if (eventRows.length) await supaUpsert(cfg,'match_integrity_events',eventRows);
    } catch (error) {
      safeTelemetry('supabaseErrors');
      await safeOps(cfg,{
        severity:'warning',
        source:'integrity',
        eventType:'persistence',
        code:'INTEGRITY_DB_WRITE',
        message:safeText(error?.message || error,400) || 'Integrity persistence failed.',
        meta:{inspected:safeReport.inspected,quarantined:safeReport.quarantined},
      });
    }
    return run;
  }
  
  async function readIntegrityDiagnostics(cfg, limit = 12) {
    const safeLimit=Math.max(1,Math.min(30,positiveSafeInteger(limit) || 12));
    const fallback=()=>{
      const integrityMemory=ensureIntegrityMemory();
      return {
        persistent:false,
        migrationReady:false,
        lastRun:integrityMemory.lastRun || null,
        recentIssues:integrityMemory.recentIssues.slice(0,safeLimit),
      };
    };
    let persistent=false;
    try { persistent=hasSupabase(cfg) === true; } catch {}
    if (!persistent) return {...fallback(),migrationReady:true};
    try {
      const runRows=rows(await supaSelectMany(cfg,'match_integrity_runs',{}, {limit:1,order:'observed_at.desc'}));
      const eventRows=rows(await supaSelectMany(cfg,'match_integrity_events',{}, {limit:safeLimit,order:'observed_at.desc'}));
      const row=runRows[0] || null;
      const lastRun=row ? {
        runId:safeText(row.run_id,100),
        observedAt:safeText(row.observed_at,80),
        requestedDate:strictUtcDate(row.fixture_date),
        inspected:boundedCount(row.inspected),
        accepted:boundedCount(row.accepted),
        clean:boundedCount(row.clean),
        incomplete:boundedCount(row.incomplete),
        warningMatches:boundedCount(row.warning_matches),
        quarantined:boundedCount(row.quarantined),
        duplicates:boundedCount(row.duplicates),
        repaired:boundedCount(row.repaired),
        warnings:boundedCount(row.warning_count),
        errors:boundedCount(row.error_count),
        qualityScore:boundedQuality(row.quality_score,0),
        health:['ok','warning','critical'].includes(row.health) ? row.health : 'warning',
      } : null;
      return {persistent:true,migrationReady:true,lastRun,recentIssues:eventRows};
    } catch {
      return fallback();
    }
  }
  
  async function apiDataIntegrity(request, cfg) {
    const data = await readIntegrityDiagnostics(cfg, 24);
    return json({available:true,version:safeText(APP_VERSION,80),generatedAt:new Date().toISOString(),...data});
  }
  
  
  return Object.freeze({
    COMPETITIONS:new Map(COMPETITIONS),
    BIG_TEAM_RE,
    YOUTH_RESERVE_RE,
    WOMEN_RE,
    FRIENDLY_RE,
    CUP_RE,
    LOWER_RE,
    COUNTRY_RU:new Map(COUNTRY_RU),
    normalizeCountryName,
    isYouthReserveMatch,
    detectCompetitionCategory,
    leagueGroup,
    normalizeCompetition,
    isTopLeague,
    normalizeRoundLabel,
    matchInterestScore,
    catalogRank,
    matchStatusRank,
    KNOWN_FIXTURE_STATUSES:new Set(KNOWN_FIXTURE_STATUSES),
    INTEGRITY_SEVERITY_WEIGHT,
    finiteNonNegative,
    fixtureScorePair,
    previousMatchMap,
    validateFixtureIntegrity,
    integritySignature,
    runMatchIntegrityGuard,
    persistIntegrityRun,
    readIntegrityDiagnostics,
    apiDataIntegrity,
  });
}
