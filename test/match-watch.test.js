import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {watchFixtureIdentity,watchCacheKey,watchApiPayload,validatedWatchOptions,officialWatchUrl,WATCH_PUBLISHERS,WATCH_TTL_MS} from '../src/match-watch.js';
import {matchCenterCacheKey} from '../src/match-center-cache-key.js';
import {refreshMatchWatch,approvedYoutubeItem,validateWatchApprovals} from '../scripts/refresh-match-watch.js';
import {youtubeEmbedUrl} from '../public/modules/match-watch.js';
import {createUserDataApiRuntime} from '../src/user-data-api-runtime.js';
import {dispatchApiRoute} from '../src/router.js';
import {auditWorkflow} from '../scripts/privileged-access-audit.js';

const now=Date.now(),iso=offset=>new Date(now+offset).toISOString();
const match={fixtureId:999,home:{id:55,name:'Fixture Home'},away:{id:56,name:'Fixture Away'},leagueId:39,season:2026,date:iso(-60000),live:true,finished:false,status:'1H'};
const approval={match,provider:'youtube',publisher:'fifa',videoId:'abcdefghijk',eventUrl:'https://www.youtube.com/watch?v=abcdefghijk',kind:'live',access:'free',countries:['RU','KZ'],confirmed:true,confirmedAt:iso(-60000),validUntil:iso(3600000)};
const manifest={version:1,items:[approval]};
const video={id:approval.videoId,snippet:{channelId:WATCH_PUBLISHERS.fifa,liveBroadcastContent:'live'},status:{privacyStatus:'public',embeddable:true},contentDetails:{},liveStreamingDetails:{actualStartTime:match.date,scheduledStartTime:match.date}};
const catalogue=()=>({version:1,fixtureIdentity:watchFixtureIdentity(match),items:[{...approval,channelId:WATCH_PUBLISHERS.fifa,publicVideo:true,embeddable:true,ageRestricted:false,regionVerified:true,checkedAt:iso(0),expiresAt:iso(WATCH_TTL_MS),approval:{version:1,confirmed:true,confirmedAt:approval.confirmedAt,fixtureIdentity:watchFixtureIdentity(match)}}]});
const options={now,approvals:[approval]};
function apiRuntime(overrides={}){
 const functions='addFavorite addFavoritePlayer addReminder analysisFreshness analysisResponsePayload getBotDigestSubscription getCache getFavoritePlayers getFavorites getHistory getPreferences getQuota getReminders getStaleCache getUserRecord isAdminUser publicDataCapabilities publicDigestSettings publicPlayerFollowNotificationContract publicRuntimeControls publicSiteUrl publicSmartNotificationCapabilities recordOpsEvent reminderDeliveryStatus removeFavorite removeFavoritePlayer removeReminder savePreferences setBotDigestSubscription'.split(' ');
 return createUserDataApiRuntime({...Object.fromEntries(functions.map(key=>[key,async()=>[]])),json:(data,status=200)=>Response.json(data,{status}),watchApprovals:[approval],...overrides});
}

test('watch requires an exact canonical fixture and deployed approval; revoked cache is rejected immediately',()=>{
 const data=catalogue();assert.equal(validatedWatchOptions(match,data,options).length,1);
 assert.deepEqual(validatedWatchOptions(match,{...data,items:[null,{countries:'RU'}]},options),[]);
 for(const patch of [{date:iso(60000)},{season:2025},{leagueId:40},{home:{id:56}},{fixtureId:998},{status:'PST'}])assert.deepEqual(validatedWatchOptions({...match,...patch},data,options),[]);
 assert.deepEqual(validatedWatchOptions(match,data,{...options,approvals:[]}),[]);
 assert.deepEqual(validatedWatchOptions(match,data,{...options,approvals:[{...approval,countries:['KZ']}]}),[]);
 assert.deepEqual(validatedWatchOptions(match,data,{...options,approvals:[{...approval,validUntil:iso(-1)}]}),[]);
 assert.deepEqual(validatedWatchOptions(match,data),[],'empty production manifest cannot publish synthetic data');
});

test('explicit country is required for links; choices survive a country with no approved coverage',()=>{
 const initial=watchApiPayload(match,catalogue(),options);assert.equal(initial.items.length,0);assert.equal(initial.countries.length,2);
 const ru=watchApiPayload(match,catalogue(),{...options,country:'RU'});assert.equal(ru.items.length,1);assert.equal(ru.items[0].embed,true);
 const gb=watchApiPayload(match,catalogue(),{...options,country:'GB'});assert.equal(gb.items.length,0);assert.equal(gb.countries.length,2);
});

