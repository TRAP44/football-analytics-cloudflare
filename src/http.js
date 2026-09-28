import { apiSecurityHeaders } from './security-headers.js';

export function createHttpRuntime({
  appVersion,
  apiContractVersion,
  minClientVersion,
  releaseChannel,
  personalWriteLimits,
} = {}) {
  const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
    status,
    headers: {
      ...apiSecurityHeaders(),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-app-version': appVersion,
      'x-api-contract': String(apiContractVersion),
      'x-min-client-version': minClientVersion,
      'x-release-channel': releaseChannel,
      'vary': 'x-telegram-init-data',
      ...extraHeaders,
    },
  });

  const adminForbidden = () => json({
    error: 'Этот технический раздел доступен только администратору.',
    code: 'ADMIN_ONLY',
  }, 403);

  const publicRouteError = (error, rateLimited = false) => {
    const code = String(error?.code || (rateLimited ? 'FOOTBALL_RATE_LIMIT' : 'SERVER_ERROR'));
    const retryAfter = Number(error?.retryAfter || 0) || undefined;

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
            ? `Достигнут лимит избранных команд: ${personalWriteLimits?.favorites}.`
            : `Достигнут лимит активных напоминаний: ${personalWriteLimits?.reminders}.`,
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
