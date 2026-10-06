import { beginTelegramWebhookAttempt, classifyTelegramWebhookFailure, endTelegramWebhookAttempt } from './telegram-webhook-retry.js';

// Phase 2 Telegram boundary: webhook transport/orchestration only.
// Command semantics and Telegram business handlers remain injected by the composition root.
export function createTelegramWebhookHandler(deps) {
  const sourceDeps=deps && typeof deps === 'object' && !Array.isArray(deps) ? deps : {};
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
  } = sourceDeps;

  const requiredDependencies={
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
  };
  for (const [name,value] of Object.entries(requiredDependencies)) {
    if (typeof value !== 'function') {
      throw new TypeError(`Telegram webhook transport requires ${name}.`);
    }
  }

  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function textValue(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function positiveRetryAfter(value, fallback = 3, max = 3600) {
    let number=null;
    if (typeof value === 'number' && Number.isSafeInteger(value)) number=value;
    else if (typeof value === 'string' && /^\d+$/.test(value.trim())) number=Number(value.trim());
    return Number.isSafeInteger(number) && number>=1 && number<=max ? number : fallback;
  }

  function normalizeError(error, fallbackMessage = 'Telegram webhook processing failed.') {
    if (error instanceof Error) return error;
    const source=plainObject(error);
    const normalized=new Error(textValue(source?.message) || fallbackMessage);
    if (typeof source?.code === 'string' && source.code.trim()) normalized.code=source.code.trim();
    if (source?.telegramWebhookRetrySafe === true) normalized.telegramWebhookRetrySafe=true;
    const retryAfter=positiveRetryAfter(source?.retryAfter,0);
    if (retryAfter>0) normalized.retryAfter=retryAfter;
    return normalized;
  }

  function safeCompleteLocal(key) {
    try { completeTelegramUpdate(key); } catch {}
  }

  function safeReleaseLocal(key) {
    try { releaseTelegramUpdate(key); } catch {}
  }

  async function safeCompletePersistent(cfg,key) {
    try {
      await completeTelegramUpdatePersistent(cfg,key);
      return true;
    } catch {
      return false;
    }
  }

  async function safeReleasePersistent(cfg,key) {
    try {
      await releaseTelegramUpdatePersistent(cfg,key);
      return true;
    } catch {
      return false;
    }
  }

  function dedupeUnavailableError(persistentClaim = {}, cause = null) {
    const source=plainObject(persistentClaim) || {};
    const error=Object.assign(
      new Error('Persistent Telegram dedupe is temporarily unavailable.'),
      {
        code:'TELEGRAM_DEDUPE_UNAVAILABLE',
        retryAfter:positiveRetryAfter(source.retryAfter,3,60),
        telegramWebhookRetrySafe:true,
      },
    );
    if (cause instanceof Error) error.cause=cause;
    return error;
  }

  return async function handleTelegramWebhook(request, cfg) {
    cfg=plainObject(cfg) || {};
    const webhookSecret=textValue(cfg.webhookSecret);
    if (!webhookSecret) return json({ ok:false, error:'webhook_secret_missing' },503);

    const provided=textValue(request?.headers?.get?.('x-telegram-bot-api-secret-token'));
    let secretMatches=false;
    try { secretMatches=constantTimeEqual(provided,webhookSecret) === true; } catch {}
    if (!secretMatches) return json({ok:false},403);

    let update={};
    try {
      update=await request.json();
    } catch {
      return json({ok:false},400);
    }
    if (!plainObject(update)) return json({ok:false},400);

    let claim;
    try {
      claim=plainObject(claimTelegramUpdate(update,cfg)) || {};
    } catch {
      return json({ok:false},500);
    }
    if (claim.duplicate === true) return json({ok:true,deduped:true});

    let persistentClaim;
    try {
      persistentClaim=plainObject(await claimTelegramUpdatePersistent(cfg,claim.key,update)) || {};
    } catch (caught) {
      safeReleaseLocal(claim.key);
      await safeReleasePersistent(cfg,claim.key);
      const error=dedupeUnavailableError({},normalizeError(caught));
      const disposition=classifyTelegramWebhookFailure(error,cfg);
      error.telegramWebhookRetry=Boolean(disposition.retry);
      error.telegramWebhookDisposition=disposition;
      throw error;
    }

    if (persistentClaim.duplicate === true) {
      safeCompleteLocal(claim.key);
      await safeCompletePersistent(cfg,claim.key);
      return json({ok:true,deduped:true,persistent:true});
    }

    if (persistentClaim.retry === true || persistentClaim.claimed !== true) {
      safeReleaseLocal(claim.key);
      if (persistentClaim.claimed === true) await safeReleasePersistent(cfg,claim.key);
      const error=dedupeUnavailableError(persistentClaim);
      const disposition=classifyTelegramWebhookFailure(error,cfg);
      error.telegramWebhookRetry=Boolean(disposition.retry);
      error.telegramWebhookDisposition={
        ...disposition,
        dedupeRisk:textValue(persistentClaim.risk),
      };
      throw error;
    }

    let burst=null;
    try {
      burst=enforceTelegramBurst(update);
    } catch (caught) {
      const error=normalizeError(caught);
      const disposition=classifyTelegramWebhookFailure(error,cfg);
      error.telegramWebhookRetry=Boolean(disposition.retry);
      error.telegramWebhookDisposition=disposition;
      if (disposition.retry) {
        safeReleaseLocal(claim.key);
        await safeReleasePersistent(cfg,claim.key);
      } else {
        safeCompleteLocal(claim.key);
        await safeCompletePersistent(cfg,claim.key);
      }
      throw error;
    }

    if (burst?.blocked === true) {
      safeCompleteLocal(claim.key);
      await safeCompletePersistent(cfg,claim.key);
      const callbackId=textValue(update?.callback_query?.id);
      const retryAfter=positiveRetryAfter(burst.retryAfter,1);
      if (callbackId) {
        await telegramApi('answerCallbackQuery',cfg,{
          callback_query_id:callbackId,
          text:`Слишком много действий подряд. Повторите через ${retryAfter} сек.`,
        }).catch(()=>null);
      }
      return json({ok:true,throttled:true,retryAfter});
    }

    beginTelegramWebhookAttempt(cfg);
    try {
      const response=await processTelegramUpdate(request,cfg,update);
      safeCompleteLocal(claim.key);
      await completeTelegramUpdatePersistent(cfg,claim.key).catch(()=>false);
      endTelegramWebhookAttempt(cfg);
      return response;
    } catch (caught) {
      const error=normalizeError(caught);
      const disposition=classifyTelegramWebhookFailure(error,cfg);
      error.telegramWebhookRetry=Boolean(disposition.retry);
      error.telegramWebhookDisposition=disposition;
      if (disposition.retry) {
        safeReleaseLocal(claim.key);
        try { await releaseTelegramUpdatePersistent(cfg,claim.key); } catch {}
      } else {
        safeCompleteLocal(claim.key);
        try { await completeTelegramUpdatePersistent(cfg,claim.key); } catch {}
      }
      endTelegramWebhookAttempt(cfg);
      throw error;
    }
  };
}
