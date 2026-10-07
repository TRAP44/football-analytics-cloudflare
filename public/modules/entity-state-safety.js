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

export function positiveEntityId(value) {
  if (typeof value==='number') {
    return Number.isSafeInteger(value) && value>0 ? value : 0;
  }
  if (typeof value!=='string') return 0;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return 0;
  const parsed=Number(raw);
  return Number.isSafeInteger(parsed) && parsed>0 ? parsed : 0;
}

export function teamEntityKey(team) {
  const source=plainObject(team);
  const id=positiveEntityId(safeRead(source,'id'));
  return id ? String(id) : '';
}

export function tournamentEntityKey(tournament) {
  const source=plainObject(tournament);
  const leagueId=positiveEntityId(safeRead(source,'leagueId'));
  const season=positiveEntityId(safeRead(source,'season'));
  return leagueId && season ? `${leagueId}:${season}` : '';
}

export function teamCompetitionEntityKey(team) {
  const source=plainObject(team);
  const teamId=positiveEntityId(safeRead(source,'id'));
  const data=plainObject(safeRead(source,'data'));
  const competition=plainObject(safeRead(data,'primaryCompetition'));
  const leagueId=positiveEntityId(safeRead(competition,'leagueId'));
  const season=positiveEntityId(safeRead(competition,'season'));
  return teamId && leagueId && season
    ? `${teamId}:${leagueId}:${season}`
    : '';
}

export function isCurrentEntityRequest({
  sequence,
  currentSequence,
  expectedKey,
  currentKey,
}={}) {
  return Number.isSafeInteger(sequence)
    && sequence>0
    && Number.isSafeInteger(currentSequence)
    && currentSequence>0
    && typeof expectedKey==='string'
    && expectedKey.length>0
    && expectedKey===currentKey
    && sequence===currentSequence;
}

export function collectionItems(payload,key='items') {
  const source=plainObject(payload);
  if (!source || typeof key!=='string' || !key) return [];
  const value=safeRead(source,key);
  return Array.isArray(value) ? value : [];
}

export function uiErrorMessage(error,fallback='Не удалось получить данные.') {
  const message=safeRead(error,'message');
  if (typeof message!=='string') return fallback;
  const text=message
    .replace(/[\u0000-\u001f\u007f]+/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,280);
  return text || fallback;
}

export function tournamentTabForTeamShortcut(openTable=false) {
  return openTable===true ? 'table' : 'matches';
}
