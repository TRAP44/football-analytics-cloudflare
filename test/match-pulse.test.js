import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deriveMatchPulse, renderMatchPulse } from '../public/modules/match-pulse.js';

const app = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/styles/public-shell.css', 'utf8');

function payload(overrides = {}) {
  return {
    mode: 'live',
    match: {
      home: { name: 'Arsenal' },
      away: { name: 'Chelsea' },
      score: { home: 1, away: 0 },
      elapsed: 64,
    },
    ...overrides,
  };
}

test('Match Pulse hides completely when Match Center has no usable signal', () => {
  assert.equal(deriveMatchPulse(payload({ mode: 'upcoming' })), null);
  assert.equal(renderMatchPulse(payload({ mode: 'upcoming' })), '');
});

test('partial data renders only metrics that really exist', () => {
  const pulse = deriveMatchPulse(payload({
    livePressure: null,
    statistics: {
      items: [
        { key: 'expected_goals', home: 1.2, away: null },
        { key: 'Ball Possession', home: '58%', away: '42%' },
      ],
    },
    xgQuality: { confidenceBearing: false },
    statisticsQuality: { state: 'partial' },
  }));
  assert.ok(pulse);
  assert.deepEqual(pulse.metrics.map(metric => metric.key), ['xg', 'possession']);
  assert.equal(pulse.metrics[0].value, '1.20 : —');
  assert.ok(pulse.flags.includes('Частичная статистика'));
  assert.ok(pulse.flags.includes('xG частичный'));
  assert.doesNotMatch(renderMatchPulse(payload({
    statistics: { items: [{ key: 'Ball Possession', home: 58, away: 42 }] },
  })), /data-pulse-metric="xg"/);
});

