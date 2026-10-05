export function compactProviderError(error) {
  const code = String(error?.code || error?.name || 'provider_error')
    .replace(/[\u0000-\u001f\u007f]+/g, '_')
    .trim()
    .slice(0, 80) || 'provider_error';
  const rawStatus = Number(error?.status);
  const status = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599
    ? rawStatus
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
  return {
    provider: String(provider || 'unknown'),
    label: String(label || provider || 'Unknown'),
    source: String(source || 'network'),
    fetchedAt: fetchedAt || null,
    freshness: String(freshness || 'fresh'),
    fallback: fallback === true,
    attribution: String(attribution || ''),
    attempts: Array.isArray(attempts) ? attempts.slice(0, 8) : [],
  };
}

function defaultAccept(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  if (result.available === false) return false;
  if (Array.isArray(result.data)) return result.data.length > 0;
  if (Array.isArray(result.standings)) return result.standings.length > 0;
  if (Array.isArray(result.groups)) return result.groups.length > 0;
  return result.available === true;
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
    const provider = chain[index] && typeof chain[index] === 'object' ? chain[index] : {};
    const id = String(provider.id || `provider-${index + 1}`).slice(0, 80);
    const label = String(provider.label || id).slice(0, 120);
    const enabled = provider.enabled === undefined
      ? true
      : typeof provider.enabled === 'function'
        ? await provider.enabled() === true
        : provider.enabled === true;
    if (!enabled) {
      attempts.push({ provider: id, state: 'skipped', reason: String(provider.skipReason || 'disabled') });
      continue;
    }
    try {
      if (typeof provider.run !== 'function') {
        attempts.push({ provider:id, state:'skipped', reason:'invalid_provider' });
        continue;
      }
      const result = await provider.run();
      if (await acceptResult(result) === true) {
        const meta = sourceMeta({
          ...(result?.sourceMeta || {}),
          provider: result?.sourceMeta?.provider || id,
          label: result?.sourceMeta?.label || label,
          fallback: index > 0,
          attempts: [...attempts, { provider: id, state: 'available', reason: '' }],
        });
        return { ...result, available: true, sourceMeta: meta };
      }
      attempts.push({
        provider: id,
        state: 'unavailable',
        reason: String(result?.reason || 'empty_response').slice(0, 120),
      });
    } catch (error) {
      const compact = compactProviderError(error);
      attempts.push({
        provider: id,
        state: 'error',
        reason: compact.code,
        status: compact.status,
      });
    }
  }
  return {
    available: false,
    feature,
    reason: attempts.length ? 'all_providers_unavailable' : 'no_provider',
    sourceMeta: sourceMeta({
      provider: 'none',
      label: 'Нет доступного источника',
      freshness: 'unavailable',
      attempts,
    }),
  };
}

export function markCachedSourceMeta(meta = {}, { stale = false } = {}) {
  const isStale = stale === true;
  return sourceMeta({
    ...meta,
    source: isStale ? 'stale-cache' : 'cache',
    freshness: isStale ? 'stale' : 'cached',
  });
}
