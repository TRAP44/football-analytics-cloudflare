import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshMatchWatch} from '../scripts/refresh-match-watch.js';
import {WATCH_DISCOVERY_KEY,WATCH_V4_DISCOVERY_KEY,WATCH_PREVIOUS_DISCOVERY_KEY,WATCH_V2_DISCOVERY_KEY,WATCH_DISCOVERY_INTERVAL} from '../scripts/discover-match-watch.js';
import {WATCH_POLICIES,automaticWatchMatch,automaticHighlightsMatch} from '../src/match-watch-policy.js';
import {validatedWatchOptions,watchCacheKey,watchLibraryPayload,WATCH_LIBRARY_KEY} from '../src/match-watch.js';
import {createUserDataApiRuntime} from '../src/user-data-api-runtime.js';
import {matchCenterCacheKey} from '../src/match-center-cache-key.js';
const now=Date.parse('2026-10-23T21:00:00Z'),iso=offset=>new Date(now+offset).toISOString();
const match={fixtureId:777777,date:iso(12*3600000),status:'NS',home:{id:290,name:'Kashima'},away:{id:281,name:'Kashiwa Reysol'},leagueId:98,league:'J1 League',season:2027,round:'Regular Season - 10',finished:false};
const video={id:'abcdefghijk',snippet:{channelId:WATCH_POLICIES[0].channelId,title:'Kashima Antlers v Kashiwa Reysol - Live Match | J.League',liveBroadcastContent:'upcoming'},status:{privacyStatus:'public',embeddable:true},contentDetails:{},liveStreamingDetails:{scheduledStartTime:iso(12*3600000-300000)}};
const raw=m=>({fixture:{id:m.fixtureId,date:m.date,status:{short:m.status}},teams:{home:m.home,away:m.away},league:{id:m.leagueId,name:m.league,season:m.season,round:m.round}});
function harness(){
 const cache=new Map(),calls=[];let items=[structuredClone(video)],matches=[structuredClone(match)],failSearch=false,failWrite=false,failUploads=false,searchResults=null,uploadResults=null,currentNow=now;
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'db-test-secret',YOUTUBE_DATA_API_KEY:'youtube-test-secret'};
 const fetchImpl=async(value,init)=>{
  const url=new URL(value);calls.push({url,init});
  assert.equal(init.redirect,'error');
  if(url.hostname==='www.googleapis.com'){
   assert.equal(init.headers.apikey,undefined);assert.equal(init.headers['X-Goog-Api-Key'],env.YOUTUBE_DATA_API_KEY);
   if(url.pathname.endsWith('/search')){if(failSearch===true||failSearch===url.searchParams.get('eventType'))throw Error('private upstream text');return Response.json({items:searchResults??items.map(v=>({id:{videoId:v.id}}))});}
   if(url.pathname.endsWith('/playlistItems')){if(failUploads)throw Error('uploads unavailable');assert.equal(url.searchParams.get('playlistId'),'UU'+WATCH_POLICIES[0].channelId.slice(2));assert.equal(url.searchParams.get('maxResults'),'50');return Response.json({items:(uploadResults??items.map(v=>v.id)).map(id=>({contentDetails:{videoId:id}}))});}
   assert.ok(url.pathname.endsWith('/videos'));assert.ok(url.searchParams.get('id').split(',').length<=50);return Response.json({items});
  }
  assert.equal(url.hostname,'example.supabase.co');assert.equal(init.headers['X-Goog-Api-Key'],undefined);
  if(init.method==='POST'){
   if(url.pathname==='/rest/v1/rpc/claim_provider_request'){assert.deepEqual(JSON.parse(init.body),{p_bucket_key:'match-watch:refresh',p_limit:1,p_window_seconds:300});return Response.json({allowed:true});}
   assert.equal(url.pathname,'/rest/v1/rpc/write_analysis_cache_versioned');if(failWrite)throw Error('write outcome unknown');
   const body=JSON.parse(init.body),previous=cache.get(body.p_cache_key);
   // Model the real versioned RPC: repeated differing content at the same
   // timestamp cannot overwrite the search-attempt marker.
   if(previous&&previous.updatedAt>=body.p_updated_at)return Response.json({stored:false,reason:'superseded'});
   cache.set(body.p_cache_key,{payload:body.p_payload,updatedAt:body.p_updated_at,expiresAt:Date.parse(body.p_expires_at)});return Response.json({stored:true,reason:'stored'});
  }
  assert.equal(url.pathname,'/rest/v1/analysis_cache');const key=url.searchParams.get('cache_key');if(key==='eq.match-watch-discovery:v1')return Response.json(cache.has('match-watch-discovery:v1')?[{cache_key:'match-watch-discovery:v1',payload:cache.get('match-watch-discovery:v1').payload}]:[]);
  if(key===`eq.${WATCH_V4_DISCOVERY_KEY}`)return Response.json([]);
  if(key===`eq.${WATCH_V2_DISCOVERY_KEY}`)return Response.json(cache.has(WATCH_V2_DISCOVERY_KEY)?[{cache_key:WATCH_V2_DISCOVERY_KEY,payload:cache.get(WATCH_V2_DISCOVERY_KEY).payload}]:[]);
  if(key===`eq.${WATCH_PREVIOUS_DISCOVERY_KEY}`)return Response.json(cache.has(WATCH_PREVIOUS_DISCOVERY_KEY)?[{cache_key:WATCH_PREVIOUS_DISCOVERY_KEY,payload:cache.get(WATCH_PREVIOUS_DISCOVERY_KEY).payload}]:[]);
  if(key===`eq.${WATCH_DISCOVERY_KEY}`)return Response.json((cache.has(WATCH_DISCOVERY_KEY)&&(cache.get(WATCH_DISCOVERY_KEY).expiresAt??Infinity)>currentNow)?[{cache_key:WATCH_DISCOVERY_KEY,payload:cache.get(WATCH_DISCOVERY_KEY).payload}]:[]);
  if(key.startsWith('in.(provider-fixtures:'))return Response.json([{cache_key:'provider-fixtures:2026-10-24:v1',payload:{date:'2026-10-24',fetchedAt:new Date(currentNow-60000).toISOString(),fixtures:matches.map(raw)}}]);
  if(key.startsWith('like.'))return Response.json([]);
  assert.match(key,/^in\.\(match-center:/);return Response.json([]);
 };
 const run=(offset=0)=>{currentNow=now+offset;return refreshMatchWatch({env,manifest:{version:1,items:[]},automatic:true,policies:[WATCH_POLICIES[0]],fetchImpl,now:currentNow});};
 return {run,cache,calls,setVideos:v=>{items=v;},setMatches:m=>{matches=m;},setSearchResults:v=>{searchResults=v;},setUploads:v=>{uploadResults=v;},failSearch:type=>{failSearch=type||true;},failUploads:()=>{failUploads=true;},failWrite:()=>{failWrite=true;}};
}
const apiRuntime=deps=>createUserDataApiRuntime(new Proxy(deps,{get:(target,key)=>key in target?target[key]:async()=>[]}));
const searchCalls=h=>h.calls.filter(call=>call.url.pathname.endsWith('/search')).length;

