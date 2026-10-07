function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function safeRead(value, key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function safeText(value, max = 120, fallback = '') {
  if (!['string','number','bigint'].includes(typeof value)) return fallback;
  try {
    const text=String(value)
      .replace(/[\u0000-\u001f\u007f]+/g, '_')
      .trim()
      .slice(0,max);
    return text || fallback;
  } catch {
    return fallback;
  }
}

function strictTimestamp(value) {
  if (value instanceof Date) {
    const ms=value.getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  if (typeof value!=='string' || !value.trim()) return null;
  const raw=value.trim();
  const calendar=/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(raw);
  if (!calendar) return null;
  const year=Number(calendar[1]);
  const month=Number(calendar[2]);
  const day=Number(calendar[3]);
  if (!Number.isSafeInteger(year) || month<1 || month>12 || day<1) return null;
  const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  if (day>maxDay) return null;
  if (
    raw.length>10
    && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)
  ) return null;
  const parsed=Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizedAttempt(value) {
  const source=plainObject(value);
  if (!source) return null;
  const provider=safeText(safeRead(source,'provider'),80,'unknown');
  const state=safeText(safeRead(source,'state'),40,'unknown');
  const reason=safeText(safeRead(source,'reason'),120);
  const rawStatus=safeRead(source,'status');
  const numericStatus=typeof rawStatus==='number'
    ? rawStatus
    : typeof rawStatus==='string' && /^\d{3}$/.test(rawStatus.trim())
      ? Number(rawStatus.trim())
      : NaN;
  const status=Number.isInteger(numericStatus) && numericStatus>=100 && numericStatus<=599
    ? numericStatus
    : null;
  return {
    provider,
    state,
    reason,
    ...(status!==null ? {status} : {}),
  };
}

export function compactProviderError(error) {
  const source=plainObject(error) || error;
  const code = safeText(
    safeRead(source,'code') ?? safeRead(source,'name'),
    80,
    'provider_error',
  );
  const rawStatus = safeRead(source,'status');
  const numericStatus = typeof rawStatus==='number'
    ? rawStatus
    : typeof rawStatus==='string' && /^\d{3}$/.test(rawStatus.trim())
      ? Number(rawStatus.trim())
      : NaN;
  const status = Number.isInteger(numericStatus) && numericStatus >= 100 && numericStatus <= 599
    ? numericStatus
    : null;
  return { code, status };
}

export function sourceMeta({
  provider,
  label,
  source = 'network',
  fetchedAt = new Date().toISOString(),
  freshness = 'fresh',
  fallback = false,
  attribution = '',
  attempts = [],
} = {}) {
  const normalizedProvider=safeText(provider,80,'unknown');
  const normalizedLabel=safeText(label,120,normalizedProvider || 'Unknown');
  const normalizedFetchedAt=fetchedAt===null
    ? null
    : strictTimestamp(fetchedAt);
  return {
    provider: normalizedProvider,
    label: normalizedLabel || 'Unknown',
    source: safeText(source,40,'network'),
    fetchedAt: normalizedFetchedAt,
    freshness: safeText(freshness,40,'unknown'),
    fallback: fallback === true,
    attribution: safeText(attribution,240),
    attempts: (Array.isArray(attempts) ? attempts : [])
      .slice(0,8)
      .map(normalizedAttempt)
      .filter(Boolean),
  };
}

function defaultAccept(result) {
  if (!plainObject(result)) return false;
  if (safeRead(result,'available') === false) return false;
  const data=safeRead(result,'data');
  const standings=safeRead(result,'standings');
  const groups=safeRead(result,'groups');
  if (Array.isArray(data)) return data.length > 0;
  if (Array.isArray(standings)) return standings.length > 0;
  if (Array.isArray(groups)) return groups.length > 0;
  return safeRead(result,'available') === true;
}

export async function resolveProviderChain({
  feature = 'data',
  providers = [],
  accept = defaultAccept,
} = {}) {
  const attempts = [];
  const chain = Array.isArray(providers) ? providers : [];
  const acceptResult = typeof accept === 'function' ? accept : defaultAccept;

  for (let index = 0; index < chain.length; index += 1) {
    const provider = plainObject(chain[index]);
    if (!provider) {
      attempts.push({
        provider:`provider-${index + 1}`,
        state:'skipped',
        reason:'invalid_provider',
      });
      continue;
    }

    const id=safeText(safeRead(provider,'id'),80,`provider-${index + 1}`);
    const label=safeText(safeRead(provider,'label'),120,id);
    let enabled=true;
    try {
      const enabledValue=safeRead(provider,'enabled');
      enabled=enabledValue===undefined
        ? true
        : typeof enabledValue==='function'
          ? await enabledValue.call(provider) === true
          : enabledValue === true;
    } catch (error) {
      const compact=compactProviderError(error);
      attempts.push({
        provider:id,
        state:'error',
        reason:`enable_${compact.code}`.slice(0,120),
        ...(compact.status!==null ? {status:compact.status} : {}),
      });
      continue;
    }

    if (!enabled) {
      attempts.push({
        provider:id,
        state:'skipped',
        reason:safeText(safeRead(provider,'skipReason'),120,'disabled'),
      });
      continue;
    }

    const run=safeRead(provider,'run');
    if (typeof run !== 'function') {
      attempts.push({ provider:id, state:'skipped', reason:'invalid_provider' });
      continue;
    }

    let result;
    try {
      result=await run.call(provider);
    } catch (error) {
      const compact = compactProviderError(error);
      attempts.push({
        provider:id,
        state:'error',
        reason:compact.code,
        ...(compact.status!==null ? {status:compact.status} : {}),
      });
      continue;
    }

    if (!plainObject(result)) {
      attempts.push({
        provider:id,
        state:'unavailable',
        reason:'invalid_result',
      });
      continue;
    }

    let accepted=false;
    try {
      accepted=await acceptResult(result) === true;
    } catch (error) {
      const compact=compactProviderError(error);
      attempts.push({
        provider:id,
        state:'unavailable',
        reason:`accept_${compact.code}`.slice(0,120),
        ...(compact.status!==null ? {status:compact.status} : {}),
      });
      continue;
    }

    if (accepted) {
      const rawMeta=plainObject(safeRead(result,'sourceMeta')) || {};
      const meta = sourceMeta({
        provider:safeRead(rawMeta,'provider') || id,
        label:safeRead(rawMeta,'label') || label,
        source:safeRead(rawMeta,'source') || 'network',
        fetchedAt:safeRead(rawMeta,'fetchedAt') ?? new Date().toISOString(),
        freshness:safeRead(rawMeta,'freshness') || 'fresh',
        attribution:safeRead(rawMeta,'attribution') || '',
        fallback:index > 0,
        attempts:[...attempts,{provider:id,state:'available',reason:''}],
      });
      return { ...result, available: true, sourceMeta: meta };
    }

    attempts.push({
      provider:id,
      state:'unavailable',
      reason:safeText(safeRead(result,'reason'),120,'empty_response'),
    });
  }

  return {
    available:false,
    feature:safeText(feature,80,'data'),
    reason:attempts.length ? 'all_providers_unavailable' : 'no_provider',
    sourceMeta:sourceMeta({
      provider:'none',
      label:'Нет доступного источника',
      freshness:'unavailable',
      attempts,
    }),
  };
}

export function markCachedSourceMeta(meta = {}, { stale = false } = {}) {
  const source=plainObject(meta) || {};
  const isStale = stale === true;
  return sourceMeta({
    provider:safeRead(source,'provider'),
    label:safeRead(source,'label'),
    fetchedAt:safeRead(source,'fetchedAt') ?? null,
    attribution:safeRead(source,'attribution'),
    attempts:safeRead(source,'attempts'),
    source:isStale ? 'stale-cache' : 'cache',
    freshness:isStale ? 'stale' : 'cached',
    fallback:safeRead(source,'fallback') === true,
  });
}
