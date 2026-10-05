const LIFECYCLE_HEADER = 'durable-v1';

function normalizeOperationId(value) {
  const id = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : '';
}

function normalizeKind(value) {
  const kind = String(value || '').trim().toLowerCase();
  return kind === 'pass' ? 'pass' : kind === 'quota' ? 'quota' : 'unknown';
}

function compensationCode(disposition) {
  return disposition === 'commit'
    ? 'ANALYSIS_USAGE_COMMIT_PENDING'
    : 'ANALYSIS_USAGE_REFUND_PENDING';
}

function lifecycleHeaders(operationId, action) {
  return {
    'x-analysis-usage-lifecycle': LIFECYCLE_HEADER,
    'x-analysis-operation-id': operationId,
    'x-analysis-usage-action': action,
  };
}

export function durableAnalysisUsageHeaders(operationId) {
  const id = normalizeOperationId(operationId);
  if (!id) throw new TypeError('durable analysis usage requires a UUID operation id');
  return {
    'x-analysis-usage-lifecycle': LIFECYCLE_HEADER,
    'x-analysis-operation-id': id,
  };
}

export function createAnalysisUsageCompensationRuntime({
  hasSupabase,
  supaRpc,
  recordOpsEvent,
  bumpTelemetry,
  redactOpsString = (value, max = 240) => String(value ?? '').slice(0, max),
} = {}) {
  if (typeof hasSupabase !== 'function' || typeof supaRpc !== 'function') {
    throw new TypeError('createAnalysisUsageCompensationRuntime requires Supabase dependencies');
  }

  async function finalizeAnalysisUsageReservation({
    reservation,
    disposition,
    cfg,
    userId,
  } = {}) {
    if (!reservation?.reserved || reservation?.durable !== true) {
      return { ok: true, skipped: true, reason: 'legacy_or_not_reserved' };
    }

    const operationId = normalizeOperationId(reservation.operationId);
    const kind = normalizeKind(reservation.kind);
    const action = disposition === 'commit' ? 'commit' : disposition === 'refund' ? 'refund' : '';

    if (!operationId || !action || kind === 'unknown') {
      return { ok: false, pending: false, reason: 'invalid_reservation' };
    }

    if (!hasSupabase(cfg)) {
      return { ok: false, pending: false, persistent: false, reason: 'supabase_not_configured' };
    }

    try {
      let result;
      if (kind === 'quota') {
        result = await supaRpc(cfg, 'refund_analysis_quota', {
          p_telegram_id: Number(userId || reservation.userId),
          p_usage_date: reservation.date,
        }, 4000, lifecycleHeaders(operationId, action));
      } else {
        result = await supaRpc(cfg, 'refund_pass_entitlement_usage', {
          p_telegram_id: Number(userId || reservation.userId),
          p_entitlement_id: Number(reservation.entitlementId),
        }, 4000, lifecycleHeaders(operationId, action));
      }

      const expectedStatus = action === 'commit' ? 'committed' : 'refunded';
      if (result?.ok !== true || String(result?.status || '') !== expectedStatus) {
        const error = new Error(String(result?.reason || 'analysis_usage_finalization_not_confirmed'));
        error.code = 'ANALYSIS_USAGE_FINALIZATION_NOT_CONFIRMED';
        throw error;
      }

      if (action === 'commit') {
        bumpTelemetry?.('analysisUsageCommits');
      } else {
        bumpTelemetry?.('analysisUsageRefunds');
        if (kind === 'quota') bumpTelemetry?.('quotaRefunds');
        if (kind === 'pass') bumpTelemetry?.('passUsageRefunds');
      }

      return {
        ok: true,
        pending: false,
        persistent: true,
        duplicate: Boolean(result?.duplicate),
        status: expectedStatus,
        operationId,
        kind,
      };
    } catch (error) {
      bumpTelemetry?.('analysisUsageCompensationFailures');
      if (action === 'commit') bumpTelemetry?.('analysisUsageCommitFailures');
      if (action === 'refund' && kind === 'quota') bumpTelemetry?.('quotaRefundFailures');
      if (action === 'refund' && kind === 'pass') bumpTelemetry?.('passUsageRefundFailures');

      await Promise.resolve(recordOpsEvent?.(cfg, {
        severity: 'error',
        source: 'quota',
        eventType: 'analysis_usage_compensation',
        code: compensationCode(action),
        message: action === 'commit'
          ? 'Analysis usage completion could not be persisted; the durable reservation remains pending for reconciliation.'
          : 'Failed analysis usage could not be refunded immediately; the durable reservation remains pending for reconciliation.',
        meta: {
          operationId,
          kind,
          telegramId: Number(userId || reservation.userId || 0) || null,
          usageDate: reservation.date || null,
          entitlementId: Number(reservation.entitlementId || 0) || null,
          error: redactOpsString(error?.message || error, 180),
        },
      })).catch(() => null);

      return {
        ok: false,
        pending: true,
        persistent: true,
        operationId,
        kind,
        reason: redactOpsString(error?.message || error, 180),
      };
    }
  }

  async function reconcileAnalysisUsageReservations(cfg) {
    if (!hasSupabase(cfg)) {
      return { ok: true, skipped: true, reason: 'supabase_not_configured', reconciled: 0 };
    }

    try {
      const operationId = '00000000-0000-4000-8000-000000000000';
      const result = await supaRpc(cfg, 'refund_analysis_quota', {
        p_telegram_id: 0,
        p_usage_date: new Date().toISOString().slice(0, 10),
      }, 7000, lifecycleHeaders(operationId, 'reconcile'));

      if (result?.reconciliation !== true) {
        const error = new Error(String(result?.reason || 'analysis_usage_reconciliation_not_confirmed'));
        error.code = 'ANALYSIS_USAGE_RECONCILIATION_NOT_CONFIRMED';
        throw error;
      }

      const reconciled = Math.max(0, Number(result?.reconciled || 0));
      const failed = Math.max(0, Number(result?.failed || 0));
      if (reconciled) bumpTelemetry?.('analysisUsageReconciled', reconciled);
      if (failed) {
        bumpTelemetry?.('analysisUsageReconciliationFailures', failed);
        await Promise.resolve(recordOpsEvent?.(cfg, {
          severity: 'error',
          source: 'quota',
          eventType: 'analysis_usage_reconciliation',
          code: 'ANALYSIS_USAGE_RECONCILIATION_PARTIAL',
          message: 'Some stale analysis usage reservations could not be reconciled and remain pending.',
          meta: {
            reconciled,
            failed,
            pending: Math.max(0, Number(result?.pending || 0)),
          },
        })).catch(() => null);
      }

      return {
        ok: failed === 0,
        degraded: failed > 0,
        reconciled,
        failed,
        pending: Math.max(0, Number(result?.pending || 0)),
        cleaned: Math.max(0, Number(result?.cleaned || 0)),
      };
    } catch (error) {
      bumpTelemetry?.('analysisUsageReconciliationFailures');
      await Promise.resolve(recordOpsEvent?.(cfg, {
        severity: 'error',
        source: 'quota',
        eventType: 'analysis_usage_reconciliation',
        code: 'ANALYSIS_USAGE_RECONCILIATION_FAILED',
        message: 'Durable analysis usage reservations could not be reconciled.',
        meta: {
          error: redactOpsString(error?.message || error, 180),
        },
      })).catch(() => null);
      return {
        ok: false,
        degraded: true,
        reconciled: 0,
        failed: 1,
        pending: 0,
        cleaned: 0,
        reason: redactOpsString(error?.message || error, 180),
      };
    }
  }

  return Object.freeze({
    finalizeAnalysisUsageReservation,
    reconcileAnalysisUsageReservations,
  });
}
