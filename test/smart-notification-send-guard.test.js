import test from 'node:test';
import assert from 'node:assert/strict';
import {createSmartNotificationAudience} from '../src/smart-notification-audience.js';
import {createSmartNotificationDeliveryService} from '../src/smart-notification-delivery.js';

const claimAt='2026-10-25T11:05:48.123456+00:00';
const event=(row={},extra={})=>({row:{telegram_id:42,fixture_id:420,...row},eventType:'match.goal',category:'match',text:'Synthetic goal',dedupeKey:'v1:420:match.goal:20',...extra});
function runtime({onBegin=()=>{},readOverride,finalizeFails=false,telegramUnknown=false}={}){
 const state={reminder:true,teams:[11],players:[91],prefs:{enabled:true,match:true,teams:true,players:true},plan:'PRO'};
 const trace=[],reads=[],finalizations=[];let ledger='',sends=0;
 const audience=createSmartNotificationAudience({hasSupabase:()=>true,supaSelectMany:async(_cfg,table,filters,options)=>{
  trace.push('read:'+table);reads.push({table,filters,options});
  const overridden=readOverride?.(table,state);if(overridden!==undefined)return overridden;
  if(table==='users')return [{telegram_id:42,plan:state.plan,subscription_until:'2099-01-01T00:00:00Z'}];
  if(table==='user_preferences')return [{telegram_id:42,notification_preferences:state.prefs}];
  if(table==='match_reminders')return state.reminder?[{telegram_id:42,fixture_id:420,enabled:true}]:[];
  if(table==='favorites')return state.teams.map(team_id=>({telegram_id:42,team_id}));
  if(table==='favorite_players')return state.players.map(player_id=>({telegram_id:42,player_id}));
  throw Error('unexpected table');
 }});
 const delivery=createSmartNotificationDeliveryService({hasSupabase:()=>true,recheckDelivery:audience.recheckDelivery,
  supaRpc:async(_cfg,name,args)=>{
   if(name==='claim_smart_notification_delivery'){
    trace.push('claim');if(ledger)return {allowed:false,reason:'duplicate'};
    ledger='claimed';return {allowed:true,reason:'created',claimAt};
   }
   assert.equal(args.p_claimed_at,claimAt);
   if(name==='begin_smart_notification_delivery_send'){trace.push('begin');ledger='sending';onBegin(state);return {started:true,reason:'sending'};}
   if(name==='finalize_smart_notification_delivery'){trace.push('finalize');finalizations.push(args);if(finalizeFails)return {updated:false};ledger=args.p_status;return {updated:true,reason:'finalized'};}
   throw Error('unexpected RPC');
  },sendTelegramMessage:async()=>{trace.push('telegram');sends++;return telegramUnknown?{ok:false,outcome:'unknown'}:{ok:true,status:200,outcome:'sent'};},
 });
 return {state,trace,reads,finalizations,audience,deliver:input=>delivery.deliverSmartNotification(input,{}),get sends(){return sends;},get ledger(){return ledger;}};
}

test('removing a favorite after begin-send cancels the prepared alert and never replays it',async()=>{
 const r=runtime({onBegin:state=>{state.teams=[];}}),input=event({_favoriteOnly:true,_favoriteTeamIds:[11]});r.state.reminder=false;
 assert.equal((await r.deliver(input)).state,'subscription_suppressed');assert.equal(r.sends,0);assert.equal(r.ledger,'terminal_failed');
 assert.equal((await r.deliver(input)).state,'duplicate');assert.equal(r.sends,0);
 assert.deepEqual(r.trace.slice(0,2),['claim','begin']);assert.ok(r.trace.indexOf('read:match_reminders')>1);assert.ok(r.trace.indexOf('read:favorites')>1);
});

test('turning off notifications after discovery and claim is honored at the send boundary',async()=>{
 for(const update of [state=>{state.prefs.enabled=false;},state=>{state.prefs.match=false;},state=>{state.reminder=false;state.teams=[];}]){
  const r=runtime({onBegin:update});assert.equal((await r.deliver(event())).state,'subscription_suppressed');assert.equal(r.sends,0);
 }
});

test('a remaining explicit match subscription survives team opt-out, while favorite-only alerts do not',async()=>{
 const explicit=runtime({onBegin:state=>{state.teams=[];state.prefs.teams=false;}});
 assert.equal((await explicit.deliver(event({_favoriteTeamIds:[11]}))).state,'sent');assert.equal(explicit.sends,1);
 const favorite=runtime({onBegin:state=>{state.reminder=false;state.prefs.teams=false;}});
 assert.equal((await favorite.deliver(event({_favoriteOnly:true,_favoriteTeamIds:[11]}))).state,'subscription_suppressed');assert.equal(favorite.sends,0);
});

test('removing the reminder still permits an active favorite, and current preferences apply',async()=>{
 const r=runtime({onBegin:state=>{state.reminder=false;}});
 assert.equal((await r.deliver(event({_favoriteTeamIds:[11]}))).state,'sent');assert.equal(r.sends,1);
 assert.equal(r.reads.length,4);assert.ok(r.reads.every(read=>read.options.timeoutMs===1500));
 const firstRead=r.trace.findIndex(item=>item.startsWith('read:'));assert.ok(firstRead>r.trace.indexOf('begin'));assert.ok(r.trace.indexOf('telegram')>firstRead);
});

