import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildAnalysisAccessUsage, analysisAccessUsageHtml } from '../public/modules/analysis-access.js';

function entitlement(overrides = {}) {
  return {
    source:'free',
    plan:'FREE',
    effectiveTier:'FREE',
    passes:{ active:[] },
    decisions:[],
    ...overrides,
  };
}

test('analysis access label identifies FREE quota instead of implying Pass access', () => {
  const usage = buildAnalysisAccessUsage({
    analysis:{ quota:{ plan:'FREE', used:1, limit:3, left:2 } },
    entitlementBefore:{ entitlement:entitlement() },
    profile:{},
    fixtureId:100,
  });
  assert.equal(usage.kind, 'quota');
  assert.equal(usage.label, 'Использовано: FREE · 1/3 сегодня');
  assert.match(usage.detail, /Pass.*не использовался/);
});

test('Match Pass is explicitly scoped to the selected fixture', () => {
  const row = { id:11, type:'MATCH_PASS', fixtureId:777, usageLimit:null, usageCount:0 };
  const usage = buildAnalysisAccessUsage({
    analysis:{ quota:{ plan:'FREE', used:3, limit:3, left:0 } },
    entitlementBefore:{ entitlement:entitlement({ source:'pass', effectiveTier:'PASS', passes:{ active:[row] } }) },
    entitlementAfter:{ entitlement:entitlement({ source:'pass', effectiveTier:'PASS', passes:{ active:[row] } }) },
    fixtureId:777,
  });
  assert.equal(usage.passType, 'MATCH_PASS');
  assert.equal(usage.label, 'Использовано: Match Pass · только этот матч');
  assert.match(usage.detail, /Другие матчи/);
});

test('Day Pass explains that all supported matches are included', () => {
  const row = { id:12, type:'DAY_PASS', fixtureId:0, usageLimit:null, usageCount:0 };
  const usage = buildAnalysisAccessUsage({
    analysis:{ quota:{ plan:'FREE', used:3, limit:3, left:0 } },
    entitlementBefore:{ entitlement:entitlement({ source:'pass', passes:{ active:[row] } }) },
    entitlementAfter:{ entitlement:entitlement({ source:'pass', passes:{ active:[row] } }) },
    fixtureId:888,
  });
  assert.equal(usage.label, 'Использовано: Day Pass · все матчи');
});

test('Weekend Pass reports server usage progress and remaining analyses including 6 of 6', () => {
  const row = { id:13, type:'WEEKEND_PASS', fixtureId:0, usageLimit:6, usageCount:5 };
  const usage = buildAnalysisAccessUsage({
    analysis:{ quota:{ plan:'FREE', used:3, limit:3, left:0 } },
    entitlementBefore:{ entitlement:entitlement({ source:'pass', passes:{ active:[row] } }) },
    entitlementAfter:{ entitlement:entitlement({
      source:'free',
      passes:{ active:[] },
      decisions:[{ id:13, type:'WEEKEND_PASS', usageLimit:6, usageCount:6, active:false, reason:'usage_exhausted' }],
    }) },
    fixtureId:999,
  });
  assert.equal(usage.label, 'Использовано: Weekend Pass · 6/6 AI-анализов');
  assert.equal(usage.detail, 'Осталось анализов: 0.');
});

test('unlimited Pass is preferred before limited Weekend when backend would preserve Weekend quota', () => {
  const weekend = { id:13, type:'WEEKEND_PASS', fixtureId:0, usageLimit:6, usageCount:2 };
  const day = { id:14, type:'DAY_PASS', fixtureId:0, usageLimit:null, usageCount:0 };
  const usage = buildAnalysisAccessUsage({
    analysis:{ quota:{ plan:'FREE', used:3, limit:3, left:0 } },
    entitlementBefore:{ entitlement:entitlement({ source:'pass', passes:{ active:[weekend, day] } }) },
    entitlementAfter:{ entitlement:entitlement({ source:'pass', passes:{ active:[weekend, day] } }) },
    fixtureId:321,
  });
  assert.equal(usage.passType, 'DAY_PASS');
});

test('free recheck is clearly marked as no-consumption before Pass inference', () => {
  const usage = buildAnalysisAccessUsage({
    analysis:{ recheck:{ free:true }, quota:{ plan:'FREE', used:2, limit:3, left:1 } },
    entitlementBefore:{ entitlement:entitlement({
      source:'pass',
      passes:{ active:[{ id:13, type:'WEEKEND_PASS', usageLimit:6, usageCount:1 }] },
    }) },
    fixtureId:123,
  });
  assert.equal(usage.kind, 'free_recheck');
  assert.match(usage.label, /Без списания/);
});

test('analysis access UI is rendered and analyze flow snapshots entitlement around the request', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const analysisController = fs.readFileSync('public/modules/analysis-controller.js', 'utf8');
  assert.match(app, /analysis-access\.js/);
  assert.match(analysisController, /loadAnalysisAccessSnapshot\(fixtureId\)/);
  assert.match(analysisController, /const entitlementBefore = await loadAnalysisAccessSnapshot\(fixtureId\)/);
  assert.match(analysisController, /entitlementBefore\?\.entitlement\?\.source === 'pass'/);
  assert.match(analysisController, /data\.accessUsage = buildAccessUsage/);
  assert.match(app, /analysisAccessUsageHtml\(d\.accessUsage, escapeHtml\)/);

  const html = analysisAccessUsageHtml({ label:'Использовано: FREE · 1/3 сегодня', detail:'Pass не использовался.' }, x => x);
  assert.match(html, /Использовано: FREE/);
  assert.match(html, /Pass не использовался/);
});

test('Profile Pass copy makes Match scope and Weekend remaining count explicit', () => {
  const billing = fs.readFileSync('public/modules/billing.js', 'utf8');
  assert.match(billing, /Активен только для выбранного матча/);
  assert.match(billing, /Все поддерживаемые матчи/);
  assert.match(billing, /использовано ' \+ used \+ '\/' \+ limit/);
  assert.match(billing, /осталось ' \+ Math\.max\(0, limit - used\)/);
  assert.match(billing, /только матч №/);
});
