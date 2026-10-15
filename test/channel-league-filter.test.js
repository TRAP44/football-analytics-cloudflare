import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCompetitionIntegrityRuntime } from '../src/competition-integrity-runtime.js';

// Предпросмотры канала 13.10: «Premier League» Ливана и Ямайки проходили как
// главный турнир (фильтр по названию), а подпись читалась как АПЛ.

const runtime = createCompetitionIntegrityRuntime({
  APP_VERSION: 'test',
  bumpTelemetry: () => {},
  hasSupabase: () => false,
  isFinishedStatus: () => false,
  isLiveStatus: () => false,
  json: body => body,
  memory: {},
  recordOpsEvent: async () => {},
  safeOpsMetadata: value => value,
  supaSelectMany: async () => [],
  supaUpsert: async () => true,
});

test('channel league: domestic leagues outside the catalog do not pass by name', () => {
  const { isChannelLeague, isTopLeague } = runtime;
  // Ливан и Ямайка: isTopLeague пропускает по названию, канал — нет.
  assert.equal(isTopLeague(390, 'Premier League'), true);
  assert.equal(isChannelLeague(390, 'Premier League'), false);
  assert.equal(isChannelLeague(322, 'Premier League'), false);
  assert.equal(isChannelLeague(0, 'Serie A'), false);
  assert.equal(isChannelLeague(0, 'Bundesliga'), false);
  // Справочник по id.
  assert.equal(isChannelLeague(39, 'Premier League'), true);
  assert.equal(isChannelLeague(140, 'La Liga'), true);
  assert.equal(isChannelLeague(2, 'UEFA Champions League'), true);
  assert.equal(isChannelLeague(40, 'Championship'), false, 'priority below 80');
  // Международные турниры по названию.
  assert.equal(isChannelLeague(17, 'AFC Champions League Elite'), true);
  assert.equal(isChannelLeague(0, 'UEFA Youth League'), false);
  assert.equal(isChannelLeague(0, "UEFA Champions League Women"), false);
  assert.equal(isChannelLeague(null, ''), false);
});

test('composition root uses the channel filter for channel posts; daily post is removed', () => {
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.equal(worker.includes('ChannelDailyPost'), false, 'пост «Матчи дня» удалён (Сергей 15.10)');
  assert.equal(fs.existsSync(new URL('../src/channel-daily-post-job.js', import.meta.url)), false);
  const swing = worker.slice(worker.indexOf('matchSwingJob = createMatchSwingJob({'));
  assert.match(swing.slice(0, swing.indexOf('});')), /isTopLeague: \(\.\.\.args\) => isChannelLeague\(\.\.\.args\)/);
});
