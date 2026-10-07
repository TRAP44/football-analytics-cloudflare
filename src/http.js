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
const FALLBACK_JSON_BODY = JSON.stringify({
  error: 'Сервис временно недоступен.',
  code: 'RESPONSE_SERIALIZATION_FAILED',
});

function safeRead(value,key) {
  if (!value || typeof value!=='object') return undefined;
  try {
    return value[key];
  } catch {
    return undefined;
  }
}

function safeText(value,max=180) {
  if (typeof value!=='string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]+/g,' ')
    .trim()
    .slice(0,max);
}

function scalarHeaderValue(value,max=180) {
  let text='';
  if (typeof value==='string') text=value;
  else if (typeof value==='number' && Number.isFinite(value)) {
    text=String(value);
  } else {
    return '';
  }
  if (
    text.length>max
    || /[\u0000-\u001f\u007f]/.test(text)
  ) return '';
  return text;
}

function responseStatus(value) {
  return Number.isSafeInteger(value)
    && value>=200
    && value<=599
      ? value
      : 500;
}

function numericCandidate(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isFinite(number) ? number : null;
}

function normalizedRetryAfter(value) {
  const seconds=numericCandidate(value);
  if (seconds === null || seconds <= 0) return undefined;
  return Math.min(
    MAX_RETRY_AFTER_SECONDS,
    Math.max(1, Math.ceil(seconds)),
  );
}

function normalizedLimit(value) {
  const number=typeof value==='number' && Number.isFinite(value)
    ? value
    : null;
  return Number.isSafeInteger(number) && number > 0
    ? number
    : null;
}

function normalizedErrorCode(value,fallback) {
  if (typeof value!=='string') return fallback;
  const code=value.trim();
  return /^[A-Z0-9_]{1,80}$/.test(code)
    ? code
    : fallback;
}

function safeHeaderEntries(value) {
  if (!value || typeof value!=='object' || Array.isArray(value)) {
    return [];
  }
  let keys=[];
  try {
    keys=Object.keys(value).slice(0,64);
  } catch {
    return [];
  }
  const out=[];
  for (const key of keys) {
    if (
      typeof key!=='string'
      || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)
    ) continue;
    const headerValue=scalarHeaderValue(safeRead(value,key),2048);
    if (!headerValue) continue;
    out.push([key,headerValue]);
  }
  return out;
}

function serializeJson(value) {
  try {
    const body=JSON.stringify(value);
    return {
      body:typeof body==='string' ? body : 'null',
      ok:true,
    };
  } catch {
    return {body:FALLBACK_JSON_BODY,ok:false};
  }
}

