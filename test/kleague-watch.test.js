import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseKleagueTvPage,loadKleagueTv,kleagueTvApprovals} from '../scripts/kleague-tv-catalogue.js';
import {KLEAGUE_CHANNEL,kleagueTvUrl,validKleagueTvReplay,kleagueTeamMatches} from '../src/kleague-watch-policy.js';
import {WATCH_POLICIES,automaticHighlightsMatch,automaticHighlightsEvidence} from '../src/match-watch-policy.js';
import {watchFixtureIdentity,watchCacheKey,watchApiPayload,watchLibraryPayload,WATCH_EXTENDED_LIBRARY_KEY,WATCH_LIBRARY_KEY} from '../src/match-watch.js';
import {refreshMatchWatch} from '../scripts/refresh-match-watch.js';
const recorded=JSON.parse(readFileSync('test-support/fixtures/kleague-watch-sources.json','utf8'));
const old=JSON.parse(readFileSync('test-support/fixtures/watch-source-expansion.json','utf8'));
const now=Date.parse('2026-10-27T19:00:00Z');
const page=nodes=>`<!doctype html><script id="__NUXT_DATA__" type="application/json">${JSON.stringify(nodes)}</script>`;
const sources=parseKleagueTvPage(page(recorded.detailNuxt));
const fixtures=recorded.matches.map(match=>({match,observedAt:new Date(now).toISOString()}));
const approved=()=>kleagueTvApprovals(sources.map(source=>({source,observedAt:new Date(now).toISOString()})),fixtures,now,watchFixtureIdentity);
test('actual public fullmatch/VOD metadata joins eight canonical completed matches and never calls its publication state LIVE',()=>{
 assert.equal(parseKleagueTvPage(page(recorded.homeNuxt)).length,6);assert.equal(sources.length,26);
 const items=approved();assert.equal(items.length,8);assert.equal(new Set(items.map(item=>item.match.fixtureId)).size,8);
 assert.ok(items.every(item=>item.kind==='replay'&&item.access==='registration'&&item.embeddable===false&&item.sourceMetadata.publication==='Live'&&item.sourceMetadata.distribution==='VOD'));
 for(const item of items){assert.equal(validKleagueTvReplay(item.match,item.sourceMetadata,now),true);assert.equal(validKleagueTvReplay({...item.match,finished:false,status:'1H'},item.sourceMetadata,now),false);}
 assert.equal(items.find(item=>item.match.fixtureId===1510482).eventUrl,'https://tv.kleague.com/en-int/video/r30paju-hwaseong/2260948');
});
test('full recording proof rejects paid access, unsupported embedding, wrong fixture, archive, category, duration and altered official permalink',()=>{
 const item=approved()[0],source=item.sourceMetadata;
 for(const patch of [{distribution:'Live'},{payment:'Subscription'},{entitlementsEmpty:false},{freeForEmbed:true},{durationSeconds:3599},{durationSeconds:14401},{round:29},{publication:'Disabled'},{title:123},{countries:['RU','XX']},{eventUrl:source.eventUrl+'?autoplay=1'},{id:123},{slug:'other-match'},{updatedAt:new Date(now+60000).toISOString()}])assert.equal(validKleagueTvReplay(item.match,{...source,...patch},now),false,JSON.stringify(patch));
 for(const patch of [{season:2025},{leagueId:292},{date:'2026-10-25T06:30:00Z'},{round:'Regular Season - 29'},{home:item.match.away,away:item.match.home}])assert.equal(validKleagueTvReplay({...item.match,...patch},source,now),false,JSON.stringify(patch));
 assert.equal(validKleagueTvReplay(item.match,source,Date.parse(item.match.date)+7*86400000),false);
 assert.equal(validKleagueTvReplay(item.match,{...source,event:{...source.event,category:'K LEAGUE 1'}},now),false);
 for(const url of ['https://tv.kleague.com.evil.test/en-int/video/a/1','https://user:pass@tv.kleague.com/en-int/video/a/1','https://tv.kleague.com/en-int/video/a/1#play','https://tv.kleague.com/en-int/video/a/../1','http://tv.kleague.com/en-int/video/a/1'])assert.equal(kleagueTvUrl(url),'');
});
test('Suwon FC and Suwon Samsung retain separate canonical identities in external recordings and YouTube short names',()=>{
 const city=recorded.matches.find(m=>m.fixtureId===1510477).home,samsung=recorded.matches.find(m=>m.fixtureId===1510479).away;
 assert.equal(kleagueTeamMatches(city,'Suwon FC'),true);assert.equal(kleagueTeamMatches(city,'Suwon'),false);assert.equal(kleagueTeamMatches(samsung,'Suwon'),true);assert.equal(kleagueTeamMatches(samsung,'SuwonFC'),false);
 for(const video of recorded.videos.filter(v=>/15-Min Extended Highlights$/.test(v.snippet.title))){
  const policy=WATCH_POLICIES.find(p=>p.channelId===KLEAGUE_CHANNEL&&p.videoLeague===Number(video.snippet.title.match(/K LEAGUE ([12]) /)[1]));
  const candidates=recorded.matches.filter(match=>automaticHighlightsMatch(policy,match,video.snippet.title,video.snippet.publishedAt,now,video.snippet.description));assert.equal(candidates.length,1,video.snippet.title);
  assert.equal(automaticHighlightsEvidence(video.contentDetails.duration,video.snippet.liveBroadcastContent,undefined),true);
  assert.equal(automaticHighlightsMatch(policy,{...candidates[0],round:'Regular Season - 99'},video.snippet.title,video.snippet.publishedAt,now,''),false);
 }
});
test('public page parser intersects desktop and mobile grants and rejects contradictory source duplicates and malformed graphs',()=>{
 const nodes=structuredClone(recorded.homeNuxt);
 for(const row of nodes){if(row&&typeof row==='object'&&!Array.isArray(row)&&Object.hasOwn(row,'deviceCategory')){const device=nodes[row.deviceCategory];if(nodes[device.name]==='Mobile'){row.isolist=nodes.length;nodes.push('KZ,BY');}}}
 assert.ok(parseKleagueTvPage(page(nodes)).every(source=>!source.countries.includes('RU')&&source.countries.includes('KZ')));
 const bad=structuredClone(recorded.homeNuxt),root=bad.find(row=>row&&typeof row==='object'&&!Array.isArray(row)&&Object.hasOwn(row,'geoRestrictions')),duplicate={...root};duplicate.length=bad.length;bad.push(9999,duplicate);
 assert.throws(()=>parseKleagueTvPage(page(bad)),e=>e.code==='WATCH_KLEAGUE_DUPLICATE_CONFLICT');
 for(const html of ['', '<script id="__NUXT_DATA__">{}</script>',page(Array(15001).fill(null)),page(recorded.homeNuxt)+page(recorded.homeNuxt)])assert.throws(()=>parseKleagueTvPage(html),e=>e.code==='WATCH_KLEAGUE_PAGE_INVALID');
});
function harness(){
 const cache=new Map(),calls=[];let current=now,lastSlot=null,sourceMode='ok',unknown=false;
 const videos=[...old.videos,...recorded.videos],matches=[...old.matches,...recorded.matches];
 const env={SUPABASE_URL:'https://nlmvhkjkpgzzlfavaohk.supabase.co',SUPABASE_SECRET_KEY:'fixture-database-key',YOUTUBE_DATA_API_KEY:'fixture-youtube-key',API_FOOTBALL_KEY:'fixture-football-key'};
 const fetchImpl=async(input,options)=>{
  const url=new URL(input);calls.push({url,options});assert.equal(options.redirect,'error');
  if(url.origin==='https://tv.kleague.com'){
   assert.equal(options.headers.apikey,undefined);assert.equal(options.headers['X-Goog-Api-Key'],undefined);assert.equal(options.headers['x-apisports-key'],undefined);assert.equal(options.headers.Authorization,undefined);
   if(sourceMode==='fail')return new Response('unavailable',{status:503});
   return new Response(page(sourceMode==='empty'?[{items:1},[]]:url.pathname.endsWith('/page/home')?recorded.homeNuxt:recorded.detailNuxt),{headers:{'Content-Type':'text/html'}});
  }
  if(url.origin==='https://www.googleapis.com'){
   assert.equal(options.headers['X-Goog-Api-Key'],env.YOUTUBE_DATA_API_KEY);
   if(url.pathname.endsWith('/search'))return Response.json({items:[]});
   if(url.pathname.endsWith('/playlistItems')){assert.equal(url.searchParams.get('maxResults'),'50');const channel='UC'+url.searchParams.get('playlistId').slice(2);return Response.json({items:videos.filter(v=>v.snippet.channelId===channel).map(v=>({contentDetails:{videoId:v.id}}))});}
   assert.ok(url.pathname.endsWith('/videos'));const ids=url.searchParams.get('id').split(',');assert.ok(ids.length<=50);return Response.json({items:videos.filter(v=>ids.includes(v.id))});
  }
  assert.equal(url.origin,env.SUPABASE_URL);
  if(url.pathname.includes('/football-relay/'))return Response.json({errors:[],response:matches.filter(m=>m.date.startsWith(url.searchParams.get('date'))).map(m=>({fixture:{id:m.fixtureId,date:m.date,status:{short:m.status}},teams:{home:m.home,away:m.away},league:{id:m.leagueId,name:m.league,season:m.season,round:m.round},goals:m.score}))});
  if(url.pathname.endsWith('/claim_provider_request')){const body=JSON.parse(options.body);if(body.p_bucket_key==='match-watch:refresh'){const slot=Math.floor(current/300000),allowed=slot!==lastSlot;if(allowed)lastSlot=slot;return Response.json({allowed});}return Response.json({allowed:true});}
  if(url.pathname.endsWith('/write_analysis_cache_versioned')){
   const b=JSON.parse(options.body);if(unknown&&b.p_cache_key==='match-watch-kleaguetv:v1')throw Error('unknown source marker');
   cache.set(b.p_cache_key,{cache_key:b.p_cache_key,payload:b.p_payload,expiresAt:Date.parse(b.p_expires_at)});return Response.json({stored:true,reason:'stored'});
  }
  assert.equal(url.pathname,'/rest/v1/analysis_cache');const filter=url.searchParams.get('cache_key');
  if(filter.startsWith('in.(provider-state:')||filter.startsWith('like.'))return Response.json([]);
  const keys=filter.startsWith('eq.')?[filter.slice(3)]:filter.startsWith('in.(')?filter.slice(4,-1).split(','):[];
  return Response.json(keys.flatMap(key=>{const row=cache.get(key);return row&&row.expiresAt>current?[{cache_key:key,payload:row.payload}]:[];}));
 };
 return {cache,calls,env,fetchImpl,mode:value=>{sourceMode=value;},unknown:()=>{unknown=true;},run:async offset=>{current=now+offset;return refreshMatchWatch({env,fetchImpl,manifest:{version:1,items:[]},automatic:true,now:current});}};
}
test('full production pipeline adds external recordings and embedded summaries with bounded calls, fresh consumer proof and compatible rollback index',async()=>{
 const h=harness();let report;for(let i=0;i<4;i++)report=await h.run(i*300000);
 assert.equal(report.externalPublished,8);assert.ok(report.libraryMatches>=25);assert.ok(report.libraryByCountry.RU.fullReplayMatches>=11);assert.equal(report.libraryByCountry.RU.liveMatches,0);
 const clock=now+900000,index=h.cache.get(WATCH_EXTENDED_LIBRARY_KEY).payload,entry=index.entries.find(e=>e.match.fixtureId===1510482);
 const options=watchApiPayload(entry.match,entry.catalogue,{country:'RU',now:clock,approvals:[]}).items;
 const external=options.find(i=>i.provider==='kleaguetv');assert.equal(external.kind,'replay');assert.equal(external.access,'registration');assert.equal(external.embed,false);assert.ok(options.some(i=>i.provider==='youtube'&&i.kind==='highlights'&&i.embed));
 assert.ok(watchLibraryPayload(index,{country:'RU',now:clock,approvals:[],maxEntries:100}).items.some(i=>i.fixtureId===1510482&&i.kinds.includes('replay')));
 assert.ok(h.cache.get(WATCH_LIBRARY_KEY).payload.entries.every(e=>e.catalogue.items.every(i=>i.publisher==='jleagueinternational')));
 assert.ok(report.youtubeRequests<=22);assert.ok((report.kleagueTvRequests||0)<=3);assert.ok((report.fixtureRequests||0)<=2);
 const sourceCalls=h.calls.filter(c=>c.url.hostname==='tv.kleague.com');assert.equal(sourceCalls.length,4,'two 15-minute source polls use only homepage and one related page each');
 assert.ok(h.cache.get(watchCacheKey(1510475)).payload.items.some(i=>i.provider==='kleaguetv'),'full-only match must be retained independently of summary discovery');
 h.mode('empty');const withdrawn=await h.run(30*60000);assert.equal(withdrawn.externalPublished||0,0);assert.equal(h.cache.get(watchCacheKey(1510475)).payload.items.length,0);assert.ok(withdrawn.published>0,'source withdrawal cannot empty other leagues');
});
test('a failed public source may retain only its original unexpired proof and cannot extend recordings beyond the observed-source deadline',async()=>{
 const h=harness();await h.run(0);await h.run(300000);h.mode('fail');await h.run(900000);
 const last=h.cache.get(watchCacheKey(1510482)).payload.items.find(i=>i.provider==='kleaguetv');assert.equal(last.sourceObservedAt,new Date(now).toISOString());assert.equal(last.expiresAt,new Date(now+1800000).toISOString());
 const report=await h.run(1800000);assert.equal(report.externalPublished||0,0);assert.ok(report.published>0);assert.ok(!h.cache.get(watchCacheKey(1510482)).payload.items.some(i=>i.provider==='kleaguetv'));
});
test('unknown source-attempt write aborts before any source request and unpublished state cannot be treated as approved',async()=>{
 const h=harness();h.unknown();await assert.rejects(h.run(0),e=>e.code==='WATCH_WRITE_UNCONFIRMED');assert.equal(h.calls.filter(c=>c.url.hostname==='tv.kleague.com').length,0);
 const item=approved()[0],identity=watchFixtureIdentity(item.match),catalogue={version:1,fixtureIdentity:identity,items:[{...item,sourceObservedAt:new Date(now-1800000).toISOString(),registrationRequired:true,regionVerified:true,approval:{version:3,policyId:item.policyId,policyRevision:item.policyRevision,confirmed:true,confirmedAt:new Date(now).toISOString(),fixtureIdentity:identity},checkedAt:new Date(now).toISOString(),expiresAt:new Date(now+1800000).toISOString()}]};
 assert.deepEqual(watchApiPayload(item.match,catalogue,{country:'RU',now,approvals:[]}).items,[]);
});
