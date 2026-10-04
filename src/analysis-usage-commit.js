function finiteCount(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function quotaSnapshot(baseline = {}, usedValue = baseline?.used) {
  const used = finiteCount(usedValue, finiteCount(baseline?.used, 0));
  const limit = Math.max(1, finiteCount(baseline?.limit, 1));
  return {
    plan: String(baseline?.plan || 'FREE'),
    used,
    limit,
    left: Math.max(0, limit - used),
  };
}

export function createAnalysisUsageCommitRuntime({
  commitQuota,
  readQuotaUsage,
  commitPass,
  readPassUsage,
  recordOpsEvent = async () => null,
  bumpTelemetry = () => {},
} = {}) {
  if (typeof commitQuota !== 'function') throw new TypeError('commitQuota is required');
  if (typeof readQuotaUsage !== 'function') throw new TypeError('readQuotaUsage is required');
  if (typeof commitPass !== 'function') throw new TypeError('commitPass is required');
  if (typeof readPassUsage !== 'function') throw new TypeError('readPassUsage is required');

  async function safeEvent(cfg, event) {
    try { await recordOpsEvent(cfg, event); } catch {}
  }

  async function commitAnalysisQuotaAfterSuccess({
    userId,
    baseline,
    cfg,
    context = {},
  } = {}) {
    const usedBefore = finiteCount(baseline?.used, 0);
    const limit = Math.max(1, finiteCount(baseline?.limit, 1));
    const date = String(baseline?.date || '');
    try {
      const result = await commitQuota({ userId, date, limit, cfg });
      const used = finiteCount(result?.used, usedBefore);
      if (result?.allowed) {
        bumpTelemetry('quotaReservations');
        bumpTelemetry('quotaCommits');
        return {
          charged: true,
          reconciled: false,
          uncertain: false,
          reason: String(result?.reason || 'committed'),
          quota: quotaSnapshot(baseline, used),
        };
      }

      bumpTelemetry('quotaCommitSkips');
      await safeEvent(cfg, {
        severity: 'warning',
        source: 'analysis_access',
        eventType: 'quota_commit',
        code: 'ANALYSIS_QUOTA_COMMIT_SKIPPED',
        message: 'Fresh analysis completed, but quota commit was not accepted. Result is returned without an unconfirmed charge.',
        endpoint: '/api/analyze',
        meta: {
          fixtureId: Number(context?.fixtureId || 0) || null,
          reason: String(result?.reason || 'not_allowed').slice(0, 80),
          usedBefore,
          observedUsed: used,
          limit,
        },
      });
      return {
        charged: false,
        reconciled: false,
        uncertain: false,
        reason: String(result?.reason || 'not_allowed'),
        quota: quotaSnapshot(baseline, used),
      };
    } catch (error) {
      let observedUsed = null;
      try {
        const observed = await readQuotaUsage({ userId, date, cfg });
        if (Number.isFinite(Number(observed))) observedUsed = finiteCount(observed, usedBefore);
      } catch {}

      const reconciled = observedUsed !== null && observedUsed >= usedBefore + 1;
      bumpTelemetry('quotaCommitUncertain');
      if (reconciled) {
        bumpTelemetry('quotaReservations');
        bumpTelemetry('quotaCommits');
      }
      await safeEvent(cfg, {
        severity: reconciled ? 'warning' : 'error',
        source: 'analysis_access',
        eventType: 'quota_commit',
        code: reconciled ? 'ANALYSIS_QUOTA_COMMIT_RECONCILED' : 'ANALYSIS_QUOTA_COMMIT_UNCERTAIN',
        message: reconciled
          ? 'Quota commit response was ambiguous, but persisted usage confirms the completed analysis was charged.'
          : 'Quota commit response was ambiguous. The completed analysis is returned so the user is never charged for a failed response.',
        endpoint: '/api/analyze',
        meta: {
          fixtureId: Number(context?.fixtureId || 0) || null,
          usedBefore,
          observedUsed,
          limit,
          errorCode: String(error?.code || '').slice(0, 80),
        },
      });
      return {
        charged: reconciled,
        reconciled,
        uncertain: !reconciled,
        reason: reconciled ? 'commit_reconciled' : 'commit_uncertain',
        quota: quotaSnapshot(baseline, observedUsed ?? usedBefore),
      };
    }
  }

  async function commitPassUsageAfterSuccess({
    userId,
    candidate,
    fixtureId,
    cfg,
    context = {},
  } = {}) {
    const entitlementId = Number(candidate?.id || 0);
    const usageLimit = candidate?.usageLimit == null ? null : finiteCount(candidate.usageLimit, 0);
    const usageBefore = finiteCount(candidate?.usageCount, 0);

    if (!entitlementId || usageLimit == null) {
      return {
        charged: false,
        unlimited: usageLimit == null,
        reconciled: false,
        uncertain: false,
        reason: usageLimit == null ? 'unlimited' : 'invalid_candidate',
      };
    }

    try {
      const result = await commitPass({ userId, entitlementId, fixtureId, cfg });
      if (result?.allowed) {
        bumpTelemetry('passUsageCommits');
        return {
          charged: true,
          reconciled: false,
          uncertain: false,
          reason: String(result?.reason || 'consumed'),
          usageCount: finiteCount(result?.usageCount, usageBefore + 1),
          usageLimit,
        };
      }

      bumpTelemetry('passUsageCommitSkips');
      await safeEvent(cfg, {
        severity: 'warning',
        source: 'analysis_access',
        eventType: 'pass_usage_commit',
        code: 'PASS_USAGE_COMMIT_SKIPPED',
        message: 'Fresh analysis completed, but limited Pass usage commit was not accepted. Result is returned without an unconfirmed charge.',
        endpoint: '/api/analyze',
        meta: {
          fixtureId: Number(context?.fixtureId || fixtureId || 0) || null,
          entitlementId,
          reason: String(result?.reason || 'not_allowed').slice(0, 80),
          usageBefore,
          usageLimit,
        },
      });
      return {
        charged: false,
        reconciled: false,
        uncertain: false,
        reason: String(result?.reason || 'not_allowed'),
        usageCount: usageBefore,
        usageLimit,
      };
    } catch (error) {
      let observedUsage = null;
      try {
        const observed = await readPassUsage({ userId, entitlementId, cfg });
        if (Number.isFinite(Number(observed))) observedUsage = finiteCount(observed, usageBefore);
      } catch {}

      const reconciled = observedUsage !== null && observedUsage >= usageBefore + 1;
      bumpTelemetry('passUsageCommitUncertain');
      if (reconciled) bumpTelemetry('passUsageCommits');
      await safeEvent(cfg, {
        severity: reconciled ? 'warning' : 'error',
        source: 'analysis_access',
        eventType: 'pass_usage_commit',
        code: reconciled ? 'PASS_USAGE_COMMIT_RECONCILED' : 'PASS_USAGE_COMMIT_UNCERTAIN',
        message: reconciled
          ? 'Pass usage commit response was ambiguous, but persisted usage confirms the completed analysis was charged.'
          : 'Pass usage commit response was ambiguous. The completed analysis is returned so a failed response never consumes paid usage.',
        endpoint: '/api/analyze',
        meta: {
          fixtureId: Number(context?.fixtureId || fixtureId || 0) || null,
          entitlementId,
          usageBefore,
          observedUsage,
          usageLimit,
          errorCode: String(error?.code || '').slice(0, 80),
        },
      });
      return {
        charged: reconciled,
        reconciled,
        uncertain: !reconciled,
        reason: reconciled ? 'commit_reconciled' : 'commit_uncertain',
        usageCount: observedUsage ?? usageBefore,
        usageLimit,
      };
    }
  }

  return Object.freeze({
    commitAnalysisQuotaAfterSuccess,
    commitPassUsageAfterSuccess,
  });
}
