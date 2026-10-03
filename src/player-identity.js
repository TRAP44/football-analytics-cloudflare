function compactText(value = '') {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
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
  const ids = [
    Number(player?.id || 0),
    Number(player?.playerId || 0),
    Number(player?.player_id || 0),
  ].filter(id => Number.isSafeInteger(id) && id > 0);
  return [...new Set(ids)];
}

export function describePlayerIdentity(player = {}) {
  const ids = knownPlayerIds(player);
  const name = compactText(player?.name || player?.playerName || player?.player_name || '');
  const normalizedName = normalizePlayerName(name);
  return {
    id: ids.length === 1 ? ids[0] : 0,
    ids,
    name,
    normalizedName,
    knownIdConflict: ids.length > 1,
  };
}

export function createPlayerIdentityResolver(players = []) {
  const list = Array.isArray(players) ? players : [];
  const nameToIds = new Map();

  for (const player of list) {
    const descriptor = describePlayerIdentity(player);
    if (descriptor.knownIdConflict || !descriptor.id || !descriptor.normalizedName) continue;
    const ids = nameToIds.get(descriptor.normalizedName) || new Set();
    ids.add(descriptor.id);
    nameToIds.set(descriptor.normalizedName, ids);
  }

  function resolve(player = {}) {
    const descriptor = describePlayerIdentity(player);
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
    if (a.knownIdConflict || b.knownIdConflict) return false;

    if (a.id && b.id) return a.id === b.id;

    if (a.id || b.id) {
      const known = a.id ? a : b;
      const fallback = a.id ? b : a;
      if (!fallback.normalizedName) return false;
      const aliases = nameToIds.get(fallback.normalizedName);
      return aliases?.size === 1 && aliases.has(known.id);
    }

    return Boolean(a.normalizedName && a.normalizedName === b.normalizedName);
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
