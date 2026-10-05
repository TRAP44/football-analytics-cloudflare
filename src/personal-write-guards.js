export const PERSONAL_WRITE_LIMITS = Object.freeze({
  favorites: 50,
  favoritePlayers: 50,
  reminders: 50,
  teamName: 160,
  playerName: 160,
  teamLogo: 2048,
  clubName: 160,
  leagueName: 160,
});

export const TEAM_LOGO_ALLOWED_HOSTS = Object.freeze([
  'media.api-sports.io',
]);

function positiveSafeInteger(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function boundedText(value, maxLength, label, { required = false } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) {
    const error = new Error(`${label} обязателен.`);
    error.code = 'PERSONAL_DATA_INVALID';
    throw error;
  }
  if (text.length > maxLength) {
    const error = new Error(`${label} слишком длинный.`);
    error.code = 'PERSONAL_DATA_INVALID';
    throw error;
  }
  return text;
}

export function sanitizeTeamLogoUrl(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > PERSONAL_WRITE_LIMITS.teamLogo) return '';
  try {
    const url = new URL(text);
    if (
      url.protocol !== 'https:'
      || !TEAM_LOGO_ALLOWED_HOSTS.includes(url.hostname)
      || url.port
      || url.username
      || url.password
    ) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function httpUrlOrEmpty(value) {
  const text = boundedText(value, PERSONAL_WRITE_LIMITS.teamLogo, 'URL логотипа');
  if (!text) return '';
  const normalized = sanitizeTeamLogoUrl(text);
  if (!normalized) {
    const error = new Error('Некорректный URL логотипа.');
    error.code = 'PERSONAL_DATA_INVALID';
    throw error;
  }
  return normalized;
}

export function normalizeFavoriteWrite(input = {}) {
  const teamId = positiveSafeInteger(input.teamId ?? input.id);
  if (!teamId) {
    const error = new Error('Некорректная команда.');
    error.code = 'PERSONAL_DATA_INVALID';
    throw error;
  }

  return {
    teamId,
    teamName: boundedText(input.teamName ?? input.name, PERSONAL_WRITE_LIMITS.teamName, 'Название команды', { required: true }),
    teamLogo: httpUrlOrEmpty(input.teamLogo ?? input.logo),
  };
}

export function normalizeFavoritePlayerReference(input = {}) {
  const playerId = positiveSafeInteger(input.playerId ?? input.id);
  if (!playerId) {
    const error = new Error('Некорректный игрок.');
    error.code = 'PERSONAL_DATA_INVALID';
    throw error;
  }
  const teamId = positiveSafeInteger(input.teamId);
  if (!teamId) {
    const error = new Error('Некорректная команда игрока.');
    error.code = 'PERSONAL_DATA_INVALID';
    throw error;
  }
  return { playerId, teamId };
}

export function normalizeFavoritePlayerWrite(input = {}) {
  const ids = normalizeFavoritePlayerReference(input);
  return {
    ...ids,
    playerName: boundedText(input.playerName ?? input.name, PERSONAL_WRITE_LIMITS.playerName, 'Имя игрока', { required: true }),
  };
}

export function normalizeReminderWrite(input = {}, nowMs = Date.now()) {
  const fixtureId = positiveSafeInteger(input.fixtureId);
  if (!fixtureId) {
    const error = new Error('Некорректный номер матча.');
    error.code = 'PERSONAL_DATA_INVALID';
    throw error;
  }

  const fixtureMs = Date.parse(String(input.fixtureDate || ''));
  if (!Number.isFinite(fixtureMs)) {
    const error = new Error('Некорректное время матча.');
    error.code = 'PERSONAL_DATA_INVALID';
    throw error;
  }
  if (fixtureMs <= Number(nowMs) + 5 * 60_000) {
    const error = new Error('Матч уже начинается или начался.');
    error.code = 'PERSONAL_DATA_INVALID';
    throw error;
  }

  const requestedMinutes = Number(input.reminderMinutes);
  const reminderMinutes = [15, 30, 60].includes(requestedMinutes) ? requestedMinutes : 30;

  return {
    fixtureId,
    homeName: boundedText(input.homeName, PERSONAL_WRITE_LIMITS.clubName, 'Название хозяев', { required: true }),
    awayName: boundedText(input.awayName, PERSONAL_WRITE_LIMITS.clubName, 'Название гостей', { required: true }),
    leagueName: boundedText(input.leagueName, PERSONAL_WRITE_LIMITS.leagueName, 'Название турнира'),
    fixtureDate: new Date(fixtureMs).toISOString(),
    reminderMinutes,
    kickoffNotify: input.kickoffNotify !== false,
  };
}
