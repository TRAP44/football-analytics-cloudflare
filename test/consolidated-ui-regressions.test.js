import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  dateTime,
  favoriteStarSvg,
  safeDate,
  timeOf,
} from '../public/modules/client-core.js';

const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles/premium-ui.css','utf8');

function section(source,start,end) {
  const from=source.indexOf(start);
  assert.ok(from>=0,`missing section start: ${start}`);
  const to=end ? source.indexOf(end,from+start.length) : source.length;
  assert.ok(!end || to>from,`missing section end: ${end}`);
  return source.slice(from,to);
}

test('public date rendering rejects ambiguous dates and uses midnight as 00:xx, never 24:xx', () => {
  for (const value of [true,false,null,undefined,'','   ','not-a-date','2026-02-30T12:00:00.000Z']) {
    assert.equal(safeDate(value),null,String(value));
  }

  const midnight=new Date(2026,0,2,0,5,0,0);
  assert.equal(timeOf(midnight),'00:05');
  assert.match(dateTime(midnight),/00:05/);
  assert.doesNotMatch(dateTime(midnight),/24:05/);

  const cloned=safeDate(midnight);
  assert.ok(cloned instanceof Date);
  assert.notEqual(cloned,midnight);
  assert.equal(cloned.getTime(),midnight.getTime());
});

test('favorite star primitive has one SVG geometry and requires a real boolean active state', () => {
  const inactive=favoriteStarSvg(false);
  const active=favoriteStarSvg(true);

  for (const markup of [inactive,active]) {
    assert.match(markup,/class="fav-star-icon"/);
    assert.match(markup,/viewBox="0 0 24 24"/);
    assert.match(markup,/aria-hidden="true"/);
    assert.match(markup,/focusable="false"/);
    assert.doesNotMatch(markup,/★|☆/);
  }

  assert.match(inactive,/fill="none"/);
  assert.match(active,/fill="currentColor"/);
  assert.match(favoriteStarSvg('true'),/fill="none"/);
  assert.match(favoriteStarSvg(1),/fill="none"/);

  assert.match(
    app,
    /import \{[^}]*favoriteStarSvg[^}]*\} from '\.\/modules\/client-core\.js';/,
  );
  assert.match(app,/\$\{favoriteStarSvg\(active\)\}/);
  assert.match(app,/analysis-favorite-star">\$\{favoriteStarSvg\(homeFavorite\)\}/);
  assert.match(app,/analysis-favorite-star">\$\{favoriteStarSvg\(awayFavorite\)\}/);
});

test('standard public actions keep a centered 44px touch geometry contract', () => {
  assert.match(css,/--mr-touch-target:\s*44px/);
  assert.match(
    css,
    /\.miniapp-public-shell :is\([\s\S]*?\.primary-btn,[\s\S]*?\.filter-btn,[\s\S]*?\.icon-btn[\s\S]*?\) \{[\s\S]*?min-height:\s*var\(--mr-touch-target\);[\s\S]*?display:\s*inline-flex;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;[\s\S]*?text-align:\s*center;/,
  );
  assert.match(
    css,
    /:is\(\.icon-btn, \.fav-star\.compact\) \{[\s\S]*?min-width:\s*var\(--mr-touch-target\);[\s\S]*?width:\s*var\(--mr-touch-target\);[\s\S]*?height:\s*var\(--mr-touch-target\);/,
  );
  assert.match(
    css,
    /:has\(> button:only-child\) \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/,
  );

  const contractTail=section(css,'/* Public component contracts.');
  assert.doesNotMatch(contractTail.replace(/[^{}]*\[hidden\][^{}]*\{[^}]*\}/g,''),/!important/);
});

test('compact and analysis favorite controls share the same 19px SVG primitive', () => {
  assert.match(
    css,
    /\.miniapp-public-shell \.fav-star-icon \{[\s\S]*?width:\s*19px;[\s\S]*?height:\s*19px;/,
  );
  assert.match(
    css,
    /\.miniapp-public-shell \.analysis-favorite-star \.fav-star-icon \{[\s\S]*?width:\s*19px;[\s\S]*?height:\s*19px;/,
  );
  assert.match(
    css,
    /\.miniapp-public-shell \.match-secondary-actions > span \{[\s\S]*?grid-template-columns:\s*44px 44px;/,
  );
});

test('public match center hides stale snapshot/countdown copy and keeps a stable live status', () => {
  const center=section(app,'function renderMatchCenter','async function openMatchCenter');

  assert.doesNotMatch(center,/Показан последний сохранённый снимок/);
  assert.doesNotMatch(center,/Автообновление через \$\{/);
  assert.match(center,/quota-public-chip[\s\S]*?escapeHtml\(publicText\(d\.quotaMode\.label/);
  assert.match(center,/обновление \$\{Number\(d\.quotaMode\.liveRefreshSeconds \|\| d\.refreshSeconds \|\| 0\)\} сек\./);
  assert.match(center,/<small id="liveRefreshText">Обновляется автоматически<\/small>/);
});

test('Radar Feed tone classes stay namespaced and legacy .ai styling cannot leak in', () => {
  assert.doesNotMatch(css,/\.radar-feed-item\.ai(?:\W|$)/);
  assert.match(css,/\.radar-feed-item\.tone-live \.radar-feed-pulse/);
  assert.match(css,/\.radar-feed-item\.tone-ai \.radar-feed-pulse/);
  assert.match(css,/\.radar-feed-item\.tone-reminder \.radar-feed-pulse/);
  assert.match(css,/\.radar-feed-item\.tone-watching \.radar-feed-pulse/);
});

test('match time remains plain tabular text instead of a badge/pill', () => {
  const rule=section(
    css,
    '.miniapp-public-shell .match-time-label {',
    '@media (max-width: 430px)',
  );
  assert.match(rule,/min-height:\s*auto;/);
  assert.match(rule,/padding:\s*0;/);
  assert.match(rule,/border:\s*0;/);
  assert.match(rule,/border-radius:\s*0;/);
  assert.match(rule,/background:\s*transparent;/);
  assert.match(rule,/box-shadow:\s*none;/);
  assert.match(rule,/font-variant-numeric:\s*tabular-nums;/);

  const card=section(app,'function matchCardHtml','function bindMatchActions');
  assert.match(card,/match-time-label">\$\{escapeHtml\(timeOf\(m\.date\)\)\}/);
});
