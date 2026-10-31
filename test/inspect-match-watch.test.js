import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectMatchWatch,describeWatchVideo,watchMatchHints,boundedSourceJson,WATCH_SOURCE,watchFixtureRelay} from '../scripts/inspect-match-watch.js';
const now=new Date('2026-10-23T12:00:00Z');
const env={YOUTUBE_DATA_API_KEY:'local-test-youtube-key',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'local-test-db-key'};
const video=(extra={})=>({id:'abcdefghijk',snippet:{channelId:WATCH_SOURCE.channelId,title:'Alpha Club vs Beta Club',liveBroadcastContent:'upcoming'},status:{privacyStatus:'public',embeddable:true},contentDetails:{regionRestriction:{blocked:['RU']}},liveStreamingDetails:{scheduledStartTime:'2026-10-23T15:00:00Z'},...extra});
const fixture=(extra={})=>({fixture:{id:99,date:'2026-10-23T15:00:00Z',status:{short:'NS'}},teams:{home:{id:1,name:'Alpha Club'},away:{id:2,name:'Beta Club'}},league:{id:3,name:'Senior League'},...extra});
const row=entry=>({cache_key:'provider-fixtures:2026-10-23:v1',payload:{date:'2026-10-23',fixtures:[entry]}});
function transport({videos=[video()],rows=[row(fixture())]}={}){
 const calls=[];
 return {calls,fetchImpl:async(input,options)=>{
  const url=new URL(input);calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  if(url.origin==='https://www.googleapis.com'){
   assert.equal(options.headers['X-Goog-Api-Key'],env.YOUTUBE_DATA_API_KEY);assert.equal(url.searchParams.has('key'),false);assert.equal(options.headers.apikey,undefined);
   if(url.pathname.endsWith('/channels'))return Response.json({items:[{id:WATCH_SOURCE.channelId,snippet:{customUrl:'@fifa'}}]});
   if(url.pathname.endsWith('/search'))return Response.json({items:[{id:{videoId:'abcdefghijk'}}],nextPageToken:'NEVER_FOLLOW'});
   if(url.pathname.endsWith('/videos'))return Response.json({items:videos});
  }
  assert.equal(url.origin,'https://fixture.supabase.co');assert.equal(url.pathname,'/rest/v1/analysis_cache');assert.equal(options.headers.apikey,env.SUPABASE_SECRET_KEY);assert.equal(options.headers['X-Goog-Api-Key'],undefined);
  assert.equal(url.searchParams.get('limit'),'2');assert.equal(url.searchParams.get('expires_at'),'gt.'+now.toISOString());
  assert.equal(url.searchParams.get('cache_key'),'in.(provider-fixtures:2026-10-23:v1,provider-fixtures:2026-10-24:v1)');
  assert.equal(url.searchParams.get('select'),'cache_key,payload');return Response.json(rows);
 }};
}
test('fixed official metadata scan is bounded, reuses shared football cache and never publishes playback',async()=>{
 const t=transport();const report=await inspectMatchWatch({env,now,fetchImpl:t.fetchImpl});
 assert.equal(t.calls.length,5);assert.deepEqual(report.requestCounts,{youtube:4,search:2,supabase:1});
 assert.equal(report.keyAccepted,true);assert.equal(report.channelVerified,true);assert.equal(report.videos.length,1);assert.equal(report.matchHints.length,1);
 assert.equal(report.featureReady,false);assert.equal(report.videos[0].playbackVerified,false);assert.equal(report.videos[0].fixtureVerified,false);
 assert.equal(report.videos[0].regionMetadata.find(x=>x.country==='RU').allowedByMetadata,false);
 assert.equal(report.videos[0].regionMetadata.find(x=>x.country==='GB').allowedByMetadata,true);
 const json=JSON.stringify(report);assert.ok(!json.includes(env.YOUTUBE_DATA_API_KEY));assert.ok(!json.includes(env.SUPABASE_SECRET_KEY));assert.ok(!json.includes('NEVER_FOLLOW'));
});
test('missing credentials make zero calls; failure bodies and transport exceptions never escape report',async()=>{
 let calls=0;const missing=await inspectMatchWatch({env:{},now,fetchImpl:()=>{calls++;}});assert.equal(calls,0);assert.equal(missing.errorCode,'YOUTUBE_KEY_NOT_CONFIGURED');
 const denied=await inspectMatchWatch({env,now,fetchImpl:async()=>new Response('secret key raw private message',{status:403})});assert.equal(denied.errorCode,'YOUTUBE_ACCESS_OR_QUOTA_DENIED');assert.ok(!JSON.stringify(denied).includes('secret key'));
 const broken=await inspectMatchWatch({env,now,fetchImpl:async()=>{throw Error('private key url');}});assert.equal(broken.errorCode,'YOUTUBE_TRANSPORT_FAILED');assert.ok(!JSON.stringify(broken).includes('private key'));
});
test('unexpected channel stops all searches before spending further quota',async()=>{
 let calls=0;const report=await inspectMatchWatch({env,now,fetchImpl:async()=>{calls++;return Response.json({items:[{id:'other',snippet:{customUrl:'@fifa'}}]});}});
 assert.equal(calls,1);assert.equal(report.channelVerified,false);assert.equal(report.errorCode,'YOUTUBE_CHANNEL_IDENTITY_MISMATCH');
});
test('region and live metadata never turn missing, malformed or historical data into live availability',()=>{
 const basic=describeWatchVideo(video(),now);assert.equal(basic.kind,'upcoming');
 assert.equal(describeWatchVideo(video({contentDetails:undefined}),now).regionMetadata[0].allowedByMetadata,null);
 for(const restrictions of [{allowed:'RU'},{allowed:['RU'],blocked:['GB']},null,{}]){
  assert.equal(describeWatchVideo(video({contentDetails:{regionRestriction:restrictions}}),now).regionMetadata[0].allowedByMetadata,null);
 }
 assert.equal(describeWatchVideo(video({contentDetails:{regionRestriction:{allowed:['RU']}}}),now).regionMetadata[0].allowedByMetadata,true);
 assert.equal(describeWatchVideo(video({liveStreamingDetails:{actualStartTime:'2026-10-22T09:00:00Z',actualEndTime:'2026-10-22T11:00:00Z'}}),now).kind,'ended');
 assert.equal(describeWatchVideo(video({snippet:{...video().snippet,liveBroadcastContent:'live'},liveStreamingDetails:{actualStartTime:'2026-10-24T11:00:00Z'}}),now).kind,'unconfirmed');
 assert.equal(describeWatchVideo(video({snippet:{...video().snippet,channelId:'foreign'}}),now),null);
 assert.equal(describeWatchVideo(video({id:'../../bad'}),now),null);
});
test('matching emits only review hints; wrong time, missing team, cancelled or unrelated cache never match',()=>{
 const videos=[describeWatchVideo(video(),now)];assert.equal(watchMatchHints(videos,[row(fixture())]).length,1);
 for(const entry of [fixture({fixture:{id:99,date:'2026-10-23T16:00:00Z',status:{short:'NS'}}}),fixture({teams:{home:{id:1,name:'Other Club'},away:{id:2,name:'Beta Club'}}}),fixture({fixture:{id:99,date:'2026-10-23T15:00:00Z',status:{short:'PST'}}})])assert.equal(watchMatchHints(videos,[row(entry)]).length,0);
 assert.equal(watchMatchHints(videos,[{...row(fixture()),cache_key:'user:private'}]).length,0);
 assert.equal(watchMatchHints(videos,[row(fixture())])[0].scope,'title_time_candidate_not_approved');
});
test('read failure, hostile database URL, duplicate video and oversized bodies stay bounded',async()=>{
 const t=transport({videos:[video(),video()]});assert.equal((await inspectMatchWatch({env,now,fetchImpl:t.fetchImpl})).videos.length,1);
 const dbFail=transport();const report=await inspectMatchWatch({env:{...env,SUPABASE_URL:'https://127.0.0.1/'},now,fetchImpl:dbFail.fetchImpl});assert.equal(report.matchCacheStatus,'unavailable');assert.equal(dbFail.calls.length,4);
 const bad=await inspectMatchWatch({env,now,fetchImpl:async()=>new Response('x'.repeat(256001))});assert.equal(bad.errorCode,'SOURCE_RESPONSE_TOO_LARGE');
 await assert.rejects(boundedSourceJson(new Response('not json')),/SOURCE_INVALID_JSON/);
});
test('existing protected observer keeps key server-side and exact main-only secret boundary',()=>{
 const workflow=readFileSync('.github/workflows/live-usage-report.yml','utf8');
 assert.match(workflow,/if: github.ref == 'refs\/heads\/main'/);assert.match(workflow,/environment: background-jobs/);
 assert.match(workflow,/if: \$\{\{ !cancelled\(\) && inputs.inspect_watch == true \}\}/);assert.match(workflow,/YOUTUBE_DATA_API_KEY: \$\{\{ secrets.YOUTUBE_DATA_API_KEY \}\}/);
 assert.match(workflow,/run: node scripts\/inspect-match-watch.js/);
 assert.ok(!workflow.includes('pull_request_target'));assert.ok(!workflow.includes('secrets: inherit'));
});

