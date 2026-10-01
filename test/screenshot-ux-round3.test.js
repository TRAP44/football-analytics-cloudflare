import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const entry = fs.readFileSync('public/app-public.js', 'utf8');
const premium = fs.readFileSync('public/styles/premium-ui.css', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');

test('public head has no literal escaped newline and bumps public asset revision', () => {
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  assert.doesNotMatch(head, /\\n/);
  assert.match(html, /frontend-asset-revision" content="6\.120\.0-launch31"/);
  assert.match(html, /premium-ui\.css\?v=6\.120\.0-launch31/);
  assert.match(html, /app-public\.js\?v=6\.120\.0-launch31/);
  assert.match(entry, /app\.js\?v=6\.120\.0-launch31/);
});

test('Radar Feed uses a namespaced tone and a non-collapsing flex row', () => {
  assert.match(app, /radar-feed-item tone-\$\{escapeHtml\(item\.tone/);
  assert.doesNotMatch(app, /radar-feed-item \$\{escapeHtml\(item\.tone/);
  assert.match(premium, /\.radar-feed-item\{[\s\S]*display:flex!important/);
  assert.match(premium, /\.radar-feed-item \.radar-feed-copy\{[\s\S]*flex:1 1 auto/);
  assert.match(premium, /\.radar-feed-item\.tone-ai \.radar-feed-pulse/);
});

test('bottom navigation is explicitly centered and each nav action centers its contents', () => {
  assert.match(premium, /\.bottom-nav\{[\s\S]*left:50%!important[\s\S]*transform:translateX\(-50%\)!important/);
  assert.match(premium, /\.bottom-nav \.nav-item\{[\s\S]*align-items:center[\s\S]*justify-content:center[\s\S]*text-align:center/);
});

test('advanced filters stay compact until the user opens them', () => {
  assert.match(html, /<summary><span>⚙ Фильтры<\/span><b data-filter-summary-value hidden><\/b><\/summary>/);
  assert.match(app, /summaryValue\.hidden = !activeDrawerFilter/);
  assert.match(premium, /\.league-filter-drawer > summary\{[\s\S]*width:max-content/);
  assert.match(premium, /\.league-filter-drawer \.home-filter-body\{[\s\S]*margin-top:8px/);
});

test('public date feed batches yesterday today and tomorrow into one provider request', () => {
  assert.match(worker, /function publicFeedDateWindow\(date\)/);
  assert.match(worker, /\{ from:feedWindow\.from, to:feedWindow\.to \}/);
  assert.match(worker, /grouped=new Map\(feedWindow\.days/);
  assert.match(worker, /providerFixtureDateCacheKey\(day\)/);
});

test('match rate-limit UI no longer exposes a long countdown', () => {
  const start = app.indexOf('async function loadMatches');
  const end = app.indexOf('function syncFilterButtons', start);
  const block = app.slice(start, end);
  assert.match(block, /Источник матчей временно занят/);
  assert.doesNotMatch(block, /Повторите примерно через \$\{retry\} сек/);
});
