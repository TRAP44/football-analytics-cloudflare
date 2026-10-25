import {
  effectiveNotificationPlan,
  notificationDecision,
} from './smart-notification-policy.js';

const MAX_BATCH_SIZE = 200;
const MAX_ROWS_PER_USER = 50;
const CONTEXT_TABLES = new Set(['users','user_preferences','favorite_players']);
const EVENT_TYPE_RE = /^(?:match|team|player|ai|radar|market)\.[a-z0-9][a-z0-9_.-]{0,78}$/;

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

function sanitizedUserForPlan(user) {
  const source=plainObject(user) || {};
  const plan=typeof source.plan === 'string' ? source.plan : 'FREE';
  const subscriptionUntil=typeof source.subscription_until === 'string'
    ? source.subscription_until
    : typeof source.subscriptionUntil === 'string'
      ? source.subscriptionUntil
      : '';
  return {
    plan,
    subscription_until:subscriptionUntil,
  };
}

function preferencePayload(row) {
  const source=plainObject(row);
  if (!source) return {valid:false,value:{}};
  const hasCamel=Object.hasOwn(source,'notificationPreferences');
  const hasSnake=Object.hasOwn(source,'notification_preferences');
  if (!hasCamel && !hasSnake) return {valid:true,value:{}};
  const value=hasCamel ? source.notificationPreferences : source.notification_preferences;
  return plainObject(value)
    ? {valid:true,value}
    : {valid:false,value:{}};
}

function normalizedEventType(value) {
  if (typeof value !== 'string') return '';
  const eventType=value.trim().toLowerCase();
  return EVENT_TYPE_RE.test(eventType) ? eventType : '';
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

  async function loadRowsByUserIds(table, userIds, cfg, limitMultiplier = 1, timeoutMs = 7000) {
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
        {limit:Math.min(MAX_BATCH_SIZE*MAX_ROWS_PER_USER,Math.max(batch.length*multiplier,batch.length)),timeoutMs},
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

  async function loadContexts(rows, cfg, timeoutMs = 7000) {
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
        loadRowsByUserIds('users',userIds,cfg,2,timeoutMs),
        loadRowsByUserIds('user_preferences',userIds,cfg,2,timeoutMs),
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
      } else {
        preferenceFailures.add(userId);
      }

      if (user) users.set(userId,user);
      if (prefs) preferences.set(userId,prefs);
    }));

    return {users,preferences,ambiguousUsers,ambiguousPreferences,preferenceFailures};
  }

  async function filterRecipients(rows = [], eventType, cfg, requiredEvents = [], timeoutMs = 7000, requireUser = false) {
    const source=uniqueSourceRows(rows);
    const safeEventType=normalizedEventType(eventType);
    if (!safeEventType || !Array.isArray(requiredEvents) || requiredEvents.some(type=>!normalizedEventType(type))) {
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
    }=await loadContexts(source.rows,cfg,timeoutMs);
    const eligible=[];
    let blockedByPreference=0;
    let blockedByEntitlement=0;
    let contextFailures=0;

    for (const row of source.rows) {
      const userId=rowUserId(row);
      if (!userId) continue;

      if (ambiguousPreferences.has(userId) || preferenceFailures.has(userId) || requireUser&&(!users.has(userId)||ambiguousUsers.has(userId))) {
        blockedByPreference+=1;
        contextFailures+=1;
        continue;
      }

      const user=ambiguousUsers.has(userId) ? {plan:'FREE'} : (users.get(userId) || {plan:'FREE'});
      const prefs=preferences.get(userId);
      const preference=preferencePayload(prefs || {});
      if (!preference.valid) {
        blockedByPreference+=1;
        contextFailures+=1;
        continue;
      }
      const decisions=[safeEventType,...requiredEvents].map(type=>notificationDecision({
        eventType:type,
        plan:effectiveNotificationPlan(sanitizedUserForPlan(user)),
        preferences:preference.value,
      }));
      const decision=decisions.find(item=>item.allowed!==true)||decisions[0];
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

  async function recheckDelivery(input,cfg) {
    if(!strictSupabaseAvailable(hasSupabase,cfg))return {allowed:false,unavailable:true};
    const row=plainObject(input?.row),userId=rowUserId(row),fixtureId=positiveUserId(row?.fixture_id??row?.fixtureId),eventType=normalizedEventType(input?.eventType);
    if(!userId||!fixtureId||!eventType)return {allowed:false,unavailable:true};
    const teamIds=Array.isArray(row._favoriteTeamIds)?[...new Set(row._favoriteTeamIds.map(positiveUserId).filter(Boolean))].slice(0,2):[];
    const playerId=positiveUserId(input?.playerId),player=eventType.startsWith('player.'),teamOnly=eventType.startsWith('team.');
    if(teamOnly&&!teamIds.length)return {allowed:false,unavailable:true};
    if(player&&(!playerId||!input.dedupeKey?.startsWith(`v1:${fixtureId}:${eventType}:p${playerId}:`)))return {allowed:false,unavailable:true};
    async function read(table,filters,select,valid){
      const result=await supaSelectMany(cfg,table,{telegram_id:`eq.${userId}`,...filters},{select,limit:3,timeoutMs:1500});
      if(!Array.isArray(result)||result.length>2||result.some(item=>!plainObject(item)||rowUserId(item)!==userId||!valid(item)))throw Error('Notification subscription unavailable');
      return result;
    }
    try{
      const [reminders,favorites,players]=await Promise.all([
        teamOnly?[]:read('match_reminders',{fixture_id:`eq.${fixtureId}`,enabled:'eq.true'},'telegram_id,fixture_id,enabled',item=>positiveUserId(item.fixture_id)===fixtureId&&item.enabled===true),
        !teamIds.length||player?[]:read('favorites',{team_id:`in.(${teamIds.join(',')})`},'telegram_id,team_id',item=>teamIds.includes(positiveUserId(item.team_id))),
        !player?[]:read('favorite_players',{player_id:`eq.${playerId}`},'telegram_id,player_id',item=>positiveUserId(item.player_id)===playerId),
      ]);
      if(reminders.length>1||players.length>1||new Set(favorites.map(item=>positiveUserId(item.team_id))).size!==favorites.length)throw Error('Ambiguous notification subscription');
      if(!player&&!reminders.length&&!teamIds.length&&row._favoriteOnly===true)return {allowed:false,unavailable:true};
      if(player?!reminders.length||!players.length:!reminders.length&&!favorites.length)return {allowed:false};
      // One fresh context load checks both the event category and, when the
      // favorite is the remaining source, the automatic team-alert preference.
      const decision=await filterRecipients([row],eventType,cfg,!reminders.length?['team.match_day']:[],1500,true);
      if(decision.contextFailures)return {allowed:false,unavailable:true};
      return {allowed:decision.rows.length===1};
    }catch{return {allowed:false,unavailable:true};}
  }

  return Object.freeze({
    filterRecipients,
    recheckDelivery,
    loadFavoritePlayersByUser,
  });
}
