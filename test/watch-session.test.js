import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWatchSession,watchingFixture,WATCH_SESSION_MS,createWatchSessionStore} from '../src/watch-session.js';
import {createSmartNotificationDeliveryService} from '../src/smart-notification-delivery.js';
import {createUserPreferencesService} from '../src/user-preferences.js';
import {createUserDataApiRuntime} from '../src/user-data-api-runtime.js';
import {createScoreboardHarness,fixtureRow,NOW} from '../scripts/scoreboard-harness.js';
const now=Date.now(),session=(delaySeconds=0,fixtureId=420)=>({fixtureId,delaySeconds,startedAt:new Date(now).toISOString(),expiresAt:new Date(now+WATCH_SESSION_MS).toISOString()});
const input={row:{telegram_id:42,fixture_id:420},eventType:'match.goal',category:'match',text:'Goal',dedupeKey:'v1:420:match.goal:55'};
function delivery(delaySeconds=0){
 let clock=now,prefs={notificationPreferences:{watchSession:session(delaySeconds)}},sends=0,claims=0,fail=false;
 const markers=new Map();
 const service=createSmartNotificationDeliveryService({memory:{},hasSupabase:()=>false,supaRpc:async()=>{throw Error('unexpected');},now:()=>clock,
 getWatchSession:async()=>{if(fail)throw Error('unavailable');return prefs.notificationPreferences?.watchSession??null;},getWatchMarker:async key=>markers.get(key),setWatchMarker:async(key,_id,value)=>{if(fail)return false;markers.set(key,value);return true;},
 sendTelegramMessage:async()=>{sends++;return {ok:true,status:200,outcome:'sent'};},recordOpsEvent:async()=>{claims++;}});
 return {run:(value=input)=>service.deliverSmartNotification(value,{}),tick:ms=>{clock+=ms;},off:()=>{prefs={};},fail:()=>{fail=true;},get sends(){return sends;},get claims(){return claims;}};
}

