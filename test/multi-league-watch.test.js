import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {WATCH_POLICIES,automaticWatchMatch,automaticHighlightsMatch,automaticHighlightsEvidence,automaticReplayEvidence,youtubeWatchCountries} from '../src/match-watch-policy.js';
import {watchLibraryPayload,watchFixtureIdentity,watchApiPayload,WATCH_LIBRARY_KEY,WATCH_EXTENDED_LIBRARY_KEY} from '../src/match-watch.js';
import {refreshMatchWatch} from '../scripts/refresh-match-watch.js';
import {loadWatchFixtureDays} from '../scripts/watch-fixture-days.js';
import {createUserDataApiRuntime} from '../src/user-data-api-runtime.js';
const recorded=JSON.parse(readFileSync('test-support/fixtures/watch-source-expansion.json','utf8'));
const now=Date.parse('2026-10-27T14:00:00Z');
function accepted(video,match,policy){
 const highlight=automaticHighlightsMatch(policy,match,video.snippet.title,video.snippet.publishedAt,now,video.snippet.description)&&automaticHighlightsEvidence(video.contentDetails.duration,video.snippet.liveBroadcastContent,video.liveStreamingDetails,policy.maxHighlightsSeconds);
 const replay=automaticWatchMatch(policy,match,video.snippet.title,video.liveStreamingDetails?.scheduledStartTime,now,'replay')&&automaticReplayEvidence(match,video.liveStreamingDetails?.actualStartTime,video.liveStreamingDetails?.actualEndTime,now);
 return highlight?'highlights':replay?'replay':null;
}
test('recorded official full recordings and summaries match independent canonical league/category/date/season/result evidence',()=>{
 const examples=[['QiHGm59LNLQ',1593691,'replay'],['EduRmg4NgOg',1632112,'replay'],['X3zUSLPwUO0',1593689,'highlights'],['rj12dhsw2VM',1603475,'highlights'],['xnJWW1HOpKo',1603476,'highlights'],['2__euNO_niw',1570431,'highlights'],['R2mVF13WhLc',1570426,'highlights'],['JAjW2u5u4DE',1550161,'highlights']];
 for(const [vid,id,kind] of examples){
  const video=recorded.videos.find(v=>v.id===vid),match=recorded.matches.find(m=>m.fixtureId===id),policy=WATCH_POLICIES.find(p=>p.channelId===video.snippet.channelId&&p.leagueId===match.leagueId);
  assert.equal(accepted(video,match,policy),kind,vid);
  for(const patch of [{leagueId:9999},{season:2025},{home:match.away,away:match.home},{finished:false,status:'NS'}])assert.equal(accepted(video,{...match,...patch},policy),null,vid+JSON.stringify(patch));
  if(['aleagues','laliga'].includes(policy.format))assert.equal(accepted(video,{...match,round:'Regular Season - 99'},policy),null,vid);
  if(['spl','laliga','seriea'].includes(policy.format))assert.equal(accepted(video,{...match,score:{home:99,away:98}},policy),null,vid);
 }
 const men=WATCH_POLICIES.find(p=>p.id==='aleagues-men'),women=recorded.matches.find(m=>m.fixtureId===1632112),v=recorded.videos.find(v=>v.id==='EduRmg4NgOg');
 assert.equal(accepted(v,{...women,leagueId:188},men),null,'same club stems must not cross gender/category');
 const bad=recorded.videos.find(v=>v.id==='yNzTRl-FvIQ'),atalanta=recorded.matches.find(m=>m.fixtureId===1550157),serie=WATCH_POLICIES.find(p=>p.format==='seriea');
 assert.equal(accepted(bad,atalanta,serie),null,'actual title/description contradiction must be rejected');
});
test('actual country restrictions and genre prevent blocked recordings, press conferences and weekly shows being advertised as full matches',()=>{
 const blocked=recorded.videos.find(v=>v.id==='k6zMyNIr4UQ');assert.deepEqual(youtubeWatchCountries(blocked,['RU','KZ','BY']),['KZ','BY']);
 for(const video of recorded.videos.filter(v=>/RUEDA DE PRENSA|PREVIA DEL PARTIDO|ELCLÁSICO en DIRECTO|Highlights Show|Kicking Back/.test(v.snippet.title))){
  for(const policy of WATCH_POLICIES.filter(p=>p.channelId===video.snippet.channelId))for(const match of recorded.matches)assert.equal(accepted(video,match,policy),null,video.snippet.title);
 }
});
function harness(){
 const cache=new Map(),calls=[];let current=now,footballStatus=null,deny=false,unknownMarker=false,lastSlot=null;
 const env={SUPABASE_URL:'https://nlmvhkjkpgzzlfavaohk.supabase.co',SUPABASE_SECRET_KEY:'fixture-database-key',YOUTUBE_DATA_API_KEY:'fixture-youtube-key',API_FOOTBALL_KEY:'fixture-football-key'};
 const fetchImpl=async(input,options)=>{
  const url=new URL(input);calls.push({url,options});assert.equal(options.redirect,'error');
  if(url.origin==='https://www.googleapis.com'){
   assert.equal(options.headers['X-Goog-Api-Key'],env.YOUTUBE_DATA_API_KEY);assert.equal(options.headers.apikey,undefined);assert.equal(options.headers['x-apisports-key'],undefined);
   if(url.pathname.endsWith('/search'))return Response.json({items:[]});
   if(url.pathname.endsWith('/playlistItems')){const channel='UC'+url.searchParams.get('playlistId').slice(2);assert.equal(url.searchParams.get('maxResults'),'50');return Response.json({items:recorded.videos.filter(v=>v.snippet.channelId===channel).map(v=>({contentDetails:{videoId:v.id}}))});}
   assert.ok(url.pathname.endsWith('/videos'));const ids=url.searchParams.get('id').split(',');assert.ok(ids.length<=50);return Response.json({items:recorded.videos.filter(v=>ids.includes(v.id))});
  }
  assert.equal(url.origin,env.SUPABASE_URL);assert.equal(options.headers['X-Goog-Api-Key'],undefined);
  if(url.pathname.includes('/football-relay/')){
   assert.equal(options.headers['x-apisports-key'],env.API_FOOTBALL_KEY);assert.equal(options.headers.apikey,undefined);assert.equal(url.searchParams.get('timezone'),'UTC');assert.equal(url.searchParams.has('id'),false);
   return Response.json({errors:[],response:recorded.matches.filter(m=>m.date.startsWith(url.searchParams.get('date'))).map(m=>({fixture:{id:m.fixtureId,date:m.date,status:{short:footballStatus||m.status}},teams:{home:m.home,away:m.away},league:{id:m.leagueId,name:m.league,season:m.season,round:m.round},goals:m.score}))});
  }
  assert.equal(options.headers.apikey,env.SUPABASE_SECRET_KEY);assert.equal(options.headers['x-apisports-key'],undefined);
  if(url.pathname.endsWith('/claim_provider_request')){assert.equal(options.method,'POST');const body=JSON.parse(options.body);if(body.p_bucket_key==='match-watch:refresh'){assert.deepEqual(body,{p_bucket_key:'match-watch:refresh',p_limit:1,p_window_seconds:300});const slot=Math.floor(current/300000),allowed=lastSlot!==slot;if(allowed)lastSlot=slot;return Response.json({allowed});}assert.deepEqual(body,{p_bucket_key:'api-football:minute',p_limit:4,p_window_seconds:60});return Response.json({allowed:!deny});}
  if(url.pathname.endsWith('/write_analysis_cache_versioned')){
   const b=JSON.parse(options.body);if(unknownMarker&&b.p_cache_key==='match-watch-fixture-days:v1')throw Error('unknown write');
   const prev=cache.get(b.p_cache_key);if(prev&&prev.updatedAt>=b.p_updated_at)return Response.json({stored:false,reason:'superseded'});
   cache.set(b.p_cache_key,{cache_key:b.p_cache_key,payload:b.p_payload,updatedAt:b.p_updated_at,expiresAt:Date.parse(b.p_expires_at)});return Response.json({stored:true,reason:'stored'});
  }
  assert.equal(url.pathname,'/rest/v1/analysis_cache');const filter=url.searchParams.get('cache_key');
  if(filter.startsWith('in.(provider-state:'))return Response.json([]);
  if(filter.startsWith('like.'))return Response.json([]);
  const keys=filter.startsWith('eq.')?[filter.slice(3)]:filter.startsWith('in.(')?filter.slice(4,-1).split(','):[];
  return Response.json(keys.flatMap(key=>{const row=cache.get(key);return row&&row.expiresAt>current?[{cache_key:key,payload:row.payload}]:[];}));
 };
 const run=async offset=>{current=now+offset;return refreshMatchWatch({env,fetchImpl,manifest:{version:1,items:[]},automatic:true,policies:WATCH_POLICIES.filter(policy=>policy.format!=='kleague'),now:current});};
 return {cache,calls,env,fetchImpl,run,setTime:value=>{current=value;},deny:()=>{deny=true;},unknownMarker:()=>{unknownMarker=true;},providerStatus:value=>{footballStatus=value;}};
}
let prepared;
async function prepare(){if(prepared)return prepared;const h=harness();let report;for(let i=0;i<4;i++)report=await h.run(i*300000);prepared={h,report};return prepared;}
test('real refresh pipeline bootstraps multiple date batches without visits or per-match approvals and publishes correct country-specific kinds',async()=>{
 const {h,report}=await prepare();assert.ok(report.libraryMatches>=15);assert.ok(report.libraryByCountry.RU.matches>=14);assert.ok(report.libraryByCountry.RU.fullReplayMatches>=3);assert.equal(report.libraryByCountry.RU.liveMatches,0);
 const entries=h.cache.get(WATCH_EXTENDED_LIBRARY_KEY).payload.entries;
 const phoenix=entries.find(e=>e.match.fixtureId===1593690);assert.ok(phoenix);assert.deepEqual(watchApiPayload(phoenix.match,phoenix.catalogue,{country:'RU',now:now+900000,approvals:[]}).items.map(v=>v.kind),['highlights']);
 assert.ok(watchApiPayload(phoenix.match,phoenix.catalogue,{country:'KZ',now:now+900000,approvals:[]}).items.some(v=>v.kind==='replay'));
 assert.ok(report.automaticItems.every(v=>v.countries.length&&typeof v.embeddable==='boolean'));
 const queries=h.calls.filter(c=>c.url.pathname.includes('/football-relay/'));assert.ok(queries.length<=8);assert.ok(queries.length<report.libraryMatches);assert.equal(new Set(queries.map(c=>c.url.searchParams.get('date'))).size,queries.length,'finished evidence dates must not be fetched repeatedly');
 assert.ok(h.cache.get(WATCH_LIBRARY_KEY).payload.entries.length<=20);assert.ok(h.cache.get(WATCH_LIBRARY_KEY).payload.entries.every(entry=>entry.catalogue.items.every(item=>item.approval.version===1||item.publisher==='jleagueinternational')));
 assert.ok([...h.calls].filter(c=>c.url.hostname==='www.googleapis.com').every(c=>!c.url.searchParams.has('key')));
});
test('extended library performs one strong read; default legacy contract remains bounded and cache-only',async t=>{
 const {h}=await prepare();t.mock.method(Date,'now',()=>now+900000);let reads=0;
 const api=createUserDataApiRuntime(new Proxy({watchApprovals:[],watchPolicies:WATCH_POLICIES,json:(data,status=200)=>Response.json(data,{status}),hasSupabase:()=>true,supaSelectOne:async(_cfg,table,params)=>{reads++;assert.equal(table,'analysis_cache');assert.equal(params.limit,1);const row=h.cache.get(params.cache_key.slice(3));return row?{cache_key:row.cache_key,payload:row.payload,expires_at:new Date(row.expiresAt).toISOString()}:null;}},{get:(obj,key)=>key in obj?obj[key]:async()=>[]}));
 const response=await api.apiMatchWatch(new Request('https://local.test/api/match-watch?list=1&limit=100&country=RU'),{},{id:42});assert.equal(response.status,200);assert.ok((await response.json()).items.length>=14);assert.equal(reads,1);
 const bad=await api.apiMatchWatch(new Request('https://local.test/api/match-watch?list=1&limit=9999&country=RU'),{},{id:42});assert.equal(bad.status,400);assert.equal(reads,1);
 const none=await api.apiMatchWatch(new Request('https://local.test/api/match-watch?list=1&limit=100&country=RU'),{},null);assert.equal(none.status,401);assert.equal(reads,1);
});
test('unknown fixture attempt write stops before provider/claim; denial cannot invent sporting state',async()=>{
 const h=harness();h.unknownMarker();
 await assert.rejects(loadWatchFixtureDays({videos:recorded.videos,policies:WATCH_POLICIES,env:h.env,fetchImpl:h.fetchImpl,now,readCache:async()=>[],writeCache:async()=>{throw Object.assign(Error('unknown'),{code:'WATCH_WRITE_UNCONFIRMED'});},report:{},signal:new AbortController().signal}),e=>e.code==='WATCH_WRITE_UNCONFIRMED');
 assert.equal(h.calls.length,0);
 const denied=harness();denied.deny();const report=await denied.run(0);assert.equal(report.fixtureRequests||0,0);assert.equal(report.fixtureSource,'deferred');assert.equal(report.published,0);
});
test('100-match extended payload stays bounded and 50 isolated consumer evaluations keep a fixed single-record workload',async()=>{
 const {h}=await prepare(),base=h.cache.get(WATCH_EXTENDED_LIBRARY_KEY).payload,entry=base.entries[0];
 const entries=Array.from({length:100},(_,i)=>{const e=structuredClone(entry);e.match.fixtureId=900000+i;e.catalogue.fixtureIdentity=watchFixtureIdentity(e.match);for(const item of e.catalogue.items)item.approval.fixtureIdentity=e.catalogue.fixtureIdentity;return e;});
 const large={...base,entries},options={now:now+900000,country:'RU',approvals:[],maxEntries:100};
 assert.equal(watchLibraryPayload(large,options).items.length,100);assert.equal(watchLibraryPayload(large,{...options,maxEntries:20}).items.length,0);assert.equal(watchLibraryPayload({...large,entries:[...entries,entries[0]]},options).items.length,0);
 const start=performance.now();for(let i=0;i<50;i++)assert.equal(watchLibraryPayload(large,options).items.length,100);
 console.log(JSON.stringify({scope:'isolated_node_consumer_not_production_latency',requests:50,matchesPerPayload:100,totalMs:Math.round((performance.now()-start)*10)/10}));
});

