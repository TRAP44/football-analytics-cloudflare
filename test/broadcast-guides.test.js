import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastGuide} from '../src/broadcast-guides.js';
import {broadcastGuideUrl,validBroadcastGuide} from '../public/modules/broadcast-guide-links.js';
import {createUserDataApiRuntime} from '../src/user-data-api-runtime.js';
import {userDataDependencies} from '../test-support/runtime-deps.js';
import {matchCenterCacheKey} from '../src/match-center-cache-key.js';
import {watchCacheKey} from '../src/match-watch.js';
const now=Date.parse('2026-10-27T00:00:00Z');
const fixture=(leagueId=140,clock=now)=>({fixtureId:999,leagueId,season:2026,date:new Date(clock+3600000).toISOString(),status:'NS',finished:false});

test('six top competitions expose directories independently of playable video',()=>{
 for(const leagueId of [39,140,135,78,61,2]){
  const guide=broadcastGuide(fixture(leagueId),{country:'RU',now});
  assert.equal(guide.scope,'competition');assert.equal(guide.fixtureId,999);assert.equal(guide.leagueId,leagueId);
  assert.ok(broadcastGuideUrl(guide.directory.url));assert.equal(guide.embed,undefined);assert.equal(guide.eventUrl,undefined);
  assert.equal(validBroadcastGuide(guide,999,'RU',now)?.leagueId,leagueId);
  assert.ok(guide.countries.some(item=>item.code==='RU'));
 }
});

test('provider hints are territory-specific, bounded, and never inferred for other leagues',()=>{
 assert.equal(broadcastGuide(fixture(),{country:'RU',now}).providers[0].name,'Матч ТВ');
 assert.equal(broadcastGuide(fixture(2),{country:'RU',now}).providers[0].name,'Okko');
 for(const country of ['', 'KZ','BY','GB','SG'])assert.deepEqual(broadcastGuide(fixture(),{country,now}).providers,[]);
 assert.deepEqual(broadcastGuide(fixture(39),{country:'RU',now}).providers,[]);
 const later=Date.parse('2026-11-27T00:00:00Z');
 assert.deepEqual(broadcastGuide(fixture(140,later),{country:'RU',now:later}).providers,[]);
 assert.ok(broadcastGuide(fixture(140,later),{country:'RU',now:later}).directory.url);
});

test('invalid identities, old/finished/cancelled games and unrelated competitions have no guide',()=>{
 for(const patch of [{fixtureId:0},{fixtureId:'999'},{leagueId:9999},{date:'bad'},{date:new Date(now-7*3600000).toISOString()},{date:new Date(now+15*86400000).toISOString()},{finished:true},{status:'FT'},{status:'PST'},{status:'CANC'}]){
  assert.equal(broadcastGuide({...fixture(),...patch},{country:'RU',now}),null,JSON.stringify(patch));
 }
 assert.equal(broadcastGuide(fixture(),{country:'ru',now}),null);
});

test('client accepts only reviewed navigation URLs and current matching guide identity',()=>{
 const guide=broadcastGuide(fixture(),{country:'RU',now});
 for(const patch of [{fixtureId:1000},{country:'GB'},{scope:'live'},{expiresAt:new Date(now-1).toISOString()},{expiresAt:new Date(now+3600000).toISOString()},{directory:{url:'https://evil.example/'}}])assert.equal(validBroadcastGuide({...guide,...patch},999,'RU',now),null);
 for(const url of ['javascript:alert(1)','http://okko.tv/','https://okko.tv.evil.test/','https://okko.tv/?redirect=evil','https://okko.tv/#x','https://name:pass@okko.tv/'])assert.equal(broadcastGuideUrl(url),'');
 const filtered=validBroadcastGuide({...guide,providers:[{name:'Bad',url:'https://evil.example',verifiedUntil:'2027-01-01'},{name:'Expired',url:'https://okko.tv/',verifiedUntil:new Date(now-1).toISOString()}]},999,'RU',now);
 assert.deepEqual(filtered.providers,[]);assert.ok(filtered.directory.url);
});

function apiFixture({center={match:fixture(140,Date.now())}}={}){
 const reads=[];
 const api=createUserDataApiRuntime(userDataDependencies({json:(value,status=200)=>Response.json(value,{status}),getCache:async key=>{reads.push(key);return key===matchCenterCacheKey(999)?center:null;}}));
 const request=(query='',method='GET')=>new Request('https://app.test/api/match-watch?fixtureId=999'+query,{method});
 return {api,reads,request};
}
test('actual API keeps video availability false while returning a guide from the canonical center',async()=>{
 const h=apiFixture();const data=await(await h.api.apiMatchWatch(h.request('&country=RU'),{},{id:42})).json();
 assert.equal(data.available,false);assert.deepEqual(data.items,[]);assert.deepEqual(data.countries,[]);
 assert.equal(data.broadcastGuide.scope,'competition');assert.equal(data.broadcastGuide.fixtureId,999);
 assert.deepEqual(h.reads,[matchCenterCacheKey(999),watchCacheKey(999)]);
});

test('authentication, disabled feature and missing/mismatched center remain fail-closed',async()=>{
 const h=apiFixture();assert.equal((await h.api.apiMatchWatch(h.request(),{},null)).status,401);
 assert.equal((await h.api.apiMatchWatch(h.request('','POST'),{},{id:42})).status,405);
 const disabled=await(await h.api.apiMatchWatch(h.request(),{matchWatchEnabled:false},{id:42})).json();
 assert.equal(disabled.broadcastGuide,undefined);assert.deepEqual(h.reads,[]);
 for(const center of [null,{match:{...fixture(140,Date.now()),fixtureId:1000}}]){
  const f=apiFixture({center});const data=await(await f.api.apiMatchWatch(f.request('&country=RU'),{},{id:42})).json();
  assert.equal(data.available,false);assert.equal(data.broadcastGuide,undefined);
 }
});

test('La Liga navigation targets the selected country and is withheld until a supported choice',()=>{
 for(const country of ['RU','KZ','BY','UA','UZ','GE','AM','AZ','GB','DE','FR','ES','IT','US']){
  const guide=broadcastGuide(fixture(),{country,now});
  assert.equal(guide.directory.url,`https://www.laliga.com/en-${country}/where-to-watch-laliga-easports`);
  assert.equal(validBroadcastGuide(guide,999,country,now)?.directory.url,guide.directory.url);
 }
 assert.equal(broadcastGuide(fixture(),{country:'',now}).directory,null);
 assert.equal(broadcastGuide(fixture(),{country:'SG',now}).directory.url,'https://www.laliga.com/en-SG/where-to-watch-laliga-easports');
 assert.equal(broadcastGuide(fixture(),{country:'AQ',now}),null);
 assert.equal(broadcastGuideUrl('https://www.laliga.com/en-AQ/where-to-watch-laliga-easports'),'');
 const guide=broadcastGuide(fixture(),{country:'KZ',now});
 assert.equal(validBroadcastGuide({...guide,directory:{url:'https://www.laliga.com/en-GB/where-to-watch-laliga-easports'}},999,'KZ',now),null);
});
