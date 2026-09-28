import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeTeamKey,
  normalizeTheOddsApiMarket,
  theOddsApiUrl,
  theOddsSportKey,
} from '../src/providers/the-odds-api.js';

const worker=fs.readFileSync('src/worker.js','utf8');
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
  assert.match(worker,/theOddsApiKey: env\.THE_ODDS_API_KEY \|\| ''/);
  assert.match(envExample,/^THE_ODDS_API_KEY=$/m);
  assert.doesNotMatch(worker,/apiKey:\s*env\.THE_ODDS_API_KEY/);
  assert.match(worker,/async function secondaryOddsMarket/);
  assert.match(worker,/if \(!cfg\.theOddsApiKey\) return \{ available:false, reason:'token_not_configured'/);
  assert.match(worker,/claimSecondaryProviderBudget\(cfg, 'the-odds-api', 8\)/);
});

test('RC130 keeps the secondary market as fallback and RC143 also allows it after a structurally invalid primary market',()=>{
  assert.match(worker,/const primaryMarket = extractMarket\(odds\)/);
  assert.match(worker,/const primaryMarketShape = assessOddsMarketQuality\(primaryMarket/);
  assert.match(worker,/const secondaryOdds = primaryMarket && primaryMarketShape\.marketValid/);
  assert.match(worker,/const market = secondaryOdds\?\.available \? secondaryOdds\.market : primaryMarket \|\| null/);
  assert.match(worker,/if \(!primaryLiveOdds \|\| !primaryLiveShape\.marketValid\) \{[\s\S]*secondaryOddsMarket\(fixture, cfg, \{ mode:'live' \}\)/);
  assert.match(worker,/provider: String\(market\.provider \|\| 'api-football'\)/);
});

test('RC130 marks unusable raw odds as unavailable instead of pretending a market exists',()=>{
  assert.match(worker,/function usableOddsFeatureMeta/);
  assert.match(worker,/reason: String\(meta\?\.reason \|\| '1x2_market_missing'\)/);
  assert.match(worker,/odds: resolvedOddsMeta/);
});

test('RC130 needs no odds-fallback DDL because RC129 snapshots already persist provider provenance',()=>{
  assert.ok(fs.existsSync('supabase/migrations/supabase_migration_v6_19.sql'));
  const v620=fs.readFileSync('supabase/migrations/supabase_migration_v6_20.sql','utf8');
  assert.match(v620,/provider_incident_alert_deliveries/);
  assert.doesNotMatch(v620,/alter\s+table\s+public\.odds_snapshots/i);
  assert.match(worker,/theOddsApiOddsFallback: cfg\.theOddsApiKey \? 'enabled' : 'available_when_configured'/);
});
