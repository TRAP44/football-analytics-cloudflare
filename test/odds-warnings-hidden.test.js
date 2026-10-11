import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createProviderDataRuntime } from '../src/provider-data-runtime.js';

const MARKET = /коэффициент|1[XХ]2|рын(ок|к|оч)/iu;

test('reliability warnings never mention odds or market signals', () => {
  const service = createProviderDataRuntime({ isFootballRateLimitError: () => false });
  const r = service.providerDataReliabilitySummary({
    odds: { state: 'available', available: true, observed: true, stale: true, confidenceBearing: false },
    liveOdds: { state: 'available', available: true, observed: true, provenanceState: 'unknown' },
    predictions: { state: 'available', available: true, observed: true, stale: true },
  }, { minutesToKickoff: 30 });
  assert.ok(r.warnings.length > 0, 'non-market warnings are still reported');
  assert.ok(r.warnings.some(x => x.includes('Процентный прогноз')));
  for (const warning of r.warnings) assert.doesNotMatch(warning, MARKET);
  // Рыночные блоки по-прежнему учитываются в метаданных и не повышают доверие.
  assert.ok(r.features.odds);
  assert.equal(r.available, 0);
});

test('analysis filters market wording before it reaches skipped and risks', () => {
  const analysis = fs.readFileSync('src/analysis-runtime.js', 'utf8');
  assert.match(analysis, /\.filter\(value=>value && !isBettingText\(value\)\);\s*skipped\.push\(\.\.\.providerReliability\.warnings\)/);
});

test('cached analyses hide market wording in skipped list and glance', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(app, /function neutralTextList\(items\)/);
  assert.match(app, /neutralTextList\(d\.dataPolicy\?\.skipped\)/);
  assert.doesNotMatch(app, /d\.dataPolicy\.skipped\.map/);
  assert.match(app, /const risks = neutralTextList\(d\.risks\)/);
  assert.match(app, /const factors = neutralTextList\(d\.insights\)/);
  const start = app.indexOf('function neutralTextList');
  const body = app.slice(start, app.indexOf('\n}', start) + 2);
  const SCENARIO_BETTING_TEXT = new RegExp(app.match(/const SCENARIO_BETTING_TEXT = \/(.+)\/iu;/)[1], 'iu');
  const neutralTextList = new Function('SCENARIO_BETTING_TEXT', 'publicText', `${body}; return neutralTextList;`)(SCENARIO_BETTING_TEXT, x => x);
  assert.deepEqual(neutralTextList([
    'Линия 1X2 не подтверждена свежим источником; рыночный сигнал исключён из расчёта.',
    'Live-коэффициенты: данные устарели и исключены из доверенных сигналов.',
    'Очные встречи: данные устарели и исключены из доверенных сигналов.',
    '',
    null,
  ]), ['Очные встречи: данные устарели и исключены из доверенных сигналов.']);
  assert.deepEqual(neutralTextList(undefined), []);
});
