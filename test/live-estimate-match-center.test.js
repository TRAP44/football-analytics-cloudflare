import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inPlayEstimateHtml, latestInPlayEstimate } from '../public/modules/match-center-view.js';

const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const point = (capturedAt, probabilities, extra = {}) => ({ capturedAt, minute: 30, probabilities, provenance: { source: 'in_play_model', score: { home: 1, away: 0 } }, ...extra });

test('the newest saved in-play point is shown, nothing else is computed', () => {
  const timeline = { points: [
    point('2026-10-12T18:10:00Z', { home: 60, draw: 25, away: 15 }),
    point('2026-10-12T18:40:00Z', { home: 76.6, draw: 17.3, away: 6.1 }, { minute: 61 }),
    { capturedAt: '2026-10-12T18:50:00Z', minute: 70, probabilities: { home: 40, draw: 30, away: 30 }, provenance: {} },
  ] };
  assert.deepEqual(latestInPlayEstimate(timeline), { home: 76.6, draw: 17.3, away: 6.1, minute: 61, score: '1:0' });
  const html = inPlayEstimateHtml(latestInPlayEstimate(timeline), { home: { name: 'Милан <b>' }, away: { name: 'Рома' } }, esc);
  assert.match(html, /Сейчас по ходу матча/);
  assert.match(html, /61′, счёт 1:0/);
  assert.match(html, /<strong>77%<\/strong>/); // целые проценты (UX-ревью 15.10)
  assert.match(html, /Милан &lt;b&gt;/);
  assert.match(html, /что именно учитывается — в подписи к кривой ниже/);
});

test('no in-play points or broken values — no card', () => {
  assert.equal(latestInPlayEstimate({ points: [] }), null);
  assert.equal(latestInPlayEstimate({ points: [point('2026-10-12T18:10:00Z', { home: 60, draw: 25, away: 5 })] }), null);
  assert.equal(inPlayEstimateHtml(null, {}, esc), '');
});

test('the card is rendered only for live matches; the full analysis says its numbers are pre-match', () => {
  const view = fs.readFileSync('public/modules/match-center-view.js', 'utf8');
  assert.match(view, /\$\{live && IN_PLAY_STATUSES\.has\(String\(m\.status \|\| ''\)\.toUpperCase\(\)\) \? inPlayEstimateHtml/);
  assert.match(view, /const IN_PLAY_STATUSES = new Set\(\['1H', 'HT', '2H'\]\);/);
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(app, /Оценка по данным до матча — счёт её не меняет/);
  // Разбор — снимок до матча: «идёт ли матч» берётся из текущей ленты (ревью Codex #853).
  assert.match(app, /function analysisMatchIsLive\(m = \{\}\) \{[\s\S]*?state\.matches\.some\(item => Number\(item\?\.fixtureId\) === id && item\?\.live === true\)/);
});
