import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAnalysisLifecycleRuntime } from '../src/analysis-lifecycle-runtime.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createLifecycle({
  hasSupabase = () => false,
  memory = { history: new Map() },
  supaSelectOne = async () => null,
} = {}) {
  return createAnalysisLifecycleRuntime({
    hasSupabase,
    isFinishedStatus: status => ['FT', 'AET', 'PEN'].includes(String(status || '').toUpperCase()),
    isLiveStatus: status => ['1H', 'HT', '2H', 'ET', 'P'].includes(String(status || '').toUpperCase()),
    memory,
    supaSelectOne,
  });
}

const lifecycle = createLifecycle();
const analysisRuntime = readRepoFile('src/analysis-runtime.js');
const userDataApi = readRepoFile('src/user-data-api-runtime.js');
const app = readRepoFile('public/app.js');
const analysisController = readRepoFile('public/modules/analysis-controller.js');
const css = readRepoFile('public/styles.css');
const appCapabilities = readRepoFile('src/app-capabilities.js');
const adminOperationalApi = readRepoFile('src/admin-operational-api.js');
const operationalOrchestration = readRepoFile('src/operational-orchestration-runtime.js');
const worker = readRepoFile('src/worker.js');

const NOW = Date.parse('2026-09-23T18:00:00Z');

test('RC59 computes dynamic freshness from age, kickoff phase and trusted lineups', () => {
  const stale = lifecycle.analysisFreshness({
    generatedAt: '2026-09-23T17:52:00Z',
    match: { date: '2026-09-23T18:30:00Z', status: 'NS' },
    market: { odds: { home: 2, draw: 3, away: 4 } },
    lineupImpact: { homeConfirmed: false, awayConfirmed: false },
  }, NOW);
  const fresh = lifecycle.analysisFreshness({
    generatedAt: '2026-09-23T17:58:00Z',
    match: { date: '2026-09-23T18:30:00Z', status: 'NS' },
    market: { odds: { home: 2, draw: 3, away: 4 } },
    lineupImpact: { homeConfirmed: false, awayConfirmed: false },
  }, NOW);
  const far = lifecycle.analysisFreshness({
    generatedAt: '2026-09-23T17:30:00Z',
    match: { date: '2026-09-24T02:00:00Z', status: 'NS' },
    lineupImpact: { homeConfirmed: false, awayConfirmed: false },
  }, NOW);

  assert.equal(stale.maxAgeMinutes, 5);
  assert.equal(stale.needsRecheck, true);
  assert.equal(stale.reasonCode, 'lineups_window');

  assert.equal(fresh.maxAgeMinutes, 5);
  assert.equal(fresh.needsRecheck, false);
  assert.equal(fresh.reasonCode, 'fresh');

  assert.equal(far.maxAgeMinutes, 45);
  assert.equal(far.needsRecheck, false);

  const unconfirmedAt80 = lifecycle.analysisFreshness({
    generatedAt: '2026-09-23T17:54:00Z',
    match: { date: '2026-09-23T19:20:00Z', status: 'NS' },
    lineupImpact: { homeConfirmed: false, awayConfirmed: false },
  }, NOW);
  const confirmedAt80 = lifecycle.analysisFreshness({
    generatedAt: '2026-09-23T17:54:00Z',
    match: { date: '2026-09-23T19:20:00Z', status: 'NS' },
    lineupImpact: { homeConfirmed: true, awayConfirmed: true },
  }, NOW);

  assert.equal(unconfirmedAt80.maxAgeMinutes, 5);
  assert.equal(unconfirmedAt80.needsRecheck, true);
  assert.equal(confirmedAt80.maxAgeMinutes, 10);
  assert.equal(confirmedAt80.needsRecheck, false);
});

