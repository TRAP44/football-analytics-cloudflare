import {createServer} from 'node:http';
import {readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {launchChromeWithRetry,stopChrome,Cdp,browserExecutable} from './bottom-nav-render-smoke.js';
import {parseKleagueTvPage,kleagueTvApprovals} from './kleague-tv-catalogue.js';
import {watchFixtureIdentity,watchApiPayload,watchLibraryPayload} from '../src/match-watch.js';
const recorded=JSON.parse(await readFile('test-support/fixtures/kleague-watch-sources.json','utf8')),now=Date.parse('2026-10-27T19:00:00Z');
const sources=parseKleagueTvPage(`<script id="__NUXT_DATA__">${JSON.stringify(recorded.detailNuxt)}</script>`);
const approved=kleagueTvApprovals(sources.map(source=>({source,observedAt:new Date(now).toISOString()})),recorded.matches.map(match=>({match,observedAt:new Date(now).toISOString()})),now,watchFixtureIdentity).find(item=>item.match.fixtureId===1510482);
const {match}=approved,identity=watchFixtureIdentity(match),catalogue={version:1,fixtureIdentity:identity,items:[{...approved,registrationRequired:true,regionVerified:true,checkedAt:new Date(now).toISOString(),expiresAt:new Date(now+1800000).toISOString(),approval:{version:3,policyId:approved.policyId,policyRevision:approved.policyRevision,confirmed:true,confirmedAt:new Date(now).toISOString(),fixtureIdentity:identity}}]},index={version:1,checkedAt:new Date(now).toISOString(),entries:[{match,catalogue}]};
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/premium-ui.css"><style>body{margin:12px}#watch,#library{max-width:100%}</style><details id="library" open><summary>Доступные матчи</summary><div data-watch-library-body></div></details><div id="watch"></div><script type="module">
import {createMatchWatch} from '/modules/match-watch.js';import {createWatchLibrary} from '/modules/watch-library.js';
window.clock=${now};window.opened=[];window.Telegram={WebApp:{openLink:url=>opened.push(url)}};localStorage.setItem('matchradar:watch-country:v1','RU');
const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');const api=async url=>(await fetch(url)).json();
window.watch=createMatchWatch({api,escapeHtml,now:()=>clock});watch.mount({root:document.getElementById('watch'),fixtureId:1510482,open:true});window.library=createWatchLibrary({root:document.getElementById('library'),api,escapeHtml,now:()=>clock,onOpen:async()=>{}});library.resume();window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{
 try{const u=new URL(req.url,'http://local.test');if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  if(u.pathname==='/api/match-watch'){const country=u.searchParams.get('country')||'';res.setHeader('Content-Type','application/json');res.end(JSON.stringify(u.searchParams.has('list')?watchLibraryPayload(index,{country,now,approvals:[],maxEntries:100}):watchApiPayload(match,catalogue,{country,now,approvals:[]})));return;}
  const root=path.resolve('public'),file=path.resolve(root,'.'+u.pathname);if(!file.startsWith(root+path.sep)||!['.js','.css'].includes(path.extname(file)))throw Error('path');res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(file));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const launched=await launchChromeWithRetry(browserExecutable());let cdp;
try{
 const tab=await(await fetch(`http://127.0.0.1:${launched.debugPort}/json/new?about:blank`,{method:'PUT'})).json();cdp=new Cdp(tab.webSocketDebuggerUrl);await cdp.open();await cdp.call('Page.enable');
 const evaluate=async expression=>{const r=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('K LEAGUE browser evaluation failed');return r.result?.value;};
 const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('K LEAGUE browser condition failed: '+expression);};
 for(const width of [320,390,900]){
  await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
  await wait("window.ready && Boolean(document.querySelector('[data-watch-external]')) && Boolean(document.querySelector('.watch-library-card'))");
  if(!await evaluate("document.getElementById('watch').textContent.includes('Полная запись') && document.getElementById('watch').textContent.includes('Бесплатно · регистрация у источника') && document.querySelector('.watch-library-card').textContent.includes('нужна бесплатная регистрация')"))throw Error('Registration requirement or source type is missing');
  if(await evaluate("Boolean(document.querySelector('iframe,script[src*=youtube],[data-watch-play]')) || document.documentElement.scrollWidth>innerWidth+1"))throw Error('External recording embedded, loaded media or overflowed');
  await evaluate("document.querySelector('[data-watch-external]').click()");await wait('opened.length===1');if(await evaluate(`opened[0]!==${JSON.stringify(approved.eventUrl)}`))throw Error('Telegram opened an unverified permalink');
  await evaluate("clock+=1800001;document.querySelector('[data-watch-external]').click()");if(await evaluate('opened.length!==1'))throw Error('Expired official link opened');
 }
 console.log(JSON.stringify({kleagueOfficialRecordings:true,widths:[320,390,900],registrationBeforeClick:true,libraryRegistrationHint:true,telegramExactPermalink:true,noIframe:true,noMediaRequests:true,expiredLinkBlocked:true,scope:'native_component_recorded_metadata_synthetic_api_not_actual_registered_playback'}));
}finally{cdp?.close();await stopChrome(launched.chrome);await rm(launched.profileDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
