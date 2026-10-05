import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const styles = fs.readFileSync('public/styles.css', 'utf8');
const optionalTabModules = [
  'public/modules/tournament.js',
  'public/modules/team-hub.js',
  'public/modules/match-center-render.js',
  'public/modules/analysis-presentation.js',
].filter(path => fs.existsSync(path)).map(path => fs.readFileSync(path, 'utf8'));
const tabSources = [app, ...optionalTabModules].join('\n');

test('custom tab groups expose tab semantics and roving tabindex state', () => {
  for (const setter of ['setTournamentTab', 'setTeamTab', 'setMatchCenterTab', 'setAnalysisTab']) {
    assert.match(tabSources, new RegExp(`function ${setter}\\(`), `${setter} missing`);
  }

  assert.match(tabSources, /setAttribute\('role', 'tab'\)/);
  assert.match(tabSources, /setAttribute\('aria-controls'/);
  assert.match(tabSources, /setAttribute\('aria-selected'/);
  assert.match(tabSources, /btn\.tabIndex = active \? 0 : -1/);
  assert.match(tabSources, /setAttribute\('role', 'tabpanel'\)/);
  assert.match(tabSources, /setAttribute\('aria-labelledby'/);
  assert.match(tabSources, /setAttribute\('aria-hidden'/);
});

test('all custom tab controls have visible keyboard focus styles', () => {
  for (const selector of [
    '.analysis-tab-btn:focus-visible',
    '.center-tab-btn:focus-visible',
    '.tournament-tab:focus-visible',
    '.team-tab:focus-visible',
  ]) {
    assert.ok(styles.includes(selector), `missing visible focus selector: ${selector}`);
  }

  const focusBlockStart = styles.indexOf('.analysis-tab-btn:focus-visible');
  const focusBlock = styles.slice(focusBlockStart, focusBlockStart + 500);
  assert.match(focusBlock, /outline:\s*2px solid var\(--accent\)/);
  assert.match(focusBlock, /outline-offset:\s*2px/);
});