test('ended stream evidence triggers timely canonical refresh without synthesizing FT from video metadata',async()=>{
 for(const providerStatus of ['FT','1H']){
  const h=harness(),original=recorded.matches.find(m=>m.fixtureId===1593691),originalVideo=recorded.videos.find(v=>v.id==='QiHGm59LNLQ'),delta=now-150*60000-Date.parse(original.date);
  const match={...original,date:new Date(Date.parse(original.date)+delta).toISOString(),status:'NS',finished:false};
  const video=structuredClone(originalVideo);for(const key of Object.keys(video.liveStreamingDetails))video.liveStreamingDetails[key]=new Date(Date.parse(video.liveStreamingDetails[key])+delta).toISOString();video.snippet.publishedAt=new Date(now-60000).toISOString();
  const date=match.date.slice(0,10),coverage=[...new Set(WATCH_POLICIES.map(p=>p.leagueId))].sort((a,b)=>a-b),at=new Date(now-30*60000).toISOString(),state={version:1,coverage:coverage.join(','),attempts:{[date]:at},usage:{day:date,requests:1}};
  const snapshot={version:1,date,leagueIds:coverage,checkedAt:at,matches:[match]};let providerCalls=0,writes=0;
  const report={};const result=await loadWatchFixtureDays({videos:[video],policies:WATCH_POLICIES,env:h.env,now,report,signal:new AbortController().signal,readCache:async p=>p.cache_key.startsWith('eq.')?[{cache_key:'match-watch-fixture-days:v1',payload:state}]:Array.from({length:3},(_,i)=>{const day=new Date(Date.parse(date+'T00:00:00Z')-i*86400000).toISOString().slice(0,10);return {cache_key:`match-watch-fixtures:${day}:v1`,payload:i?{...snapshot,date:day,matches:[]}:snapshot};}),writeCache:async()=>{writes++;},fetchImpl:async(input,options)=>{
   const url=new URL(input);if(url.pathname.includes('/football-relay/')){providerCalls++;return Response.json({errors:[],response:[{fixture:{id:match.fixtureId,date:match.date,status:{short:providerStatus}},teams:{home:match.home,away:match.away},league:{id:match.leagueId,name:match.league,season:match.season,round:match.round},goals:match.score}]});}
   return h.fetchImpl(input,options);
  }});
  assert.equal(providerCalls,1);assert.equal(writes,2);assert.equal(result.find(x=>x.match.fixtureId===match.fixtureId).match.finished,providerStatus==='FT');assert.equal(report.fixtureDailyBudgetRemaining,14);
 }
});
test('fixture discovery daily cap preserves existing snapshots and cannot spend more provider quota',async()=>{
 const h=harness(),coverage=[...new Set(WATCH_POLICIES.map(p=>p.leagueId))].sort((a,b)=>a-b).join(','),report={};
 const result=await loadWatchFixtureDays({videos:recorded.videos,policies:WATCH_POLICIES,env:h.env,now,report,signal:new AbortController().signal,readCache:async p=>p.cache_key.startsWith('eq.')?[{cache_key:'match-watch-fixture-days:v1',payload:{version:1,coverage,attempts:{},usage:{day:'2026-10-27',requests:16}}}]:[],writeCache:async()=>assert.fail('budget exhausted before writes'),fetchImpl:()=>assert.fail('budget exhausted before network')});
 assert.deepEqual(result,[]);assert.equal(report.fixtureSource,'daily_budget');assert.equal(report.fixtureDailyBudgetRemaining,0);
});

