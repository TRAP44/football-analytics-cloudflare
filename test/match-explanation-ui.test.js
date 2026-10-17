import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadMatchExplanation, matchExplanationHtml } from '../public/modules/match-explanation.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
const items = [
  { id: 'model_lead', role: 'lead', connector: 'Главное:', text: 'По оценке модели фаворит — Милан: победа с вероятностью 54%.' },
  { id: 'absences_away', role: 'support', connector: 'Это подкрепляет:', text: 'Рома: 3 игрока вне заявки или под вопросом по данным источника.' },
  { id: 'lineups_pending', role: 'caveat', connector: 'Важно учитывать:', text: 'Стартовые составы ещё не подтверждены — оценка может измениться.' },
];

test('explanation block renders server facts with role connectors and an honest source label', () => {
  const ai = matchExplanationHtml({ available: true, source: 'ai', items }, escapeHtml);
  assert.match(ai, /AI · простыми словами/);
  assert.match(ai, /Порядок фактов выбрал AI/);
  assert.match(ai, /<li class="is-lead"><b>Главное:<\/b> По оценке модели фаворит — Милан/);
  assert.match(ai, /<li class="is-caveat"><b>Важно учитывать:<\/b>/);
  assert.match(ai, /AI только выбирает и упорядочивает их/);
  assert.match(matchExplanationHtml({ available: true, source: 'default', items }, escapeHtml), /Базовый порядок фактов/);
});

test('explanation block is hidden for malformed or unavailable answers and escapes text', () => {
  assert.equal(matchExplanationHtml(null, escapeHtml), '');
  assert.equal(matchExplanationHtml({ available: false }, escapeHtml), '');
  assert.equal(matchExplanationHtml({ available: true, items: [items[1], items[0]] }, escapeHtml), '', 'lead must come first');
  assert.equal(matchExplanationHtml({ available: true, items: [items[0]] }, escapeHtml), '', 'at least two facts');
  assert.equal(matchExplanationHtml({ available: true, items: [{ ...items[0], role: 'hype' }, items[1]] }, escapeHtml), '');
  const hostile = matchExplanationHtml({ available: true, items: [{ ...items[0], text: '<img onerror=x>' }, items[1]] }, escapeHtml);
  assert.doesNotMatch(hostile, /<img/);
  assert.match(hostile, /&lt;img onerror=x&gt;/);
});

function fakeRoot(fixture) {
  return { dataset: { fixture: String(fixture) }, isConnected: true, hidden: true, innerHTML: '' };
}

test('loader fills the block for the current analysis and ignores stale answers', async () => {
  const root = fakeRoot(77);
  let url = '';
  const ok = await loadMatchExplanation({ root, fixtureId: 77, escapeHtml, api: async u => { url = u; return { available: true, source: 'ai', items }; } });
  assert.equal(ok, true);
  assert.equal(url, '/api/match-explanation?fixtureId=77');
  assert.equal(root.hidden, false);
  assert.match(root.innerHTML, /Главное:/);

  const stale = fakeRoot(77);
  assert.equal(await loadMatchExplanation({ root: stale, fixtureId: 77, escapeHtml, isCurrent: () => false, api: async () => ({ available: true, items }) }), false);
  assert.equal(stale.innerHTML, '');

  const failed = fakeRoot(77);
  assert.equal(await loadMatchExplanation({ root: failed, fixtureId: 77, escapeHtml, api: async () => { throw new Error('503'); } }), false);
  assert.equal(failed.hidden, true);
});

test('analysis view loads the explanation lazily above the key points', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  // Блок виден сразу, над вкладками и «Что важно перед матчем».
  assert.match(app, /<section class="panel match-explanation" id="matchExplanation" data-fixture="\$\{Number\(m\.fixtureId\) \|\| 0\}" aria-live="polite" hidden><\/section>\s*(<section class="panel match-explanation match-questions"[^\n]*<\/section>\s*)?\$\{kickoffHandoffHtml\(/);
  assert.ok(app.indexOf('id="matchExplanation"') < app.indexOf('${analysisGlanceHtml(d)}'));
  assert.match(app, /import\('\.\/modules\/match-explanation\.js\?v=6\.120\.0-launch124'\)/);
  assert.match(app, /void loadAnalysisExplanation\(Number\(m\.fixtureId\)\);/);
});