test('team match-day alerts require a current favorite even when the match reminder remains active',async()=>{
 const r=runtime({onBegin:state=>{state.teams=[];}});
 assert.equal((await r.deliver(event({_favoriteTeamIds:[11]},{eventType:'team.match_day',category:'teams',dedupeKey:'v1:420:team.match_day:today'}))).state,'subscription_suppressed');assert.equal(r.sends,0);
});

test('player alerts require the same currently followed player and an active reminder',async()=>{
 const input=event({},{eventType:'player.goal',category:'players',playerId:91,dedupeKey:'v1:420:player.goal:p91:20'});
 for(const update of [()=>{},state=>{state.players=[];},state=>{state.reminder=false;},state=>{state.plan='FREE';}]){
  const r=runtime({onBegin:update}),result=await r.deliver(input);
  assert.equal(result.state,r.state.players.length&&r.state.reminder&&r.state.plan==='PRO'?'sent':'subscription_suppressed');
 }
 const r=runtime();assert.equal((await r.deliver({...input,playerId:92})).state,'subscription_deferred');assert.equal(r.sends,0);
});

test('missing, malformed, ambiguous or failed subscription reads defer without sending',async()=>{
 for(const readOverride of [()=>{throw Error('unavailable');},table=>table==='match_reminders'?{}:undefined,table=>table==='match_reminders'?[{telegram_id:99,fixture_id:420,enabled:true}]:undefined,table=>table==='match_reminders'?[{telegram_id:42,fixture_id:420,enabled:true},{telegram_id:42,fixture_id:420,enabled:true}]:undefined]){
  const r=runtime({readOverride});assert.equal((await r.deliver(event())).state,'subscription_deferred');assert.equal(r.sends,0);assert.equal(r.ledger,'retry_pending');assert.equal(r.finalizations[0].p_retry_after_seconds,60);
 }
 const missing=runtime();missing.state.reminder=false;assert.equal((await missing.deliver(event({_favoriteOnly:true}))).state,'subscription_deferred');assert.equal(missing.sends,0);
});

test('failed cancellation persistence remains ambiguous and never falls through to Telegram',async()=>{
 const r=runtime({onBegin:state=>{state.prefs.enabled=false;},finalizeFails:true});assert.equal((await r.deliver(event())).state,'persistence_ambiguous');assert.equal(r.sends,0);assert.equal(r.ledger,'sending');
});

test('an ambiguous Telegram response remains resend-suppressed after a successful fresh authorization',async()=>{
 const r=runtime({telegramUnknown:true});assert.equal((await r.deliver(event())).state,'unknown');assert.equal(r.ledger,'unknown');assert.equal((await r.deliver(event())).state,'duplicate');assert.equal(r.sends,1);
});


test('malformed final permission decisions never reach Telegram',async()=>{
 for(const decision of [null,{},[],{allowed:'true'},{allowed:true,unavailable:true},{allowed:true,unavailable:'false'},{allowed:false,unavailable:null}]){
  let sends=0;const service=createSmartNotificationDeliveryService({hasSupabase:()=>false,recheckDelivery:async()=>decision,supaRpc:async()=>{throw Error('unexpected');},sendTelegramMessage:async()=>{sends++;return {ok:true};}});
  assert.equal((await service.deliverSmartNotification(event(),{})).state,'subscription_deferred');assert.equal(sends,0);
 }
});

test('missing or ambiguous current user context defers even with an existing match subscription',async()=>{
 for(const users of [[],[{telegram_id:42,plan:'FREE'},{telegram_id:42,plan:'PRO'}]]){
  const r=runtime({readOverride:table=>table==='users'?users:undefined});assert.equal((await r.deliver(event())).state,'subscription_deferred');assert.equal(r.sends,0);
 }
});

test('production wiring forwards the live audience guard to the actual delivery boundary',async()=>{
 const {createServiceWiringRuntime}=await import('../src/service-wiring-runtime.js');
 const guard=async()=>({allowed:true});let captured;
 const fake=new Proxy({SMART_NOTIFICATION_POLICY:{}},{get:(object,key)=>key in object?object[key]:String(key).startsWith('create')?deps=>{if(key==='createSmartNotificationAudience')return {recheckDelivery:guard};if(key==='createSmartNotificationDeliveryService')captured=deps;return {};}:()=>{}});
 createServiceWiringRuntime(fake);assert.equal(captured.recheckDelivery,guard);
});


test('a newly added explicit reminder remains valid after a favorite-only discovery is withdrawn',async()=>{
 const r=runtime({onBegin:state=>{state.teams=[];state.reminder=true;state.prefs.teams=false;}});r.state.reminder=false;
 assert.equal((await r.deliver(event({_favoriteOnly:true,_favoriteTeamIds:[11]}))).state,'sent');assert.equal(r.sends,1);
 assert.ok(r.reads.some(read=>read.table==='match_reminders'));
});
