import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactProviderError,
  markCachedSourceMeta,
  resolveProviderChain,
  sourceMeta,
} from '../src/data-service.js';
import {
  normalizeOpenLigaStandings,
  openLigaCompetition,
  openLigaTableUrls,
} from '../src/providers/openligadb.js';
import {
  footballDataStandingsUrl,
  normalizeFootballDataStandings,
} from '../src/providers/football-data.js';

test('RC128 provider chain falls back without hiding the primary failure',async()=>{
  const result=await resolveProviderChain({
    feature:'standings',
    providers:[
      {
        id:'primary',
        label:'Primary',
        run:async()=>{
          const error=new Error('rate limit');
          error.code='RATE_LIMIT';
          error.status=429;
          throw error;
        },
      },
      {
        id:'reserve',
        label:'Reserve',
        run:async()=>({
          available:true,
          standings:[{rank:1}],
          groups:[{rows:[{rank:1}]}],
          sourceMeta:{fetchedAt:'2026-10-07T09:30:00Z'},
        }),
      },
    ],
  });

  assert.equal(result.available,true);
  assert.equal(result.sourceMeta.provider,'reserve');
  assert.equal(result.sourceMeta.label,'Reserve');
  assert.equal(result.sourceMeta.fallback,true);
  assert.equal(result.sourceMeta.fetchedAt,'2026-10-07T09:30:00.000Z');
  assert.deepEqual(result.sourceMeta.attempts,[
    {provider:'primary',state:'error',reason:'RATE_LIMIT',status:429},
    {provider:'reserve',state:'available',reason:''},
  ]);
});

test('provider chain treats enable and accept decisions as strict booleans',async()=>{
  let disabledRuns=0;
  const disabled=await resolveProviderChain({
    providers:[
      {
        id:'bad-enabled',
        enabled:'true',
        run:async()=>{
          disabledRuns+=1;
          return {available:true};
        },
      },
    ],
  });

  assert.equal(disabled.available,false);
  assert.equal(disabledRuns,0);
  assert.deepEqual(disabled.sourceMeta.attempts,[
    {provider:'bad-enabled',state:'skipped',reason:'disabled'},
  ]);

  const accepted=await resolveProviderChain({
    providers:[{
      id:'async',
      run:async()=>({available:true,data:[1]}),
    }],
    accept:async result=>result?.data?.length===1,
  });
  assert.equal(accepted.available,true);
  assert.equal(accepted.sourceMeta.provider,'async');

  const rejected=await resolveProviderChain({
    providers:[{
      id:'truthy',
      run:async()=>({available:true,data:[1]}),
    }],
    accept:async()=> 'true',
  });
  assert.equal(rejected.available,false);
  assert.equal(rejected.sourceMeta.attempts[0].state,'unavailable');
});

test('provider enable failure is isolated and the next provider can still serve data',async()=>{
  const result=await resolveProviderChain({
    feature:'standings',
    providers:[
      {
        id:'broken-enable',
        enabled:async()=>{
          const error=new Error('policy failed');
          error.code='POLICY_FAILURE';
          throw error;
        },
        run:async()=>({available:true,data:['must-not-run']}),
      },
      {
        id:'fallback',
        run:async()=>({
          available:true,
          data:['ok'],
          sourceMeta:{fetchedAt:'2026-10-07T09:31:00+00:00'},
        }),
      },
    ],
  });

  assert.equal(result.available,true);
  assert.deepEqual(result.data,['ok']);
  assert.equal(result.sourceMeta.provider,'fallback');
  assert.equal(result.sourceMeta.fallback,true);
  assert.deepEqual(result.sourceMeta.attempts,[
    {provider:'broken-enable',state:'error',reason:'enable_POLICY_FAILURE',status:null},
    {provider:'fallback',state:'available',reason:''},
  ]);
});

test('provider chain fails closed for malformed provider collections and payloads',async()=>{
  const empty=await resolveProviderChain({providers:null});
  assert.equal(empty.available,false);
  assert.equal(empty.reason,'no_provider');

  const malformed=await resolveProviderChain({
    providers:[
      null,
      {id:'missing-run'},
      {id:'array-result',run:async()=>[1,2,3]},
      {id:'primitive-result',run:async()=>true},
    ],
  });

  assert.equal(malformed.available,false);
  assert.deepEqual(malformed.sourceMeta.attempts,[
    {provider:'provider-1',state:'skipped',reason:'invalid_provider'},
    {provider:'missing-run',state:'skipped',reason:'invalid_provider'},
    {provider:'array-result',state:'unavailable',reason:'invalid_result'},
    {provider:'primitive-result',state:'unavailable',reason:'invalid_result'},
  ]);
});

test('malformed accepted provider payload cannot escape through enumerable getters',async()=>{
  const dangerous={
    available:true,
    data:['primary'],
  };
  Object.defineProperty(dangerous,'danger',{
    enumerable:true,
    get(){
      const error=new Error('getter failed');
      error.code='MALFORMED_PAYLOAD';
      throw error;
    },
  });

  const result=await resolveProviderChain({
    providers:[
      {id:'dangerous',run:async()=>dangerous},
      {
        id:'safe',
        run:async()=>({
          available:true,
          data:['fallback'],
          sourceMeta:{fetchedAt:'2026-10-07T09:32:00Z'},
        }),
      },
    ],
  });

  assert.equal(result.available,true);
  assert.deepEqual(result.data,['fallback']);
  assert.equal(result.sourceMeta.provider,'safe');
  assert.deepEqual(result.sourceMeta.attempts,[
    {provider:'dangerous',state:'unavailable',reason:'result_MALFORMED_PAYLOAD',status:null},
    {provider:'safe',state:'available',reason:''},
  ]);
});

