import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDiscoveryModule } from '../public/modules/discovery.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('discovery module exposes extracted contract',()=>{
  assert.equal(typeof createDiscoveryModule,'function');
  const module=createDiscoveryModule({});
  for(const name of [
    'storageGet',
    'storageSet',
    'storageRemove',
    'getRecentTeams',
    'rememberTeam',
    'clearRecentTeams',
    'discoveryTeamCard',
    'searchTeamSummaryCard',
    'knownTeamSummaryCard',
    'searchCompetitionSummaryCard',
    'bindDiscoveryActions',
    'setDiscoveryHomeVisibility',
    'renderDiscoveryHome',
    'russianCountLabel',
    'searchMatchCard',
    'bindSearchMatchActions',
    'openTournamentMeta',
  ]) {
    assert.equal(typeof module[name],'function', name);
  }
});

test('public app composes discovery module instead of keeping it inline',()=>{
  assert.match(app,/import \{ createDiscoveryModule \} from '\.\/modules\/discovery\.js'/);
  assert.match(app,/createDiscoveryModule\(\{/);
  assert.doesNotMatch(app,/function storageGet\(key\) \{/);
  assert.doesNotMatch(app,/function renderDiscoveryHome\(\) \{/);
  assert.doesNotMatch(app,/function openTournamentMeta\(meta\) \{/);
});
