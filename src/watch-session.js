export const WATCH_SESSION_MS=3*3600000;
export function normalizeWatchSession(value,now=Date.now()){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const {fixtureId,delaySeconds}=value,start=Date.parse(value.startedAt),end=Date.parse(value.expiresAt);
  if(!Number.isSafeInteger(fixtureId)||fixtureId<=0||![0,30,60,90].includes(delaySeconds)||!Number.isFinite(start)||!Number.isFinite(end)||start>now+5000||end<=now||end<=start||end-start>WATCH_SESSION_MS)return null;
  return {fixtureId,delaySeconds,startedAt:new Date(start).toISOString(),expiresAt:new Date(end).toISOString()};
}
export function watchingFixture(preferences,fixtureId,now=Date.now()){
  const session=normalizeWatchSession(preferences?.notificationPreferences?.watchSession??preferences?.notification_preferences?.watchSession??preferences?.watchSession,now);
  return session&&session.fixtureId===Number(fixtureId)?session:null;
}

export function createWatchSessionStore({memory={},hasSupabase,supaSelectOne,supaSelectMany,supaRpc,now=Date.now}){
  const local=memory.watchSessions instanceof Map?memory.watchSessions:(memory.watchSessions=new Map());
  const absent=new Set();
  const keyFor=uid=>{if(!Number.isSafeInteger(uid)||uid<=0)throw Error('WATCH_USER_INVALID');return `watch-session:${uid}:v1`;};
  async function read(key,cfg){
    if(!hasSupabase(cfg)){const row=local.get(key);return row&&row.expiresAt>now()?row.payload:null;}
    // Deliberately bypass Worker L1: an ACK from another isolate must be visible.
    const row=await supaSelectOne(cfg,'analysis_cache',{cache_key:`eq.${key}`});
    if(!row)return null;
    if(!Number.isFinite(Date.parse(row.expires_at)))throw Error('WATCH_STATE_INVALID');
    if(Date.parse(row.expires_at)<=now())return null;
    if(row.cache_key!==key||!row.payload||typeof row.payload!=='object')throw Error('WATCH_STATE_INVALID');
    return row.payload;
  }
  async function write(key,fixtureId,payload,updatedAt,cfg,minutes=180){
    if(!hasSupabase(cfg)){local.set(key,{payload,expiresAt:now()+minutes*60000});return true;}
    const stamp=new Date(updatedAt).toISOString();
    const result=await supaRpc(cfg,'write_analysis_cache_versioned',{p_cache_key:key,p_fixture_id:fixtureId,p_payload:payload,p_expires_at:new Date(now()+minutes*60000).toISOString(),p_provider:'watch-session',p_source_updated_at:stamp,p_freshness_status:'fresh',p_updated_at:stamp});
    return result?.stored===true&&['stored','same'].includes(result.reason);
  }
  function sessionFromPayload(payload,at=now()){
    if(payload===null)return null;
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||!Object.hasOwn(payload,'session'))throw Error('WATCH_STATE_INVALID');
    if(payload.session===null)return null;
    const session=normalizeWatchSession(payload.session,at);
    if(!session&&!(Date.parse(payload.session?.expiresAt)<=at))throw Error('WATCH_STATE_INVALID');
    return session;
  }
  async function getWatchDeliveryState(uid,markerKey,cfg){
    const sessionKey=keyFor(uid);
    if(markerKey!==null&&(typeof markerKey!=='string'||markerKey.length>1000||!markerKey.startsWith(`watch-goal:${uid}:`)||!/^watch-goal:[A-Za-z0-9._:+-]+$/.test(markerKey)))throw Error('WATCH_MARKER_INVALID');
    const keys=markerKey?[sessionKey,markerKey]:[sessionKey],values=new Map();
    const persistent=hasSupabase(cfg);
    if(persistent===false){
      const at=now();for(const key of keys){const row=local.get(key);if(row&&row.expiresAt>at)values.set(key,row.payload);}
    }else if(persistent===true&&typeof supaSelectMany==='function'){
      // One SQL snapshot for the current control AND durable no-backlog marker.
      // No Worker L1/negative cache and no marker read after this decision.
      const rows=await supaSelectMany(cfg,'analysis_cache',{cache_key:`in.(${keys.map(key=>`"${key}"`).join(',')})`},{select:'cache_key,payload,expires_at',limit:keys.length,timeoutMs:1500});
      if(!Array.isArray(rows)||rows.length>keys.length)throw Error('WATCH_STATE_INVALID');
      const seen=new Set(),at=now();
      for(const row of rows){
        if(!row||typeof row!=='object'||!keys.includes(row.cache_key)||seen.has(row.cache_key)||!Number.isFinite(Date.parse(row.expires_at)))throw Error('WATCH_STATE_INVALID');
        seen.add(row.cache_key);
        if(Date.parse(row.expires_at)<=at)continue;
        if(!row.payload||typeof row.payload!=='object'||Array.isArray(row.payload))throw Error('WATCH_STATE_INVALID');
        values.set(row.cache_key,row.payload);
      }
    }else throw Error('WATCH_STATE_UNAVAILABLE');
    const payload=values.get(sessionKey)??null;
    if(payload===null){absent.add(uid);if(absent.size>4096)absent.delete(absent.values().next().value);}else absent.delete(uid);
    return {session:sessionFromPayload(payload),marker:markerKey?values.get(markerKey)??null:null};
  }
  return {
    getWatchSession:async(uid,cfg)=>{
      const payload=await read(keyFor(uid),cfg);
      if(payload===null){absent.add(uid);if(absent.size>4096)absent.delete(absent.values().next().value);return null;}
      absent.delete(uid);
      return sessionFromPayload(payload);
    },
    getWatchDeliveryState,
    saveWatchSession:async(uid,input,cfg)=>{
      const stamp=now(),session=input===null?null:normalizeWatchSession({...input,startedAt:new Date(stamp).toISOString(),expiresAt:new Date(stamp+WATCH_SESSION_MS).toISOString()},stamp);
      if(input!==null&&!session)throw Error('WATCH_INPUT_INVALID');
      if(!await write(keyFor(uid),session?.fixtureId||0,{session},stamp,cfg,480))throw Error('WATCH_WRITE_UNCONFIRMED');
      absent.delete(uid);return session;
    },
    getWatchMarker:(key,cfg)=>{const user=String(key).match(/^watch-goal:(\d+):/);return user&&absent.has(Number(user[1]))?Promise.resolve(null):read(key,cfg);},
    // A stale delayed-goal writer cannot overwrite a newer pause marker: use
    // the authoritative session revision, rather than the eventual write time.
    setWatchMarker:(key,id,payload,session,cfg)=>write(key,id,payload,Date.parse(session.startedAt),cfg,240),
  };
}
