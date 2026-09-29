import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function sourceBetween(startNeedle, endNeedle) {
  const start = app.indexOf(startNeedle);
  const end = app.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing ${startNeedle}`);
  assert.ok(end > start, `missing boundary ${endNeedle}`);
  return app.slice(start, end);
}

test('Match Radar change narrative is driven only by existing match-center signals', () => {
  const source = sourceBetween('function matchChangeNarrativeHtml', 'function smartInsightsHeroHtml');
  assert.match(source, /d\.events/);
  assert.match(source, /d\.livePressure/);
  assert.match(source, /d\.oddsMovement\?\.probabilityChange/);
  assert.match(source, /d\.absences/);
  assert.match(source, /if \(!items\.length\) return ''/);
});

test('change narrative highlights real changes without inventing a standalone probability model', () => {
  const source = sourceBetween('function matchChangeNarrativeHtml', 'function smartInsightsHeroHtml');
  assert.match(source, /Сдвиг расчётной рыночной вероятности/);
  assert.match(source, /Math\.abs\(strongest\.value\) >= 0\.5/);
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /homeProbability|drawProbability|awayProbability/);
});

test('What changed appears before AI and detailed Match Center data', () => {
  const source = sourceBetween('function renderMatchCenter(d)', 'async function openMatchCenter');
  const changes = source.indexOf('matchChangeNarrativeHtml(d, m)');
  const liveAi = source.indexOf('liveAiCoachHtml(d.liveAiCoach, m)');
  const details = source.indexOf('Статистика, составы и хронология');
  assert.ok(changes >= 0);
  assert.ok(liveAi > changes);
  assert.ok(details > liveAi);
});

test('Match Intelligence launch10 assets are wired', () => {
  assert.match(styles, /Match Intelligence — launch10/);
  assert.match(styles, /\.match-change-panel\s*\{/);
  assert.match(styles, /\.match-change-item\s*\{/);
  assert.match(index, /frontend-asset-revision" content="6\.120\.0-launch11"/);
  assert.doesNotMatch(index, /6\.120\.0-launch9/);
});