test('observed official club names match only the independently verified Kyoto and Urawa team IDs',()=>{
 const time=Date.parse('2026-10-27T12:30:00Z'),policy=WATCH_POLICIES[0];
 const samples=[
  {fixtureId:1556113,date:'2026-10-24T07:00:00.000Z',home:{id:293,name:'Gamba Osaka'},away:{id:302,name:'Kyoto Sanga'},title:'LATE DRAMA & RED CARD! 🤯 | Gamba Osaka vs Kyoto Sanga F.C. HIGHLIGHTS | J.League',publishedAt:'2026-10-24T09:13:15Z',description:'Highlights from Matchweek 12 in the 2026-27 J.League between Gamba Osaka and Kyoto Sanga F.C.'},
  {fixtureId:1556118,date:'2026-10-25T06:00:00.000Z',home:{id:287,name:'Urawa'},away:{id:285,name:'V-varen Nagasaki'},title:'Urawa Reds vs V-Varen Nagasaki HIGHLIGHTS | J.League',publishedAt:'2026-10-25T08:24:38Z',description:'Highlights from Matchweek 12 in the 2026-27 J.League between Urawa Reds and V-Varen Nagasaki.'},
 ];
 for(const sample of samples){
  const m={...sample,leagueId:98,season:2027,round:'Regular Season - 12',status:'FT',finished:true};
  const accepts=patch=>automaticHighlightsMatch(policy,{...m,...patch},sample.title,sample.publishedAt,time,sample.description);
  assert.equal(accepts({}),true,sample.title);
  assert.equal(accepts({home:{...m.home,id:999999},away:{...m.away,id:999998}}),false,'aliases must not become global fuzzy names');
  assert.equal(accepts({leagueId:99}),false);
  assert.equal(accepts({round:'Regular Season - 11'}),false);
  assert.equal(accepts({home:m.away,away:m.home}),false);
  assert.equal(automaticHighlightsMatch(policy,m,sample.title,sample.publishedAt,time,sample.description.replace('Matchweek 12','Matchweek 11')),false);
 }
});

test('a previously undeployed fixture/video is discovered, bound and published without a per-match approval',async()=>{
 const h=harness(),report=await h.run();
 assert.equal(report.discovery,'searched');assert.equal(report.automaticMatched,1);assert.equal(report.automaticPublished,1);assert.equal(report.youtubeRequests,4);assert.equal(searchCalls(h),2);
 const payload=h.cache.get(watchCacheKey(match.fixtureId)).payload;
 assert.equal(payload.items[0].approval.version,2);assert.equal(payload.items[0].approval.policyId,WATCH_POLICIES[0].id);
 assert.equal(validatedWatchOptions(match,payload,{now,approvals:[],country:'RU'}).length,1);
 assert.equal(validatedWatchOptions(match,payload,{now,approvals:[],policies:[]}).length,0,'deployed source removal revokes old cache');
 assert.equal(validatedWatchOptions(match,payload,{now,approvals:[],policies:[{...WATCH_POLICIES[0],revision:2}]}).length,0);
 assert.equal(validatedWatchOptions(match,payload,{now,approvals:[],policies:[{...WATCH_POLICIES[0],countries:['KZ']}]}).length,0);
 assert.equal(validatedWatchOptions({...match,season:2028},payload,{now,approvals:[]}).length,0);
 assert.equal(validatedWatchOptions(match,payload,{now:now+1800001,approvals:[]}).length,0);
 const next=await h.run(300000);assert.equal(next.discovery,'cached');assert.equal(next.youtubeRequests,1);assert.equal(next.automaticPublished,1);assert.equal(searchCalls(h),2);
 assert.ok(h.cache.get(WATCH_DISCOVERY_KEY).payload.videoIds.includes(video.id));
});

