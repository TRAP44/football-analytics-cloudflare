// Phase 2 Telegram boundary: webhook transport/orchestration only.
// Command semantics and Telegram business handlers remain injected by the composition root.
export function createTelegramWebhookHandler(deps) {
  const {
    claimTelegramUpdate,
    claimTelegramUpdatePersistent,
    completeTelegramUpdate,
    completeTelegramUpdatePersistent,
    constantTimeEqual,
    enforceTelegramBurst,
    json,
    processTelegramUpdate,
    releaseTelegramUpdate,
    releaseTelegramUpdatePersistent,
    telegramApi,
  } = deps;

  return async function handleTelegramWebhook(request, cfg) {
  if (!cfg.webhookSecret) return json({ ok: false, error: 'webhook_secret_missing' }, 503);
  const provided=request.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!constantTimeEqual(String(provided),String(cfg.webhookSecret))) return json({ok:false},403);

  let update={};
  try { update=await request.json(); } catch { return json({ok:false},400); }

  const claim=claimTelegramUpdate(update);
  if (claim.duplicate) return json({ok:true,deduped:true});

  const persistentClaim=await claimTelegramUpdatePersistent(cfg,claim.key);
  if (persistentClaim.duplicate) {
    completeTelegramUpdate(claim.key);
    return json({ok:true,deduped:true,persistent:true});
  }

  const burst=enforceTelegramBurst(update);
  if (burst?.blocked) {
    completeTelegramUpdate(claim.key);
    await completeTelegramUpdatePersistent(cfg,claim.key);
    const callbackId=String(update?.callback_query?.id || '');
    if (callbackId) {
      await telegramApi('answerCallbackQuery',cfg,{
        callback_query_id:callbackId,
        text:`Слишком много действий подряд. Повторите через ${burst.retryAfter} сек.`,
      }).catch(()=>null);
    }
    return json({ok:true,throttled:true,retryAfter:burst.retryAfter});
  }

  try {
    const response=await processTelegramUpdate(request,cfg,update);
    completeTelegramUpdate(claim.key);
    await completeTelegramUpdatePersistent(cfg,claim.key);
    return response;
  } catch (error) {
    releaseTelegramUpdate(claim.key);
    await releaseTelegramUpdatePersistent(cfg,claim.key);
    throw error;
  }

  };
}