test('unverified, expired, distant future, long TTL and unapproved publisher data never reach the client',()=>{
 for(const patch of [{checkedAt:iso(60000)},{expiresAt:iso(-1)},{expiresAt:iso(WATCH_TTL_MS+1)},{publicVideo:false},{regionVerified:false},{ageRestricted:true},{channelId:'unknown'},{kind:'replay'},{approval:{confirmed:true}}]){
  const data=catalogue();Object.assign(data.items[0],patch);assert.equal(validatedWatchOptions(match,data,options).length,0,JSON.stringify(patch));
 }
});

test('only canonical official event URLs and on-click YouTube embeds are allowed',()=>{
 assert.equal(officialWatchUrl('youtube',approval.eventUrl),approval.eventUrl);
 for(const url of ['javascript:alert(1)','https://www.youtube.com.evil.test/watch?v=abcdefghijk','https://x:www@www.youtube.com/watch?v=abcdefghijk','https://www.youtube.com/watch?v=abcdefghijk&x=1','https://www.youtube.com/watch?v=abcdefghijk#x','https://www.youtube.com/redirect?q=x','http://www.youtube.com/watch?v=abcdefghijk'])assert.equal(officialWatchUrl('youtube',url),'');
 assert.equal(youtubeEmbedUrl({provider:'youtube',videoId:approval.videoId,eventUrl:approval.eventUrl,embed:true},'https://app.example').includes('autoplay=0'),true);
 assert.equal(youtubeEmbedUrl({provider:'youtube',videoId:approval.videoId,eventUrl:'https://evil.test',embed:true},'https://app.example'),'');
 const data=catalogue();data.items[0].embeddable=false;assert.equal(validatedWatchOptions(match,data,options)[0].embed,false);
});

test('source metadata respects publisher, region, age and live versus archival premiere distinction',()=>{
 assert.equal(approvedYoutubeItem(approval,video,match,now).countries.length,2);
 assert.equal(approvedYoutubeItem(approval,{...video,contentDetails:{regionRestriction:{blocked:['RU']}}},match,now).countries.join(','),'KZ');
 for(const patch of [{snippet:{channelId:'unknown'}},{status:{privacyStatus:'private'}},{contentDetails:null},{contentDetails:{regionRestriction:{allowed:['RU'],blocked:['KZ']}}},{contentDetails:{contentRating:{ytRating:'ytAgeRestricted'}}},{liveStreamingDetails:{scheduledStartTime:iso(3600000)}}])assert.equal(approvedYoutubeItem(approval,{...video,...patch},match,now),null);
 const replay={...approval,kind:'replay'};assert.equal(approvedYoutubeItem(replay,video,{...match,finished:true},now),null);
 assert.equal(approvedYoutubeItem(replay,{...video,snippet:{...video.snippet,liveBroadcastContent:'none'},liveStreamingDetails:{actualEndTime:iso(-1000)}},{...match,finished:true},now).kind,'replay');
});

test('manifest is bounded, finite and never automatically approves title/time candidates',()=>{
 assert.equal(validateWatchApprovals(manifest,now).length,1);
 for(const patch of [{confirmed:false},{match:{...match,season:0}},{countries:['XX']},{validUntil:iso(8*86400000)},{eventUrl:'https://evil.test'},{publisher:'random'}])assert.throws(()=>validateWatchApprovals({version:1,items:[{...approval,...patch}]},now));
 assert.throws(()=>validateWatchApprovals({version:1,items:[approval,approval]},now));
 assert.deepEqual(validateWatchApprovals({version:1,items:[{...approval,validUntil:iso(-1)}]},now),[]);
});

function refreshFixture({source=video,rows=[{cache_key:matchCenterCacheKey(999),payload:{match}}],write=()=>Response.json({stored:true,reason:'stored'})}={}){
 const calls=[];
 const fetchImpl=async(url,init)=>{calls.push({url:String(url),init});const u=new URL(url);
  if(u.hostname==='www.googleapis.com')return Response.json({items:source?[source]:[]});
  if(u.pathname==='/rest/v1/analysis_cache')return Response.json(rows);
  if(u.pathname==='/rest/v1/rpc/write_analysis_cache_versioned')return write(url,init);
  throw Error('unexpected');};
 const run=()=>refreshMatchWatch({env:{YOUTUBE_DATA_API_KEY:'local-fixture-key',SUPABASE_URL:'https://local-fixture.supabase.co',SUPABASE_SECRET_KEY:'local-fixture-db'},manifest,fetchImpl,now});
 return {calls,run};
}
test('refresh batches metadata, writes only shared versioned catalogue and never sends secrets to the wrong host',async()=>{
 const h=refreshFixture();const report=await h.run();assert.equal(report.published,1);assert.equal(h.calls.length,3);
 const yt=h.calls.find(call=>call.url.includes('googleapis'));assert.equal(yt.init.headers['X-Goog-Api-Key'],'local-fixture-key');assert.equal(yt.url.includes('key='),false);assert.equal(yt.init.headers.apikey,undefined);
 const db=h.calls.filter(call=>call.url.includes('supabase'));assert.ok(db.every(call=>!call.init.headers['X-Goog-Api-Key']));
 const body=JSON.parse(db.at(-1).init.body);assert.equal(body.p_cache_key,watchCacheKey(999));assert.equal(body.p_fixture_id,999);assert.equal(body.p_payload.items[0].approval.fixtureIdentity,watchFixtureIdentity(match));
 assert.equal(validatedWatchOptions(match,body.p_payload,options).length,1);
});

