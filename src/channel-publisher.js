const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MESSAGE_TEXT_LIMIT = 4096;
const PHOTO_CAPTION_LIMIT = 1024;
const DEDUPE_PREFIX = 'telegram:channel-publish:v1:';
const CTA_TEXT = 'Открыть матч в MatchRadar';

function publisherError(message, code, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function positiveSafeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function normalizedChannelId(value) {
  return String(value || '').trim();
}

function validChannelId(value) {
  const channelId = normalizedChannelId(value);
  return /^@[A-Za-z0-9_]{5,32}$/.test(channelId) || /^-?\d{5,}$/.test(channelId);
}

export function channelPublisherState(cfg = {}) {
  const publisherBotToken = String(cfg.publisherBotToken || '').trim();
  const primaryBotToken = String(cfg.botToken || '').trim();
  const channelId = normalizedChannelId(cfg.telegramChannelId);
  if (!publisherBotToken) return { enabled:false, reason:'missing_publisher_token', channelId };
  if (primaryBotToken && publisherBotToken === primaryBotToken) {
    return { enabled:false, reason:'publisher_token_must_be_separate', channelId };
  }
  if (!channelId) return { enabled:false, reason:'missing_channel_id', channelId };
  if (!validChannelId(channelId)) return { enabled:false, reason:'invalid_channel_id', channelId };
  return { enabled:true, reason:'ready', channelId };
}

function safeText(value, limit, field) {
  const text = String(value || '').trim();
  if (!text) throw publisherError(`${field} is required.`, 'PUBLISHER_INVALID_PAYLOAD');
  if (text.length > limit) throw publisherError(`${field} exceeds Telegram limit.`, 'PUBLISHER_INVALID_PAYLOAD');
  return text;
}

function safeCtaUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw publisherError('Fixture CTA URL is required.', 'PUBLISHER_CTA_REQUIRED');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw publisherError('Fixture CTA URL is invalid.', 'PUBLISHER_CTA_INVALID');
  }
  if (url.protocol !== 'https:') throw publisherError('Fixture CTA URL must use HTTPS.', 'PUBLISHER_CTA_INVALID');
  return url.toString();
}

export function fixtureChannelCta(ctaUrl) {
  return {
    inline_keyboard: [[{ text: CTA_TEXT, url: safeCtaUrl(ctaUrl) }]],
  };
}

function endpoint(cfg, method) {
  const state = channelPublisherState(cfg);
  if (!state.enabled) throw publisherError(`Channel publisher disabled: ${state.reason}`, 'PUBLISHER_DISABLED');
  return {
    state,
    url: `${TELEGRAM_API_BASE}/bot${String(cfg.publisherBotToken).trim()}/${method}`,
  };
}

