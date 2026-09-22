import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');

test('full analysis is globally single-flight on the client to protect user quota', () => {
  assert.match(app, /analysisActionPending:\s*false/);
  assert.match(app, /if \(state\.analysisActionPending\)/);
  assert.match(app, /state\.analysisActionPending = true/);
  assert.match(app, /state\.analysisActionPending = false/);
  assert.match(app, /syncAnalysisBusyUi\(\)/);
});

test('match-center responses cannot overwrite a newer user selection', () => {
  assert.match(app, /matchCenterRequestSeq:\s*0/);
  assert.match(app, /async function requestMatchCenter/);
  assert.match(app, /const seq = \+\+state\.matchCenterRequestSeq/);
  assert.match(app, /return seq === state\.matchCenterRequestSeq \? data : null/);
  assert.doesNotMatch(app, /await api\(\x60\/api\/match-center\?fixtureId=/);
});

test('favorite and reminder mutations are deduplicated per entity', () => {
  assert.match(app, /favoriteMutations:\s*new Set\(\)/);
  assert.match(app, /reminderMutations:\s*new Set\(\)/);
  assert.match(app, /state\.favoriteMutations\.has\(teamId\)/);
  assert.match(app, /state\.reminderMutations\.has\(fixtureId\)/);
  assert.match(app, /state\.favoriteMutations\.delete\(teamId\)/);
  assert.match(app, /state\.reminderMutations\.delete\(fixtureId\)/);
});

test('transient profile refresh failure keeps the authenticated profile visible', () => {
  const block = app.match(/async function loadProfile\(\)[\s\S]*?\n}\n\nfunction isAdmin/);
  assert.ok(block, 'loadProfile must exist');
  assert.match(block[0], /const previousProfile = state\.profile/);
  assert.match(block[0], /if \(previousProfile && !authFailure\)/);
  assert.match(block[0], /state\.profile = previousProfile/);
  assert.match(block[0], /state\.profileStale = true/);
});

test('team standing action opens the actual competition table instead of a hardcoded tournament', () => {
  assert.match(app, /id="teamStandingTableBtn"/);
  assert.match(app, /openTournamentFromTeam\(true\)/);
  assert.match(app, /if \(openTable\) setTournamentTab\('table', true\)/);
  assert.doesNotMatch(app, /data-open-tournament="1"/);
});

test('RC26 health advertises interaction-safety contracts', () => {
  assert.match(worker, /interactionSafety:\s*'enabled'/);
  assert.match(worker, /actionDeduplication:\s*'enabled'/);
  assert.match(worker, /staleResponseGuard:\s*'enabled'/);
  assert.match(worker, /profileFailSoft:\s*'enabled'/);
});
