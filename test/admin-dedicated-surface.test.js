import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FRONTEND_ASSET_REVISION } from '../public/modules/app-runtime.js';

function readPublicFile(relativePath) {
  return readFileSync(new URL('../public/' + relativePath, import.meta.url), 'utf8');
}

function metaContent(html, name) {
  const pattern = new RegExp('<meta\\s+name="' + name + '"\\s+content="([^"]+)"');
  return html.match(pattern)?.[1] || '';
}

function assetRevision(html, assetPath) {
  const marker = `${assetPath}?v=`;
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return '';
  const value = html.slice(markerIndex + marker.length);
  const endIndex = value.search(/["\\s>]/);
  return endIndex < 0 ? value : value.slice(0, endIndex);
}

const publicHtml = readPublicFile('index.html');
const adminHtml = readPublicFile('admin.html');
const app = readPublicFile('app.js');

test('public and admin surfaces declare distinct identities and DOM boundaries', () => {
  assert.equal(metaContent(publicHtml, 'matchradar-surface'), 'public');
  assert.equal(metaContent(adminHtml, 'matchradar-surface'), 'admin');

  assert.doesNotMatch(publicHtml, /admin-dedicated-surface/);
  assert.doesNotMatch(publicHtml, /data-admin-only/);
  assert.match(adminHtml, /<body\b[^>]*\badmin-dedicated-surface\b/);
  assert.match(adminHtml, /data-admin-only/);
  assert.match(adminHtml, /<title>MatchRadar Admin · Состояние и управление<\/title>/);
});

test('dedicated admin surface is role-gated after startup and redirects non-admin users', () => {
  assert.match(
    app,
    /await runStartupSequence\(\);[\s\S]*?meta\[name="matchradar-surface"\][\s\S]*?=== 'admin'[\s\S]*?if \(isAdmin\(\)\)[\s\S]*?openProfileView\(\)[\s\S]*?admin-surface-ready[\s\S]*?location\.replace\('\/'\)/,
  );
});

test('both surfaces use the shared frontend asset revision source of truth', () => {
  assert.ok(FRONTEND_ASSET_REVISION, 'frontend asset revision must be defined');

  for (const [name, html] of [['public', publicHtml], ['admin', adminHtml]]) {
    assert.equal(
      metaContent(html, 'frontend-asset-revision'),
      FRONTEND_ASSET_REVISION,
      name + ' surface meta revision must match app-runtime.js',
    );
    assert.equal(
      assetRevision(html, '/styles.css'),
      FRONTEND_ASSET_REVISION,
      name + ' styles.css revision must match app-runtime.js',
    );
    assert.equal(
      assetRevision(html, '/styles/public-shell.css'),
      FRONTEND_ASSET_REVISION,
      name + ' public-shell.css revision must match app-runtime.js',
    );
    assert.equal(
      assetRevision(html, '/app.js'),
      FRONTEND_ASSET_REVISION,
      name + ' app.js revision must match app-runtime.js',
    );
  }
});
