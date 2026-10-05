// @ts-check

export const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);
export const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);

export function isLiveStatus(status) { return LIVE_STATUSES.has(String(status || '').toUpperCase()); }
export function isFinishedStatus(status) { return FINISHED_STATUSES.has(String(status || '').toUpperCase()); }

export function statusLabel(status, elapsed) {
  const s = String(status || '').toUpperCase();
  const labels = {
    NS: 'Не начался', TBD: 'Время уточняется', '1H': '1-й тайм', HT: 'Перерыв', '2H': '2-й тайм',
    ET: 'Доп. время', BT: 'Перерыв', P: 'Пенальти', INT: 'Прерван', LIVE: 'Матч идёт',
    FT: 'Завершён', AET: 'Завершён после доп. времени', PEN: 'Завершён по пенальти',
    SUSP: 'Приостановлен', PST: 'Перенесён', CANC: 'Отменён', ABD: 'Прерван', AWD: 'Тех. результат', WO: 'Без игры',
  };
  const base = labels[s] || s || 'Статус неизвестен';
  return isLiveStatus(s) && Number.isFinite(Number(elapsed)) ? `${base} · ${Number(elapsed)}′` : base;
}


export const COMPETITIONS = new Map([
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

export const BIG_TEAM_RE = /arsenal|liverpool|chelsea|manchester (city|united)|tottenham|newcastle|real madrid|barcelona|atletico madrid|bayern|dortmund|paris saint|psg|inter|milan|juventus|napoli|roma|benfica|porto|sporting|ajax|psv|feyenoord|inter miami|flamengo|palmeiras|river plate|boca juniors/i;
export const YOUTH_RESERVE_RE = /\bu-?1[789]\b|\bu-?2[013]\b|under ?(17|18|19|20|21|23)|youth|reserve|reserves|development|primavera|juniors?|academy/i;
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

export function normalizeCountryName(country = '') {
  const raw = String(country || '').trim();
  return COUNTRY_RU.get(raw) || raw || 'Мир';
}

export function isYouthReserveMatch(leagueName = '', homeName = '', awayName = '') {
  return YOUTH_RESERVE_RE.test(`${leagueName || ''} ${homeName || ''} ${awayName || ''}`);
}

export function detectCompetitionCategory(leagueId, leagueName = '', country = '', homeName = '', awayName = '') {
  const known = COMPETITIONS.get(Number(leagueId));
  const hay = `${leagueName} ${country} ${homeName} ${awayName}`;
  if (isYouthReserveMatch(leagueName, homeName, awayName)) return 'youth';
  if (WOMEN_RE.test(hay)) return 'women';
  if (FRIENDLY_RE.test(leagueName)) return 'friendly';
  if (known?.category) return known.category;
  if (/champions|europa|conference|world cup|euro|copa america|nations league|club world/i.test(leagueName)) return 'international';
  if (CUP_RE.test(leagueName)) return 'cup';
  if (LOWER_RE.test(leagueName)) return 'lower';
  return 'league';
}

export function leagueGroup(leagueId, leagueName = '', country = '') {
  const known = COMPETITIONS.get(Number(leagueId));
  if (known?.group) return known.group;
  const n = String(leagueName).toLowerCase();
  const c = String(country).toLowerCase();
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

export function normalizeCompetition(leagueId, leagueName = '', country = '', homeName = '', awayName = '') {
  const id = Number(leagueId || 0);
  const known = COMPETITIONS.get(id);
  const category = detectCompetitionCategory(id, leagueName, country, homeName, awayName);
  const youth = category === 'youth';
  const friendly = category === 'friendly';
  const lower = category === 'lower';
  let tier = known?.tier || 'standard';
  let priority = Number(known?.priority || 45);
  const lname = String(leagueName || '').toLowerCase();
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
  const group = known?.group || leagueGroup(id, leagueName, country);
  return {
    id,
    originalName: String(leagueName || ''),
    name: known?.name || String(leagueName || 'Турнир'),
    shortName: known?.short || known?.name || String(leagueName || 'Турнир'),
    country: normalizeCountryName(country),
    countryRaw: String(country || ''),
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

export function isTopLeague(leagueId, leagueName = '') {
  const known = COMPETITIONS.get(Number(leagueId));
  if (known) return known.priority >= 80;
  if (YOUTH_RESERVE_RE.test(String(leagueName || ''))) return false;
  return /premier league|la liga|serie a|bundesliga|ligue 1|champions league|europa league|conference league|world cup|copa america|major league soccer|primeira liga/i.test(String(leagueName));
}

export function normalizeRoundLabel(round = '') {
  const raw = String(round || '').trim();
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

export function matchInterestScore({ competition, leagueId, leagueName, country, homeName, awayName, status, date }) {
  const comp = competition || normalizeCompetition(leagueId, leagueName, country, homeName, awayName);
  let score = Math.max(8, Math.min(72, Number(comp.priority || 45)));
  if (BIG_TEAM_RE.test(homeName || '')) score += 12;
  if (BIG_TEAM_RE.test(awayName || '')) score += 12;
  if (isLiveStatus(status)) score += 8;
  if (date) {
    const mins = Math.abs((Date.parse(date) - Date.now()) / 60000);
    if (mins <= 180) score += 5;
  }
  if (comp.youth) score -= 28;
  if (comp.friendly) score -= 18;
  if (comp.lower) score -= 14;
  return Math.max(5, Math.min(99, Math.round(score)));
}

export function catalogRank(match) {
  const cat = match?.competition?.category || match?.category || '';
  if (match?.live) return 0;
  if (match?.competition?.featured || match?.featured) return 1;
  if (cat === 'continental' || cat === 'national' || cat === 'international') return 2;
  if (cat === 'league' || cat === 'cup') return 3;
  if (cat === 'women') return 4;
  if (cat === 'friendly') return 6;
  if (cat === 'youth' || cat === 'lower') return 7;
  return 5;
}

export function matchStatusRank(status) {
  if (isLiveStatus(status)) return 0;
  if (['NS','TBD'].includes(status)) return 1;
  if (isFinishedStatus(status)) return 2;
  return 3;
}

