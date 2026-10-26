import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatchWatch} from '../public/modules/match-watch.js';

// Minimal DOM doubles for deadline/race tests; the browser smoke covers real DOM.
class Node {
 constructor(){this.children=[];this.dataset={};this.isConnected=true;this.value='';}
 set innerHTML(value){this.html=value;}
 get innerHTML(){return this.html||'';}
 append(child){this.children.push(child);child.parent=this;child.isConnected=true;}
 remove(){this.isConnected=false;this.parent.children=this.parent.children.filter(node=>node!==this);}
 replaceChildren(){for(const child of this.children)child.isConnected=false;this.children=[];}
 addEventListener(name,fn){(this.events||=new Map()).set(name,fn);}
}
class Root extends Node {
 get innerHTML(){return this.html||'';}
 constructor(){super();this.nodes=new Map();}
 set innerHTML(value){this.html=value;this.nodes.clear();for(const key of ['details','summary','[data-watch-country-area]','[data-watch-country]','[data-watch-options]','[data-broadcast-guide]','[data-watch-player]','[data-watch-status]','[data-watch-private]','[data-watch-delay]','[data-watch-privacy-save]','[data-watch-privacy-state]','[data-watch-retry]'])this.nodes.set(key,new Node());}
 querySelector(key){return key==='iframe'?this.nodes.get('[data-watch-player]')?.children[0]:this.nodes.get(key);}
 querySelectorAll(key){if(key==='[data-watch-external]' && this.nodes.get('[data-watch-options]')?.innerHTML.includes('data-watch-external')){const link=new Node();link.dataset.watchExternal='0';this.externalLink=link;return [link];}if(key!=='[data-watch-play]'||!this.nodes.get('[data-watch-options]')?.innerHTML.includes('data-watch-play'))return [];const button=new Node();button.dataset.watchPlay='0';this.playButton=button;return [button];}
 replaceChildren(){this.nodes.get('[data-watch-player]')?.replaceChildren();this.nodes.clear();}
}
const settle=async()=>{for(let n=0;n<8;n++)await Promise.resolve();};
function fixture(ttl=120000,{ready=true,bridge}={}){
 let time=Date.now(),next=0,requests=0,destroyed=0,created=0,reply,playerEvents;
 const timers=new Map(),listeners=new Map(),values=new Map([['matchradar:watch-country:v1','RU']]),root=new Root();
 const item=(expires=time+ttl,videoId='abcdefghijk')=>({name:'Official',kind:'replay',access:'free',provider:'youtube',videoId,eventUrl:`https://www.youtube.com/watch?v=${videoId}`,embed:true,expiresAt:new Date(expires).toISOString()});
 const data=(items=[item()])=>({countries:[{code:'RU',name:'Россия'},{code:'KZ',name:'Казахстан'}],items});
 reply=()=>data();
 const win={...(bridge?{Telegram:{WebApp:{openLink:bridge}}}:{}),location:{href:'https://app.example/?watch=1',origin:'https://app.example'},localStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},setTimeout:(fn,ms)=>{timers.set(++next,{at:time+ms,fn});return next;},clearTimeout:id=>timers.delete(id),setInterval:()=>++next,clearInterval(){},addEventListener:(name,fn)=>listeners.set(name,fn),YT:{Player:class{constructor(iframe,options){created++;this.iframe=iframe;playerEvents=options.events;if(ready)queueMicrotask(()=>options.events.onReady());}getCurrentTime(){return 125;}destroy(){destroyed++;this.iframe.remove();}}}};
 const docEvents=new Map(),doc={visibilityState:'visible',createElement:()=>new Node(),addEventListener:(name,fn)=>docEvents.set(name,fn)};
 const panel=createMatchWatch({api:async()=>{requests++;return reply();},escapeHtml:String,watchExperience:{settings:()=>({enabled:true,delaySeconds:30}),setMode:async()=>true},now:()=>time,window:win,document:doc});
 const advance=async ms=>{const end=time+ms;for(;;){const due=[...timers].filter(([,task])=>task.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;time=due[1].at;timers.delete(due[0]);due[1].fn();await settle();}time=end;await settle();};
 return {root,panel,item,data,values,advance,listeners,win,visibility:value=>{doc.visibilityState=value;docEvents.get('visibilitychange')?.();},toggle:open=>{const details=root.querySelector('details');details.open=open;details.events.get('toggle')({target:details});},get playerEvents(){return playerEvents;},jump:ms=>time+=ms,setReply:fn=>reply=fn,mount:()=>panel.mount({root,fixtureId:999}),play:async()=>{root.playButton.onclick();await settle();},get time(){return time;},get requests(){return requests;},get destroyed(){return destroyed;},get created(){return created;}};
}