test('strict full-match format, canonical IDs, league, category, order and time prevent false matches',()=>{
 const p=WATCH_POLICIES[0],title=video.snippet.title,start=video.liveStreamingDetails.scheduledStartTime;
 assert.equal(automaticWatchMatch(p,match,title,start,now),true);
 for(const patch of [{leagueId:99},{home:{id:999,name:'Kashima'}},{finished:true},{status:'PST'},{season:0},{date:iso(60*3600000)},{home:match.away,away:match.home}])assert.equal(automaticWatchMatch(p,{...match,...patch},title,start,now),false,JSON.stringify(patch));
 for(const title of ['LIVE | '+video.snippet.title,video.snippet.title+' Highlights',video.snippet.title.replace('Antlers','Antlers U21'),video.snippet.title.replace('Reysol','Reysol Women'),video.snippet.title.replace('Live Match','Replay')])assert.equal(automaticWatchMatch(p,match,title,start,now),false,title);
 assert.equal(automaticWatchMatch(p,match,title,iso(10*3600000),now),false);
});

test('ambiguous canonical fixtures and unpinned channels cannot auto-publish',async()=>{
 const h=harness();h.setMatches([match,{...match,fixtureId:888888}]);assert.equal((await h.run()).automaticPublished||0,0);
 const other=harness();other.setVideos([{...video,snippet:{...video.snippet,channelId:'UC-unverified'}}]);assert.equal((await other.run()).automaticPublished||0,0);
});

test('deleted/private/geoblocked videos withdraw old bindings on the next metadata tick',async()=>{
 for(const change of [[],[{...video,status:{privacyStatus:'private'}}],[{...video,contentDetails:{regionRestriction:{blocked:['RU','KZ','BY']}}}]]){
  const h=harness();await h.run();h.setVideos(change);const report=await h.run(300000);assert.equal(report.published,0);
  assert.equal(h.cache.get(watchCacheKey(match.fixtureId)).payload.items.length,0);assert.equal(searchCalls(h),2);
 }
 const h=harness();await h.run();h.setVideos([]);await h.run(WATCH_DISCOVERY_INTERVAL+1);assert.equal(h.cache.get(watchCacheKey(match.fixtureId)).payload.items.length,0);
});

test('search attempt is durable before API I/O; failed search does not repeat every tick',async()=>{
 const h=harness();h.failSearch();const report=await h.run();assert.equal(report.discovery,'partial');assert.equal(report.discoveryError,'WATCH_DISCOVERY_SEARCH_FAILED');
 assert.ok(h.cache.get(WATCH_DISCOVERY_KEY).payload.attemptedAt);assert.equal(searchCalls(h),2);
 await h.run(300000);assert.equal(searchCalls(h),2);
 const unknown=harness();unknown.failWrite();await assert.rejects(unknown.run(),e=>e.code==='WATCH_WRITE_UNCONFIRMED');assert.equal(searchCalls(unknown),0);assert.equal(unknown.calls.filter(call=>call.url.pathname.endsWith('/write_analysis_cache_versioned')).length,1);
});

test('one failed search feed cannot discard a newly found LIVE or prevent the other feed from being queried',async()=>{
 for(const failedType of ['live','upcoming']){
  const h=harness();h.failSearch(failedType);h.failUploads();
  const offset=failedType==='upcoming'?12*3600000+60000:0;
  if(offset){h.setMatches([{...match,status:'1H'}]);h.setVideos([{...video,snippet:{...video.snippet,liveBroadcastContent:'live'},liveStreamingDetails:{...video.liveStreamingDetails,actualStartTime:iso(12*3600000)}}]);}
  const report=await h.run(offset);
  assert.equal(report.discovery,'partial');assert.equal(report.discoveryError,'WATCH_DISCOVERY_SEARCH_FAILED');
  assert.equal(searchCalls(h),2);assert.equal(report.youtubeRequests,4);
  assert.equal(report.automaticPublished,1,failedType);
  assert.ok(h.cache.get(WATCH_DISCOVERY_KEY).payload.videoIds.includes(video.id));
  assert.equal(watchLibraryPayload(h.cache.get(WATCH_LIBRARY_KEY).payload,{country:'RU',now:now+offset}).items.length,1);
  await h.run(offset+300000);assert.equal(searchCalls(h),2,'failed feed still respects the durable two-hour attempt marker');
 }
});

