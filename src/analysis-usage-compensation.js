const LIFECYCLE_HEADER = 'durable-v1';

function safeScalarText(value, max = 240) {
  if (!['string','number','bigint'].includes(typeof value)) return '';
  try {
    return String(value)
      .normalize('NFKC')
      .replace(/[\u0000-\u001F\u007F]/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .slice(0,max);
  } catch {
    return '';
  }
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function integerValue(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^-?\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function normalizeOperationId(value) {
  const id=safeScalarText(value,80).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)
    ? id
    : '';
}

function normalizeKind(value) {
  const kind=safeScalarText(value,20).toLowerCase();
  return kind==='pass' ? 'pass' : kind==='quota' ? 'quota' : 'unknown';
}

function positiveSafeInteger(value) {
  const number=integerValue(value);
  return number !== null && number>0 ? number : 0;
}

function usageDate(value) {
  const raw=safeScalarText(value,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const parsed=Date.parse(`${raw}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0,10)===raw
    ? raw
    : '';
}

function boundedNonNegativeInteger(value, max = Number.MAX_SAFE_INTEGER) {
  const number=integerValue(value);
  return number !== null && number>=0 && number<=max ? number : null;
}

function compensationCode(disposition) {
  return disposition==='commit'
    ? 'ANALYSIS_USAGE_COMMIT_PENDING'
    : 'ANALYSIS_USAGE_REFUND_PENDING';
}

function lifecycleHeaders(operationId, action) {
  return {
    'x-analysis-usage-lifecycle':LIFECYCLE_HEADER,
    'x-analysis-operation-id':operationId,
    'x-analysis-usage-action':action,
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

  function supabaseConfigured(cfg) {
    try { return hasSupabase(cfg) === true; }
    catch { return false; }
  }

  function safeTelemetry(key, amount = 1) {
    try {
      if (typeof bumpTelemetry === 'function') bumpTelemetry(key, amount);
    } catch {}
  }

  function safeErrorText(error, max = 180) {
    let raw=error;
    try {
      if (error && typeof error === 'object' && 'message' in error) raw=error.message;
    } catch {}

    if (typeof redactOpsString === 'function') {
      try {
        const redacted=safeScalarText(redactOpsString(raw,max),max);
        if (redacted) return redacted;
      } catch {}
    }
    return safeScalarText(raw,max) || 'unknown_error';
  }

  async function safeRecordOpsEvent(cfg, event) {
    if (typeof recordOpsEvent !== 'function') return;
    try { await recordOpsEvent(cfg,event); } catch {}
  }

  async function finalizeAnalysisUsageReservation({
    reservation,
    disposition,
    cfg,
    userId,
  } = {}) {
    const value=objectValue(reservation);
    if (!value || value.reserved !== true || value.durable !== true) {
      return {ok:true,skipped:true,reason:'legacy_or_not_reserved'};
    }

    const operationId=normalizeOperationId(value.operationId);
    const kind=normalizeKind(value.kind);
    const action=disposition==='commit'
      ? 'commit'
      : disposition==='refund'
        ? 'refund'
        : '';

    const storedUserId=positiveSafeInteger(value.userId);
    const explicitUserSupplied=userId !== undefined && userId !== null && userId !== '';
    const explicitUserId=explicitUserSupplied ? positiveSafeInteger(userId) : 0;
    const reservationUserId=explicitUserSupplied ? explicitUserId : storedUserId;
    const reservationDate=kind==='quota' ? usageDate(value.date) : '';
    const entitlementId=kind==='pass' ? positiveSafeInteger(value.entitlementId) : 0;

    if (
      !operationId
      || !action
      || kind==='unknown'
      || !storedUserId
      || !reservationUserId
      || (explicitUserSupplied && explicitUserId!==storedUserId)
      || (kind==='quota' && !reservationDate)
      || (kind==='pass' && !entitlementId)
    ) {
      return {ok:false,pending:false,reason:'invalid_reservation'};
    }

    if (!supabaseConfigured(cfg)) {
      safeTelemetry('analysisUsageCompensationFailures');
      if (action==='commit') safeTelemetry('analysisUsageCommitFailures');
      if (action==='refund' && kind==='quota') safeTelemetry('quotaRefundFailures');
      if (action==='refund' && kind==='pass') safeTelemetry('passUsageRefundFailures');
      await safeRecordOpsEvent(cfg,{
        severity:'error',
        source:'quota',
        eventType:'analysis_usage_compensation',
        code:compensationCode(action),
        message:'Durable analysis usage could not be finalized because persistent storage is unavailable; the reservation remains pending for reconciliation.',
        meta:{
          operationId,
          kind,
          usageDate:reservationDate || null,
          entitlementId:entitlementId || null,
          error:'supabase_not_configured',
        },
      });
      return {
        ok:false,
        pending:true,
        persistent:true,
        operationId,
        kind,
        reason:'supabase_not_configured',
      };
    }

    try {
      const rawResult=kind==='quota'
        ? await supaRpc(
            cfg,
            'refund_analysis_quota',
            {
              p_telegram_id:reservationUserId,
              p_usage_date:reservationDate,
            },
            4000,
            lifecycleHeaders(operationId,action),
          )
        : await supaRpc(
            cfg,
            'refund_pass_entitlement_usage',
            {
              p_telegram_id:reservationUserId,
              p_entitlement_id:entitlementId,
            },
            4000,
            lifecycleHeaders(operationId,action),
          );

      const result=objectValue(rawResult);
      const expectedStatus=action==='commit' ? 'committed' : 'refunded';
      const resultOperationId=normalizeOperationId(result?.operationId);
      const resultStatus=safeScalarText(result?.status,40).toLowerCase();

      if (
        !result
        || result.ok !== true
        || resultStatus!==expectedStatus
        || resultOperationId!==operationId
      ) {
        const error=new Error(
          safeScalarText(result?.reason,160)
            || 'analysis_usage_finalization_not_confirmed',
        );
        error.code='ANALYSIS_USAGE_FINALIZATION_NOT_CONFIRMED';
        throw error;
      }

      // Persistence is already confirmed. Observability must never turn a
      // committed/refunded operation back into a synthetic pending failure.
      // Duplicate confirmations are idempotent reads, not new usage events.
      const duplicate=result.duplicate === true;
      if (duplicate) {
        safeTelemetry('analysisUsageFinalizationDuplicates');
      } else if (action==='commit') {
        safeTelemetry('analysisUsageCommits');
      } else {
        safeTelemetry('analysisUsageRefunds');
        if (kind==='quota') safeTelemetry('quotaRefunds');
        if (kind==='pass') safeTelemetry('passUsageRefunds');
      }

      return {
        ok:true,
        pending:false,
        persistent:true,
        duplicate,
        status:expectedStatus,
        operationId,
        kind,
      };
    } catch (error) {
      safeTelemetry('analysisUsageCompensationFailures');
      if (action==='commit') safeTelemetry('analysisUsageCommitFailures');
      if (action==='refund' && kind==='quota') safeTelemetry('quotaRefundFailures');
      if (action==='refund' && kind==='pass') safeTelemetry('passUsageRefundFailures');

      const reason=safeErrorText(error,180);
      await safeRecordOpsEvent(cfg,{
        severity:'error',
        source:'quota',
        eventType:'analysis_usage_compensation',
        code:compensationCode(action),
        message:action==='commit'
          ? 'Analysis usage completion could not be persisted; the durable reservation remains pending for reconciliation.'
          : 'Failed analysis usage could not be refunded immediately; the durable reservation remains pending for reconciliation.',
        meta:{
          operationId,
          kind,
          usageDate:reservationDate || null,
          entitlementId:entitlementId || null,
          error:reason,
        },
      });

      return {
        ok:false,
        pending:true,
        persistent:true,
        operationId,
        kind,
        reason,
      };
    }
  }

  async function reconcileAnalysisUsageReservations(cfg) {
    if (!supabaseConfigured(cfg)) {
      return {
        ok:true,
        skipped:true,
        reason:'supabase_not_configured',
        reconciled:0,
      };
    }

    try {
      const operationId='00000000-0000-4000-8000-000000000000';
      const rawResult=await supaRpc(
        cfg,
        'refund_analysis_quota',
        {
          p_telegram_id:0,
          p_usage_date:new Date().toISOString().slice(0,10),
        },
        7000,
        lifecycleHeaders(operationId,'reconcile'),
      );
      const result=objectValue(rawResult);

      if (!result || result.reconciliation !== true) {
        const error=new Error(
          safeScalarText(result?.reason,160)
            || 'analysis_usage_reconciliation_not_confirmed',
        );
        error.code='ANALYSIS_USAGE_RECONCILIATION_NOT_CONFIRMED';
        throw error;
      }

      // The SQL contract processes at most 100 stale reservations and cleans at
      // most 500 finalized rows per call. Reject impossible counters instead of
      // silently reporting a healthy reconciliation.
      const reconciled=boundedNonNegativeInteger(result.reconciled,100);
      const failed=boundedNonNegativeInteger(result.failed,100);
      const pending=boundedNonNegativeInteger(result.pending);
      const cleaned=boundedNonNegativeInteger(result.cleaned,500);

      if (
        reconciled === null
        || failed === null
        || pending === null
        || cleaned === null
        || reconciled+failed>100
        || result.ok !== (failed===0)
      ) {
        const error=new Error('analysis_usage_reconciliation_contract_invalid');
        error.code='ANALYSIS_USAGE_RECONCILIATION_CONTRACT_INVALID';
        throw error;
      }

      if (reconciled) safeTelemetry('analysisUsageReconciled',reconciled);
      if (failed) {
        safeTelemetry('analysisUsageReconciliationFailures',failed);
        await safeRecordOpsEvent(cfg,{
          severity:'error',
          source:'quota',
          eventType:'analysis_usage_reconciliation',
          code:'ANALYSIS_USAGE_RECONCILIATION_PARTIAL',
          message:'Some stale analysis usage reservations could not be reconciled and remain pending.',
          meta:{reconciled,failed,pending},
        });
      }

      return {
        ok:failed===0,
        degraded:failed>0,
        reconciled,
        failed,
        pending,
        cleaned,
      };
    } catch (error) {
      safeTelemetry('analysisUsageReconciliationFailures');
      const reason=safeErrorText(error,180);
      await safeRecordOpsEvent(cfg,{
        severity:'error',
        source:'quota',
        eventType:'analysis_usage_reconciliation',
        code:'ANALYSIS_USAGE_RECONCILIATION_FAILED',
        message:'Durable analysis usage reservations could not be reconciled.',
        meta:{error:reason},
      });
      return {
        ok:false,
        degraded:true,
        reconciled:0,
        failed:1,
        pending:0,
        cleaned:0,
        reason,
      };
    }
  }

  return Object.freeze({
    finalizeAnalysisUsageReservation,
    reconcileAnalysisUsageReservations,
  });
}
