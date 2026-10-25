import test from 'node:test';
import assert from 'node:assert/strict';
import {createWatchSessionStore,WATCH_SESSION_MS} from '../src/watch-session.js';
import {createSmartNotificationDeliveryService} from '../src/smart-notification-delivery.js';
import {createSmartNotificationService} from '../src/smart-notification-service.js';
import {createPostMatchReturnRuntime} from '../src/post-match-return-runtime.js';
import {createScoreboardHarness,fixtureRow,NOW as BOARD_NOW} from '../scripts/scoreboard-harness.js';
const NOW=Date.parse('2026-10-25T12:00:00Z');
const goal=(type='match.goal')=>({row:{telegram_id:42,fixture_id:420},eventType:type,category:type.startsWith('player.')?'players':'match',text:'Synthetic event',dedupeKey:`v1:420:${type}:${type.startsWith('player.')?'p91:':''}20`});
function harness({onAuthorize=async()=>({allowed:true}),unknownSend=false}={}){
 let clock=NOW,ledger='',retryAt=0,claimAt='',sends=0,atomic=0,failAtomic=false,readTransform=value=>value,authorization=onAuthorize;
 const rows=new Map(),trace=[],finalizations=[];
 const rpc=async(_cfg,name,args)=>{
  if(name==='write_analysis_cache_versioned'){
   const old=rows.get(args.p_cache_key),stamp=Date.parse(args.p_updated_at);
   if(old&&Date.parse(old.updated_at)>=stamp)return {stored:old.updated_at===args.p_updated_at&&JSON.stringify(old.payload)===JSON.stringify(args.p_payload),reason:JSON.stringify(old.payload)===JSON.stringify(args.p_payload)?'same':'superseded'};
   rows.set(args.p_cache_key,{cache_key:args.p_cache_key,payload:structuredClone(args.p_payload),expires_at:args.p_expires_at,updated_at:args.p_updated_at});return {stored:true,reason:'stored'};
  }
  if(name==='claim_smart_notification_delivery'){
   trace.push('claim');if(ledger&&ledger!=='retry_pending')return {allowed:false,reason:'duplicate'};
   if(ledger==='retry_pending'&&clock<retryAt)return {allowed:false,reason:'retry_wait'};
   const reason=ledger?'retry':'created';ledger='claimed';claimAt=new Date(clock).toISOString();return {allowed:true,reason,claimAt};
  }
  assert.equal(args.p_claimed_at,claimAt);
  if(name==='begin_smart_notification_delivery_send'){trace.push('begin');ledger='sending';return {started:true,reason:'sending'};}
  if(name==='finalize_smart_notification_delivery'){trace.push('finalize');ledger=args.p_status;retryAt=clock+(args.p_retry_after_seconds||0)*1000;finalizations.push(args);return {updated:true,reason:'finalized'};}
  throw Error('unexpected RPC');
 };
 const store=createWatchSessionStore({hasSupabase:()=>true,now:()=>clock,supaRpc:rpc,
  supaSelectOne:async(_cfg,_table,params)=>structuredClone(rows.get(params.cache_key.slice(3))??null),
  supaSelectMany:async(_cfg,table,params,options)=>{
   atomic++;trace.push('watch-snapshot');assert.equal(table,'analysis_cache');assert.equal(options.timeoutMs,1500);assert.equal(options.select,'cache_key,payload,expires_at');
   if(failAtomic)throw Error('synthetic state outage');
   const keys=JSON.parse('['+params.cache_key.slice(4,-1)+']');assert.equal(options.limit,keys.length);assert.ok(keys.length<=2);
   return readTransform(keys.flatMap(key=>rows.has(key)?[structuredClone(rows.get(key))]:[]));
  },
 });
 const delivery=createSmartNotificationDeliveryService({hasSupabase:()=>true,now:()=>clock,supaRpc:rpc,...store,
  recheckDelivery:async(input,cfg)=>{trace.push('authorization');return authorization(input,cfg);},
  sendTelegramMessage:async()=>{trace.push('telegram');sends++;return unknownSend?{ok:false,outcome:'unknown'}:{ok:true,status:200,outcome:'sent'};},
 });
 return {store,rows,trace,finalizations,run:(input=goal())=>delivery.deliverSmartNotification(input,{}),tick:ms=>{clock+=ms;},setAuthorize:fn=>{authorization=fn;},setFailAtomic:value=>{failAtomic=value;},setReadTransform:fn=>{readTransform=fn;},
  setMode:async(delaySeconds=0,fixtureId=420)=>{clock++;return store.saveWatchSession(42,delaySeconds===null?null:{fixtureId,delaySeconds},{});},
  get sends(){return sends;},get atomic(){return atomic;},get ledger(){return ledger;},get clock(){return clock;}};
}

