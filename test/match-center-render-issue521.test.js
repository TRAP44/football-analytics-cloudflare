import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMatchCenterRenderModule } from '../public/modules/match-center-render.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('match center render module exposes extracted contract',()=>{
  assert.equal(typeof createMatchCenterRenderModule,'function');
  const module=createMatchCenterRenderModule({});
  for(const name of [
    'freshnessSourceLabel',
    'freshnessAgeLabel',
    'centerFreshnessHtml',
    'centerCoverageHtml',
    'centerMarketHtml',
    'centerAbsenceSummary',
    'setMatchCenterTab',
    'bindMatchCenterTabs',
    'insightSideLabel',
    'smartInsightCardHtml',
    'matchChangeNarrativeHtml',
    'smartInsightsHeroHtml',
    'smartInsightsFullHtml',
    'liveAiCoachHtml',
    'postMatchReviewHtml',
    'renderMatchCenter',
    'openMatchCenter',
  ]) {
    assert.equal(typeof module[name],'function', name);
  }
});

test('public app composes match center render module instead of keeping it inline',()=>{
  assert.match(app,/import \{ createMatchCenterRenderModule \} from '\.\/modules\/match-center-render\.js'/);
  assert.match(app,/createMatchCenterRenderModule\(\{/);
  assert.doesNotMatch(app,/function freshnessSourceLabel\(source\) \{/);
  assert.doesNotMatch(app,/function renderMatchCenter\(d\) \{/);
  assert.doesNotMatch(app,/async function openMatchCenter\(fixtureId, btn\) \{/);
});