test('renewal preserves the actual player, replay position and unsaved privacy controls',async()=>{
 const h=fixture();h.mount();await settle();await h.play();const iframe=h.root.querySelector('iframe'),privacy=h.root.querySelector('[data-watch-delay]');privacy.value='90';privacy.onchange();
 await h.advance(60000);
 assert.equal(h.requests,2);assert.equal(h.root.querySelector('iframe'),iframe);assert.equal(h.created,1);assert.equal(h.destroyed,0);assert.equal(h.root.querySelector('[data-watch-delay]'),privacy);assert.equal(privacy.value,'90');
 await h.advance(90000);assert.equal(h.root.querySelector('iframe'),iframe,'renewed expiry replaces the original deadline');h.panel.dispose();assert.equal(JSON.parse(h.values.get('matchradar:watch-position:999:abcdefghijk:v1')).seconds,125);
});
test('failed refresh keeps a valid player only until its independent hard expiry and retries are bounded',async()=>{
 const h=fixture();const original=h.data();h.setReply(()=>original);h.mount();await settle();await h.play();h.setReply(()=>{throw Error('offline');});
 await h.advance(119999);assert.ok(h.root.querySelector('iframe'));assert.ok(h.requests<=5);
 await h.advance(1);assert.equal(h.root.querySelector('iframe'),undefined);assert.equal(h.destroyed,1);assert.doesNotMatch(h.root.querySelector('[data-watch-options]').innerHTML,/data-watch-play/);
 await h.advance(60000);assert.ok(h.requests<=8,'no expiry retry storm');h.panel.dispose();
});
test('hung refresh cannot postpone hard expiry and a late response never restarts playback',async()=>{
 const h=fixture();let finish;h.mount();await settle();await h.play();h.setReply(()=>new Promise(resolve=>finish=resolve));
 await h.advance(120000);assert.equal(h.root.querySelector('iframe'),undefined);assert.equal(h.destroyed,1);
 finish(h.data());await settle();assert.equal(h.created,1);assert.equal(h.root.querySelector('iframe'),undefined);h.panel.dispose();
});
test('withdrawal, disabled embedding and replacement video revoke the old player without autoplay',async()=>{
 for(const change of [()=>[],h=>[{...h.item(),embed:false}],h=>[h.item(h.time+120000,'zyxwvutsrqp')]]){
  const h=fixture();h.mount();await settle();await h.play();h.setReply(()=>h.data(change(h)));await h.advance(60000);
  assert.equal(h.destroyed,1);assert.equal(h.created,1);assert.equal(h.root.querySelector('iframe'),undefined);h.panel.dispose();
 }
});
test('country change aborts in-flight renewal and rejects even an abort-ignoring stale response',async()=>{
 const h=fixture();let finish;h.mount();await settle();await h.play();h.setReply(()=>new Promise(resolve=>finish=resolve));await h.advance(60000);
 h.setReply(()=>h.data([]));h.root.querySelector('[data-watch-country]').onchange({target:{value:'KZ'}});await settle();finish(h.data());await settle();
 assert.equal(h.destroyed,1);assert.equal(h.root.querySelector('iframe'),undefined);assert.doesNotMatch(h.root.querySelector('[data-watch-options]').innerHTML,/data-watch-play/);h.panel.dispose();
});
test('dispose rejects late refresh without resurrecting media',async()=>{
 const h=fixture(1000);let finish;h.mount();await settle();await h.play();h.setReply(()=>new Promise(resolve=>finish=resolve));await h.advance(1000);
 assert.equal(h.destroyed,1);h.panel.dispose();finish(h.data());await settle();assert.equal(h.root.nodes.size,0);assert.equal(h.created,1);
});

test('return from a suspended page removes expired media synchronously before awaiting renewal',async()=>{
 const h=fixture();h.mount();await settle();await h.play();h.setReply(()=>new Promise(()=>{}));h.jump(180000);
 h.listeners.get('pageshow')();assert.equal(h.destroyed,1);assert.equal(h.root.querySelector('iframe'),undefined);h.panel.dispose();
});