test('automatic catalogue is served through the authenticated cache-only API',async()=>{
 const h=harness();await h.run();const payload=h.cache.get(watchCacheKey(match.fixtureId)).payload;
 const reads=[],api=apiRuntime({watchApprovals:[],json:(data,status=200)=>Response.json(data,{status}),getCache:async key=>{reads.push(key);return key===matchCenterCacheKey(match.fixtureId)?{match}:payload;}});
 // Use production-valid dates for the API's real clock, independent of fixed tests.
 const current=Date.now(),delta=current-now;
 const currentMatch={...match,date:new Date(Date.parse(match.date)+delta).toISOString()};
 const shifted=structuredClone(payload);shifted.fixtureIdentity=shifted.items[0].approval.fixtureIdentity=shifted.fixtureIdentity.replace(match.date,currentMatch.date);
 for(const item of shifted.items){for(const key of ['checkedAt','expiresAt','availableFrom'])item[key]=new Date(Date.parse(item[key])+delta).toISOString();item.approval.confirmedAt=new Date(current).toISOString();}
 const liveApi=apiRuntime({watchApprovals:[],json:(data,status=200)=>Response.json(data,{status}),getCache:async key=>key===matchCenterCacheKey(match.fixtureId)?{match:currentMatch}:shifted});
 const request=new Request(`https://app.example/api/match-watch?fixtureId=${match.fixtureId}&country=RU`);
 assert.equal((await api.apiMatchWatch(request,{},null)).status,401);assert.equal(reads.length,0);
 assert.equal((await (await liveApi.apiMatchWatch(request,{},{id:42})).json()).available,true);
});


test('an old live session cannot be relabelled as a new fixture using a new scheduled time',async()=>{
 const h=harness();h.setVideos([{...video,snippet:{...video.snippet,liveBroadcastContent:'live'},liveStreamingDetails:{...video.liveStreamingDetails,actualStartTime:iso(-86400000)}}]);
 const report=await h.run();assert.equal(report.automaticMatched,1);assert.equal(report.automaticPublished||0,0);assert.equal(report.rejected,1);
});

test('malformed or future discovery state stops before any search',async()=>{
 for(const patch of [{attemptedAt:iso(60000)},{videoIds:['untrusted-url']},{bindings:Array(21).fill({})}]){
  const h=harness();h.cache.set(WATCH_DISCOVERY_KEY,{updatedAt:iso(-1),payload:{version:5,attemptedAt:iso(-60000),videoIds:[],bindings:[],...patch}});
  await assert.rejects(h.run(),e=>e.code==='WATCH_DISCOVERY_STATE_INVALID');assert.equal(searchCalls(h),0);
 }
});


const finished={...match,status:'FT',finished:true};
const replay={...video,snippet:{...video.snippet,title:video.snippet.title.replace('Live Match','Full Match'),liveBroadcastContent:'none'},liveStreamingDetails:{...video.liveStreamingDetails,actualStartTime:iso(12*3600000-300000),actualEndTime:iso(14*3600000)}};

test('a bound LIVE becomes a full replay and survives disappearance from LIVE/upcoming search',async()=>{
 const h=harness();await h.run();h.setMatches([finished]);h.setVideos([replay]);h.setSearchResults([]);h.setUploads([]);
 const offset=15*3600000,report=await h.run(offset);
 assert.equal(report.automaticPublished,1);assert.equal(report.discovery,'searched');
 const payload=h.cache.get(watchCacheKey(match.fixtureId)).payload;
 assert.equal(payload.items[0].kind,'replay');assert.equal(payload.items[0].label,'Полная запись J.LEAGUE');
 assert.equal(validatedWatchOptions(finished,payload,{now:now+offset,approvals:[]}).length,1);
 assert.equal(validatedWatchOptions(match,payload,{now:now+offset,approvals:[]}).length,0,'independent unfinished centre cannot display replay');
 assert.equal(validatedWatchOptions(finished,payload,{now:now+offset,approvals:[],policies:[]}).length,0);
 assert.deepEqual(h.cache.get(WATCH_DISCOVERY_KEY).payload.videoIds,[]);
 assert.deepEqual(h.cache.get(WATCH_DISCOVERY_KEY).payload.bindings[0].videoIds,[video.id]);
 // No remaining day feed or centre at three days: final canonical snapshot and
 // bound video are retained, never an invented Match Center for the public API.
 h.setMatches([]);assert.equal((await h.run(3*86400000)).automaticPublished,1);
 const expired=await h.run(12*3600000+7*86400000+1);assert.equal(expired.published,0);
});

test('ended recording requires canonical final status, real full-length timing and a current region permission',async()=>{
 for(const patch of [{liveStreamingDetails:{...replay.liveStreamingDetails,actualEndTime:iso(12*3600000+300000)}},{liveStreamingDetails:{...replay.liveStreamingDetails,actualStartTime:iso(-86400000)}},{liveStreamingDetails:{...replay.liveStreamingDetails,actualEndTime:iso(20*3600000)}},{liveStreamingDetails:{scheduledStartTime:replay.liveStreamingDetails.scheduledStartTime}},{snippet:{...replay.snippet,title:replay.snippet.title.replace('Full Match','Highlights')}},{status:{privacyStatus:'private'}},{contentDetails:{regionRestriction:{blocked:['RU','KZ','BY']}}}]){
  const h=harness();await h.run();h.setMatches([finished]);h.setVideos([{...replay,...patch}]);h.setSearchResults([]);
  assert.equal((await h.run(15*3600000)).published,0,JSON.stringify(patch));
  assert.equal(h.cache.get(watchCacheKey(match.fixtureId)).payload.items.length,0);
 }
 const h=harness();await h.run();h.setVideos([replay]);h.setSearchResults([]);assert.equal((await h.run(15*3600000)).published,0,'stream end does not fabricate a final football status');
});

