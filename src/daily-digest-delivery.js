export const DAILY_DIGEST_POLICY = Object.freeze({
  pageSize: 500,
  scanCap: 10000,
  maxRecipientsPerRun: 1000,
  concurrency: 4,
  minSendIntervalMs: 50,
  executionBudgetMs: 210000,
  deliveryHourUtc: 7,
  claimLeaseSeconds: 180,
  lateBacklogMinuteUtc: 50,
  sealedClaimAgeMs: 5 * 60 * 1000,
});

function finiteNumberCandidate(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number=Number(value);
  return Number.isFinite(number) ? number : null;
}

function strictTimestampMs(value) {
  if (value instanceof Date) {
    const ms=value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw=value.trim();
  const calendar=/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(raw);
  if (!calendar) return null;
  const year=Number(calendar[1]);
  const month=Number(calendar[2]);
  const day=Number(calendar[3]);
  if (!Number.isSafeInteger(year) || month<1 || month>12 || day<1) return null;
  const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  if (day>maxDay) return null;
  const parsed=Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function strictUtcDate(value) {
  const raw=typeof value==='string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const parsed=strictTimestampMs(`${raw}T00:00:00.000Z`);
  return parsed === null ? '' : new Date(parsed).toISOString().slice(0,10)===raw ? raw : '';
}

function asTime(value) {
  const parsed=strictTimestampMs(value);
  return parsed === null ? Date.now() : parsed;
}

function nonNegativeInteger(value, fallback = 0) {
  const number=finiteNumberCandidate(value);
  if (number === null || !Number.isSafeInteger(number) || number < 0) return fallback;
  return number;
}

function positiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const number=finiteNumberCandidate(value);
  const fallbackNumber=finiteNumberCandidate(fallback);
  const safeFallback=fallbackNumber !== null && Number.isSafeInteger(fallbackNumber) && fallbackNumber > 0
    ? fallbackNumber
    : 1;
  if (number === null || !Number.isSafeInteger(number) || number <= 0) return Math.min(max,safeFallback);
  return Math.max(1,Math.min(max,number));
}

function positiveFinite(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const number=finiteNumberCandidate(value);
  const fallbackNumber=finiteNumberCandidate(fallback);
  const safeFallback=fallbackNumber !== null && fallbackNumber > 0 ? fallbackNumber : 1;
  if (number === null || number <= 0) return Math.min(max,safeFallback);
  return Math.max(1,Math.min(max,number));
}

export function isDailyDigestExecutionWindow(scheduledAt) {
  const date = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  return Number.isFinite(date.getTime()) && date.getUTCHours() === DAILY_DIGEST_POLICY.deliveryHourUtc;
}

export function planDailyDigestRecipients(rows = [], {
  date,
  hourUtc = DAILY_DIGEST_POLICY.deliveryHourUtc,
  pageSize = DAILY_DIGEST_POLICY.pageSize,
  maxRecipients = DAILY_DIGEST_POLICY.maxRecipientsPerRun,
  truncated = false,
  now = Date.now(),
} = {}) {
  const deliveryDate=strictUtcDate(date);
  const nowMs=asTime(now);
  const scannedRows=Array.isArray(rows) ? rows : [];
  const requestedHour=finiteNumberCandidate(hourUtc);
  const normalizedHour=requestedHour !== null && Number.isSafeInteger(requestedHour) && requestedHour>=0 && requestedHour<=23
    ? requestedHour
    : null;
  const validPlan=Boolean(deliveryDate && normalizedHour !== null);
  const due=validPlan ? scannedRows.filter(row => {
    const rawHour=row?.hour_utc ?? DAILY_DIGEST_POLICY.deliveryHourUtc;
    const rowHour=finiteNumberCandidate(rawHour);
    return rowHour !== null
      && Number.isSafeInteger(rowHour)
      && rowHour===normalizedHour
      && String(row?.last_sent_date || '')!==deliveryDate;
  }) : [];
  const claimedToday=due.filter(row=>String(row?.delivery_claim_date || '')===deliveryDate);
  const claimState=new Map(claimedToday.map(row=>{
    const lockedUntil=strictTimestampMs(row?.delivery_locked_until);
    return [row,{
      lockedUntil,
      active:lockedUntil === null || lockedUntil>nowMs,
    }];
  }));
  const activeClaims=claimedToday.filter(row=>claimState.get(row)?.active===true);
  const expiredClaims=claimedToday.filter(row=>{
    const state=claimState.get(row);
    return state?.lockedUntil !== null && state?.active===false;
  });
  const sealedClaims=activeClaims.filter(row=>{
    const lockedUntil=claimState.get(row)?.lockedUntil;
    const claimedAt=strictTimestampMs(row?.delivery_claimed_at);
    if (lockedUntil === null || claimedAt === null) return true;
    const age=Math.max(0,nowMs-claimedAt);
    return age>=DAILY_DIGEST_POLICY.sealedClaimAgeMs;
  });
  const freshClaims=activeClaims.filter(row=>!sealedClaims.includes(row));
  const activeClaimAgesMs=activeClaims
    .map(row=>strictTimestampMs(row?.delivery_claimed_at))
    .filter(value=>value !== null)
    .map(value=>Math.max(0,nowMs-value));
  const pending=due.filter(row=>String(row?.delivery_claim_date || '')!==deliveryDate || expiredClaims.includes(row));
  const boundedMax = positiveInteger(
    maxRecipients,
    DAILY_DIGEST_POLICY.maxRecipientsPerRun,
    DAILY_DIGEST_POLICY.scanCap,
  );
  const boundedPageSize = positiveInteger(pageSize, DAILY_DIGEST_POLICY.pageSize, DAILY_DIGEST_POLICY.scanCap);
  return {
    rows: pending.slice(0, boundedMax),
    pending,
    scanned: scannedRows.length,
    pages: scannedRows.length ? Math.ceil(scannedRows.length / boundedPageSize) : 0,
    eligible: due.length,
    duplicate: activeClaims.length,
    activeClaims: activeClaims.length,
    freshClaims: freshClaims.length,
    sealedClaims: sealedClaims.length,
    oldestActiveClaimAgeMs: activeClaimAgesMs.length ? Math.max(...activeClaimAgesMs) : 0,
    expiredClaims: expiredClaims.length,
    deferred: Math.max(0, pending.length - boundedMax),
    remaining: Math.max(0, pending.length - boundedMax),
    backlog: Math.max(0, pending.length - boundedMax),
    truncated: truncated === true,
    invalidDate:!deliveryDate,
    invalidHour:normalizedHour === null,
  };
}

export function assessDailyDigestRun(summary = {}, scheduledAt = new Date()) {
  const date = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  const minute = Number.isFinite(date.getTime()) ? date.getUTCMinutes() : 0;
  const finalWindow = minute >= DAILY_DIGEST_POLICY.lateBacklogMinuteUtc;
  const backlog = nonNegativeInteger(summary.remaining ?? summary.backlog);
  const sealedClaims = nonNegativeInteger(summary.sealedClaims);
  const expiredClaims = nonNegativeInteger(summary.expiredClaims);
  const failed = nonNegativeInteger(summary.failed);
  const stateFailed = nonNegativeInteger(summary.stateFailed);
  const newsFailed = nonNegativeInteger(summary.newsFailed);
  const rateLimited = nonNegativeInteger(summary.rateLimited);
  const providerDegraded = summary.providerDegraded === true || summary.payloadUnavailable === true;
  const budgetExhausted = summary.budgetExhausted === true;
  const truncated = summary.truncated === true;

  if (sealedClaims > 0) {
    return {
      severity: 'warning',
      code: 'DAILY_DIGEST_SEALED_CLAIMS',
      phase: finalWindow ? 'late' : 'active',
      reason: 'sealed_claims',
    };
  }
  if (finalWindow && backlog > 0) {
    return {
      severity: 'warning',
      code: 'DAILY_DIGEST_BACKLOG_LATE',
      phase: 'late',
      reason: 'late_backlog',
    };
  }
  if (failed || stateFailed || newsFailed || rateLimited || providerDegraded || budgetExhausted || truncated) {
    return {
      severity: 'warning',
      code: 'DAILY_DIGEST_RUN_DEGRADED',
      phase: finalWindow ? 'late' : 'active',
      reason: 'degraded',
    };
  }
  if (expiredClaims > 0) {
    return {
      severity: 'info',
      code: 'DAILY_DIGEST_CLAIMS_RECOVERED',
      phase: finalWindow ? 'late' : 'active',
      reason: 'claim_recovery',
    };
  }
  if (backlog > 0) {
    return {
      severity: 'info',
      code: 'DAILY_DIGEST_RUN_DEFERRED',
      phase: 'active',
      reason: 'bounded_backlog',
    };
  }
  return {
    severity: 'info',
    code: 'DAILY_DIGEST_RUN_OK',
    phase: finalWindow ? 'late' : 'active',
    reason: 'healthy',
  };
}

export function classifyDigestTransportError(error) {
  const code = String(error?.code || '');
  const status = Number(error?.status || 0);
  const rateLimited = code === 'TELEGRAM_RATE_LIMIT' || status === 429;
  const retryAfter = rateLimited ? positiveInteger(error?.retryAfter, 1, 3600) : 0;
  const ambiguous = ['TELEGRAM_TIMEOUT', 'TELEGRAM_NETWORK', 'TELEGRAM_UPSTREAM'].includes(code)
    || status >= 500
    || status === 0;
  const permanent = !rateLimited && !ambiguous;
  return { rateLimited, retryAfter, ambiguous, permanent };
}

export function createDigestRateGate({
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = () => Date.now(),
  minIntervalMs = DAILY_DIGEST_POLICY.minSendIntervalMs,
} = {}) {
  const gap = positiveFinite(minIntervalMs, DAILY_DIGEST_POLICY.minSendIntervalMs, 60_000);
  let nextAt = 0;
  let cooldownUntil = 0;
  let tail = Promise.resolve();

  const reserve = async () => {
    const before = Number(now());
    const wait = Math.max(0, nextAt - before, cooldownUntil - before);
    if (wait > 0) await sleep(wait);
    const current = Number(now());
    nextAt = Math.max(nextAt, current) + gap;
  };

  return Object.freeze({
    acquire() {
      const current = tail.then(reserve);
      tail = current.catch(() => undefined);
      return current;
    },
    defer(seconds) {
      const current = Number(now());
      const nowMs = Number.isFinite(current) ? current : Date.now();
      cooldownUntil = Math.max(cooldownUntil, nowMs + positiveInteger(seconds, 1, 3600) * 1000);
    },
  });
}

export async function runBoundedDailyDigest({
  plan,
  date,
  claim,
  complete,
  arm,
  release = null,
  sendDigest,
  sendNews = null,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = () => Date.now(),
  maxRecipients = DAILY_DIGEST_POLICY.maxRecipientsPerRun,
  concurrency = DAILY_DIGEST_POLICY.concurrency,
  minSendIntervalMs = DAILY_DIGEST_POLICY.minSendIntervalMs,
  executionBudgetMs = DAILY_DIGEST_POLICY.executionBudgetMs,
} = {}) {
  if (!plan || typeof claim !== 'function' || typeof complete !== 'function' || typeof arm !== 'function' || typeof sendDigest !== 'function') {
    throw new TypeError('runBoundedDailyDigest requires plan, claim, arm, complete and sendDigest');
  }

  const startedAtRaw = Number(now());
  const startedAt = Number.isFinite(startedAtRaw) ? startedAtRaw : Date.now();
  const budget = positiveInteger(executionBudgetMs, DAILY_DIGEST_POLICY.executionBudgetMs, 15 * 60 * 1000);
  const boundedMaxRecipients = positiveInteger(
    maxRecipients,
    DAILY_DIGEST_POLICY.maxRecipientsPerRun,
    DAILY_DIGEST_POLICY.scanCap,
  );
  const pendingRows = Array.isArray(plan.pending)
    ? plan.pending
    : Array.isArray(plan.rows)
      ? plan.rows
      : [];
  const candidates = pendingRows.slice(0, boundedMaxRecipients);
  const boundedConcurrency = positiveInteger(concurrency, DAILY_DIGEST_POLICY.concurrency, 8);
  const boundedMinSendIntervalMs = positiveFinite(
    minSendIntervalMs,
    DAILY_DIGEST_POLICY.minSendIntervalMs,
    60_000,
  );
  const gate = createDigestRateGate({ sleep, now, minIntervalMs: boundedMinSendIntervalMs });
  const stats = {
    scanned: nonNegativeInteger(plan.scanned),
    pages: nonNegativeInteger(plan.pages),
    eligible: nonNegativeInteger(plan.eligible),
    claimed: 0,
    sent: 0,
    duplicate: nonNegativeInteger(plan.duplicate),
    activeClaims: nonNegativeInteger(plan.activeClaims),
    expiredClaims: nonNegativeInteger(plan.expiredClaims),
    recoveredClaims: 0,
    failed: 0,
    rateLimited: 0,
    deferred: Math.max(0, pendingRows.length - candidates.length),
    remaining: Math.max(0, pendingRows.length - candidates.length),
    backlog: Math.max(0, pendingRows.length - candidates.length),
    truncated: plan.truncated === true,
    attempted: 0,
    retries: 0,
    newsSent: 0,
    newsFailed: 0,
    claimFailed: 0,
    armFailed: 0,
    releaseFailed: 0,
    stateFailed: 0,
    sealed: 0,
    retryableDeferred: 0,
    ambiguous: 0,
    permanentFailed: 0,
    budgetExhausted: false,
    concurrency: boundedConcurrency,
    maxRecipients: boundedMaxRecipients,
    minSendIntervalMs: boundedMinSendIntervalMs,
  };

  let index = 0;
  const elapsed = () => {
    const current = Number(now());
    return Number.isFinite(current) ? Math.max(0, current - startedAt) : budget;
  };
  const withinBudget = (extraMs = 0) => {
    const extra = Number(extraMs);
    const boundedExtra = Number.isFinite(extra) ? Math.max(0, extra) : budget;
    return elapsed() + boundedExtra < budget;
  };

  async function sendWithRateLimit(send) {
    await gate.acquire();
    try {
      await send();
      return { ok: true };
    } catch (error) {
      const disposition = classifyDigestTransportError(error);
      if (disposition.rateLimited) {
        stats.rateLimited += 1;
        const waitMs = disposition.retryAfter * 1000;
        if (withinBudget(waitMs + stats.minSendIntervalMs)) {
          stats.retries += 1;
          gate.defer(disposition.retryAfter);
          await gate.acquire();
          try {
            await send();
            return { ok: true, retried: true };
          } catch (retryError) {
            const retryDisposition = classifyDigestTransportError(retryError);
            if (retryDisposition.rateLimited) stats.rateLimited += 1;
            if (retryDisposition.ambiguous) stats.ambiguous += 1;
            if (retryDisposition.permanent) stats.permanentFailed += 1;
            return { ok: false, error: retryError, disposition: retryDisposition };
          }
        }
      }
      if (disposition.ambiguous) stats.ambiguous += 1;
      if (disposition.permanent) stats.permanentFailed += 1;
      return { ok: false, error, disposition };
    }
  }

  async function worker() {
    while (index < candidates.length) {
      if (!withinBudget()) {
        stats.budgetExhausted = true;
        return;
      }
      const row = candidates[index];
      index += 1;
      stats.attempted += 1;

      let owned = false;
      try {
        owned = await claim(row, date) === true;
      } catch {
        stats.claimFailed += 1;
        stats.failed += 1;
        continue;
      }
      if (!owned) {
        stats.duplicate += 1;
        continue;
      }
      stats.claimed += 1;
      if (String(row?.delivery_claim_date || '') === String(date || '')) stats.recoveredClaims += 1;

      // Arm the claim for the rest of the delivery day before touching Telegram.
      // A crash before this point is recoverable through the short database lease;
      // after this point we prefer at-most-once delivery over a possible duplicate.
      try {
        const armed = await arm(row, date);
        if (armed !== true) throw new Error('digest claim arm rejected');
        stats.sealed += 1;
      } catch {
        stats.armFailed += 1;
        stats.failed += 1;
        stats.retryableDeferred += 1;
        if (typeof release === 'function') {
          try {
            const released = await release(row, date);
            if (released !== true) stats.releaseFailed += 1;
          } catch {
            stats.releaseFailed += 1;
          }
        }
        continue;
      }

      const main = await sendWithRateLimit(() => sendDigest(row));
      if (!main.ok) {
        stats.failed += 1;
        // A final 429 is an explicit non-delivery signal, so it is safe to
        // release the armed claim and let a later cron slot retry. Ambiguous
        // and permanent outcomes remain sealed for the date to prevent replay.
        if (main.disposition?.rateLimited && typeof release === 'function') {
          stats.retryableDeferred += 1;
          try {
            const released = await release(row, date);
            if (released !== true) stats.releaseFailed += 1;
          } catch {
            stats.releaseFailed += 1;
          }
        }
        continue;
      }

      stats.sent += 1;
      try {
        const completed = await complete(row, date);
        if (completed !== true) stats.stateFailed += 1;
      } catch {
        // Keep the claim rather than releasing it after a confirmed Telegram
        // success. The next cron therefore cannot duplicate this delivery.
        stats.stateFailed += 1;
      }

      if (typeof sendNews === 'function') {
        const news = await sendWithRateLimit(() => sendNews(row));
        if (news.ok) stats.newsSent += 1;
        else stats.newsFailed += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: stats.concurrency }, () => worker()));

  const unvisited = Math.max(0, candidates.length - index);
  const unresolvedClaimErrors = stats.claimFailed;
  const retryable = stats.retryableDeferred;
  stats.remaining += unvisited + unresolvedClaimErrors + retryable;
  stats.deferred += unvisited + unresolvedClaimErrors + retryable;
  stats.backlog = stats.remaining;
  stats.durationMs = elapsed();
  return stats;
}

export function estimateDigestOrchestration(recipients, {
  oldBatchSize = 20,
  oldBatchDelayMs = 1000,
  messagesPerRecipient = 2,
  maxRecipientsPerRun = DAILY_DIGEST_POLICY.maxRecipientsPerRun,
  minSendIntervalMs = DAILY_DIGEST_POLICY.minSendIntervalMs,
  cronIntervalMs = 300000,
} = {}) {
  const count = Math.max(0, Number(recipients || 0));
  const oldBatches = count ? Math.ceil(count / Math.max(1, Number(oldBatchSize || 20))) : 0;
  const oldMinimumMs = Math.max(0, oldBatches - 1) * Math.max(0, Number(oldBatchDelayMs || 0));
  const runs = count ? Math.ceil(count / Math.max(1, Number(maxRecipientsPerRun || 1))) : 0;
  const busiestRunRecipients = Math.min(count, Math.max(1, Number(maxRecipientsPerRun || 1)));
  const activeMsPerRun = busiestRunRecipients * Math.max(1, Number(messagesPerRecipient || 1)) * Math.max(1, Number(minSendIntervalMs || 1));
  const completionWindowMs = runs ? (runs - 1) * Math.max(1, Number(cronIntervalMs || 1)) + activeMsPerRun : 0;
  return { recipients: count, oldBatches, oldMinimumMs, runs, activeMsPerRun, completionWindowMs };
}
