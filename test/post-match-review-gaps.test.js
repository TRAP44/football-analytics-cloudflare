import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createModelEvaluationRuntime } from '../src/model-evaluation-runtime.js';

// Задача 7: пробелы разбора после матча, найденные при проверке.
const BETTING = /(^|[^\p{L}\p{N}])(П1|П2)(?![\p{L}\p{N}])|settlement/iu;

function runtime(score = { home: 1, away: 2 }) {
  return createModelEvaluationRuntime({
    regulationScore: () => score,
    actualOutcomeFromGoals: (h, a) => (h > a ? 'home' : h < a ? 'away' : 'draw'),
    hasSupabase: () => false,
    memory: { modelPredictions: new Map() },
  });
}

const prediction = { fixture_id: 9, status: 'settled', predicted_outcome: 'home', home_prob: 56, draw_prob: 25, away_prob: 19, actual_outcome: 'away' };

test('review names outcomes with team words, never П1/Н/П2 or settlement jargon', () => {
  const review = runtime().buildPostMatchReview({ prediction, fixture: {}, homeName: 'Arsenal', awayName: 'Chelsea' });
  assert.equal(review.available, true);
  assert.equal(review.outcome.predictedLabel, 'Победа Arsenal');
  assert.equal(review.outcome.actualLabel, 'Победа Chelsea');
  assert.equal(review.summary, 'До матча модель выше всего оценивала исход «победа Arsenal» — 56%. Факт: победа Chelsea, счёт 1:2.');
  const draw = runtime({ home: 1, away: 1 }).buildPostMatchReview({ prediction: { ...prediction, predicted_outcome: 'draw', actual_outcome: 'draw' }, fixture: {} });
  assert.equal(draw.outcome.predictedLabel, 'Ничья');
  const pending = runtime().buildPostMatchReview({ prediction: { ...prediction, status: 'pending' }, fixture: {} });
  for (const text of [review.summary, review.outcome.predictedLabel, review.outcome.actualLabel, pending.calibration.note]) {
    assert.doesNotMatch(text, BETTING);
  }
  assert.equal(pending.outcome.actualLabel, 'Победа гостей', 'fallback without team names');
});

test('without a pre-match snapshot the review still shows observed match factors', () => {
  const statistics = { items: [{ key: 'Shots on Goal', home: 7, away: 2 }] };
  const review = runtime().buildPostMatchReview({ prediction: null, fixture: {}, statistics, events: [], homeName: 'Arsenal', awayName: 'Chelsea' });
  assert.equal(review.available, false);
  assert.equal(review.state, 'no_snapshot');
  assert.deepEqual(review.score, { home: 1, away: 2 });
  assert.equal(review.evidence[0].code, 'shots_on_goal');
  assert.match(review.disclaimer, /не доказывают причинность/);
  const unknown = runtime(null).buildPostMatchReview({ prediction: null, fixture: {} });
  assert.deepEqual(unknown.evidence, [], 'no score — no invented factors');
  assert.equal(Object.hasOwn(unknown, 'score'), false);
});

test('a missed penalty is not an early goal; a second yellow counts as a sending-off', () => {
  const rt = runtime();
  const missed = rt.buildPostMatchReview({ prediction, fixture: {}, events: [{ type: 'Goal', detail: 'Missed Penalty', minute: 9 }] });
  assert.ok(!missed.evidence.some(x => x.code === 'early_goal'));
  const scored = rt.buildPostMatchReview({ prediction, fixture: {}, events: [{ type: 'Goal', detail: 'Penalty', minute: 9 }] });
  assert.ok(scored.evidence.some(x => x.code === 'early_goal'));
  const second = rt.buildPostMatchReview({ prediction, fixture: {}, events: [{ type: 'Card', detail: 'Second Yellow card', minute: 60, teamName: 'Chelsea' }] });
  assert.equal(second.evidence[0].code, 'red_card');
});

test('Mini App maps legacy П1/П2 reviews to words and shows evidence without a snapshot', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const pick = name => {
    const start = app.indexOf(`function ${name}(`);
    let depth = 0;
    for (let i = app.indexOf(') {', start) + 2; i < app.length; i += 1) {
      if (app[i] === '{') depth += 1;
      if (app[i] === '}' && --depth === 0) return app.slice(start, i + 1);
    }
    return '';
  };
  const SCENARIO_BETTING_TEXT = new RegExp(app.match(/const SCENARIO_BETTING_TEXT = \/(.+)\/iu;/)[1], 'iu');
  const escapeHtml = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const render = new Function('SCENARIO_BETTING_TEXT', 'escapeHtml', 'publicText',
    `${pick('postMatchOutcomeText')}\n${pick('postMatchEvidenceHtml')}\n${pick('postMatchReviewHtml')}\nreturn postMatchReviewHtml;`)(SCENARIO_BETTING_TEXT, escapeHtml, x => x);
  const match = { home: { name: 'Arsenal' }, away: { name: 'Chelsea' } };
  const legacy = render({
    available: true, headline: 'Главный исход не совпал',
    summary: 'До матча максимальная вероятность была у П1 — 56%. Факт: П2, счёт 1:2.',
    score: { home: 1, away: 2 }, outcome: { predicted: 'home', predictedLabel: 'П1', probability: 56, actual: 'away', actualLabel: 'П2', correct: false },
    calibration: { note: 'Предматчевый снимок сохранён, но settlement ещё не завершён.' },
  }, match);
  assert.doesNotMatch(legacy, BETTING);
  assert.match(legacy, /Победа Arsenal · 56%/);
  assert.match(legacy, /Победа Chelsea · 1:2/);
  assert.match(legacy, /исход «победа Arsenal» — 56%/);
  assert.match(legacy, /🧠 ПОСЛЕ МАТЧА/);
  const unavailable = render({ available: false, headline: 'Нет сохранённого предматчевого снимка', summary: 'Ниже — что видно по статистике.', evidence: [{ icon: '🎯', title: 'Удары в створ', text: 'Arsenal имел перевес.' }], disclaimer: 'Факторы не доказывают причинность.' }, match);
  assert.match(unavailable, /Что видно по матчу/);
  assert.match(unavailable, /Удары в створ/);
  assert.match(unavailable, /не доказывают причинность/);
});

test('bot shows observed factors when there is no snapshot', () => {
  const bot = fs.readFileSync('src/telegram-bot-orchestration-runtime.js', 'utf8');
  const start = bot.indexOf('function botPostMatchReviewText');
  const block = bot.slice(start, bot.indexOf('async function sendBotFixtureSection', start));
  assert.match(block, /if \(review\.available!==true\) \{[\s\S]*?Что видно по матчу/);
});
