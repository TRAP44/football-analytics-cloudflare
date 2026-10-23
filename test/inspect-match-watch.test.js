import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectMatchWatch,describeWatchVideo,watchMatchHints,boundedSourceJson,WATCH_SOURCE} from '../scripts/inspect-match-watch.js';
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
