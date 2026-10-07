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
const MAX_INTEGER_TEXT_LENGTH = 24;
const ATTEMPT_LEDGER = new WeakMap();

function plainObject(value) {
  try {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function safeRead(value, key) {
  const source=plainObject(value);
  if (!source) return undefined;
  try { return source[key]; }
  catch { return undefined; }
}

function textValue(value, max = MAX_LABEL_LENGTH) {
  if (
    typeof value !== 'string'
    || value.length > Math.max(max * 4,max)
  ) return '';
  let text;
  try { text=value.normalize('NFKC').trim(); }
  catch { return ''; }
  if (
    !text
    || /[\u0000-\u001f\u007f-\u009f]/u.test(text)
  ) return '';
  return text.slice(0,max);
}

function labelValue(value) {
  const label=textValue(value,MAX_LABEL_LENGTH);
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(label) ? label : '';
}

function codeValue(value) {
  const code=textValue(value,MAX_LABEL_LENGTH);
  return /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : '';
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (
    typeof value !== 'string'
    || value.length > MAX_INTEGER_TEXT_LENGTH
  ) return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function counterSnapshot(value, { missing = 0 } = {}) {
  if (value === undefined || value === null || value === '') {
    return {value:missing,valid:false};
  }
  const number=integerCandidate(value);
  if (number === null || number<0 || number>MAX_ATTEMPT_COUNTER) {
    return {value:MAX_ATTEMPT_COUNTER,valid:false};
  }
  return {value:number,valid:true};
}

function retryAfterSeconds(value) {
  if (value === undefined || value === null || value === '') return 0;
  const number=integerCandidate(value);
  if (number === null || number<0) return 0;
  return Math.min(number,MAX_RETRY_AFTER_SECONDS);
}

function safeIncrement(value) {
  const snapshot=counterSnapshot(value,{missing:MAX_ATTEMPT_COUNTER});
  if (!snapshot.valid) return MAX_ATTEMPT_COUNTER;
  return Math.min(MAX_ATTEMPT_COUNTER,snapshot.value+1);
}

function stateFor(cfg) {
  const source=plainObject(cfg);
  if (!source) return null;
  return plainObject(safeRead(source,'telegramWebhookAttempt'));
}

function ledgerFor(cfg) {
  const source=plainObject(cfg);
  if (!source) return null;
  try { return ATTEMPT_LEDGER.get(source) || null; }
  catch { return null; }
}

function syncState(cfg, ledger) {
  const state=stateFor(cfg);
  if (!state || !ledger) return;
  try {
    state.active=ledger.active === true;
    state.startedAt=ledger.startedAt;
    state.successfulEffects=ledger.successfulEffects;
    state.unsafeMutations=ledger.unsafeMutations;
    state.lastEffect=ledger.lastEffect;
    state.lastMutation=ledger.lastMutation;
  } catch {}
}

export function beginTelegramWebhookAttempt(cfg) {
  const source=plainObject(cfg);
  if (!source) return null;

  const existing=ledgerFor(source);
  if (existing?.active === true) {
    syncState(source,existing);
    return stateFor(source) || existing;
  }

  const startedAt=Date.now();
  const ledger={
    active:true,
    startedAt:Number.isFinite(startedAt) && startedAt>=0 ? startedAt : 0,
    successfulEffects:0,
    unsafeMutations:0,
    lastEffect:'',
    lastMutation:'',
  };
  try { ATTEMPT_LEDGER.set(source,ledger); }
  catch { return null; }

  const state={...ledger};
  try { source.telegramWebhookAttempt=state; }
  catch {}
  return stateFor(source) || state;
}

export function markTelegramWebhookEffect(cfg, label = '') {
  const ledger=ledgerFor(cfg);
  if (ledger?.active !== true) return false;
  ledger.successfulEffects=safeIncrement(ledger.successfulEffects);
  ledger.lastEffect=labelValue(label);
  syncState(cfg,ledger);
  return true;
}

export function markTelegramWebhookMutation(cfg, label = '') {
  const ledger=ledgerFor(cfg);
  if (ledger?.active !== true) return false;
  ledger.unsafeMutations=safeIncrement(ledger.unsafeMutations);
  ledger.lastMutation=labelValue(label);
  syncState(cfg,ledger);
  return true;
}

export function classifyTelegramWebhookFailure(error, cfg) {
  const ledger=ledgerFor(cfg);
  const state=ledger || stateFor(cfg);
  const statePresent=Boolean(state);

  const effectSnapshot=statePresent
    ? counterSnapshot(safeRead(state,'successfulEffects'),{missing:MAX_ATTEMPT_COUNTER})
    : {value:0,valid:true};
  const mutationSnapshot=statePresent
    ? counterSnapshot(safeRead(state,'unsafeMutations'),{missing:MAX_ATTEMPT_COUNTER})
    : {value:0,valid:true};

  const activeValue=statePresent ? safeRead(state,'active') : false;
  const stateValid=!statePresent
    || (
      typeof activeValue === 'boolean'
      && effectSnapshot.valid
      && mutationSnapshot.valid
    );

  const code=codeValue(safeRead(error,'code'));
  const transient=RETRYABLE_CODES.has(code);
  const retrySafe=safeRead(error,'telegramWebhookRetrySafe') === true;
  const successfulEffects=effectSnapshot.value;
  const unsafeMutations=mutationSnapshot.value;
  const retry=Boolean(
    stateValid
    && (transient || retrySafe)
    && successfulEffects === 0
    && (unsafeMutations === 0 || retrySafe)
  );

  return {
    retry,
    transient,
    retrySafe,
    code:code || 'TELEGRAM_WEBHOOK_FAILURE',
    retryAfter:retryAfterSeconds(safeRead(error,'retryAfter')),
    successfulEffects,
    unsafeMutations,
    lastEffect:labelValue(safeRead(state,'lastEffect')),
    lastMutation:labelValue(safeRead(state,'lastMutation')),
  };
}

export function endTelegramWebhookAttempt(cfg) {
  const ledger=ledgerFor(cfg);
  if (ledger) {
    ledger.active=false;
    syncState(cfg,ledger);
    return stateFor(cfg) || {...ledger};
  }

  const state=stateFor(cfg);
  if (!state) return null;
  try { state.active=false; } catch {}
  return state;
}
