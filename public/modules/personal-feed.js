import { positiveEntityId } from './entity-state-safety.js';

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

export function normalizePersonalSignalText(value) {
  if (typeof value!=='string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]+/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,180)
    .toLocaleLowerCase('ru-RU');
}

function finiteNonNegative(value,cap) {
  if (typeof value!=='number' || !Number.isFinite(value) || value<0) return 0;
  return Math.min(cap,value);
}

function safeSet(value) {
  return value instanceof Set ? value : new Set();
}

export function buildPersonalContextSignals({
  favorites=[],
  history=[],
  historyLimit=20,
}={}) {
  const favoriteTeams=new Set();
  const viewedTeams=new Set();
  const viewedLeagues=new Set();

  if (Array.isArray(favorites)) {
    for (const raw of favorites.slice(0,200)) {
      const row=plainObject(raw);
      const teamId=positiveEntityId(safeRead(row,'teamId'));
      if (teamId) favoriteTeams.add(teamId);
    }
  }

  const limit=Number.isSafeInteger(historyLimit)
    ? Math.max(0,Math.min(100,historyLimit))
    : 20;
  if (Array.isArray(history)) {
    for (const raw of history.slice(0,limit)) {
      const row=plainObject(raw);
      if (!row) continue;
      const home=normalizePersonalSignalText(safeRead(row,'homeName'));
      const away=normalizePersonalSignalText(safeRead(row,'awayName'));
      const league=normalizePersonalSignalText(safeRead(row,'leagueName'));
      if (home) viewedTeams.add(home);
      if (away) viewedTeams.add(away);
      if (league) viewedLeagues.add(league);
    }
  }

  return {
    favoriteTeams,
    viewedTeams,
    viewedLeagues,
    hasPersonalData:favoriteTeams.size>0 || viewedTeams.size>0,
  };
}

export function evaluatePersonalMatchInsight(match,signals={}) {
  const row=plainObject(match) || {};
  const home=plainObject(safeRead(row,'home')) || {};
  const away=plainObject(safeRead(row,'away')) || {};
  const competition=plainObject(safeRead(row,'competition')) || {};

  const homeId=positiveEntityId(safeRead(home,'id'));
  const awayId=positiveEntityId(safeRead(away,'id'));
  const homeName=normalizePersonalSignalText(safeRead(home,'name'));
  const awayName=normalizePersonalSignalText(safeRead(away,'name'));
  const leagueName=normalizePersonalSignalText(
    typeof safeRead(row,'league')==='string'
      ? safeRead(row,'league')
      : safeRead(row,'leagueOriginal'),
  );

  const favoriteTeams=safeSet(safeRead(signals,'favoriteTeams'));
  const viewedTeams=safeSet(safeRead(signals,'viewedTeams'));
  const viewedLeagues=safeSet(safeRead(signals,'viewedLeagues'));

  const favorite=(
    (homeId>0 && favoriteTeams.has(homeId))
    || (awayId>0 && favoriteTeams.has(awayId))
  );
  const viewedTeam=(
    (homeName && viewedTeams.has(homeName))
    || (awayName && viewedTeams.has(awayName))
  );
  const viewedLeague=Boolean(leagueName && viewedLeagues.has(leagueName));

  const interestScore=finiteNonNegative(safeRead(row,'interestScore'),100);
  const competitionPriority=finiteNonNegative(safeRead(competition,'priority'),100);
  const live=safeRead(row,'live')===true;
  const featured=safeRead(row,'featured')===true;
  const lowPriority=safeRead(row,'lowPriority')===true;
  const youthReserve=safeRead(row,'youthReserve')===true;
  const hasPersonalData=safeRead(signals,'hasPersonalData')===true;

  let score=Math.min(34,interestScore*.34)+Math.min(26,competitionPriority*3);
  if (favorite) score+=150;
  if (viewedTeam) score+=72;
  else if (viewedLeague) score+=18;
  if (live) score+=48;
  if (featured) score+=34;
  if (lowPriority) score-=55;
  if (youthReserve) score-=80;

  let reason='';
  if (favorite) reason='Любимая команда';
  else if (viewedTeam) reason='Вы смотрели эту команду';
  else if (live) reason='Сейчас в эфире';
  else if (featured) reason='Главный матч';
  else if (viewedLeague) reason='Знакомый турнир';
  else if (interestScore>=80) reason='Высокий интерес';

  const baseline=featured || (interestScore>=68 && !lowPriority);
  const recommended=hasPersonalData
    ? Boolean(
      favorite
      || viewedTeam
      || live
      || featured
      || (!lowPriority && interestScore>=74)
    )
    : baseline;

  return {
    score,
    reason,
    favorite,
    viewedTeam:Boolean(viewedTeam),
    viewedLeague,
    recommended,
  };
}
