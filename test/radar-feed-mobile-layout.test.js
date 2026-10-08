import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('public/styles.css', 'utf8');

test('Radar Feed keeps the text column wide on narrow Telegram WebViews', () => {
  assert.match(css, /\.radar-feed-item\s*\{[\s\S]*grid-template-columns:\s*8px\s+minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(css, /\.radar-feed-item\s*\{[\s\S]{0,400}grid-template-columns:\s*8px\s+minmax\(0,\s*1fr\)\s+auto/);
  assert.match(css, /\.radar-feed-item\s*>\s*b\s*\{[\s\S]*position:\s*absolute/);
  assert.match(css, /\.radar-feed-copy\s*\{[\s\S]*width:\s*100%/);
});

test('Radar Feed does not break normal words anywhere', () => {
  const strong = css.match(/\.radar-feed-copy strong\s*\{([\s\S]*?)\}/)?.[1] || '';
  const meta = css.match(/\.radar-feed-copy em\s*\{([\s\S]*?)\}/)?.[1] || '';
  assert.doesNotMatch(strong, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(meta, /overflow-wrap:\s*anywhere/);
  assert.match(strong, /word-break:\s*normal/);
  assert.match(meta, /word-break:\s*normal/);
});

test('Radar Feed mobile rule keeps right-side arrow space bounded', () => {
  assert.match(css, /@media \(max-width:\s*430px\)[\s\S]*\.radar-feed-item\s*\{[\s\S]*padding:\s*10px\s+34px\s+10px\s+10px/);
});

test('Radar Feed desktop and compact rules reserve arrow space without third grid track',()=>{
  const base=css.match(/\.radar-feed-item\s*\{([^}]*)\}/)?.[1] || '';
  const copy=css.match(/\.radar-feed-copy\s*\{([^}]*)\}/)?.[1] || '';
  const arrow=css.match(/\.radar-feed-item\s*>\s*b\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(base,/grid-template-columns:\s*8px\s+minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(base,/grid-template-columns:[^;]*\bauto\b/);
  assert.match(base,/min-width:\s*0/);
  assert.match(copy,/min-width:\s*0/);
  assert.match(copy,/max-width:\s*100%/);
  assert.match(arrow,/position:\s*absolute/);
  assert.match(arrow,/width:\s*16px/);
});
