import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('public app is reduced to a thin composition shell',()=>{
  assert.ok(app.length < 120_000, `public/app.js should stay below 120k chars, got ${app.length}`);
});

test('consolidated frontend feature boundaries are composed lazily',()=>{
  for(const moduleName of [
    'team-hub',
    'player-hub',
    'tournament',
    'match-center-live-core',
    'match-center-render',
    'analysis-orchestration',
    'analysis-presentation',
    'discovery',
    'matches-home',
    'profile-core',
    'admin-bootstrap',
  ]) {
    assert.ok(app.includes(`from './modules/${moduleName}.js'`), moduleName);
  }

  assert.ok(app.includes('function __getTeamHubModule()'));
  assert.ok(app.includes('function __getAnalysisPresentationModule()'));
  assert.ok(app.includes('function __getAdminBootstrapModule()'));

  assert.ok(!app.includes('function renderAnalysis(d) {'));
  assert.ok(!app.includes('function renderMatchCenter(d) {'));
  assert.ok(!app.includes('async function loadMatches(options = {}) {'));
  assert.ok(!app.includes('function renderProfile() {'));
});
