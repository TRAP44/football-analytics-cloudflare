import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MATCH_WATCHLIST_KEY, readMatchWatchlist } from '../public/modules/app-runtime.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/styles/public-shell.css', import.meta.url), 'utf8');

function block(startNeedle, endNeedle) {
  const start = app.indexOf(startNeedle);
  const end = app.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing ${startNeedle}`);
  assert.ok(end > start, `missing boundary ${endNeedle}`);
  return app.slice(start, end);
}

test('match watchlist is local, bounded and fail-safe', () => {
  assert.equal(MATCH_WATCHLIST_KEY, 'matchradar:watchlist:v1');

  const storage = {
    getItem() {
      return JSON.stringify([
        { fixtureId: 10, homeName: 'Home', awayName: 'Away', league: 'League', date: '2026-10-01T18:00:00Z' },
        { fixtureId: 10, homeName: 'Duplicate', awayName: 'Away', date: '2026-10-01T18:00:00Z' },
        { fixtureId: 0, homeName: 'Invalid', awayName: 'Away' },
      ]);
    },
  };
  const items = readMatchWatchlist(storage);
  assert.equal(items.length, 1);
  assert.equal(items[0].fixtureId, 10);
  assert.equal(items[0].homeName, 'Home');

  assert.deepEqual(readMatchWatchlist({ getItem() { throw new Error('blocked'); } }), []);
});

test('watchlist helpers persist locally without backend or provider requests', () => {
  const source = block('function watchedMatch', 'function radarFeedItems');
  assert.match(source, /localStorage\.setItem\(MATCH_WATCHLIST_KEY/);
  assert.match(source, /state\.watchlist/);
  assert.match(source, /slice\(0, 50\)/);
  assert.doesNotMatch(source, /\bapi\s*\(/);
  assert.doesNotMatch(source, /fetch\s*\(/);
});

test('match cards expose follow control and reuse existing match data', () => {
  const source = block('function matchCardHtml', 'function analysisHistoryForFixture');
  assert.match(source, /data-watch-fixture=/);
  assert.match(source, /👁 Следить/);
  assert.match(source, /👁 Слежу/);
  assert.match(source, /toggleMatchWatch\(match\)/);
});

test('watched matches receive explicit Radar Feed priority', () => {
  const source = block('function radarFeedItems', 'function renderRadarFeed');
  assert.match(source, /const watched = isWatchedMatch\(fixtureId\)/);
  assert.match(source, /LIVE · ВЫ СЛЕДИТЕ/);
  assert.match(source, /СЛЕЖУ ЗА МАТЧЕМ/);
  assert.match(source, /tone: 'watching'/);
});

test('watchlist controls stay compact on the public mobile shell', () => {
  assert.match(shell, /\.miniapp-public-shell \.match-watch-btn\.compact/);
  assert.match(shell, /\.match-secondary-actions[\s\S]*flex-wrap:wrap/);
  assert.match(shell, /\.radar-feed-item\.watching \.radar-feed-pulse/);
});

test('match watchlist ships with coherent launch16 cache revision', () => {
  for (const surface of [html, adminHtml]) {
    assert.match(surface, /frontend-asset-revision" content="6\.120\.0-launch16"/);
    assert.match(surface, /\/app\.js\?v=6\.120\.0-launch16/);
  }
});
