import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(
  new URL('../public/app.js', import.meta.url),
  'utf8',
)+'\n'+readFileSync(
  new URL('../public/modules/match-center-view.js', import.meta.url),
  'utf8',
);
const styles = readFileSync(
  new URL('../public/styles.css', import.meta.url),
  'utf8',
);
const index = readFileSync(
  new URL('../public/index.html', import.meta.url),
  'utf8',
);

function sourceBlock(startToken,endToken) {
  const start=app.indexOf(startToken);
  const end=app.indexOf(endToken,start+startToken.length);
  assert.ok(start>=0,startToken);
  assert.ok(end>start,endToken);
  return app.slice(start,end);
}

function matchCenterRendererSource() {
  return sourceBlock(
    'export function renderMatchCenterView',
    '// end renderMatchCenterView',
  );
}

test('Match Center opens on the AI tab and keeps details in the other tabs', () => {
  const source=matchCenterRendererSource();
  const scoreboard=source.indexOf('center-scoreboard');
  const tabs=source.indexOf('mr-hq-tabs');
  const ai=source.indexOf('data-center-panel="ai"');
  const summary=source.indexOf('data-center-panel="summary"');
  const game=source.indexOf('data-center-panel="game"');
  const lineups=source.indexOf('data-center-panel="lineups"');

  assert.ok(scoreboard>0 && tabs>scoreboard && ai>tabs);
  assert.ok(summary>ai && game>summary && lineups>game);
  assert.match(source,/class="center-tab-panel match-center-primary" data-center-panel="ai"/);
  assert.match(source,/ГЛАВНОЕ/);
  assert.match(source,/Ключевые показатели/);
  assert.match(source,/Последние события/);
});

test('Match Center does not duplicate key metrics inside the detail summary tab', () => {
  const source=matchCenterRendererSource();

  assert.equal(
    (source.match(/Ключевые показатели/g) || []).length,
    1,
  );
  assert.match(
    source,
    /data-center-tab="summary"[^>]*>Обзор<\/button>/,
  );
});

test('optional Match Center hierarchy renderers fail soft instead of breaking the core screen', () => {
  const helper=sourceBlock(
    'function matchCenterExtraHtml',
    'function renderMatchCenter',
  );
  const center=matchCenterRendererSource();

  assert.match(helper,/typeof renderer!=='function'/);
  assert.match(helper,/try \{/);
  assert.match(helper,/catch \{/);
  assert.match(helper,/typeof html==='string' \? html : ''/);

  assert.match(
    center,
    /matchCenterExtraHtml\('renderMatchPulse'/,
  );
  assert.match(
    center,
    /matchCenterExtraHtml\(\s*'renderAiTimelineCompact'/,
  );
  assert.match(
    center,
    /matchCenterExtraHtml\(\s*'renderAiTimelineDetails'/,
  );
  assert.doesNotMatch(
    center,
    /matchCenterExtras\?\.render(?:MatchPulse|AiTimeline)/,
  );
});

test('event hierarchy rejects malformed collections and never promotes events on an upcoming match', () => {
  const center=matchCenterRendererSource();
  const liveEvents=sourceBlock(
    'function liveEventsHtml',
    'function lineupPlayerName',
  );
  const timeline=sourceBlock(
    'function timelineEventsHtml',
    'function centerPlayersHtml',
  );

  assert.match(
    center,
    /const eventRows=Array\.isArray\(d\.events\) \? d\.events : \[\];/,
  );
  assert.match(
    center,
    /const latestEvents=upcoming \? \[\] : eventRows\.slice\(-3\)\.reverse\(\);/,
  );
  assert.match(center,/timelineEventsHtml\(eventRows, m\)/);
  assert.match(
    liveEvents,
    /!Array\.isArray\(events\) \|\| !events\.length/,
  );
  assert.match(
    timeline,
    /!Array\.isArray\(events\) \|\| !events\.length/,
  );
});

test('Match Center hierarchy styles and current asset revision are wired consistently', () => {
  assert.match(styles,/\/\* Match Center hierarchy \*\//);
  assert.match(styles,/\.match-center-primary\s*\{/);
  assert.match(styles,/\.match-center-more\s*\{/);

  const revision=index.match(
    /frontend-asset-revision" content="([^"]+)"/,
  )?.[1];

  assert.equal(revision,'6.120.0-launch78');

  for (const asset of [
    'styles.css',
    'styles/public-shell.css',
    'styles/premium-ui.css',
    'app.js',
  ]) {
    assert.ok(
      index.includes('/'+asset+'?v='+revision),
      asset,
    );
  }

  assert.doesNotMatch(index,/6\.120\.0-launch50/);
});