test('RC59 freshness distinguishes market window, invalid timestamps and started matches fail-closed', () => {
  const marketWindow = lifecycle.analysisFreshness({
    generatedAt: '2026-09-23T17:54:00Z',
    match: { date: '2026-09-23T18:20:00Z', status: 'NS' },
    market: { probabilities: { home: 50, draw: 30, away: 20 } },
    lineupImpact: { homeConfirmed: true, awayConfirmed: true },
  }, NOW);
  assert.equal(marketWindow.needsRecheck, true);
  assert.equal(marketWindow.reasonCode, 'market_window');

  const futureSnapshot = lifecycle.analysisFreshness({
    generatedAt: '2026-09-24T17:58:00Z',
    match: { date: '2026-09-24T20:00:00Z', status: 'NS' },
  }, NOW);
  assert.equal(futureSnapshot.generatedAtValid, false);
  assert.equal(futureSnapshot.needsRecheck, true);
  assert.equal(futureSnapshot.reasonCode, 'generated_time_invalid');

  const invalidKickoff = lifecycle.analysisFreshness({
    generatedAt: '2026-09-23T17:58:00Z',
    match: { date: 'invalid', status: 'NS' },
  }, NOW);
  assert.equal(invalidKickoff.kickoffAtValid, false);
  assert.equal(invalidKickoff.needsRecheck, true);
  assert.equal(invalidKickoff.reasonCode, 'kickoff_time_invalid');

  const started = lifecycle.analysisFreshness({
    generatedAt: '2026-09-23T17:40:00Z',
    match: { date: '2026-09-23T17:55:00Z', status: '1H' },
  }, NOW);
  assert.equal(started.state, 'started');
  assert.equal(started.needsRecheck, false);
  assert.equal(started.reasonCode, 'match_started');
});

test('RC59 deterministic freshness drill stays green', () => {
  const result = lifecycle.analysisFreshnessDrill();

  assert.equal(result.pass, true);
  assert.ok(result.cases >= 4);
});

test('free freshness recheck eligibility remains scoped to the user analysis history', async () => {
  const memory = {
    history: new Map([
      [42, [{ fixture_id: 77 }, { fixture_id: 88 }]],
      [99, [{ fixture_id: 123 }]],
    ]),
  };
  const memoryLifecycle = createLifecycle({ memory });

  assert.equal(await memoryLifecycle.userHasAnalyzedFixture(42, 77, {}), true);
  assert.equal(await memoryLifecycle.userHasAnalyzedFixture(42, 123, {}), false);
  assert.equal(await memoryLifecycle.userHasAnalyzedFixture(99, 77, {}), false);
  assert.equal(await memoryLifecycle.userHasAnalyzedFixture(0, 77, {}), false);

  const failingSupabase = createLifecycle({
    hasSupabase: () => true,
    memory,
    supaSelectOne: async () => {
      throw new Error('database unavailable');
    },
  });
  assert.equal(await failingSupabase.userHasAnalyzedFixture(42, 77, {}), false);
});

test('RC59 recheck delta detects material changes and rejects cross-fixture comparisons', () => {
  const previous = {
    match: { fixtureId: 7 },
    probabilities: { home: 44, draw: 29, away: 27 },
    market: { probabilities: { home: 43, draw: 30, away: 27 } },
    lineupImpact: { homeConfirmed: false, awayConfirmed: false },
    absences: { home: [], away: [] },
    aiInstructor: {
      betSignal: { code: 'skip', label: 'Пропустить ставку' },
      confidenceScore: 55,
    },
  };
  const next = {
    match: { fixtureId: 7 },
    probabilities: { home: 53, draw: 26, away: 21 },
    market: { probabilities: { home: 49, draw: 28, away: 23 } },
    lineupImpact: { homeConfirmed: true, awayConfirmed: true },
    absences: { home: [{ name: 'Player' }], away: [] },
    aiInstructor: {
      betSignal: { code: 'home', label: 'П1' },
      confidenceScore: 69,
    },
  };

  const delta = lifecycle.analysisRecheckDelta(previous, next);
  assert.equal(delta.available, true);
  assert.equal(delta.material, true);
  for (const code of ['signal', 'probability', 'confidence', 'lineups', 'absences', 'market']) {
    assert.ok(delta.codes.includes(code), code);
  }

  const mismatch = lifecycle.analysisRecheckDelta(
    previous,
    { ...next, match: { fixtureId: 8 } },
  );
  assert.equal(mismatch.available, false);
  assert.equal(mismatch.material, false);
  assert.equal(mismatch.reasonCode, 'fixture_mismatch');
});

