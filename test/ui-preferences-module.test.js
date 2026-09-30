import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('../public/modules/ui-preferences.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('interface preferences are extracted behind a dedicated controller', () => {
  assert.match(app, /createInterfacePreferencesController/);
  assert.match(app, /storage: localStorage/);
  assert.doesNotMatch(app, /function preferredAccentMode/);
  assert.doesNotMatch(app, /function applyAccentPreference/);
  assert.doesNotMatch(app, /function saveInterfacePreference/);
});

test('UI preferences module owns theme accent and button-style behavior', () => {
  assert.match(moduleSource, /UI_PREFERENCES_KEY/);
  assert.match(moduleSource, /DEFAULT_UI_PREFERENCES/);
  assert.match(moduleSource, /ACCENT_PALETTES/);
  assert.match(moduleSource, /data-theme-choice/);
  assert.match(moduleSource, /data-accent-choice/);
  assert.match(moduleSource, /data-button-style-choice/);
  assert.match(moduleSource, /setHeaderColor/);
  assert.match(moduleSource, /setBackgroundColor/);
});

test('frontend revision refreshes the extracted module graph', () => {
  assert.match(index, /frontend-asset-revision" content="6\.120\.0-launch20"/);
  assert.match(index, /\/app\.js\?v=6\.120\.0-launch20/);
  assert.doesNotMatch(index, /6\.120\.0-launch19/);
});