test('new publisher and one canonical football fixture use separate fixed hosts and never auto-approve',async()=>{
 const calls=[];
 const selected={...env,SUPABASE_URL:'https://nlmvhkjkpgzzlfavaohk.supabase.co',MATCH_WATCH_PUBLISHER:'sgpremierleague',MATCH_WATCH_FIXTURE_ID:'99',API_FOOTBALL_KEY:'local-football-fixture-key'};
 const fetchImpl=async(input,options)=>{
  const url=new URL(input);calls.push({url,options});
  if(url.hostname==='www.googleapis.com'){
   assert.equal(options.headers['x-apisports-key'],undefined);assert.equal(options.headers.apikey,undefined);
   if(url.pathname.endsWith('/channels')){assert.equal(url.searchParams.get('forHandle'),'sgpremierleague');return Response.json({items:[{id:'UCiJTKr-wja_JVM2dVTYCELA',snippet:{customUrl:'@SGPremierLeague'}}]});}
   if(url.pathname.endsWith('/search'))return Response.json({items:[{id:{videoId:'abcdefghijk'}}]});
   return Response.json({items:[video({snippet:{...video().snippet,channelId:'UCiJTKr-wja_JVM2dVTYCELA'}})]});
  }
  if(url.pathname==='/functions/v1/football-relay/fixtures'){
   assert.equal(url.hostname,'nlmvhkjkpgzzlfavaohk.supabase.co');assert.equal(url.searchParams.get('id'),'99');assert.equal([...url.searchParams.keys()].length,1);
   assert.equal(options.headers['x-apisports-key'],selected.API_FOOTBALL_KEY);assert.equal(options.headers['X-Goog-Api-Key'],undefined);assert.equal(options.headers.apikey,undefined);
   return Response.json({errors:[],response:[fixture({league:{id:3,name:'Senior League',season:2026}})]});
  }
  assert.equal(url.hostname,'nlmvhkjkpgzzlfavaohk.supabase.co');assert.equal(options.headers['x-apisports-key'],undefined);
  if(url.pathname.endsWith('/claim_provider_request')){assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{p_bucket_key:'api-football:minute',p_limit:4,p_window_seconds:60});return Response.json({allowed:true});}
  return Response.json([]);
 };
 const report=await inspectMatchWatch({env:selected,now,fetchImpl});assert.equal(calls.length,8);
 assert.equal(report.channelVerified,true);assert.equal(report.fixtureCheck.verified,true);assert.equal(report.fixtureCheck.match.season,2026);assert.match(report.fixtureCheck.fixtureIdentity,/^99:1:2:3:2026:/);
 assert.equal(report.requestCounts.football,1);assert.equal(report.featureReady,false);assert.equal(report.videos[0].fixtureVerified,false);
 assert.ok(!JSON.stringify(report).includes(selected.API_FOOTBALL_KEY));
});

