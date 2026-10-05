function compactText(value = '') {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/gu, ' ');
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

export function normalizePlayerName(value = '') {
  return compactText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/giu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function knownPlayerIds(player = {}) {
  const ids=[];
  let invalidKnownIdCount=0;

  for (const value of [player?.id, player?.playerId, player?.player_id]) {
    if (
      value === undefined
      || value === null
      || value === ''
      || (typeof value === 'string' && !value.trim())
    ) continue;
    const id=integerCandidate(value);
    if (id === 0) continue;
    if (id === null || id < 0) {
      invalidKnownIdCount += 1;
      continue;
    }
    ids.push(id);
  }

  return {
    ids:[...new Set(ids)],
    invalidKnownIdCount,
  };
}

function playerNameCandidate(player = {}) {
  for (const value of [player?.name, player?.playerName, player?.player_name]) {
    const name=compactText(value);
    if (name) return name;
  }
  return '';
}

export function describePlayerIdentity(player = {}) {
  const knownIds = knownPlayerIds(player);
  const ids=knownIds.ids;
  const name = playerNameCandidate(player);
  const normalizedName = normalizePlayerName(name);
  return {
    id: ids.length === 1 ? ids[0] : 0,
    ids,
    name,
    normalizedName,
    invalidKnownIdCount:knownIds.invalidKnownIdCount,
    invalidKnownIdValue:knownIds.invalidKnownIdCount > 0,
    knownIdConflict: ids.length > 1,
  };
}

export function createPlayerIdentityResolver(players = []) {
  const list = Array.isArray(players) ? players : [];
  const nameToIds = new Map();

  for (const player of list) {
    const descriptor = describePlayerIdentity(player);
    if (descriptor.knownIdConflict || descriptor.invalidKnownIdValue || !descriptor.id || !descriptor.normalizedName) continue;
    const ids = nameToIds.get(descriptor.normalizedName) || new Set();
    ids.add(descriptor.id);
    nameToIds.set(descriptor.normalizedName, ids);
  }

  function resolve(player = {}) {
    const descriptor = describePlayerIdentity(player);
    if (descriptor.invalidKnownIdValue) {
      return {
        ...descriptor,
        key:'',
        valid:false,
        reason:'invalid_known_id',
        ambiguous:false,
        via:'invalid_id',
      };
    }

    if (descriptor.knownIdConflict) {
      return {
        ...descriptor,
        key:'',
        valid:false,
        reason:'conflicting_known_ids',
        ambiguous:false,
        via:'conflict',
      };
    }

    if (descriptor.id) {
      return {
        ...descriptor,
        key:`id:${descriptor.id}`,
        valid:true,
        reason:'',
        ambiguous:false,
        via:'id',
      };
    }

    if (!descriptor.normalizedName) {
      return {
        ...descriptor,
        key:'',
        valid:false,
        reason:'identity_missing',
        ambiguous:false,
        via:'missing',
      };
    }

    const aliases = nameToIds.get(descriptor.normalizedName);
    if (aliases?.size > 1) {
      return {
        ...descriptor,
        key:'',
        valid:false,
        reason:'name_alias_ambiguous',
        ambiguous:true,
        via:'ambiguous_name',
      };
    }

    if (aliases?.size === 1) {
      const [id] = aliases;
      return {
        ...descriptor,
        id,
        key:`id:${id}`,
        valid:true,
        reason:'',
        ambiguous:false,
        via:'name_alias',
      };
    }

    return {
      ...descriptor,
      key:`name:${descriptor.normalizedName}`,
      valid:true,
      reason:'',
      ambiguous:false,
      via:'name',
    };
  }

  function matches(left = {}, right = {}) {
    const a = describePlayerIdentity(left);
    const b = describePlayerIdentity(right);
    if (
      a.invalidKnownIdValue
      || b.invalidKnownIdValue
      || a.knownIdConflict
      || b.knownIdConflict
    ) return false;

    if (a.id && b.id) return a.id === b.id;

    if (a.id || b.id) {
      const known = a.id ? a : b;
      const fallback = a.id ? b : a;
      if (!fallback.normalizedName) return false;
      const aliases = nameToIds.get(fallback.normalizedName);
      return aliases?.size === 1 && aliases.has(known.id);
    }

    if (!a.normalizedName || a.normalizedName !== b.normalizedName) return false;
    const aliases=nameToIds.get(a.normalizedName);
    return !aliases || aliases.size <= 1;
  }

  function aliasIds(name = '') {
    return new Set(nameToIds.get(normalizePlayerName(name)) || []);
  }

  return Object.freeze({
    resolve,
    matches,
    aliasIds,
  });
}
