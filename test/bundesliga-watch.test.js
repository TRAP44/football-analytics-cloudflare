import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WATCH_POLICIES,automaticHighlightsMatch,automaticHighlightsEvidence} from '../src/match-watch-policy.js';
import {watchApiPayload,watchLibraryPayload,watchCacheKey,WATCH_EXTENDED_LIBRARY_KEY} from '../src/match-watch.js';
import {refreshMatchWatch} from '../scripts/refresh-match-watch.js';
import {WATCH_DISCOVERY_KEY} from '../scripts/discover-match-watch.js';
const recorded=JSON.parse(readFileSync('test-support/fixtures/bundesliga-watch-sources.json'));
const policy=WATCH_POLICIES.find(p=>p.format==='bundesliga'),now=Date.parse(recorded.observedAt);
const matchFor=v=>recorded.matches.filter(m=>automaticHighlightsMatch(policy,m,v.snippet.title,v.snippet.publishedAt,now,v.snippet.description));
test('observed official Bundesliga metadata identifies eight distinct matches, not clips, streams or archive compilations',()=>{
 const approved=recorded.videos.filter(v=>matchFor(v).length===1&&automaticHighlightsEvidence(v.contentDetails.duration,v.snippet.liveBroadcastContent,v.liveStreamingDetails));
 assert.equal(approved.length,8);assert.equal(new Set(approved.map(v=>matchFor(v)[0].fixtureId)).size,8);
 assert.ok(approved.some(v=>matchFor(v)[0].home.name==='SC Freiburg'));
 const friday=approved.find(v=>v.id==='LUL29bWTEQY'),match=matchFor(friday)[0];
 assert.ok(Date.parse(friday.snippet.publishedAt)-Date.parse(match.date)>48*3600000,'observed Friday match is published with the Sunday summaries');
 assert.equal(automaticHighlightsMatch(policy,match,friday.snippet.title,new Date(Date.parse(match.date)+72*3600000+1).toISOString(),Date.parse(match.date)+73*3600000,friday.snippet.description),false);
 assert.equal(automaticHighlightsMatch(policy,match,friday.snippet.title,friday.snippet.publishedAt,Date.parse(match.date)+7*86400000,friday.snippet.description),false);
});
test('independent title and description require exact clubs, season and round; promotion cannot replace match evidence',()=>{
 const v=recorded.videos.find(v=>v.id==='qDNTweAhMhA'),m=matchFor(v)[0],title=v.snippet.title,description=v.snippet.description;
 for(const patch of [{season:2025},{round:'Regular Season - 8'},{leagueId:79},{finished:false,status:'1H'},{home:m.away,away:m.home},{away:{...m.away,id:999999}},{home:{...m.home,name:null}}])assert.equal(automaticHighlightsMatch(policy,{...m,...patch},title,v.snippet.publishedAt,now,description),false,JSON.stringify(patch));
 for(const changed of [title.replace('26/27','25/26'),title.replace('MD7','MD8'),'ARCHIVE | '+title,title.replace('Highlights','Full Match'),title.replace('FC BAYERN','FC BAYERN Women'),title+' extra'])assert.equal(automaticHighlightsMatch(policy,m,changed,v.snippet.publishedAt,now,description),false,changed);
 for(const changed of ['',description.split('\n').slice(1).join('\n'),description.replace('2026/27','2025/26'),description.replace('Matchday 7!','Matchday 8!'),description.replace('FC Bayern München','Borussia Dortmund'),description+'\nMatchday 8',description+'\n2025/26',description+'\n'+description.split('\n')[3],'Subscribe now!\n'+description])assert.equal(automaticHighlightsMatch(policy,m,title,v.snippet.publishedAt,now,changed),false,changed);
});
function harness(){
 const cache=new Map(),calls=[];let clock=now,videos=structuredClone(recorded.videos),failed=false;
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'fixture-db',YOUTUBE_DATA_API_KEY:'fixture-youtube'};
 const raw=m=>({fixture:{id:m.fixtureId,date:m.date,status:{short:m.status}},teams:{home:m.home,away:m.away},league:{id:m.leagueId,name:m.league,season:m.season,round:m.round},goals:m.score});
 const fetchImpl=async(value,init)=>{
  const url=new URL(value);calls.push({url,init});assert.equal(init.redirect,'error');
  if(url.hostname==='www.googleapis.com'){
   assert.equal(init.headers['X-Goog-Api-Key'],env.YOUTUBE_DATA_API_KEY);assert.equal(url.searchParams.has('key'),false);
   if(url.pathname.endsWith('/playlistItems')){
    assert.equal(url.searchParams.get('playlistId'),'UU'+policy.channelId.slice(2));
    assert.equal(cache.get(WATCH_DISCOVERY_KEY).payload.uploadFeeds[policy.channelId].attemptedAt,new Date(clock).toISOString());
    if(failed)throw Error('source unavailable');
    return Response.json({items:videos.map(v=>({contentDetails:{videoId:v.id}}))});
   }
   assert.ok(url.pathname.endsWith('/videos'),'highlights-only source must never search LIVE');
   const ids=url.searchParams.get('id').split(',');assert.ok(ids.length<=50);
   return Response.json({items:videos.filter(v=>ids.includes(v.id))});
  }
  assert.equal(url.origin,env.SUPABASE_URL);
  if(url.pathname.endsWith('/claim_provider_request'))return Response.json({allowed:true});
  if(url.pathname.endsWith('/write_analysis_cache_versioned')){const b=JSON.parse(init.body);cache.set(b.p_cache_key,{cache_key:b.p_cache_key,payload:b.p_payload,expiresAt:Date.parse(b.p_expires_at)});return Response.json({stored:true,reason:'stored'});}
  assert.equal(url.pathname,'/rest/v1/analysis_cache');const filter=url.searchParams.get('cache_key');
  if(filter.startsWith('in.(provider-fixtures:'))return Response.json([...new Set(recorded.matches.map(m=>m.date.slice(0,10)))].map(date=>({cache_key:`provider-fixtures:${date}:v1`,payload:{date,fetchedAt:new Date(clock-60000).toISOString(),fixtures:recorded.matches.filter(m=>m.date.startsWith(date)).map(raw)}})));
  if(filter.startsWith('like.'))return Response.json([]);
  const keys=filter.startsWith('eq.')?[filter.slice(3)]:filter.startsWith('in.(')?filter.slice(4,-1).split(','):[];
  return Response.json(keys.flatMap(key=>{const row=cache.get(key);return row&&row.expiresAt>clock?[{cache_key:key,payload:row.payload}]:[];}));
 };
 return {cache,calls,fail:()=>{failed=true;},withdraw:()=>{videos=videos.map(v=>({...v,status:{...v.status,privacyStatus:'private'}}));},run:async offset=>{clock=now+offset;return refreshMatchWatch({env,fetchImpl,now:clock,manifest:{version:1,items:[]},automatic:true,policies:[policy]});}};
}
test('producer and independent consumer publish eight embedded summaries, revalidate rights and withdraw stale catalogue entries',async()=>{
 const h=harness(),report=await h.run(0);assert.equal(report.published,8);assert.equal(report.libraryMatches,8);assert.equal(report.youtubeRequests,2);
 assert.equal(report.libraryByCountry.RU.liveMatches,0);assert.equal(report.libraryByCountry.RU.highlightsMatches,8);
 const index=h.cache.get(WATCH_EXTENDED_LIBRARY_KEY).payload;
 const cards=watchLibraryPayload(index,{country:'RU',now,approvals:[],maxEntries:100});assert.equal(cards.items.length,8);assert.ok(cards.items.every(c=>c.league==='Бундеслига · Германия'));
 assert.doesNotMatch(JSON.stringify(cards),/videoId|eventUrl|channelId|probabilities|"score"/);
 for(const entry of index.entries){
  const options={country:'RU',now,approvals:[]};assert.equal(watchApiPayload(entry.match,entry.catalogue,options).items[0].embed,true);
  const altered=structuredClone(entry.catalogue);altered.items[0].videoDescription=altered.items[0].videoDescription.replace('2026/27','2025/26');assert.deepEqual(watchApiPayload(entry.match,altered,options).items,[]);
 }
 await h.run(300000);assert.equal(h.calls.filter(c=>c.url.pathname.endsWith('/playlistItems')).length,1,'new channel polls every ten minutes');
 await h.run(600000);assert.equal(h.calls.filter(c=>c.url.pathname.endsWith('/playlistItems')).length,2);
 h.withdraw();const revoked=await h.run(900000);assert.equal(revoked.published,0);assert.equal(revoked.libraryMatches,0);
 assert.ok(index.entries.every(e=>h.cache.get(watchCacheKey(e.match.fixtureId)).payload.items.length===0));
});
test('failed uploads retain only separately revalidated source metadata and honor the ten-minute attempt interval',async()=>{
 const h=harness();await h.run(0);h.fail();const failed=await h.run(600000);assert.equal(failed.discoveryError,'WATCH_DISCOVERY_SEARCH_FAILED');assert.equal(failed.published,8);
 await h.run(900000);assert.equal(h.calls.filter(c=>c.url.pathname.endsWith('/playlistItems')).length,2);
});
test('eight-channel maximum discovery remains below the standard daily quota with headroom',()=>{
 const day=86400000,channels=Map.groupBy(WATCH_POLICIES,p=>p.channelId);assert.equal(channels.size,8);
 let cost=0;for(const policies of channels.values()){
  const live=policies.filter(p=>!p.highlightsOnly);if(live.length)cost+=2*100*Math.ceil(day/Math.min(...live.map(p=>p.searchIntervalMs||7200000)));
  cost+=Math.ceil(day/Math.min(...policies.map(p=>p.uploadsIntervalMs||7200000)));
 }
 const maxIds=7*50+20+2*40+20+100*2+20;assert.equal(maxIds,690);
 cost+=Math.ceil(maxIds/50)*Math.ceil(day/300000);assert.equal(cost,9324);assert.ok(cost<9500);
});
