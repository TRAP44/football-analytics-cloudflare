import {createWatchSessionStore} from '../src/watch-session.js';
import {createUserPreferencesService} from '../src/user-preferences.js';
import {createServer} from 'node:http';
import {readFile,rm,writeFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {launchChromeWithRetry,stopChrome,Cdp,browserExecutable} from './bottom-nav-render-smoke.js';
import {createUserDataApiRuntime} from '../src/user-data-api-runtime.js';
import {watchFixtureIdentity,WATCH_PUBLISHERS,WATCH_TTL_MS,watchCacheKey,WATCH_LIBRARY_KEY} from '../src/match-watch.js';
import {matchCenterCacheKey} from '../src/match-center-cache-key.js';

// Real browser DOM + HTTP + actual cache-only API. Synthetic approved source and
// fake YouTube SDK: verifies our UI, not third-party or Telegram playback/rights.
const now=Date.now(),iso=ms=>new Date(now+ms).toISOString();
const match={fixtureId:999,home:{id:55,name:'Fixture Home'},away:{id:56,name:'Fixture Away'},league:'Fixture League',score:{home:0,away:0},elapsed:6,statusLabel:'Первый тайм',leagueId:39,season:2026,date:iso(-60000),live:true,finished:false,status:'1H'};
const approval={match,provider:'youtube',publisher:'fifa',videoId:'abcdefghijk',eventUrl:'https://www.youtube.com/watch?v=abcdefghijk',kind:'live',access:'free',countries:['RU','KZ'],confirmed:true,confirmedAt:iso(-10000),validUntil:iso(3600000)};
const catalogue={version:1,fixtureIdentity:watchFixtureIdentity(match),items:[{...approval,channelId:WATCH_PUBLISHERS.fifa,publicVideo:true,embeddable:true,ageRestricted:false,regionVerified:true,checkedAt:iso(0),expiresAt:iso(WATCH_TTL_MS),approval:{version:1,confirmed:true,confirmedAt:approval.confirmedAt,fixtureIdentity:watchFixtureIdentity(match)}}]};
const functions='addFavorite addFavoritePlayer addReminder analysisFreshness analysisResponsePayload getBotDigestSubscription getCache getFavoritePlayers getFavorites getHistory getPreferences getQuota getReminders getStaleCache getUserRecord isAdminUser publicDataCapabilities publicDigestSettings publicPlayerFollowNotificationContract publicRuntimeControls publicSiteUrl publicSmartNotificationCapabilities recordOpsEvent reminderDeliveryStatus removeFavorite removeFavoritePlayer removeReminder savePreferences setBotDigestSubscription'.split(' ');
const runtime={maintenanceMode:false,analysisEnabled:true,aiEnabled:true,liveEnabled:true,searchEnabled:true};
const center=()=>({mode:match.finished?'finished':'live',generatedAt:new Date().toISOString(),match,lineups:{},availability:{},playerLeaders:{home:[],away:[]}});
const preferences=createUserPreferencesService({memory:{},hasSupabase:()=>false});
const watchStore=createWatchSessionStore({memory:{},hasSupabase:()=>false});
const api=createUserDataApiRuntime({...Object.fromEntries(functions.map(key=>[key,async()=>[]])),getWatchSession:watchStore.getWatchSession,saveWatchSession:watchStore.saveWatchSession,json:(data,status=200)=>Response.json(data,{status}),getQuota:async()=>({plan:'FREE',left:5,limit:5,used:0}),getPreferences:preferences.getPreferences,savePreferences:preferences.savePreferences,getUserRecord:async()=>({}),publicRuntimeControls:()=>runtime,publicDataCapabilities:()=>({}),publicSmartNotificationCapabilities:()=>({}),isAdminUser:()=>false,watchApprovals:[approval],getCache:async key=>key===matchCenterCacheKey(999)?{match}:key===watchCacheKey(999)?catalogue:key===WATCH_LIBRARY_KEY?{version:1,checkedAt:new Date().toISOString(),entries:[{match,catalogue}]}:null});
let failWatch=false,delay=false,requests=0,centerRequests=0,slowPrefs=false,libraryRequests=0,holdController=false,holdLibrary=false,holdCenter=false,holdPrefs=false,failPrefs=false,preferenceWrites=0;const releaseControllers=[],releaseLibraries=[],releaseCenters=[],releasePrefs=[];
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/api/match-watch'){
   requests++;if(failWatch){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'SYNTHETIC_WATCH_UNAVAILABLE'}));return;}if(url.searchParams.get('list')==='1'){libraryRequests++;if(holdLibrary)await new Promise(resolve=>releaseLibraries.push(resolve));}if(delay)await new Promise(resolve=>setTimeout(resolve,300));
   const response=await api.apiMatchWatch(new Request(url),{},{id:42});res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());return;
  }
  if(url.pathname==='/api/preferences'){
   if(req.method==='POST'){preferenceWrites++;if(holdPrefs)await new Promise(resolve=>releasePrefs.push(resolve));if(failPrefs){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'SYNTHETIC_PREFERENCES_FAILURE'}));return;}}
   if(slowPrefs&&req.method==='GET')await new Promise(resolve=>setTimeout(resolve,600));
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const response=await api.apiPreferences(new Request(url,{method:req.method,...(req.method==='GET'?{}:{body:Buffer.concat(chunks).toString('utf8')})}),{},{id:42});
   res.setHeader('Content-Type','application/json');res.writeHead(response.status);res.end(await response.text());return;
  }
  if(url.pathname==='/api/match-center'){centerRequests++;if(holdCenter)await new Promise(resolve=>releaseCenters.push(resolve));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(center()));return;}
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
    window.YT={Player:class {constructor(iframe,options){this.iframe=iframe;window.failPlayer=options.events.onError;if(!window.silentPlayer)queueMicrotask(()=>options.events.onReady());}destroy(){window.destroyed++;this.iframe.remove();}}};
    let clock=Date.now(),serial=0;const timers=new Map();
    window.advanceWatch=ms=>{clock+=ms;const due=[...timers].filter(([,task])=>task.at<=clock);for(const [id,task] of due){timers.delete(id);task.fn();}};
    window.externalOpens=[];const clockWindow={Telegram:{WebApp:{openLink:url=>window.externalOpens.push(url)}},location:window.location,localStorage:window.localStorage,YT:window.YT,setTimeout:(fn,ms)=>{timers.set(++serial,{fn,at:clock+ms});return serial;},clearTimeout:id=>timers.delete(id),setInterval:window.setInterval.bind(window),clearInterval:window.clearInterval.bind(window),addEventListener:window.addEventListener.bind(window)};
    window.panel=createMatchWatch({now:()=>clock,window:clockWindow,api:async(url,options)=>{const response=await fetch(url,options),data=await response.json();if(!response.ok)throw Object.assign(Error('watch request failed'),{status:response.status,payload:data});return data;},escapeHtml});
    window.mount=()=>window.panel.mount({root:document.getElementById('watch'),fixtureId:999,isCurrent:()=>window.active});window.mount();`);return;
  }
  if(url.pathname==='/modules/match-center-controller.js'&&holdController)await new Promise(resolve=>releaseControllers.push(resolve));
  const root=path.resolve('public'),file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep))throw Error('path');
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(file));
 }catch{res.writeHead(500);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const launched=await launchChromeWithRetry(browserExecutable());let cdp,visualDir;
try{
 const tab=await(await fetch(`http://127.0.0.1:${launched.debugPort}/json/new?about:blank`,{method:'PUT'})).json();cdp=new Cdp(tab.webSocketDebuggerUrl);await cdp.open();await cdp.call('Page.enable');await cdp.call('Network.enable');await cdp.call('Network.setCacheDisabled',{cacheDisabled:true});await cdp.call('Network.setBlockedURLs',{urls:['*youtube.com*','*ytimg.com*']});await cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 const evaluate=async expression=>{const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result?.value;};
 const wait=async(expression,label)=>{for(let n=0;n<80;n++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error(label);};
 failWatch=true;
 await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?watch=1`});await wait("Boolean(document.querySelector('[data-watch-retry]'))",'failed source request hid the panel');
 if(await evaluate("Boolean(document.querySelector('iframe,.match-watch-source a'))"))throw Error('failed request exposed source');
 failWatch=false;await evaluate("document.querySelector('[data-watch-retry]').click()");await wait("Boolean(document.querySelector('[data-watch-country]'))",'country prompt not mounted after retry');
 if(await evaluate("Boolean(document.querySelector('iframe, [data-watch-play]'))"))throw Error('media or watch action before explicit country');
 await evaluate("document.querySelector('[data-watch-country]').value='RU';document.querySelector('[data-watch-country]').dispatchEvent(new Event('change'))");await wait("Boolean(document.querySelector('[data-watch-play]'))",'country source missing');
 if(await evaluate("Boolean(document.querySelector('iframe,script[src*=youtube]'))"))throw Error('third-party player loaded before click');
 await evaluate("document.querySelector('[data-watch-play]').click()");await wait("Boolean(document.querySelector('iframe'))",'on-click player missing');
 const frame=await evaluate("({src:document.querySelector('iframe').src,referrer:document.querySelector('iframe').referrerPolicy})");if(!frame.src.includes('autoplay=0')||frame.referrer!=='strict-origin-when-cross-origin')throw Error('embed contract');
 await evaluate('window.mount()');if(await evaluate('window.destroyed'))throw Error('same fixture reset player');
 // A real browser frame must survive a catalogue refresh; do not merely test
 // the pure URL helper or remount it at a stored position.
 await evaluate("window.originalWatchFrame=document.querySelector('iframe');window.originalWatchDetails=document.querySelector('details')");
 const beforeRenewal=requests;
 catalogue.items[0].checkedAt=new Date().toISOString();catalogue.items[0].expiresAt=new Date(Date.now()+WATCH_TTL_MS).toISOString();
 await evaluate('window.advanceWatch(60000)');
 for(let n=0;n<80&&requests===beforeRenewal;n++)await new Promise(resolve=>setTimeout(resolve,50));
 if(requests===beforeRenewal)throw Error('background renewal did not request catalogue');
 await wait("document.querySelector('[data-watch-play]') && document.querySelector('iframe')===window.originalWatchFrame",'renewal lost active frame');
 await new Promise(resolve=>setTimeout(resolve,100));
 if(!await evaluate("document.querySelector('iframe')===window.originalWatchFrame && document.querySelector('details')===window.originalWatchDetails && window.destroyed===0"))throw Error('catalogue renewal recreated player shell');

 await evaluate('window.failPlayer({data:150})');await wait("!document.querySelector('iframe') && document.querySelector('[data-watch-status]').textContent.includes('не разрешил')",'player denial fallback absent');
 if(!await evaluate("document.querySelector('.match-watch-source a').href==='https://www.youtube.com/watch?v=abcdefghijk'"))throw Error('official fallback absent');
 await evaluate("document.querySelector('.match-watch-source a').click()");if(!await evaluate("window.externalOpens.length===1&&window.externalOpens[0]==='https://www.youtube.com/watch?v=abcdefghijk'"))throw Error('Telegram external navigation missing');
 await evaluate("window.silentPlayer=true;document.querySelector('[data-watch-play]').click()");await wait("Boolean(document.querySelector('iframe'))",'silent player setup missing');
 await evaluate('window.advanceWatch(15000)');await wait("!document.querySelector('iframe')&&document.querySelector('[data-watch-status]').textContent.includes('не загрузился')",'silent player kept a blank frame');
 await evaluate('window.silentPlayer=false');
 await evaluate("document.querySelector('[data-watch-play]').click()");await wait('Boolean(window.failPlayer&&document.querySelector("iframe"))','second play missing');delay=true;
 await evaluate("document.querySelector('[data-watch-country]').value='KZ';document.querySelector('[data-watch-country]').dispatchEvent(new Event('change'))");
 if(await evaluate("Boolean(document.querySelector('iframe,.match-watch-source a'))"))throw Error('old country media/links remain while request pending');
 await wait("Boolean(document.querySelector('[data-watch-play]'))",'second country missing');
 // Revocation arrives over the actual API path and tears media down.
 await evaluate("document.querySelector('[data-watch-play]').click()");await wait("Boolean(document.querySelector('iframe'))",'revocation setup missing');
 const savedItems=catalogue.items;catalogue.items=[];const beforeWithdrawal=requests;
 await evaluate('window.advanceWatch(60000)');
 for(let n=0;n<80&&requests===beforeWithdrawal;n++)await new Promise(resolve=>setTimeout(resolve,50));
 await wait("!document.querySelector('iframe,.match-watch-source a')",'revoked catalogue left video or link');
 catalogue.items=savedItems;await evaluate('window.advanceWatch(30000)');await wait("Boolean(document.querySelector('[data-watch-play]'))",'catalogue recovery missing');
 if(await evaluate("Boolean(document.querySelector('iframe'))"))throw Error('recovery autoplayed video');
 for(const width of [320,390,900]){await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});if(await evaluate('document.documentElement.scrollWidth>innerWidth+1'))throw Error('overflow '+width);}
 await evaluate("document.querySelector('[data-watch-play]').click()");await wait("Boolean(document.querySelector('iframe'))",'third play missing');await evaluate('window.panel.dispose()');if(await evaluate("Boolean(document.querySelector('iframe')) || !document.getElementById('watch').hidden"))throw Error('dispose left media');
 // Exercise the actual app composition as well as the isolated widget.
 delay=false;
 const launch=new URLSearchParams({auth_date:String(Math.floor(now/1000)),user:JSON.stringify({id:42,first_name:'Fixture'}),hash:'0'.repeat(64)}).toString();
 await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/full-app?fixtureId=999&action=center&watch=1#${new URLSearchParams({tgWebAppData:launch})}`});
 await wait("Boolean(document.querySelector('#matchWatchPanel [data-watch-play]')) && document.querySelector('#bootGate')?.hidden",'actual app watch wiring missing');
 await evaluate("document.querySelector('[data-watch-private]').checked=true;document.querySelector('[data-watch-delay]').value='60';document.querySelector('[data-watch-privacy-save]').click()");
 await wait("document.querySelector('[data-watch-privacy-state]').textContent.includes('сохранены')",'watch privacy not confirmed by server');
 if(!await evaluate("document.body.classList.contains('watch-private')&&getComputedStyle(document.getElementById('analysis')).display==='none'&&document.getElementById('analysis').inert"))throw Error('match data visible in private mode');
 for(const width of [320,390]){await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});if(await evaluate('document.documentElement.scrollWidth>innerWidth+1'))throw Error('private mode overflow '+width);}
 await evaluate("window.YT={Player:class {constructor(iframe,options){this.iframe=iframe;queueMicrotask(()=>options.events.onReady());}destroy(){this.iframe.remove();}}};document.querySelector('#matchWatchPanel [data-watch-play]').click()");
 await wait("Boolean(document.querySelector('#matchWatchPanel iframe'))",'actual app play missing');
 const previousRequests=centerRequests;
 await evaluate("window.preservedWatchFrame=document.querySelector('#matchWatchPanel iframe');document.getElementById('centerRefreshBtn').click()");
 for(let n=0;n<80&&centerRequests===previousRequests;n++)await new Promise(resolve=>setTimeout(resolve,50));
 if(centerRequests===previousRequests)throw Error('actual refresh not exercised');
 await wait("!document.getElementById('centerRefreshBtn').disabled",'actual center refresh unfinished');
 if(!await evaluate("document.querySelector('#matchWatchPanel iframe')===window.preservedWatchFrame && window.preservedWatchFrame.isConnected"))throw Error('actual LIVE rerender destroyed iframe');
 await evaluate("document.getElementById('navMatches').click()");
 await wait("!document.querySelector('#matchWatchPanel iframe') && document.getElementById('matchWatchPanel').hidden",'actual navigation left media');
 if(!await evaluate("document.body.classList.contains('watch-private')&&getComputedStyle(document.getElementById('matches')).display==='none'"))throw Error('navigation exposed match feed');
 await evaluate("document.querySelector('[data-privacy-off]').click()");await wait("!document.body.classList.contains('watch-private')",'privacy could not be disabled');
 // A completed fixture uses the same real application/HTTP path, with the
 // existing full-recording label and on-demand player rather than a LIVE label.
 Object.assign(match,{status:'FT',statusLabel:'Матч завершён',live:false,finished:true});approval.kind='replay';catalogue.items[0].kind='replay';
 await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/full-app?fixtureId=999&action=center&watch=1&replaySmoke=1#${new URLSearchParams({tgWebAppData:launch})}`});
 await wait("Boolean(document.querySelector('#matchWatchPanel [data-watch-play]')) && document.querySelector('#bootGate')?.hidden",'finished match replay missing');
 const replayLabel=await evaluate("document.querySelector('#matchWatchPanel .match-watch-source span').textContent");
 if(!replayLabel.includes('Полная запись')||replayLabel.includes('Трансляция'))throw Error('replay incorrectly labelled as LIVE');
 await evaluate("window.YT={Player:class {constructor(iframe,opts){this.iframe=iframe;queueMicrotask(()=>opts.events.onReady?.());}getCurrentTime(){return 125;}destroy(){this.iframe.remove();}}};document.querySelector('#matchWatchPanel [data-watch-play]').click()");
 await wait("Boolean(document.querySelector('#matchWatchPanel iframe'))",'replay player not mounted');
 await evaluate("document.getElementById('navMatches').click()");
 await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/full-app?fixtureId=999&action=center&watch=1&resumeSmoke=1#${new URLSearchParams({tgWebAppData:launch})}`});
 await wait("document.querySelector('#matchWatchPanel [data-watch-play]')?.textContent.includes('Продолжить с 2:05')",'saved replay position missing');
 await evaluate("window.YT={Player:class {constructor(iframe,options){this.iframe=iframe;queueMicrotask(()=>options.events.onReady());}destroy(){this.iframe.remove();}}};document.querySelector('#matchWatchPanel [data-watch-play]').click()");
 await wait("Boolean(document.querySelector('#matchWatchPanel iframe'))",'resumed iframe missing');
 if(!await evaluate("new URL(document.querySelector('#matchWatchPanel iframe').src).searchParams.get('start')==='125'"))throw Error('replay did not seek to saved position');
 await evaluate("document.querySelector('[data-watch-restart]').click()");
 if(!await evaluate("new URL(document.querySelector('#matchWatchPanel iframe').src).searchParams.get('start')===null"))throw Error('start over did not reset position');
 // Short official summaries use their own label and the same on-demand player.
 approval.kind='highlights';catalogue.items[0].kind='highlights';
 await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/full-app?fixtureId=999&action=center&watch=1&highlightSmoke=1#${new URLSearchParams({tgWebAppData:launch})}`});
 await wait("Boolean(document.querySelector('#matchWatchPanel [data-watch-play]')) && document.querySelector('#bootGate')?.hidden",'highlight missing');
 if(!await evaluate("document.querySelector('#matchWatchPanel .match-watch-source span').textContent.includes('Обзор')"))throw Error('highlight incorrectly labelled');
 await evaluate("window.YT={Player:class {constructor(iframe,options){this.iframe=iframe;queueMicrotask(()=>options.events.onReady());}destroy(){this.iframe.remove();}}};document.querySelector('#matchWatchPanel [data-watch-play]').click()");await wait("Boolean(document.querySelector('#matchWatchPanel iframe'))",'highlight player absent');
 // Server preferences may have changed in another tab. A delayed restore must
 // update the visible selector as well as the internal mode before confirmation.
 await evaluate(`fetch('/api/preferences',{method:'POST',body:JSON.stringify({watchSession:{fixtureId:999,delaySeconds:30}})}).then(()=>localStorage.setItem('matchradar:watch-mode:v1',JSON.stringify({fixtureId:999,delaySeconds:90,startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()})))`);
 slowPrefs=true;
 await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/full-app?fixtureId=999&action=center&watch=1&restoreSmoke=1#${new URLSearchParams({tgWebAppData:launch})}`});
 await wait("document.querySelector('[data-watch-delay]')?.value==='30' && document.getElementById('watchPrivacyBanner').textContent.includes('включена')",'canonical restore delay not reflected in the control');
 await evaluate("document.querySelector('[data-privacy-off]').click()");await wait("!document.body.classList.contains('watch-private')",'privacy off before external-source case');
 Object.assign(match,{fixtureId:1000});
 await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/full-app?fixtureId=1000&action=center#${new URLSearchParams({tgWebAppData:launch})}`});
 await wait("Boolean(document.querySelector('[data-watch-private]')) && document.querySelector('#matchWatchPanel summary').textContent.includes('Режим просмотра')",'privacy missing for a match without a catalogued stream');
 if(await evaluate("Boolean(document.querySelector('#matchWatchPanel [data-watch-play],#matchWatchPanel .match-watch-source a'))"))throw Error('empty catalogue invented a stream');
 await evaluate("document.querySelector('[data-watch-private]').checked=true;document.querySelector('[data-watch-privacy-save]').click()");await wait("document.querySelector('[data-watch-privacy-state]').textContent.includes('сохранены')",'external viewing mode not acknowledged');
 // Home library is strictly opt-in and routes to a checked match, not directly
 // to a video URL. No media or score is exposed by the home discovery cards.
 await evaluate("document.querySelector('[data-privacy-off]').click()");await wait("!document.body.classList.contains('watch-private')",'private mode reset before home library');
 await evaluate("localStorage.removeItem('matchradar:watch-country:v1')");Object.assign(match,{fixtureId:999});
 await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/full-app?librarySmoke=1#${new URLSearchParams({tgWebAppData:launch})}`});
 await wait("document.getElementById('bootGate')?.hidden && document.getElementById('matchesView').classList.contains('active')",'home library boot incomplete');
 if(libraryRequests!==0)throw Error('library performed a startup request');
 await evaluate("window.libraryRealNow=Date.now;window.libraryClock=Date.now();Date.now=()=>window.libraryClock;document.getElementById('watchLibrary').open=true");await wait("Boolean(document.querySelector('[data-watch-library-country]'))",'library country selector missing');
 if(await evaluate("Boolean(document.querySelector('[data-watch-library-open],iframe,script[src*=youtube]'))"))throw Error('library exposed card/media before explicit country');
 await evaluate("document.querySelector('[data-watch-library-country]').value='RU';document.querySelector('[data-watch-library-country]').dispatchEvent(new Event('change'))");await wait("Boolean(document.querySelector('[data-watch-library-open]'))",'library card missing');
 // The known kickoff label can contain 0:0 at Moscow midnight. Remove only
 // that complete timestamp; every other visible field retains the score guard.
 const kickoffLabel=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(match.date))+' МСК';
 if(await evaluate(`/0:0|1:0|fixtureIdentity|https:/.test(document.getElementById('watchLibrary').innerText.replace(${JSON.stringify(kickoffLabel)},''))`))throw Error('library leaked score or internal metadata');
 for(const width of [320,390,900]){await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});if(await evaluate('document.documentElement.scrollWidth>innerWidth+1'))throw Error('library overflow '+width);}
 delay=true;
 await evaluate("document.querySelector('[data-watch-library-country]').value='KZ';document.querySelector('[data-watch-library-country]').dispatchEvent(new Event('change'));document.querySelector('[data-watch-library-country]').value='RU';document.querySelector('[data-watch-library-country]').dispatchEvent(new Event('change'))");
 await wait("document.querySelector('[data-watch-library-country]')?.value==='RU' && Boolean(document.querySelector('[data-watch-library-open]'))",'library country race unresolved');delay=false;
 // Closing and returning while the controller import is pending cancels
 // the old intent, even when the home/library are active again at completion.
 holdController=true;const beforeCancelledOpen=centerRequests,beforeCancelledPrefs=preferenceWrites;
 await evaluate("document.querySelector('[data-watch-library-open]').click()");
 for(let n=0;n<80&&!releaseControllers.length;n++)await new Promise(resolve=>setTimeout(resolve,50));
 if(!releaseControllers.length)throw Error('delayed controller import not exercised');
 await evaluate("document.getElementById('watchLibrary').open=false");
 await new Promise(resolve=>setTimeout(resolve,50));
 await evaluate("document.getElementById('watchLibrary').open=true;document.getElementById('navProfile').click();document.getElementById('navMatches').click()");
 holdController=false;for(const release of releaseControllers.splice(0))release();
 await wait("!document.querySelector('[data-watch-library-open]').disabled",'cancelled open did not finish');
 if(centerRequests!==beforeCancelledOpen||preferenceWrites!==beforeCancelledPrefs||!await evaluate("document.getElementById('matchesView').classList.contains('active') && !document.body.classList.contains('watch-private')"))throw Error('stale library intent opened a match or changed privacy');
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 for(const theme of ['dark','light']){
  await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>{document.documentElement.dataset.theme='${theme}';document.querySelector('.watch-library-card').scrollIntoView({block:'center'});requestAnimationFrame(()=>requestAnimationFrame(resolve));}))`);
  const shot=await cdp.call('Page.captureScreenshot',{format:'png'});visualDir ||= await mkdtemp(path.join(tmpdir(),'matchradar-watch-library-'));await writeFile(path.join(visualDir,'watch-library-'+theme+'.png'),Buffer.from(shot.data,'base64'),{flag:'wx',mode:0o600});
 }
 // The opt-in private action hides data BEFORE a held centre response and
 // does not wait for preferences. A failed ACK must never reveal the result.
 holdCenter=true;holdPrefs=true;const beforePrivate=centerRequests;
 await evaluate("document.querySelector('[data-watch-without-spoilers]').click()");
 for(let n=0;n<80&&(!releaseCenters.length||!releasePrefs.length);n++)await new Promise(resolve=>setTimeout(resolve,50));
 if(centerRequests!==beforePrivate+1||!releasePrefs.length)throw Error('private entry did not start centre and preferences in parallel');
 if(!await evaluate("document.body.classList.contains('watch-private') && document.getElementById('analysis').inert && getComputedStyle(document.getElementById('analysis')).display==='none' && document.getElementById('watchPrivacyBanner').textContent.includes('Сохраняем')"))throw Error('private entry exposed data before HTTP completion');
 failPrefs=true;holdPrefs=false;for(const release of releasePrefs.splice(0))release();
 await wait("document.getElementById('watchPrivacyBanner').textContent.includes('подтвердить не удалось')",'failed privacy ACK was not explained');
 holdCenter=false;for(const release of releaseCenters.splice(0))release();
 await wait("document.getElementById('analysisView').classList.contains('active') && document.querySelector('#matchWatchPanel details')?.open",'private library did not open checked watch panel');
 if(!await evaluate("getComputedStyle(document.getElementById('analysis')).display==='none' && document.getElementById('analysis').inert && !document.querySelector('#matchWatchPanel iframe')"))throw Error('failed privacy ACK exposed result or autoplayed');
 // An explicit retry confirms the actual server watch-session contract.
 failPrefs=false;
 await evaluate("document.querySelector('[data-watch-private]').checked=true;document.querySelector('[data-watch-privacy-save]').click()");
 await wait("document.querySelector('[data-watch-privacy-state]').textContent.includes('сохранены')",'private library retry not acknowledged');
 const savedPrivate=await watchStore.getWatchSession(42);
 if(savedPrivate?.fixtureId!==999||savedPrivate.delaySeconds!==0)throw Error('private library did not pause notifications for the selected match');
 await evaluate("document.querySelector('[data-privacy-off]').click()");await wait("!document.body.classList.contains('watch-private')",'private library mode could not be disabled');
 await evaluate("document.getElementById('navMatches').click()");await wait("Boolean(document.querySelector('[data-watch-library-open]'))",'home library lost after private return');
 const beforeOrdinaryPrefs=preferenceWrites;
 await evaluate("document.querySelector('[data-watch-library-open]:not([data-watch-without-spoilers])').click()");await wait("document.getElementById('analysisView').classList.contains('active') && document.querySelector('#matchWatchPanel details')?.open",'ordinary library did not open checked match');
 if(preferenceWrites!==beforeOrdinaryPrefs||!await evaluate("!document.body.classList.contains('watch-private') && !document.querySelector('#matchWatchPanel iframe')"))throw Error('ordinary entry changed privacy or autoplayed');
 await evaluate("document.getElementById('navMatches').click()");await wait("Boolean(document.querySelector('[data-watch-library-open]'))",'home library lost after return');
 // A hidden Telegram view cancels its optional request and rechecks on return.
 holdLibrary=true;const beforeHidden=libraryRequests;
 await evaluate("document.querySelector('[data-watch-library-refresh]').click()");
 for(let n=0;n<80&&libraryRequests===beforeHidden;n++)await new Promise(resolve=>setTimeout(resolve,50));
 await evaluate("window.libraryVisibility='hidden';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.libraryVisibility});document.dispatchEvent(new Event('visibilitychange'))");
 holdLibrary=false;for(const release of releaseLibraries.splice(0))release();
 await evaluate("window.libraryVisibility='visible';document.dispatchEvent(new Event('visibilitychange'))");
 for(let n=0;n<80&&libraryRequests<beforeHidden+2;n++)await new Promise(resolve=>setTimeout(resolve,50));
 if(libraryRequests!==beforeHidden+2)throw Error('visibility return did not recheck the cancelled library request once');
 await wait("Boolean(document.querySelector('[data-watch-library-open]')) && !document.querySelector('[data-watch-library-state]').textContent",'library visibility recovery incomplete');
 // Expiry removes cards while an HTTP request is deliberately held open.
 holdLibrary=true;const beforeHeld=libraryRequests;
 await evaluate("window.libraryClock+=31*60000;window.dispatchEvent(new Event('pageshow'))");
 for(let n=0;n<80&&libraryRequests===beforeHeld;n++)await new Promise(resolve=>setTimeout(resolve,50));
 if(libraryRequests===beforeHeld)throw Error('held library refresh not exercised');
 await wait("!document.querySelector('[data-watch-library-open]')",'expired card survived a hung refresh');
 holdLibrary=false;for(const release of releaseLibraries.splice(0))release();
 await evaluate('Date.now=window.libraryRealNow');
 console.log(JSON.stringify({scope:'synthetic_browser_and_cache_api_not_actual_playback',countryRequired:true,homeLibraryOptIn:true,homeLibraryNoSpoilers:true,homeLibraryPrivateBeforeResponse:true,homeLibraryPrivacyFailureKeepsHidden:true,homeLibraryPrivacyRetryConfirmed:true,homeLibraryOrdinaryEntryUnchanged:true,homeLibraryRoutesToCheckedMatch:true,homeLibraryNoAutoplay:true,homeLibraryCancelledImport:true,homeLibraryVisibilityPause:true,homeLibraryExpiryDuringRefresh:true,lazyMedia:true,sameFixturePreserved:true,deniedEmbedFallback:true,initialFailureRetry:true,silentPlayerDeadline:true,telegramOfficialLink:true,countryTeardownImmediate:true,navigationTeardown:true,backgroundRenewalPreservesFrame:true,withdrawalStopsPlayer:true,recoveryNeverAutoplays:true,actualAppWiring:true,actualCenterRefreshPreservesFrame:true,finishedReplayLabel:true,finishedReplayPlayer:true,officialHighlightLabel:true,officialHighlightPlayer:true,privacyHidesData:true,privacyApiConfirmed:true,privacyNavigationSafe:true,canonicalRestoreVisible:true,externalViewingPrivate:true,replayResume:true,replayRestart:true,widths:[320,390,900],requests}));
}finally{for(const release of [...releaseControllers,...releaseLibraries,...releaseCenters,...releasePrefs])release();cdp?.close();await stopChrome(launched.chrome);await new Promise(resolve=>server.close(resolve));if(visualDir)await rm(visualDir,{recursive:true,force:true});if(launched.profileDir)await rm(launched.profileDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
