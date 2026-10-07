import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeTeamKey,
  normalizeTheOddsApiMarket,
  theOddsApiUrl,
  theOddsSportKey,
} from '../src/providers/the-odds-api.js';

const commonInfrastructure=fs.readFileSync('src/common-infrastructure-runtime.js','utf8');
const teamTournamentRuntime=fs.readFileSync('src/team-tournament-runtime.js','utf8');
const analysisRuntime=fs.readFileSync('src/analysis-runtime.js','utf8');
const matchCenterRuntime=fs.readFileSync('src/match-center-runtime.js','utf8');
const envExample=fs.readFileSync('.env.example','utf8');

test('RC130 maps only explicitly supported competitions to official The Odds API sport keys',()=>{
  assert.equal(theOddsSportKey(39),'soccer_epl');
  assert.equal(theOddsSportKey(2),'soccer_uefa_champs_league');
  assert.equal(theOddsSportKey(999999),'');
  assert.match(theOddsApiUrl(39),/sports\/soccer_epl\/odds/);
  assert.match(theOddsApiUrl(39),/markets=h2h/);
  assert.doesNotMatch(theOddsApiUrl(39),/apiKey=/);
});

test('RC130 normalizes club names and a licensed h2h feed into the internal 1X2 market',()=>{
  assert.equal(normalizeTeamKey('Liverpool FC'),'liverpool');
  const rows=[{
    id:'event-1',
    sport_key:'soccer_epl',
    commence_time:'2026-09-25T19:00:00Z',
    home_team:'Liverpool',
    away_team:'Everton',
    bookmakers:[
      {key:'a',last_update:'2026-09-25T17:00:00Z',markets:[{key:'h2h',outcomes:[
        {name:'Liverpool',price:1.80},{name:'Draw',price:3.70},{name:'Everton',price:4.50},
      ]}]},
      {key:'b',last_update:'2026-09-25T17:01:00Z',markets:[{key:'h2h',outcomes:[
        {name:'Liverpool FC',price:1.82},{name:'Draw',price:3.65},{name:'Everton FC',price:4.45},
      ]}]},
    ],
  }];
  const market=normalizeTheOddsApiMarket(rows,{
    homeName:'Liverpool FC',
    awayName:'Everton FC',
    kickoffAt:'2026-09-25T19:00:00Z',
  });
  assert.ok(market);
  assert.equal(market.provider,'the-odds-api');
  assert.equal(market.bookmakers,2);
  assert.equal(market.sources,2);
  assert.equal(market.sourceEventId,'event-1');
  assert.ok(Math.abs(market.probabilities.home+market.probabilities.draw+market.probabilities.away-100)<=0.2);
});

test('RC130 fails closed on missing kickoff and ignores malformed bookmaker payloads',()=>{
  const rows=[{
    id:'event-1',
    sport_key:'soccer_epl',
    commence_time:'2026-09-25T19:00:00Z',
    home_team:'Liverpool',
    away_team:'Everton',
    bookmakers:{unexpected:true},
  }];
  assert.equal(normalizeTheOddsApiMarket(rows,{
    homeName:'Liverpool',
    awayName:'Everton',
    kickoffAt:'',
  }),null);
  assert.equal(normalizeTheOddsApiMarket(rows,{
    homeName:'Liverpool',
    awayName:'Everton',
    kickoffAt:'2026-09-25T19:00:00Z',
  }),null);
});

test('RC130 rejects non-finite bookmaker prices',()=>{
  const rows=[{
    id:'event-2',
    sport_key:'soccer_epl',
    commence_time:'2026-09-25T19:00:00Z',
    home_team:'Liverpool',
    away_team:'Everton',
    bookmakers:[{markets:[{key:'h2h',outcomes:[
      {name:'Liverpool',price:'Infinity'},
      {name:'Draw',price:3.7},
      {name:'Everton',price:4.5},
    ]}]}],
  }];
  assert.equal(normalizeTheOddsApiMarket(rows,{
    homeName:'Liverpool',
    awayName:'Everton',
    kickoffAt:'2026-09-25T19:00:00Z',
  }),null);
});