test('50 authenticated viewers coalesce the public extended snapshot while country, expiry, kill and auth checks remain per request',async t=>{
 const {h}=await prepare();let clock=now+900000,reads=0,index=h.cache.get(WATCH_EXTENDED_LIBRARY_KEY).payload;t.mock.method(Date,'now',()=>clock);t.mock.method(performance,'now',()=>clock);
 const api=createUserDataApiRuntime(new Proxy({watchApprovals:[],watchPolicies:WATCH_POLICIES,json:(data,status=200)=>Response.json(data,{status}),hasSupabase:()=>true,supaSelectOne:async(_cfg,_table,params)=>{reads++;assert.equal(params.cache_key,`eq.${WATCH_EXTENDED_LIBRARY_KEY}`);await new Promise(r=>setTimeout(r,5));return {cache_key:WATCH_EXTENDED_LIBRARY_KEY,payload:index,expires_at:new Date(now+2700000).toISOString()};}},{get:(obj,key)=>key in obj?obj[key]:async()=>[]}));
 const request=(country='RU')=>new Request('https://local.test/api/match-watch?list=1&limit=100&country='+country);
 const bodies=await Promise.all(Array.from({length:50},async(_,i)=>(await api.apiMatchWatch(request(i%2?'KZ':'RU'),{supabaseUrl:'https://fixture.supabase.co'},{id:i+1})).json()));
 assert.equal(reads,1);assert.ok(bodies.every((body,i)=>body.country===(i%2?'KZ':'RU')&&body.items.length>=14&&!JSON.stringify(body).includes('fixture-database-key')));assert.ok(!bodies[0].items.find(item=>item.fixtureId===1593690).kinds.includes('replay'));assert.ok(bodies[1].items.find(item=>item.fixtureId===1593690).kinds.includes('replay'));
 assert.equal((await api.apiMatchWatch(request(),{matchWatchEnabled:false,supabaseUrl:'https://fixture.supabase.co'},{id:42})).status,200);assert.equal((await api.apiMatchWatch(request(),{supabaseUrl:'https://fixture.supabase.co'},null)).status,401);assert.equal(reads,1);
 index={...index,entries:[]};clock+=3001;assert.equal((await (await api.apiMatchWatch(request(),{supabaseUrl:'https://fixture.supabase.co'},{id:42})).json()).items.length,0);assert.equal(reads,2);
});

