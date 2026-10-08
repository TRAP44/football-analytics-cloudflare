import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../public/preview-matchradar.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../public/modules/preview-matchradar.js',import.meta.url),'utf8');
const headers=readFileSync(new URL('../public/_headers',import.meta.url),'utf8');

test('Signature preview is separate from production Match Center and visibly labeled demo',()=>{
  assert.match(html,/MATCHRADAR/);
  assert.match(html,/ДЕМО/);
  assert.match(html,/вымышлены/);
  assert.match(html,/Демонстрация PRO/);
  assert.doesNotMatch(js,/\/api\/|fetch\(|payment|checkout/);
  assert.match(html,/<html lang="ru">/);
});

test('Signature preview keyboard tabs are wired to real tab panels',()=>{
  for(const key of ['overview','ai','live','lineups']) {
    assert.ok(html.includes('id="tab-'+key+'"'));
    assert.ok(html.includes('id="pane-'+key+'"'));
    assert.ok(html.includes('aria-controls="pane-'+key+'"'));
    assert.match(js,new RegExp('openTab\\('));
  }
  assert.match(js,/ArrowRight/);
  assert.match(js,/ArrowLeft/);
  assert.match(js,/aria-selected/);
});

test('Scenarios update all three probability bars and stay marked illustrative',()=>{
  for(const id of ['Home','Draw','Away']) {
    assert.ok(html.includes('id="bar'+id+'"'));
    assert.ok(html.includes('id="pct'+id+'"'));
  }
  for(const scenario of ['base','goal','absence'])assert.ok(js.includes(' '+scenario+':'));
  assert.match(js,/document\.getElementById\("bar"\+key\)\.style\.width/);
  assert.match(html,/Числа приведены только для демонстрации/);
});

test('Signature preview obeys production CSP and mobile touch limits',()=>{
  assert.match(headers,/script-src 'self' https:\/\/telegram\.org/);
  assert.match(html,/<script src="\.\/modules\/preview-matchradar\.js" defer><\/script>/);
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/viewport-fit=cover/);
  assert.match(html,/safe-area-inset-bottom/);
  assert.match(html,/min-height:44px/);
  assert.match(html,/prefers-reduced-motion/);
});
