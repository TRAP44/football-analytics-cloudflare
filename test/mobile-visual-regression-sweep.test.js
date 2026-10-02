import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const smoke = fs.readFileSync('scripts/bottom-nav-render-smoke.js', 'utf8');

test('rendered mobile regression sweep covers the release viewport matrix', () => {
  assert.match(smoke, /const WIDTHS = \[320, 360, 375, 390, 430, 768, 1280\]/);
  for (const width of [320, 360, 375, 390, 430]) {
    assert.ok(smoke.includes(String(width)), `missing ${width}px rendered coverage`);
  }
  assert.match(smoke, /for \(const theme of \['dark','light','ocean'\]\)/);
});

test('rendered mobile regression sweep includes all critical public surfaces', () => {
  for (const surface of ['search','match-center','analysis','profile','billing','notifications','digest']) {
    assert.ok(smoke.includes(`data-qa-surface=\\\"${surface}\\\"`), surface);
  }
  for (const existingSurface of ['home-personal-match','my-team-card','history-item','compact-match-card','radar-feed-item']) {
    assert.ok(smoke.includes(existingSurface), existingSurface);
  }
});

test('rendered mobile regression sweep rejects overflow and undersized controls', () => {
  assert.match(smoke, /surface\.scrollWidth > surface\.clientWidth \+ 1/);
  assert.match(smoke, /surface\.rect\.left < -1 \|\| surface\.rect\.right > width \+ 1/);
  assert.match(smoke, /control\.height < 39\.5/);
  assert.match(smoke, /document has horizontal overflow/);
  assert.match(smoke, /navigation wrapped to more than one row/);
});
