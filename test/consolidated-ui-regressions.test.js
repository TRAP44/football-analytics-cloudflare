import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const css = fs.readFileSync('public/styles/premium-ui.css', 'utf8');
const core = fs.readFileSync('public/modules/client-core.js', 'utf8');
const publicEntry = fs.readFileSync('public/app-public.js', 'utf8');

test('standard MatchRadar action buttons center their contents', () => {
  assert.match(css, /\.primary-btn,[\s\S]*\.filter-btn\{[\s\S]*align-items:center!important[\s\S]*justify-content:center!important[\s\S]*text-align:center!important/);
  assert.match(css, /center-hero-actions:not\(\.has-admin-audit\):has\(> button:only-child\)[\s\S]*grid-template-columns:minmax\(0,1fr\)!important/);
});

test('compact favorite controls use a common SVG geometry', () => {
  assert.match(app, /function favoriteStarSvg\(active = false\)/);
  assert.match(app, /class="fav-star-icon"/);
  assert.doesNotMatch(app, /\? '★' : '☆'/);
  assert.match(css, /\.fav-star-icon\{[\s\S]*width:19px[\s\S]*height:19px/);
});

test('public match center does not render stale snapshot warning cards or visible refresh seconds', () => {
  const centerStart = app.indexOf('function renderMatchCenter');
  const centerEnd = app.indexOf('async function openMatchCenter', centerStart);
  const center = app.slice(centerStart, centerEnd);
  assert.doesNotMatch(center, /Показан последний сохранённый снимок/);
  assert.doesNotMatch(center, /Автообновление через \$\{/);
  assert.match(center, /Обновляется автоматически/);
});

test('Radar Feed cache bust prevents old class=ai markup from surviving a release', () => {
  assert.match(publicEntry, /import '\.\/app\.js\?v=6\.120\.0-launch32';/);
  assert.match(css, /\.radar-feed-item\.ai,/);
  assert.match(css, /\.radar-feed-item\.tone-ai/);
});

test('time rendering is explicit 24-hour h23 and match time is plain text, not a pill', () => {
  assert.match(core, /hourCycle: 'h23'/);
  assert.match(css, /\.match-time-label\{[\s\S]*border:0!important[\s\S]*background:transparent!important/);
});