test('unknown publishers or malformed fixture IDs fail before any transport',async()=>{
 for(const patch of [{MATCH_WATCH_PUBLISHER:'untrusted'},{MATCH_WATCH_FIXTURE_ID:'99&host=evil'},{MATCH_WATCH_FIXTURE_ID:'2000000001'}]){
  let calls=0;const report=await inspectMatchWatch({env:{...env,...patch},now,fetchImpl:()=>{calls++;}});assert.equal(calls,0);assert.match(report.errorCode,/^WATCH_(SOURCE_NOT_ALLOWED|FIXTURE_ID_INVALID)$/);
 }
});

test('targeted fixture errors never expose raw provider data or accept another fixture',async()=>{
 for(const payload of [{errors:{quota:'private diagnostic'},response:[]},{errors:[],response:[fixture({fixture:{id:100,date:'2026-10-23T15:00:00Z'},league:{id:3,name:'League',season:2026}})]},{errors:[],response:[fixture()]}]){
  const upstream=transport();
  const report=await inspectMatchWatch({env:{...env,SUPABASE_URL:'https://nlmvhkjkpgzzlfavaohk.supabase.co',MATCH_WATCH_FIXTURE_ID:'99',API_FOOTBALL_KEY:'local-football-fixture-key'},now,fetchImpl:async(input,options)=>{const url=new URL(input);if(url.pathname==='/functions/v1/football-relay/fixtures')return Response.json(payload);if(url.hostname.endsWith('.supabase.co'))return Response.json(url.pathname.endsWith('/claim_provider_request')?{allowed:true}:[]);return upstream.fetchImpl(input,options);}});
  assert.equal(report.fixtureCheck.verified,false);assert.equal(report.errorCode,'WATCH_FIXTURE_VERIFICATION_FAILED');assert.ok(!JSON.stringify(report).includes('private diagnostic'));
 }
});


