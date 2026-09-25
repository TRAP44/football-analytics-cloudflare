export const DEVELOPMENT_TELEGRAM_ID = 999001;

export function telegramIdList(value) {
  return String(value || '')
    .split(/[\s,;]+/)
    .map(item => Number(item))
    .filter(item => Number.isSafeInteger(item) && item > 0);
}

export function isAdminUser(user, cfg = {}) {
  const userId = Number(user?.id || 0);
  if (!Number.isSafeInteger(userId) || userId <= 0) return false;

  const allowlisted = (cfg.adminTelegramIds || []).some(id => Number(id) === userId);
  if (allowlisted) return true;

  // DEV_MODE may create one synthetic identity when Telegram initData is absent.
  // It must never elevate a real Telegram user merely because DEV_MODE was left on.
  return Boolean(
    cfg.devMode
    && userId === DEVELOPMENT_TELEGRAM_ID
    && user.__developmentIdentity === true
  );
}


export function isTelegramValidatedUser(user) {
  const userId = Number(user?.id || 0);
  return Number.isSafeInteger(userId) && userId > 0 && user?.__telegramValidated === true;
}

export function isClosedBetaUser(user, cfg = {}) {
  const userId = Number(user?.id || 0);
  if (!Number.isSafeInteger(userId) || userId <= 0) return false;
  if (isAdminUser(user, cfg)) return false;
  if (!isTelegramValidatedUser(user)) return false;
  return (cfg.betaTelegramIds || []).some(id => Number(id) === userId);
}

export function closedBetaAccessDecision(user, cfg = {}) {
  if (isAdminUser(user, cfg)) {
    return { allowed: true, adminBypass: true, betaParticipant: false };
  }
  const betaParticipant = isClosedBetaUser(user, cfg);
  if (!cfg.betaAccessEnabled) {
    return { allowed: true, adminBypass: false, betaParticipant };
  }
  return { allowed: betaParticipant, adminBypass: false, betaParticipant };
}
