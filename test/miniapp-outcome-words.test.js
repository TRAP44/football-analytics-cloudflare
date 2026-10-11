import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Mini App называет исходы словами (команда / ничья), а не ставочными метками.
const app = fs.readFileSync('public/app.js', 'utf8');
const timeline = fs.readFileSync('public/modules/ai-timeline.js', 'utf8');

test('outcome fallbacks use words instead of П1 / П2', () => {
  for (const [name, source] of [['app.js', app], ['ai-timeline.js', timeline]]) {
    assert.doesNotMatch(source, /\|\|\s*'П[12]'/, name);
  }
  assert.match(timeline, /Вероятности исходов/);
  assert.doesNotMatch(timeline, /Вероятности П1/);
});

test('team form card names the goals metric without betting label', () => {
  assert.doesNotMatch(app, /<small>ТБ 2\.5<\/small>/);
  assert.match(app, /<small>3\+ гола<\/small>/);
});

test('prematch scenario and source table derive names from the outcome key, not stored П1/П2 labels', () => {
  assert.match(app, /\['home','draw','away'\]\.includes\(row\.leaderKey\) \? prematchOutcomeName\(row\.leaderKey, match\)/);
  assert.match(app, /\['home','draw','away'\]\.includes\(leader\.key\) \? prematchOutcomeName\(leader\.key, match\)/);
  const start = app.indexOf('function prematchOutcomeName(');
  const fn = new Function(`${app.slice(start, app.indexOf('\n}\n', start) + 2)}\nreturn prematchOutcomeName;`)();
  assert.equal(fn('home', { home: {}, away: {} }), 'Хозяева');
  assert.equal(fn('away', { home: {}, away: { name: 'Рома' } }), 'Рома');
  assert.equal(fn('draw', {}), 'Ничья');
});
