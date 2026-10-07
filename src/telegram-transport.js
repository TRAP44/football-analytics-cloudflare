import { beginTelegramWebhookAttempt, classifyTelegramWebhookFailure, endTelegramWebhookAttempt } from './telegram-webhook-retry.js';

const MAX_WEBHOOK_SECRET_LENGTH = 256;
const MAX_DEDUPE_KEY_LENGTH = 180;
const MAX_UPDATE_BODY_CHARS = 1_048_576;
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

// Phase 2 Telegram boundary: webhook transport/orchestration only.
// Command semantics and Telegram business handlers remain injected by the composition root.
export function createTelegramWebhookHandler(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Telegram webhook transport dependencies are required.');
  }

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

  function textValue(value, max = 240) {
    if (typeof value !== 'string' || value.length > Math.max(max * 4,max)) return '';
    const text=value.trim();
    if (!text || /[\u0000-\u001f\u007f-\u009f]/u.test(text)) return '';
    return text.slice(0,max);
  }

  function webhookSecretValue(value) {
    if (typeof value !== 'string' || value.length > MAX_WEBHOOK_SECRET_LENGTH) return '';
    const secret=value.trim();
    return WEBHOOK_SECRET_PATTERN.test(secret) ? secret : '';
  }

  function dedupeKeyValue(value) {
    if (typeof value !== 'string' || value.length > MAX_DEDUPE_KEY_LENGTH) return '';
    const key=value.trim();
    if (!key || /[\u0000-\u001f\u007f-\u009f]/u.test(key)) return '';
    return key;
  }

  function positiveRetryAfter(value, fallback = 3, max = 3600) {
    let number=null;
    if (typeof value === 'number' && Number.isSafeInteger(value)) number=value;
    else if (typeof value === 'string' && value.length<=12 && /^\d+$/.test(value.trim())) number=Number(value.trim());
    return Number.isSafeInteger(number) && number>=1 && number<=max ? number : fallback;
  }

  function normalizeError(error, fallbackMessage = 'Telegram webhook processing failed.') {
    if (error instanceof Error) return error;
    const source=plainObject(error);
    const normalized=new Error(textValue(source?.message,500) || fallbackMessage);
    const code=textValue(source?.code,80);
    if (code) normalized.code=code;
    if (source?.telegramWebhookRetrySafe === true) normalized.telegramWebhookRetrySafe=true;
    const retryAfter=positiveRetryAfter(source?.retryAfter,0);
    if (retryAfter>0) normalized.retryAfter=retryAfter;
    return normalized;
  }

  function attachDisposition(error, cfg, extra = {}) {
    const disposition=classifyTelegramWebhookFailure(error,cfg);
    error.telegramWebhookRetry=Boolean(disposition.retry);
    error.telegramWebhookDisposition={...disposition,...extra};
    return error;
  }

  function safeCompleteLocal(key) {
    try { completeTelegramUpdate(key); } catch {}
  }

  function safeReleaseLocal(key) {
    try { releaseTelegramUpdate(key); } catch {}
  }

  async function safeCompletePersistent(cfg,key) {
    try {
      return await completeTelegramUpdatePersistent(cfg,key) === true;
    } catch {
      return false;
    }
  }

  async function safeReleasePersistent(cfg,key) {
    try {
      return await releaseTelegramUpdatePersistent(cfg,key) === true;
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

  function invalidProcessResponseError() {
    return Object.assign(
      new Error('Telegram update processor returned an invalid response.'),
      {
        code:'TELEGRAM_UPSTREAM',
        telegramWebhookRetrySafe:true,
      },
    );
  }

  function validProcessorResponse(value) {
    if (typeof Response !== 'undefined' && value instanceof Response) return true;
    const source=plainObject(value);
    const status=source?.status;
    return Number.isSafeInteger(status) && status>=100 && status<=599;
  }

  async function readUpdate(request) {
    const contentLengthRaw=textValue(request?.headers?.get?.('content-length'),24);
    if (contentLengthRaw && /^\d+$/.test(contentLengthRaw)) {
      const contentLength=Number(contentLengthRaw);
      if (Number.isSafeInteger(contentLength) && contentLength>MAX_UPDATE_BODY_CHARS) {
        return {error:'too_large'};
      }
    }

    if (typeof request?.text === 'function') {
      let raw;
      try { raw=await request.text(); }
      catch { return {error:'invalid_json'}; }
      if (typeof raw !== 'string' || raw.length>MAX_UPDATE_BODY_CHARS) return {error:'too_large'};
      let parsed;
      try { parsed=JSON.parse(raw); }
      catch { return {error:'invalid_json'}; }
      return {update:plainObject(parsed)};
    }

    if (typeof request?.json === 'function') {
      try {
        return {update:plainObject(await request.json())};
      } catch {
        return {error:'invalid_json'};
      }
    }

    return {error:'invalid_json'};
  }

  function normalizedClaim(value) {
    const source=plainObject(value);
    if (!source || typeof source.duplicate !== 'boolean') return null;
    return {
      ...source,
      key:dedupeKeyValue(source.key),
      duplicate:source.duplicate,
    };
  }

  function normalizedPersistentClaim(value) {
    const source=plainObject(value);
    if (
      !source
      || typeof source.claimed !== 'boolean'
      || typeof source.duplicate !== 'boolean'
      || (source.claimed === true && source.duplicate === true)
      || (source.duplicate === true && source.retry === true)
    ) return null;
    return {
      ...source,
      claimed:source.claimed,
      duplicate:source.duplicate,
      retry:source.retry === true,
      persistent:source.persistent !== false,
      risk:textValue(source.risk,80),
    };
  }

  return async function handleTelegramWebhook(request, cfg) {
    const sourceCfg=plainObject(cfg) || {};
    cfg={...sourceCfg};

    const webhookSecret=webhookSecretValue(cfg.webhookSecret);
    if (!webhookSecret) return json({ok:false,error:'webhook_secret_missing'},503);

    let provided='';
    try {
      provided=webhookSecretValue(request?.headers?.get?.('x-telegram-bot-api-secret-token'));
    } catch {}
    let secretMatches=false;
    try { secretMatches=Boolean(provided) && constantTimeEqual(provided,webhookSecret) === true; } catch {}
    if (!secretMatches) return json({ok:false},403);

    const read=await readUpdate(request);
    if (read.error === 'too_large') return json({ok:false,error:'update_too_large'},413);
    if (!read.update) return json({ok:false},400);
    const update=read.update;

    let claim;
    try {
      claim=normalizedClaim(claimTelegramUpdate(update,cfg));
    } catch {
      return json({ok:false},500);
    }
    if (!claim) return json({ok:false},500);
    if (claim.duplicate === true) return json({ok:true,deduped:true});

    let persistentClaim;
    try {
      persistentClaim=normalizedPersistentClaim(
        await claimTelegramUpdatePersistent(cfg,claim.key,update),
      );
    } catch (caught) {
      safeReleaseLocal(claim.key);
      // Claim ownership is unknown after an exception. Do not release the
      // durable row: another isolate may own the same update.
      throw attachDisposition(
        dedupeUnavailableError({},normalizeError(caught)),
        cfg,
      );
    }

    if (!persistentClaim) {
      safeReleaseLocal(claim.key);
      throw attachDisposition(dedupeUnavailableError(),cfg);
    }

    if (persistentClaim.duplicate === true) {
      // A persistent duplicate may be an active claim owned by another
      // isolate. Completing that row here would corrupt the other lease.
      safeCompleteLocal(claim.key);
      return json({ok:true,deduped:true,persistent:true});
    }

    if (persistentClaim.retry === true || persistentClaim.claimed !== true) {
      safeReleaseLocal(claim.key);
      if (persistentClaim.claimed === true && persistentClaim.persistent === true) {
        await safeReleasePersistent(cfg,claim.key);
      }
      throw attachDisposition(
        dedupeUnavailableError(persistentClaim),
        cfg,
        {dedupeRisk:persistentClaim.risk},
      );
    }

    const ownsPersistentClaim=persistentClaim.persistent === true;

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
        if (ownsPersistentClaim) await safeReleasePersistent(cfg,claim.key);
      } else {
        safeCompleteLocal(claim.key);
        if (ownsPersistentClaim) await safeCompletePersistent(cfg,claim.key);
      }
      throw error;
    }

    if (burst?.blocked === true) {
      safeCompleteLocal(claim.key);
      if (ownsPersistentClaim) await safeCompletePersistent(cfg,claim.key);
      const callbackId=textValue(update?.callback_query?.id,120);
      const retryAfter=positiveRetryAfter(burst.retryAfter,1);
      if (callbackId) {
        try {
          await telegramApi('answerCallbackQuery',cfg,{
            callback_query_id:callbackId,
            text:`Слишком много действий подряд. Повторите через ${retryAfter} сек.`,
          });
        } catch {}
      }
      return json({ok:true,throttled:true,retryAfter});
    }

    beginTelegramWebhookAttempt(cfg);
    try {
      const response=await processTelegramUpdate(request,cfg,update);
      if (!validProcessorResponse(response)) throw invalidProcessResponseError();

      safeCompleteLocal(claim.key);
      if (ownsPersistentClaim) {
        const completed=await completeTelegramUpdatePersistent(cfg,claim.key).catch(()=>false);
        if (completed !== true) {
          throw attachDisposition(dedupeUnavailableError(),cfg);
        }
      }
      return response;
    } catch (caught) {
      const error=normalizeError(caught);
      const alreadyClassified=plainObject(error.telegramWebhookDisposition);
      const disposition=alreadyClassified || classifyTelegramWebhookFailure(error,cfg);
      error.telegramWebhookRetry=Boolean(disposition.retry);
      error.telegramWebhookDisposition=disposition;
      if (error.code === 'TELEGRAM_DEDUPE_UNAVAILABLE' && alreadyClassified) {
        // Processing finished, but the durable completion marker failed.
        // Keep both local and persistent claims in place so the retry is
        // absorbed by dedupe rather than executing side effects twice.
      } else if (disposition.retry) {
        safeReleaseLocal(claim.key);
        if (ownsPersistentClaim) await releaseTelegramUpdatePersistent(cfg,claim.key).catch(()=>false);
      } else {
        safeCompleteLocal(claim.key);
        if (ownsPersistentClaim) await completeTelegramUpdatePersistent(cfg,claim.key).catch(()=>false);
      }
      throw error;
    } finally {
      endTelegramWebhookAttempt(cfg);
    }
  };
}
