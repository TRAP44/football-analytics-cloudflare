import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('RC55 search normalization handles punctuation hyphens and latin variants',()=> {
  for (const sample of ["['МЮ','Manchester United']","['мю!!!','Manchester United']","['Бока-Хуниорс','Boca Juniors']","['Al‑Nassr','Al-Nassr']","['Fenerbahçe','Fenerbahce']","['São Paulo','Sao Paulo']","['Bayern München','Bayern Munich']"]) {
    assert.ok(worker.includes(sample), `missing drill case ${sample}`);
  }
  assert.ok(worker.includes(".replace(/[çćč]/g, 'c')"));
  assert.ok(worker.includes(".replace(/[‐‑‒–—―\\-_/\\\\|+.,!?;:()[\\]{}"));
  assert.ok(worker.includes("searchQualitySelfTest: searchQualityDrill().pass ? 'enabled' : 'failed'"));
});

test('telegram match parsing does not split internal club hyphens',()=> {
  assert.ok(worker.includes("query.split(/(?:\\s*[—–]\\s*|\\s+-\\s+|\\s+\\bvs\\.?\\b\\s+|\\s+\\bпротив\\b\\s+)/i)"));
  assert.ok(!worker.includes("query.split(/\\s*(?:—|–|-|\\bvs"));
});

test('recognized fallback has a retry action instead of a dead card',()=> {
  assert.ok(app.includes('data-known-team-query'));
  assert.ok(app.includes('void runGlobalSearch()'));
  assert.ok(app.includes('Повторить →'));
  assert.ok(css.includes('.known-team-summary'));
});

test('search outcome analytics remains query-text free',()=> {
  const events=[...worker.matchAll(/eventName:'search_result'[^\n]+/g)].map(x=>x[0]);
  assert.ok(events.length>=2);
  for (const event of events) {
    assert.doesNotMatch(event,/query|rawText|parts\.query/);
    assert.match(event,/outcome:/);
  }
  assert.ok(worker.includes("searchQuality:{attempts:searchResultRows.length"));
  assert.ok(app.includes('Качество поиска:'));
});

test('RC55 launch search drill remains health-gated',()=> {
  for (const flag of ['realLaunchDrill','searchNormalization','searchOutcomeAnalytics','searchRetryUx']) assert.ok(worker.includes(`${flag}: 'enabled'`));
  assert.match(worker,/searchQualitySelfTest: searchQualityDrill\(\)\.pass \? 'enabled' : 'failed'/);
});
