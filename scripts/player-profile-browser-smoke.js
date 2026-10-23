import {createServer} from 'node:http';
import {createHmac} from 'node:crypto';
import {readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {launchChromeWithRetry,stopChrome,Cdp,browserExecutable} from './bottom-nav-render-smoke.js';
import {createUserAuthRuntime} from '../src/auth-user.js';
import {validateTelegramInitData} from '../src/crypto-utils.js';
import {createUserDataApiRuntime} from '../src/user-data-api-runtime.js';
import {createFavoritePlayersService} from '../src/user-player-favorites.js';

// Actual app + signed Telegram transport + auth + favorite service on loopback.
// All club/player records and credentials are synthetic; no external services.
const secret='player-browser-local-fixture';
const memory={users:new Map(),userSyncAt:new Map(),favoritePlayers:new Map()};
const runtime={maintenanceMode:false,analysisEnabled:true,aiEnabled:true,liveEnabled:true,searchEnabled:true};
const squad={available:true,team:{id:55,name:'Fixture Club'},players:[{id:777,name:'Roster Player',age:26,number:7,position:'Midfielder'}],groups:[{key:'midfielder',label:'Полузащитники',players:[{id:777,name:'Roster Player',age:26,number:7,position:'Midfielder'}]}],summary:{total:1,midfielders:1,averageAge:26}};
const center={mode:'upcoming',match:{fixtureId:999,home:squad.team,away:{id:56,name:'Other Club'},date:new Date(Date.now()+3600000).toISOString(),statusLabel:'Не начался',live:false,finished:false},lineups:{home:{startXI:[{id:777,name:'Roster Player',number:7,pos:'M'}],substitutes:[],quality:{partial:true}},away:{startXI:[{id:888,name:'Other Player',number:9,pos:'F'}],substitutes:[],quality:{partial:true}}},availability:{lineupsTrusted:true},playerLeaders:{home:[],away:[]}};
const auth=createUserAuthRuntime({memory,validateTelegramInitData,developmentTelegramId:0,hasSupabase:()=>false,supaUpsert:async()=>{},supaSelectOne:async()=>null,withSingleFlight:async(_key,fn)=>fn(),pruneMemoryState:()=>{},bumpTelemetry:()=>{},recordOpsEvent:async()=>{}});
const favorites=createFavoritePlayersService({memory,hasSupabase:()=>false});
const api=createUserDataApiRuntime({
 ...favorites,json:(data,status=200)=>Response.json(data,{status}),
 addFavorite:async()=>{},addReminder:async()=>{},analysisFreshness:()=>({}),analysisResponsePayload:x=>x,getBotDigestSubscription:async()=>({}),
 getCache:async key=>key==='team:squad:55:v1'?squad:key==='match-center:999:v17-event-evidence-rc144'?center:null,getStaleCache:async()=>null,
 getFavorites:async()=>[{team_id:55,team_name:'Fixture Club'}],getHistory:async()=>[],getPreferences:async()=>({}),getQuota:async()=>({plan:'FREE',left:5,limit:5,used:0}),getReminders:async()=>[],getUserRecord:async()=>({}),isAdminUser:()=>false,
 publicDataCapabilities:()=>({}),publicDigestSettings:()=>({}),publicPlayerFollowNotificationContract:()=>({}),publicRuntimeControls:()=>runtime,publicSiteUrl:()=> 'https://example.test/',publicSmartNotificationCapabilities:()=>({}),recordOpsEvent:async()=>{},reminderDeliveryStatus:()=>'',removeFavorite:async()=>{},removeReminder:async()=>{},savePreferences:async()=>({}),setBotDigestSubscription:async()=>({}),
});
let successfulWrites=0;
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');const pathname=url.pathname;
  if(pathname.startsWith('/api/')){
   let response;
   if(pathname==='/api/app-manifest')response=Response.json({version:'6.120.0-rc144',apiContract:5,minClientVersion:'6.120.0-rc144',recommendedClientVersion:'6.120.0-rc144',runtime});
   else{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const request=new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
    const user=await auth.getRequestUser(request,{botToken:secret,devMode:false});
    if(!user)response=Response.json({error:'Сессия Telegram не подтверждена.',code:'AUTH_REQUIRED'},{status:401});
    else if(pathname==='/api/me')response=await api.apiMe(request,{},user);
    else if(pathname==='/api/favorite-players'){
     response=await api.apiFavoritePlayers(request,{},user);
     if(response.ok && req.method!=='GET')successfulWrites++;
    }else if(pathname==='/api/favorites')response=await api.apiFavorites(request,{},user);
    else if(pathname==='/api/match-center')response=Response.json(center);
    else if(pathname==='/api/team/squad')response=Response.json(squad);
    else if(pathname==='/api/team')response=Response.json({team:squad.team,recentMatches:[],upcomingMatches:[]});
    else if(pathname==='/api/runtime-status')response=Response.json({runtime});
    else response=Response.json({ok:true,items:[],matches:[],runtime});
   }
   res.writeHead(response.status,{'content-type':'application/json; charset=utf-8'});res.end(await response.text());return;
  }
  const root=path.resolve('public'),file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep))throw Error('path');
  let body=await readFile(file);
  if(pathname==='/')body=Buffer.from(body.toString().replace('<script defer src="https://telegram.org/js/telegram-web-app.js?63"></script>',''));
  res.setHeader('content-type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream');res.end(body);
 }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
