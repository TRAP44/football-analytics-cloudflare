import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { wholePercentText, wholePercentTriple } from '../public/modules/probability-display.js';
import { inPlayEstimateHtml } from '../public/modules/match-center-view.js';

test('outcome probabilities are shown as whole percents that sum to 100',()=>{
  assert.deepEqual(wholePercentTriple({home:58.2,draw:23.1,away:18.7}),{home:58,draw:23,away:19});
  assert.deepEqual(wholePercentTriple({home:33.4,draw:33.3,away:33.3}),{home:34,draw:33,away:33});
  assert.deepEqual(wholePercentTriple({home:'45.5',draw:'27.25',away:'27.25'}),{home:46,draw:27,away:27});
  for (const triple of [{home:12.5,draw:12.5,away:75},{home:0.4,draw:0.3,away:99.3},{home:49.95,draw:0.1,away:49.95}]) {
    const shown=wholePercentTriple(triple);
    assert.equal(shown.home+shown.draw+shown.away,100,JSON.stringify(triple));
  }
});

test('incomplete or broken triples are rounded value by value, never invented',()=>{
  assert.deepEqual(wholePercentTriple({home:58.6,draw:null,away:18.2}),{home:59,draw:null,away:18});
  assert.deepEqual(wholePercentTriple({home:'x',draw:-5,away:140}),{home:null,draw:null,away:null});
  assert.deepEqual(wholePercentTriple(null),{home:null,draw:null,away:null});
  assert.equal(wholePercentText(58.2),'58%');
  assert.equal(wholePercentText(undefined),'—');
  assert.equal(wholePercentText(''),'—');
});

test('analysis hero and in-play estimate use whole percents',()=>{
  const app=fs.readFileSync('public/app.js','utf8');
  assert.match(app,/const shownP = wholePercentTriple\(p\);/);
  assert.doesNotMatch(app,/function pct\(v\) \{ return Number\.isFinite\(Number\(v\)\) \? `\$\{Number\(v\)\.toFixed\(1\)\}%`/);
  const html=inPlayEstimateHtml({home:41.6,draw:30.2,away:28.2,minute:67,score:'1:1'},{home:{name:'Рома'},away:{name:'Порту'}});
  assert.match(html,/<strong>42%<\/strong>/);
  assert.doesNotMatch(html,/\d+\.\d%/);
});
