import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMatchesHomeModule } from '../public/modules/matches-home.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('matches home module exposes extracted contract',()=>{
  assert.equal(typeof createMatchesHomeModule,'function');
  const module=createMatchesHomeModule({});
  for(const name of [
    'matchSkeletonHtml',
    'matchSnapshotKey',
    'readMatchSnapshot',
    'writeMatchSnapshot',
    'applyMatchPayload',
    'loadMatches',
    'syncFilterButtons',
    'normalizedSignalText',
    'personalContextSignals',
    'personalMatchInsight',
    'homePersonalMatch',
    'homePersonalMatchMeta',
    'watchedMatch',
    'isWatchedMatch',
    'matchWatchlistSnapshot',
    'persistMatchWatchlist',
    'toggleMatchWatch',
    'radarFeedItems',
    'renderRadarFeed',
    'renderDailyOverview',
    'filteredMatches',
    'categoryLabel',
    'matchCenter',
    'renderPopularCompetitions',
    'favoriteStarSvg',
    'matchCardHtml',
    'bindMatchActions',
    'analysisHistoryForFixture',
    'renderAiCenterSummary',
    'renderAiFocus',
    'homeMatchSections',
    'homeMatchSectionsHtml',
    'renderMatches',
  ]) {
    assert.equal(typeof module[name],'function', name);
  }
});

test('public app composes matches home module instead of keeping it inline',()=>{
  assert.match(app,/import \{ createMatchesHomeModule \} from '\.\/modules\/matches-home\.js'/);
  assert.match(app,/createMatchesHomeModule\(\{/);
  assert.doesNotMatch(app,/function matchSkeletonHtml\(count = 4\) \{/);
  assert.doesNotMatch(app,/async function loadMatches\(options = \{\}\) \{/);
  assert.doesNotMatch(app,/function renderMatches\(\) \{/);
});