function initData(age=0){
 const params=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)-age),user:JSON.stringify({id:42,first_name:'Fixture'})});
 const key=createHmac('sha256','WebAppData').update(secret).digest();const check=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');params.set('hash',createHmac('sha256',key).update(check).digest('hex'));return params.toString();
}
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const launched=await launchChromeWithRetry(browserExecutable());let cdp;
try{
 const tab=await (await fetch(`http://127.0.0.1:${launched.debugPort}/json/new?about:blank`,{method:'PUT'})).json();
 cdp=new Cdp(tab.webSocketDebuggerUrl);await cdp.open();await cdp.call('Page.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 const evaluate=async expression=>(await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result?.value;
 const wait=async(expression,label)=>{
  for(let attempt=0;attempt<120;attempt++){
   if(await evaluate(expression))return;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error(label+'; '+await evaluate("document.querySelector('#playerHub')?.innerText.slice(0,1000)"));
 };
 const navigate=async age=>{
  const hash=new URLSearchParams({tgWebAppData:initData(age)}).toString();
  await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?view=player&teamId=55&playerId=777#${hash}`});
  await wait("document.querySelector('#playerHub')?.textContent.includes('Roster Player') && document.querySelector('#bootGate')?.hidden && document.querySelector('[data-player-follow-toggle]') && !document.querySelector('[data-player-follow-toggle]').disabled",'standalone profile not ready');
 };
 await navigate(0);
 if(await evaluate("Boolean(window.Telegram?.WebApp)"))throw Error('SDK absence fixture not exercised');
 if(await evaluate("Boolean(document.querySelector('#playerHub .player-hub-match') || document.querySelector('#playerHub .player-hub-metrics'))"))throw Error('standalone player shows invented match stats');
 await evaluate("document.querySelector('[data-player-follow-toggle]').click()");
 await wait("document.querySelector('[data-player-follow-toggle]')?.getAttribute('aria-pressed')==='true' && !document.querySelector('[data-player-follow-toggle]').disabled",'follow not persisted');
 await evaluate("document.getElementById('navMyTeams').click()");
 await wait("document.querySelector('[data-saved-player=\"777\"]') && !document.getElementById('myTeamsView').hidden",'saved players list missing');
 await evaluate("document.querySelector('[data-saved-player=\"777\"]').click()");
 await wait("!document.getElementById('playerView').hidden && document.getElementById('playerBackBtn').textContent.includes('Мои команды')",'saved profile navigation missing');
 await evaluate("document.getElementById('playerBackBtn').click();document.querySelector('#myTeamsList [data-open-team=\"55\"]').click()");
 await wait("document.getElementById('teamHero').textContent.includes('Fixture Club')",'team not opened');
 await evaluate("document.querySelector('[data-team-tab=\"squad\"]').click()");
 await wait("Boolean(document.querySelector('[data-squad-player=\"777\"]'))",'team squad missing');
 await evaluate("document.querySelector('[data-squad-player=\"777\"]').click()");
 await wait("!document.getElementById('playerView').hidden && document.getElementById('playerBackBtn').textContent.includes('К команде')",'roster profile not opened');
 await evaluate("document.querySelector('[data-player-follow-toggle]').click()");
 await wait("document.querySelector('[data-player-follow-toggle]')?.getAttribute('aria-pressed')==='false' && !document.querySelector('[data-player-follow-toggle]').disabled",'unfollow not persisted');
 if(successfulWrites!==2 || (await favorites.getFavoritePlayers(42,{})).length!==0)throw Error('favorite persistence diverged');
 await navigate(3*3600);
 await evaluate("document.querySelector('[data-player-follow-toggle]').click()");
 await wait("Boolean(document.querySelector('[data-player-follow-auth]'))",'expired auth lacks recovery');
 if(successfulWrites!==2)throw Error('expired launch mutated favorites');
 await evaluate("window.Telegram={WebApp:{openTelegramLink:url=>{window.playerRecoveryUrl=url;}}};document.querySelector('[data-player-follow-auth]').click()");
 if(await evaluate('window.playerRecoveryUrl')!=='https://t.me/MatchRadarAIBot')throw Error('recovery did not open the bot');
 const returnHash=new URLSearchParams({tgWebAppData:initData()}).toString();
 await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/#${returnHash}`});
 await wait("!document.getElementById('playerView').hidden && document.getElementById('playerHub').textContent.includes('Roster Player') && document.getElementById('bootGate').hidden",'recovery lost player context');
 if(successfulWrites!==2)throw Error('reopening auto-mutated favorites');

 const fixtureHash=new URLSearchParams({tgWebAppData:initData()}).toString();
 await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?fixtureId=999&action=center#${fixtureHash}`});
 await wait("Boolean(document.querySelector('[data-center-tab=\"lineups\"]'))",'pre-match center missing');
 await evaluate("document.querySelector('[data-center-tab=\"lineups\"]').click()");
 await wait("Boolean(document.querySelector('[data-center-player=\"777\"]'))",'pre-match player entry missing');
 await evaluate("document.querySelector('[data-center-player=\"777\"]').click()");
 await wait("!document.getElementById('playerView').hidden && Boolean(document.querySelector('[data-player-follow-toggle]'))",'pre-match player profile missing');
 if(await evaluate("Boolean(document.querySelector('#playerHub .player-hub-metrics'))"))throw Error('lineup-only profile fabricates match stats');
 await evaluate("document.querySelector('[data-player-follow-toggle]').click()");
 await wait("document.querySelector('[data-player-follow-toggle]')?.getAttribute('aria-pressed')==='true' && !document.querySelector('[data-player-follow-toggle]').disabled",'pre-match follow did not use current Match Center cache');
 if(successfulWrites!==3)throw Error('pre-match favorite was not persisted');
 for(const width of [320,390,900]){
  await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<600});
  if(await evaluate('document.documentElement.scrollWidth>window.innerWidth+1'))throw Error('player page overflow at '+width);
 }
 console.log('Player profiles passed: actual app without SDK uses signed launch data; team roster and saved-list navigation; guarded favorite add/remove; expired auth rejected with contextual recovery; 320/390/900px no overflow.');
}finally{cdp?.socket.close();await stopChrome(launched.chrome);await new Promise(resolve=>server.close(resolve));await rm(launched.profileDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
