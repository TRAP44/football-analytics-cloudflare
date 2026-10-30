import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {KLEAGUE_TV_LIVE_POLICY,validKleagueTvLive,validKleagueTvReplay,kleagueTvLiveValidUntil} from '../src/kleague-watch-policy.js';
import {parseKleagueTvPage,loadKleagueTv,kleagueTvApprovals,KLEAGUE_UPCOMING_PAGE} from '../scripts/kleague-tv-catalogue.js';
import {watchFixtureIdentity,watchApiPayload,watchLibraryPayload,watchCacheKey,WATCH_EXTENDED_LIBRARY_KEY} from '../src/match-watch.js';
import {WATCH_POLICIES} from '../src/match-watch-policy.js';
import {matchCenterCacheKey} from '../src/match-center-cache-key.js';
import {createUserDataApiRuntime} from '../src/user-data-api-runtime.js';
import {refreshMatchWatch} from '../scripts/refresh-match-watch.js';
import {loadWatchFixtureDays} from '../scripts/watch-fixture-days.js';
import {discoverMatchWatch,WATCH_DISCOVERY_KEY} from '../scripts/discover-match-watch.js';
const data=JSON.parse(readFileSync('test-support/fixtures/kleague-upcoming-sources.json'));
const old=JSON.parse(readFileSync('test-support/fixtures/kleague-watch-sources.json'));
const now=Date.parse(data.observedAt),match=data.canonicalMatch,iso=t=>new Date(t).toISOString();
const page=nodes=>`<script id="__NUXT_DATA__">${JSON.stringify(nodes)}</script>`;
const sources=parseKleagueTvPage(page(data.announcedNuxt)),source=sources.find(s=>s.event.home==='Gyeongnam FC');
const policies=WATCH_POLICIES.filter(p=>p.format==='kleague');
function entry(m=match,s=source,clock=now,proof=clock){
 const a=kleagueTvApprovals([{source:s,observedAt:iso(clock)}],[{match:m,observedAt:iso(proof)}],clock,watchFixtureIdentity)[0];
 assert.ok(a);return {match:m,catalogue:{version:1,fixtureIdentity:watchFixtureIdentity(m),items:[{...a,registrationRequired:true,regionVerified:true,checkedAt:iso(clock),expiresAt:a.validUntil,approval:{version:3,policyId:a.policyId,policyRevision:a.policyRevision,confirmed:true,confirmedAt:iso(clock),fixtureIdentity:watchFixtureIdentity(m)}}]}};
}
test('actual announced source and independently verified fixture yield a scheduled external broadcast, never a recording or invented on-air game',()=>{
 assert.equal(sources.length,6);assert.equal(source.publication,'Announced');assert.equal(source.round,null);assert.equal(source.durationSeconds,0);
 assert.equal(validKleagueTvLive(match,source,now,iso(now)),true);assert.equal(validKleagueTvReplay(match,source,now),false);
 const e=entry(),opts={country:'RU',now,approvals:[],scheduledBroadcasts:true},item=watchApiPayload(match,e.catalogue,opts).items[0];
 assert.equal(item.kind,'live');assert.equal(item.scheduled,true);assert.equal(item.embed,false);assert.equal(item.access,'registration');assert.equal(item.availableFrom,match.date);
 const card=watchLibraryPayload({version:1,checkedAt:iso(now),entries:[e]},{...opts,maxEntries:100}).items[0];
 assert.equal(card.upcomingLive,true);assert.equal(card.registrationLive,true);assert.equal(card.embeddedLive,false);assert.doesNotMatch(JSON.stringify(card),/eventUrl|videoId|sourceMetadata|"score"/);
 assert.deepEqual(watchApiPayload(match,e.catalogue,{country:'RU',now,approvals:[]}).items,[],'legacy sessions cannot mistake a new announcement for LIVE');
 assert.deepEqual(watchLibraryPayload({version:1,checkedAt:iso(now),entries:[e]},{country:'RU',now,approvals:[],maxEntries:100}).items,[]);
 for(const patch of [{distribution:'VOD'},{publication:'Disabled'},{payment:'Subscription'},{entitlementsEmpty:false},{freeForEmbed:true},{id:12},{slug:'wrong-match'},{eventUrl:source.eventUrl+'?autoplay=1'},{round:30},{countries:[]},{countries:['US']},{countries:['RU','RU']},{durationSeconds:-1},{durationSeconds:14401},{updatedAt:iso(now+60000)}])assert.equal(validKleagueTvLive(match,{...source,...patch},now,iso(now)),false,JSON.stringify(patch));
 for(const patch of [{season:2025},{leagueId:292},{home:match.away,away:match.home},{date:iso(Date.parse(match.date)+120000)},{status:'PST'},{status:'FT',finished:true}])assert.equal(validKleagueTvLive({...match,...patch},source,now,iso(now)),false,JSON.stringify(patch));
 assert.equal(validKleagueTvLive(match,source,Date.parse(match.date)-48*3600000-1,iso(Date.parse(match.date)-48*3600000-1)),false);
 assert.equal(validKleagueTvLive(match,source,now,iso(now+1)),false);
 for(const blocked of parseKleagueTvPage(page(data.blockedK1Nuxt)))assert.equal(blocked.countries.length,0);
});
test('on-air and near-start options require recent independent sporting proof and cannot be renewed by fresh page metadata alone',()=>{
 // Explicit clock/status simulation of the later on-air transition; not an
 // observation that this future broadcast has started or was played.
 const clock=Date.parse(match.date)+45*60000,m={...match,status:'1H',live:true},s={...source,publication:'Live'};
 assert.equal(validKleagueTvLive(m,s,clock,iso(clock-20*60000)),true);
 assert.equal(validKleagueTvLive(m,s,clock,iso(clock-35*60000)),false);
 assert.equal(validKleagueTvLive({...m,status:'FT',finished:true},s,clock,iso(clock)),false);
 assert.equal(kleagueTvLiveValidUntil(m,iso(clock),iso(clock-20*60000),clock),clock+15*60000);
 const e=entry(m,s,clock,clock-20*60000),opts={country:'RU',now:clock,approvals:[],scheduledBroadcasts:true};assert.equal(watchApiPayload(m,e.catalogue,opts).items[0].scheduled,false);
 assert.equal(watchApiPayload(m,e.catalogue,{...opts,now:clock+15*60000}).available,false);
 const ns=entry({...m,status:'NS',live:false},s,clock,clock);assert.equal(watchApiPayload(ns.match,ns.catalogue,opts).items[0].scheduled,true,'a source page must not turn an NS sporting snapshot into on-air');
 const near=Date.parse(match.date)-10*60000;assert.equal(validKleagueTvLive(match,source,near,iso(now)),false);
 assert.equal(validKleagueTvLive(match,{...source,publication:'Live'},now,iso(now)),false,'Live publication cannot advertise on-air days early');
});
test('HTTP capability is explicit on both list and detail; auth, disabled feature and invalid capabilities still fail before reads',async t=>{
 t.mock.method(Date,'now',()=>now);let reads=0;const e=entry(),index={version:1,checkedAt:iso(now),entries:[e]};
 const api=createUserDataApiRuntime(new Proxy({json:(b,s=200)=>Response.json(b,{status:s}),watchApprovals:[],watchPolicies:WATCH_POLICIES,hasSupabase:()=>false,getCache:async key=>{reads++;return key===WATCH_EXTENDED_LIBRARY_KEY?index:key===matchCenterCacheKey(match.fixtureId)?{match}:key===watchCacheKey(match.fixtureId)?e.catalogue:null;}},{get:(o,k)=>k in o?o[k]:async()=>[]}));
 const req=q=>new Request('https://local.test/api/match-watch?'+q),user={id:42};
 assert.equal((await api.apiMatchWatch(req('list=1&cap=scheduled-v1'),{},null)).status,401);
 for(const cap of ['bad','','scheduled-v1&cap=scheduled-v1'])assert.equal((await api.apiMatchWatch(req('list=1&cap='+cap),{},user)).status,400);
 assert.equal((await(await api.apiMatchWatch(req('list=1&limit=100&cap=scheduled-v1'),{matchWatchEnabled:false},user)).json()).available,false);assert.equal(reads,0);
 for(const suffix of [`fixtureId=${match.fixtureId}&country=RU`,'list=1&limit=100&country=RU']){
  assert.equal((await(await api.apiMatchWatch(req(suffix),{},user)).json()).items.length,0);
  const modern=await(await api.apiMatchWatch(req(suffix+'&cap=scheduled-v1'),{},user)).json();assert.equal(modern.items.length,1);
 }
});
function sourceHarness(){
 const cache=new Map(),calls=[];let mode='ok';
 const readCache=async()=>{const row=cache.get('match-watch-kleaguetv:v1');return row?[{cache_key:'match-watch-kleaguetv:v1',payload:row}]:[];};
 const writeCache=async(key,_id,payload)=>{if(mode==='unknown')throw Error('unknown write');cache.set(key,structuredClone(payload));};
 const fetchImpl=async(url,init)=>{calls.push(url);assert.deepEqual(Object.keys(init.headers),['Accept']);assert.equal(init.redirect,'error');
  assert.ok(cache.get('match-watch-kleaguetv:v1').failed,'attempt persisted before I/O');
  if(mode==='fail-announced'&&url===KLEAGUE_UPCOMING_PAGE||mode==='withdraw-partial'&&url.endsWith('/page/home'))return new Response('unavailable',{status:503});
  const nodes=url===KLEAGUE_UPCOMING_PAGE?mode==='withdraw-partial'?[{items:1},[]]:data.announcedNuxt:url.endsWith('/page/home')?old.homeNuxt:old.detailNuxt;
  return new Response(page(nodes));};
 return {cache,calls,mode:value=>{mode=value;},run:async clock=>{const report={};const entries=await loadKleagueTv({fetchImpl,readCache,writeCache,now:clock,signal:new AbortController().signal,report});return {entries,report};}};
}
test('bounded public discovery reads announcements before related VOD, preserves recordings, honors known withdrawal and never refreshes failed source proof',async()=>{
 const h=sourceHarness(),first=await h.run(now);assert.equal(h.calls[1],KLEAGUE_UPCOMING_PAGE);assert.equal(first.report.kleagueTvRequests,3);assert.equal(first.entries.filter(e=>e.source.distribution==='Live').length,6);
 assert.equal(kleagueTvApprovals(first.entries,old.matches.map(m=>({match:m,observedAt:iso(now)})),now,watchFixtureIdentity).filter(a=>a.kind==='replay').length,8);
 h.mode('fail-announced');const failure=await h.run(now+15*60000);assert.ok(failure.entries.filter(e=>e.source.distribution==='Live').every(e=>e.observedAt===iso(now)));
 const expired=await h.run(now+30*60000);assert.equal(expired.entries.filter(e=>e.source.distribution==='Live').length,0);
 const withdrawn=sourceHarness();await withdrawn.run(now);withdrawn.mode('withdraw-partial');const result=await withdrawn.run(now+15*60000);assert.equal(result.entries.filter(e=>e.source.distribution==='Live').length,0,'positive empty upcoming page overrides retention after an unrelated home failure');
 const unknown=sourceHarness();unknown.mode('unknown');await assert.rejects(unknown.run(now));assert.equal(unknown.calls.length,0);
 const near=sourceHarness(),clock=Date.parse(match.date)-25*60000;await near.run(clock);await near.run(clock+5*60000);assert.equal(near.calls.length,6,'near-start page rights revalidate every five minutes');
});
function dateHarness(initialUsage=0){
 const cache=new Map(),calls=[];let clock=now,status='NS';const env={SUPABASE_URL:'https://nlmvhkjkpgzzlfavaohk.supabase.co',SUPABASE_SECRET_KEY:'fixture-db',API_FOOTBALL_KEY:'fixture-football'};
 const coverage=[292,293];if(initialUsage)cache.set('match-watch-fixture-days:v1',{version:1,coverage:coverage.join(','),attempts:{},usage:{day:iso(now).slice(0,10),requests:initialUsage}});
 const readCache=async params=>{const f=params.cache_key,keys=f.startsWith('eq.')?[f.slice(3)]:f.slice(4,-1).split(',');return keys.flatMap(k=>cache.has(k)?[{cache_key:k,payload:structuredClone(cache.get(k))}]:[]);};
 const writeCache=async(k,_id,p)=>{cache.set(k,structuredClone(p));};
 const fetchImpl=async(url,init)=>{url=new URL(url);calls.push(url);if(url.pathname.includes('/football-relay/'))return Response.json({errors:[],response:[{fixture:{id:match.fixtureId,date:match.date,status:{short:status}},teams:{home:match.home,away:match.away},league:{id:293,name:match.league,season:2026,round:match.round},goals:match.score}]});return Response.json(init.method==='POST'?{allowed:true}:[]);};
 return {cache,calls,run:async(time,hints=[match.date])=>{clock=time;const report={};const fixtures=await loadWatchFixtureDays({videos:[],policies,env,fetchImpl,now:clock,readCache,writeCache,report,signal:new AbortController().signal,fixtureHints:hints,broadcastHints:hints});return {fixtures,report};},status:value=>{status=value;},providerCalls:()=>calls.filter(u=>u.pathname.includes('/football-relay/')).length};
}
test('a verified event inside 48h can load UTC day+2 without resetting the existing daily usage',async()=>{
 const h=dateHarness(15),r=await h.run(now);assert.equal(r.report.fixtureRequests,1);assert.equal(r.report.fixtureDailyBudgetRemaining,0);assert.equal(r.fixtures[0].match.fixtureId,match.fixtureId);
 assert.equal(h.calls.find(u=>u.pathname.includes('/football-relay/')).searchParams.get('date'),'2026-10-31');
 await h.run(now+60000,['2026-10-30T05:00:00Z']);assert.equal(h.providerCalls(),1);assert.equal(h.cache.get('match-watch-fixture-days:v1').usage.requests,16);
});
test('tenth date can evict only a nonempty completed past-day marker; future, empty and unfinished days defer without spending quota',async()=>{
 for(const type of ['completed','empty','future','unfinished']){
  const h=dateHarness(3),attempts=Object.fromEntries(Array.from({length:9},(_,i)=>[iso(Date.parse('2026-10-22T00:00:00Z')+i*86400000).slice(0,10),iso(now-3*3600000)]));
  h.cache.set('match-watch-fixture-days:v1',{version:1,coverage:'292,293',attempts,usage:{day:'2026-10-29',requests:3}});
  const day=type==='future'?'2026-10-30':'2026-10-22',m={...match,fixtureId:900001,date:day+'T05:00:00Z',status:type==='unfinished'?'NS':'FT',finished:type!=='unfinished'};
  h.cache.set(`match-watch-fixtures:${day}:v1`,{version:1,date:day,leagueIds:[292,293],checkedAt:iso(now-3600000),matches:type==='empty'?[]:[m]});
  const r=await h.run(now);assert.equal(h.providerCalls(),type==='completed'?1:0,type);
  const state=h.cache.get('match-watch-fixture-days:v1');assert.ok(Object.keys(state.attempts).length<=9);assert.equal(state.version,1);assert.equal(state.usage.requests,type==='completed'?4:3);
  if(type!=='completed')assert.equal(r.report.fixtureSource,'marker_capacity');
 }
});
test('near-start canonical day refreshes at thirty minutes; exhausted budget cannot manufacture fresh on-air proof',async()=>{
 const h=dateHarness(),start=Date.parse(match.date)-15*60000;await h.run(start);h.status('1H');await h.run(start+30*60000);assert.equal(h.providerCalls(),2);
 await h.run(start+40*60000);assert.equal(h.providerCalls(),2);
 const state=h.cache.get('match-watch-fixture-days:v1');state.usage.requests=16;
 const r=await h.run(start+66*60000);assert.equal(h.providerCalls(),2);assert.equal(r.report.fixtureSource,'daily_budget');
 assert.equal(validKleagueTvLive(r.fixtures[0].match,{...source,publication:'Live'},start+66*60000,r.fixtures[0].observedAt),false);
});
test('old or undated center rows do not overwrite newly fetched sporting proof with an artificial current timestamp',async()=>{
 const clock=Date.parse(match.date)+2*3600000,finished={...match,status:'FT',finished:true};
 for(const sourceTime of [iso(clock-3600000),undefined,iso(clock+60000)]){
  const readCache=async params=>params.cache_key.startsWith('like.')?[{cache_key:matchCenterCacheKey(match.fixtureId),payload:{match},...(sourceTime?{source_updated_at:sourceTime}:{})}]:[];
  const r=await discoverMatchWatch({readCache,writeCache:async()=>{},youtube:async()=>[],approvals:[],policies:[policies[0]],now:clock,report:{},loadFixtureDays:async()=>[{match:finished,observedAt:iso(clock-1000)}]});
  const result=r.fixtures.find(v=>v.match.fixtureId===match.fixtureId);assert.equal(result.match.status,'FT');assert.equal(result.observedAt,iso(clock-1000));
 }
});
test('real refresh pipeline adds the independently verified scheduled fixture while preserving all eight existing external recordings',async()=>{
 const cache=new Map(),calls=[];let clock=now;
 const matches=[...old.matches,match],videos=old.videos;
 const env={SUPABASE_URL:'https://nlmvhkjkpgzzlfavaohk.supabase.co',SUPABASE_SECRET_KEY:'fixture-db',YOUTUBE_DATA_API_KEY:'fixture-youtube',API_FOOTBALL_KEY:'fixture-football'};
 const fetchImpl=async(value,init)=>{
  const url=new URL(value);calls.push(url);
  if(url.hostname==='tv.kleague.com')return new Response(page(value===KLEAGUE_UPCOMING_PAGE?data.announcedNuxt:url.pathname.endsWith('/page/home')?old.homeNuxt:old.detailNuxt));
  if(url.hostname==='www.googleapis.com'){
   if(url.pathname.endsWith('/playlistItems'))return Response.json({items:videos.map(v=>({contentDetails:{videoId:v.id}}))});
   assert.ok(url.pathname.endsWith('/videos'));return Response.json({items:videos.filter(v=>url.searchParams.get('id').split(',').includes(v.id))});
  }
  if(url.pathname.includes('/football-relay/'))return Response.json({errors:[],response:matches.filter(m=>m.date.startsWith(url.searchParams.get('date'))).map(m=>({fixture:{id:m.fixtureId,date:m.date,status:{short:m.status}},teams:{home:m.home,away:m.away},league:{id:m.leagueId,name:m.league,season:m.season,round:m.round},goals:m.score}))});
  if(url.pathname.endsWith('/claim_provider_request'))return Response.json({allowed:true});
  if(url.pathname.endsWith('/write_analysis_cache_versioned')){const b=JSON.parse(init.body);cache.set(b.p_cache_key,{cache_key:b.p_cache_key,payload:b.p_payload,expiresAt:Date.parse(b.p_expires_at)});return Response.json({stored:true,reason:'stored'});}
  assert.equal(url.pathname,'/rest/v1/analysis_cache');const filter=url.searchParams.get('cache_key');if(filter.startsWith('like.')||filter.startsWith('in.(provider-state:'))return Response.json([]);
  const keys=filter.startsWith('eq.')?[filter.slice(3)]:filter.slice(4,-1).split(',');return Response.json(keys.flatMap(k=>{const row=cache.get(k);return row&&row.expiresAt>clock?[{cache_key:k,payload:row.payload}]:[];}));
 };
 let report;for(let i=0;i<4;i++){clock=now+i*300000;report=await refreshMatchWatch({env,fetchImpl,now:clock,automatic:true,policies,manifest:{version:1,items:[]}});}
 assert.equal(report.externalItems.filter(i=>i.kind==='replay').length,8);assert.equal(report.externalItems.filter(i=>i.kind==='live').length,1);
 assert.equal(report.libraryByCountry.RU.upcomingBroadcastMatches,1);assert.equal(report.libraryByCountry.RU.onAirBroadcastMatches,0);assert.equal(report.libraryByCountry.RU.registrationReplayMatches,8);
 const e=cache.get(watchCacheKey(match.fixtureId)).payload;assert.equal(watchApiPayload(match,e,{country:'RU',now:clock,approvals:[],scheduledBroadcasts:true}).items[0].scheduled,true);
 assert.equal(watchApiPayload(match,e,{country:'RU',now:clock,approvals:[]}).items.length,0);
 assert.ok((report.kleagueTvRequests||0)<=4);assert.ok((report.fixtureRequests||0)<=2);assert.ok(calls.some(u=>u.pathname.includes('/football-relay/')&&u.searchParams.get('date')==='2026-10-31'));
});
