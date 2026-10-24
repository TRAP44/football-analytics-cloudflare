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

export function createWatchSessionStore({memory={},hasSupabase,supaSelectOne,supaRpc,now=Date.now}){
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
  return {
    getWatchSession:async(uid,cfg)=>{
      const payload=await read(keyFor(uid),cfg);
      if(payload===null){absent.add(uid);if(absent.size>4096)absent.delete(absent.values().next().value);return null;}
      absent.delete(uid);
      if(!Object.hasOwn(payload,'session'))throw Error('WATCH_STATE_INVALID');
      if(payload.session===null)return null;
      const session=normalizeWatchSession(payload.session,now());
      if(!session&&!(Date.parse(payload.session?.expiresAt)<=now()))throw Error('WATCH_STATE_INVALID');
      return session;
    },
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