test('deleting an already published replay clears its option on the next tick',async()=>{
 const h=harness();await h.run();h.setMatches([finished]);h.setVideos([replay]);h.setSearchResults([]);await h.run(15*3600000);
 h.setVideos([]);assert.equal((await h.run(15*3600000+300000)).published,0);assert.equal(h.cache.get(watchCacheKey(match.fixtureId)).payload.items.length,0);
});


const highlight={id:'zyxwvutsrqp',snippet:{channelId:WATCH_POLICIES[0].channelId,title:'Kashima Antlers vs. Kashiwa Reysol | 2026/27 J1 League | Matchweek 10 | Highlights',liveBroadcastContent:'none',publishedAt:iso(14*3600000)},status:{privacyStatus:'public',embeddable:true},contentDetails:{duration:'PT5M12S'}};

test('a standalone official post-match upload publishes an overview without any previously bound live video',async()=>{
 const h=harness();h.setVideos([highlight]);h.setMatches([finished]);h.setSearchResults([]);
 const report=await h.run(15*3600000);assert.equal(report.youtubeRequests,4);assert.equal(report.automaticPublished,1);
 const payload=h.cache.get(watchCacheKey(match.fixtureId)).payload,item=payload.items[0];
 assert.equal(item.kind,'highlights');assert.equal(item.label,'Обзор J.LEAGUE');assert.equal(item.publishedAt,highlight.snippet.publishedAt);assert.equal(item.videoDuration,'PT5M12S');
 assert.equal(validatedWatchOptions(finished,payload,{now:now+15*3600000,approvals:[],country:'RU'})[0].embed,true);
 assert.equal(validatedWatchOptions(match,payload,{now:now+15*3600000,approvals:[]}).length,0);
 const uploads=h.calls.find(c=>c.url.pathname.endsWith('/playlistItems'));assert.ok(uploads);assert.equal(h.calls.filter(c=>c.url.pathname.endsWith('/playlistItems')).length,1);
 h.setSearchResults([]);h.setUploads([]);assert.equal((await h.run(15*3600000+300000)).automaticPublished,1);assert.equal(h.calls.filter(c=>c.url.pathname.endsWith('/playlistItems')).length,1,'no uploads poll every five minutes');
});

test('weekly compilations, old meetings, premieres, short clips and full-length videos never become match highlights',async()=>{
 const variants=[
  {...highlight,snippet:{...highlight.snippet,title:'Weekly Highlights Show - Matchweek 10 | J.League'}},
  {...highlight,snippet:{...highlight.snippet,title:highlight.snippet.title.replace('Antlers','Antlers U21')}},
  {...highlight,snippet:{...highlight.snippet,title:highlight.snippet.title.replace('Highlights','Goals')}},
  {...highlight,snippet:{...highlight.snippet,publishedAt:iso(-86400000)}},
  {...highlight,snippet:{...highlight.snippet,publishedAt:iso(70*3600000)}},
  {...highlight,snippet:{...highlight.snippet,liveBroadcastContent:'upcoming'}},
  {...highlight,snippet:{...highlight.snippet,channelId:'UC-unverified'}},
  {...highlight,liveStreamingDetails:{actualEndTime:iso(14*3600000)}},
  {...highlight,contentDetails:{duration:'PT59S'}},
  {...highlight,contentDetails:{duration:'PT1H30M'}},
  {...highlight,contentDetails:{duration:'PT21M'}},
  {...highlight,contentDetails:{}},
 ];
 for(const source of variants){const h=harness();h.setVideos([source]);h.setSearchResults([]);h.setMatches([finished]);assert.equal((await h.run(71*3600000)).published,0,JSON.stringify(source));}
});

test('seasonal highlights require exact canonical clubs, season and a compatible known round',async()=>{
 const h=harness();h.setVideos([{...highlight,snippet:{...highlight.snippet,title:'Kashima Antlers vs. Kashiwa Reysol | 2026/27 J1 League | Matchweek 10 | Highlights'}}]);h.setMatches([{...finished,round:'Regular Season - 10'}]);h.setSearchResults([]);
 assert.equal((await h.run(15*3600000)).published,1);
 const payload=h.cache.get(watchCacheKey(match.fixtureId)).payload;
 assert.equal(validatedWatchOptions({...finished,round:'Regular Season - 11'},payload,{now:now+15*3600000,approvals:[]}).length,0);
 for(const title of ['Kashima Antlers vs. Kashiwa Reysol | 2025/26 J1 League | Matchweek 10 | Highlights','Kashiwa Reysol vs. Kashima Antlers | 2026/27 J1 League | Matchweek 10 | Highlights']){
  const v=structuredClone(payload);v.items[0].videoTitle=title;assert.equal(validatedWatchOptions(finished,v,{now:now+15*3600000,approvals:[]}).length,0);
 }
});

