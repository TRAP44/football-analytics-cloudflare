import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlayerHubModule } from '../public/modules/player-hub.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('player hub module exposes the extracted frontend contract',()=>{
  assert.equal(typeof createPlayerHubModule,'function');
  const module=createPlayerHubModule({});
  for(const name of [
    'playerPositionLabel',
    'playerHubMetric',
    'playerSquadProfile',
    'playerSquadProfileHtml',
    'loadPlayerSquadProfile',
    'playerSeasonStatProfile',
    'playerSeasonStatsHtml',
    'loadPlayerSeasonStats',
    'playerComparisonSquadSources',
    'enrichPlayerComparisonCandidate',
    'playerComparisonCandidatesFor',
    'hydrateComparisonPlayer',
    'bindPlayerComparisonActions',
    'renderPlayerHub',
    'openPlayerFromMatch',
  ]) {
    assert.equal(typeof module[name],'function', name);
  }
});

test('public app composes player hub instead of keeping implementation inline',()=>{
  assert.match(app,/import \{ createPlayerHubModule \} from '\.\/modules\/player-hub\.js'/);
  assert.match(app,/createPlayerHubModule\(\{/);
  assert.doesNotMatch(app,/function playerPositionLabel\(value = ''\) \{/);
  assert.doesNotMatch(app,/async function loadPlayerSeasonStats\(player = state\.currentPlayer\) \{/);
  assert.doesNotMatch(app,/function renderPlayerHub\(player = state\.currentPlayer\) \{/);
});
