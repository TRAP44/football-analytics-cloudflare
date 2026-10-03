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
  const successCodeByKind = Object.freeze({
    prematch: 'REMINDER_SENT_PREMATCH',
    kickoff: 'REMINDER_SENT_KICKOFF',
    lineup: 'REMINDER_SENT_LINEUP',
    important_change: 'REMINDER_SENT_IMPORTANT_CHANGE',
  });

  const concurrency = Math.max(1, Math.min(8, Math.round(Number(deliveryConcurrency || 4))));
  const maxPerRun = Math.max(concurrency, Math.min(1000, Math.round(Number(maxDeliveriesPerRun || 240))));
  const audienceChunkSize = Math.max(1, Math.min(500, Math.round(Number(audienceBatchSize || 250))));

  function chunkRows(rows = [], size = audienceChunkSize) {
    const output = [];
    for (let index = 0; index < rows.length; index += size) output.push(rows.slice(index, index + size));
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
        if (Array.isArray(audience?.rows)) eligible.push(...audience.rows);
        blockedByPreference += Number(audience?.blockedByPreference || 0);
        blockedByEntitlement += Number(audience?.blockedByEntitlement || 0);
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
            notificationType:String(eventType || ''),
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
    const code = success
      ? (successCodeByKind[kind] || 'REMINDER_SENT')
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
        ? `Reminder ${kind} delivered.`
        : uncertain
          ? `Reminder ${kind} delivery outcome is unknown; automatic retry is suppressed.`
          : rateLimited
            ? `Reminder ${kind} delivery was rate-limited; retry is deferred using Telegram retry_after.`
            : `Reminder ${kind} delivery failed: ${result?.description || 'unknown error'}`,
      endpoint: 'cron:reminders',
      status: Number(result?.status || 0) || null,
      meta: {
        fixtureId: Number(row?.fixture_id || 0),
        kind,
        telegramStatus: Number(result?.status || 0) || null,
        telegramErrorCode: Number(result?.errorCode || 0) || null,
        retryAfter: Number(result?.retryAfter || 0) || null,
        telegramOutcome: String(result?.outcome || (success ? 'sent' : 'confirmed_failure')),
      },
    });
  }

  async function deliverClaimedReminder(row, kind, text, cfg) {
    const claim = await claimReminderDelivery(row, kind, cfg);
    if (!claim.claimed) return { state: 'already_claimed' };

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

    const result = await sendTelegramMessage(row.telegram_id, text, cfg);

    if (result.ok) {
      try {
        const finish = await finishReminderDelivery(row, kind, claim.claimAt, cfg);
        if (finish?.reconciled) {
          await recordOpsEvent(cfg, {
            severity:'warning',
            source:'reminders',
            eventType:'reminder_delivery',
            code:'REMINDER_FINISH_RECONCILED',
            message:'Reminder finish response was ambiguous but persisted sent state was confirmed by read-after-write reconciliation.',
            endpoint:'cron:reminders',
            meta:{ fixtureId:Number(row?.fixture_id || 0), kind },
          }).catch(() => {});
        }
        await recordReminderDelivery(cfg, { row, kind, result, success: true }).catch(() => {});
        return { state: 'sent', result, reconciled:Boolean(finish?.reconciled) };
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
            message:holdError?.message || holdError,
            endpoint:'cron:reminders',
            meta:{ fixtureId:Number(row?.fixture_id || 0), kind },
          }).catch(() => {});
        }

        await recordOpsEvent(cfg, {
          severity:'error',
          source:'reminders',
          eventType:'reminder_delivery',
          code:'REMINDER_SENT_PERSISTENCE_AMBIGUOUS',
          message:error?.message || 'Telegram accepted the reminder but sent-state persistence could not be confirmed.',
          endpoint:'cron:reminders',
          meta:{
            fixtureId:Number(row?.fixture_id || 0),
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

    if (result?.outcome === 'unknown') {
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
          message: error?.message || error,
          endpoint: 'cron:reminders',
          meta: { fixtureId: Number(row?.fixture_id || 0), kind },
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

    const forbidden = Number(result.status) === 403 || Number(result.errorCode) === 403;
    const rateLimited = Number(result.status) === 429 || Number(result.errorCode) === 429;

    await releaseReminderClaim(
      row,
      kind,
      claim.claimAt,
      result.description || 'Telegram delivery failed.',
      cfg,
      {
        disable: forbidden,
        disableReason: forbidden ? 'telegram_forbidden' : '',
        retryAfter: Number(result.retryAfter || 0),
      },
    ).catch(() => {});

    await recordReminderDelivery(cfg, {
      row,
      kind,
      result,
      success: false,
      disabled: forbidden,
      rateLimited,
    }).catch(() => {});

    return { state: rateLimited ? 'rate_limited' : forbidden ? 'disabled' : 'failed', result };
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

    if (!hasSupabase(cfg) || !cfg.botToken) return emptySummary();

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

    if (runtimeState.value?.remindersEnabled === false) {
      return emptySummary({ disabled:true });
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
          const fixtureMs = Date.parse(row?.fixture_date || '');
          return Number.isFinite(fixtureMs) && fixtureMs >= Date.parse(from) && fixtureMs <= toMs;
        })
        : [];
      truncated = Boolean(page?.truncated);

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
        staleClaims:Number(stale.prematch || 0) + Number(stale.kickoff || 0) + Number(stale.lineup || 0) + Number(stale.important_change || 0),
        staleCleanupFailed:Number(stale.failed || 0),
        reason:'reminder_read_failed',
      });
    }

    const candidates = [];
    for (const row of rows) {
      const kickoffMs = Date.parse(row?.fixture_date || '');
      if (!Number.isFinite(kickoffMs)) continue;

      const retryAfterMs = Date.parse(row?.delivery_retry_after || '');
      if (Number.isFinite(retryAfterMs) && retryAfterMs > now) continue;

      const deltaMinutes = (kickoffMs - now) / 60000;
      const remindBefore = [15,30,60].includes(Number(row?.remind_before_minutes))
        ? Number(row.remind_before_minutes)
        : 30;
      const kickoffEnabled = row?.kickoff_notify !== false;

      if (kickoffEnabled && !row?.kickoff_notified_at && deltaMinutes <= 4 && deltaMinutes >= -7) {
        candidates.push({
          row,
          kind:'kickoff',
          eventType:'match.kickoff',
          text:`🔴 Матч начинается\n\n${row.home_name} — ${row.away_name}${row.league_name ? `\n${row.league_name}` : ''}\n\nОткройте приложение: центр матча появится, когда источник данных обновит статус.`,
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
          text:`⚽ Скоро матч\n\n${row.home_name} — ${row.away_name}${row.league_name ? `\n${row.league_name}` : ''}\nСтарт примерно через ${minutes} мин.\n\nОткройте приложение для свежего предматчевого анализа.`,
        });
      }
    }

    const prematchCandidates = candidates.filter(item => item.kind === 'prematch').map(item => item.row);
    const kickoffCandidates = candidates.filter(item => item.kind === 'kickoff').map(item => item.row);
    const [prematchAudience, kickoffAudience] = await Promise.all([
      filterAudienceSafely(prematchCandidates, 'match.prematch', cfg),
      filterAudienceSafely(kickoffCandidates, 'match.kickoff', cfg),
    ]);

    const reminderKey = row => `${Number(row?.telegram_id || 0)}:${Number(row?.fixture_id || 0)}`;
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
              fixtureId:Number(job?.row?.fixture_id || 0),
              kind:job?.kind || '',
            },
          }).catch(() => {});
        }
      }
    }

    const workerCount = Math.min(concurrency, plannedJobs.length);
    await Promise.all(Array.from({ length:workerCount }, () => deliveryWorker()));

    const deferred = Math.max(0, eligibleJobs.length - started);
    const dependencyFailures = Number(prematchAudience.failedBatches || 0) + Number(kickoffAudience.failedBatches || 0);
    const staleClaims = Number(stale.prematch || 0) + Number(stale.kickoff || 0) + Number(stale.lineup || 0) + Number(stale.important_change || 0);
    const staleCleanupFailed = Number(stale.failed || 0);
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
      blockedByPreference:Number(prematchAudience.blockedByPreference || 0) + Number(kickoffAudience.blockedByPreference || 0),
      blockedByEntitlement:Number(prematchAudience.blockedByEntitlement || 0) + Number(kickoffAudience.blockedByEntitlement || 0),
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

  return {
    deliverClaimedReminder,
    processDueReminders,
  };
}