async function publisherTelegramApi(method, cfg, body = {}, options = {}) {
  const { state, url } = endpoint(cfg, method);
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(url, {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(body || {}),
      signal:controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok !== true) {
      throw publisherError(
        data?.description || `Telegram ${method}: HTTP ${response.status}`,
        'PUBLISHER_TELEGRAM_ERROR',
        { status:Number(response.status) || null },
      );
    }
    if (!data?.result || typeof data.result !== 'object' || Array.isArray(data.result)) {
      throw publisherError(
        `Telegram ${method} returned an invalid success payload.`,
        'PUBLISHER_TELEGRAM_RESULT_INVALID',
        { deliveryUncertain:true },
      );
    }
    return { state, result:data.result };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendMessage(cfg, { text, ctaUrl } = {}, options = {}) {
  const state = channelPublisherState(cfg);
  if (!state.enabled) throw publisherError(`Channel publisher disabled: ${state.reason}`, 'PUBLISHER_DISABLED');
  const payload = {
    chat_id: state.channelId,
    text: safeText(text, MESSAGE_TEXT_LIMIT, 'text'),
    disable_web_page_preview: true,
    reply_markup: fixtureChannelCta(ctaUrl),
  };
  return (await publisherTelegramApi('sendMessage', cfg, payload, options)).result;
}

export async function sendPhoto(cfg, { photo, caption, ctaUrl } = {}, options = {}) {
  const state = channelPublisherState(cfg);
  if (!state.enabled) throw publisherError(`Channel publisher disabled: ${state.reason}`, 'PUBLISHER_DISABLED');
  const photoValue = safeText(photo, 2048, 'photo');
  const payload = {
    chat_id: state.channelId,
    photo: photoValue,
    caption: safeText(caption, PHOTO_CAPTION_LIMIT, 'caption'),
    reply_markup: fixtureChannelCta(ctaUrl),
  };
  return (await publisherTelegramApi('sendPhoto', cfg, payload, options)).result;
}

function cleanIdempotencyKey(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  if (!/^[A-Za-z0-9._:-]{1,96}$/.test(key)) {
    throw publisherError('idempotencyKey contains unsupported characters.', 'PUBLISHER_INVALID_IDEMPOTENCY_KEY');
  }
  return key;
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function publisherDedupeKey({ channelId, fixtureId, text, idempotencyKey } = {}) {
  const explicit = cleanIdempotencyKey(idempotencyKey);
  if (explicit) return `${DEDUPE_PREFIX}key:${explicit}`;
  const canonical = JSON.stringify({
    channelId: normalizedChannelId(channelId),
    fixtureId: Number(fixtureId || 0),
    text: String(text || '').trim(),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `${DEDUPE_PREFIX}sha256:${hex(digest).slice(0, 40)}`;
}

export async function publishChannelMessage(input = {}, deps = {}) {
  const cfg = input.cfg || {};
  const state = channelPublisherState(cfg);
  if (!state.enabled) {
    return { ok:false, published:false, disabled:true, code:'PUBLISHER_DISABLED', reason:state.reason };
  }
  const fixtureId = positiveSafeInteger(input.fixtureId);
  if (!fixtureId) {
    throw publisherError('A valid fixtureId is required.', 'PUBLISHER_FIXTURE_REQUIRED');
  }
  const text = safeText(input.text, MESSAGE_TEXT_LIMIT, 'text');
  const ctaUrl = safeCtaUrl(input.ctaUrl);
  const dedupeKey = await publisherDedupeKey({
    channelId:state.channelId,
    fixtureId,
    text,
    idempotencyKey:input.idempotencyKey,
  });
  if (typeof deps.claimIdempotency !== 'function'
    || typeof deps.completeIdempotency !== 'function'
    || typeof deps.releaseIdempotency !== 'function') {
    throw publisherError('Publisher idempotency dependencies are unavailable.', 'PUBLISHER_IDEMPOTENCY_UNAVAILABLE');
  }

  const claim = await deps.claimIdempotency(dedupeKey, { fixtureId, channelId:state.channelId });
  if (claim?.unavailable === true) {
    return { ok:false, published:false, code:'PUBLISHER_IDEMPOTENCY_UNAVAILABLE', dedupeKey };
  }
  if (claim?.claimed !== true) {
    return {
      ok:true,
      published:false,
      duplicate:true,
      inProgress:claim?.inProgress === true,
      messageId:positiveSafeInteger(claim?.messageId) || null,
      dedupeKey,
      channelId:state.channelId,
    };
  }

  let claimId = '';
  try { claimId = cleanIdempotencyKey(claim?.claimId); } catch {}

  if (!claimId) {
    throw publisherError('Publisher idempotency claim did not return a valid claimId.', 'PUBLISHER_IDEMPOTENCY_INVALID_CLAIM');
  }

  let telegramAccepted = false;
  let messageId = null;
  try {
    const result = await sendMessage(cfg, { text, ctaUrl }, { fetchImpl:deps.fetchImpl });
    telegramAccepted = true;
    messageId = positiveSafeInteger(result?.message_id) || null;
    if (!messageId) {
      throw publisherError(
        'Telegram accepted the publish request but did not return a valid message_id.',
        'PUBLISHER_TELEGRAM_RESULT_INVALID',
        { deliveryUncertain:true },
      );
    }
    await deps.completeIdempotency(dedupeKey, {
      claimId,
      fixtureId,
      channelId:state.channelId,
      messageId,
    });
    return {
      ok:true,
      published:true,
      duplicate:false,
      messageId,
      dedupeKey,
      channelId:state.channelId,
    };
  } catch (error) {
    if (!telegramAccepted && error?.deliveryUncertain !== true) {
      try {
        await Promise.resolve(deps.releaseIdempotency(dedupeKey, { claimId }));
      } catch {
        // Failed release keeps the claim fail-closed rather than risking a duplicate publish.
      }
    }
    if (telegramAccepted || error?.deliveryUncertain === true) {
      error.deliveryUncertain = true;
      error.dedupeKey = dedupeKey;
      error.messageId = messageId;
    }
    throw error;
  }
}