test('fixture probe uses trusted configured relay and fails closed on cooldown, quota or ambiguous claim',async()=>{
 const configured=readFileSync('wrangler.jsonc','utf8');assert.equal(watchFixtureRelay(configured).pathname,'/functions/v1/football-relay');
 for(const destination of ['https://evil.example/functions/v1/football-relay','https://nlmvhkjkpgzzlfavaohk.supabase.co/other','https://v3.football.api-sports.io','http://nlmvhkjkpgzzlfavaohk.supabase.co/functions/v1/football-relay'])assert.equal(watchFixtureRelay(JSON.stringify({vars:{API_FOOTBALL_BASE_URL:destination}})),null);
 for(const scenario of ['cooldown','reserve','minute','claim_denied','claim_unknown','claim_timeout','wrong_project']){
  let footballCalls=0,claims=0;const yt=transport();
  const selected={...env,SUPABASE_URL:scenario==='wrong_project'?env.SUPABASE_URL:'https://nlmvhkjkpgzzlfavaohk.supabase.co',MATCH_WATCH_FIXTURE_ID:'99',API_FOOTBALL_KEY:'local-football-fixture-key',API_FOOTBALL_BASE_URL:'https://evil.example/'};
  const report=await inspectMatchWatch({env:selected,now,fetchImpl:async(input,options)=>{
   const url=new URL(input);
   if(url.hostname==='www.googleapis.com')return yt.fetchImpl(input,options);
   assert.equal(url.hostname,'nlmvhkjkpgzzlfavaohk.supabase.co');
   if(url.pathname.includes('football-relay')){footballCalls++;throw Error('must not call provider');}
   assert.equal(options.headers['x-apisports-key'],undefined);
   if(url.pathname.endsWith('/claim_provider_request')){claims++;if(scenario==='claim_timeout')throw Error('secret private failure');return Response.json(scenario==='claim_denied'?{allowed:false}:{});}
   const payload=scenario==='cooldown'?{cooldownUntil:'2026-10-23T12:01:00Z'}:{plan:'FREE',updatedAt:now.toISOString(),dailyRemaining:scenario==='reserve'?20:90,minuteRemaining:scenario==='minute'?0:5};
   return Response.json([{cache_key:scenario==='cooldown'?'provider-state:api-football:cooldown:v1':'provider-state:api-football:quota:v1',payload}]);
  }});
  assert.equal(footballCalls,0,scenario);assert.equal(report.fixtureCheck.verified,false);assert.equal(report.errorCode,'WATCH_FIXTURE_VERIFICATION_FAILED');
  assert.equal(claims,scenario.startsWith('claim_')?1:0);assert.ok(!JSON.stringify(report).includes('secret private'));
 }
});

