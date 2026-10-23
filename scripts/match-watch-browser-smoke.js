import {createServer} from 'node:http';
import {readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {launchChromeWithRetry,stopChrome,Cdp,browserExecutable} from './bottom-nav-render-smoke.js';
import {createUserDataApiRuntime} from '../src/user-data-api-runtime.js';
import {watchFixtureIdentity,WATCH_PUBLISHERS,WATCH_TTL_MS,watchCacheKey} from '../src/match-watch.js';
import {matchCenterCacheKey} from '../src/match-center-cache-key.js';

// Real browser DOM + HTTP + actual cache-only API. Synthetic approved source and
// fake YouTube SDK: verifies our UI, not third-party or Telegram playback/rights.
const now=Date.now(),iso=ms=>new Date(now+ms).toISOString();
const match={fixtureId:999,home:{id:55,name:'Fixture Home'},away:{id:56,name:'Fixture Away'},league:'Fixture League',score:{home:0,away:0},elapsed:6,statusLabel:'Первый тайм',leagueId:39,season:2026,date:iso(-60000),live:true,finished:false,status:'1H'};
const approval={match,provider:'youtube',publisher:'fifa',videoId:'abcdefghijk',eventUrl:'https://www.youtube.com/watch?v=abcdefghijk',kind:'live',access:'free',countries:['RU','KZ'],confirmed:true,confirmedAt:iso(-10000),validUntil:iso(3600000)};
const catalogue={version:1,fixtureIdentity:watchFixtureIdentity(match),items:[{...approval,channelId:WATCH_PUBLISHERS.fifa,publicVideo:true,embeddable:true,ageRestricted:false,regionVerified:true,checkedAt:iso(0),expiresAt:iso(WATCH_TTL_MS),approval:{version:1,confirmed:true,confirmedAt:approval.confirmedAt,fixtureIdentity:watchFixtureIdentity(match)}}]};
const functions='addFavorite addFavoritePlayer addReminder analysisFreshness analysisResponsePayload getBotDigestSubscription getCache getFavoritePlayers getFavorites getHistory getPreferences getQuota getReminders getStaleCache getUserRecord isAdminUser publicDataCapabilities publicDigestSettings publicPlayerFollowNotificationContract publicRuntimeControls publicSiteUrl publicSmartNotificationCapabilities recordOpsEvent reminderDeliveryStatus removeFavorite removeFavoritePlayer removeReminder savePreferences setBotDigestSubscription'.split(' ');
const runtime={maintenanceMode:false,analysisEnabled:true,aiEnabled:true,liveEnabled:true,searchEnabled:true};
const center=()=>({mode:'live',generatedAt:new Date().toISOString(),match,lineups:{},availability:{},playerLeaders:{home:[],away:[]}});
const api=createUserDataApiRuntime({...Object.fromEntries(functions.map(key=>[key,async()=>[]])),json:(data,status=200)=>Response.json(data,{status}),getQuota:async()=>({plan:'FREE',left:5,limit:5,used:0}),getPreferences:async()=>({}),getUserRecord:async()=>({}),publicRuntimeControls:()=>runtime,publicDataCapabilities:()=>({}),publicSmartNotificationCapabilities:()=>({}),isAdminUser:()=>false,watchApprovals:[approval],getCache:async key=>key===matchCenterCacheKey(999)?{match}:key===watchCacheKey(999)?catalogue:null});
let delay=false,requests=0,centerRequests=0;
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/api/match-watch'){
   requests++;if(delay)await new Promise(resolve=>setTimeout(resolve,300));
   const response=await api.apiMatchWatch(new Request(url),{},{id:42});res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());return;
  }
  if(url.pathname==='/api/match-center'){centerRequests++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(center()));return;}
  if(url.pathname==='/api/me'){const response=await api.apiMe(new Request(url),{},{id:42,first_name:'Fixture'});res.setHeader('Content-Type','application/json');res.end(await response.text());return;}
  if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname==='/api/app-manifest'?{version:'6.120.0-rc144',apiContract:5,minClientVersion:'6.120.0-rc144',recommendedClientVersion:'6.120.0-rc144',runtime}:{ok:true,items:[],matches:[],runtime}));return;}
  if(url.pathname==='/full-app'){
   const body=(await readFile('public/index.html','utf8')).replace('<script defer src="https://telegram.org/js/telegram-web-app.js?63"></script>','');res.setHeader('Content-Type','text/html; charset=utf-8');res.end(body);return;
  }
  if(url.pathname==='/'){
   res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/premium-ui.css"><body style="margin:0;background:#090e14;color:white"><section id="watch" class="panel match-watch-panel" hidden></section><script type="module" src="/fixture.js"></script></body></html>`);return;
  }
  if(url.pathname==='/fixture.js'){
   res.setHeader('Content-Type','text/javascript');res.end(`import {createMatchWatch} from '/modules/match-watch.js';
    const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    window.errors=[];window.destroyed=0;window.active=true;
    window.YT={Player:class {constructor(iframe,options){this.iframe=iframe;window.failPlayer=options.events.onError;}destroy(){window.destroyed++;this.iframe.remove();}}};
    window.panel=createMatchWatch({api:async(url,options)=>{const response=await fetch(url,options);return response.json();},escapeHtml});
    window.mount=()=>window.panel.mount({root:document.getElementById('watch'),fixtureId:999,isCurrent:()=>window.active});window.mount();`);return;
  }
  const root=path.resolve('public'),file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep))throw Error('path');
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(file));
 }catch{res.writeHead(500);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const launched=await launchChromeWithRetry(browserExecutable());let cdp;
try{
 const tab=await(await fetch(`http://127.0.0.1:${launched.debugPort}/json/new?about:blank`,{method:'PUT'})).json();cdp=new Cdp(tab.webSocketDebuggerUrl);await cdp.open();await cdp.call('Page.enable');await cdp.call('Network.enable');await cdp.call('Network.setBlockedURLs',{urls:['*youtube.com*','*ytimg.com*']});await cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 const evaluate=async expression=>{const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result?.value;};
 const wait=async(expression,label)=>{for(let n=0;n<80;n++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error(label);};
 await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?watch=1`});await wait("Boolean(document.querySelector('[data-watch-country]'))",'country prompt not mounted');
 if(await evaluate("Boolean(document.querySelector('iframe, [data-watch-play]'))"))throw Error('media or watch action before explicit country');
 await evaluate("document.querySelector('[data-watch-country]').value='RU';document.querySelector('[data-watch-country]').dispatchEvent(new Event('change'))");await wait("Boolean(document.querySelector('[data-watch-play]'))",'country source missing');
 if(await evaluate("Boolean(document.querySelector('iframe,script[src*=youtube]'))"))throw Error('third-party player loaded before click');
 await evaluate("document.querySelector('[data-watch-play]').click()");await wait("Boolean(document.querySelector('iframe'))",'on-click player missing');
 const frame=await evaluate("({src:document.querySelector('iframe').src,referrer:document.querySelector('iframe').referrerPolicy})");if(!frame.src.includes('autoplay=0')||frame.referrer!=='strict-origin-when-cross-origin')throw Error('embed contract');
 await evaluate('window.mount()');if(await evaluate('window.destroyed'))throw Error('same fixture reset player');
 await evaluate('window.failPlayer({data:150})');await wait("!document.querySelector('iframe') && document.querySelector('[data-watch-status]').textContent.includes('не разрешил')",'player denial fallback absent');
 if(!await evaluate("document.querySelector('.match-watch-source a').href==='https://www.youtube.com/watch?v=abcdefghijk'"))throw Error('official fallback absent');
 await evaluate("document.querySelector('[data-watch-play]').click()");await wait('Boolean(window.failPlayer&&document.querySelector("iframe"))','second play missing');delay=true;
 await evaluate("document.querySelector('[data-watch-country]').value='KZ';document.querySelector('[data-watch-country]').dispatchEvent(new Event('change'))");
 if(await evaluate("Boolean(document.querySelector('iframe,.match-watch-source a'))"))throw Error('old country media/links remain while request pending');
 await wait("Boolean(document.querySelector('[data-watch-play]'))",'second country missing');
 for(const width of [320,390,900]){await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});if(await evaluate('document.documentElement.scrollWidth>innerWidth+1'))throw Error('overflow '+width);}
 await evaluate("document.querySelector('[data-watch-play]').click()");await wait("Boolean(document.querySelector('iframe'))",'third play missing');await evaluate('window.panel.dispose()');if(await evaluate("Boolean(document.querySelector('iframe')) || !document.getElementById('watch').hidden"))throw Error('dispose left media');
 // Exercise the actual app composition as well as the isolated widget.
 delay=false;
 const launch=new URLSearchParams({auth_date:String(Math.floor(now/1000)),user:JSON.stringify({id:42,first_name:'Fixture'}),hash:'0'.repeat(64)}).toString();
 await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/full-app?fixtureId=999&action=center&watch=1#${new URLSearchParams({tgWebAppData:launch})}`});
 await wait("Boolean(document.querySelector('#matchWatchPanel [data-watch-play]')) && document.querySelector('#bootGate')?.hidden",'actual app watch wiring missing');
 await evaluate("window.YT={Player:class {constructor(iframe){this.iframe=iframe;}destroy(){this.iframe.remove();}}};document.querySelector('#matchWatchPanel [data-watch-play]').click()");
 await wait("Boolean(document.querySelector('#matchWatchPanel iframe'))",'actual app play missing');
 const previousRequests=centerRequests;
 await evaluate("window.preservedWatchFrame=document.querySelector('#matchWatchPanel iframe');document.getElementById('centerRefreshBtn').click()");
 for(let n=0;n<80&&centerRequests===previousRequests;n++)await new Promise(resolve=>setTimeout(resolve,50));
 if(centerRequests===previousRequests)throw Error('actual refresh not exercised');
 await wait("!document.getElementById('centerRefreshBtn').disabled",'actual center refresh unfinished');
 if(!await evaluate("document.querySelector('#matchWatchPanel iframe')===window.preservedWatchFrame && window.preservedWatchFrame.isConnected"))throw Error('actual LIVE rerender destroyed iframe');
 await evaluate("document.getElementById('navMatches').click()");
 await wait("!document.querySelector('#matchWatchPanel iframe') && document.getElementById('matchWatchPanel').hidden",'actual navigation left media');
 console.log(JSON.stringify({scope:'synthetic_browser_and_cache_api_not_actual_playback',countryRequired:true,lazyMedia:true,sameFixturePreserved:true,deniedEmbedFallback:true,countryTeardownImmediate:true,navigationTeardown:true,actualAppWiring:true,actualCenterRefreshPreservesFrame:true,widths:[320,390,900],requests}));
}finally{cdp?.close();await stopChrome(launched.chrome);await new Promise(resolve=>server.close(resolve));if(launched.profileDir)await rm(launched.profileDir,{recursive:true,force:true});}
