import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTeamHubModule } from '../public/modules/team-hub.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('team hub module exposes the extracted frontend contract',()=>{
  assert.equal(typeof createTeamHubModule,'function');
  const module=createTeamHubModule({});
  for(const name of [
    'teamResultBadge',
    'teamMatchRow',
    'bindTeamFixtureActions',
    'teamPercent',
    'teamDecimal',
    'teamFormBadges',
    'seasonSplitCard',
    'teamPlayerSeasonStatsHtml',
    'renderTeamIntelligence',
    'loadTeamIntelligence',
    'playerCard',
    'renderTeamSquad',
    'loadTeamSquad',
    'renderTeamHub',
    'loadTeamHub',
    'openTeam',
    'setTeamTab',
    'openTournamentFromTeam',
  ]) {
    assert.equal(typeof module[name],'function', name);
  }
});

test('public app composes team hub instead of keeping the implementation inline',()=>{
  assert.match(app,/import \{ createTeamHubModule \} from '\.\/modules\/team-hub\.js'/);
  assert.match(app,/createTeamHubModule\(\{/);
  assert.doesNotMatch(app,/function teamResultBadge\(result\) \{/);
  assert.doesNotMatch(app,/async function loadTeamHub\(team, force=false\) \{/);
  assert.doesNotMatch(app,/function openTournamentFromTeam\(openTable = false\) \{/);
});
