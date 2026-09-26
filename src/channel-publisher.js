const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MESSAGE_TEXT_LIMIT = 4096;
const PHOTO_CAPTION_LIMIT = 1024;
const DEDUPE_PREFIX = 'telegram:channel-publish:v1:';
const CTA_TEXT = 'Открыть матч в MatchRadar';

function publisherError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
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
    if (!response.ok || !data?.ok) {
      throw publisherError(data?.description || `Telegram ${method}: HTTP ${response.status}`, 'PUBLISHER_TELEGRAM_ERROR');
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
  const fixtureId = Number(input.fixtureId || 0);
  if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
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
  if (claim?.unavailable) {
    return { ok:false, published:false, code:'PUBLISHER_IDEMPOTENCY_UNAVAILABLE', dedupeKey };
  }
  if (!claim?.claimed) {
    return {
      ok:true,
      published:false,
      duplicate:true,
      inProgress:Boolean(claim?.inProgress),
      messageId:Number(claim?.messageId || 0) || null,
      dedupeKey,
      channelId:state.channelId,
    };
  }

  try {
    const result = await sendMessage(cfg, { text, ctaUrl }, { fetchImpl:deps.fetchImpl });
    const messageId = Number(result?.message_id || 0) || null;
    await deps.completeIdempotency(dedupeKey, {
      claimId:claim.claimId,
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
    await deps.releaseIdempotency(dedupeKey, { claimId:claim.claimId }).catch(() => {});
    throw error;
  }
}
