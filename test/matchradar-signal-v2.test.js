import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('public/preview-signal.html','utf8');
const css = fs.readFileSync('public/styles/preview-signal.css','utf8');
const js = fs.readFileSync('public/modules/preview-signal.js','utf8');

test('SIGNAL design preview stays isolated and marks every sports value as fictional',()=>{
  assert.match(html,/ИНТЕРАКТИВНЫЙ КОНЦЕПТ/);
  assert.match(html,/ВСЕ ДАННЫЕ ВЫМЫШЛЕНЫ/);
  assert.match(html,/не подключён к настоящему API/);
  assert.match(html,/preview-signal\.css/);
  assert.match(html,/preview-signal\.js/);
  assert.doesNotMatch(js,/\bfetch\s*\(/);
  assert.doesNotMatch(js,/checkout|createInvoice|createPayment|cloudflare|supabase/i);
});

test('SIGNAL includes accessible navigation, match tabs and scenario controls',()=>{
  for(const name of ['home','match','ai','profile']) assert.match(html,new RegExp('id="view-'+name+'"'));
  for(const name of ['overview','ai','live','lineup']){
    assert.match(html,new RegExp('id="tab-'+name+'"'));
    assert.match(html,new RegExp('id="panel-'+name+'"'));
    assert.match(html,new RegExp('aria-controls="panel-'+name+'"'));
  }
  for(const name of ['base','homeGoal','redCard'])assert.ok(js.includes(name+': Object.freeze('));
  assert.match(js,/aria-pressed/);
  assert.match(js,/ArrowLeft/);
  assert.match(js,/ArrowRight/);
  assert.match(js,/filterReset/);
  assert.match(js,/favorites\.add/);
});

test('SIGNAL mock 1X2 scenario distribution remains a valid 100 percent vector',()=>{
  for(const match of js.matchAll(/probabilities:\s*\[([\d, ]+)\]/g)){
    const values=match[1].split(',').map(Number);
    assert.equal(values.length,3);
    assert.equal(values.reduce((a,b)=>a+b,0),100);
  }
  assert.match(js,/scenario\.probabilities/);
});

test('SIGNAL is mobile/Telegram compatible without excessive UI dependencies',()=>{
  assert.match(html,/viewport-fit=cover/);
  assert.match(html,/safe-area-inset/);
  assert.match(html,/telegram-web-app\.js/);
  assert.match(css,/max-width:380px/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(css,/min-height:44px/);
  assert.match(js,/contentSafeAreaInset/);
  assert.match(js,/HapticFeedback/);
});
