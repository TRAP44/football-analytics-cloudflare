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