test('duplicate clock/manual refresh in the same database window performs only its atomic claim',async()=>{
 const h=harness();await h.run(0);const count=h.calls.length,old=structuredClone(h.cache.get(WATCH_EXTENDED_LIBRARY_KEY).payload);
 const report=await h.run(1000);assert.equal(report.skipped,'refresh_interval');assert.equal(report.published,0);assert.equal(report.youtubeRequests,0);assert.equal(report.cacheWrites,0);assert.equal(h.calls.length,count+1);assert.equal(h.calls.at(-1).url.pathname,'/rest/v1/rpc/claim_provider_request');assert.deepEqual(h.cache.get(WATCH_EXTENDED_LIBRARY_KEY).payload,old);
});
test('extended snapshot failure is a retryable error and cannot poison the shared cache with a false empty generation',async t=>{
 const {h}=await prepare();t.mock.method(Date,'now',()=>now+900000);let failing=true,reads=0;
 const api=createUserDataApiRuntime(new Proxy({watchApprovals:[],watchPolicies:WATCH_POLICIES,json:(data,status=200)=>Response.json(data,{status}),hasSupabase:()=>true,supaSelectOne:async()=>{reads++;if(failing)throw Error('private database diagnostic');return {cache_key:WATCH_EXTENDED_LIBRARY_KEY,payload:h.cache.get(WATCH_EXTENDED_LIBRARY_KEY).payload,expires_at:new Date(now+2700000).toISOString()};}},{get:(obj,key)=>key in obj?obj[key]:async()=>[]}));
 const request=()=>new Request('https://local.test/api/match-watch?list=1&limit=100&country=RU');
 const failed=await api.apiMatchWatch(request(),{},{id:42});assert.equal(failed.status,503);assert.ok(!JSON.stringify(await failed.json()).includes('private database diagnostic'));
 failing=false;const recovered=await api.apiMatchWatch(request(),{},{id:42});assert.equal(recovered.status,200);assert.ok((await recovered.json()).items.length>=14);assert.equal(reads,2);
});
