import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

function block(startNeedle, endNeedle) {
  const start = app.indexOf(startNeedle);
  const end = app.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing ${startNeedle}`);
  assert.ok(end > start, `missing boundary ${endNeedle}`);
  return app.slice(start, end);
}

test('Radar Feed is a zero-request personalization layer', () => {
  const source = block('function radarFeedItems', 'function renderRadarFeed');
  assert.match(source, /favoriteSet\(\)/);
  assert.match(source, /personalContextSignals\(\)/);
  assert.match(source, /reminderFor\(fixtureId\)/);
  assert.match(source, /analysisHistoryForFixture\(fixtureId\)/);
  assert.doesNotMatch(source, /\bapi\s*\(/);
  assert.doesNotMatch(source, /fetch\s*\(/);
});

test('Radar Feed prioritizes relevant live and prepared match context', () => {
  const source = block('function radarFeedItems', 'function renderRadarFeed');
  assert.match(source, /LIVE · ЛЮБИМАЯ КОМАНДА/);
  assert.match(source, /AI-РАЗБОР ГОТОВ/);
  assert.match(source, /НАПОМИНАНИЕ ВКЛЮЧЕНО/);
  assert.match(source, /СКОРО · ЛЮБИМАЯ КОМАНДА/);
  assert.match(source, /slice\(0, 4\)/);
});

test('Radar Feed renders on Home and opens existing match surfaces', () => {
  const source = block('function renderRadarFeed', 'function renderDailyOverview');
  assert.match(html, /id="radarFeedWrap"/);
  assert.match(html, /id="radarFeedList"/);
  assert.match(source, /openHistoryAnalysis\(fixtureId, button\)/);
  assert.match(source, /openMatchCenter\(fixtureId, button\)/);
  assert.match(app, /renderDailyOverview\(\);\s*renderRadarFeed\(\);/);
});

test('Radar Feed ships with coherent launch15 cache revision', () => {
  for (const surface of [html, adminHtml]) {
    assert.match(surface, /frontend-asset-revision" content="6\.120\.0-launch\d+"/);
    assert.match(surface, /\/app\.js\?v=6\.120\.0-launch\d+/);
  }
  assert.match(styles, /\/\* Radar Feed \*\//);
  assert.match(styles, /\.radar-feed-item\s*\{/);
});
