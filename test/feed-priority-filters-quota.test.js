import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProviderFixtureRuntime} from '../src/provider-fixture-runtime.js';

const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');

function runtime({paid=false,cached=null,stale=null}={}){
  const calls=[];
  const methods={
    apiFootball:async path=>{calls.push(path);return [];},
    bumpTelemetry:()=>{},
    catalogRank:()=>0,
    getCache:async key=>key.startsWith('matches:') ? cached : null,
    getStaleCache:async key=>key.startsWith('matches:') ? stale : null,
    isFootballRateLimitError:()=>false,
    isRetryableFootballTransportError:()=>false,
    isFinishedStatus:()=>false,
    isLiveStatus:()=>false,
    isTopLeague:()=>false,
    json:body=>({body}),
    liveRefreshSeconds:()=>90,
    markCachedSourceMeta:(meta,extra)=>({...meta,...extra}),
    matchInterestScore:()=>0,
    matchStatusRank:()=>0,
    normalizeCompetition:()=>({}),
    normalizeRoundLabel:()=> '',
    persistIntegrityRun:async()=>{},
    providerBudgetProfile:()=>({paid}),
    publicDataCapabilities:()=>({}),
    runMatchIntegrityGuard:(fixtures)=>({accepted:[],report:{},issues:[]}),
    scoreSnapshot:()=>({}),
    setCache:async()=>{},
    settlePredictionsFromFixtures:async()=>{},
    sourceMeta:meta=>meta,
    statusLabel:()=> '',
    todayUtc:()=> '2026-10-08',
  };
  return{client:createProviderFixtureRuntime(methods),calls};
}

test('FREE date guard returns a clear user response without calling the provider',async()=>{
  const {client,calls}=runtime();
  const r=await client.apiMatches(new Request('https://example.test/api/matches?date=2026-10-10'),{});
  assert.equal(r.body.restrictedDate,true);
  assert.equal(r.body.date,'2026-10-10');
  assert.deepEqual(r.body.matches,[]);
  assert.match(r.body.warning,/FREE/);
  assert.equal(calls.length,0);
});

test('unsupported date can reuse a verified date-specific cached match list',async()=>{
  const list={date:'2026-10-10',matches:[{fixtureId:101,home:{name:'Team'}}],
    sourceMeta:{provider:'api-football'}};
  const {client,calls}=runtime({stale:list});
  const r=await client.apiMatches(new Request('https://example.test/api/matches?date=2026-10-10'),{});
  assert.equal(r.body.stale,true);
  assert.equal(r.body.cached,true);
  assert.equal(r.body.matches.length,1);
  assert.equal(calls.length,0);
});

test('FREE verified fixture-date cache holds twenty minutes; paid remains short',()=>{
  const free=runtime().client;
  const paid=runtime({paid:true}).client;
  for(const day of ['2026-10-08','2026-10-09']){
    assert.equal(free.providerFeedDateTtl(day,{}),20);
    assert.equal(paid.providerFeedDateTtl(day,{}),2);
  }
});

test('responsive filters have reset and clear locale labels without extra API requests',()=>{
  const html=read('public/index.html');
  const app=read('public/app.js');
  const css=read('public/styles/premium-ui.css');
  for(const id of ['major','upcoming','finished','leagues','national',
    'brazil','argentina','portugal','netherlands','turkey','usa','saudi']){
    assert.match(html,new RegExp('data-filter="'+id+'"'));
  }
  assert.match(html,/id="resetMatchFilters"/);
  assert.match(app,/resetMatchFilters'\)\?\.addEventListener/);
  assert.match(app,/state\.filter = 'top'/);
  assert.match(app,/m\.isTop === true/);
  assert.match(app,/state\.matchesMeta\?\.restrictedDate === true/);
  assert.match(app,/Date\.parse\(state\.matchesMeta\.refreshedAt/);
  assert.match(css,/\.match-filter-reset/);
  assert.match(css,/\.league-filter-grid/);
});