test('watch session is bounded, per fixture and rejects arbitrary timestamps and delays',()=>{
 assert.equal(watchingFixture({watchSession:session()},420,now).fixtureId,420);
 assert.equal(watchingFixture({watchSession:session()},421,now),null);
 for(const patch of [{fixtureId:0},{delaySeconds:1},{expiresAt:new Date(now-1).toISOString()},{startedAt:new Date(now+60000).toISOString()},{expiresAt:new Date(now+WATCH_SESSION_MS+1).toISOString()}])assert.equal(normalizeWatchSession({...session(),...patch},now),null);
});
test('pause suppresses a goal before ownership and does not deliver a backlog after watch ends',async()=>{
 const h=delivery();assert.equal((await h.run()).state,'watch_suppressed');assert.equal(h.sends,0);h.off();assert.equal((await h.run()).state,'watch_suppressed');assert.equal(h.sends,0);
 const other={...input,row:{...input.row,fixture_id:421},dedupeKey:'v1:421:match.goal:55'};assert.equal((await h.run(other)).state,'sent');assert.equal(h.sends,1);
});
test('goal delay uses stable first discovery time and preserves ordinary dedupe after the minimum',async()=>{
 const h=delivery(60);assert.equal((await h.run()).state,'watch_deferred');h.tick(59000);assert.equal((await h.run()).state,'watch_deferred');assert.equal(h.sends,0);h.tick(1000);assert.equal((await h.run()).state,'sent');assert.equal((await h.run()).state,'duplicate');assert.equal(h.sends,1);
});
test('unavailable preferences fail closed before Telegram delivery',async()=>{const h=delivery(30);h.fail();assert.equal((await h.run()).state,'watch_deferred');assert.equal(h.sends,0);});
test('a stale ordinary preferences save cannot overwrite an acknowledged watch session',async()=>{
 const rows=new Map();let release;const blocked=new Promise(resolve=>release=resolve);
 const store=createWatchSessionStore({hasSupabase:()=>true,supaSelectOne:async(_c,_t,f)=>rows.get(f.cache_key.slice(3))||null,supaRpc:async(_c,_n,p)=>{rows.set(p.p_cache_key,{cache_key:p.p_cache_key,payload:p.p_payload,expires_at:p.p_expires_at});return {stored:true,reason:'stored'};}});
 const preferences=createUserPreferencesService({hasSupabase:()=>true,supaSelectOne:async()=>null,supaUpsert:async()=>{await blocked;return true;}});
 const late=preferences.savePreferences(42,{notificationPreferences:{match:true}},{});
 await store.saveWatchSession(42,{fixtureId:420,delaySeconds:0},{});release();await late;
 assert.equal((await store.getWatchSession(42,{})).fixtureId,420);
});
test('watch preferences API binds the signed user and generates its own lifetime',async()=>{
 let savedUser,saved;const store=createWatchSessionStore({hasSupabase:()=>false});
 const api=createUserDataApiRuntime(new Proxy({json:(d,status=200)=>Response.json(d,{status}),getPreferences:async()=>({notificationPreferences:{teams:false}}),saveWatchSession:async(uid,body,cfg)=>{savedUser=uid;saved=await store.saveWatchSession(uid,body,cfg);return saved;},getQuota:async()=>({plan:'FREE'})},{get:(o,k)=>k in o?o[k]:async()=>[]}));
 const req=value=>new Request('https://app.example/api/preferences',{method:'POST',body:JSON.stringify(value)});
 assert.equal((await api.apiPreferences(req({watchSession:{fixtureId:420,delaySeconds:60,expiresAt:'2099-01-01',userId:7}}),{},{id:42})).status,200);
 assert.equal(savedUser,42);assert.equal(Date.parse(saved.expiresAt)-Date.parse(saved.startedAt),WATCH_SESSION_MS);
 assert.equal((await api.apiPreferences(req({watchSession:{fixtureId:420,delaySeconds:100}}),{},{id:42})).status,400);
 assert.equal((await api.apiPreferences(req({watchSession:null}),{},null)).status,401);
});
test('scoreboards defer watched fixtures without dropping their existing message',async()=>{
 let watching=false;
 const getWatchSession=async()=>watching?{fixtureId:7,delaySeconds:60,startedAt:new Date(NOW).toISOString(),expiresAt:new Date(NOW+WATCH_SESSION_MS).toISOString()}:null;
 const h=createScoreboardHarness({favorites:[{telegram_id:11,team_id:596}],getWatchSession});h.setFixtures([fixtureRow()]);await h.run();assert.equal(h.sent.length,1);const boardId=h.board(7,11).m;
 watching=true;h.tick();h.setFixtures([fixtureRow({home:1,elapsed:20})]);const deferred=await h.run();assert.equal(deferred.edited,0);assert.equal(h.board(7,11).m,boardId);
 watching=false;h.tick();h.setFixtures([fixtureRow({home:1,elapsed:25})]);assert.equal((await h.run()).edited,1);
});

test('stale goal writers cannot replace a newer durable pause marker across worker isolates',async()=>{
 const rows=new Map();let clock=now;
 const deps={hasSupabase:()=>true,now:()=>clock,supaSelectOne:async(_c,_t,f)=>rows.get(f.cache_key.slice(3))||null,supaRpc:async(_c,_n,p)=>{const old=rows.get(p.p_cache_key);if(old&&old.updated_at>=p.p_updated_at)return {stored:false,reason:'superseded'};rows.set(p.p_cache_key,{cache_key:p.p_cache_key,payload:p.p_payload,expires_at:p.p_expires_at,updated_at:p.p_updated_at});return {stored:true,reason:'stored'};}};
 const a=createWatchSessionStore(deps),b=createWatchSessionStore(deps),key='watch-goal:42:v1:420:match.goal:55:v1';
 const delayed=await a.saveWatchSession(42,{fixtureId:420,delaySeconds:60},{});clock++;
 const paused=await b.saveWatchSession(42,{fixtureId:420,delaySeconds:0},{});
 assert.equal(await b.setWatchMarker(key,420,{drop:true},paused,{}),true);
 assert.equal(await a.setWatchMarker(key,420,{firstSeenAt:new Date(clock).toISOString()},delayed,{}),false);
 assert.equal((await a.getWatchMarker(key,{})).drop,true);assert.equal((await a.getWatchSession(42,{})).delaySeconds,0);
});

test('people without a watch-state row do not spend a second database read on goal markers',async()=>{
 let reads=0;const store=createWatchSessionStore({hasSupabase:()=>true,supaSelectOne:async()=>{reads++;return null;},supaRpc:async()=>{throw Error('no writes');}});
 assert.equal(await store.getWatchSession(42,{}),null);assert.equal(await store.getWatchMarker('watch-goal:42:v1:420:match.goal:55:v1',{}),null);assert.equal(reads,1);
});
