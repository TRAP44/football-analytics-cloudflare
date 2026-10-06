import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRefereeIntelligenceRuntime } from '../src/referee-intelligence-runtime.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createRuntime({
  hasSupabase = () => false,
  memory = { refereeMatchHistory: new Map() },
  supaSelectMany = async () => [],
  supaUpsert = async () => true,
} = {}) {
  return {
    memory,
    runtime: createRefereeIntelligenceRuntime({
      hasSupabase,
      memory,
      numericValue: value => Number(value),
      supaSelectMany,
      supaUpsert,
    }),
  };
}

const app = readRepoFile('public/app.js');
const matchCenter = readRepoFile('src/match-center-runtime.js');
const migration = readRepoFile('supabase/migrations/supabase_migration_v6_13.sql');

test('RC42 referee card summary requires both observed events and trusted foul statistics', () => {
  const { runtime } = createRuntime();

  assert.deepEqual(
    runtime.refereeCardSummary(
      [
        { type: 'Card', detail: 'Yellow Card' },
        { type: 'Card', detail: 'Second Yellow card' },
        { type: 'Goal', detail: 'Normal Goal' },
      ],
      {
        items: [
          { key: 'fouls', home: 11, away: 14 },
        ],
      },
    ),
    {
      yellow: 1,
      red: 1,
      fouls: 25,
      observedCards: true,
      observedFouls: true,
      verified: true,
    },
  );

  const missingStatistics = runtime.refereeCardSummary(
    [{ type: 'Goal', detail: 'Normal Goal' }],
    null,
  );
  assert.equal(missingStatistics.yellow, 0);
  assert.equal(missingStatistics.red, 0);
  assert.equal(missingStatistics.observedCards, true);
  assert.equal(missingStatistics.observedFouls, false);
  assert.equal(missingStatistics.verified, false);
});

test('RC42 verified completed-match referee evidence is persisted while partial evidence is rejected', async () => {
  const { runtime, memory } = createRuntime();

  const saved = await runtime.saveRefereeMatchHistory({
    fixtureId: 77,
    referee: 'Michael Oliver, England',
    kickoffAt: '2026-09-01T18:00:00Z',
    leagueId: 39,
    events: [
      { type: 'Card', detail: 'Yellow Card' },
      { type: 'Goal', detail: 'Normal Goal' },
    ],
    statistics: {
      items: [
        { key: 'fouls', home: 10, away: 12 },
      ],
    },
  }, {});

  assert.equal(saved, true);
  assert.equal(memory.refereeMatchHistory.size, 1);
  assert.deepEqual(
    {
      fixture_id: memory.refereeMatchHistory.get(77).fixture_id,
      referee_key: memory.refereeMatchHistory.get(77).referee_key,
      referee_name: memory.refereeMatchHistory.get(77).referee_name,
      referee_country: memory.refereeMatchHistory.get(77).referee_country,
      league_id: memory.refereeMatchHistory.get(77).league_id,
      yellow_cards: memory.refereeMatchHistory.get(77).yellow_cards,
      red_cards: memory.refereeMatchHistory.get(77).red_cards,
      fouls: memory.refereeMatchHistory.get(77).fouls,
    },
    {
      fixture_id: 77,
      referee_key: 'michael oliver',
      referee_name: 'Michael Oliver',
      referee_country: 'England',
      league_id: 39,
      yellow_cards: 1,
      red_cards: 0,
      fouls: 22,
    },
  );

  const rejected = await runtime.saveRefereeMatchHistory({
    fixtureId: 78,
    referee: 'Michael Oliver, England',
    kickoffAt: '2026-09-02T18:00:00Z',
    leagueId: 39,
    events: [
      { type: 'Card', detail: 'Yellow Card' },
    ],
    statistics: null,
  }, {});

  assert.equal(rejected, false);
  assert.equal(memory.refereeMatchHistory.has(78), false);
});

test('RC42 Supabase persistence uses referee_match_history and fixture identity as the conflict key', async () => {
  const upserts = [];
  const { runtime } = createRuntime({
    hasSupabase: () => true,
    supaUpsert: async (...args) => {
      upserts.push(args);
      return true;
    },
  });

  const saved = await runtime.saveRefereeMatchHistory({
    fixtureId: 91,
    referee: 'Szymon Marciniak, Poland',
    kickoffAt: '2026-08-10T19:00:00Z',
    leagueId: 2,
    events: [
      { type: 'Card', detail: 'Yellow Card' },
      { type: 'Card', detail: 'Red Card' },
    ],
    statistics: {
      items: [
        { key: 'fouls', home: 13, away: 9 },
      ],
    },
  }, { supabase: true });

  assert.equal(saved, true);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0][1], 'referee_match_history');
  assert.equal(upserts[0][2].fixture_id, 91);
  assert.equal(upserts[0][2].referee_key, 'szymon marciniak');
  assert.equal(upserts[0][2].yellow_cards, 1);
  assert.equal(upserts[0][2].red_cards, 1);
  assert.equal(upserts[0][2].fouls, 22);
  assert.equal(upserts[0][3], 'fixture_id');
});

