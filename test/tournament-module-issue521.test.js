import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTournamentModule } from '../public/modules/tournament.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('tournament module exposes the extracted frontend contract',()=>{
  assert.equal(typeof createTournamentModule,'function');
  const module=createTournamentModule({});
  for(const name of [
    'currentTournamentMatches',
    'tournamentKey',
    'openTournament',
    'renderTournamentHero',
    'renderTournamentMatches',
    'standingFormHtml',
    'renderTournamentStandings',
    'loadTournamentStandings',
    'setTournamentTab',
  ]) {
    assert.equal(typeof module[name],'function', name);
  }
});

test('public app composes tournament module instead of keeping implementation inline',()=>{
  assert.match(app,/import \{ createTournamentModule \} from '\.\/modules\/tournament\.js'/);
  assert.match(app,/createTournamentModule\(\{/);
  assert.doesNotMatch(app,/function currentTournamentMatches\(leagueId = state\.currentTournament\?\.leagueId\) \{/);
  assert.doesNotMatch(app,/async function loadTournamentStandings\(force = false\) \{/);
  assert.doesNotMatch(app,/function setTournamentTab\(tab, load = true\) \{/);
});