test('bounded public candidate research never verifies publisher authority or changes approvals',async()=>{
 const calls=[];const pinned=readFileSync('src/match-watch-approvals.json','utf8');
 const report=await inspectMatchWatch({env:{YOUTUBE_DATA_API_KEY:env.YOUTUBE_DATA_API_KEY,MATCH_WATCH_CANDIDATE_HANDLE:'GermanFootball'},now,fetchImpl:async(input,options)=>{
  const url=new URL(input);calls.push(url);assert.equal(url.origin,'https://www.googleapis.com');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers['X-Goog-Api-Key'],env.YOUTUBE_DATA_API_KEY);
  if(url.pathname.endsWith('/channels')){assert.equal(url.searchParams.get('forHandle'),'germanfootball');return Response.json({items:[{id:WATCH_SOURCE.channelId,snippet:{customUrl:'@GermanFootball'}}]});}
  if(url.pathname.endsWith('/search')){assert.equal(url.searchParams.get('channelId'),WATCH_SOURCE.channelId);return Response.json({items:[{id:{videoId:'abcdefghijk'}}]});}
  return Response.json({items:[video()]});
 }});
 assert.equal(calls.length,4);assert.equal(report.keyAccepted,true);assert.equal(report.channelVerified,false);assert.equal(report.featureReady,false);assert.equal(report.sourceStatus,'unverified_research_candidate');assert.equal(report.source.authorityUrl,null);assert.equal(report.source.channelId,WATCH_SOURCE.channelId);assert.equal(report.videos[0].fixtureVerified,false);assert.equal(readFileSync('src/match-watch-approvals.json','utf8'),pinned);
 for(const handle of ['../../bad','https://evil.example','handle&key=private','@GermanFootball','a'.repeat(31)]){
  let requests=0;const bad=await inspectMatchWatch({env:{...env,MATCH_WATCH_CANDIDATE_HANDLE:handle},now,fetchImpl:()=>{requests++;}});assert.equal(requests,0);assert.equal(bad.errorCode,'WATCH_CANDIDATE_HANDLE_INVALID');
 }
});

test('search territory is explicit and the result cap is enforced before video lookup',async()=>{
 for(const country of ['RU','SG']){
  let searches=0;const t=transport();const report=await inspectMatchWatch({env:{...env,MATCH_WATCH_SEARCH_COUNTRY:country},now,fetchImpl:(input,options)=>{
   const url=new URL(input);if(url.pathname.endsWith('/search')){searches++;assert.equal(url.searchParams.get('regionCode'),country);}
   return t.fetchImpl(input,options);
  }});assert.equal(searches,2);assert.equal(report.searchCountry,country);
 }
 let calls=0;const bad=await inspectMatchWatch({env:{...env,MATCH_WATCH_SEARCH_COUNTRY:'RU&key=private'},now,fetchImpl:()=>{calls++;}});assert.equal(calls,0);assert.equal(bad.searchCountry,null);assert.equal(bad.errorCode,'WATCH_SEARCH_COUNTRY_INVALID');
 const both=await inspectMatchWatch({env:{...env,MATCH_WATCH_SEARCH_COUNTRY:'private',MATCH_WATCH_CANDIDATE_HANDLE:'bad&handle'},now,fetchImpl:()=>assert.fail('invalid input transported')});assert.equal(both.searchCountry,null);assert.equal(both.source.handle,null);
 const t=transport();let videos=0;const oversized=await inspectMatchWatch({env,now,fetchImpl:(input,options)=>{
  const url=new URL(input);if(url.pathname.endsWith('/search'))return Response.json({items:Array.from({length:11},()=>({id:{videoId:'abcdefghijk'}}))});
  if(url.pathname.endsWith('/videos'))videos++;
  return t.fetchImpl(input,options);
 }});assert.equal(videos,0);assert.equal(oversized.errorCode,'YOUTUBE_SEARCH_RESPONSE_INVALID');
});

