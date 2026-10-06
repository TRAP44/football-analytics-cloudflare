// Telegram delivery and reminder-reliability schema helpers extracted from worker.js.
export function createReminderDeliveryRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Reminder delivery runtime dependencies are required.');
  }
  const {
    fetchWithTimeout,
    hasSupabase,
    redactOpsString,
    supaHeaders,
  } = deps;

  async function sendTelegramMessage(chatId, text, cfg, options = {}) {
    if (!cfg.botToken) {
      return {
        ok:false,
        status:0,
        outcome:'not_started',
        errorCode:0,
        description:'Токен Telegram-бота отсутствует.',
        retryAfter:0,
      };
    }
  
    try {
      const r = await fetchWithTimeout(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body:JSON.stringify({
          chat_id:Number(chatId),
          text,
          disable_web_page_preview:options.disableWebPagePreview !== false,
          ...(options.parseMode ? { parse_mode:String(options.parseMode) } : {}),
          ...(options.replyMarkup ? { reply_markup:options.replyMarkup } : {}),
        }),
      },7000,'Telegram sendMessage');
  
      const body = await r.json().catch(() => null);
      const ok = Boolean(r.ok && body?.ok !== false);
      return {
        ok,
        status:Number(r.status || 0),
        outcome:ok ? 'sent' : 'confirmed_failure',
        errorCode:Number(body?.error_code || 0),
        description:redactOpsString(body?.description || (r.ok ? '' : `Telegram HTTP ${r.status}`),220),
        retryAfter:Number(body?.parameters?.retry_after || r.headers.get('retry-after') || 0),
      };
    } catch (error) {
      return {
        ok:false,
        status:0,
        outcome:'unknown',
        errorCode:0,
        description:redactOpsString(error?.message || 'Telegram network error.',220),
        retryAfter:0,
      };
    }
  }
  
  async function probeReminderReliabilitySchema(cfg) {
    if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
  
    try {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
      url.searchParams.set(
        'select',
        'fixture_id,prematch_claimed_at,kickoff_claimed_at,prematch_attempts,kickoff_attempts,delivery_last_error,delivery_last_attempt_at,delivery_last_success_at,delivery_disabled_reason,delivery_retry_after'
      );
      url.searchParams.set('limit', '1');
      const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, 'Supabase reminder reliability schema');
      return { ok: r.ok, status: r.ok ? 'ok' : `http_${r.status}` };
    } catch (error) {
      return { ok: false, status: error?.code || 'error' };
    }
  }

  return {
    sendTelegramMessage,
    probeReminderReliabilitySchema,
  };
}
