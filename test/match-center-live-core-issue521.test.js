import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMatchCenterLiveCore } from '../public/modules/match-center-live-core.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('match center live core exposes extracted contract',()=>{
  assert.equal(typeof createMatchCenterLiveCore,'function');
  const module=createMatchCenterLiveCore({});
  for(const name of [
    'minuteLabel',
    'liveEventsHtml',
    'lineupPlayerName',
    'lineupPlayerNumber',
    'lineupPlayerGrid',
    'shortPlayerName',
    'lineupPitchHtml',
    'lineupQualityLabel',
    'lineupTeamHtml',
    'lineupLiveHtml',
    'requestMatchCenter',
    'startLiveRefresh',
    'signedPp',
    'oddsMovementHtml',
    'playerMetricText',
    'absenceKindLabel',
    'absenceStatusLabel',
    'liveAbsencesHtml',
    'centerStatNumber',
    'centerStatRow',
    'centerCompareRow',
    'centerKeyStatsHtml',
    'availabilityQualityHintHtml',
    'xgQualityHintHtml',
    'eventQualityHintHtml',
    'statisticsQualityHintHtml',
    'oddsQualityHintHtml',
    'centerAllStatsHtml',
    'timelineEventsHtml',
    'centerPlayersHtml',
  ]) {
    assert.equal(typeof module[name],'function', name);
  }
});

test('public app composes match center live core instead of keeping it inline',()=>{
  assert.match(app,/import \{ createMatchCenterLiveCore \} from '\.\/modules\/match-center-live-core\.js'/);
  assert.match(app,/createMatchCenterLiveCore\(\{/);
  assert.doesNotMatch(app,/function minuteLabel\(event\) \{/);
  assert.doesNotMatch(app,/async function requestMatchCenter\(fixtureId, extraParams = \{\}, options = \{\}\) \{/);
  assert.doesNotMatch(app,/function centerPlayersHtml\(leaders, match\) \{/);
});
