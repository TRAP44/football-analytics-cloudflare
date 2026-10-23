import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {telegramInitData,createApiClient} from '../public/modules/client-core.js';
import {favoritePlayersHtml,playerLaunchIntent,playerTelegramUrl,squadPlayer,rememberPlayerReturn,takePlayerReturn} from '../public/modules/player-navigation.js';
import {createPlayerFollowModule} from '../public/modules/player-follow.js';
import {createUserAuthRuntime} from '../src/auth-user.js';
import {validateTelegramInitData} from '../src/crypto-utils.js';

const player={data:{id:777,name:'Roster Player'},team:{id:55},squadProfile:{found:true}};
function signedData(age=0){
 const data=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)-age),user:JSON.stringify({id:42,first_name:'Test'})});
 const key=createHmac('sha256','WebAppData').update('local-test-secret').digest();
 const check=[...data].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 data.set('hash',createHmac('sha256',key).update(check).digest('hex'));return data.toString();
}

test('signed Telegram launch data works before SDK readiness and retains actual HMAC/freshness validation',async()=>{
 const data=signedData();const scope={location:{hash:'#'+new URLSearchParams({tgWebAppData:data})}};
 assert.equal(telegramInitData(null,scope),data);
 const deps={memory:{users:new Map(),userSyncAt:new Map()},validateTelegramInitData,developmentTelegramId:0,hasSupabase:()=>false,supaUpsert:async()=>{},supaSelectOne:async()=>null,withSingleFlight:async(_key,fn)=>fn(),pruneMemoryState:()=>{},bumpTelemetry:()=>{},recordOpsEvent:async()=>{}};
 const auth=createUserAuthRuntime(deps);
 const request=(value,method='POST')=>new Request('https://example.test/api/favorite-players',{method,headers:{'x-telegram-init-data':value}});
 assert.equal((await auth.getRequestUser(request(data),{botToken:'local-test-secret'})).id,42);
 assert.equal(await auth.getRequestUser(request(data.replace('42','43')),{botToken:'local-test-secret'}),null);
 const expired=signedData(3*3600);
 assert.equal((await auth.getRequestUser(request(expired,'GET'),{botToken:'local-test-secret'})).id,42);
 assert.equal(await auth.getRequestUser(request(expired),{botToken:'local-test-secret'}),null);
 const late={location:{hash:''},Telegram:{WebApp:{initData:data}}};assert.equal(telegramInitData(null,late),data);
 assert.equal(telegramInitData(null,{Telegram:{WebApp:{initDataUnsafe:{user:{id:42}}}}}), '');
 assert.equal(telegramInitData({initData:'bad\r\nvalue'},{location:{hash:''}}),'');
});

test('player launch restores a read-only profile and rejects injected identifiers',()=>{
 assert.deepEqual(playerLaunchIntent({Telegram:{WebApp:{initDataUnsafe:{start_param:'player_55_777'}}}}),{teamId:55,playerId:777});
 assert.deepEqual(playerLaunchIntent({location:{search:'?view=player&teamId=55&playerId=777'}}),{teamId:55,playerId:777});
 assert.equal(playerLaunchIntent({location:{hash:'#tgWebAppStartParam=player_55_0'}}),null);
 assert.equal(playerLaunchIntent({location:{hash:'#tgWebAppStartParam=player_55_9007199254740992'}}),null);
 assert.equal(playerTelegramUrl(player),'https://t.me/MatchRadarAIBot');
 assert.equal(squadPlayer({team:{id:56},players:[{id:777}]},777,55),null);
});

test('following a roster player persists canonical response without fixture and never reports a failed write as saved',async()=>{
 const state={favoritePlayersLoaded:true,favoritePlayers:[]};const bodies=[];
 const follow=createPlayerFollowModule({state,api:async(_url,init)=>{bodies.push(JSON.parse(init.body));return {item:{playerId:777,teamId:55,playerName:'Server Name'}};}});
 assert.match(follow.controlHtml(player),/data-player-follow-toggle/);
 assert.equal(await follow.togglePlayerFollow(player),true);assert.deepEqual(bodies,[{playerId:777,teamId:55}]);assert.equal(state.favoritePlayers[0].playerName,'Server Name');
 const invalid={favoritePlayersLoaded:true,favoritePlayers:[]};
 assert.equal(await createPlayerFollowModule({state:invalid,api:async()=>({ok:false})}).togglePlayerFollow(player),false);assert.deepEqual(invalid.favoritePlayers,[]);
});

