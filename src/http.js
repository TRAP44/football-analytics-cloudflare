import { apiSecurityHeaders } from './security-headers.js';

const IMMUTABLE_JSON_HEADERS = new Set([
  ...Object.keys(apiSecurityHeaders()).map(name => name.toLowerCase()),
  'content-type',
  'cache-control',
  'content-length',
  'x-app-version',
  'x-api-contract',
  'x-min-client-version',
  'x-release-channel',
  'vary',
]);

const MAX_RETRY_AFTER_SECONDS = 7 * 24 * 60 * 60;

function normalizedRetryAfter(value) {
  if (value == null || value === '') return undefined;
  const seconds=Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(seconds)));
}

function normalizedLimit(value) {
  const number=Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function createHttpRuntime({
  appVersion,
  apiContractVersion,
  minClientVersion,
  releaseChannel,
  personalWriteLimits,
} = {}) {
  const json = (data, status = 200, extraHeaders = {}) => {
    const headers=new Headers({
      ...apiSecurityHeaders(),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-app-version': String(appVersion || ''),
      'x-api-contract': String(apiContractVersion ?? ''),
      'x-min-client-version': String(minClientVersion || ''),
      'x-release-channel': String(releaseChannel || ''),
      'vary': 'x-telegram-init-data',
    });

    for (const [name,value] of Object.entries(extraHeaders || {})) {
      const normalizedName=String(name || '').trim().toLowerCase();
      if (!normalizedName || IMMUTABLE_JSON_HEADERS.has(normalizedName) || value == null) continue;
      headers.set(name,String(value));
    }

    return new Response(JSON.stringify(data), { status, headers });
  };

  const adminForbidden = () => json({
    error: 'Этот технический раздел доступен только администратору.',
    code: 'ADMIN_ONLY',
  }, 403);

  const publicRouteError = (error, rateLimited = false) => {
    const code = String(error?.code || (rateLimited ? 'FOOTBALL_RATE_LIMIT' : 'SERVER_ERROR'));
    const retryAfter = normalizedRetryAfter(error?.retryAfter);

    if (rateLimited || ['FOOTBALL_RATE_LIMIT', 'FOOTBALL_COOLDOWN'].includes(code)) {
      return {
        status: 429,
        body: {
          error: retryAfter
            ? `Футбольные данные временно обновляются медленнее. Повторите примерно через ${retryAfter} сек.`
            : 'Футбольные данные временно обновляются медленнее. Попробуйте чуть позже.',
          code,
          category: 'rate_limit',
          recoverable: true,
          retryAfter,
        },
      };
    }

    if (code === 'REMINDER_FIXTURE_UNAVAILABLE') {
      return {
        status: 503,
        body: {
          error: 'Матч не удалось подтвердить по актуальным серверным данным. Обновите список матчей и попробуйте ещё раз.',
          code,
          category: 'fixture_validation',
          recoverable: true,
          retryAfter: retryAfter || 30,
        },
      };
    }

    if (code === 'PERSONAL_DATA_INVALID') {
      return {
        status: 400,
        body: {
          error: 'Данные запроса не прошли проверку.',
          code,
          category: 'validation',
          recoverable: false,
        },
      };
    }

    if (code === 'FAVORITES_LIMIT' || code === 'REMINDERS_LIMIT') {
      return {
        status: 409,
        body: {
          error: code === 'FAVORITES_LIMIT'
            ? normalizedLimit(personalWriteLimits?.favorites)
              ? `Достигнут лимит избранных команд: ${normalizedLimit(personalWriteLimits.favorites)}.`
              : 'Достигнут лимит избранных команд.'
            : normalizedLimit(personalWriteLimits?.reminders)
              ? `Достигнут лимит активных напоминаний: ${normalizedLimit(personalWriteLimits.reminders)}.`
              : 'Достигнут лимит активных напоминаний.',
          code,
          category: 'limit',
          recoverable: false,
        },
      };
    }

    if (code === 'FOOTBALL_GUARD_DEGRADED') {
      return {
        status: 503,
        body: {
          error: retryAfter
            ? `Защита лимита футбольного источника временно работает в аварийном режиме. Повторите примерно через ${retryAfter} сек.`
            : 'Защита лимита футбольного источника временно работает в аварийном режиме. Попробуйте позже.',
          code,
          category: 'provider_guard',
          recoverable: true,
          retryAfter,
        },
      };
    }

    if (code === 'UPSTREAM_TIMEOUT') {
      return {
        status: 504,
        body: {
          error: 'Источник данных отвечает медленнее обычного. Сохранённые данные останутся доступны, попробуйте обновить позже.',
          code,
          category: 'timeout',
          recoverable: true,
        },
      };
    }

    if (code.startsWith('FOOTBALL_')) {
      return {
        status: 502,
        body: {
          error: 'Футбольный источник временно недоступен. Приложение использует сохранённые данные там, где они есть.',
          code,
          category: 'provider',
          recoverable: true,
          retryAfter,
        },
      };
    }

    const raw = String(error?.message || '');
    if (/supabase|postgrest|database/i.test(raw)) {
      return {
        status: 503,
        body: {
          error: 'Сервис хранения данных временно недоступен. Основные футбольные экраны попробуют продолжить работу через сохранённые данные.',
          code: code === 'SERVER_ERROR' ? 'DATABASE_DEGRADED' : code,
          category: 'database',
          recoverable: true,
        },
      };
    }

    return {
      status: 502,
      body: {
        error: 'Сервис временно недоступен. Попробуйте повторить действие через несколько секунд.',
        code,
        category: 'service',
        recoverable: true,
        retryAfter,
      },
    };
  };

  return Object.freeze({ json, adminForbidden, publicRouteError });
}
