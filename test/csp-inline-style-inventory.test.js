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

  assert.equal(styleAttributes.length, 0);
  assert.equal(cssomWrites.length, 0);

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

test('production CSP rejects inline styles', () => {
  assert.match(headers, /style-src 'self'/);
  assert.doesNotMatch(headers, /style-src[^\n]*'unsafe-inline'/);
  assert.doesNotMatch(app, /\sstyle="/i);
  assert.doesNotMatch(app, /\.style\.[A-Za-z0-9_]+/);
});

test('pitch positioning uses CSP-safe static utility classes', () => {
  assert.match(app, /xpos-\$\{Math\.round\(clampPercent\(x\)\)\}/);
  assert.match(app, /ypos-\$\{Math\.round\(clampPercent\(y\)\)\}/);
  const css = fs.readFileSync('public/styles.css', 'utf8');
  assert.match(css, /\.xpos-0\{left:0%\}/);
  assert.match(css, /\.xpos-100\{left:100%\}/);
  assert.match(css, /\.ypos-0\{top:0%\}/);
  assert.match(css, /\.ypos-100\{top:100%\}/);
});
