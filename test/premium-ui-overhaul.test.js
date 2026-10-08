import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FRONTEND_ASSET_REVISION } from '../public/modules/app-runtime.js';

const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/styles/premium-ui.css', 'utf8');

test('premium UI layer is loaded after public shell', () => {
  const shell = html.indexOf('/styles/public-shell.css');
  const premium = html.indexOf('/styles/premium-ui.css');
  assert.ok(shell >= 0 && premium > shell);
  assert.ok(html.includes(`frontend-asset-revision" content="${FRONTEND_ASSET_REVISION}"`));
  assert.ok(html.includes(`premium-ui.css?v=${FRONTEND_ASSET_REVISION}`));
});

test('premium UI covers core public surfaces without changing product contracts', () => {
  for (const selector of [
    '.topbar',
    '.home-search-block',
    '.match-card',
    '.bottom-nav',
    '.match-experience-hero',
    '.center-hero',
    '.history-item',
    '.profile-panel',
    '.billing-panel',
    '.pass-card',
    '.digest-settings-panel',
    '.smart-notifications-panel',
    '[data-admin-only]',
  ]) assert.ok(css.includes(selector), selector);
});

test('premium UI explicitly supports Telegram mobile widths and reduced motion', () => {
  for (const width of [430, 390, 360, 320]) {
    assert.ok(css.includes('@media (max-width: ' + width + 'px)'), String(width));
  }
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test('premium UI preserves theme modes and keeps admin visually separated', () => {
  assert.match(css, /data-theme="dark"/);
  assert.match(css, /data-theme="ocean"/);
  assert.match(css, /data-theme="light"/);
  assert.match(css, /content: "ADMIN"/);
});



test('premium bottom navigation keeps four semantic public destinations',()=>{
  const from=html.indexOf('<nav class="bottom-nav"');
  const to=html.indexOf('</nav>',from);
  assert.ok(from>=0 && to>from);
  const nav=html.slice(from,to);
  assert.match(nav,/aria-label="Основная навигация"/);
  for(const id of ['navMatches','navMyTeams','navHistory','navProfile']){
    assert.match(nav,new RegExp('<button id="'+id+'"[^>]*type="button"'));
  }
  assert.equal((nav.match(/<button\b/g)||[]).length,4);
  assert.equal((nav.match(/aria-current="page"/g)||[]).length,1);
  assert.doesNotMatch(nav,/data-admin-only|navAdmin/);
});

test('premium interactive controls keep a 44px tap target and keyboard focus feedback',()=>{
  assert.match(css,/--mr-touch-target:\s*44px/);
  assert.match(css,/min-height:\s*var\(--mr-touch-target\)/);
  assert.match(css,/min-width:\s*var\(--mr-touch-target\)/);
  for(const selector of ['button:focus-visible','a:focus-visible','summary:focus-visible']){
    assert.ok(css.includes(selector),'Missing keyboard focus selector '+selector);
  }
  assert.match(css,/outline:\s*2px solid/);
  assert.match(css,/outline-offset:\s*2px/);
});

test('premium reduced-motion preferences suppress transitions and animations',()=>{
  const start=css.indexOf('@media (prefers-reduced-motion: reduce)');
  const end=css.indexOf('/* Public component contracts.',start);
  assert.ok(start>=0 && end>start);
  const reduced=css.slice(start,end);
  assert.match(reduced,/animation-duration:\s*\.001ms !important/);
  assert.match(reduced,/animation-iteration-count:\s*1 !important/);
  assert.match(reduced,/scroll-behavior:\s*auto !important/);
  assert.match(reduced,/transition-duration:\s*\.001ms !important/);
});

test('premium mobile shell and sticky bottom bar respect safe areas',()=>{
  assert.match(css,/env\(safe-area-inset-left\)/);
  assert.match(css,/env\(safe-area-inset-right\)/);
  assert.match(css,/env\(safe-area-inset-top\)/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.match(css,/\.miniapp-public-shell \.bottom-nav\s*\{[\s\S]{0,300}?left:\s*50%/);
  assert.match(css,/transform:\s*translateX\(-50%\)/);
  assert.match(css,/@media \(max-width: 320px\)/);
});
