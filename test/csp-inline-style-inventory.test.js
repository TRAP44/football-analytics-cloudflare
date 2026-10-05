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

  assert.equal(styleAttributes.length, 8);
  assert.equal(cssomWrites.length, 1);

  for (const expected of [
    'style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%"',
    'style="width:${hp}%"',
    'style="width:${ap}%"',
    'style="width:${h.toFixed(2)}%"',
    'style="width:${d.toFixed(2)}%"',
    'style="width:${a.toFixed(2)}%"',
    'style="width:${clampPercent(goal.over25)}%"',
    'style="width:${clampPercent(goal.btts)}%"',
  ]) {
    assert.ok(app.includes(expected), `missing documented CSP blocker: ${expected}`);
  }

  assert.ok(app.includes("style.width ="));
});

test('CSP remains explicitly transitional until blocker inventory reaches zero', () => {
  assert.match(headers, /style-src 'self' 'unsafe-inline'/);
});