test('initial watch failure remains visible with one explicit retry and accepts a fresh successful response',async()=>{
  const h=fixture();h.setReply(()=>{throw Error('network down');});h.mount();await settle();
  assert.equal(h.root.hidden,false);assert.match(h.root.innerHTML,/Не удалось проверить источники/);
  assert.equal(h.requests,1);assert.equal(h.root.querySelector('iframe'),undefined);
  h.setReply(()=>h.data());h.root.querySelector('[data-watch-retry]').onclick({currentTarget:h.root.querySelector('[data-watch-retry]')});await settle();
  assert.equal(h.requests,2);assert.ok(h.root.playButton);assert.doesNotMatch(h.root.innerHTML,/Не удалось проверить источники/);h.panel.dispose();
});
test('invalid stored territory can recover on retry without a permanent hidden panel',async()=>{
  const h=fixture();h.values.set('matchradar:watch-country:v1','ZZ');h.setReply(()=>{throw Object.assign(Error('invalid'),{status:400,payload:{code:'WATCH_INPUT_INVALID'}});});
  h.mount();await settle();assert.equal(h.values.get('matchradar:watch-country:v1'),'');assert.match(h.root.innerHTML,/data-watch-retry/);
  h.setReply(()=>h.data([]));h.root.querySelector('[data-watch-retry]').onclick({currentTarget:h.root.querySelector('[data-watch-retry]')});await settle();
  assert.ok(h.root.querySelector('[data-watch-country]'));h.panel.dispose();
});
test('a silent player times out once, preserves the official link and ignores late ready/error events',async()=>{
  const h=fixture(120000,{ready:false});h.mount();await settle();await h.play();const callbacks=h.playerEvents;
  await h.advance(14999);assert.ok(h.root.querySelector('iframe'));
  await h.advance(1);assert.equal(h.destroyed,1);assert.equal(h.root.querySelector('iframe'),undefined);
  assert.match(h.root.querySelector('[data-watch-status]').textContent,/не загрузился/);assert.ok(h.root.externalLink);
  callbacks.onReady();callbacks.onError({data:150});await h.advance(10000);assert.equal(h.destroyed,1);assert.equal(h.created,1);h.panel.dispose();
});
test('ready player survives the loading deadline and SDK errors distinguish embed refusal from local failure',async()=>{
  for(const [code,message] of [[150,'не разрешил'],[153,'недоступен']]){
    const h=fixture();h.mount();await settle();await h.play();await h.advance(15000);assert.ok(h.root.querySelector('iframe'));
    h.playerEvents.onError({data:code});assert.equal(h.destroyed,1);assert.match(h.root.querySelector('[data-watch-status]').textContent,new RegExp(message));h.panel.dispose();
  }
});
test('official link uses Telegram navigation only for a current unexpired item and retains normal fallback',async()=>{
  const opened=[];const h=fixture(120000,{bridge:url=>opened.push(url)});h.mount();await settle();let prevented=0;
  h.root.externalLink.onclick({preventDefault:()=>prevented++});assert.deepEqual(opened,['https://www.youtube.com/watch?v=abcdefghijk']);assert.equal(prevented,1);
  h.jump(120001);h.root.externalLink.onclick({preventDefault:()=>prevented++});assert.equal(opened.length,1);assert.equal(prevented,2);h.panel.dispose();
  for(const bridge of [undefined,()=>{throw Error('bridge not ready');}]){
    const fallback=fixture(120000,{bridge});fallback.mount();await settle();let blocked=false;fallback.root.externalLink.onclick({preventDefault:()=>blocked=true});assert.equal(blocked,false);fallback.panel.dispose();
  }
});
test('a disposed failed request cannot recreate the retry panel',async()=>{
  const h=fixture();let reject;h.setReply(()=>new Promise((_,no)=>reject=no));h.mount();await settle();h.panel.dispose();reject(Error('late failure'));await settle();assert.equal(h.root.hidden,true);assert.equal(h.root.nodes.size,0);
});

test('an initially empty visible open watch panel discovers a later source without autoplay',async()=>{
 const h=fixture();h.setReply(()=>({countries:[],items:[]}));h.mount();await settle();assert.equal(h.requests,1);
 h.setReply(()=>h.data());await h.advance(59999);assert.equal(h.requests,1);
 await h.advance(1);assert.equal(h.requests,2);assert.ok(h.root.playButton);assert.equal(h.created,0);h.panel.dispose();
});
test('empty discovery pauses when collapsed or hidden, then refreshes on return',async()=>{
 const h=fixture();h.setReply(()=>h.data([]));h.mount();await settle();h.toggle(false);
 await h.advance(180000);assert.equal(h.requests,1);
 h.visibility('hidden');await h.advance(180000);h.visibility('visible');await settle();assert.equal(h.requests,1,'returning must not reopen collapsed discovery');
 h.mount();await settle();assert.equal(h.requests,1,'centre rerender must not reopen collapsed discovery');
 h.toggle(true);await settle();assert.equal(h.requests,2);
 h.visibility('hidden');await h.advance(180000);assert.equal(h.requests,2);
 h.setReply(()=>h.data());h.visibility('visible');await settle();assert.equal(h.requests,3);assert.ok(h.root.playButton);assert.equal(h.created,0);h.panel.dispose();
});
test('empty discovery failure stays bounded and disposing prevents further requests',async()=>{
 const h=fixture();h.setReply(()=>h.data([]));h.mount();await settle();h.setReply(()=>{throw Error('offline');});
 await h.advance(180000);assert.equal(h.requests,4);h.panel.dispose();await h.advance(180000);assert.equal(h.requests,4);assert.equal(h.created,0);
});