test('a pause acknowledged during authorization stops the pending goal and leaves no backlog after watching ends',async()=>{
 const h=harness();h.setAuthorize(async()=>{await h.setMode(0);return {allowed:true};});
 assert.equal((await h.run()).state,'watch_suppressed');assert.equal(h.sends,0);assert.equal(h.ledger,'terminal_failed');assert.equal(h.atomic,1);
 assert.ok(h.trace.indexOf('watch-snapshot')>h.trace.indexOf('authorization'));
 await h.setMode(null);assert.equal((await h.run()).state,'watch_suppressed');assert.equal(h.sends,0);
});

test('both card colors and a followed-player goal honor a newly acknowledged pause',async()=>{
 for(const type of ['match.yellow_card','match.red_card','player.goal']){
  const h=harness();h.setAuthorize(async()=>{await h.setMode(0);return {allowed:true};});
  assert.equal((await h.run(goal(type))).state,'watch_suppressed');assert.equal(h.sends,0);assert.equal(h.ledger,'terminal_failed');
 }
});

test('a longer newly selected delay cannot reuse an older mature goal marker',async()=>{
 const h=harness();await h.setMode(30);assert.equal((await h.run()).state,'watch_deferred');h.tick(30000);
 h.setAuthorize(async()=>{await h.setMode(90);h.setAuthorize(async()=>({allowed:true}));return {allowed:true};});
 assert.equal((await h.run()).state,'watch_deferred');assert.equal(h.sends,0);assert.equal(h.ledger,'retry_pending');
 const state=await h.store.getWatchDeliveryState(42,`watch-goal:42:${goal().dedupeKey}:v1`,{});
 assert.ok(Date.parse(state.marker.firstSeenAt)>=Date.parse(state.session.startedAt));
 h.tick(89000);assert.equal((await h.run()).state,'watch_deferred');assert.equal(h.sends,0);
 h.tick(1000);assert.equal((await h.run()).state,'sent');assert.equal(h.sends,1);
 const reads=h.atomic;assert.equal((await h.run()).state,'duplicate');assert.equal(h.atomic,reads);assert.equal(h.sends,1);
});

test('a final watch read outage defers safely and preserves ordinary retry/dedupe',async()=>{
 const h=harness();h.setFailAtomic(true);
 const blocked=await h.run();assert.equal(blocked.state,'watch_deferred');assert.equal(blocked.unavailable,true);assert.equal(h.sends,0);assert.equal(h.ledger,'retry_pending');assert.equal(h.finalizations[0].p_retry_after_seconds,60);
 h.setFailAtomic(false);h.tick(60000);assert.equal((await h.run()).state,'sent');assert.equal((await h.run()).state,'duplicate');assert.equal(h.sends,1);
});

test('an authorization outage cannot leave a queued goal to leak after a pause',async()=>{
 const h=harness();h.setAuthorize(async()=>{await h.setMode(0);return {allowed:false,unavailable:true};});
 assert.equal((await h.run()).state,'watch_suppressed');assert.equal(h.ledger,'terminal_failed');assert.equal(h.sends,0);
 await h.setMode(null);assert.equal((await h.run()).state,'watch_suppressed');assert.equal(h.sends,0);
});

test('normal and other-fixture viewing keep sending; ambiguous delivery still never resends',async()=>{
 for(const other of [false,true]){
  const h=harness();if(other)await h.setMode(0,421);
  assert.equal((await h.run()).state,'sent');assert.equal(h.sends,1);assert.equal(h.atomic,1);assert.equal((await h.run()).state,'duplicate');assert.equal(h.atomic,1);
 }
 const unknown=harness({unknownSend:true});assert.equal((await unknown.run()).state,'unknown');assert.equal((await unknown.run()).state,'duplicate');assert.equal(unknown.sends,1);
});

