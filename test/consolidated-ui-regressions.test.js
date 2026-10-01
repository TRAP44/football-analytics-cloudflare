import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FRONTEND_ASSET_REVISION } from '../public/modules/app-runtime.js';

const app = fs.readFileSync('public/app.js', 'utf8');
const css = fs.readFileSync('public/styles/premium-ui.css', 'utf8');
const core = fs.readFileSync('public/modules/client-core.js', 'utf8');
const publicEntry = fs.readFileSync('public/app-public.js', 'utf8');

test('standard MatchRadar action buttons share one centered 44px geometry contract', () => {
  assert.match(css, /--mr-touch-target:\s*44px/);
  assert.match(css, /\.miniapp-public-shell :is\([\s\S]*\.primary-btn,[\s\S]*\.filter-btn[\s\S]*\) \{[\s\S]*min-height:\s*var\(--mr-touch-target\)[\s\S]*align-items:\s*center[\s\S]*justify-content:\s*center[\s\S]*text-align:\s*center/);
  assert.match(css, /:has\(> button:only-child\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.doesNotMatch(css.slice(css.indexOf('/* Public component contracts — Issue #323')), /!important/);
});

test('compact favorite controls use a common SVG geometry', () => {
  assert.match(app, /function favoriteStarSvg\(active = false\)/);
  assert.match(app, /class="fav-star-icon"/);
  const favStart = app.indexOf('const favoriteButton = team =>');
  const favEnd = app.indexOf('\n\n  return `', favStart);
  assert.doesNotMatch(app.slice(favStart, favEnd), /\? '★' : '☆'/);
  assert.match(css, /\.fav-star-icon \{[\s\S]*width:\s*19px;[\s\S]*height:\s*19px/);
  assert.match(app, /analysis-favorite-star">\$\{favoriteStarSvg\(homeFavorite\)\}/);
  assert.match(app, /analysis-favorite-star">\$\{favoriteStarSvg\(awayFavorite\)\}/);
});

test('public match center does not render stale snapshot warning cards or visible refresh seconds', () => {
  const centerStart = app.indexOf('function renderMatchCenter');
  const centerEnd = app.indexOf('async function openMatchCenter', centerStart);
  const center = app.slice(centerStart, centerEnd);
  assert.doesNotMatch(center, /Показан последний сохранённый снимок/);
  assert.doesNotMatch(center, /Автообновление через \$\{/);
  assert.match(center, /Обновляется автоматически/);
});

test('Radar Feed uses namespaced tones without legacy .ai compatibility CSS', () => {
  assert.ok(publicEntry.includes(`import './app.js?v=${FRONTEND_ASSET_REVISION}';`));
  assert.doesNotMatch(css, /\.radar-feed-item\.ai(?:\W|$)/);
  assert.match(css, /\.radar-feed-item\.tone-ai \.radar-feed-pulse/);
});

test('time rendering is explicit 24-hour h23 and match time is plain text, not a pill', () => {
  assert.match(core, /hourCycle: 'h23'/);
  assert.match(css, /\.match-time-label \{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;/);
});