test('provider error metadata is bounded, control-safe and status-aware',()=>{
  const invalidCode={
    code:'BAD\nCODE',
    status:Infinity,
  };
  assert.deepEqual(compactProviderError(invalidCode),{
    code:'BAD_CODE',
    status:null,
  });

  assert.deepEqual(compactProviderError({
    code:{toString(){throw new Error('must not coerce');}},
    name:{toString(){throw new Error('must not coerce');}},
    status:'503',
  }),{
    code:'provider_error',
    status:503,
  });

  const throwing={};
  Object.defineProperty(throwing,'code',{
    get(){throw new Error('getter failed');},
  });
  Object.defineProperty(throwing,'status',{
    get(){throw new Error('getter failed');},
  });
  assert.deepEqual(compactProviderError(throwing),{
    code:'provider_error',
    status:null,
  });
});

test('source provenance uses scalar fields and deterministic timestamps only',()=>{
  const meta=sourceMeta({
    provider:'api-football',
    label:'API-Football',
    fetchedAt:'2026-10-07T11:45:30+02:00',
    freshness:'fresh',
    attribution:'Provider',
    attempts:[
      {provider:'api-football',state:'available',reason:'',status:'200'},
      null,
      'bad',
    ],
  });

  assert.deepEqual(meta,{
    provider:'api-football',
    label:'API-Football',
    source:'network',
    fetchedAt:'2026-10-07T09:45:30.000Z',
    freshness:'fresh',
    fallback:false,
    attribution:'Provider',
    attempts:[
      {provider:'api-football',state:'available',reason:'',status:200},
    ],
  });

  const malformed=sourceMeta({
    provider:{name:'api-football'},
    label:['API-Football'],
    fetchedAt:'2026-10-07T09:45:30',
    freshness:{state:'fresh'},
    attribution:{name:'provider'},
  });

  assert.equal(malformed.provider,'unknown');
  assert.equal(malformed.label,'unknown');
  assert.equal(malformed.fetchedAt,null);
  assert.equal(malformed.freshness,'unknown');
  assert.equal(malformed.attribution,'');
});

test('cached provenance preserves measurable source time and distinguishes stale cache',()=>{
  const cached=markCachedSourceMeta({
    provider:'openligadb',
    label:'OpenLigaDB',
    fetchedAt:'2026-10-07T09:40:00Z',
  });
  const stale=markCachedSourceMeta({
    provider:'api-football',
    label:'API-Football',
    fetchedAt:'2026-10-07T09:39:00Z',
  },{stale:true});

  assert.equal(cached.source,'cache');
  assert.equal(cached.freshness,'cached');
  assert.equal(cached.fetchedAt,'2026-10-07T09:40:00.000Z');
  assert.equal(stale.source,'stale-cache');
  assert.equal(stale.freshness,'stale');
  assert.equal(stale.fetchedAt,'2026-10-07T09:39:00.000Z');

  const truthyString=markCachedSourceMeta({
    provider:'api-football',
    fetchedAt:'2026-10-07T09:38:00Z',
  },{stale:'true'});
  assert.equal(truthyString.source,'cache');
  assert.equal(truthyString.freshness,'cached');

  const missingTimestamp=markCachedSourceMeta({provider:'api-football'});
  assert.equal(missingTimestamp.fetchedAt,null);
});

test('RC128 OpenLigaDB adapter only enables explicitly supported competitions',()=>{
  assert.equal(openLigaCompetition(78,2026)?.shortcuts?.[0],'bl1');
  assert.equal(openLigaCompetition(39,2026),null);
  assert.match(openLigaTableUrls(78,2026)[0].url,/getbltable\/bl1\/2026$/);

  const normalized=normalizeOpenLigaStandings([{
    TeamInfoId:17,
    TeamName:'Test FC',
    Points:41,
    Matches:20,
    Won:12,
    Draw:5,
    Lost:3,
    Goals:40,
    OpponentGoals:20,
    GoalDiff:20,
  }],{
    leagueId:78,
    season:2026,
    label:'Bundesliga',
  });

  assert.equal(normalized.available,true);
  assert.equal(normalized.standings[0].team.id,0);
  assert.equal(normalized.standings[0].team.providerId,17);
  assert.equal(normalized.standings[0].points,41);
});

test('RC128 football-data.org adapter remains optional and preserves provider attribution',()=>{
  assert.match(
    footballDataStandingsUrl(39,2026),
    /competitions\/PL\/standings\?season=2026$/,
  );
  assert.equal(footballDataStandingsUrl(999999,2026),'');

  const normalized=normalizeFootballDataStandings({
    competition:{name:'Premier League'},
    area:{name:'England'},
    standings:[{
      type:'TOTAL',
      table:[{
        position:1,
        team:{id:64,name:'Liverpool'},
        playedGames:10,
        won:8,
        draw:1,
        lost:1,
        points:25,
        goalsFor:24,
        goalsAgainst:8,
        goalDifference:16,
        form:'W,W,D,W,W',
      }],
    }],
  },{
    leagueId:39,
    season:2026,
  });

  assert.equal(normalized.available,true);
  assert.equal(normalized.standings[0].team.id,0);
  assert.equal(normalized.standings[0].team.providerId,64);
  assert.equal(normalized.sourceMeta.provider,'football-data');
  assert.equal(normalized.sourceMeta.attribution,'Data provided by football-data.org');
});
