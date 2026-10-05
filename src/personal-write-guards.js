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

function personalDataError(message) {
  const error = new Error(message);
  error.code = 'PERSONAL_DATA_INVALID';
  return error;
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function positiveSafeInteger(value) {
  const number=integerCandidate(value);
  return number !== null && number > 0 ? number : 0;
}

function boundedText(value, maxLength, label, { required = false } = {}) {
  if (value == null) {
    if (required) throw personalDataError(`${label} обязателен.`);
    return '';
  }
  if (typeof value !== 'string') throw personalDataError(`${label} имеет некорректный формат.`);
  if(/[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw personalDataError(`${label} содержит недопустимые символы.`);
  }
  const text=value.trim().replace(/\s+/gu,' ');
  if (required && !text) throw personalDataError(`${label} обязателен.`);
  if (text.length > maxLength) throw personalDataError(`${label} слишком длинный.`);
  return text;
}

function strictBoolean(value, fallback, label) {
  if (value === undefined) return fallback;
  if (value === true || value === false) return value;
  throw personalDataError(`${label} имеет некорректный формат.`);
}

function parseFixtureTimestamp(value) {
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/i.exec(raw);
  if (!match) return null;

  const year=Number(match[1]);
  const month=Number(match[2]);
  const day=Number(match[3]);
  const hour=Number(match[4]);
  const minute=Number(match[5]);
  const second=Number(match[6] || 0);
  const offsetHour=match[8].toUpperCase()==='Z' ? 0 : Number(match[10]);
  const offsetMinute=match[8].toUpperCase()==='Z' ? 0 : Number(match[11]);

  if (
    month < 1 || month > 12
    || day < 1 || day > new Date(Date.UTC(year,month,0)).getUTCDate()
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 14
    || offsetMinute > 59
    || (offsetHour === 14 && offsetMinute !== 0)
  ) return null;

  const timestamp=Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function httpUrlOrEmpty(value) {
  const text = boundedText(value, PERSONAL_WRITE_LIMITS.teamLogo, 'URL логотипа');
  if (!text) return '';
  let url;
  try {
    url = new URL(text);
  } catch {
    throw personalDataError('Некорректный URL логотипа.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || !url.hostname
    || url.username
    || url.password
  ) {
    throw personalDataError('Некорректный URL логотипа.');
  }
  const normalized=url.toString();
  if (normalized.length > PERSONAL_WRITE_LIMITS.teamLogo) {
    throw personalDataError('URL логотипа слишком длинный.');
  }
  return normalized;
}

export function normalizeFavoriteWrite(input = {}) {
  const teamId = positiveSafeInteger(input.teamId ?? input.id);
  if (!teamId) {
    throw personalDataError('Некорректная команда.');
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
    throw personalDataError('Некорректный игрок.');
  }
  const teamId = positiveSafeInteger(input.teamId);
  if (!teamId) {
    throw personalDataError('Некорректная команда игрока.');
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
    throw personalDataError('Некорректный номер матча.');
  }

  const fixtureMs = parseFixtureTimestamp(input.fixtureDate);
  if (fixtureMs === null) throw personalDataError('Некорректное время матча.');

  const currentMs=typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : null;
  if (currentMs === null) throw personalDataError('Некорректное текущее время.');
  if (fixtureMs <= currentMs + 5 * 60_000) {
    throw personalDataError('Матч уже начинается или начался.');
  }

  const requestedMinutes = integerCandidate(input.reminderMinutes);
  const reminderMinutes = [15, 30, 60].includes(requestedMinutes) ? requestedMinutes : 30;

  return {
    fixtureId,
    homeName: boundedText(input.homeName, PERSONAL_WRITE_LIMITS.clubName, 'Название хозяев', { required: true }),
    awayName: boundedText(input.awayName, PERSONAL_WRITE_LIMITS.clubName, 'Название гостей', { required: true }),
    leagueName: boundedText(input.leagueName, PERSONAL_WRITE_LIMITS.leagueName, 'Название турнира'),
    fixtureDate: new Date(fixtureMs).toISOString(),
    reminderMinutes,
    kickoffNotify: strictBoolean(input.kickoffNotify, true, 'Настройка уведомления о начале матча'),
  };
}