test('uploads inspection uses three cheap fixed-host calls and preserves independent matching metadata without approving',async()=>{
 const calls=[];
 const sourceVideo=video({snippet:{channelId:WATCH_SOURCE.channelId,title:'Alpha vs Beta | Full Match',liveBroadcastContent:'none',publishedAt:'2026-10-22T12:00:00Z',description:'Matchweek 7\nIndependent event date'},contentDetails:{duration:'PT1H45M',regionRestriction:{blocked:['RU']}},liveStreamingDetails:{actualStartTime:'2026-10-22T10:00:00Z',actualEndTime:'2026-10-22T11:45:00Z'}});
 const report=await inspectMatchWatch({env:{...env,MATCH_WATCH_FEED:'uploads'},now,fetchImpl:async(input,options)=>{
  const url=new URL(input);calls.push(url);assert.equal(url.origin,'https://www.googleapis.com');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  if(url.pathname.endsWith('/channels'))return Response.json({items:[{id:WATCH_SOURCE.channelId,snippet:{customUrl:'@fifa'}}]});
  if(url.pathname.endsWith('/playlistItems')){assert.equal(url.searchParams.get('playlistId'),'UU'+WATCH_SOURCE.channelId.slice(2));assert.equal(url.searchParams.get('maxResults'),'20');return Response.json({items:[{contentDetails:{videoId:sourceVideo.id}}],nextPageToken:'DO_NOT_FOLLOW'});}
  assert.ok(url.pathname.endsWith('/videos'));assert.equal(url.searchParams.get('id'),sourceVideo.id);return Response.json({items:[sourceVideo]});
 }});
 assert.equal(calls.length,3);assert.equal(report.requestCounts.search,0);assert.equal(report.requestCounts.supabase,0);assert.equal(report.featureReady,false);assert.equal(report.videos[0].fixtureVerified,false);assert.equal(report.videos[0].description,sourceVideo.snippet.description);assert.equal(report.videos[0].duration,'PT1H45M');assert.equal(report.videos[0].publishedAt,'2026-10-22T12:00:00.000Z');assert.equal(report.videos[0].regionMetadata.find(x=>x.country==='RU').allowedByMetadata,false);
 let invalidCalls=0;const bad=await inspectMatchWatch({env:{...env,MATCH_WATCH_FEED:'https://bad.invalid'},now,fetchImpl:()=>{invalidCalls++;}});assert.equal(invalidCalls,0);assert.equal(bad.feed,null);assert.equal(bad.errorCode,'WATCH_FEED_INVALID');
});

