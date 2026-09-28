export function createReminderDeliveryService({
  hasSupabase,
  loadRuntimeControls,
  clearStaleReminderClaims,
  supaSelectMany,
  recordOpsEvent,
  sendTelegramMessage,
  claimReminderDelivery,
  markReminderDeliverySending,
  holdReminderDeliveryUnknown,
  finishReminderDelivery,
  releaseReminderClaim,
}) {
  async function recordReminderDelivery(cfg, { row, kind, result, success, disabled = false, uncertain = false }) {
    const code = success
      ? (kind === 'kickoff' ? 'REMINDER_SENT_KICKOFF' : 'REMINDER_SENT_PREMATCH')
      : uncertain
        ? 'REMINDER_DELIVERY_UNKNOWN'
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
      await finishReminderDelivery(row, kind, claim.claimAt, cfg);
      await recordReminderDelivery(cfg, { row, kind, result, success: true }).catch(() => {});
      return { state: 'sent', result };
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
    }).catch(() => {});

    return { state: forbidden ? 'disabled' : 'failed', result };
  }

  async function processDueReminders(cfg) {
    if (!hasSupabase(cfg) || !cfg.botToken) {
      return { checked: 0, sent: 0, kickoffSent: 0, failed: 0, unknown: 0, claimed: 0, staleClaims: 0 };
    }

    const runtimeState = await loadRuntimeControls(cfg);
    if (runtimeState.value?.remindersEnabled === false) {
      return { checked: 0, sent: 0, kickoffSent: 0, failed: 0, unknown: 0, claimed: 0, staleClaims: 0, disabled: true };
    }

    const stale = await clearStaleReminderClaims(cfg).catch(() => ({ prematch: 0, kickoff: 0 }));
    const now = Date.now();
    const from = new Date(now - 8 * 60_000).toISOString();
    const toMs = now + 65 * 60_000;
    let rows = [];

    try {
      rows = await supaSelectMany(cfg, 'match_reminders', {
        enabled: 'eq.true',
        fixture_date: `gte.${from}`,
      }, { limit: 250, order: 'fixture_date.asc' });
      rows = rows.filter(x => Date.parse(x.fixture_date) <= toMs);
    } catch (e) {
      await recordOpsEvent(cfg, {
        severity: 'error',
        source: 'reminders',
        eventType: 'reminder_scheduler',
        code: 'REMINDER_SCHEDULER_READ_FAILED',
        message: e?.message || e,
        endpoint: 'cron:reminders',
      }).catch(() => {});
      return { checked: 0, sent: 0, kickoffSent: 0, failed: 1, unknown: 0, claimed: 0, staleClaims: stale.prematch + stale.kickoff };
    }

    let sent = 0;
    let kickoffSent = 0;
    let failed = 0;
    let unknown = 0;
    let claimed = 0;

    for (const row of rows) {
      const kickoffMs = Date.parse(row.fixture_date);
      if (!Number.isFinite(kickoffMs)) continue;

      const retryAfterMs = Date.parse(row.delivery_retry_after || '');
      if (Number.isFinite(retryAfterMs) && retryAfterMs > now) continue;

      const deltaMinutes = (kickoffMs - now) / 60000;
      const remindBefore = [15, 30, 60].includes(Number(row.remind_before_minutes))
        ? Number(row.remind_before_minutes)
        : 30;
      const kickoffEnabled = row.kickoff_notify !== false;

      try {
        // Cron cadence is 5 minutes in v5.6. This window is deliberately wider
        // than one cron interval so a slightly delayed execution still delivers.
        if (kickoffEnabled && !row.kickoff_notified_at && deltaMinutes <= 4 && deltaMinutes >= -7) {
          const text = `🔴 Матч начинается\n\n${row.home_name} — ${row.away_name}${row.league_name ? `\n${row.league_name}` : ''}\n\nОткройте приложение: центр матча появится, когда источник данных обновит статус.`;
          const delivery = await deliverClaimedReminder(row, 'kickoff', text, cfg);
          if (delivery.state === 'sent') kickoffSent++;
          else if (delivery.state === 'already_claimed') claimed++;
          else if (delivery.state === 'unknown') unknown++;
          else failed++;
          continue;
        }

        const lowerBound = kickoffEnabled ? 5 : 0;
        if (!row.notified_at && deltaMinutes >= lowerBound && deltaMinutes <= remindBefore + 2) {
          const minutes = Math.max(1, Math.round(deltaMinutes));
          const text = `⚽ Скоро матч\n\n${row.home_name} — ${row.away_name}${row.league_name ? `\n${row.league_name}` : ''}\nСтарт примерно через ${minutes} мин.\n\nОткройте приложение для свежего предматчевого анализа.`;
          const delivery = await deliverClaimedReminder(row, 'prematch', text, cfg);
          if (delivery.state === 'sent') sent++;
          else if (delivery.state === 'already_claimed') claimed++;
          else if (delivery.state === 'unknown') unknown++;
          else failed++;
        }
      } catch (e) {
        failed++;
        await recordOpsEvent(cfg, {
          severity: 'warning',
          source: 'reminders',
          eventType: 'reminder_delivery',
          code: 'REMINDER_DELIVERY_EXCEPTION',
          message: e?.message || e,
          endpoint: 'cron:reminders',
          meta: { fixtureId: Number(row.fixture_id || 0) },
        }).catch(() => {});
      }
    }

    const summary = {
      checked: rows.length,
      sent,
      kickoffSent,
      failed,
      unknown,
      claimed,
      staleClaims: stale.prematch + stale.kickoff,
    };

    if (sent || kickoffSent || failed || unknown || summary.staleClaims) {
      await recordOpsEvent(cfg, {
        severity: failed || unknown ? 'warning' : 'info',
        source: 'reminders',
        eventType: 'reminder_scheduler',
        code: failed ? 'REMINDER_RUN_WITH_FAILURES' : unknown ? 'REMINDER_RUN_WITH_UNKNOWN' : 'REMINDER_RUN_OK',
        message: `Планировщик уведомлений: проверено ${rows.length}, предматчевых отправлено ${sent}, у старта ${kickoffSent}, неопределённых доставок ${unknown}, ошибок ${failed}.`,
        endpoint: 'cron:reminders',
        meta: summary,
      }).catch(() => {});
    }

    return summary;
  }

  return {
    deliverClaimedReminder,
    processDueReminders,
  };
}
