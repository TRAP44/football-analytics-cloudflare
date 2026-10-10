import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const historyRenderer=fs.readFileSync('public/modules/history-renderer.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles/premium-ui.css','utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  const b=source.indexOf(end,a+start.length);
  assert.ok(a>=0,start);
  assert.ok(b>a,end);
  return source.slice(a,b);
}

test('history list never shows saved betting-style signal labels',()=>{
  const chip=block(historyRenderer,'const signal=item.aiSignalLabel','\n\n');
  assert.doesNotMatch(chip,/html\(item\.aiSignalLabel\)/);
  assert.match(chip,/item\.aiSignalCode==='skip' \? 'без уверенного вывода' : 'разбор готов'/);
});

test('home radar feed shows a neutral verdict instead of the saved signal label',()=>{
  const feed=block(app,'function radarFeedItems','\nfunction ');
  assert.doesNotMatch(feed,/history\.aiSignalLabel \|\|/);
  assert.match(feed,/history\.aiSignalCode === 'skip' \? 'Без уверенного вывода' : 'Сохранённый разбор'/);
});

test('profile does not repeat plan and daily usage above the AI limit panel',()=>{
  const profile=block(html,'<section id="profileView"','<section id="billingPanel"');
  assert.match(profile,/<div class="profile-billing-dup">\s*<span class="muted">Тариф<\/span>\s*<strong id="profilePlan">/);
  assert.match(profile,/<div class="profile-billing-dup">\s*<span class="muted">Анализы сегодня<\/span>\s*<strong id="profileUsage">/);
  assert.match(css,/\.profile-panel \.profile-billing-dup \{ display: none; \}/);
  // Блок «AI-лимит» по-прежнему показывает использование и остаток.
  for (const id of ['billingQuotaUsed','billingQuotaLimit','billingQuotaLeft','billingQuotaProgress']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/<div class="billing-expiry-cell"><span>Подписка<\/span><strong id="billingExpiry">/);
  assert.match(css,/\.billing-panel\.is-paused \.billing-expiry-cell \{ display: none; \}/);
});

test('my teams keeps the open action on the same row as the team name',()=>{
  assert.match(css,/\.my-team-head \{ grid-template-columns: 44px minmax\(0, 1fr\) auto; \}/);
  assert.match(css,/\.my-team-head > b \{ grid-column: auto; width: auto; \}/);
});