test('one guarded date batch exposes canonical public fixtures with rounds without per-match fanout',async()=>{
 const urls=[];const selected={...env,SUPABASE_URL:'https://nlmvhkjkpgzzlfavaohk.supabase.co',API_FOOTBALL_KEY:'local-football-fixture-key',MATCH_WATCH_FEED:'uploads',MATCH_WATCH_FIXTURE_DATE:'2026-10-23'};
 const report=await inspectMatchWatch({env:selected,now,fetchImpl:async(input,options)=>{
  const url=new URL(input);urls.push(url);
  if(url.origin==='https://www.googleapis.com'){
   if(url.pathname.endsWith('/channels'))return Response.json({items:[{id:WATCH_SOURCE.channelId,snippet:{customUrl:'@fifa'}}]});
   if(url.pathname.endsWith('/playlistItems'))return Response.json({items:[]});
   assert.fail('no video ids');
  }
  assert.equal(url.origin,'https://nlmvhkjkpgzzlfavaohk.supabase.co');
  if(url.pathname.endsWith('/claim_provider_request'))return Response.json({allowed:true});
  if(url.pathname.includes('/football-relay/')){
   assert.equal(options.headers['x-apisports-key'],selected.API_FOOTBALL_KEY);assert.equal(options.headers.apikey,undefined);assert.equal(url.searchParams.get('date'),'2026-10-23');assert.equal(url.searchParams.get('timezone'),'UTC');assert.equal(url.searchParams.has('id'),false);
   return Response.json({errors:[],response:[fixture({league:{id:3,name:'Senior League',season:2026,round:'Regular Season - 7'}}),fixture({fixture:{id:100,date:'2026-10-23T16:00:00Z',status:{short:'NS'}},league:{id:3,name:'Senior League',season:2026,round:'Regular Season - 7'}})]});
  }
  return Response.json([]);
 }});
 assert.equal(report.errorCode,undefined);assert.equal(report.fixtureBatch.verified,true);assert.equal(report.fixtureBatch.matches.length,2);assert.equal(report.fixtureBatch.matches[0].round,'Regular Season - 7');assert.equal(report.requestCounts.football,1);assert.equal(urls.filter(u=>u.pathname.includes('/football-relay/')).length,1);assert.equal(report.featureReady,false);
 for(const patch of [{MATCH_WATCH_FIXTURE_DATE:'2026-02-30'},{MATCH_WATCH_FIXTURE_DATE:'2026-10-01'},{MATCH_WATCH_FIXTURE_DATE:'2026-10-25'},{MATCH_WATCH_FIXTURE_DATE:'2026-10-23&key=secret'},{MATCH_WATCH_FIXTURE_ID:'99'}]){
  let calls=0;const bad=await inspectMatchWatch({env:{...selected,...patch},now,fetchImpl:()=>{calls++;}});assert.equal(calls,0);assert.equal(bad.errorCode,'WATCH_FIXTURE_DATE_INVALID');
 }
});

test('completed inspection makes one bounded newest-first search and never reads users or publishes',async()=>{
 const calls=[],sourceVideo=video({liveStreamingDetails:{actualStartTime:'2026-10-22T10:00:00Z',actualEndTime:'2026-10-22T11:45:00Z'}});
 const report=await inspectMatchWatch({env:{...env,MATCH_WATCH_FEED:'completed'},now,fetchImpl:async(input,options)=>{
  const url=new URL(input);calls.push(url);assert.equal(url.origin,'https://www.googleapis.com');assert.equal(options.redirect,'error');
  if(url.pathname.endsWith('/channels'))return Response.json({items:[{id:WATCH_SOURCE.channelId,snippet:{customUrl:'@fifa'}}]});
  if(url.pathname.endsWith('/search')){assert.equal(url.searchParams.get('eventType'),'completed');assert.equal(url.searchParams.get('order'),'date');assert.equal(url.searchParams.get('type'),'video');assert.equal(url.searchParams.get('maxResults'),'10');return Response.json({items:[{id:{videoId:sourceVideo.id}}],nextPageToken:'NOT_FOLLOWED'});}
  assert.ok(url.pathname.endsWith('/videos'));return Response.json({items:[sourceVideo]});
 }});
 assert.equal(report.errorCode,undefined);assert.equal(report.feed,'completed');assert.equal(calls.length,3);assert.equal(report.requestCounts.search,1);assert.equal(report.requestCounts.supabase,0);assert.equal(report.featureReady,false);assert.equal(report.videos[0].kind,'ended');assert.equal(report.videos[0].fixtureVerified,false);
});