test('expired-session write rolls back and offers explicit Telegram recovery without repetitive writes or a huge toast',async()=>{
 const state={favoritePlayersLoaded:true,favoritePlayers:[],profile:{stats:{favoritePlayers:0}}};let calls=0;const toasts=[];let recovered=null;
 const follow=createPlayerFollowModule({state,onAuthRequired:p=>{recovered=p;},toast:text=>toasts.push(text),api:async()=>{calls++;throw Object.assign(Error('private auth message'),{status:401});}});
 assert.equal(await follow.togglePlayerFollow(player),false);assert.equal(state.profile.stats.favoritePlayers,0);assert.deepEqual(state.favoritePlayers,[]);assert.equal(toasts.length,0);
 assert.match(follow.controlHtml(player),/data-player-follow-auth/);assert.doesNotMatch(follow.controlHtml(player),/private auth message/);
 let click;follow.bind({querySelector:selector=>selector==='[data-player-follow-auth]'?{addEventListener:(_type,fn)=>{click=fn;}}:null},player);click();assert.equal(recovered,player);
 assert.equal(await follow.togglePlayerFollow(player),false);assert.equal(calls,1);
});

test('a failed follow does not erase a different concurrently confirmed player',async()=>{
 const state={favoritePlayersLoaded:true,favoritePlayers:[],profile:{stats:{favoritePlayers:0}}};let rejectFirst;
 const follow=createPlayerFollowModule({state,api:async(_url,init)=>{const body=JSON.parse(init.body);if(body.playerId===777)return new Promise((_,reject)=>{rejectFirst=reject;});return {item:{playerId:778,teamId:55,playerName:'Second'}};}});
 const first=follow.togglePlayerFollow(player);await follow.togglePlayerFollow({...player,data:{id:778,name:'Second'}});rejectFirst(Error('failed'));await first;
 assert.deepEqual(state.favoritePlayers.map(item=>item.playerId),[778]);assert.equal(state.profile.stats.favoritePlayers,1);
});

test('favorite player list exposes stable profiles and escapes names',()=>{
 const esc=text=>String(text).replaceAll('<','&lt;').replaceAll('>','&gt;');
 const html=favoritePlayersHtml({favoritePlayersLoaded:true,favoritePlayers:[{playerId:777,teamId:55,playerName:'<script>x</script>'}]},esc);
 assert.match(html,/data-saved-player="777"/);assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>'));
});

test('actual API client sends original launch signature when Telegram SDK is initially unavailable',async t=>{
 const data=signedData();const savedLocation=Object.getOwnPropertyDescriptor(globalThis,'location');const savedTelegram=Object.getOwnPropertyDescriptor(globalThis,'Telegram');
 t.after(()=>{for(const [key,descriptor] of [['location',savedLocation],['Telegram',savedTelegram]]){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://example.test',hash:'#'+new URLSearchParams({tgWebAppData:data})}});
 Object.defineProperty(globalThis,'Telegram',{configurable:true,writable:true,value:undefined});
 const state={clientPerf:{requests:0,completed:0,totalMs:0,deduped:0,failed:0,retries:0,timeouts:0}};
 let received;
 t.mock.method(globalThis,'fetch',async(_url,options)=>{received=options.headers.get('x-telegram-init-data');assert.equal((await validateTelegramInitData(received,'local-test-secret',7200)).id,42);return Response.json({ok:true});});
 const api=createApiClient({state,tg:null,inflightGetRequests:new Map(),observeServerVersion:()=>{},showBootRecovery:()=>{},applyRuntimeUi:()=>{},normalizeApiError:e=>e,noteRequestSuccess:()=>{},noteRequestFailure:()=>{}});
 assert.deepEqual(await api('/api/favorite-players',{method:'POST',body:'{}'}),{ok:true});assert.equal(received,data);
 globalThis.Telegram={WebApp:{initData:data}};
 await api('/api/favorite-players',{method:'DELETE'});assert.equal(received,data);
});

test('Telegram recovery restores only this authenticated user and expires without automatic mutations',()=>{
 const items=new Map();const scope={localStorage:{getItem:key=>items.get(key),setItem:(key,value)=>items.set(key,value),removeItem:key=>items.delete(key)}};
 assert.equal(rememberPlayerReturn(player,42,scope),true);assert.equal(takePlayerReturn(43,scope),null);
 assert.deepEqual(takePlayerReturn(42,scope),{playerId:777,teamId:55});assert.equal(takePlayerReturn(42,scope),null);
 items.set('matchradar:player-return:v1:42',JSON.stringify({owner:42,playerId:777,teamId:55,expiresAt:Date.now()-1}));assert.equal(takePlayerReturn(42,scope),null);
 assert.equal(rememberPlayerReturn(player,0,scope),false);
});
