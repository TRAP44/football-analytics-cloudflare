import test from 'node:test';
import assert from 'node:assert/strict';
import { createBetaPhase5Runtime } from '../src/beta-phase5-runtime.js';

const CLOSED_BETA_COHORT = 'closed_beta_v1';

function createRuntime(rows = []) {
  return createBetaPhase5Runtime({
    APP_VERSION: 'test',
    CLOSED_BETA_COHORT,
    PHASE5_VALIDATION_COHORT: 'phase5_public_v2',
    RC_NAME: 'test',
    RELEASE_CHANNEL: 'test',
    billingWebhookStatus: async () => ({ ready: true, pendingUpdates: 0 }),
    collectDiagnostics: async () => ({
      supabase: { ok: true, status: 'ok' },
      telegramWebhook: { state: 'healthy' },
    }),
    hasSupabase: () => true,
    isClosedBetaUser: () => true,
    json: value => value,
    providerSnapshot: () => ({}),
    readOpsEventsRange: async () => ({ items: rows, persistent: true }),
    recordOpsEvent: async () => {},
    redactOpsString: value => String(value ?? ''),
  });
}

function sufficientExpansionEvidence(overrides = {}) {
  return {
    metrics: { miniAppLaunch: { events: 7 } },
    journey: { betaUsers: 2, fullCompleted: 2 },
    timings: {
      search: { samples: 3 },
      match: { samples: 3 },
      ai: { samples: 3 },
    },
    coverage: { samples: 10 },
    issues: [],
    ...overrides,
  };
}

function betaSubject(index) {
  return index.toString(16).padStart(32, '0');
}

function clientRow({ subject, code, metadata = {}, createdAt }) {
  return {
    source: 'client',
    event_type: 'client_telemetry',
    code,
    created_at: createdAt || '2026-10-07T00:00:00.000Z',
    metadata: {
      betaCohort: CLOSED_BETA_COHORT,
      betaMembershipVerified: true,
      betaSubject: subject,
      ...metadata,
    },
  };
}

function feedbackRow() {
  return {
    source: 'beta',
    event_type: 'beta_feedback',
    code: 'BETA_FEEDBACK',
    created_at: '2026-10-07T00:00:00.000Z',
    metadata: {
      betaCohort: CLOSED_BETA_COHORT,
      betaMembershipVerified: true,
      category: 'data_sources',
      betaSeverity: 'MINOR',
    },
  };
}

function providerEvidenceRows(userCount) {
  const subjects = Array.from({ length: userCount }, (_, index) => betaSubject(index + 1));
  const rows = subjects.map(subject => clientRow({ subject, code: 'BOOT_OK' }));

  for (let index = 0; index < 10; index += 1) {
    rows.push(clientRow({
      subject: subjects[index % subjects.length],
      code: 'DATA_COVERAGE',
      metadata: {
        matchMode: 'scheduled',
        lineupsAvailable: false,
        injuriesAvailable: false,
        statisticsAvailable: true,
        xgAvailable: true,
        oddsAvailable: true,
      },
    }));
  }

  rows.push(feedbackRow(), feedbackRow());
  return rows;
}

async function betaDashboard(runtime, cfg = {}) {
  return runtime.apiBetaDashboard(
    { url: 'https://example.test/api/beta-dashboard?days=7' },
    {
      adminTelegramIds: [],
      betaTelegramIds: [101, 102],
      betaAccessEnabled: true,
      botToken: 'test-token',
      ...cfg,
    },
  );
}

test('beta expansion stays closed until every verified evidence threshold passes', () => {
  const { betaExpansionDecision } = createRuntime();

  const collecting = betaExpansionDecision();
  assert.equal(collecting.status, 'collecting_verified_beta');
  assert.equal(collecting.expansionAllowed, false);
  assert.equal(collecting.closedBetaLaunchStageComplete, false);
  assert.deepEqual(collecting.requirements, {
    verifiedUsers: { required: 2, actual: 0, pass: false },
    verifiedSessionStarts: { required: 7, actual: 0, pass: false },
    fullJourneys: { required: 2, actual: 0, pass: false },
    searchTimingSamples: { required: 3, actual: 0, pass: false },
    matchTimingSamples: { required: 3, actual: 0, pass: false },
    aiTimingSamples: { required: 3, actual: 0, pass: false },
    coverageSamples: { required: 10, actual: 0, pass: false },
  });

  const ready = betaExpansionDecision(sufficientExpansionEvidence());
  assert.equal(ready.status, 'ready_to_expand');
  assert.equal(ready.expansionAllowed, true);
  assert.equal(ready.closedBetaLaunchStageComplete, true);
  assert.equal(ready.dataCoverageDecision, 'keep_current_provider');
  assert.equal(ready.providerEvidence, 'insufficient_evidence');

  const coverageReview = betaExpansionDecision(sufficientExpansionEvidence({
    providerEvidence: 'review_provider_options',
  }));
  assert.equal(coverageReview.status, 'expand_with_data_limitations');
  assert.equal(coverageReview.expansionAllowed, true);
  assert.equal(coverageReview.dataCoverageDecision, 'review_new_or_paid_provider');
});

