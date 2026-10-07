export const DEVELOPMENT_TELEGRAM_ID = 999001;

function telegramIdCandidate(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string' || value.length > 24) return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function telegramIdList(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return [];
  return String(value)
    .split(/[\s,;]+/)
    .map(telegramIdCandidate)
    .filter(item => item !== null);
}

export function isAdminUser(user, cfg = {}) {
  const userId=telegramIdCandidate(user?.id);
  if (userId === null) return false;

  const adminTelegramIds = Array.isArray(cfg.adminTelegramIds) ? cfg.adminTelegramIds : [];
  const allowlisted = adminTelegramIds.some(id => telegramIdCandidate(id) === userId);
  if (allowlisted) return true;

  // DEV_MODE may create one synthetic identity when Telegram initData is absent.
  // It must never elevate a real Telegram user merely because DEV_MODE was left on.
  return Boolean(
    cfg.devMode === true
    && userId === DEVELOPMENT_TELEGRAM_ID
    && user.__developmentIdentity === true
  );
}


export function isTelegramValidatedUser(user) {
  const userId=telegramIdCandidate(user?.id);
  return userId !== null && user?.__telegramValidated === true;
}

export function isClosedBetaUser(user, cfg = {}) {
  const userId=telegramIdCandidate(user?.id);
  if (userId === null) return false;
  if (isAdminUser(user, cfg)) return false;
  if (!isTelegramValidatedUser(user)) return false;
  const betaTelegramIds = Array.isArray(cfg.betaTelegramIds) ? cfg.betaTelegramIds : [];
  return betaTelegramIds.some(id => telegramIdCandidate(id) === userId);
}

export function closedBetaAccessDecision(user, cfg = {}) {
  if (isAdminUser(user, cfg)) {
    return { allowed: true, adminBypass: true, betaParticipant: false };
  }

  // Public access is the default. Strict closed beta is an explicit temporary
  // mode and is enforced server-side only when BETA_ACCESS_ENABLED=true.
  const betaParticipant = isClosedBetaUser(user, cfg);
  if (cfg.betaAccessEnabled !== true) {
    return { allowed: isTelegramValidatedUser(user), adminBypass: false, betaParticipant };
  }
  return { allowed: betaParticipant, adminBypass: false, betaParticipant };
}
