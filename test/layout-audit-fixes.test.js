import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Исправления по аудиту вёрстки на узких экранах (360–430px).
const premium = fs.readFileSync('public/styles/premium-ui.css', 'utf8');
const shell = fs.readFileSync('public/styles/public-shell.css', 'utf8');
const homeSignal = fs.readFileSync('public/modules/home-signal.js', 'utf8');

test('featured match: the centre circle is tied to the score, not to the card height', () => {
  assert.doesNotMatch(premium, /radial-gradient\(circle at 50% 46%, transparent 0 54px/);
  assert.match(premium, /\.mr-featured-score::before \{[^}]*position: absolute; left: 50%; top: calc\(50% \+ 4px\)[^}]*transform: translate\(-50%, -50%\); border-radius: 50%;/);
});

test('featured match caption shows the phase only — the minute is already in the LIVE badge', () => {
  assert.match(homeSignal, /match\.live \? phase \|\| 'Идёт матч' : 'Итоговый счёт'/);
  assert.doesNotMatch(homeSignal, /\[phase,minute\]/);
});

test('bottom navigation labels shrink on narrow phones instead of being cut', () => {
  assert.match(premium, /@media \(max-width: 390px\) \{\s*html\[data-theme\] body\.miniapp-public-shell \.bottom-nav \.nav-item small \{ font-size: 11px;/);
  assert.match(premium, /@media \(max-width: 360px\) \{\s*html\[data-theme\] body\.miniapp-public-shell \.bottom-nav \.nav-item small \{ font-size: 10\.5px; \}/);
});

test('«против» chip fits its text and accent options use two columns at 360px', () => {
  assert.match(shell, /\.miniapp-public-shell \.experience-vs > span\{[^}]*width:auto;[^}]*padding-inline:8px;[^}]*white-space:nowrap;/);
  const narrow = shell.slice(shell.indexOf('@media(max-width:360px){', shell.indexOf('.miniapp-public-shell .ai-track-card{padding:14px}') - 400));
  assert.match(narrow.slice(0, 1200), /\.miniapp-public-shell \.accent-options\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
});