test('RC130 rejects a different fixture instead of guessing by kickoff time',()=>{
  const rows=[{
    id:'wrong',
    sport_key:'soccer_epl',
    commence_time:'2026-09-25T19:00:00Z',
    home_team:'Arsenal',
    away_team:'Chelsea',
    bookmakers:[{markets:[{key:'h2h',outcomes:[
      {name:'Arsenal',price:2.0},{name:'Draw',price:3.4},{name:'Chelsea',price:3.7},
    ]}]}],
  }];
  assert.equal(normalizeTheOddsApiMarket(rows,{
    homeName:'Liverpool',
    awayName:'Everton',
    kickoffAt:'2026-09-25T19:00:00Z',
  }),null);
});

test('RC130 configures The Odds API only as an optional server-side fallback',()=>{
  assert.match(commonInfrastructure,/theOddsApiKey:\s*env\.THE_ODDS_API_KEY\s*\|\|\s*''/);
  assert.match(envExample,/^THE_ODDS_API_KEY=$/m);
  assert.match(teamTournamentRuntime,/async function secondaryOddsMarket/);
  assert.match(teamTournamentRuntime,/const apiKey=safeText\(cfg\?\.theOddsApiKey,\s*500\)/);
  assert.match(teamTournamentRuntime,/if \(!apiKey\) return \{ available:false, reason:'token_not_configured'/);
  assert.match(teamTournamentRuntime,/claimSecondaryProviderBudget\(cfg,\s*'the-odds-api',\s*8\)/);
  assert.match(teamTournamentRuntime,/url\.searchParams\.set\('apiKey',\s*apiKey\)/);
});

test('RC130 isolates prematch and live fallback caches so live odds cannot reuse a longer-lived prematch entry',()=>{
  assert.match(
    teamTournamentRuntime,
    /secondary-odds:\$\{fixtureId\}:the-odds-api:\$\{feature\}:v2/,
  );
  assert.doesNotMatch(
    teamTournamentRuntime,
    /secondary-odds:\$\{fixtureId\}:the-odds-api:v1/,
  );
  assert.match(teamTournamentRuntime,/const ttlMinutes=mode === 'live' \? 1 :/);
});

test('RC130 keeps the secondary market as fallback and RC143 also allows it after a structurally invalid primary market',()=>{
  assert.match(analysisRuntime,/primaryMarket=objectValue\(extractMarket\(odds\)\)/);
  assert.match(analysisRuntime,/assessOddsMarketQuality\(primaryMarket,\{/);
  assert.match(analysisRuntime,/if \(!\(primaryMarket && primaryMarketShape\.marketValid === true\)\) \{/);
  assert.match(analysisRuntime,/secondaryOddsMarket\(fixture,cfg,\{mode:'prematch'\}\)/);
  assert.match(analysisRuntime,/const market=secondaryMarket \|\| primaryMarket/);

  assert.match(matchCenterRuntime,/if \(!primaryLiveOdds \|\| primaryLiveShape\.marketValid!==true\) \{/);
  assert.match(matchCenterRuntime,/optionalAsync\(secondaryOddsMarket,fixture,cfg,\{mode:'live'\}\)/);
});

test('RC130 marks unusable raw odds as unavailable instead of pretending a market exists',()=>{
  assert.match(teamTournamentRuntime,/function usableOddsFeatureMeta/);
  assert.match(teamTournamentRuntime,/reason:safeText\(meta\?\.reason,\s*160\) \|\| '1x2_market_missing'/);
  assert.match(analysisRuntime,/odds:resolvedOddsMeta/);
});

test('RC130 needs no odds-fallback DDL because RC129 snapshots already persist provider provenance',()=>{
  assert.ok(fs.existsSync('supabase/migrations/supabase_migration_v6_19.sql'));
  const v619=fs.readFileSync('supabase/migrations/supabase_migration_v6_19.sql','utf8');
  const v620=fs.readFileSync('supabase/migrations/supabase_migration_v6_20.sql','utf8');
  assert.match(
    v619,
    /alter table public\.odds_snapshots[\s\S]*add column if not exists provider[\s\S]*bookmaker_count[\s\S]*source_updated_at/,
  );
  assert.match(v620,/provider_incident_alert_deliveries/);
  assert.doesNotMatch(v620,/alter\s+table\s+public\.odds_snapshots/i);
});
