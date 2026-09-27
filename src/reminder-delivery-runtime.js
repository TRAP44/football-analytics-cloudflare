export function createReminderDeliveryRuntime({
  claimReminderDelivery,
  finishReminderDelivery,
  releaseReminderClaim,
  sendTelegramMessage,
  recordOpsEvent,
}) {
  async function recordReminderDelivery(cfg, { row, kind, result, success, disabled = false }) {
    const code = success
      ? (kind === 'kickoff' ? 'REMINDER_SENT_KICKOFF' : 'REMINDER_SENT_PREMATCH')
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
        : `Reminder ${kind} delivery failed: ${result?.description || 'unknown error'}`,
      endpoint: 'cron:reminders',
      status: Number(result?.status || 0) || null,
      meta: {
        fixtureId: Number(row?.fixture_id || 0),
        kind,
        telegramStatus: Number(result?.status || 0) || null,
        telegramErrorCode: Number(result?.errorCode || 0) || null,
        retryAfter: Number(result?.retryAfter || 0) || null,
      },
    });
  }

  async function deliverClaimedReminder(row, kind, text, cfg) {
    const claim = await claimReminderDelivery(row, kind, cfg);
    if (!claim.claimed) return { state: 'already_claimed' };

    const result = await sendTelegramMessage(row.telegram_id, text, cfg);

    if (result.ok) {
      await finishReminderDelivery(row, kind, claim.claimAt, cfg);
      await recordReminderDelivery(cfg, { row, kind, result, success: true }).catch(() => {});
      return { state: 'sent', result };
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

  return {
    recordReminderDelivery,
    deliverClaimedReminder,
  };
}
