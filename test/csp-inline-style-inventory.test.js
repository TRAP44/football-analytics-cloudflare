import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const publicHtml = fs.readFileSync('public/index.html', 'utf8');
const adminHtml = fs.readFileSync('public/admin.html', 'utf8');
const headers = fs.readFileSync('public/_headers', 'utf8');

test('public/admin HTML do not introduce inline style attributes', () => {
  assert.doesNotMatch(publicHtml, /\sstyle=/i);
  assert.doesNotMatch(adminHtml, /\sstyle=/i);
});

test('runtime inline-style blocker inventory remains bounded and explicit', () => {
  const styleAttributes = app.match(/style="/g) || [];
  const cssomWrites = app.match(/\.style\.[A-Za-z0-9_]+/g) || [];

  assert.equal(styleAttributes.length, 1);
  assert.equal(cssomWrites.length, 0);

  for (const expected of [
    'style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%"',
  ]) {
    assert.ok(app.includes(expected), `missing documented CSP blocker: ${expected}`);
  }

  assert.doesNotMatch(app, /\.style\.[A-Za-z0-9_]+/);
  assert.match(app, /function applyPercentWidthClass\(element, value\)/);
});



test('percentage-based visuals use CSP-safe utility classes', () => {
  assert.match(app, /function percentWidthClass\(value\)/);
  assert.doesNotMatch(app, /style="width:/);
  const css = fs.readFileSync('public/styles.css', 'utf8');
  assert.match(css, /\.pct-0\{width:0%\}/);
  assert.match(css, /\.pct-50\{width:50%\}/);
  assert.match(css, /\.pct-100\{width:100%\}/);
});

test('CSP remains explicitly transitional until blocker inventory reaches zero', () => {
  assert.match(headers, /style-src 'self' 'unsafe-inline'/);
});
