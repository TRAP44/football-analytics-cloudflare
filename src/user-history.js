function boundedText(value, max = 180) {
  return String(value ?? '').slice(0, Math.max(0, Number(max || 0)));
}

export function createUserHistoryService({
  memory,
  hasSupabase,
  supaUpsert,
  supaSelectMany,
  recordOpsEvent = async () => null,
  bumpTelemetry = () => {},
  redactOpsString = boundedText,
  correlationId = async (_userId, fixtureId) => `fixture-${Number(fixtureId || 0)}`,
  retryDelayMs = 300,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  function historyRow(userId, payload) {
    const match = payload?.match;
    const instructor = payload?.aiInstructor || {};
    const verdict = instructor?.verdict || {};
    const signal = instructor?.betSignal || {};
    if (!match?.fixtureId) return null;
    return {
      telegram_id: Number(userId),
      fixture_id: Number(match.fixtureId),
      home_name: match.home?.name || '',
      away_name: match.away?.name || '',
      league_name: match.league || '',
      fixture_date: match.date || null,
      home_logo: match.home?.logo || null,
      away_logo: match.away?.logo || null,
      ai_signal_code: String(signal.code || '').slice(0,40),
      ai_signal_label: String(signal.label || '').slice(0,160),
      ai_confidence: Number.isFinite(Number(instructor.confidenceScore))
        ? Math.max(0, Math.min(100, Math.round(Number(instructor.confidenceScore))))
        : null,
      ai_risk: String(instructor.riskLabel || '').slice(0,60),
      ai_outcome: String(verdict.outcome || '').slice(0,80),
      ai_total: String(verdict.total || '').slice(0,80),
      ai_btts: String(verdict.btts || '').slice(0,80),
      analysis_version: String(payload?.analysisVersion || '').slice(0,80),
      viewed_at: new Date().toISOString(),
    };
  }

  async function safeCorrelationId(userId, fixtureId, cfg) {
    try {
      return boundedText(await correlationId(userId, fixtureId, cfg), 64) || `fixture-${Number(fixtureId || 0)}`;
    } catch {
      return `fixture-${Number(fixtureId || 0)}`;
    }
  }

  async function emitHistoryOps(cfg, {
    severity,
    code,
    message,
    row,
    correlation,
    error,
    recovered = false,
    acceptedDataLoss = false,
  }) {
    try {
      await recordOpsEvent(cfg, {
        severity,
        source: 'history',
        eventType: 'analysis_history_persistence',
        code,
        message,
        transitionKey: `${code.toLowerCase()}:${correlation}`,
        meta: {
          correlationId: correlation,
          fixtureId: Number(row.fixture_id || 0),
          analysisVersion: boundedText(row.analysis_version || '', 80),
          recovered,
          acceptedDataLoss,
          error: redactOpsString(error?.message || error || '', 180),
        },
      });
    } catch {
      // recordOpsEvent already has its own persistence/fallback semantics.
    }
  }

  async function retryHistoryWrite(userId, row, cfg, correlation, firstError) {
    bumpTelemetry('analysisHistoryRetryAttempts');
    try {
      const delay = Math.max(0, Math.min(1500, Number(retryDelayMs || 0)));
      if (delay) await sleep(delay);
      await supaUpsert(cfg, 'analysis_history', row, 'telegram_id,fixture_id');
      bumpTelemetry('analysisHistoryWriteRecovered');
      await emitHistoryOps(cfg, {
        severity: 'info',
        code: 'ANALYSIS_HISTORY_WRITE_RECOVERED',
        message: 'Analysis history persistence recovered on the idempotent retry.',
        row,
        correlation,
        error: firstError,
        recovered: true,
      });
    } catch (retryError) {
      bumpTelemetry('analysisHistoryWriteLosses');
      await emitHistoryOps(cfg, {
        severity: 'error',
        code: 'ANALYSIS_HISTORY_WRITE_LOST',
        message: 'Analysis history could not be persisted after an idempotent retry; the analysis response remains successful and this row is classified as accepted data loss.',
        row,
        correlation,
        error: retryError,
        acceptedDataLoss: true,
      });
    } finally {
      bumpTelemetry('analysisHistoryRetryPending', -1);
    }
  }

  async function recordHistory(userId, payload, cfg) {
    const row = historyRow(userId, payload);
    if (!row) return;

    if (hasSupabase(cfg)) {
      try {
        await supaUpsert(cfg, 'analysis_history', row, 'telegram_id,fixture_id');
      } catch (error) {
        bumpTelemetry('analysisHistoryWriteErrors');
        bumpTelemetry('analysisHistoryRetryPending');
        const correlation = await safeCorrelationId(userId, row.fixture_id, cfg);
        const recoveryTask = (async () => {
          await emitHistoryOps(cfg, {
            severity: 'warning',
            code: 'ANALYSIS_HISTORY_WRITE_FAILED',
            message: 'Analysis history persistence failed; an idempotent background retry was scheduled.',
            row,
            correlation,
            error,
          });
          await retryHistoryWrite(userId, row, cfg, correlation, error);
        })();

        if (typeof cfg?.waitUntil === 'function') {
          cfg.waitUntil(recoveryTask);
        } else {
          await recoveryTask;
        }
      }
      return;
    }

    const key = Number(userId);
    const list = memory.history.get(key) || [];
    const next = [row, ...list.filter(x => Number(x.fixture_id) !== Number(row.fixture_id))].slice(0,20);
    memory.history.set(key, next);
  }

  async function getHistory(userId, cfg) {
    if (hasSupabase(cfg)) {
      try {
        return await supaSelectMany(
          cfg,
          'analysis_history',
          { telegram_id: `eq.${Number(userId)}` },
          { limit:20, order:'viewed_at.desc' },
        );
      } catch (e) {
        console.warn('history read skipped', e?.message || e);
        return [];
      }
    }
    return memory.history.get(Number(userId)) || [];
  }

  return {
    recordHistory,
    getHistory,
  };
}
