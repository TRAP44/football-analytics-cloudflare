import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FRONTEND_ASSET_REVISION } from '../public/modules/app-runtime.js';

const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const premium = fs.readFileSync('public/styles/premium-ui.css', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');

test('public head has no literal escaped newline and bumps public asset revision', () => {
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  assert.doesNotMatch(head, /\\n/);
  assert.ok(html.includes(`frontend-asset-revision" content="${FRONTEND_ASSET_REVISION}"`));
  assert.ok(html.includes(`premium-ui.css?v=${FRONTEND_ASSET_REVISION}`));
  assert.ok(html.includes(`app.js?v=${FRONTEND_ASSET_REVISION}`));
});

test('Radar Feed uses a namespaced tone and a non-collapsing flex row', () => {
  assert.match(app, /radar-feed-item tone-\$\{escapeHtml\(item\.tone/);
  assert.doesNotMatch(app, /radar-feed-item \$\{escapeHtml\(item\.tone/);
  assert.match(premium, /\.radar-feed-item \{[\s\S]*display:\s*flex;/);
  assert.match(premium, /\.radar-feed-item \.radar-feed-copy \{[\s\S]*flex:\s*1 1 auto/);
  assert.match(premium, /\.radar-feed-item\.tone-ai \.radar-feed-pulse/);
});

test('bottom navigation is explicitly centered and each nav action centers its contents', () => {
  assert.match(premium, /\.bottom-nav \{[\s\S]*left:\s*50%;[\s\S]*transform:\s*translateX\(-50%\);/);
  assert.match(premium, /\.bottom-nav \.nav-item \{[\s\S]*align-items:\s*center[\s\S]*justify-content:\s*center[\s\S]*text-align:\s*center/);
});

test('advanced filters stay compact until the user opens them', () => {
  assert.match(html, /<summary><span>⚙ Фильтры<\/span><b data-filter-summary-value hidden><\/b><\/summary>/);
  assert.match(app, /summaryValue\.hidden = !activeDrawerFilter/);
  assert.match(premium, /\.home-filter-controls \.league-filter-drawer \{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;/);
  assert.match(premium, /\.league-filter-drawer > summary \{[\s\S]*width:\s*max-content/);
  assert.match(premium, /\.league-filter-drawer \.home-filter-body \{[\s\S]*margin-top:\s*8px/);
});


test('Profile no longer renders the duplicate active reminders panel', () => {
  assert.doesNotMatch(html, /id="remindersPanel"/);
  assert.doesNotMatch(html, /🔔 Активные напоминания/);
});

test('public date feed uses the shared exact-date provider loader and per-date cache', () => {
  assert.doesNotMatch(worker, /function publicFeedDateWindow\(date\)/);
  assert.doesNotMatch(worker, /\{from:feedWindow\.from,to:feedWindow\.to\}/);
  const start = worker.indexOf('async function apiMatches');
  const end = worker.indexOf('function normalizeStandingRow', start);
  const block = worker.slice(start, end);
  assert.equal((block.match(/apiFootball\(/g) || []).length, 0);
  assert.match(block, /loadProviderFixturesForDate\(date,cfg,\{forceRefresh:true\}\)/);
  assert.match(block, /providerFixtureDateCacheKey\(date\)/);
  assert.match(worker, /apiFootball\('\/fixtures',\{date:normalized\},cfg\)/);
});

test('match rate-limit UI no longer exposes a long countdown', () => {
  const start = app.indexOf('async function loadMatches');
  const end = app.indexOf('function syncFilterButtons', start);
  const block = app.slice(start, end);
  assert.match(block, /Источник матчей временно занят/);
  assert.doesNotMatch(block, /Повторите примерно через \$\{retry\} сек/);
});
