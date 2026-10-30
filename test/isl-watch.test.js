import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WATCH_POLICIES,automaticWatchMatch,automaticReplayEvidence} from '../src/match-watch-policy.js';
import {ISL_CHANNEL,islFullMatch,islStreamStart} from '../src/isl-watch-policy.js';
import {refreshMatchWatch} from '../scripts/refresh-match-watch.js';
import {discoverMatchWatch,WATCH_DISCOVERY_KEY,WATCH_V5_DISCOVERY_KEY,WATCH_V4_DISCOVERY_KEY} from '../scripts/discover-match-watch.js';
import {watchApiPayload,watchLibraryPayload,watchCacheKey,WATCH_EXTENDED_LIBRARY_KEY} from '../src/match-watch.js';
import {loadWatchFixtureDays} from '../scripts/watch-fixture-days.js';
const data=JSON.parse(readFileSync('test-support/fixtures/isl-watch-sources.json')),now=Date.parse(data.observedAt),iso=t=>new Date(t).toISOString();
const policy=WATCH_POLICIES.find(p=>p.format==='isl');
const eligible=(m,v,n=now)=>automaticWatchMatch(policy,m,v.snippet.title,v.liveStreamingDetails?.scheduledStartTime,n,m.finished?'replay':'live',v.snippet.description)&&(!m.finished||automaticReplayEvidence(m,v.liveStreamingDetails?.actualStartTime,v.liveStreamingDetails?.actualEndTime,n,policy));
test('observed English full recordings and upcoming ISL streams identify four independent canonical matches, excluding Hindi, Vertical and clips',()=>{
 const matches=data.videos.flatMap(v=>data.matches.filter(m=>eligible(m,v)).map(m=>[m.fixtureId,v.id]));
 assert.deepEqual(matches.sort(),[[1642184,'Ay1gYmJoFMk'],[1642185,'dNbGWuWcG5Y'],[1642186,'raS61rqsQQI'],[1642187,'nZ8rESpcRTU']]);
 for(const v of data.videos.filter(v=>/हिंदी|Vertical/.test(v.snippet.title)))assert.equal(data.matches.some(m=>eligible(m,v)),false);
});
test('ISL requires independent ordered teams, exact dated English header, season, live gameweek and replay score',()=>{
 const m=data.matches.find(m=>m.fixtureId===1642185),v=data.videos.find(v=>v.id==='dNbGWuWcG5Y');
 for(const title of [v.snippet.title.replace('2026-27','2025-26'),v.snippet.title.replace('(1-1)','(2-1)'),v.snippet.title.replace('NorthEast United FC','NorthEast United Women'),v.snippet.title+' | Vertical','ARCHIVE '+v.snippet.title])assert.equal(islFullMatch(m,title,v.snippet.description,'replay'),false,title);
 for(const description of ['',v.snippet.description.replace('30-Oct-2026','29-Oct-2026'),v.snippet.description.replace('English ||','Hindi ||'),'Subscribe!\n'+v.snippet.description,v.snippet.description+'\n'+v.snippet.description.split('\n')[0],v.snippet.description.replace('NorthEast United FC vs Bengaluru FC','Bengaluru FC vs NorthEast United FC')])assert.equal(islFullMatch(m,v.snippet.title,description,'replay'),false);
 assert.equal(eligible({...m,leagueId:98},v),false);assert.equal(eligible({...m,finished:false,status:'NS'},v),false);
 const live=data.videos.find(v=>v.id==='nZ8rESpcRTU'),future=data.matches.find(m=>m.fixtureId===1642187);
 assert.equal(islFullMatch(future,live.snippet.title.replace('Gameweek 4','Gameweek 5'),live.snippet.description,'live'),false);
 assert.equal(islFullMatch({...m,date:'2026-10-29T23:45:00Z'},v.snippet.title,v.snippet.description,'replay'),true,'header date uses Asia/Kolkata, not the UTC calendar day');
});
test('the observed thirty-minute preshow has a bounded ISL-only timing allowance across scheduled and actual replay proof',()=>{
 const m=data.matches.find(m=>m.fixtureId===1642185),v=data.videos.find(v=>v.id==='dNbGWuWcG5Y'),kickoff=Date.parse(m.date),stream=v.liveStreamingDetails;
 assert.equal(automaticReplayEvidence(m,stream.actualStartTime,stream.actualEndTime,now),false,'generic thirty-minute proof stays strict');
 assert.equal(automaticReplayEvidence(m,stream.actualStartTime,stream.actualEndTime,now,policy),true);
 for(const [offset,allowed] of [[-45*60000,true],[-45*60000-1,false],[5*60000,true],[5*60000+1,false]])assert.equal(islStreamStart(m,iso(kickoff+offset)),allowed);
 assert.equal(automaticReplayEvidence(m,stream.actualStartTime,undefined,now,policy),false);assert.equal(automaticReplayEvidence(m,stream.actualStartTime,iso(now+1),now,policy),false);
});
const raw=m=>({fixture:{id:m.fixtureId,date:m.date,status:{short:m.status}},teams:{home:m.home,away:m.away},league:{id:m.leagueId,name:m.league,season:m.season,round:m.round},goals:m.score});
function harness(){
 const env={SUPABASE_URL:'https://nlmvhkjkpgzzlfavaohk.supabase.co',SUPABASE_SECRET_KEY:'test-db',YOUTUBE_DATA_API_KEY:'test-google'},cache=new Map(),calls=[];let clock=now,videos=structuredClone(data.videos),matches=structuredClone(data.matches),failFeeds=false,failCompleted=false,emptyCompleted=false,failMetadata=false,writeCount=0,failWriteAt=0,hiddenUploads=new Set();
 const fetchImpl=async(value,init)=>{
  const url=new URL(value);calls.push(url);assert.equal(init.redirect,'error');
  if(url.hostname==='www.googleapis.com'){
   assert.equal(init.headers['X-Goog-Api-Key'],env.YOUTUBE_DATA_API_KEY);assert.equal(url.searchParams.has('key'),false);
   if(!url.pathname.endsWith('/videos')){assert.ok(cache.get(WATCH_DISCOVERY_KEY),'attempt durably recorded before public I/O');if(failFeeds)throw Error('unavailable');}
   if(url.pathname.endsWith('/search')){assert.equal(url.searchParams.get('maxResults'),'10');if(url.searchParams.get('eventType')==='completed'){assert.equal(url.searchParams.get('order'),'date');if(failCompleted)throw Error('completed unavailable');if(emptyCompleted)return Response.json({items:[]});}return Response.json({items:videos.filter(v=>(url.searchParams.get('eventType')==='completed'?Boolean(v.liveStreamingDetails?.actualEndTime):v.snippet.liveBroadcastContent===url.searchParams.get('eventType'))).slice(0,10).map(v=>({id:{videoId:v.id}}))});}
   if(url.pathname.endsWith('/playlistItems')){assert.equal(url.searchParams.get('maxResults'),'20');return Response.json({items:videos.filter(v=>!hiddenUploads.has(v.id)).slice(0,20).map(v=>({contentDetails:{videoId:v.id}}))});}
   if(failMetadata)throw Error('temporary metadata failure');const ids=url.searchParams.get('id').split(',');return Response.json({items:videos.filter(v=>ids.includes(v.id))});
  }
  assert.equal(url.origin,env.SUPABASE_URL);
  if(url.pathname.endsWith('/claim_provider_request'))return Response.json({allowed:true});
  if(url.pathname.endsWith('/write_analysis_cache_versioned')){if(++writeCount===failWriteAt)throw Error('unknown write');const b=JSON.parse(init.body);cache.set(b.p_cache_key,{cache_key:b.p_cache_key,payload:b.p_payload,expiresAt:Date.parse(b.p_expires_at)});return Response.json({stored:true,reason:'stored'});}
  const filter=url.searchParams.get('cache_key');
  if(filter.startsWith('in.(provider-fixtures:'))return Response.json([...new Set(matches.map(m=>m.date.slice(0,10)))].map(date=>({cache_key:`provider-fixtures:${date}:v1`,payload:{date,fetchedAt:iso(clock-1000),fixtures:matches.filter(m=>m.date.startsWith(date)).map(raw)}})));
  if(filter.startsWith('like.'))return Response.json([]);
  const keys=filter.startsWith('eq.')?[filter.slice(3)]:filter.startsWith('in.(')?filter.slice(4,-1).split(','):[];
  return Response.json(keys.flatMap(k=>cache.has(k)&&cache.get(k).expiresAt>clock?[{cache_key:k,payload:cache.get(k).payload}]:[]));
 };
 return {cache,calls,hideUploads:ids=>{hiddenUploads=new Set(ids);},failCompleted:()=>{failCompleted=true;},emptyCompleted:()=>{emptyCompleted=true;},metadata:value=>{failMetadata=value;},failWriteAt:value=>{failWriteAt=value;},fail:()=>{failFeeds=true;},change:fn=>{videos=fn(videos);},setMatches:fn=>{matches=fn(matches);},run:async(offset=0)=>{clock=now+offset;return refreshMatchWatch({env,fetchImpl,now:clock,manifest:{version:1,items:[]},automatic:true,policies:[policy]});}};
}
test('real producer and consumer publish four English embedded full options, compact independent evidence and revoke changed rights/header/phase',async()=>{
 const h=harness(),r=await h.run();assert.equal(r.published,4);assert.equal(r.libraryMatches,4);assert.equal(r.libraryByCountry.RU.upcomingBroadcastMatches,2);assert.equal(r.libraryByCountry.RU.fullReplayMatches,2);
 const index=h.cache.get(WATCH_EXTENDED_LIBRARY_KEY).payload,opts={country:'RU',now,approvals:[],scheduledBroadcasts:true};
 const cards=watchLibraryPayload(index,{...opts,maxEntries:100});assert.ok(cards.items.every(c=>c.league==='Суперлига · Индия'));assert.doesNotMatch(JSON.stringify(cards),/videoId|eventUrl|"score"|videoDescription/);
 for(const e of index.entries){const item=watchApiPayload(e.match,e.catalogue,opts).items[0];assert.equal(item.embed,true);assert.equal(e.catalogue.items[0].videoDescription.includes('\n'),false);const broken=structuredClone(e.catalogue);broken.items[0].videoDescription='';assert.equal(watchApiPayload(e.match,broken,opts).available,false);}
 await h.run(300000);assert.equal(h.calls.filter(u=>u.pathname.endsWith('/search')).length,3);assert.equal(h.calls.filter(u=>u.pathname.endsWith('/playlistItems')).length,1);
 await h.run(900000);assert.equal(h.calls.filter(u=>u.pathname.endsWith('/playlistItems')).length,2);
 h.change(videos=>videos.map(v=>({...v,status:{...v.status,privacyStatus:'private'}})));const revoked=await h.run(1200000);assert.equal(revoked.published,0);assert.equal(revoked.libraryMatches,0);assert.ok(index.entries.every(e=>h.cache.get(watchCacheKey(e.match.fixtureId)).payload.items.length===0));
});
test('v6 preserves the v4 rollback snapshot and failed feed reads retain only freshly revalidated video permissions',async()=>{
 const h=harness(),previous={version:4,attemptedAt:iso(now-1000),videoIds:[],bindings:[],liveFeeds:{},uploadFeeds:{}};h.cache.set(WATCH_V4_DISCOVERY_KEY,{payload:structuredClone(previous),expiresAt:now+86400000});
 const first=await h.run();assert.equal(first.discoveryMigration,'v4_to_v6');assert.deepEqual(h.cache.get(WATCH_V4_DISCOVERY_KEY).payload,previous);assert.equal(first.published,4);
 h.fail();h.change(videos=>videos.map(v=>v.id==='dNbGWuWcG5Y'?{...v,status:{...v.status,privacyStatus:'private'}}:v));const r=await h.run(900000);assert.equal(r.discoveryError,'WATCH_DISCOVERY_SEARCH_FAILED');assert.equal(r.published,3);assert.deepEqual(h.cache.get(WATCH_V4_DISCOVERY_KEY).payload,previous);
});
test('an ended ISL stream triggers a canonical date recheck without creating a score or declaring an NS fixture finished',async()=>{
 const m=data.matches.find(m=>m.fixtureId===1642185),v=data.videos.find(v=>v.id==='dNbGWuWcG5Y'),ns={...m,status:'NS',finished:false,score:{home:null,away:null}},date=m.date.slice(0,10),cache=new Map(),report={};
 cache.set(`match-watch-fixtures:${date}:v1`,{version:1,date,leagueIds:[323],checkedAt:iso(now-30*60000),matches:[ns]});const requestedDates=[];
 const fetchImpl=async(url,init)=>{url=new URL(url);if(url.pathname.includes('football-relay')){requestedDates.push(url.searchParams.get('date'));return Response.json({errors:[],response:url.searchParams.get('date')===date?[raw(ns)]:[]});}return Response.json(init.method==='POST'?{allowed:true}:[]);};
 const result=await loadWatchFixtureDays({videos:[v],policies:[policy],env:{SUPABASE_URL:'https://nlmvhkjkpgzzlfavaohk.supabase.co',SUPABASE_SECRET_KEY:'test-db',API_FOOTBALL_KEY:'test-football'},fetchImpl,now,report,signal:new AbortController().signal,readCache:async p=>p.cache_key.startsWith('eq.')?[]:[{cache_key:`match-watch-fixtures:${date}:v1`,payload:cache.get(`match-watch-fixtures:${date}:v1`)}],writeCache:async(k,_id,p)=>{cache.set(k,p);}});
 assert.equal(requestedDates[0],date);assert.equal(result[0].match.finished,false);assert.deepEqual(result[0].match.score,{home:null,away:null});assert.equal(eligible(result[0].match,v),false);
});
test('registry-derived worst-case discovery stays within free quota and bounded eight-channel requests',()=>{
 const channels=Map.groupBy(WATCH_POLICIES,p=>p.channelId),day=86400000;let cost=0,ids=220,calls=0;
 for(const policies of channels.values()){
  const full=policies.filter(p=>!p.highlightsOnly);if(full.length){cost+=200*Math.ceil(day/Math.min(...full.map(p=>p.searchIntervalMs||7200000)));ids+=2*Math.min(...full.map(p=>p.searchMaxResults||20));calls+=2;}
  const completed=policies.filter(p=>p.completedSearchIntervalMs);if(completed.length){cost+=100*Math.ceil(day/Math.min(...completed.map(p=>p.completedSearchIntervalMs)));ids+=Math.min(...completed.map(p=>p.completedMaxResults));calls++;}
  ids+=Math.min(...policies.map(p=>p.uploadsMaxResults||50));calls++;cost+=Math.ceil(day/Math.min(...policies.map(p=>p.uploadsIntervalMs||7200000)));
 }
 calls+=Math.ceil(ids/50);cost+=Math.ceil(ids/50)*288;
 assert.equal(channels.size,8);assert.equal(ids,700);assert.equal(calls,29);assert.equal(cost,9524);assert.ok(cost<10000);assert.equal(policy.channelId,ISL_CHANNEL);
});
test('actual maximum transport uses twenty ISL uploads, ten results per search, 700 unique IDs and 29 total YouTube calls',async()=>{
 const channels=Map.groupBy(WATCH_POLICIES,p=>p.channelId),calls=[],ids=[];let sequence=0;const video=()=>String(++sequence).padStart(11,'0');
 const state={version:6,attemptedAt:iso(now-86400000),videoIds:[],bindings:Array.from({length:100},(_,i)=>({match:{...data.matches[0],fixtureId:900000+i},observedAt:iso(now-1000),videoIds:[video(),video()]})),liveFeeds:{},uploadFeeds:{}};
 const approvals=Array.from({length:20},()=>({provider:'youtube',videoId:video()}));
 await discoverMatchWatch({now,policies:WATCH_POLICIES,approvals,report:{},readCache:async p=>p.cache_key===`eq.${WATCH_DISCOVERY_KEY}`?[{cache_key:WATCH_DISCOVERY_KEY,payload:state}]:[],writeCache:async()=>{},youtube:async(path,params)=>{
  calls.push({path,params});if(path==='videos'){const batch=params.id.split(',');assert.ok(batch.length<=50);ids.push(...batch);return [];}
  const isl=params.channelId===ISL_CHANNEL||params.playlistId==='UU'+ISL_CHANNEL.slice(2);assert.equal(Number(params.maxResults),path==='search'?isl?10:20:isl?20:50);
  return Array.from({length:Number(params.maxResults)},()=>path==='search'?{id:{videoId:video()}}:{contentDetails:{videoId:video()}});
 }});
 assert.equal(channels.size,8);assert.equal(ids.length,700);assert.equal(new Set(ids).size,700);assert.equal(calls.length,29);assert.equal(calls.filter(c=>c.path==='videos').length,14);
});
test('an oversized new-channel live or uploads snapshot fails before any public request',async()=>{
 for(const kind of ['liveFeeds','uploadFeeds']){
  const state={version:6,attemptedAt:iso(now-1000),videoIds:[],bindings:[],[kind]:{[ISL_CHANNEL]:{attemptedAt:iso(now-1000),ids:Array.from({length:21},(_,i)=>String(i).padStart(11,'0'))}}};
  await assert.rejects(discoverMatchWatch({now,policies:[policy],approvals:[],report:{},readCache:async()=>[{cache_key:WATCH_DISCOVERY_KEY,payload:state}],writeCache:async()=>assert.fail('invalid state must not be written'),youtube:async()=>assert.fail('invalid state must not reach Google')}),{code:'WATCH_DISCOVERY_STATE_INVALID'});
 }
});
test('cached upcoming ISL metadata cannot turn into on-air when its scheduled preshow time passes',async()=>{
 const h=harness(),clock=Date.parse('2026-10-31T10:55:00Z');await h.run(clock-now);
 const original=h.cache.get(watchCacheKey(1642186)).payload,match=data.matches.find(m=>m.fixtureId===1642186),opts={country:'RU',now:clock+6*60000,approvals:[],scheduledBroadcasts:true};
 assert.equal(watchApiPayload(match,original,opts).items[0].scheduled,true,'the clock crossing 11:00 cannot claim a real source start');
 for(const patch of [{broadcastKind:'live'},{broadcastKind:'none'},{videoStream:{scheduledStartTime:'2026-10-31T11:00:00Z',actualStartTime:'2026-10-31T11:00:00Z'}}]){const changed=structuredClone(original);Object.assign(changed.items[0],patch);assert.equal(watchApiPayload(match,changed,opts).available,false);}
 h.change(videos=>videos.map(v=>v.id==='raS61rqsQQI'?{...v,snippet:{...v.snippet,liveBroadcastContent:'live'},liveStreamingDetails:{...v.liveStreamingDetails,actualStartTime:'2026-10-31T11:00:00Z'}}:v));
 await h.run(opts.now-now);const fresh=h.cache.get(watchCacheKey(1642186)).payload;assert.equal(watchApiPayload(match,fresh,opts).items[0].scheduled,false,'fresh live metadata plus real actualStart allows an on-air broadcast, while canonical match remains NS');
 assert.equal(match.status,'NS');assert.equal(match.live,false);
});
test('a completed observed LIVE format becomes a full replay only after canonical FT, without waiting for a publisher title rename',async()=>{
 // Explicit future lifecycle simulation from actual upcoming metadata, not an
 // observation or prediction of the match's future final score.
 const h=harness(),m=data.matches.find(m=>m.fixtureId===1642187),v=data.videos.find(v=>v.id==='nZ8rESpcRTU'),kickoff=Date.parse(m.date),end=kickoff+125*60000,clock=end+5*60000;
 await h.run();h.change(videos=>videos.map(item=>item.id===v.id?{...item,snippet:{...item.snippet,liveBroadcastContent:'none'},liveStreamingDetails:{...item.liveStreamingDetails,actualStartTime:iso(kickoff-31*60000),actualEndTime:iso(end)}}:item));
 await h.run(clock-now);assert.equal(h.cache.get(WATCH_EXTENDED_LIBRARY_KEY).payload.entries.some(e=>e.match.fixtureId===m.fixtureId),false,'ended source cannot manufacture a canonical final status');
 h.setMatches(matches=>matches.map(match=>match.fixtureId===m.fixtureId?{...match,status:'FT',finished:true,live:false,score:{home:2,away:1}}:match));
 await h.run(clock+300000-now);const catalogue=h.cache.get(watchCacheKey(m.fixtureId)).payload,finished={...m,status:'FT',finished:true,score:{home:2,away:1}},opts={country:'RU',now:clock+300000,approvals:[],scheduledBroadcasts:true};
 const item=watchApiPayload(finished,catalogue,opts).items[0];assert.equal(item.kind,'replay');assert.equal(item.embed,true);assert.equal(catalogue.items[0].videoTitle,v.snippet.title);assert.match(catalogue.items[0].videoDescription,/ \|\| LIVE \|\| /);
 for(const change of [i=>{i.replayEndedAt=null;},i=>{i.broadcastKind='upcoming';},i=>{i.broadcastKind='live';},i=>{i.videoTitle=i.videoTitle.replace('Gameweek 4','Gameweek 5');},i=>{i.videoDescription=i.videoDescription.replace('31-Oct-2026','30-Oct-2026');},i=>{i.videoDescription=i.videoDescription.replace(' || LIVE || ',' || Match Content || Full Match Replay || ');}]){const bad=structuredClone(catalogue);change(bad.items[0]);assert.equal(watchApiPayload(finished,bad,opts).available,false);}
});
test('completed-only search recovers the actual English Goa recording outside mixed uploads, then relies on binding retention',async()=>{
 const h=harness();h.hideUploads(['Ay1gYmJoFMk']);const r=await h.run();assert.equal(r.published,4);
 assert.ok(h.cache.get(WATCH_DISCOVERY_KEY).payload.completedFeeds[ISL_CHANNEL].ids.includes('Ay1gYmJoFMk'));
 const m=data.matches.find(m=>m.fixtureId===1642184),catalogue=h.cache.get(watchCacheKey(m.fixtureId)).payload;
 assert.equal(watchApiPayload(m,catalogue,{country:'RU',now,approvals:[]}).items[0].videoId,'Ay1gYmJoFMk');
 h.emptyCompleted();const next=await h.run(12*3600000);assert.equal(next.published,4,'an empty discovery result does not revoke a separately revalidated public recording');
 assert.deepEqual(h.cache.get(WATCH_DISCOVERY_KEY).payload.completedFeeds[ISL_CHANNEL].ids,[]);
 h.change(videos=>videos.map(v=>v.id==='Ay1gYmJoFMk'?{...v,status:{...v.status,privacyStatus:'private'}}:v));const revoked=await h.run(12*3600000+300000);assert.equal(revoked.published,3);assert.deepEqual(h.cache.get(watchCacheKey(m.fixtureId)).payload.items,[]);
});
test('v5 migration keeps the old snapshot unchanged and a failed completed feed retains IDs without retrying every tick or retaining revoked rights',async()=>{
 const h=harness();h.hideUploads(['Ay1gYmJoFMk']);const previous={version:5,attemptedAt:iso(now-1000),videoIds:[],bindings:[],liveFeeds:{},uploadFeeds:{}};
 h.cache.set(WATCH_V5_DISCOVERY_KEY,{payload:structuredClone(previous),expiresAt:now+86400000});const first=await h.run();assert.equal(first.discoveryMigration,'v5_to_v6');assert.equal(first.published,4);assert.deepEqual(h.cache.get(WATCH_V5_DISCOVERY_KEY).payload,previous);
 h.failCompleted();h.change(videos=>videos.map(v=>v.id==='Ay1gYmJoFMk'?{...v,contentDetails:{...v.contentDetails,regionRestriction:{blocked:['RU','KZ','BY']}}}:v));
 const second=await h.run(12*3600000);assert.ok(second.failedFeeds.includes('completed_search'));assert.equal(second.published,3);assert.ok(h.cache.get(WATCH_DISCOVERY_KEY).payload.completedFeeds[ISL_CHANNEL].ids.includes('Ay1gYmJoFMk'));
 const count=()=>h.calls.filter(u=>u.searchParams.get('eventType')==='completed').length;assert.equal(count(),2);await h.run(12*3600000+300000);assert.equal(count(),2);assert.deepEqual(h.cache.get(WATCH_V5_DISCOVERY_KEY).payload,previous);
});
test('new completed IDs are durable before metadata failure and are revalidated next tick without another expensive search',async()=>{
 const h=harness();h.hideUploads(['Ay1gYmJoFMk']);h.metadata(true);await assert.rejects(h.run(),{code:'WATCH_SOURCE_UNAVAILABLE'});
 const saved=h.cache.get(WATCH_DISCOVERY_KEY).payload;assert.ok(saved.completedFeeds[ISL_CHANNEL].ids.includes('Ay1gYmJoFMk'));assert.ok(saved.videoIds.includes('Ay1gYmJoFMk'));assert.equal(h.cache.has(WATCH_EXTENDED_LIBRARY_KEY),false);
 h.metadata(false);const r=await h.run(300000);assert.equal(r.published,4);assert.equal(h.calls.filter(u=>u.searchParams.get('eventType')==='completed').length,1);
});
test('unknown discovery checkpoint write aborts before fetching metadata or publishing options',async()=>{
 const h=harness();h.failWriteAt(2);await assert.rejects(h.run(),{code:'WATCH_WRITE_UNCONFIRMED'});
 assert.ok(h.calls.some(u=>u.searchParams.get('eventType')==='completed'));assert.equal(h.calls.some(u=>u.pathname.endsWith('/videos')),false);assert.equal(h.cache.has(WATCH_EXTENDED_LIBRARY_KEY),false);
});
test('malformed or unbounded completed state fails before any Google call',async()=>{
 const valid={attemptedAt:iso(now-1000),ids:['Ay1gYmJoFMk']};
 for(const completedFeeds of [null,[],{[ISL_CHANNEL]:{...valid,ids:Array.from({length:11},(_,i)=>String(i).padStart(11,'0'))}},{[ISL_CHANNEL]:{...valid,attemptedAt:iso(now+1)}},{UCpcTrCXblq78GZrTUTLWeBw:valid},{[ISL_CHANNEL]:{ids:['invalid'],attemptedAt:iso(now-1)}}]){
  await assert.rejects(discoverMatchWatch({now,policies:[policy],approvals:[],report:{},readCache:async()=>[{cache_key:WATCH_DISCOVERY_KEY,payload:{version:6,attemptedAt:iso(now-1000),videoIds:[],bindings:[],completedFeeds}}],writeCache:async()=>assert.fail('invalid discovery state'),youtube:async()=>assert.fail('invalid discovery state')}),{code:'WATCH_DISCOVERY_STATE_INVALID'});
 }
});