test('runtime independently rejects corrupted highlight evidence, source removal and country revocation',async()=>{
 const h=harness();h.setVideos([highlight]);h.setMatches([finished]);h.setSearchResults([]);await h.run(15*3600000);
 const original=h.cache.get(watchCacheKey(match.fixtureId)).payload,options={now:now+15*3600000,approvals:[]};
 for(const patch of [{videoDuration:'PT90M'},{broadcastKind:'live'},{videoStream:{}},{publishedAt:iso(70*3600000)},{videoTitle:highlight.snippet.title+' Women'},{ageRestricted:true},{publicVideo:false}]){
  const payload=structuredClone(original);Object.assign(payload.items[0],patch);assert.equal(validatedWatchOptions(finished,payload,options).length,0,JSON.stringify(patch));
 }
 assert.equal(validatedWatchOptions(finished,original,{...options,policies:[{...WATCH_POLICIES[0],highlights:false}]}).length,0);
 assert.equal(validatedWatchOptions(finished,original,{...options,country:'US'}).length,0);
 const external=structuredClone(original);external.items[0].embeddable=false;assert.equal(validatedWatchOptions(finished,external,options)[0].embed,false,'official external link remains');
});

test('a full replay and a short overview coexist; deleted overview is withdrawn without deleting the replay',async()=>{
 const h=harness();h.setVideos([replay,highlight]);h.setMatches([finished]);h.setSearchResults([]);await h.run(15*3600000);
 assert.deepEqual(h.cache.get(watchCacheKey(match.fixtureId)).payload.items.map(v=>v.kind).sort(),['highlights','replay']);
 h.setVideos([replay]);assert.equal((await h.run(15*3600000+300000)).published,1);assert.equal(h.cache.get(watchCacheKey(match.fixtureId)).payload.items[0].kind,'replay');
});

test('ambiguous final fixtures cannot receive a standalone highlight',async()=>{
 const h=harness();h.setVideos([highlight]);h.setMatches([finished,{...finished,fixtureId:888888}]);h.setSearchResults([]);assert.equal((await h.run(15*3600000)).published,0);
});


test('fresh uploads of undated archives and missing, unknown or wrong canonical rounds fail closed',()=>{
 const p=WATCH_POLICIES[0],time=now+15*3600000;
 assert.equal(automaticHighlightsMatch(p,finished,highlight.snippet.title,highlight.snippet.publishedAt,time),true);
 for(const round of [undefined,'Unknown','Regular Season - 1'])assert.equal(automaticHighlightsMatch(p,{...finished,round},highlight.snippet.title,highlight.snippet.publishedAt,time),false);
 assert.equal(automaticHighlightsMatch(p,finished,'Kashima Antlers v Kashiwa Reysol - Highlights | J.League',highlight.snippet.publishedAt,time),false,'upload date is not the date of an undated archival match');
 const scored='Kashima Antlers 1-0 Kashiwa Reysol | MW 10 | 2026/27 J1 League Highlights';
 assert.equal(automaticHighlightsMatch(p,{...finished,score:{home:1,away:0}},scored,highlight.snippet.publishedAt,time),true);
 assert.equal(automaticHighlightsMatch(p,{...finished,score:{home:0,away:1}},scored,highlight.snippet.publishedAt,time),false);
});

test('deploying highlights reads uploads once without waiting for or repeating the existing live-search interval',async()=>{
 const h=harness();await h.run();const state=h.cache.get(WATCH_DISCOVERY_KEY);delete state.payload.uploadsAttemptedAt;
 h.setVideos([highlight]);h.setMatches([finished]);h.setSearchResults([]);const report=await h.run(15*3600000);
 assert.equal(report.published,1);
 // Simulate a legacy v1 discovery state whose live search ran one minute ago.
 const fresh=harness();fresh.cache.set(WATCH_DISCOVERY_KEY,{updatedAt:iso(-60001),payload:{version:5,attemptedAt:iso(-60000),videoIds:[],bindings:[]}});
 const first=await fresh.run();assert.equal(first.discovery,'uploads_searched');assert.equal(searchCalls(fresh),0);assert.equal(first.youtubeRequests,2);
 const second=await fresh.run(300000);assert.equal(second.discovery,'cached');assert.equal(searchCalls(fresh),0);assert.equal(second.youtubeRequests,1);
});


