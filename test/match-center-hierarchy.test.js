import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function matchCenterRendererSource() {
  const start = app.indexOf('function renderMatchCenter(d) {');
  const end = app.indexOf('\nasync function openMatchCenter', start);
  assert.ok(start >= 0, 'renderMatchCenter must exist');
  assert.ok(end > start, 'renderMatchCenter boundary must remain detectable');
  return app.slice(start, end);
}

test('Match Center keeps primary match story above progressive details', () => {
  const source = matchCenterRendererSource();
  const primary = source.indexOf('class="match-center-primary"');
  const details = source.indexOf('class="match-center-more"');
  assert.ok(primary > 0, 'primary Match Center stack should exist');
  assert.ok(details > primary, 'progressive details must remain below primary content');
  assert.ok(source.includes('ГЛАВНОЕ'));
  assert.ok(source.includes('Ключевые показатели'));
  assert.ok(source.includes('Последние события'));
  assert.ok(source.includes('Статистика, составы и хронология'));
});

test('Match Center does not duplicate key metrics inside the detail summary tab', () => {
  const source = matchCenterRendererSource();
  assert.equal((source.match(/Ключевые показатели/g) || []).length, 1);
  assert.match(source, /data-center-tab="summary"[^>]*>Данные<\/button>/);
});

test('Match Center launch9 styles and asset revision are wired', () => {
  assert.match(styles, /Match Center hierarchy — launch9/);
  assert.match(styles, /\.match-center-primary\s*\{/);
  assert.match(styles, /\.match-center-more\s*\{/);
  assert.match(index, /frontend-asset-revision" content="6\.120\.0-launch16"/);
  assert.doesNotMatch(index, /6\.120\.0-launch8/);
});
