import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/api-football-gateway.js','utf8');
const migration=fs.readFileSync('supabase/migrations/supabase_migration_v6_19.sql','utf8');

test('RC129 persists source provenance in existing cache, odds and model tables',()=>{
  assert.match(migration,/alter table public\.analysis_cache[\s\S]*provider text[\s\S]*source_updated_at[\s\S]*freshness_status[\s\S]*updated_at/);
  assert.match(migration,/alter table public\.odds_snapshots[\s\S]*provider text[\s\S]*bookmaker_count[\s\S]*source_updated_at/);
  assert.match(migration,/alter table public\.model_predictions[\s\S]*data_provenance jsonb[\s\S]*model_inputs_version text/);
  assert.doesNotMatch(migration,/create table if not exists public\.(?:analysis_cache|odds_snapshots|model_predictions)/);
  assert.match(worker,/function cacheSourceProvenance/);
  assert.match(worker,/freshness_status: provenance\.freshness/);
  assert.match(worker,/data_provenance: payload\.dataProvenance \|\| \{\}/);
  assert.match(worker,/model_inputs_version: String\(payload\.analysisVersion \|\| ''\)/);
  assert.match(worker,/bookmaker_count: Number\(market\.sources \|\| market\.bookmakers \|\| 0\)/);
});

test('RC129 verifies provenance columns explicitly while preserving the stable structural fingerprint',()=>{
  assert.match(worker,/cache_provenance'.*analysis_cache'.*provider.*source_updated_at.*freshness_status.*updated_at/);
  assert.match(worker,/odds_provenance'.*odds_snapshots'.*provider.*bookmaker_count.*source_updated_at/);
  assert.match(worker,/model_provenance'.*model_predictions'.*data_provenance.*model_inputs_version/);
  assert.match(migration,/backend_schema_fingerprint/);
  assert.match(migration,/c\.table_name = 'analysis_cache'.*provider.*source_updated_at.*freshness_status.*updated_at/s);
  assert.match(worker,/const EXPECTED_SCHEMA_FINGERPRINT = 'c2c22ec25aacfcf1b9938b0850cebf49'/);
});

test('RC129 retries only transient API-Football transport failures and never hides quota policy',()=>{
  assert.match(worker,/function isRetryableFootballTransportError\(error\)/);
  assert.match(worker,/String\(error\?\.code \|\| ''\) === 'FOOTBALL_NETWORK'/);
  assert.match(worker,/Math\.min\(1, Number\(options\.transportRetries \?\? 1\)\)/);
  assert.match(worker,/await sleepMs\(180 \* \(attempt \+ 1\)\)/);
  assert.doesNotMatch(worker,/isRetryableFootballTransportError[\s\S]{0,240}FOOTBALL_RATE_LIMIT/);
});

test('RC129 Match Center handles an empty fixture without calling the AI-only failure helper',()=>{
  const start=worker.indexOf('async function apiMatchCenter');
  const end=worker.indexOf('async function apiAnalyze',start);
  assert.ok(start>=0 && end>start);
  const matchCenter=worker.slice(start,end);
  assert.match(matchCenter,/if \(!fixture\) return json\(\{ error: 'Матч не найден\.' \}, 404\)/);
  assert.doesNotMatch(matchCenter,/trackedFullAiFailureResponse/);
});

test('RC129 keeps provider xG and internal expected-goal model semantically separate',()=>{
  assert.match(worker,/\['expected_goals', 'xG'\]/);
  assert.match(worker,/smartStat\(statistics, 'expected_goals', 'home'\)/);
  assert.match(worker,/home_expected_goals: Number\.isFinite\(Number\(payload\.goalModel\?\.homeExpected\)\)/);
  assert.match(worker,/methodology: 'Автоматические выводы строятся только из текущего счёта, событий и официальной статистики матча\./);
});

test('RC129 reliability flags remain present in later release candidates',()=>{
  assert.match(worker,/persistentDataProvenance: 'enabled'/);
  assert.match(worker,/transientProviderRetry: 'enabled'/);
});
