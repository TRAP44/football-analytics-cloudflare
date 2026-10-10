import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(
  new URL('../public/app.js', import.meta.url),
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
    'function renderMatchCenter(d) {',
    '\nasync function openMatchCenter',
  );
}

test('Match Center keeps primary match story above progressive details', () => {
  const source=matchCenterRendererSource();
  const primary=source.indexOf('class="match-center-primary"');
  const details=source.indexOf('class="match-center-more"');

  assert.ok(primary>0);
  assert.ok(details>primary);
  assert.match(source,/ГЛАВНОЕ/);
  assert.match(source,/Ключевые показатели/);
  assert.match(source,/Последние события/);
  assert.match(source,/Статистика, составы и хронология/);
});

test('Match Center does not duplicate key metrics inside the detail summary tab', () => {
  const source=matchCenterRendererSource();

  assert.equal(
    (source.match(/Ключевые показатели/g) || []).length,
    1,
  );
  assert.match(
    source,
    /data-center-tab="summary"[^>]*>Данные<\/button>/,
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

  assert.equal(revision,'6.120.0-launch71');

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