test('launch, issue and truncated-sample blockers always force a hold', () => {
  const { betaExpansionDecision } = createRuntime();

  const cases = [
    {
      input: sufficientExpansionEvidence({ launchBlockers: ['provider_quota_unconfirmed'] }),
      blocker: 'provider_quota_unconfirmed',
    },
    {
      input: sufficientExpansionEvidence({ issues: [{ classification: 'BLOCKER' }] }),
      blocker: 'confirmed_blocker',
    },
    {
      input: sufficientExpansionEvidence({ issues: [{ classification: 'MAJOR' }] }),
      blocker: 'confirmed_major',
    },
    {
      input: sufficientExpansionEvidence({ opsSampleLimited: true }),
      blocker: 'beta_ops_sample_truncated',
    },
  ];

  for (const { input, blocker } of cases) {
    const decision = betaExpansionDecision(input);
    assert.equal(decision.status, 'hold');
    assert.equal(decision.expansionAllowed, false);
    assert.equal(decision.closedBetaLaunchStageComplete, false);
    assert.ok(decision.hardBlockers.includes(blocker));
  }
});

test('malformed, non-finite and ambiguous evidence fails closed instead of fabricating readiness', () => {
  const { betaExpansionDecision } = createRuntime();

  const nonFinite = betaExpansionDecision({
    metrics: { miniAppLaunch: { events: Infinity } },
    journey: { betaUsers: Infinity, fullCompleted: Infinity },
    timings: {
      search: { samples: Infinity },
      match: { samples: Infinity },
      ai: { samples: Infinity },
    },
    coverage: { samples: Infinity },
  });
  assert.equal(nonFinite.expansionAllowed, false);
  assert.equal(nonFinite.status, 'collecting_verified_beta');
  assert.equal(nonFinite.requirements.verifiedUsers.actual, 0);
  assert.equal(nonFinite.requirements.coverageSamples.actual, 0);

  const malformed = betaExpansionDecision({
    ...sufficientExpansionEvidence(),
    issues: {},
    launchBlockers: null,
    opsSampleLimited: 'false',
    providerEvidence: 'unknown_provider_state',
  });
  assert.equal(malformed.status, 'hold');
  assert.equal(malformed.expansionAllowed, false);
  assert.deepEqual(
    new Set(malformed.hardBlockers),
    new Set([
      'invalid_launch_blockers',
      'invalid_issue_evidence',
      'invalid_ops_sample_flag',
      'invalid_provider_evidence',
    ]),
  );

  assert.doesNotThrow(() => betaExpansionDecision({
    metrics: null,
    journey: null,
    timings: null,
    coverage: null,
  }));
});

test('provider review requires real user depth plus repeated coverage evidence', async () => {
  const enoughEvidence = await betaDashboard(createRuntime(providerEvidenceRows(5)));
  assert.equal(enoughEvidence.report.providerExpansionEvidence.status, 'review_provider_options');
  assert.equal(enoughEvidence.report.providerExpansionEvidence.betaUsers, 5);
  assert.equal(enoughEvidence.report.providerExpansionEvidence.systematicMissingCategories, 2);
  assert.equal(enoughEvidence.expansionDecision.dataCoverageDecision, 'review_new_or_paid_provider');

  const tooFewUsers = await betaDashboard(createRuntime(providerEvidenceRows(4)));
  assert.equal(tooFewUsers.report.providerExpansionEvidence.status, 'insufficient_evidence');
  assert.equal(tooFewUsers.report.providerExpansionEvidence.betaUsers, 4);
  assert.equal(tooFewUsers.expansionDecision.dataCoverageDecision, 'keep_current_provider');
});

test('beta dashboard exposes aggregate assignment counts without returning Telegram identities', async () => {
  const adminId = 911111111;
  const betaIdA = 922222222;
  const betaIdB = 933333333;
  const payload = await betaDashboard(createRuntime(), {
    adminTelegramIds: [adminId],
    betaTelegramIds: [adminId, betaIdA, betaIdB, betaIdB],
  });

  assert.equal(payload.privacy.aggregatedOnly, true);
  assert.equal(payload.privacy.telegramIdsReturned, false);
  assert.equal(payload.privacy.telegramIdsStoredInBetaTelemetry, false);
  assert.deepEqual(payload.launchReadiness.betaAssignments, {
    required: 2,
    assigned: 2,
    adminOverlap: 1,
    idsReturned: false,
  });

  const serialized = JSON.stringify(payload);
  for (const id of [adminId, betaIdA, betaIdB]) {
    assert.doesNotMatch(serialized, new RegExp(String(id)));
  }
});

test('verified session definition remains tied to deduplicated server-side BOOT_OK telemetry', () => {
  const decision = createRuntime().betaExpansionDecision();
  assert.equal(
    decision.sessionDefinition,
    'One verified beta session start equals an accepted server-side closed_beta_v1 BOOT_OK event after telemetry dedupe.',
  );
});
