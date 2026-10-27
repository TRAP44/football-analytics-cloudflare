import test from 'node:test';
import assert from 'node:assert/strict';
import {watchLibraryPayload,watchFixtureIdentity,WATCH_LIBRARY_KEY,WATCH_PUBLISHERS} from '../src/match-watch.js';
import {dispatchApiRoute} from '../src/router.js';
import {createUserDataApiRuntime} from '../src/user-data-api-runtime.js';

const now=Date.now(),iso=offset=>new Date(now+offset).toISOString();
const match={fixtureId:999,date:iso(-7200000),status:'FT',finished:true,home:{id:55,name:'Home FC'},away:{id:56,name:'Away FC'},leagueId:39,season:2026,league:'Fixture League',score:{home:3,away:0},elapsed:90};
const approval={match,provider:'youtube',publisher:'fifa',videoId:'abcdefghijk',eventUrl:'https://www.youtube.com/watch?v=abcdefghijk',kind:'highlights',access:'free',countries:['RU','KZ'],confirmed:true,confirmedAt:iso(-60000),validUntil:iso(3600000)};
const entry=()=>({match,catalogue:{version:1,fixtureIdentity:watchFixtureIdentity(match),items:[{...approval,channelId:WATCH_PUBLISHERS.fifa,videoTitle:'Private raw metadata',videoDescription:'Must never appear in a card',publicVideo:true,regionVerified:true,ageRestricted:false,embeddable:true,checkedAt:iso(0),expiresAt:iso(1800000),approval:{version:1,confirmed:true,confirmedAt:approval.confirmedAt,fixtureIdentity:watchFixtureIdentity(match)}}]}});
const library=()=>({version:1,checkedAt:iso(0),entries:[entry()]});
const options={now,approvals:[approval],policies:[],country:'RU'};
function runtime(deps={}){return createUserDataApiRuntime(new Proxy({json:(body,status=200)=>Response.json(body,{status}),watchApprovals:[approval],watchPolicies:[],...deps},{get:(target,key)=>key in target?target[key]:async()=>[]}));}

test('library requires an explicit country, groups kinds per fixture, and never exposes spoilers or video links',()=>{
 const initial=watchLibraryPayload(library(),{...options,country:''});assert.equal(initial.available,false);assert.deepEqual(initial.items,[]);assert.equal(initial.countries.length,2);
 const payload=watchLibraryPayload(library(),options);assert.equal(payload.available,true);assert.equal(payload.items.length,1);assert.deepEqual(payload.items[0].kinds,['highlights']);assert.equal(payload.items[0].home,'Home FC');assert.equal(payload.items[0].homeTeamId,55);assert.equal(payload.items[0].awayTeamId,56);
 assert.deepEqual(Object.keys(payload.items[0]).sort(),['fixtureId','home','away','homeTeamId','awayTeamId','league','date','kinds','registrationReplay','embeddedReplay','expiresAt'].sort());
 assert.equal(payload.items[0].registrationReplay,false);assert.equal(payload.items[0].embeddedReplay,false);
 // ISO dates such as 13:02 contain "3:0" without exposing a match score.
 // Exclude only the two known item timestamps; root fields, country labels
 // and every other item field remain subject to the original score check.
 const withoutDates={...payload,items:payload.items.map(item=>({...item,date:'',expiresAt:''}))};
 assert.doesNotMatch(JSON.stringify(withoutDates),/3:0/);
 assert.doesNotMatch(JSON.stringify(payload),/"score"|elapsed|videoId|eventUrl|youtube|Private raw metadata|Must never appear/);
 assert.equal(watchLibraryPayload(library(),{...options,country:'US'}).items.length,0);
});
test('expired, revoked, cross-fixture and malformed library evidence cannot advertise a match',()=>{
 for(const patch of [{version:2},{checkedAt:iso(-1800001)},{checkedAt:iso(60000)},{entries:Array(21).fill(entry())}])assert.equal(watchLibraryPayload({...library(),...patch},options).items.length,0);
 for(const modify of [e=>e.match={...match,fixtureId:998},e=>e.catalogue.items[0].expiresAt=iso(-1),e=>e.catalogue.items[0].countries=['US'],e=>e.catalogue.items[0].publicVideo=false]){
  const e=structuredClone(entry());modify(e);assert.equal(watchLibraryPayload({version:1,checkedAt:iso(0),entries:[e]},options).items.length,0);
 }
 assert.equal(watchLibraryPayload(library(),{...options,approvals:[]}).items.length,0);assert.equal(watchLibraryPayload(library(),{...options,enabled:false}).items.length,0);
});
test('library cache does not bypass the independent fresh center gate on opening the actual video',async()=>{
 const api=runtime({getCache:async key=>key===WATCH_LIBRARY_KEY?library():key===`match-watch:${match.fixtureId}:v1`?entry().catalogue:null});
 const request=new Request('https://local.test/api/match-watch?list=1&country=RU');const list=await dispatchApiRoute(request,new URL(request.url),{},{id:42},{apiMatchWatch:api.apiMatchWatch});assert.equal((await list.json()).items.length,1);
 const item=await api.apiMatchWatch(new Request('https://local.test/api/match-watch?fixtureId=999&country=RU'),{},{id:42});assert.equal((await item.json()).available,false);
});
test('library authentication, GET-only, inputs and kill switch reject before any data reads',async()=>{
 let reads=0;const api=runtime({getCache:async()=>{reads++;return library();}}),req=(query='list=1',method='GET')=>new Request('https://local.test/api/match-watch?'+query,{method});
 assert.equal((await api.apiMatchWatch(req(),{},null)).status,401);assert.equal((await api.apiMatchWatch(req('list=1','POST'),{},{id:42})).status,405);
 for(const query of ['list=yes','list=1&fixtureId=999','list=1&country=xx'])assert.equal((await api.apiMatchWatch(req(query),{},{id:42})).status,400);
 assert.equal((await (await api.apiMatchWatch(req(),{matchWatchEnabled:false},{id:42})).json()).available,false);assert.equal(reads,0);
});
test('production library uses one strong bounded database read, rejects expired rows and observes immediate replacement',async()=>{
 let reads=0,current=library();const api=runtime({hasSupabase:()=>true,getCache:()=>{throw Error('L1 must not mask withdrawal');},supaSelectOne:async(_cfg,table,params)=>{reads++;assert.equal(table,'analysis_cache');assert.equal(params.cache_key,`eq.${WATCH_LIBRARY_KEY}`);assert.equal(params.limit,1);return {cache_key:WATCH_LIBRARY_KEY,expires_at:iso(1800000),payload:current};}});
 const req=()=>api.apiMatchWatch(new Request('https://local.test/api/match-watch?list=1&country=RU'),{},{id:42});
 assert.equal((await (await req()).json()).items.length,1);current={version:1,checkedAt:iso(0),entries:[]};assert.equal((await (await req()).json()).items.length,0);assert.equal(reads,2);
 const expired=runtime({hasSupabase:()=>true,supaSelectOne:async()=>({cache_key:WATCH_LIBRARY_KEY,expires_at:iso(-1),payload:library()})});assert.equal((await (await expired.apiMatchWatch(new Request('https://local.test/api/match-watch?list=1&country=RU'),{},{id:42})).json()).items.length,0);
});