test('RC42 referee history requires at least three verified unique past fixtures', async () => {
  const now = Date.now();
  const isoAgo = hours => new Date(now - hours * 3600_000).toISOString();
  const memory = {
    refereeMatchHistory: new Map([
      [1, {
        fixture_id: 1,
        referee_key: 'michael oliver',
        referee_name: 'Michael Oliver',
        referee_country: 'England',
        kickoff_at: isoAgo(24),
        yellow_cards: 4,
        red_cards: 0,
        fouls: 21,
      }],
      [2, {
        fixture_id: 2,
        referee_key: 'michael oliver',
        referee_name: 'Michael Oliver',
        referee_country: 'England',
        kickoff_at: isoAgo(48),
        yellow_cards: 6,
        red_cards: 1,
        fouls: 28,
      }],
    ]),
  };
  const { runtime } = createRuntime({ memory });

  const twoMatchProfile = await runtime.loadRefereeHistoryProfile(
    'Michael Oliver, England',
    {},
  );

  assert.equal(twoMatchProfile.available, false);
  assert.equal(twoMatchProfile.sample, 2);
  assert.equal(twoMatchProfile.avgYellow, 5);
  assert.equal(twoMatchProfile.avgRed, 0.5);
  assert.equal(twoMatchProfile.styleLabel, 'Строгий стиль');

  memory.refereeMatchHistory.set(3, {
    fixture_id: 3,
    referee_key: 'michael oliver',
    referee_name: 'Michael Oliver',
    referee_country: 'England',
    kickoff_at: isoAgo(72),
    yellow_cards: 3,
    red_cards: 0,
    fouls: 19,
  });

  const verifiedProfile = await runtime.loadRefereeHistoryProfile(
    'Michael Oliver, England',
    {},
  );

  assert.equal(verifiedProfile.available, true);
  assert.equal(verifiedProfile.sample, 3);
  assert.equal(verifiedProfile.source, 'verified-match-history');
  assert.equal(verifiedProfile.avgYellow, 4.3);
  assert.equal(verifiedProfile.avgRed, 0.3);
  assert.equal(verifiedProfile.avgFouls, 22.7);
  assert.equal(verifiedProfile.styleLabel, 'Средняя строгость');
});

test('RC42 referee history excludes future, foreign-country and malformed evidence', async () => {
  const now = Date.now();
  const memory = {
    refereeMatchHistory: new Map([
      [1, {
        fixture_id: 1,
        referee_key: 'michael oliver',
        referee_name: 'Michael Oliver',
        referee_country: 'England',
        kickoff_at: new Date(now - 3600_000).toISOString(),
        yellow_cards: 4,
        red_cards: 0,
        fouls: 20,
      }],
      [2, {
        fixture_id: 2,
        referee_key: 'michael oliver',
        referee_name: 'Michael Oliver',
        referee_country: 'Scotland',
        kickoff_at: new Date(now - 7200_000).toISOString(),
        yellow_cards: 7,
        red_cards: 0,
        fouls: 30,
      }],
      [3, {
        fixture_id: 3,
        referee_key: 'michael oliver',
        referee_name: 'Michael Oliver',
        referee_country: 'England',
        kickoff_at: new Date(now + 3600_000).toISOString(),
        yellow_cards: 5,
        red_cards: 0,
        fouls: 25,
      }],
      [4, {
        fixture_id: 4,
        referee_key: 'michael oliver',
        referee_name: 'Michael Oliver',
        referee_country: 'England',
        kickoff_at: new Date(now - 10800_000).toISOString(),
        yellow_cards: Infinity,
        red_cards: 0,
        fouls: 18,
      }],
    ]),
  };
  const { runtime } = createRuntime({ memory });

  const profile = await runtime.loadRefereeHistoryProfile(
    'Michael Oliver, England',
    {},
  );

  assert.equal(profile.sample, 1);
  assert.equal(profile.available, false);
  assert.equal(profile.avgYellow, 4);
  assert.equal(profile.avgFouls, 20);
});

test('RC42 match center records referee history only from finished match analytical data', () => {
  assert.match(
    matchCenter,
    /if \(finished && fixture\.fixture\?\.referee\) await saveRefereeMatchHistory\(\{[\s\S]*?fixtureId,[\s\S]*?referee:fixture\.fixture\.referee,[\s\S]*?events:analyticalEvents,[\s\S]*?statistics:analyticalStatistics[\s\S]*?\}, cfg\)\.catch\(\(\) => false\)/,
  );
});

test('RC42 Mini App exposes referee history only when verified history is available', () => {
  assert.match(app, /ai\.refereeHistory\?\.available/);
  assert.match(app, /ai\.refereeHistory\.styleLabel/);
  assert.match(app, /ai\.refereeHistory\.avgYellow/);
  assert.match(app, /ai\.refereeHistory\.sample/);
});

test('RC42 historical referee table remains worker-only with RLS enabled', () => {
  assert.match(migration, /create table if not exists public\.referee_match_history/i);
  assert.match(migration, /alter table public\.referee_match_history enable row level security/i);
  assert.match(
    migration,
    /revoke all privileges on table public\.referee_match_history from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant select, insert, update, delete on table public\.referee_match_history to service_role/i,
  );
  assert.match(migration, /HISTORICAL \/ FROZEN MIGRATION/);
});
