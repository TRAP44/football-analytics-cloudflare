import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { aiGuessedCardModel, drawAiGuessedCard, shareAiGuessedCard } from '../public/modules/ai-guessed-card.js';
import { matchPickHtml } from '../public/modules/beat-ai.js';

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const settled = (result, extra = {}) => ({
  available: true,
  open: false,
  ai: 'home',
  pick: 'home',
  result: { actual: 'home', userPoint: 1, aiPoint: 1, score: { home: 2, away: 1 }, aiProbability: 58, homeName: 'Спартак', awayName: 'Зенит', league: 'Премьер-лига', ...result },
  ...extra,
});

test('card text depends on who guessed; nobody guessed — no card', () => {
  assert.equal(aiGuessedCardModel(settled({})).headline, 'Вы и AI угадали');
  assert.equal(aiGuessedCardModel(settled({ userPoint: 0 }, { pick: 'away' })).headline, 'AI угадал');
  assert.equal(aiGuessedCardModel(settled({ userPoint: null }, { pick: null })).headline, 'AI угадал');
  assert.equal(aiGuessedCardModel(settled({ aiPoint: 0, actual: 'away' }, { ai: 'home', pick: 'away' })).headline, 'Вы обыграли AI');
  assert.equal(aiGuessedCardModel(settled({ aiPoint: 0, userPoint: 0, actual: 'draw' })), null);
  assert.equal(aiGuessedCardModel({ available: true, open: false, verifying: true, result: null }), null, 'unverified result — no card');
  assert.equal(aiGuessedCardModel(null), null);
});

test('card content: score, outcome, AI pre-match pick with its probability, user pick', () => {
  const model = aiGuessedCardModel(settled({}, { pick: 'home' }));
  assert.equal(model.score, '2 : 1');
  assert.equal(model.outcome, 'Итог: Спартак');
  assert.deepEqual(model.lines, ['Прогноз AI до матча: Спартак · 58%', 'Ваш прогноз: Спартак']);
  assert.equal(model.league, 'Премьер-лига');
  assert.match(model.footer, /аналитика, а не гарантия результата/);
  assert.match(model.fileName, /^matchradar-Спартак-Зенит\.png$/);
  // Нет проверенных чисел — их нет и на карточке.
  const bare = aiGuessedCardModel(settled({ score: null, aiProbability: null }));
  assert.equal(bare.score, '');
  assert.equal(bare.lines[0], 'Прогноз AI до матча: Спартак');
  const text = JSON.stringify(model);
  assert.doesNotMatch(text, /ставк|коэф|букмекер|выигрыш|П1|П2/i);
});

function fakeCanvas() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return text => ({ width: String(text).length * 20 });
      if (key === 'createRadialGradient') return () => ({ addColorStop: () => {} });
      return (...args) => { calls.push([key, ...args]); };
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  return { calls, canvas: { getContext: () => ctx } };
}

test('drawing puts every line of the model on a 1080×1080 canvas', () => {
  const { calls, canvas } = fakeCanvas();
  assert.equal(drawAiGuessedCard(canvas, aiGuessedCardModel(settled({}))), true);
  assert.equal(canvas.width, 1080);
  assert.equal(canvas.height, 1080);
  const texts = calls.filter(call => call[0] === 'fillText').map(call => call[1]);
  for (const expected of ['Вы и AI угадали', 'Спартак', 'Зенит', '2 : 1', 'Итог: Спартак', 'Прогноз AI до матча: Спартак · 58%', 'Ваш прогноз: Спартак', 'Премьер-лига']) {
    assert.ok(texts.includes(expected), expected);
  }
  assert.equal(drawAiGuessedCard(canvas, null), false);
});

test('without file sharing the card opens in an overlay with a save hint', async () => {
  const appended = [];
  const element = tag => ({ tag, children: [], attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, append(...nodes) { this.children.push(...nodes); }, addEventListener() {}, remove() {} });
  const { canvas } = fakeCanvas();
  canvas.toDataURL = () => 'data:image/png;base64,AAAA';
  const documentRef = {
    createElement: tag => (tag === 'canvas' ? canvas : element(tag)),
    getElementById: () => null,
    body: { append: node => appended.push(node) },
  };
  const result = await shareAiGuessedCard(settled({}), { documentRef, navigatorRef: {} });
  assert.equal(result, 'overlay');
  const overlay = appended[0];
  assert.equal(overlay.attributes.role, 'dialog');
  const [image, hint] = overlay.children;
  assert.equal(image.src, 'data:image/png;base64,AAAA');
  assert.match(image.alt, /Вы и AI угадали: Спартак — Зенит, 2 : 1/);
  assert.match(hint.textContent, /удерживайте картинку/);
  assert.equal(await shareAiGuessedCard(settled({ aiPoint: 0, userPoint: 0, actual: 'draw' }), { documentRef }), 'unavailable');
});

test('the result card offers the image only when somebody guessed', () => {
  const match = { homeName: 'Спартак', awayName: 'Зенит' };
  assert.match(matchPickHtml(settled({}), match, escapeHtml), /data-beat-card>📸 Карточка «Вы и AI угадали»/);
  assert.doesNotMatch(matchPickHtml(settled({ aiPoint: 0, userPoint: 0, actual: 'draw' }), match, escapeHtml), /data-beat-card/);
  const css = fs.readFileSync('public/styles/premium-ui.css', 'utf8');
  assert.match(css, /\.ai-guessed-overlay \{/);
});
