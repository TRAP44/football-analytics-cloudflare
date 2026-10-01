import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/styles/premium-ui.css', 'utf8');

test('premium UI layer is loaded after public shell', () => {
  const shell = html.indexOf('/styles/public-shell.css');
  const premium = html.indexOf('/styles/premium-ui.css');
  assert.ok(shell >= 0 && premium > shell);
  assert.match(html, /frontend-asset-revision" content="6\.120\.0-launch30"/);
  assert.match(html, /premium-ui\.css\?v=6\.120\.0-launch30/);
});

test('premium UI covers core public surfaces without changing product contracts', () => {
  for (const selector of [
    '.topbar',
    '.home-search-block',
    '.match-card',
    '.bottom-nav',
    '.match-experience-hero',
    '.center-hero',
    '.history-item',
    '.profile-panel',
    '.billing-panel',
    '.pass-card',
    '.digest-settings-panel',
    '.smart-notifications-panel',
    '[data-admin-only]',
  ]) assert.ok(css.includes(selector), selector);
});

test('premium UI explicitly supports Telegram mobile widths and reduced motion', () => {
  for (const width of [430, 390, 360, 320]) {
    assert.ok(css.includes('@media (max-width: ' + width + 'px)'), String(width));
  }
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test('premium UI preserves theme modes and keeps admin visually separated', () => {
  assert.match(css, /data-theme="dark"/);
  assert.match(css, /data-theme="ocean"/);
  assert.match(css, /data-theme="light"/);
  assert.match(css, /content: "ADMIN"/);
});
