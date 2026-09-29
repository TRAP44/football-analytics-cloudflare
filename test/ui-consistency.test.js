import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const adminHtml = fs.readFileSync('public/admin.html', 'utf8');

test('profile uses Telegram photo safely and keeps a fallback avatar', () => {
  assert.match(app, /const photoUrl = safeUrl\(user\.photoUrl\)/);
  assert.match(app, /avatar\.textContent = '⚽'/);
  assert.match(app, /avatar\.replaceChildren\(img\)/);
  assert.match(css, /\.avatar img\s*\{/);
});

test('admin-only UI has a redundant fail-closed visibility boundary', () => {
  assert.match(app, /el\.toggleAttribute\(['"]inert['"],\s*!admin\)/);
  assert.match(css, /\[data-admin-only\]\[aria-hidden="true"\]/);
  assert.match(adminHtml, /id="adminRoleBadge"[^>]*data-admin-only[^>]*hidden[^>]*aria-hidden="true"/);
});

test('major admin interface labels are localized', () => {
  const forbidden = [
    'Brier score',
    'Log loss',
    'прогноз vs факт',
    'CHALLENGER HELD',
    'CHALLENGER SHADOW',
    'НУЖНА MIGRATION',
    'Active fingerprint',
    "baseline: 'Baseline'",
    "defaults: 'Safe defaults'",
    '<span>Warnings</span>',
    '<span>Ops budget</span>',
    '📱 Client telemetry',
    '<span>Pre-match 24ч</span>',
    '<span>Kickoff 24ч</span>',
    "revision.textContent = 'schema missing'",
  ];
  for (const phrase of forbidden) assert.equal(app.includes(phrase), false, phrase);
  assert.equal(html.includes('atomic CAS + audit'), false);
});