test('uploads failure records the attempt before I/O, does not retry every tick, and invalid upload state fails closed',async()=>{
 const h=harness();h.failUploads();const report=await h.run();assert.equal(report.discoveryError,'WATCH_DISCOVERY_SEARCH_FAILED');assert.equal(report.published,1,'optional uploads failure must not lose newly discovered LIVE sources');assert.equal(report.discovery,'partial');assert.ok(h.cache.get(WATCH_DISCOVERY_KEY).payload.videoIds.includes(video.id));
 assert.equal(h.calls.filter(c=>c.url.pathname.endsWith('/playlistItems')).length,1);assert.ok(h.cache.get(WATCH_DISCOVERY_KEY).payload.uploadsAttemptedAt);
 await h.run(300000);assert.equal(h.calls.filter(c=>c.url.pathname.endsWith('/playlistItems')).length,1);
 for(const patch of [{uploadsAttemptedAt:iso(1000)},{uploadIds:['bad-url']}]){
  const f=harness();f.cache.set(WATCH_DISCOVERY_KEY,{updatedAt:iso(-60001),payload:{version:5,attemptedAt:iso(-60000),videoIds:[],bindings:[],...patch}});
  await assert.rejects(f.run(),error=>error.code==='WATCH_DISCOVERY_STATE_INVALID');assert.equal(f.calls.filter(c=>c.url.hostname==='www.googleapis.com').length,0);
 }
});

test('separately scheduled live search retains cached upload IDs until the next uploads check',async()=>{
 const h=harness();h.cache.set(WATCH_DISCOVERY_KEY,{updatedAt:iso(-60001),payload:{version:5,attemptedAt:iso(-WATCH_DISCOVERY_INTERVAL),uploadsAttemptedAt:iso(-60000),uploadIds:[highlight.id],videoIds:[highlight.id],bindings:[]}});
 h.setVideos([highlight]);h.setSearchResults([]);await h.run();assert.ok(h.cache.get(WATCH_DISCOVERY_KEY).payload.videoIds.includes(highlight.id));assert.equal(h.calls.filter(c=>c.url.pathname.endsWith('/playlistItems')).length,0);
});


const observedHighlight={...highlight,snippet:{...highlight.snippet,title:'FIVE GOAL THRILLER! 😱 | Kashima Antlers vs Kashiwa Reysol HIGHLIGHTS | J.League',description:'Highlights from Matchweek 10 of the 2026/27 J1 League.'}};
test('observed official title requires independent season and round evidence in its description',async()=>{
 const h=harness();h.setVideos([observedHighlight]);h.setMatches([finished]);h.setSearchResults([]);await h.run(15*3600000);
 const payload=h.cache.get(watchCacheKey(match.fixtureId)).payload;assert.equal(payload.items[0].kind,'highlights');assert.equal(payload.items[0].videoDescription,observedHighlight.snippet.description);
 const options={now:now+15*3600000,approvals:[]};assert.equal(validatedWatchOptions(finished,payload,options).length,1);
 for(const description of ['', 'Subscribe for the latest highlights.','Uploaded on 2026-10-24','Matchweek 1 of the 2026/27 J1 League','Matchweek 10 of the 2025/26 J1 League','Matchweek 10 and Matchweek 1, 2026/27 J1 League','Matchweek 10 of the 2026/27 J2 League','Matchweek 10 of the 2026/27 J1 League; Match date: 2025-10-24']){
  const bad=structuredClone(payload);bad.items[0].videoDescription=description;assert.equal(validatedWatchOptions(finished,bad,options).length,0,description);
 }
});
test('an explicit match date in an official description can establish the meeting without inventing a round',()=>{
 const p=WATCH_POLICIES[0],time=now+15*3600000,title=observedHighlight.snippet.title,published=highlight.snippet.publishedAt;
 assert.equal(automaticHighlightsMatch(p,{...finished,round:undefined},title,published,time,'J1 League. Match date: 2026-10-24'),true);
 for(const description of ['Uploaded on 2026-10-24','Date: 2026-10-24','Match date: 2025-10-24','Match date: 2026-10-24; Match date: 2026-10-25','Match date: 2026-10-24; Matchweek 1; 2026/27'])assert.equal(automaticHighlightsMatch(p,finished,title,published,time,description),false,description);
});
test('observed title parsing still requires exact clubs and rejects weekly compilations, added categories or arbitrary suffixes',()=>{
 const p=WATCH_POLICIES[0],time=now+15*3600000,published=highlight.snippet.publishedAt,description=observedHighlight.snippet.description;
 for(const title of [observedHighlight.snippet.title.replace('Antlers','Antlers Women'),observedHighlight.snippet.title+' Archive','Weekly Highlights Show - Matchweek 10 | J.League 2026/27',observedHighlight.snippet.title.replace('Kashima Antlers vs Kashiwa Reysol','Kashiwa Reysol vs Kashima Antlers')])assert.equal(automaticHighlightsMatch(p,finished,title,published,time,description),false,title);
});

test('archive/category promotional prefixes and generic advertisements cannot substitute for match-specific evidence',()=>{
 const p=WATCH_POLICIES[0],time=now+15*3600000,published=highlight.snippet.publishedAt,description=observedHighlight.snippet.description;
 for(const prefix of ['ARCHIVE 2020','THROWBACK','CLASSIC MATCH','WOMEN’S MATCH','U21 YOUTH'])assert.equal(automaticHighlightsMatch(p,finished,prefix+' | Kashima Antlers vs Kashiwa Reysol HIGHLIGHTS | J.League',published,time,description),false,prefix);
 assert.equal(automaticHighlightsMatch(p,finished,observedHighlight.snippet.title,published,time,'Watch J1 League live: Matchweek 10 of the 2026/27 season.'),false);
 assert.equal(automaticHighlightsMatch(p,finished,observedHighlight.snippet.title,published,time,'ARCHIVE. '+description),false);
});