test('removed/private video clears old per-fixture cache; empty manifest never spends API quota',async()=>{
 const h=refreshFixture({source:null});const report=await h.run();assert.equal(report.rejected,1);assert.equal(JSON.parse(h.calls.at(-1).init.body).p_payload.items.length,0);
 const empty=await refreshMatchWatch({manifest:{version:1,items:[]},fetchImpl:()=>{throw Error('network forbidden');},now});assert.equal(empty.youtubeRequests,0);
 const missing=refreshFixture({rows:[]});assert.equal((await missing.run()).missingFixture,1);assert.equal(missing.calls.length,1);
});

test('unknown cache write is never retried, and arbitrary provider exceptions are not returned',async()=>{
 const h=refreshFixture({write:()=>{throw Error('private provider body');}});await assert.rejects(h.run(),error=>error.code==='WATCH_WRITE_UNCONFIRMED'&&!error.message.includes('private'));assert.equal(h.calls.filter(call=>call.init.method==='POST').length,1);
});

test('watch API is authenticated GET-only, cache-only, country validated and route is wired',async()=>{
 const reads=[];const api=apiRuntime({getCache:async key=>{reads.push(key);return key===matchCenterCacheKey(999)?{match}:key===watchCacheKey(999)?catalogue():null;}});
 const req=(query='',method='GET')=>new Request('https://app.example/api/match-watch?fixtureId=999'+query,{method});
 assert.equal((await api.apiMatchWatch(req(),{},null)).status,401);assert.equal((await api.apiMatchWatch(req('','POST'),{},{id:42})).status,405);
 assert.equal((await api.apiMatchWatch(req('&country=xx'),{},{id:42})).status,400);assert.equal(reads.length,0);
 const response=await dispatchApiRoute(req('&country=RU'),new URL(req().url),{},{id:42},{apiMatchWatch:api.apiMatchWatch});assert.equal((await response.json()).items.length,1);assert.deepEqual(reads,[matchCenterCacheKey(999),watchCacheKey(999)]);
 assert.equal((await (await api.apiMatchWatch(req(),{matchWatchEnabled:false},{id:42})).json()).available,false);
 const fail=apiRuntime({getCache:async()=>{throw Error('offline');}});assert.equal((await (await fail.apiMatchWatch(req(),{},{id:42})).json()).available,false);
});

test('workflow uses pinned main, protected existing keys and no public source submission',()=>{
 const workflow=fs.readFileSync('.github/workflows/refresh-match-watch.yml','utf8');assert.deepEqual(auditWorkflow('.github/workflows/refresh-match-watch.yml',workflow),[]);
 assert.match(workflow,/github.ref == 'refs\/heads\/main'/);assert.match(workflow,/ref: main/);assert.doesNotMatch(workflow,/inputs:|pull_request_target/);
 const app=fs.readFileSync('public/app.js','utf8');assert.match(app,/void mountMatchWatchPanel/);assert.match(app,/matchWatchPanel\?\.dispose/);
 const view=fs.readFileSync('public/modules/match-center-view.js','utf8');assert.doesNotMatch(view,/matchWatchPanel/,'stable iframe must stay outside rerendered center');
});


test('checked-in approvals are valid, and static media permission stays narrow',()=>{
 validateWatchApprovals(JSON.parse(fs.readFileSync('src/match-watch-approvals.json','utf8')));
 const headers=fs.readFileSync('public/_headers','utf8');
 assert.match(headers,/frame-src 'self' https:\/\/www\.youtube\.com;/);
 for(const route of ['/admin.html','/status.html','/privacy.html','/terms.html']){
  const section=headers.split(route+'\n')[1].split('\n\n')[0];
  assert.match(section,/script-src 'self' https:\/\/telegram\.org;/);assert.doesNotMatch(section,/youtube|ytimg/);
 }
});