test('live mode uses real livePressure, xG, shots and important events', () => {
  const data = payload({
    livePressure: { home: 64, away: 36, leader: 'home' },
    statistics: {
      items: [
        { key: 'expected_goals', home: 1.62, away: 0.71 },
        { key: 'Shots on Goal', home: 6, away: 2 },
        { key: 'Ball Possession', home: '57%', away: '43%' },
      ],
    },
    events: [
      { time: { elapsed: 18 }, type: 'Goal', side: 'home', player: 'A. Player' },
      { time: { elapsed: 61 }, type: 'Card', detail: 'Red Card', side: 'away', player: 'B. Player' },
    ],
  });
  const pulse = deriveMatchPulse(data);
  assert.equal(pulse.mode, 'live');
  assert.equal(pulse.pressure.home, 64);
  assert.equal(pulse.pressure.away, 36);
  assert.match(pulse.leaderText, /Arsenal/);
  assert.deepEqual(pulse.metrics.map(metric => metric.key), ['xg', 'shots-on', 'possession']);
  assert.equal(pulse.change.label, 'Последнее событие');
  assert.match(pulse.change.text, /61′/);
  assert.match(pulse.change.text, /Красная карточка/);
  assert.equal(pulse.timeline.length, 2);
  const rendered = renderMatchPulse(data);
  assert.match(rendered, /MATCH PULSE/);
  assert.match(rendered, /aria-label="Match Pulse\./);
  assert.match(rendered, /width:64\.00%/);
});

test('finished mode keeps an honest final snapshot without inventing momentum', () => {
  const pulse = deriveMatchPulse(payload({
    mode: 'finished',
    livePressure: null,
    statistics: { items: [{ key: 'Total Shots', home: 14, away: 9 }] },
    events: [{ minute: 88, type: 'Goal', side: 'away' }],
  }));
  assert.equal(pulse.modeLabel, 'ФИНАЛ');
  assert.match(pulse.leaderText, /Итоговая картина/);
  assert.equal(pulse.pressure, null);
  assert.doesNotMatch(renderMatchPulse(payload({
    mode: 'finished',
    statistics: { items: [{ key: 'Total Shots', home: 14, away: 9 }] },
  })), /momentum/i);
});

test('equal pressure is described as balance and extreme values are clamped safely', () => {
  const equal = deriveMatchPulse(payload({ livePressure: { home: 50, away: 50 } }));
  assert.equal(equal.pressure.leader, 'equal');
  assert.equal(equal.leaderText, 'Баланс по индексу давления');

  const extreme = deriveMatchPulse(payload({ livePressure: { home: 140, away: -20 } }));
  assert.equal(extreme.pressure.home, 100);
  assert.equal(extreme.pressure.away, 0);
  assert.equal(extreme.pressure.homeWidth, 100);
  assert.equal(extreme.pressure.awayWidth, 0);
});

test('stale data is explicit and long team names remain escaped and bounded', () => {
  const home = 'Очень длинное название футбольного клуба <Home>';
  const away = 'Ещё более длинное название клуба & Away';
  const data = payload({
    stale: true,
    match: { home: { name: home }, away: { name: away } },
    livePressure: { home: 52, away: 48 },
  });
  const pulse = deriveMatchPulse(data);
  assert.ok(pulse.flags.includes('Сохранённый снимок'));
  const rendered = renderMatchPulse(data);
  assert.match(rendered, /is-stale/);
  assert.match(rendered, /&lt;Home&gt;/);
  assert.match(rendered, /&amp; Away/);
  assert.match(css, /\.match-pulse-team\{[\s\S]*?min-width:0[\s\S]*?overflow-wrap:anywhere/);
});

test('odds movement and Smart Insights are fallbacks, never fabricated history', () => {
  const market = deriveMatchPulse(payload({
    oddsMovement: { probabilityChange: { home: 2.4, draw: -0.6, away: -1.8 } },
  }));
  assert.equal(market.change.label, 'Рынок');
  assert.equal(market.change.text, 'Arsenal: +2.4 п.п.');

  const insight = deriveMatchPulse(payload({
    smartInsights: { available: true, headline: 'Хозяева чаще доходят до опасных зон', insights: [] },
  }));
  assert.equal(insight.change.label, 'Инсайт');
  assert.match(insight.change.text, /опасных зон/);

  const source = fs.readFileSync('public/modules/match-pulse.js', 'utf8');
  assert.doesNotMatch(source, /last\s*10|последние 10 минут|fake|synthetic momentum/i);
});

test('Match Pulse integration is directly below scoreboard and does not create a new tab', () => {
  const start = app.indexOf('function renderMatchCenter');
  const end = app.indexOf('async function openMatchCenter', start);
  const center = app.slice(start, end);
  assert.match(app, /import\('\.\/modules\/match-pulse\.js'\)/);
  const pulseRender = center.indexOf('matchCenterExtras?.renderMatchPulse?.(d)');
  assert.ok(center.indexOf('center-scoreboard') < pulseRender);
  assert.ok(pulseRender < center.indexOf('match-center-primary'));
  assert.equal((center.match(/data-center-tab="pulse"/g) || []).length, 0);
  assert.doesNotMatch(center, /livePressureHtml\(/);
});

test('mobile rules cover 320 360 375 390 430 without horizontal Match Pulse scroll', () => {
  for (const width of [320, 360, 375, 390, 430]) {
    assert.match(css, new RegExp('@media\\(max-width:' + width + 'px\\)'));
  }
  assert.match(css, /\.match-pulse\{[\s\S]*?min-width:0[\s\S]*?overflow:hidden/);
  assert.match(css, /\.match-pulse-metrics\{[\s\S]*?minmax\(0,1fr\)/);
  assert.match(css, /\.match-pulse-timeline\{[\s\S]*?minmax\(0,1fr\)/);
  assert.doesNotMatch(css.slice(css.indexOf('/* Match Pulse — Issue #286 */')), /overflow-x\s*:\s*(auto|scroll)/);
});

test('Match Pulse keeps navigation tabs All Insights and onboarding contracts intact', () => {
  assert.match(html, /id="navMatches"[\s\S]*id="navMyTeams"[\s\S]*id="navHistory"[\s\S]*id="navProfile"/);
  assert.match(app, /class="center-tabs"/);
  assert.match(app, /data-center-tab="summary"/);
  assert.match(app, /smart-open-insights/);
  assert.match(app, /details\.open = true/);
  assert.match(html, /id="firstRunGuide"/);
  assert.match(html, /id="firstRunGuideSearch"/);
  assert.match(html, /id="firstRunGuideFavorite"/);
});