test('actual J.LEAGUE first sentence binds both clubs and season-round while generic footer text cannot',async()=>{
 const finished12={...finished,round:'Regular Season - 12'},source={...observedHighlight,snippet:{...observedHighlight.snippet,description:'Highlights from Matchweek 12 in the 2026-27 J.League between Kashima Antlers and Kashiwa Reysol.\n\nOfficial links: https://www.jleague.jp/en/'}};
 const h=harness();h.setVideos([source]);h.setMatches([finished12]);h.setSearchResults([]);const report=await h.run(15*3600000);assert.equal(report.published,1);
 const payload=h.cache.get(watchCacheKey(match.fixtureId)).payload,options={now:now+15*3600000,approvals:[]};assert.equal(validatedWatchOptions(finished12,payload,options).length,1);
 for(const description of [source.snippet.description.replace('2026-27','2025-26'),source.snippet.description.replace('Matchweek 12','Matchweek 11'),source.snippet.description.replace('and Kashiwa Reysol','and Vissel Kobe'),'Watch highlights this week.\n'+source.snippet.description,source.snippet.description+'\nMatch date: 2025-10-24',source.snippet.description+'\nMatchweek 11',source.snippet.description+'\n2025/26']){
  const bad=structuredClone(payload);bad.items[0].videoDescription=description;assert.equal(validatedWatchOptions(finished12,bad,options).length,0,description);
 }
});


test('shared viewing library is built once without extra provider reads and withdraws a removed source',async()=>{
 const h=harness();const first=await h.run();assert.equal(first.libraryMatches,1);assert.equal(first.youtubeRequests,4);
 const index=h.cache.get(WATCH_LIBRARY_KEY).payload;assert.equal(index.entries.length,1);
 const cards=watchLibraryPayload(index,{now,country:'RU',approvals:[]});assert.equal(cards.items[0].fixtureId,match.fixtureId);assert.deepEqual(cards.items[0].kinds,['live']);
 assert.doesNotMatch(JSON.stringify(cards),/videoId|eventUrl|channelId|probabilities|score/);
 h.setVideos([]);const second=await h.run(300000);assert.equal(second.libraryMatches,0);assert.equal(h.cache.get(WATCH_LIBRARY_KEY).payload.entries.length,0);
});


test('discovery v5 migrates existing bound videos without modifying the rollback v1 state',async()=>{
 const h=harness(),legacy={version:1,attemptedAt:iso(-60000),uploadsAttemptedAt:iso(-60000),videoIds:[video.id],uploadIds:[video.id],bindings:[{match,observedAt:iso(-60000),videoIds:[video.id]}]};
 h.cache.set('match-watch-discovery:v1',{payload:structuredClone(legacy),updatedAt:iso(-60000),expiresAt:now+86400000});
 const report=await h.run();assert.equal(report.discoveryMigration,'v1_to_v5');assert.equal(report.automaticPublished,1);assert.equal(searchCalls(h),0);assert.equal(report.youtubeRequests,1);assert.equal(h.cache.get(WATCH_DISCOVERY_KEY).payload.version,5);assert.deepEqual(h.cache.get('match-watch-discovery:v1').payload,legacy);
});

test('discovery v5 preserves the multi-league v2 rollback snapshot and revalidates its retained videos',async()=>{
 const h=harness(),previous={version:2,attemptedAt:iso(-60000),uploadsAttemptedAt:iso(-60000),videoIds:[video.id],uploadIds:[video.id],bindings:[{match,observedAt:iso(-60000),videoIds:[video.id]}]};
 h.cache.set(WATCH_V2_DISCOVERY_KEY,{payload:structuredClone(previous),updatedAt:iso(-60000),expiresAt:now+86400000});
 const report=await h.run();assert.equal(report.discoveryMigration,'v2_to_v5');assert.equal(report.automaticPublished,1);assert.equal(searchCalls(h),0);assert.equal(report.youtubeRequests,1);assert.equal(h.cache.get(WATCH_DISCOVERY_KEY).payload.version,5);assert.deepEqual(h.cache.get(WATCH_V2_DISCOVERY_KEY).payload,previous);
});


test('discovery v5 keeps the K LEAGUE v3 rollback snapshot intact and revalidates its videos',async()=>{
 const h=harness(),previous={version:3,attemptedAt:iso(-60000),uploadsAttemptedAt:iso(-60000),videoIds:[video.id],uploadIds:[video.id],bindings:[{match,observedAt:iso(-60000),videoIds:[video.id]}]};
 h.cache.set(WATCH_PREVIOUS_DISCOVERY_KEY,{payload:structuredClone(previous),updatedAt:iso(-60000),expiresAt:now+86400000});
 const report=await h.run();assert.equal(report.discoveryMigration,'v3_to_v5');assert.equal(report.automaticPublished,1);assert.equal(searchCalls(h),0);assert.equal(report.youtubeRequests,1);assert.equal(h.cache.get(WATCH_DISCOVERY_KEY).payload.version,5);assert.deepEqual(h.cache.get(WATCH_PREVIOUS_DISCOVERY_KEY).payload,previous);
});
