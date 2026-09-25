import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('RC56 discovers team fixtures in one shared backend path',()=> {
  assert.match(worker,/async function loadSearchTeamMatches\(/);
  assert.match(worker,/search:team-fixtures:/);
  assert.match(worker,/await loadSearchTeamMatches\(cached\.teams\[0\], cfg\)/);
  assert.match(worker,/await loadSearchTeamMatches\(teams\[0\], cfg\)/);
  assert.match(worker,/const discovery=await loadSearchTeamMatches\(team,cfg,\{secondQuery:parts\.second\}\)/);
  assert.doesNotMatch(worker,/bot:team-matches:/);
});

test('discovery uses date windows and recent-match recovery without next parameter',()=> {
  assert.match(worker,/TEAM_DISCOVERY_PAST_DAYS = 30/);
  assert.match(worker,/TEAM_DISCOVERY_FUTURE_DAYS = 120/);
  assert.match(worker,/apiFootball\('\/fixtures',\{team:teamId,from,to\},cfg\)/);
  assert.doesNotMatch(worker,/\{\s*team:teamId\s*,\s*next:/);
  assert.match(worker,/mode:upcoming\.length \? 'upcoming' : recent\.length \? 'recent' : 'empty'/);
  assert.match(worker,/matches:\[\.\.\.split\.upcoming,\.\.\.split\.recent\]/);
});

test('Mini App no longer performs an automatic second team-hub fetch',()=> {
  assert.match(app,/state\.globalSearch\.matchDiscovery = data\.matchDiscovery \|\| null/);
  assert.doesNotMatch(app,/const hub = await api\(`\/api\/team\?teamId=/);
  assert.match(app,/data-search-team=/);
  assert.match(app,/Открыть →/);
  assert.match(css,/\.search-team-summary/);
});

test('zero-result UX stays simple while backend preserves recent-match recovery',()=> {
  assert.match(app,/Матчей сейчас нет/);
  assert.match(app,/Матч найден/);
  assert.match(app,/Источник отвечает слишком долго/);
  assert.match(worker,/recovery=matches\.some\(match=>!match\.finished\)\?'upcoming':'recent'/);
  assert.match(worker,/recoveredRecent:searchRecoveredRecent/);
});

test('RC56 health and playbook describe the release gate',()=> {
  for (const flag of ['zeroResultRecovery','teamFixtureDiscovery','sharedFixtureDiscoveryCache','extendedTeamCalendar','recentMatchFallback']) {
    assert.ok(worker.includes(`${flag}: 'enabled'`), `missing ${flag}`);
  }
});