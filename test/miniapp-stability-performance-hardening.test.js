import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');

function block(start, end) {
  const a = app.indexOf(start);
  const b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0, start);
  assert.ok(b > a, end);
  return app.slice(a, b);
}

test('LIVE refresh sleeps for the provider interval instead of waking every second', () => {
  const live = block('function updateLiveCountdown', 'function signedPp');
  assert.doesNotMatch(live, /setInterval\s*\(/);
  assert.match(live, /setTimeout\(async \(\) =>/);
  assert.match(live, /delaySeconds \* 1000/);
  assert.match(live, /Math\.max\(15, Number\(state\.currentCenter\?\.refreshSeconds \|\| 60\)\)/);
});

test('LIVE response cannot overwrite state after the user leaves the active live fixture', () => {
  const live = block('function isActiveLiveFixture', 'function signedPp');
  assert.match(live, /activeViewId\(\) === 'analysisView'/);
  assert.match(live, /Number\(state\.currentCenter\?\.match\?\.fixtureId \|\| 0\) === Number\(fixtureId\)/);
  assert.match(live, /if \(!data \|\| !isActiveLiveFixture\(fixtureId\)\) return/);
  assert.match(live, /finally \{[\s\S]*isActiveLiveFixture\(fixtureId\)[\s\S]*scheduleLiveRefresh\(fixtureId\)/);
});

test('public error copy does not expose retry-after timing or raw backend messages', () => {
  const errors = block('function friendlyErrorMessage', 'function normalizeApiError');
  assert.match(errors, /if \(category === 'rate_limit'\) return 'Обновления временно на паузе/);
  assert.doesNotMatch(errors, /retryAfter/);
  assert.doesNotMatch(errors, /error\?\.message/);
  assert.doesNotMatch(errors, /payload\?\.error/);

  const banner = block('function updateConnectionBanner', 'function noteClientError');
  assert.match(banner, /Обновления временно на паузе/);
  assert.doesNotMatch(banner, /~\$\{cooldown\} сек/);
});

test('LIVE timer cleanup uses the same timeout primitive used for scheduling', () => {
  const stop = block('function stopLiveRefresh', 'function viewBackTarget');
  assert.match(stop, /clearTimeout\(state\.liveRefreshTimer\)/);
  assert.doesNotMatch(stop, /clearInterval/);
});