test('server only bypasses cached analysis for a real freshness or news-impact recheck', () => {
  assert.match(
    analysisRuntime,
    /const recheckRequested=strictBoolean\(body\.recheck\)/,
  );
  assert.match(
    analysisRuntime,
    /const needsFreshnessRecheck=Boolean\(recheckRequested && staleBefore && previousFreshness\?\.needsRecheck\)/,
  );
  assert.match(
    analysisRuntime,
    /const shouldPerformRecheck=Boolean\(needsFreshnessRecheck \|\| newsImpactEligible\)/,
  );
  assert.match(
    analysisRuntime,
    /if \(needsFreshnessRecheck\) \{\s*try \{ freeRecheck=await userHasAnalyzedFixture\(userId,fixtureId,cfg\)/,
  );
  assert.match(
    analysisRuntime,
    /if \(cached && !needsFreshnessRecheck\)[\s\S]*?if \(!newsImpactEligible\)[\s\S]*?safeAnalysisResponsePayload\(cached,/,
  );
});

test('free freshness rechecks bypass quota only after server-side history verification', () => {
  assert.match(
    analysisRuntime,
    /if \(!freeRecheck && !passCandidate && quotaBefore\.left\s*<=\s*0\)/,
  );
  assert.match(
    analysisRuntime,
    /if \(!freeRecheck && passCandidate\)[\s\S]*?reserveEntitlementUsage/,
  );
  assert.match(
    analysisRuntime,
    /if \(!freeRecheck && !passAccess\) \{\s*usageReservation=objectValue\(await reserveAnalysisQuota\(userId,cfg\)\)/,
  );
  assert.match(
    analysisRuntime,
    /News-impact flags\/timestamps arrive from the client[\s\S]*?must never mint free provider work/,
  );
});

test('adaptive analysis cache TTL tightens toward kickoff', () => {
  for (const [condition, ttl] of [
    ['minutesToKickoff <= 15', 3],
    ['minutesToKickoff <= 45', 5],
    ['minutesToKickoff <= 120', 10],
    ['minutesToKickoff <= 360', 20],
    ['minutesToKickoff > 360', 45],
  ]) {
    const escaped = condition
      .replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')
      .replace(/ /g, '\\s*');
    assert.match(
      analysisRuntime,
      new RegExp(`${escaped}\\) ttl\\s*=\\s*${ttl}`),
      `${condition} -> ${ttl}`,
    );
  }
  assert.match(analysisRuntime, /if \(safePredicate\(isFinishedStatus,status\)\) ttl=720/);
});

test('Mini App exposes recheck state and requests conditional server rechecks by default', () => {
  assert.match(app, /function analysisFreshnessHtml\(/);
  assert.match(app, /Перепроверить AI сейчас/);
  assert.match(app, /analysisRecheckBtn/);
  assert.match(css, /\.analysis-freshness\.recheck/);
  assert.match(analysisController, /recheck:safeRead\(source,'recheck'\)!==false/);
});

test('history stays read-only while preserving current freshness metadata', () => {
  assert.match(
    userDataApi,
    /analysisResponsePayload\(payload,\{cached:true,stale:!fresh,historyReadOnly:true,recheck:\{requested:false,performed:false,free:false,reasonCode:freshnessReason\}/,
  );
  assert.match(analysisRuntime, /eventName:'analysis_recheck'/);
});

test('current capability and release contracts expose a verified AI freshness guard', () => {
  for (const flag of [
    'aiFreshnessGuard',
    'preKickoffRecheck',
    'preKickoffChangeDetection',
    'analysisDeltaSummary',
  ]) {
    assert.match(appCapabilities, new RegExp(`${flag}:true`), flag);
  }

  assert.match(
    adminOperationalApi,
    /const analysisFreshnessSelfTest = typeof analysisFreshnessDrill === 'function'[\s\S]*?analysisFreshnessDrill\(\)/,
  );
  assert.match(
    adminOperationalApi,
    /releaseCheck\('ai_analysis_freshness_selftest',[\s\S]*?analysisFreshnessSelfTest\.pass \? 'pass' : 'fail'[\s\S]*?true\)/,
  );
  assert.match(
    operationalOrchestration,
    /analysisFreshnessDrill,[\s\S]*?createAdminOperationalApi\(\{[\s\S]*?analysisFreshnessDrill,/,
  );
  assert.match(
    worker,
    /createOperationalOrchestrationRuntime\(\{[\s\S]*?analysisFreshnessDrill,[\s\S]*?analysisQualityGateSelfTest,/,
  );
});
