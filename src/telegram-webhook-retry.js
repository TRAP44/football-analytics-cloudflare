const RETRYABLE_CODES = new Set([
  'TELEGRAM_NETWORK',
  'TELEGRAM_TIMEOUT',
  'TELEGRAM_RATE_LIMIT',
  'TELEGRAM_UPSTREAM',
  'TELEGRAM_DEDUPE_UNAVAILABLE',
]);

const MAX_ATTEMPT_COUNTER = 1_000_000;
const MAX_RETRY_AFTER_SECONDS = 86_400;
const MAX_LABEL_LENGTH = 80;

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function textValue(value, max = MAX_LABEL_LENGTH) {
  if (typeof value !== 'string') return '';
  const text=value.trim();
  if (!text || /[\u0000-\u001f\u007f-\u009f]/u.test(text)) return '';
  return text.slice(0,max);
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function boundedCounter(value, { missing = 0, invalid = MAX_ATTEMPT_COUNTER } = {}) {
  if (value === undefined || value === null || value === '') return missing;
  const number=integerCandidate(value);
  if (number === null || number<0 || number>MAX_ATTEMPT_COUNTER) return invalid;
  return number;
}

function retryAfterSeconds(value) {
  if (value === undefined || value === null || value === '') return 0;
  const number=integerCandidate(value);
  if (number === null || number<0) return 0;
  return Math.min(number,MAX_RETRY_AFTER_SECONDS);
}

function safeIncrement(value) {
  const current=boundedCounter(value);
  return Math.min(MAX_ATTEMPT_COUNTER,current+1);
}

function stateFor(cfg) {
  const source=plainObject(cfg);
  return plainObject(source?.telegramWebhookAttempt);
}

export function beginTelegramWebhookAttempt(cfg) {
  const source=plainObject(cfg);
  if (!source) return null;
  const state = {
    active: true,
    startedAt: Date.now(),
    successfulEffects: 0,
    unsafeMutations: 0,
    lastEffect: '',
    lastMutation: '',
  };
  try {
    source.telegramWebhookAttempt=state;
  } catch {
    return null;
  }
  return state;
}

export function markTelegramWebhookEffect(cfg, label = '') {
  const state=stateFor(cfg);
  if (state?.active !== true) return false;
  state.successfulEffects=safeIncrement(state.successfulEffects);
  state.lastEffect=textValue(label);
  return true;
}

export function markTelegramWebhookMutation(cfg, label = '') {
  const state=stateFor(cfg);
  if (state?.active !== true) return false;
  state.unsafeMutations=safeIncrement(state.unsafeMutations);
  state.lastMutation=textValue(label);
  return true;
}

export function classifyTelegramWebhookFailure(error, cfg) {
  const state=stateFor(cfg);
  const code=textValue(error?.code);
  const transient=RETRYABLE_CODES.has(code);
  const retrySafe=error?.telegramWebhookRetrySafe === true;
  const successfulEffects=state
    ? boundedCounter(state.successfulEffects)
    : 0;
  const unsafeMutations=state
    ? boundedCounter(state.unsafeMutations)
    : 0;
  const retry=Boolean(
    (transient || retrySafe)
    && successfulEffects === 0
    && (unsafeMutations === 0 || retrySafe)
  );

  return {
    retry,
    transient,
    retrySafe,
    code:code || 'TELEGRAM_WEBHOOK_FAILURE',
    retryAfter:retryAfterSeconds(error?.retryAfter),
    successfulEffects,
    unsafeMutations,
    lastEffect:textValue(state?.lastEffect),
    lastMutation:textValue(state?.lastMutation),
  };
}

export function endTelegramWebhookAttempt(cfg) {
  const state=stateFor(cfg);
  if (state) state.active=false;
  return state;
}
