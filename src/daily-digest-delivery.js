export const DAILY_DIGEST_POLICY = Object.freeze({
  pageSize: 500,
  scanCap: 10000,
  maxRecipientsPerRun: 1000,
  concurrency: 4,
  minSendIntervalMs: 50,
  executionBudgetMs: 210000,
  deliveryHourUtc: 7,
  claimLeaseSeconds: 180,
});

function asTime(value) {
  const parsed = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
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
  const deliveryDate = String(date || '');
  const nowMs = asTime(now);
  const scannedRows = Array.isArray(rows) ? rows : [];
  const due = scannedRows.filter(row =>
    Number(row?.hour_utc ?? DAILY_DIGEST_POLICY.deliveryHourUtc) === Number(hourUtc)
    && String(row?.last_sent_date || '') !== deliveryDate
  );
  const claimedToday = due.filter(row => String(row?.delivery_claim_date || '') === deliveryDate);
  const activeClaims = claimedToday.filter(row => {
    const lockedUntil = Date.parse(String(row?.delivery_locked_until || ''));
    return Number.isFinite(lockedUntil) && lockedUntil > nowMs;
  });
  const expiredClaims = claimedToday.filter(row => !activeClaims.includes(row));
  const pending = due.filter(row => String(row?.delivery_claim_date || '') !== deliveryDate || expiredClaims.includes(row));
  const boundedMax = Math.max(1, Number(maxRecipients || DAILY_DIGEST_POLICY.maxRecipientsPerRun));
  return {
    rows: pending.slice(0, boundedMax),
    pending,
    scanned: scannedRows.length,
    pages: scannedRows.length ? Math.ceil(scannedRows.length / Math.max(1, Number(pageSize || 1))) : 0,
    eligible: due.length,
    duplicate: activeClaims.length,
    activeClaims: activeClaims.length,
    expiredClaims: expiredClaims.length,
    deferred: Math.max(0, pending.length - boundedMax),
    remaining: Math.max(0, pending.length - boundedMax),
    backlog: Math.max(0, pending.length - boundedMax),
    truncated: Boolean(truncated),
  };
}

export function classifyDigestTransportError(error) {
  const code = String(error?.code || '');
  const status = Number(error?.status || 0);
  const rateLimited = code === 'TELEGRAM_RATE_LIMIT' || status === 429;
  const retryAfter = rateLimited ? Math.max(1, Number(error?.retryAfter || 1)) : 0;
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
  const gap = Math.max(1, Number(minIntervalMs || DAILY_DIGEST_POLICY.minSendIntervalMs));
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
      cooldownUntil = Math.max(cooldownUntil, Number(now()) + Math.max(1, Number(seconds || 1)) * 1000);
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

  const startedAt = Number(now());
  const budget = Math.max(1000, Number(executionBudgetMs || DAILY_DIGEST_POLICY.executionBudgetMs));
  const candidates = (plan.pending || plan.rows || []).slice(0, Math.max(1, Number(maxRecipients || DAILY_DIGEST_POLICY.maxRecipientsPerRun)));
  const gate = createDigestRateGate({ sleep, now, minIntervalMs: minSendIntervalMs });
  const stats = {
    scanned: Number(plan.scanned || 0),
    pages: Number(plan.pages || 0),
    eligible: Number(plan.eligible || 0),
    claimed: 0,
    sent: 0,
    duplicate: Number(plan.duplicate || 0),
    activeClaims: Number(plan.activeClaims || 0),
    expiredClaims: Number(plan.expiredClaims || 0),
    recoveredClaims: 0,
    failed: 0,
    rateLimited: 0,
    deferred: Math.max(0, Number(plan.pending?.length || candidates.length) - candidates.length),
    remaining: Math.max(0, Number(plan.pending?.length || candidates.length) - candidates.length),
    backlog: Math.max(0, Number(plan.pending?.length || candidates.length) - candidates.length),
    truncated: Boolean(plan.truncated),
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
    concurrency: Math.max(1, Math.min(8, Number(concurrency || DAILY_DIGEST_POLICY.concurrency))),
    maxRecipients: Math.max(1, Number(maxRecipients || DAILY_DIGEST_POLICY.maxRecipientsPerRun)),
    minSendIntervalMs: Math.max(1, Number(minSendIntervalMs || DAILY_DIGEST_POLICY.minSendIntervalMs)),
  };

  let index = 0;
  const elapsed = () => Math.max(0, Number(now()) - startedAt);
  const withinBudget = (extraMs = 0) => elapsed() + Math.max(0, Number(extraMs || 0)) < budget;

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
        owned = Boolean(await claim(row, date));
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
        if (armed === false) throw new Error('digest claim arm rejected');
        stats.sealed += 1;
      } catch {
        stats.armFailed += 1;
        stats.failed += 1;
        stats.retryableDeferred += 1;
        if (typeof release === 'function') {
          try {
            const released = await release(row, date);
            if (released === false) stats.releaseFailed += 1;
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
            if (released === false) stats.releaseFailed += 1;
          } catch {
            stats.releaseFailed += 1;
          }
        }
        continue;
      }

      stats.sent += 1;
      try {
        const completed = await complete(row, date);
        if (completed === false) stats.stateFailed += 1;
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
