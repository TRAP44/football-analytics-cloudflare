import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  markCachedSourceMeta,
  resolveProviderChain,
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

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const envExample=fs.readFileSync('.env.example','utf8');

test('RC128 provider chain falls back without hiding the primary failure',async()=>{
  const result=await resolveProviderChain({
    feature:'standings',
    providers:[
      {id:'primary',label:'Primary',run:async()=>{const e=new Error('rate limit');e.code='RATE_LIMIT';throw e;}},
      {id:'reserve',label:'Reserve',run:async()=>({available:true,standings:[{rank:1}],groups:[{rows:[{rank:1}]}]})},
    ],
  });
  assert.equal(result.available,true);
  assert.equal(result.sourceMeta.provider,'reserve');
  assert.equal(result.sourceMeta.fallback,true);
  assert.equal(result.sourceMeta.attempts[0].provider,'primary');
  assert.equal(result.sourceMeta.attempts[0].state,'error');
});

test('provider chain fails closed for truthy string enable/accept values and supports async accept',async()=>{
  let disabledRuns=0;
  const disabled=await resolveProviderChain({
    providers:[
      {id:'bad-enabled',enabled:'true',run:async()=>{disabledRuns+=1;return {available:true};}},
    ],
  });
  assert.equal(disabled.available,false);
  assert.equal(disabledRuns,0);
  assert.equal(disabled.sourceMeta.attempts[0].state,'skipped');

  const accepted=await resolveProviderChain({
    providers:[{id:'async',run:async()=>({available:true,data:[1]})}],
    accept:async result=>result?.data?.length===1,
  });
  assert.equal(accepted.available,true);
  assert.equal(accepted.sourceMeta.provider,'async');

  const rejected=await resolveProviderChain({
    providers:[{id:'truthy',run:async()=>({available:true,data:[1]})}],
    accept:async()=> 'true',
  });
  assert.equal(rejected.available,false);
});

test('provider chain handles malformed provider collections and provider entries safely',async()=>{
  const empty=await resolveProviderChain({providers:null});
  assert.equal(empty.available,false);
  assert.equal(empty.reason,'no_provider');

  const malformed=await resolveProviderChain({
    providers:[null,{id:'missing-run'}],
  });
  assert.equal(malformed.available,false);
  assert.equal(malformed.sourceMeta.attempts.length,2);
  assert.ok(malformed.sourceMeta.attempts.every(item=>item.reason==='invalid_provider'));
});

test('provider error metadata keeps only valid HTTP status and bounded safe code',async()=>{
  const invalid=await resolveProviderChain({
    providers:[{
      id:'primary',
      run:async()=>{
        const error=new Error('boom');
        error.code='BAD\nCODE';
        error.status=Infinity;
        throw error;
      },
    }],
  });
  assert.equal(invalid.sourceMeta.attempts[0].reason,'BAD_CODE');
  assert.equal(invalid.sourceMeta.attempts[0].status,null);
});

test('RC128 cached provenance explicitly distinguishes fresh and stale cache',()=>{
  const cached=markCachedSourceMeta({provider:'openligadb',label:'OpenLigaDB'});
  const stale=markCachedSourceMeta({provider:'api-football',label:'API-Football'},{stale:true});
  assert.equal(cached.source,'cache');
  assert.equal(cached.freshness,'cached');
  assert.equal(stale.source,'stale-cache');
  assert.equal(stale.freshness,'stale');
});

test('cached provenance only marks stale on an actual boolean true',()=>{
  const meta=markCachedSourceMeta({provider:'api-football'},{stale:'false'});
  assert.equal(meta.source,'cache');
  assert.equal(meta.freshness,'cached');
  assert.equal(meta.fallback,false);
});

test('RC128 OpenLigaDB adapter only enables explicitly supported competitions',()=>{
  assert.equal(openLigaCompetition(78,2026)?.shortcuts?.[0],'bl1');
  assert.equal(openLigaCompetition(39,2026),null);
  assert.match(openLigaTableUrls(78,2026)[0].url,/getbltable\/bl1\/2026$/);
  const normalized=normalizeOpenLigaStandings([{
    TeamInfoId:17,TeamName:'Test FC',Points:41,Matches:20,Won:12,Draw:5,Lost:3,Goals:40,OpponentGoals:20,GoalDiff:20,
  }],{leagueId:78,season:2026,label:'Bundesliga'});
  assert.equal(normalized.available,true);
  assert.equal(normalized.standings[0].team.id,0);
  assert.equal(normalized.standings[0].team.providerId,17);
  assert.equal(normalized.standings[0].points,41);
});

test('RC128 football-data.org adapter is optional and normalizes provider IDs safely',()=>{
  assert.match(footballDataStandingsUrl(39,2026),/competitions\/PL\/standings\?season=2026$/);
  assert.equal(footballDataStandingsUrl(999999,2026),'');
  const normalized=normalizeFootballDataStandings({
    competition:{name:'Premier League'},area:{name:'England'},
    standings:[{type:'TOTAL',table:[{
      position:1,team:{id:64,name:'Liverpool'},playedGames:10,won:8,draw:1,lost:1,points:25,goalsFor:24,goalsAgainst:8,goalDifference:16,form:'W,W,D,W,W',
    }]}],
  },{leagueId:39,season:2026});
  assert.equal(normalized.standings[0].team.id,0);
  assert.equal(normalized.standings[0].team.providerId,64);
  assert.equal(normalized.sourceMeta.attribution,'Data provided by football-data.org');
});

test('RC128 Worker uses distributed guards, fallback routing and server-only optional secret',()=>{
  assert.match(worker,/resolveProviderChain/);
  assert.match(worker,/async function resolveTournamentStandings/);
  assert.match(worker,/secondary:.*provider.*:minute/);
  assert.match(worker,/p_limit: Math\.max\(1, Number\(limit \|\| 1\)\)/);
  assert.match(worker,/footballDataToken: env\.FOOTBALL_DATA_TOKEN/);
  assert.match(envExample,/^FOOTBALL_DATA_TOKEN=$/m);
  assert.match(worker,/multiProviderDataService: 'enabled'/);
  assert.match(worker,/openLigaDbStandingsFallback: 'enabled'/);
  assert.match(worker,/sourceProvenance: 'enabled'/);
});

test('RC128 Mini App exposes provider attribution and data provenance',()=>{
  assert.match(app,/function dataProvenanceHtml/);
  assert.match(app,/Паспорт данных/);
  assert.match(app,/data\.sourceMeta\?\.label/);
  assert.match(app,/standing-team-readonly/);
});

test('RC128 base provider contract keeps the proven schema fingerprint through additive RC129 metadata',()=>{
  assert.match(worker,/const EXPECTED_SCHEMA_FINGERPRINT = '6a7f0fe444f49a2a52c4603e952ee9ea'/);
  assert.ok(fs.existsSync('supabase/migrations/supabase_migration_v6_19.sql'));
});