export function createHttpRuntime(options={}) {
  const appVersion=scalarHeaderValue(
    safeRead(options,'appVersion'),
    120,
  );
  const apiContractVersion=scalarHeaderValue(
    safeRead(options,'apiContractVersion'),
    40,
  );
  const minClientVersion=scalarHeaderValue(
    safeRead(options,'minClientVersion'),
    120,
  );
  const releaseChannel=scalarHeaderValue(
    safeRead(options,'releaseChannel'),
    120,
  );
  const personalWriteLimits=safeRead(options,'personalWriteLimits');

  const json = (data, status = 200, extraHeaders = {}) => {
    const serialized=serializeJson(data);
    const finalStatus=serialized.ok
      ? responseStatus(status)
      : 500;
    const headers=new Headers({
      ...apiSecurityHeaders(),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-app-version': appVersion,
      'x-api-contract': apiContractVersion,
      'x-min-client-version': minClientVersion,
      'x-release-channel': releaseChannel,
      'vary': 'x-telegram-init-data',
    });

    for (const [name,value] of safeHeaderEntries(extraHeaders)) {
      const normalizedName=name.toLowerCase();
      if (IMMUTABLE_JSON_HEADERS.has(normalizedName)) continue;
      try {
        headers.set(name,value);
      } catch {}
    }

    return new Response(serialized.body,{
      status:finalStatus,
      headers,
    });
  };

  const adminForbidden = () => json({
    error: 'Этот технический раздел доступен только администратору.',
    code: 'ADMIN_ONLY',
  }, 403);

  const publicRouteError = (error, rateLimited = false) => {
    const explicitlyRateLimited=rateLimited===true;
    const code=normalizedErrorCode(
      safeRead(error,'code'),
      explicitlyRateLimited
        ? 'FOOTBALL_RATE_LIMIT'
        : 'SERVER_ERROR',
    );
    const retryAfter=normalizedRetryAfter(
      safeRead(error,'retryAfter'),
    );

    if (
      explicitlyRateLimited
      || ['FOOTBALL_RATE_LIMIT','FOOTBALL_COOLDOWN'].includes(code)
    ) {
      return {
        status:429,
        body:{
          error:retryAfter
            ? `Футбольные данные временно обновляются медленнее. Повторите примерно через ${retryAfter} сек.`
            : 'Футбольные данные временно обновляются медленнее. Попробуйте чуть позже.',
          code,
          category:'rate_limit',
          recoverable:true,
          retryAfter,
        },
      };
    }

    if (code==='REMINDER_FIXTURE_UNAVAILABLE') {
      return {
        status:503,
        body:{
          error:'Матч не удалось подтвердить по актуальным серверным данным. Обновите список матчей и попробуйте ещё раз.',
          code,
          category:'fixture_validation',
          recoverable:true,
          retryAfter:retryAfter || 30,
        },
      };
    }

    if (code==='PERSONAL_DATA_INVALID') {
      return {
        status:400,
        body:{
          error:'Данные запроса не прошли проверку.',
          code,
          category:'validation',
          recoverable:false,
        },
      };
    }

    if (code==='FAVORITES_LIMIT' || code==='REMINDERS_LIMIT') {
      const limit=normalizedLimit(
        safeRead(
          personalWriteLimits,
          code==='FAVORITES_LIMIT' ? 'favorites' : 'reminders',
        ),
      );
      return {
        status:409,
        body:{
          error:code==='FAVORITES_LIMIT'
            ? limit
              ? `Достигнут лимит избранных команд: ${limit}.`
              : 'Достигнут лимит избранных команд.'
            : limit
              ? `Достигнут лимит активных напоминаний: ${limit}.`
              : 'Достигнут лимит активных напоминаний.',
          code,
          category:'limit',
          recoverable:false,
        },
      };
    }

    if (code==='FOOTBALL_GUARD_DEGRADED') {
      return {
        status:503,
        body:{
          error:retryAfter
            ? `Защита лимита футбольного источника временно работает в аварийном режиме. Повторите примерно через ${retryAfter} сек.`
            : 'Защита лимита футбольного источника временно работает в аварийном режиме. Попробуйте позже.',
          code,
          category:'provider_guard',
          recoverable:true,
          retryAfter,
        },
      };
    }

    if (code==='UPSTREAM_TIMEOUT') {
      return {
        status:504,
        body:{
          error:'Источник данных отвечает медленнее обычного. Сохранённые данные останутся доступны, попробуйте обновить позже.',
          code,
          category:'timeout',
          recoverable:true,
        },
      };
    }

    if (code.startsWith('FOOTBALL_')) {
      return {
        status:502,
        body:{
          error:'Футбольный источник временно недоступен. Приложение использует сохранённые данные там, где они есть.',
          code,
          category:'provider',
          recoverable:true,
          retryAfter,
        },
      };
    }

    const raw=safeText(safeRead(error,'message'),500);
    if (/supabase|postgrest|database/i.test(raw)) {
      return {
        status:503,
        body:{
          error:'Сервис хранения данных временно недоступен. Основные футбольные экраны попробуют продолжить работу через сохранённые данные.',
          code:code==='SERVER_ERROR'
            ? 'DATABASE_DEGRADED'
            : code,
          category:'database',
          recoverable:true,
        },
      };
    }

    return {
      status:502,
      body:{
        error:'Сервис временно недоступен. Попробуйте повторить действие через несколько секунд.',
        code,
        category:'service',
        recoverable:true,
        retryAfter,
      },
    };
  };

  return Object.freeze({
    json,
    adminForbidden,
    publicRouteError,
  });
}
