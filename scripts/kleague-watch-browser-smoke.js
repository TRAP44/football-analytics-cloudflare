import {createServer} from 'node:http';
import {readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {browserExecutable,launchChromeWithRetry,stopChrome,Cdp} from './bottom-nav-render-smoke.js';
import {parseKleagueTvPage,kleagueTvApprovals} from './kleague-tv-catalogue.js';
import {watchFixtureIdentity,watchApiPayload,watchLibraryPayload} from '../src/match-watch.js';
const recorded=JSON.parse(await readFile('test-support/fixtures/kleague-watch-sources.json','utf8'));
const upcoming=JSON.parse(await readFile('test-support/fixtures/kleague-upcoming-sources.json','utf8')),now=Date.parse(upcoming.observedAt);
const parse=nodes=>parseKleagueTvPage(`<script id="__NUXT_DATA__">${JSON.stringify(nodes)}</script>`);
function scenario(sources,matches,id){
 const approved=kleagueTvApprovals(sources.map(source=>({source,observedAt:new Date(now).toISOString()})),matches.map(match=>({match,observedAt:new Date(now).toISOString()})),now,watchFixtureIdentity).find(item=>item.match.fixtureId===id);
 if(!approved)throw Error('Recorded K LEAGUE source missing');
 const {match}=approved,identity=watchFixtureIdentity(match),catalogue={version:1,fixtureIdentity:identity,items:[{...approved,registrationRequired:true,regionVerified:true,checkedAt:new Date(now).toISOString(),expiresAt:approved.validUntil,approval:{version:3,policyId:approved.policyId,policyRevision:approved.policyRevision,confirmed:true,confirmedAt:new Date(now).toISOString(),fixtureIdentity:identity}}]};
 return {approved,match,catalogue,index:{version:1,checkedAt:new Date(now).toISOString(),entries:[{match,catalogue}]}};
}
const scenarios={recording:scenario(parse(recorded.detailNuxt),recorded.matches,1510482),scheduled:scenario(parse(upcoming.announcedNuxt),[upcoming.canonicalMatch],1510483)};
function html(key){const s=scenarios[key];return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/premium-ui.css"><style>body{margin:12px}#watch,#library{max-width:100%}</style><details id="library" open><summary>Доступные матчи</summary><div data-watch-library-body></div></details><div id="watch"></div><script type="module">
import {createMatchWatch} from '/modules/match-watch.js';import {createWatchLibrary} from '/modules/watch-library.js';
window.clock=${now};window.opened=[];window.Telegram={WebApp:{openLink:url=>opened.push(url)}};localStorage.setItem('matchradar:watch-country:v1','RU');
const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');const api=async url=>(await fetch(url+'&scenario=${key}')).json();
window.watch=createMatchWatch({api,escapeHtml,now:()=>clock});watch.mount({root:document.getElementById('watch'),fixtureId:${s.match.fixtureId},open:true});window.library=createWatchLibrary({root:document.getElementById('library'),api,escapeHtml,now:()=>clock,onOpen:async()=>{}});library.resume();window.ready=true;
</script>`;}
const server=createServer(async(req,res)=>{
 try{const u=new URL(req.url,'http://local.test'),key=u.searchParams.get('scenario')||'recording',s=scenarios[key];if(!s)throw Error('scenario');
  if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html(key));return;}
  if(u.pathname==='/api/match-watch'){const opts={country:u.searchParams.get('country')||'',now,approvals:[],scheduledBroadcasts:u.searchParams.get('cap')==='scheduled-v1'};res.setHeader('Content-Type','application/json');res.end(JSON.stringify(u.searchParams.has('list')?watchLibraryPayload(s.index,{...opts,maxEntries:100}):watchApiPayload(s.match,s.catalogue,opts)));return;}
  const root=path.resolve('public'),file=path.resolve(root,'.'+u.pathname);if(!file.startsWith(root+path.sep)||!['.js','.css'].includes(path.extname(file)))throw Error('path');res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(file));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const launched=await launchChromeWithRetry(browserExecutable());let cdp;
try{
 const tab=await(await fetch(`http://127.0.0.1:${launched.debugPort}/json/new?about:blank`,{method:'PUT'})).json();cdp=new Cdp(tab.webSocketDebuggerUrl);await cdp.open();await cdp.call('Page.enable');
 const evaluate=async expression=>{const r=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('K LEAGUE browser evaluation failed');return r.result?.value;};
 const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('K LEAGUE browser condition failed: '+expression);};
 for(const [key,s] of Object.entries(scenarios))for(const width of [320,390,900]){
  await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?scenario=${key}`});
  await wait("window.ready && Boolean(document.querySelector('[data-watch-external]')) && Boolean(document.querySelector('.watch-library-card'))");
  const type=key==='scheduled'?'Запланированный эфир':'Полная запись';
  if(!await evaluate(`document.getElementById('watch').textContent.includes(${JSON.stringify(type)}) && document.getElementById('watch').textContent.includes('Бесплатно · регистрация у источника') && document.querySelector('.watch-library-card').textContent.includes('нужна бесплатная регистрация')`))throw Error('Registration requirement or source type is missing '+key);
  if(key==='scheduled'&&!await evaluate("document.querySelector('.watch-library-card').textContent.includes('Запланированный эфир') && document.querySelector('[data-watch-library-kind=live]').textContent.includes('Эфиры')"))throw Error('Announcement mislabeled as current LIVE');
  if(await evaluate("Boolean(document.querySelector('iframe,script[src*=youtube],[data-watch-play]')) || document.documentElement.scrollWidth>innerWidth+1"))throw Error('External source embedded, loaded media or overflowed');
  await evaluate("document.querySelector('[data-watch-external]').click()");await wait('opened.length===1');if(await evaluate(`opened[0]!==${JSON.stringify(s.approved.eventUrl)}`))throw Error('Telegram opened an unverified permalink');
  if(key==='scheduled'&&!await evaluate("fetch('/api/match-watch?fixtureId=1510483&country=RU&scenario=scheduled').then(r=>r.json()).then(d=>d.available===false&&d.items.length===0)"))throw Error('Legacy client received unsupported announcement');
  await evaluate("clock+=1800001;document.querySelector('[data-watch-external]').click()");if(await evaluate('opened.length!==1'))throw Error('Expired official link opened');
 }
 console.log(JSON.stringify({kleagueOfficialRecordings:true,scheduledBroadcasts:true,widths:[320,390,900],registrationBeforeClick:true,libraryRegistrationHint:true,legacyCapabilityGuard:true,telegramExactPermalink:true,noIframe:true,expiredLinkBlocked:true,scope:'native_component_recorded_metadata_synthetic_api_not_actual_registered_playback'}));
}finally{cdp?.close();await stopChrome(launched.chrome);await rm(launched.profileDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
