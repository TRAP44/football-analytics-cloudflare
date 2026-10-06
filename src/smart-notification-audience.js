import {
  effectiveNotificationPlan,
  notificationDecision,
} from './smart-notification-policy.js';

const MAX_BATCH_SIZE = 200;
const MAX_ROWS_PER_USER = 50;
const CONTEXT_TABLES = new Set(['users','user_preferences','favorite_players']);

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function positiveUserId(value) {
  const id=integerCandidate(value);
  return id !== null && id > 0 ? id : 0;
}

function rowUserId(row) {
  const source=plainObject(row);
  if (!source) return 0;
  if (Object.hasOwn(source,'telegram_id')) return positiveUserId(source.telegram_id);
  if (Object.hasOwn(source,'telegramId')) return positiveUserId(source.telegramId);
  return 0;
}

function positivePlayerId(row) {
  const source=plainObject(row);
  if (!source) return 0;
  if (Object.hasOwn(source,'player_id')) return positiveUserId(source.player_id);
  if (Object.hasOwn(source,'playerId')) return positiveUserId(source.playerId);
  return 0;
}

function positiveUserIds(rows = []) {
  const output=[];
  const seen=new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id=plainObject(row) ? rowUserId(row) : positiveUserId(row);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push(id);
  }
  return output;
}

function chunks(values, size = MAX_BATCH_SIZE) {
  const safeValues=Array.isArray(values) ? values : [];
  const safeSize=Number.isSafeInteger(size) && size >= 1 && size <= MAX_BATCH_SIZE
    ? size
    : MAX_BATCH_SIZE;
  const output=[];
  for (let index=0; index<safeValues.length; index+=safeSize) {
    output.push(safeValues.slice(index,index+safeSize));
  }
  return output;
}

function strictSupabaseAvailable(hasSupabase,cfg) {
  try {
    return typeof hasSupabase === 'function' && hasSupabase(cfg) === true;
  } catch {
    return false;
  }
}

function boundedMultiplier(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_ROWS_PER_USER
    ? value
    : 1;
}

function uniqueSourceRows(rows) {
  const output=[];
  const seen=new Set();
  let invalid=0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!plainObject(row)) {
      invalid+=1;
      continue;
    }
    const userId=rowUserId(row);
    if (!userId) {
      invalid+=1;
      continue;
    }
    if (seen.has(userId)) continue;
    seen.add(userId);
    output.push(row);
  }
  return {rows:output,invalid};
}

function collectSingleContext(rows,userIds) {
  const allowed=new Set(userIds);
  const values=new Map();
  const ambiguous=new Set();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!plainObject(row)) continue;
    const userId=rowUserId(row);
    if (!userId || !allowed.has(userId) || ambiguous.has(userId)) continue;
    if (values.has(userId)) {
      values.delete(userId);
      ambiguous.add(userId);
      continue;
    }
    values.set(userId,row);
  }
  return {values,ambiguous};
}

function sanitizeFavoriteRows(rows,userId) {
  const output=[];
  const seenPlayers=new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!plainObject(row) || rowUserId(row) !== userId) continue;
    const playerId=positivePlayerId(row);
    if (!playerId || seenPlayers.has(playerId)) continue;
    seenPlayers.add(playerId);
    output.push(row);
    if (output.length >= MAX_ROWS_PER_USER) break;
  }
  return output;
}

