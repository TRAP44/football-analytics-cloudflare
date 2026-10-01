const RETRYABLE_CODES = new Set([
  'TELEGRAM_NETWORK',
  'TELEGRAM_TIMEOUT',
  'TELEGRAM_RATE_LIMIT',
  'TELEGRAM_UPSTREAM',
]);

function stateFor(cfg) {
  return cfg?.telegramWebhookAttempt && typeof cfg.telegramWebhookAttempt === 'object'
    ? cfg.telegramWebhookAttempt
    : null;
}

export function beginTelegramWebhookAttempt(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const state = {
    active: true,
    startedAt: Date.now(),
    successfulEffects: 0,
    unsafeMutations: 0,
    lastEffect: '',
    lastMutation: '',
  };
  cfg.telegramWebhookAttempt = state;
  return state;
}

export function markTelegramWebhookEffect(cfg, label = '') {
  const state = stateFor(cfg);
  if (!state?.active) return false;
  state.successfulEffects += 1;
  state.lastEffect = String(label || '').slice(0, 80);
  return true;
}

export function markTelegramWebhookMutation(cfg, label = '') {
  const state = stateFor(cfg);
  if (!state?.active) return false;
  state.unsafeMutations += 1;
  state.lastMutation = String(label || '').slice(0, 80);
  return true;
}

export function classifyTelegramWebhookFailure(error, cfg) {
  const state = stateFor(cfg) || {};
  const code = String(error?.code || '');
  const transient = RETRYABLE_CODES.has(code);
  const retrySafe = error?.telegramWebhookRetrySafe === true;
  const successfulEffects = Math.max(0, Number(state.successfulEffects || 0));
  const unsafeMutations = Math.max(0, Number(state.unsafeMutations || 0));
  const retry = Boolean(
    (transient || retrySafe)
    && successfulEffects === 0
    && (unsafeMutations === 0 || retrySafe)
  );

  return {
    retry,
    transient,
    retrySafe,
    code: code || 'TELEGRAM_WEBHOOK_FAILURE',
    retryAfter: Math.max(0, Number(error?.retryAfter || 0)),
    successfulEffects,
    unsafeMutations,
    lastEffect: String(state.lastEffect || ''),
    lastMutation: String(state.lastMutation || ''),
  };
}

export function endTelegramWebhookAttempt(cfg) {
  const state = stateFor(cfg);
  if (state) state.active = false;
  return state;
}