test('the final combined snapshot bypasses prior no-session knowledge and rejects cross-user keys before IO',async()=>{
 const h=harness();assert.equal(await h.store.getWatchSession(42,{}),null);await h.setMode(0);
 const snapshot=await h.store.getWatchDeliveryState(42,`watch-goal:42:${goal().dedupeKey}:v1`,{});assert.equal(snapshot.session.delaySeconds,0);assert.equal(snapshot.marker,null);assert.equal(h.atomic,1);
 await assert.rejects(h.store.getWatchDeliveryState(42,'watch-goal:99:v1:420:match.goal:20:v1',{}),/WATCH_MARKER_INVALID/);assert.equal(h.atomic,1);
});

test('foreign, duplicate, malformed and unavailable final snapshots never authorize a send',async()=>{
 const future=new Date(NOW+3600000).toISOString();
 for(const change of [()=>({}),()=>[{cache_key:'watch-session:99:v1',payload:{session:null},expires_at:future}],()=>[{cache_key:'watch-session:42:v1',payload:{session:null},expires_at:future},{cache_key:'watch-session:42:v1',payload:{session:null},expires_at:future}],()=>[{cache_key:'watch-session:42:v1',payload:[],expires_at:future}],()=>[{cache_key:'watch-session:42:v1',payload:{session:null},expires_at:'invalid'}],()=>[{cache_key:`watch-goal:42:${goal().dedupeKey}:v1`,payload:{firstSeenAt:'invalid'},expires_at:future}]]){
  const h=harness();h.setReadTransform(change);const result=await h.run();assert.equal(result.state,'watch_deferred');assert.equal(result.unavailable,true);assert.equal(h.sends,0);assert.equal(h.ledger,'retry_pending');
 }
});

test('expired watch control is ignored by the final snapshot rather than extending a pause',async()=>{
 const h=harness();await h.setMode(0);h.tick(WATCH_SESSION_MS+1);
 assert.deepEqual(await h.store.getWatchDeliveryState(42,null,{}),{session:null,marker:null});assert.equal((await h.run()).state,'sent');assert.equal(h.sends,1);
});

test('privacy read failures remain visible in the smart scheduler while a normal viewing delay is deliberate',async t=>{
 t.mock.method(Date,'now',()=>NOW);
 for(const unavailable of [false,true]){
  const service=createSmartNotificationService({hasSupabase:()=>true,loadRuntimeControls:async()=>({value:{remindersEnabled:true}}),
   supaSelectPaged:async()=>({rows:[{telegram_id:42,fixture_id:420,fixture_date:new Date(NOW-20*60000).toISOString(),enabled:true}],truncated:false}),
   filterRecipients:async rows=>({rows}),loadLiveNotificationSnapshot:async()=>({trusted:true,stale:false,events:[{minute:20,type:'Goal',detail:'Normal Goal',teamId:11,playerId:91,eventKey:'20:goal:91'}]}),
   deliverSmartNotification:async()=>({state:'watch_deferred',unavailable}),recordOpsEvent:async()=>{},
  });
  const result=await service.processSmartNotifications({botToken:'synthetic'});assert.equal(result.watchProtected,1);assert.equal(result.failed,unavailable?1:0);
 }
});

test('production wiring supplies the combined strong watch reader to delivery',async()=>{
 const {createServiceWiringRuntime}=await import('../src/service-wiring-runtime.js');let captured,reads=0;
 const base={memory:{},SMART_NOTIFICATION_POLICY:{},hasSupabase:()=>true,supaSelectMany:async()=>{reads++;return [];}};
 const fake=new Proxy(base,{get:(object,key)=>key in object?object[key]:String(key).startsWith('create')?deps=>{if(key==='createSmartNotificationDeliveryService')captured=deps;return {};}:()=>{}});
 createServiceWiringRuntime(fake);assert.equal(typeof captured.getWatchDeliveryState,'function');assert.deepEqual(await captured.getWatchDeliveryState(42,null,{}),{session:null,marker:null});assert.equal(reads,1);
});

