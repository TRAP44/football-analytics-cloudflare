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
    if (!reservation?.reserved) {
      return { ok: true, skipped: true, reason: 'not_reserved' };
    }

    const operationId = normalizeOperationId(reservation.operationId);
    const kind = normalizeKind(reservation.kind);
    const action = disposition === 'commit' ? 'commit' : disposition === 'refund' ? 'refund' : '';

    if (!operationId || !action) {
      return { ok: false, pending: false, reason: 'invalid_reservation' };
    }

    if (!hasSupabase(cfg)) {
      return { ok: false, pending: false, persistent: false, reason: 'supabase_not_configured' };
    }

    try {
      const result = await supaRpc(cfg, 'finalize_analysis_usage_reservation', {
        p_operation_id: operationId,
        p_disposition: action,
      }, 4000);

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

  async function reconcileAnalysisUsageReservations(cfg, {
    staleSeconds = 30 * 60,
    limit = 100,
  } = {}) {
    if (!hasSupabase(cfg)) {
      return { ok: true, skipped: true, reason: 'supabase_not_configured', reconciled: 0 };
    }

    try {
      const result = await supaRpc(cfg, 'reconcile_analysis_usage_reservations', {
        p_stale_seconds: Math.max(300, Math.min(Number(staleSeconds || 1800), 86400)),
        p_limit: Math.max(1, Math.min(Number(limit || 100), 500)),
      }, 7000);

      if (result?.ok !== true) {
        const error = new Error(String(result?.reason || 'analysis_usage_reconciliation_not_confirmed'));
        error.code = 'ANALYSIS_USAGE_RECONCILIATION_NOT_CONFIRMED';
        throw error;
      }

      const reconciled = Math.max(0, Number(result?.reconciled || 0));
      const failed = Math.max(0, Number(result?.failed || 0));
      if (reconciled) bumpTelemetry?.('analysisUsageReconciled', reconciled);
      if (failed) bumpTelemetry?.('analysisUsageReconciliationFailures', failed);

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
