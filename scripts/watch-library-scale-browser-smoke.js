import {createServer} from 'node:http';
import {readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {launchChromeWithRetry,stopChrome,Cdp,browserExecutable} from './bottom-nav-render-smoke.js';
// Actual browser component, synthetic API response. Not football rights/playback proof.
const html=`<!doctype html><meta charset="utf-8"><details id="library"><summary>Доступные матчи</summary><div data-watch-library-body></div></details><script type="module">
import {createWatchLibrary} from '/modules/watch-library.js';
window.calls=[];const expiry=new Date(Date.now()+1800000).toISOString();
window.controller=createWatchLibrary({root:document.getElementById('library'),escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),onOpen:async()=>{},api:async url=>{calls.push(url);const p=new URL(url,location.origin).searchParams,country=p.get('country')||'';return {country,available:!!country,countries:[{code:'RU',name:'Россия'},{code:'KZ',name:'Казахстан'}],items:country?Array.from({length:country==='RU'?46:24},(_,i)=>({fixtureId:900000+i,home:'Home '+i,away:'Away '+i,league:'Fixture League',date:new Date(Date.now()).toISOString(),kinds:[i<30?'replay':'highlights'],expiresAt:expiry})):[]};}});
window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://local.test');if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  const root=path.resolve('public'),file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)||!file.endsWith('.js'))throw Error('path');res.setHeader('Content-Type','text/javascript');res.end(await readFile(file));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const launched=await launchChromeWithRetry(browserExecutable());let cdp;
try{
 const tab=await(await fetch(`http://127.0.0.1:${launched.debugPort}/json/new?about:blank`,{method:'PUT'})).json();cdp=new Cdp(tab.webSocketDebuggerUrl);await cdp.open();await cdp.call('Page.enable');
 const evaluate=async expression=>{const r=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('Library scale browser evaluation failed');return r.result?.value;};
 const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Library scale condition failed: '+expression);};
 for(const width of [320,390,900]){
  await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});
  await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});await wait('window.ready===true');
  await evaluate("localStorage.clear()");
  if(await evaluate('calls.length!==0'))throw Error('Library requested data before opened');
  await evaluate("document.getElementById('library').open=true");await wait("Boolean(document.querySelector('[data-watch-library-country]'))");
  // A fresh navigation may restore the preceding explicit country; select it anew.
  await evaluate("document.querySelector('[data-watch-library-country]').value='RU';document.querySelector('[data-watch-library-country]').dispatchEvent(new Event('change'))");
  await wait("document.querySelectorAll('.watch-library-card').length===20");const before=await evaluate('calls.length');
  await evaluate("document.querySelector('[data-watch-library-more]').click()");await wait("document.querySelectorAll('.watch-library-card').length===40");
  await evaluate("document.querySelector('[data-watch-library-more]').click()");await wait("document.querySelectorAll('.watch-library-card').length===46 && !document.querySelector('[data-watch-library-more]')");
  if(await evaluate(`calls.length!==${before} || calls.some(url=>!url.includes('limit=100')) || Boolean(document.querySelector('iframe,script[src*=youtube]'))`))throw Error('Load more performed I/O or loaded media');
  await evaluate("document.querySelector('[data-watch-library-kind=replay]').click()");await wait("document.querySelectorAll('.watch-library-card').length===20 && document.querySelector('[data-watch-library-more]')?.textContent.includes('10')");
  await evaluate("document.querySelector('[data-watch-library-more]').click()");await wait("document.querySelectorAll('.watch-library-card').length===30");
  await evaluate("document.querySelector('[data-watch-library-kind=highlights]').click()");await wait("document.querySelectorAll('.watch-library-card').length===16 && !document.querySelector('[data-watch-library-more]')");
  if(await evaluate(`calls.length!==${before}`))throw Error('Type filters performed I/O');
  await evaluate("document.querySelector('[data-watch-library-kind=all]').click()");
  await evaluate("document.querySelector('[data-watch-library-country]').value='KZ';document.querySelector('[data-watch-library-country]').dispatchEvent(new Event('change'))");await wait("document.querySelectorAll('.watch-library-card').length===20 && document.querySelector('[data-watch-library-more]')?.textContent.includes('4')");
 }
 console.log(JSON.stringify({watchLibraryScale:true,widths:[320,390,900],initialCards:20,expandedCards:46,loadMoreApiRequests:0,noStartupRequests:true,noPlayer:true,countryChangeResetsPage:true,typeFiltersNoRequests:true,scope:'native_component_synthetic_api_not_device_playback'}));
}finally{cdp?.close();await stopChrome(launched.chrome);await rm(launched.profileDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
