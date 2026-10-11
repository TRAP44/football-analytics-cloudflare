function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function positiveInteger(value) {
  const number=integerCandidate(value);
  return number !== null && number>0 ? number : 0;
}

function numberCandidate(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^-?(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isFinite(number) ? number : null;
}

function boundedText(value, max = 180) {
  if (typeof value !== 'string') return '';
  const limit=integerCandidate(max);
  const safeMax=limit !== null ? Math.max(0,Math.min(4096,limit)) : 180;
  return value.trim().slice(0,safeMax);
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function createUserHistoryService({
  memory,
  hasSupabase,
  supaUpsert,
  supaSelectMany,
  recordOpsEvent = async () => null,
  bumpTelemetry = () => {},
  redactOpsString = boundedText,
  correlationId = async (_userId, fixtureId) => `fixture-${positiveInteger(fixtureId)}`,
  retryDelayMs = 300,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  const runtimeMemory=plainObject(memory) || {};
  if (!(runtimeMemory.history instanceof Map)) runtimeMemory.history=new Map();

  function supabaseEnabled(cfg) {
    try {
      return typeof hasSupabase === 'function' && hasSupabase(cfg) === true;
    } catch {
      return false;
    }
  }

  function noteTelemetry(key, amount = 1) {
    if (typeof bumpTelemetry !== 'function') return;
    try { bumpTelemetry(key,amount); } catch {}
  }

  function safeRedact(value, max = 180) {
    try {
      const redacted=typeof redactOpsString === 'function'
        ? redactOpsString(value,max)
        : boundedText(value,max);
      return boundedText(typeof redacted === 'string' ? redacted : '',max);
    } catch {
      return '';
    }
  }

  function historyRow(userId, payload) {
    const telegramId=positiveInteger(userId);
    const source=plainObject(payload);
    const match=plainObject(source?.match);
    const fixtureId=positiveInteger(match?.fixtureId);
    if (!telegramId || !fixtureId) return null;

    const instructor=plainObject(source?.aiInstructor) || {};
    const verdict=plainObject(instructor.verdict) || {};
    const signal=plainObject(instructor.betSignal) || {};
    const home=plainObject(match.home) || {};
    const away=plainObject(match.away) || {};
    const confidence=numberCandidate(instructor.confidenceScore);

    return {
      telegram_id:telegramId,
      fixture_id:fixtureId,
      home_name:boundedText(home.name,180),
      away_name:boundedText(away.name,180),
      league_name:boundedText(match.league,180),
      fixture_date:boundedText(match.date,80) || null,
      home_logo:boundedText(home.logo,2048) || null,
      away_logo:boundedText(away.logo,2048) || null,
      ai_signal_code:boundedText(signal.code,40),
      ai_signal_label:boundedText(signal.label,160),
      ai_confidence:confidence !== null
        ? Math.max(0,Math.min(100,Math.round(confidence)))
        : null,
      ai_risk:boundedText(instructor.riskLabel,60),
      ai_outcome:boundedText(verdict.outcome,80),
      ai_total:boundedText(verdict.total,80),
      ai_btts:boundedText(verdict.btts,80),
      analysis_version:boundedText(source.analysisVersion,80),
      viewed_at:new Date().toISOString(),
    };
  }

  async function safeCorrelationId(userId, fixtureId, cfg) {
    const fallback=`fixture-${positiveInteger(fixtureId)}`;
    try {
      const value=typeof correlationId === 'function'
        ? await correlationId(userId,fixtureId,cfg)
        : '';
      return boundedText(value,64) || fallback;
    } catch {
      return fallback;
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
    if (typeof recordOpsEvent !== 'function') return;
    try {
      await recordOpsEvent(cfg,{
        severity:boundedText(severity,16) || 'info',
        source:'history',
        eventType:'analysis_history_persistence',
        code:boundedText(code,80) || 'ANALYSIS_HISTORY_EVENT',
        message:boundedText(message,500),
        transitionKey:`${(boundedText(code,80) || 'analysis_history_event').toLowerCase()}:${boundedText(correlation,64)}`,
        meta:{
          correlationId:boundedText(correlation,64),
          fixtureId:positiveInteger(row?.fixture_id),
          analysisVersion:boundedText(row?.analysis_version,80),
          recovered:recovered === true,
          acceptedDataLoss:acceptedDataLoss === true,
          error:safeRedact(error?.message ?? error,180),
        },
      });
    } catch {
      // recordOpsEvent already has its own persistence/fallback semantics.
    }
  }

  async function retryHistoryWrite(row, cfg, correlation, firstError) {
    noteTelemetry('analysisHistoryRetryAttempts');
    try {
      const requestedDelay=integerCandidate(retryDelayMs);
      const delay=requestedDelay !== null ? Math.max(0,Math.min(1500,requestedDelay)) : 300;
      if (delay && typeof sleep === 'function') await sleep(delay);
      if (typeof supaUpsert !== 'function') throw new Error('Analysis history persistence transport is unavailable.');
      await supaUpsert(cfg,'analysis_history',row,'telegram_id,fixture_id');
      noteTelemetry('analysisHistoryWriteRecovered');
      await emitHistoryOps(cfg,{
        severity:'info',
        code:'ANALYSIS_HISTORY_WRITE_RECOVERED',
        message:'Analysis history persistence recovered on the idempotent retry.',
        row,
        correlation,
        error:firstError,
        recovered:true,
      });
    } catch (retryError) {
      noteTelemetry('analysisHistoryWriteLosses');
      await emitHistoryOps(cfg,{
        severity:'error',
        code:'ANALYSIS_HISTORY_WRITE_LOST',
        message:'Analysis history could not be persisted after an idempotent retry; the analysis response remains successful and this row is classified as accepted data loss.',
        row,
        correlation,
        error:retryError,
        acceptedDataLoss:true,
      });
    } finally {
      noteTelemetry('analysisHistoryRetryPending',-1);
    }
  }

  async function recordHistory(userId, payload, cfg) {
    const row=historyRow(userId,payload);
    if (!row) return;

    if (supabaseEnabled(cfg)) {
      try {
        if (typeof supaUpsert !== 'function') throw new Error('Analysis history persistence transport is unavailable.');
        await supaUpsert(cfg,'analysis_history',row,'telegram_id,fixture_id');
      } catch (error) {
        noteTelemetry('analysisHistoryWriteErrors');
        noteTelemetry('analysisHistoryRetryPending');
        const correlation=await safeCorrelationId(row.telegram_id,row.fixture_id,cfg);
        const recoveryTask=(async()=>{
          await emitHistoryOps(cfg,{
            severity:'warning',
            code:'ANALYSIS_HISTORY_WRITE_FAILED',
            message:'Analysis history persistence failed; an idempotent background retry was scheduled.',
            row,
            correlation,
            error,
          });
          await retryHistoryWrite(row,cfg,correlation,error);
        })();

        if (typeof cfg?.waitUntil === 'function') {
          try {
            cfg.waitUntil(recoveryTask);
          } catch {
            await recoveryTask;
          }
        } else {
          await recoveryTask;
        }
      }
      return;
    }

    const key=row.telegram_id;
    const list=Array.isArray(runtimeMemory.history.get(key))
      ? runtimeMemory.history.get(key).filter(item=>plainObject(item))
      : [];
    const next=[
      row,
      ...list.filter(item=>positiveInteger(item.fixture_id)!==row.fixture_id),
    ].slice(0,20);
    runtimeMemory.history.set(key,next);
  }

  // strict:true — сбой хранилища пробрасывается, чтобы API честно ответил
  // «история недоступна», а не «у вас нет анализов».
  async function getHistory(userId, cfg, { strict=false }={}) {
    const key=positiveInteger(userId);
    if (!key) return [];

    if (supabaseEnabled(cfg)) {
      try {
        if (typeof supaSelectMany !== 'function') throw new Error('Analysis history read transport is unavailable.');
        const rows=await supaSelectMany(
          cfg,
          'analysis_history',
          {telegram_id:`eq.${key}`},
          {limit:20,order:'viewed_at.desc'},
        );
        if (!Array.isArray(rows)) throw new Error('Analysis history read returned malformed rows.');
        return rows.filter(item=>plainObject(item));
      } catch (error) {
        if (strict) {
          const unavailable=new Error('Analysis history is temporarily unavailable.');
          unavailable.code='HISTORY_UNAVAILABLE';
          unavailable.cause=error;
          throw unavailable;
        }
        return [];
      }
    }

    const rows=runtimeMemory.history.get(key);
    return Array.isArray(rows) ? rows.filter(item=>plainObject(item)) : [];
  }

  return {
    recordHistory,
    getHistory,
  };
}
