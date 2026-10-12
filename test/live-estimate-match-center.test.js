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
  assert.match(html, /76\.6%/);
  assert.match(html, /Милан &lt;b&gt;/);
  assert.match(html, /Красные карточки и ход игры не учитываются/);
});

test('no in-play points or broken values — no card', () => {
  assert.equal(latestInPlayEstimate({ points: [] }), null);
  assert.equal(latestInPlayEstimate({ points: [point('2026-10-12T18:10:00Z', { home: 60, draw: 25, away: 5 })] }), null);
  assert.equal(inPlayEstimateHtml(null, {}, esc), '');
});

test('the card is rendered only for live matches; the full analysis says its numbers are pre-match', () => {
  const view = fs.readFileSync('public/modules/match-center-view.js', 'utf8');
  assert.match(view, /\$\{live \? inPlayEstimateHtml\(latestInPlayEstimate\(d\.aiTimeline \|\| \{\}\), m, escapeHtml\) : ''\}/);
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(app, /Оценка по данным до матча — счёт её не меняет/);
});
