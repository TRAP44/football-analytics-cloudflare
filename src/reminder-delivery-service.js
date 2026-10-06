const DELIVERY_KINDS=new Set(['prematch','kickoff','lineup','important_change']);
const MAX_TELEGRAM_RETRY_AFTER_SECONDS=604800;

function required(name,value) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function positiveSafeInteger(value) {
  const number=integerCandidate(value);
  return number !== null && number > 0 ? number : 0;
}

function nonNegativeInteger(value,fallback=0) {
  const number=integerCandidate(value);
  return number !== null && number >= 0 ? number : fallback;
}

function boundedPositiveInteger(value,fallback,max) {
  const number=positiveSafeInteger(value);
  return number ? Math.min(max,number) : fallback;
}

function cleanText(value,fallback='',maxLength=240) {
  if (typeof value !== 'string') return fallback;
  const raw=value.trim();
  if (!raw || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return fallback;
  return raw.replace(/\s+/gu,' ').slice(0,maxLength);
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp=Date.parse(value.trim());
  return Number.isFinite(timestamp) ? timestamp : null;
}

function telegramCode(value) {
  const number=integerCandidate(value);
  return number !== null && number >= 100 && number <= 599 ? number : null;
}

function normalizeTelegramResult(value) {
  const source=value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const ok=source.ok === true;
  const rawOutcome=typeof source.outcome === 'string' ? source.outcome.trim().toLowerCase() : '';
  const outcome=ok
    ? 'sent'
    : ['unknown','confirmed_failure'].includes(rawOutcome)
      ? rawOutcome
      : 'unknown';
  return {
    ok,
    status:telegramCode(source.status),
    errorCode:telegramCode(source.errorCode),
    description:cleanText(source.description,ok ? '' : 'Telegram delivery result is ambiguous.',240),
    retryAfter:Math.min(MAX_TELEGRAM_RETRY_AFTER_SECONDS,positiveSafeInteger(source.retryAfter)),
    outcome,
  };
}

function validReminderRow(row) {
  return Boolean(
    row
    && typeof row === 'object'
    && !Array.isArray(row)
    && positiveSafeInteger(row.telegram_id)
    && positiveSafeInteger(row.fixture_id)
  );
}

export function createReminderDeliveryService({
  hasSupabase,
  loadRuntimeControls,
  clearStaleReminderClaims,
  supaSelectPaged,
  recordOpsEvent,
  sendTelegramMessage,
  claimReminderDelivery,
  markReminderDeliverySending,
  holdReminderDeliveryUnknown,
  finishReminderDelivery,
  releaseReminderClaim,
  filterNotificationRecipients,
  deliveryConcurrency = 4,
  maxDeliveriesPerRun = 240,
  audienceBatchSize = 250,
}) {
  for (const [name,value] of Object.entries({
    hasSupabase,
    loadRuntimeControls,
    clearStaleReminderClaims,
    supaSelectPaged,
    recordOpsEvent,
    sendTelegramMessage,
    claimReminderDelivery,
    markReminderDeliverySending,
    holdReminderDeliveryUnknown,
    finishReminderDelivery,
    releaseReminderClaim,
  })) required(name,value);

  const successCodeByKind = Object.freeze({
    prematch: 'REMINDER_SENT_PREMATCH',
    kickoff: 'REMINDER_SENT_KICKOFF',
    lineup: 'REMINDER_SENT_LINEUP',
    important_change: 'REMINDER_SENT_IMPORTANT_CHANGE',
  });

  const concurrency=boundedPositiveInteger(deliveryConcurrency,4,8);
  const maxPerRun=Math.max(
    concurrency,
    boundedPositiveInteger(maxDeliveriesPerRun,240,1000),
  );
  const audienceChunkSize=boundedPositiveInteger(audienceBatchSize,250,500);

  function chunkRows(rows = [], size = audienceChunkSize) {
    const output = [];
    const source=Array.isArray(rows) ? rows : [];
    for (let index = 0; index < source.length; index += size) output.push(source.slice(index, index + size));
    return output;
  }

  async function filterAudienceSafely(rows = [], eventType, cfg) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    if (typeof filterNotificationRecipients !== 'function' || !sourceRows.length) {
      return {
        rows:sourceRows,
        blockedByPreference:0,
        blockedByEntitlement:0,
        failedBatches:0,
      };
    }

    const eligible = [];
    let blockedByPreference = 0;
    let blockedByEntitlement = 0;
    let failedBatches = 0;
    const batches = chunkRows(sourceRows);

    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      try {
        const audience = await filterNotificationRecipients(batch, eventType, cfg);
        const batchKeys=new Set(batch.filter(validReminderRow).map(row=>`${positiveSafeInteger(row.telegram_id)}:${positiveSafeInteger(row.fixture_id)}`));
        if (Array.isArray(audience?.rows)) {
          const seen=new Set();
          for (const row of audience.rows) {
            if (!validReminderRow(row)) continue;
            const key=`${positiveSafeInteger(row.telegram_id)}:${positiveSafeInteger(row.fixture_id)}`;
            if (!batchKeys.has(key) || seen.has(key)) continue;
            seen.add(key);
            eligible.push(row);
          }
        }
        blockedByPreference += nonNegativeInteger(audience?.blockedByPreference,0);
        blockedByEntitlement += nonNegativeInteger(audience?.blockedByEntitlement,0);
      } catch (error) {
        failedBatches += 1;
        await recordOpsEvent(cfg, {
          severity:'error',
          source:'reminders',
          eventType:'reminder_scheduler',
          code:'REMINDER_AUDIENCE_BATCH_FAILED',
          message:error?.message || error,
          endpoint:'cron:reminders',
          meta:{
            notificationType:cleanText(eventType,'unknown',80),
            batchIndex:index,
            batchSize:batch.length,
          },
        }).catch(() => {});
      }
    }

    return {
      rows:eligible,
      blockedByPreference,
      blockedByEntitlement,
      failedBatches,
    };
  }


  async function recordReminderDelivery(cfg, { row, kind, result, success, disabled = false, uncertain = false, rateLimited = false }) {
    const normalized=normalizeTelegramResult(result);
    const safeKind=DELIVERY_KINDS.has(kind) ? kind : 'unknown';
    const code = success
      ? (successCodeByKind[safeKind] || 'REMINDER_SENT')
      : uncertain
        ? 'REMINDER_DELIVERY_UNKNOWN'
        : rateLimited
          ? 'REMINDER_RATE_LIMITED'
          : disabled
            ? 'REMINDER_FORBIDDEN'
            : 'REMINDER_SEND_FAILED';

    await recordOpsEvent(cfg, {
      severity: success ? 'info' : 'warning',
      source: 'reminders',
      eventType: 'reminder_delivery',
      code,
      message: success
        ? `Reminder ${safeKind} delivered.`
        : uncertain
          ? `Reminder ${safeKind} delivery outcome is unknown; automatic retry is suppressed.`
          : rateLimited
            ? `Reminder ${safeKind} delivery was rate-limited; retry is deferred using Telegram retry_after.`
            : `Reminder ${safeKind} delivery failed: ${normalized.description || 'unknown error'}`,
      endpoint: 'cron:reminders',
      status: normalized.status,
      meta: {
        fixtureId: positiveSafeInteger(row?.fixture_id) || null,
        kind:safeKind,
        telegramStatus:normalized.status,
        telegramErrorCode:normalized.errorCode,
        retryAfter:normalized.retryAfter || null,
        telegramOutcome:normalized.outcome,
      },
    });
  }

  async function deliverClaimedReminder(row, kind, text, cfg) {
    if (!validReminderRow(row)) return {state:'invalid',reason:'invalid_reminder_identity'};
    if (!DELIVERY_KINDS.has(kind)) return {state:'invalid',reason:'invalid_reminder_kind'};
    if (typeof text !== 'string' || !text.trim() || text.length > 4096) {
      return {state:'invalid',reason:'invalid_reminder_text'};
    }

    const claim = await claimReminderDelivery(row, kind, cfg);
    if (!claim || typeof claim !== 'object' || Array.isArray(claim) || claim.claimed !== true) {
      return { state: 'already_claimed' };
    }
    if (parseTimestamp(claim.claimAt) === null) {
      const error=new Error('Reminder delivery claim returned an invalid timestamp.');
      error.code='REMINDER_DELIVERY_CLAIM_INVALID';
      throw error;
    }

    try {
      await markReminderDeliverySending(row, kind, claim.claimAt, cfg);
    } catch (error) {
      await releaseReminderClaim(
        row,
        kind,
        claim.claimAt,
        'Reminder pre-send state persistence failed.',
        cfg,
      ).catch(() => {});
      throw error;
    }

    let rawResult;
    try {
      rawResult=await sendTelegramMessage(positiveSafeInteger(row.telegram_id), text, cfg);
    } catch (error) {
      rawResult={
        ok:false,
        outcome:'unknown',
        description:cleanText(error?.message,'Telegram sendMessage transport failed.',240),
      };
    }
    const result=normalizeTelegramResult(rawResult);

    if (result.ok === true) {
      try {
        const finish = await finishReminderDelivery(row, kind, claim.claimAt, cfg);
        if (finish?.finalized !== true) {
          throw new Error('Reminder sent-state persistence was not confirmed.');
        }
        if (finish.reconciled === true) {
          await recordOpsEvent(cfg, {
            severity:'warning',
            source:'reminders',
            eventType:'reminder_delivery',
            code:'REMINDER_FINISH_RECONCILED',
            message:'Reminder finish response was ambiguous but persisted sent state was confirmed by read-after-write reconciliation.',
            endpoint:'cron:reminders',
            meta:{ fixtureId:positiveSafeInteger(row.fixture_id) || null, kind },
          }).catch(() => {});
        }
        await recordReminderDelivery(cfg, { row, kind, result, success: true }).catch(() => {});
        return { state: 'sent', result, reconciled:finish.reconciled === true };
      } catch (error) {
        let holdFailed = false;
        try {
          await holdReminderDeliveryUnknown(row, kind, claim.claimAt, cfg);
        } catch (holdError) {
          holdFailed = true;
          await recordOpsEvent(cfg, {
            severity:'error',
            source:'reminders',
            eventType:'reminder_delivery',
            code:'REMINDER_SENT_AMBIGUOUS_HOLD_FAILED',
            message:cleanText(holdError?.message,'Reminder unknown hold failed.',240),
            endpoint:'cron:reminders',
            meta:{ fixtureId:positiveSafeInteger(row.fixture_id) || null, kind },
          }).catch(() => {});
        }

        await recordOpsEvent(cfg, {
          severity:'error',
          source:'reminders',
          eventType:'reminder_delivery',
          code:'REMINDER_SENT_PERSISTENCE_AMBIGUOUS',
          message:cleanText(
            error?.message,
            'Telegram accepted the reminder but sent-state persistence could not be confirmed.',
            240,
          ),
          endpoint:'cron:reminders',
          meta:{
            fixtureId:positiveSafeInteger(row.fixture_id) || null,
            kind,
            holdFailed,
          },
        }).catch(() => {});

        return {
          state:'sent_unconfirmed',
          result,
          persistenceFailed:true,
          holdFailed,
        };
      }
    }

    if (result.outcome !== 'confirmed_failure') {
      let persistenceFailed = false;
      try {
        await holdReminderDeliveryUnknown(row, kind, claim.claimAt, cfg);
      } catch (error) {
        persistenceFailed = true;
        await recordOpsEvent(cfg, {
          severity: 'error',
          source: 'reminders',
          eventType: 'reminder_delivery',
          code: 'REMINDER_UNKNOWN_HOLD_FAILED',
          message: cleanText(error?.message,'Reminder unknown hold failed.',240),
          endpoint: 'cron:reminders',
          meta: { fixtureId:positiveSafeInteger(row.fixture_id) || null, kind },
        }).catch(() => {});
      }

      await recordReminderDelivery(cfg, {
        row,
        kind,
        result,
        success: false,
        uncertain: true,
      }).catch(() => {});

      return { state: 'unknown', result, persistenceFailed };
    }

    const forbidden = result.status === 403 || result.errorCode === 403;
    const rateLimited = result.status === 429 || result.errorCode === 429;
    let releaseFailed=false;

    try {
      await releaseReminderClaim(
        row,
        kind,
        claim.claimAt,
        result.description || 'Telegram delivery failed.',
        cfg,
        {
          disable: forbidden,
          disableReason: forbidden ? 'telegram_forbidden' : '',
          retryAfter:result.retryAfter,
        },
      );
    } catch (error) {
      releaseFailed=true;
      await recordOpsEvent(cfg,{
        severity:'error',
        source:'reminders',
        eventType:'reminder_delivery',
        code:'REMINDER_RELEASE_FAILED',
        message:cleanText(error?.message,'Reminder retry state could not be persisted.',240),
        endpoint:'cron:reminders',
        meta:{
          fixtureId:positiveSafeInteger(row.fixture_id) || null,
          kind,
          rateLimited,
          forbidden,
        },
      }).catch(()=>{});
    }

    await recordReminderDelivery(cfg, {
      row,
      kind,
      result,
      success: false,
      disabled: forbidden && !releaseFailed,
      rateLimited,
    }).catch(() => {});

    if (rateLimited) return {state:'rate_limited',result,persistenceFailed:releaseFailed};
    if (releaseFailed) return {state:'release_failed',result,persistenceFailed:true};
    return { state: forbidden ? 'disabled' : 'failed', result };
  }

  async function processDueReminders(cfg) {
    const emptySummary = extra => ({
      ok:true,
      checked:0,
      candidates:0,
      eligible:0,
      sent:0,
      kickoffSent:0,
      failed:0,
      unknown:0,
      ambiguous:0,
      rateLimited:0,
      claimed:0,
      deferred:0,
      blockedByPreference:0,
      blockedByEntitlement:0,
      dependencyFailures:0,
      staleClaims:0,
      staleCleanupFailed:0,
      truncated:false,
      backlog:false,
      concurrency,
      maxDeliveriesPerRun:maxPerRun,
      ...(extra || {}),
    });

    let supabaseAvailable=false;
    try {
      supabaseAvailable=hasSupabase(cfg) === true;
    } catch {
      supabaseAvailable=false;
    }
    const botTokenConfigured=typeof cfg?.botToken === 'string' && cfg.botToken.trim().length > 0;
    if (!supabaseAvailable || !botTokenConfigured) return emptySummary();

    let runtimeState;
    try {
      runtimeState = await loadRuntimeControls(cfg);
    } catch (error) {
      await recordOpsEvent(cfg, {
        severity:'error',
        source:'reminders',
        eventType:'reminder_scheduler',
        code:'REMINDER_RUNTIME_CONTROLS_FAILED',
        message:error?.message || error,
        endpoint:'cron:reminders',
      }).catch(() => {});
      return emptySummary({
        ok:false,
        failed:1,
        dependencyFailures:1,
        reason:'runtime_controls_unavailable',
      });
    }

    if (runtimeState?.value?.remindersEnabled === false) {
      return emptySummary({ disabled:true });
    }
    if (runtimeState?.value?.remindersEnabled !== true) {
      await recordOpsEvent(cfg,{
        severity:'error',
        source:'reminders',
        eventType:'reminder_scheduler',
        code:'REMINDER_RUNTIME_CONTROLS_INVALID',
        message:'Reminder runtime-control state is malformed; scheduler stayed fail-closed.',
        endpoint:'cron:reminders',
      }).catch(()=>{});
      return emptySummary({
        ok:false,
        failed:1,
        dependencyFailures:1,
        reason:'runtime_controls_invalid',
      });
    }

    let stale = { prematch:0, kickoff:0, lineup:0, important_change:0, failed:0 };
    try {
      stale = await clearStaleReminderClaims(cfg);
    } catch (error) {
      stale = { prematch:0, kickoff:0, lineup:0, important_change:0, failed:1 };
      await recordOpsEvent(cfg, {
        severity:'error',
        source:'reminders',
        eventType:'reminder_scheduler',
        code:'REMINDER_STALE_CLAIM_CLEANUP_FAILED',
        message:error?.message || error,
        endpoint:'cron:reminders',
      }).catch(() => {});
    }

    const now = Date.now();
    const from = new Date(now - 8 * 60_000).toISOString();
    const toMs = now + 65 * 60_000;
    const to = new Date(toMs).toISOString();
    let rows = [];
    let truncated = false;

    try {
      const page = await supaSelectPaged(cfg, 'match_reminders', {
        enabled:'eq.true',
        and:`(fixture_date.gte.${from},fixture_date.lte.${to})`,
      }, {
        pageSize:250,
        maxRows:2000,
        order:'fixture_date.asc,fixture_id.asc,telegram_id.asc',
      });
      rows = Array.isArray(page?.rows)
        ? page.rows.filter(row => {
          if (!validReminderRow(row)) return false;
          const fixtureMs=parseTimestamp(row.fixture_date);
          return fixtureMs !== null && fixtureMs >= Date.parse(from) && fixtureMs <= toMs;
        })
        : [];
      truncated = page?.truncated === true;

      if (truncated) {
        await recordOpsEvent(cfg, {
          severity:'warning',
          source:'reminders',
          eventType:'reminder_scheduler',
          code:'REMINDER_SCHEDULER_TRUNCATED',
          message:'Планировщик достиг лимита 2000 напоминаний в одном временном окне.',
          endpoint:'cron:reminders',
          meta:{ rows:rows.length, windowFrom:from, windowTo:to },
        }).catch(() => {});
      }
    } catch (error) {
      await recordOpsEvent(cfg, {
        severity:'error',
        source:'reminders',
        eventType:'reminder_scheduler',
        code:'REMINDER_SCHEDULER_READ_FAILED',
        message:error?.message || error,
        endpoint:'cron:reminders',
      }).catch(() => {});
      return emptySummary({
        ok:false,
        failed:1,
        staleClaims:nonNegativeInteger(stale?.prematch,0)
          + nonNegativeInteger(stale?.kickoff,0)
          + nonNegativeInteger(stale?.lineup,0)
          + nonNegativeInteger(stale?.important_change,0),
        staleCleanupFailed:nonNegativeInteger(stale?.failed,0),
        reason:'reminder_read_failed',
      });
    }

    const candidates = [];
    for (const row of rows) {
      const kickoffMs=parseTimestamp(row.fixture_date);
      if (kickoffMs === null) continue;

      const retryAfterMs=parseTimestamp(row?.delivery_retry_after);
      if (retryAfterMs !== null && retryAfterMs > now) continue;

      const homeName=cleanText(row?.home_name,'',120);
      const awayName=cleanText(row?.away_name,'',120);
      if (!homeName || !awayName) continue;
      const leagueName=cleanText(row?.league_name,'',120);

      const deltaMinutes = (kickoffMs - now) / 60000;
      const requestedReminder=integerCandidate(row?.remind_before_minutes);
      const remindBefore = [15,30,60].includes(requestedReminder) ? requestedReminder : 30;
      const kickoffEnabled = row?.kickoff_notify === undefined || row?.kickoff_notify === null
        ? true
        : row.kickoff_notify === true;

      if (kickoffEnabled && !row?.kickoff_notified_at && deltaMinutes <= 4 && deltaMinutes >= -7) {
        candidates.push({
          row,
          kind:'kickoff',
          eventType:'match.kickoff',
          text:`🔴 Матч начинается\n\n${homeName} — ${awayName}${leagueName ? `\n${leagueName}` : ''}\n\nОткройте приложение: центр матча появится, когда источник данных обновит статус.`,
        });
        continue;
      }

      const lowerBound = kickoffEnabled ? 5 : 0;
      if (!row?.notified_at && deltaMinutes >= lowerBound && deltaMinutes <= remindBefore + 2) {
        const minutes = Math.max(1, Math.round(deltaMinutes));
        candidates.push({
          row,
          kind:'prematch',
          eventType:'match.prematch',
          text:`⚽ Скоро матч\n\n${homeName} — ${awayName}${leagueName ? `\n${leagueName}` : ''}\nСтарт примерно через ${minutes} мин.\n\nОткройте приложение для свежего предматчевого анализа.`,
        });
      }
    }

    const prematchCandidates = candidates.filter(item => item.kind === 'prematch').map(item => item.row);
    const kickoffCandidates = candidates.filter(item => item.kind === 'kickoff').map(item => item.row);
    const [prematchAudience, kickoffAudience] = await Promise.all([
      filterAudienceSafely(prematchCandidates, 'match.prematch', cfg),
      filterAudienceSafely(kickoffCandidates, 'match.kickoff', cfg),
    ]);

    const reminderKey = row => {
      const telegramId=positiveSafeInteger(row?.telegram_id);
      const fixtureId=positiveSafeInteger(row?.fixture_id);
      return telegramId && fixtureId ? `${telegramId}:${fixtureId}` : '';
    };
    const prematchEligible = new Set((prematchAudience.rows || []).map(reminderKey));
    const kickoffEligible = new Set((kickoffAudience.rows || []).map(reminderKey));
    const eligibleJobs = candidates.filter(item => (
      item.kind === 'kickoff'
        ? kickoffEligible.has(reminderKey(item.row))
        : prematchEligible.has(reminderKey(item.row))
    ));

    const plannedJobs = eligibleJobs.slice(0, maxPerRun);
    let cursor = 0;
    let started = 0;
    let sent = 0;
    let kickoffSent = 0;
    let failed = 0;
    let unknown = 0;
    let ambiguous = 0;
    let rateLimited = 0;
    let claimed = 0;
    let stopForRateLimit = false;

    async function deliveryWorker() {
      while (!stopForRateLimit) {
        const index = cursor;
        cursor += 1;
        if (index >= plannedJobs.length) return;
        const job = plannedJobs[index];
        started += 1;

        try {
          const delivery = await deliverClaimedReminder(job.row, job.kind, job.text, cfg);
          if (delivery.state === 'sent') {
            if (job.kind === 'kickoff') kickoffSent += 1;
            else sent += 1;
          } else if (delivery.state === 'already_claimed') {
            claimed += 1;
          } else if (delivery.state === 'unknown') {
            unknown += 1;
          } else if (delivery.state === 'sent_unconfirmed') {
            ambiguous += 1;
          } else if (delivery.state === 'rate_limited') {
            rateLimited += 1;
            stopForRateLimit = true;
          } else {
            failed += 1;
          }
        } catch (error) {
          failed += 1;
          await recordOpsEvent(cfg, {
            severity:'warning',
            source:'reminders',
            eventType:'reminder_delivery',
            code:'REMINDER_DELIVERY_EXCEPTION',
            message:error?.message || error,
            endpoint:'cron:reminders',
            meta:{
              fixtureId:positiveSafeInteger(job?.row?.fixture_id) || null,
              kind:job?.kind || '',
            },
          }).catch(() => {});
        }
      }
    }

    const workerCount = Math.min(concurrency, plannedJobs.length);
    await Promise.all(Array.from({ length:workerCount }, () => deliveryWorker()));

    const deferred = Math.max(0, eligibleJobs.length - started);
    const dependencyFailures=nonNegativeInteger(prematchAudience.failedBatches,0)
      + nonNegativeInteger(kickoffAudience.failedBatches,0);
    const staleClaims=nonNegativeInteger(stale?.prematch,0)
      + nonNegativeInteger(stale?.kickoff,0)
      + nonNegativeInteger(stale?.lineup,0)
      + nonNegativeInteger(stale?.important_change,0);
    const staleCleanupFailed=nonNegativeInteger(stale?.failed,0);
    const backlog = Boolean(deferred || truncated);
    const ok = !(failed || unknown || ambiguous || rateLimited || dependencyFailures || staleCleanupFailed || backlog);

    const summary = {
      ok,
      checked:rows.length,
      candidates:candidates.length,
      eligible:eligibleJobs.length,
      sent,
      kickoffSent,
      failed,
      unknown,
      ambiguous,
      rateLimited,
      claimed,
      deferred,
      blockedByPreference:nonNegativeInteger(prematchAudience.blockedByPreference,0)
        + nonNegativeInteger(kickoffAudience.blockedByPreference,0),
      blockedByEntitlement:nonNegativeInteger(prematchAudience.blockedByEntitlement,0)
        + nonNegativeInteger(kickoffAudience.blockedByEntitlement,0),
      dependencyFailures,
      staleClaims,
      staleCleanupFailed,
      truncated,
      backlog,
      concurrency,
      maxDeliveriesPerRun:maxPerRun,
    };

    if (sent || kickoffSent || failed || unknown || ambiguous || rateLimited || claimed || deferred || dependencyFailures || staleClaims || staleCleanupFailed || truncated) {
      const code = failed
        ? 'REMINDER_RUN_WITH_FAILURES'
        : ambiguous
          ? 'REMINDER_RUN_WITH_PERSISTENCE_AMBIGUITY'
          : unknown
            ? 'REMINDER_RUN_WITH_UNKNOWN'
            : rateLimited
              ? 'REMINDER_RUN_RATE_LIMITED'
              : dependencyFailures
                ? 'REMINDER_RUN_WITH_DEPENDENCY_FAILURES'
                : truncated
                  ? 'REMINDER_RUN_TRUNCATED'
                  : backlog
                    ? 'REMINDER_RUN_BACKLOG_DEFERRED'
                    : staleCleanupFailed
                      ? 'REMINDER_RUN_DEGRADED'
                      : 'REMINDER_RUN_OK';

      await recordOpsEvent(cfg, {
        severity:ok ? 'info' : 'warning',
        source:'reminders',
        eventType:'reminder_scheduler',
        code,
        message:`Планировщик уведомлений: проверено ${rows.length}, кандидатов ${candidates.length}, отправлено ${sent + kickoffSent}, неопределённых ${unknown}, persistence ambiguity ${ambiguous}, rate limit ${rateLimited}, отложено ${deferred}, ошибок ${failed}.`,
        endpoint:'cron:reminders',
        meta:summary,
      }).catch(() => {});
    }

    return summary;
  }

  return Object.freeze({
    deliverClaimedReminder,
    processDueReminders,
  });
}
