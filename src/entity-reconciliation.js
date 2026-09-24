export function providerTeamNameKey(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\bfootball club\b/g, ' ')
    .replace(/\b(fc|cf|sc|afc|ac|fk|sv|club)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bmunchen\b/g, 'munich')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveStandingTeamRow(rows = [], { teamId = 0, teamName = '' } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const canonicalId = Number(teamId || 0);
  if (canonicalId > 0) {
    const byId = list.find(row => Number(row?.team?.id || 0) === canonicalId);
    if (byId) return { row: byId, matchedBy: 'canonical_id' };
  }

  const key = providerTeamNameKey(teamName);
  if (!key) return { row: null, matchedBy: '' };
  const matches = list.filter(row => providerTeamNameKey(row?.team?.name || '') === key);
  if (matches.length !== 1) return { row: null, matchedBy: '' };
  return { row: matches[0], matchedBy: 'normalized_name' };
}
