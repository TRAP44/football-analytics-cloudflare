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

test('cached pre-match goal scenarios are rewritten in words, betting-only cards are hidden', () => {
  const block = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));
  const regex = block('const SCENARIO_BETTING_TEXT', '\n');
  const fns = block('function prematchScenarioText(', '\nfunction prematchSourceRow');
  const escapeHtml = value => String(value ?? '');
  const card = new Function('escapeHtml', 'publicText', `${regex}\n${fns}\nreturn prematchScenarioCard;`)(escapeHtml, value => value);
  const goals = card({
    title: 'Голевой сценарий: более открытая игра',
    text: 'Модель Пуассона даёт 3.1 ожидаемых гола суммарно и 64% на ТБ 2.5. Это вспомогательная модель.',
  });
  assert.match(goals, /64% на 3\+ гола в матче/);
  assert.doesNotMatch(goals, /ТБ/);
  const btts = card({
    title: 'Обе команды способны забить',
    text: 'Эвристическая вероятность «обе забьют» — 66%. Это не букмекерская рекомендация, а производная от недавних голов команд.',
  });
  assert.match(btts, /вероятность, что забьют обе команды, — 66%\. Это производная/);
  assert.doesNotMatch(btts, /букмекер|обе забьют/);
  const close = card({
    title: 'Базовый сценарий: равная игра',
    text: 'Разрыв между двумя наиболее вероятными исходами — всего 3 п.п. Небольшой игровой эпизод, состав или изменение рынка может перевернуть порядок вероятностей.',
  });
  assert.match(close, /состав или новые данные могут перевернуть/);
  assert.doesNotMatch(close, /рынка/);
  assert.equal(card({ title: 'Ставка дня', text: 'П1 по коэффициенту 1.85' }), '');
});