export function createSmartNotificationAudience({
  hasSupabase,
  supaSelectMany,
  getPreferences,
  getUserRecord,
  getFavoritePlayers,
} = {}) {
  if (typeof hasSupabase !== 'function') throw new TypeError('hasSupabase is required');
  if (typeof supaSelectMany !== 'function') throw new TypeError('supaSelectMany is required');

  async function loadRowsByUserIds(table, userIds, cfg, limitMultiplier = 1) {
    if (!CONTEXT_TABLES.has(table)) throw new TypeError('unsupported smart notification audience table');
    const ids=positiveUserIds(userIds);
    if (!ids.length) return [];

    const multiplier=boundedMultiplier(limitMultiplier);
    const output=[];
    for (const batch of chunks(ids,MAX_BATCH_SIZE)) {
      const allowed=new Set(batch);
      const rows=await supaSelectMany(
        cfg,
        table,
        {telegram_id:`in.(${batch.join(',')})`},
        {limit:Math.min(MAX_BATCH_SIZE*MAX_ROWS_PER_USER,Math.max(batch.length*multiplier,batch.length))},
      );
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!plainObject(row)) continue;
        const userId=rowUserId(row);
        if (!userId || !allowed.has(userId)) continue;
        output.push(row);
      }
    }
    return output;
  }

  async function loadContexts(rows, cfg) {
    const userIds=positiveUserIds(rows);
    const users=new Map();
    const preferences=new Map();
    const ambiguousUsers=new Set();
    const ambiguousPreferences=new Set();
    const preferenceFailures=new Set();

    if (!userIds.length) {
      return {users,preferences,ambiguousUsers,ambiguousPreferences,preferenceFailures};
    }

    if (strictSupabaseAvailable(hasSupabase,cfg)) {
      const [userRows,preferenceRows]=await Promise.all([
        loadRowsByUserIds('users',userIds,cfg,1),
        loadRowsByUserIds('user_preferences',userIds,cfg,1),
      ]);
      const userContexts=collectSingleContext(userRows,userIds);
      const preferenceContexts=collectSingleContext(preferenceRows,userIds);
      for (const [userId,row] of userContexts.values) users.set(userId,row);
      for (const [userId,row] of preferenceContexts.values) preferences.set(userId,row);
      for (const userId of userContexts.ambiguous) ambiguousUsers.add(userId);
      for (const userId of preferenceContexts.ambiguous) ambiguousPreferences.add(userId);
      return {users,preferences,ambiguousUsers,ambiguousPreferences,preferenceFailures};
    }

    await Promise.all(userIds.map(async userId=>{
      let user=null;
      let prefs=null;

      if (typeof getUserRecord === 'function') {
        try {
          const candidate=await getUserRecord(userId,cfg);
          if (plainObject(candidate) && (!rowUserId(candidate) || rowUserId(candidate) === userId)) {
            user=candidate;
          }
        } catch {}
      }

      if (typeof getPreferences === 'function') {
        try {
          const candidate=await getPreferences(userId,cfg);
          if (plainObject(candidate)) prefs=candidate;
          else preferenceFailures.add(userId);
        } catch {
          preferenceFailures.add(userId);
        }
      }

      if (user) users.set(userId,user);
      if (prefs) preferences.set(userId,prefs);
    }));

    return {users,preferences,ambiguousUsers,ambiguousPreferences,preferenceFailures};
  }

  async function filterRecipients(rows = [], eventType, cfg) {
    const source=uniqueSourceRows(rows);
    if (typeof eventType !== 'string' || !eventType.trim()) {
      return {
        rows:[],
        checked:Array.isArray(rows) ? rows.length : 0,
        blockedByPreference:source.rows.length,
        blockedByEntitlement:0,
        invalidRecipients:source.invalid,
        contextFailures:source.rows.length,
      };
    }

    const {
      users,
      preferences,
      ambiguousUsers,
      ambiguousPreferences,
      preferenceFailures,
    }=await loadContexts(source.rows,cfg);
    const eligible=[];
    let blockedByPreference=0;
    let blockedByEntitlement=0;
    let contextFailures=0;

    for (const row of source.rows) {
      const userId=rowUserId(row);
      if (!userId) continue;

      if (ambiguousPreferences.has(userId) || preferenceFailures.has(userId)) {
        blockedByPreference+=1;
        contextFailures+=1;
        continue;
      }

      const user=ambiguousUsers.has(userId) ? {plan:'FREE'} : (users.get(userId) || {plan:'FREE'});
      const prefs=preferences.get(userId) || {};
      const decision=notificationDecision({
        eventType:eventType.trim(),
        plan:effectiveNotificationPlan(user),
        preferences:prefs.notificationPreferences ?? prefs.notification_preferences ?? {},
      });
      if (decision?.allowed === true) eligible.push(row);
      else if (decision?.reason === 'entitlement_required') blockedByEntitlement+=1;
      else blockedByPreference+=1;
    }

    return {
      rows:eligible,
      checked:Array.isArray(rows) ? rows.length : 0,
      blockedByPreference,
      blockedByEntitlement,
      invalidRecipients:source.invalid,
      contextFailures,
    };
  }

  async function loadFavoritePlayersByUser(rows = [], cfg) {
    const userIds=positiveUserIds(rows);
    const byUser=new Map(userIds.map(id=>[id,[]]));
    if (!userIds.length) return byUser;

    if (strictSupabaseAvailable(hasSupabase,cfg)) {
      const favorites=await loadRowsByUserIds('favorite_players',userIds,cfg,MAX_ROWS_PER_USER);
      for (const userId of userIds) {
        byUser.set(userId,sanitizeFavoriteRows(favorites,userId));
      }
      return byUser;
    }

    await Promise.all(userIds.map(async userId=>{
      if (typeof getFavoritePlayers !== 'function') {
        byUser.set(userId,[]);
        return;
      }
      try {
        const favorites=await getFavoritePlayers(userId,cfg);
        byUser.set(userId,sanitizeFavoriteRows(favorites,userId));
      } catch {
        byUser.set(userId,[]);
      }
    }));
    return byUser;
  }

  return Object.freeze({
    filterRecipients,
    loadFavoritePlayersByUser,
  });
}