function returnHarness({paused=false,failRead=false,getTime=()=>NOW,onClaim=()=>{}}={}){
 const rows=new Map(),key='postmatch:return:delivery:42:420:v1';let watching=false,sends=0,reads=0;
 const history={telegram_id:42,fixture_id:420,fixture_date:new Date(NOW-2*3600000).toISOString(),home_name:'Home',away_name:'Away'};
 const session=()=>({fixtureId:420,delaySeconds:0,startedAt:new Date(getTime()).toISOString(),expiresAt:new Date(getTime()+WATCH_SESSION_MS).toISOString()});
 const runtime=createPostMatchReturnRuntime({APP_VERSION:'test',memory:{cache:new Map()},hasSupabase:()=>true,withSingleFlight:async(_key,fn)=>fn(),loadRuntimeControls:async()=>({value:{remindersEnabled:true}}),
  supaSelectPaged:async()=>({rows:[history],truncated:false}),supaSelectMany:async()=>[{fixture_id:420,status:'settled',actual_home_goals:1,actual_away_goals:0}],getCache:async()=>null,getCacheEntry:async()=>null,
  getWatchSession:async()=>{reads++;if(reads>1&&failRead)throw Error('synthetic state read failed');return watching?session():null;},
  fetchWithTimeout:async(_url,options)=>{onClaim();watching=paused;rows.set(key,JSON.parse(options.body)[0]);return {ok:true,json:async()=>[{}]};},supaHeaders:()=>({}),supaDelete:async()=>{rows.delete(key);},supaPatch:async()=>{},
  sendTelegramMessage:async()=>{sends++;return {ok:true};},setCache:async()=>true,recordOpsEvent:async()=>{},recordGrowthEvent:async()=>{},telegramHtmlEscape:value=>String(value),actualOutcomeFromGoals:()=> 'home',
 });
 return {runtime,rows,key,get sends(){return sends;},get reads(){return reads;}};
}

test('post-match result rechecks privacy after its claim and releases an unsent marker',async t=>{
 t.mock.method(Date,'now',()=>NOW);
 for(const [paused,failRead] of [[true,false],[false,true],[false,false]]){
  const h=returnHarness({paused,failRead});const result=await h.runtime.processPostMatchReturns({botToken:'synthetic',supabaseUrl:'https://local.example'});
  assert.equal(h.sends,paused||failRead?0:1);assert.equal(h.reads,2);
  if(paused||failRead)assert.equal(h.rows.has(h.key),false);
  if(paused)assert.equal(result.disabled,1);if(failRead)assert.equal(result.failed,1);
 }
});

test('scoreboard already rechecks privacy after persisting its pending message claim',async()=>{
 let watching=false;
 const h=createScoreboardHarness({favorites:[{telegram_id:11,team_id:596}],failSaveAt:(_count,key,payload)=>{if(key==='scoreboard:7:v1'&&payload.users?.[11]?.s==='p')watching=true;return false;},getWatchSession:async()=>watching?{fixtureId:7,delaySeconds:0,startedAt:new Date(BOARD_NOW).toISOString(),expiresAt:new Date(BOARD_NOW+WATCH_SESSION_MS).toISOString()}:null});
 h.setFixtures([fixtureRow()]);await h.run();assert.equal(watching,true);assert.equal(h.sent.length,0);
});


test('a slow result claim uses the current clock for a watch session acknowledged later than run start',async t=>{
 let clock=NOW;t.mock.method(Date,'now',()=>clock);
 const h=returnHarness({paused:true,getTime:()=>clock,onClaim:()=>{clock+=10000;}});
 const result=await h.runtime.processPostMatchReturns({botToken:'synthetic',supabaseUrl:'https://local.example'});
 assert.equal(h.sends,0);assert.equal(result.disabled,1);assert.equal(h.rows.has(h.key),false);
});


test('the supported watch clock skew cannot create a first-seen marker older than its revision',async()=>{
 const h=harness();await h.setMode(30);h.tick(-3000);
 assert.equal((await h.run()).state,'watch_deferred');
 const state=await h.store.getWatchDeliveryState(42,`watch-goal:42:${goal().dedupeKey}:v1`,{});
 assert.ok(Date.parse(state.marker.firstSeenAt)>=Date.parse(state.session.startedAt));
 h.tick(31000);assert.equal((await h.run()).state,'watch_deferred');assert.equal(h.sends,0);
 h.tick(2000);assert.equal((await h.run()).state,'sent');assert.equal(h.sends,1);
});
