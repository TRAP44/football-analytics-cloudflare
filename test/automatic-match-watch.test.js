import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshMatchWatch} from '../scripts/refresh-match-watch.js';
import {WATCH_DISCOVERY_KEY,WATCH_DISCOVERY_INTERVAL} from '../scripts/discover-match-watch.js';
import {WATCH_POLICIES,automaticWatchMatch} from '../src/match-watch-policy.js';
import {validatedWatchOptions,watchCacheKey} from '../src/match-watch.js';
import {createUserDataApiRuntime} from '../src/user-data-api-runtime.js';
import {matchCenterCacheKey} from '../src/match-center-cache-key.js';
const now=Date.parse('2026-10-23T21:00:00Z'),iso=offset=>new Date(now+offset).toISOString();
const match={fixtureId:777777,date:iso(12*3600000),status:'NS',home:{id:290,name:'Kashima'},away:{id:281,name:'Kashiwa Reysol'},leagueId:98,league:'J1 League',season:2027,finished:false};
const video={id:'abcdefghijk',snippet:{channelId:WATCH_POLICIES[0].channelId,title:'Kashima Antlers v Kashiwa Reysol - Live Match | J.League',liveBroadcastContent:'upcoming'},status:{privacyStatus:'public',embeddable:true},contentDetails:{},liveStreamingDetails:{scheduledStartTime:iso(12*3600000-300000)}};
const raw=m=>({fixture:{id:m.fixtureId,date:m.date,status:{short:m.status}},teams:{home:m.home,away:m.away},league:{id:m.leagueId,name:m.league,season:m.season}});
function harness(){
 const cache=new Map(),calls=[];let items=[structuredClone(video)],matches=[structuredClone(match)],failSearch=false,failWrite=false;
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'db-test-secret',YOUTUBE_DATA_API_KEY:'youtube-test-secret'};
 const fetchImpl=async(value,init)=>{
  const url=new URL(value);calls.push({url,init});
  assert.equal(init.redirect,'error');
  if(url.hostname==='www.googleapis.com'){
   assert.equal(init.headers.apikey,undefined);assert.equal(init.headers['X-Goog-Api-Key'],env.YOUTUBE_DATA_API_KEY);
   if(url.pathname.endsWith('/search')){if(failSearch)throw Error('private upstream text');return Response.json({items:items.map(v=>({id:{videoId:v.id}}))});}
   assert.ok(url.pathname.endsWith('/videos'));assert.ok(url.searchParams.get('id').split(',').length<=50);return Response.json({items});
  }
  assert.equal(url.hostname,'example.supabase.co');assert.equal(init.headers['X-Goog-Api-Key'],undefined);
  if(init.method==='POST'){
   assert.equal(url.pathname,'/rest/v1/rpc/write_analysis_cache_versioned');if(failWrite)throw Error('write outcome unknown');
   const body=JSON.parse(init.body),previous=cache.get(body.p_cache_key);
   // Model the real versioned RPC: repeated differing content at the same
   // timestamp cannot overwrite the search-attempt marker.
   if(previous&&previous.updatedAt>=body.p_updated_at)return Response.json({stored:false,reason:'superseded'});
   cache.set(body.p_cache_key,{payload:body.p_payload,updatedAt:body.p_updated_at});return Response.json({stored:true,reason:'stored'});
  }
  assert.equal(url.pathname,'/rest/v1/analysis_cache');const key=url.searchParams.get('cache_key');
  if(key===`eq.${WATCH_DISCOVERY_KEY}`)return Response.json(cache.has(WATCH_DISCOVERY_KEY)?[{cache_key:WATCH_DISCOVERY_KEY,payload:cache.get(WATCH_DISCOVERY_KEY).payload}]:[]);
  if(key.startsWith('in.(provider-fixtures:'))return Response.json([{cache_key:'provider-fixtures:2026-10-24:v1',payload:{date:'2026-10-24',fetchedAt:iso(-60000),fixtures:matches.map(raw)}}]);
  if(key.startsWith('like.'))return Response.json([]);
  assert.match(key,/^in\.\(match-center:/);return Response.json([]);
 };
 const run=(offset=0)=>refreshMatchWatch({env,manifest:{version:1,items:[]},automatic:true,fetchImpl,now:now+offset});
 return {run,cache,calls,setVideos:v=>{items=v;},setMatches:m=>{matches=m;},failSearch:()=>{failSearch=true;},failWrite:()=>{failWrite=true;}};
}
const apiRuntime=deps=>createUserDataApiRuntime(new Proxy(deps,{get:(target,key)=>key in target?target[key]:async()=>[]}));
const searchCalls=h=>h.calls.filter(call=>call.url.pathname.endsWith('/search')).length;

test('a previously undeployed fixture/video is discovered, bound and published without a per-match approval',async()=>{
 const h=harness(),report=await h.run();
 assert.equal(report.discovery,'searched');assert.equal(report.automaticMatched,1);assert.equal(report.automaticPublished,1);assert.equal(report.youtubeRequests,3);assert.equal(searchCalls(h),2);
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
 const h=harness();h.failSearch();const report=await h.run();assert.equal(report.discovery,'failed_retaining_previous');assert.equal(report.discoveryError,'WATCH_DISCOVERY_SEARCH_FAILED');
 assert.ok(h.cache.get(WATCH_DISCOVERY_KEY).payload.attemptedAt);assert.equal(searchCalls(h),1);
 await h.run(300000);assert.equal(searchCalls(h),1);
 const unknown=harness();unknown.failWrite();await assert.rejects(unknown.run(),e=>e.code==='WATCH_WRITE_UNCONFIRMED');assert.equal(searchCalls(unknown),0);assert.equal(unknown.calls.filter(call=>call.init.method==='POST').length,1);
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
  const h=harness();h.cache.set(WATCH_DISCOVERY_KEY,{updatedAt:iso(-1),payload:{version:1,attemptedAt:iso(-60000),videoIds:[],bindings:[],...patch}});
  await assert.rejects(h.run(),e=>e.code==='WATCH_DISCOVERY_STATE_INVALID');assert.equal(searchCalls(h),0);
 }
});
