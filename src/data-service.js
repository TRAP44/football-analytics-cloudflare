export function compactProviderError(error) {
  const code = String(error?.code || error?.name || 'provider_error').slice(0, 80);
  const status = Number(error?.status || 0) || null;
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
    fallback: Boolean(fallback),
    attribution: String(attribution || ''),
    attempts: Array.isArray(attempts) ? attempts.slice(0, 8) : [],
  };
}

function defaultAccept(result) {
  if (!result || result.available === false) return false;
  if (Array.isArray(result.data)) return result.data.length > 0;
  if (Array.isArray(result.standings)) return result.standings.length > 0;
  return Boolean(result.available ?? result.data ?? result.groups);
}

export async function resolveProviderChain({
  feature = 'data',
  providers = [],
  accept = defaultAccept,
} = {}) {
  const attempts = [];
  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index] || {};
    const id = String(provider.id || `provider-${index + 1}`);
    const label = String(provider.label || id);
    const enabled = typeof provider.enabled === 'function' ? Boolean(await provider.enabled()) : provider.enabled !== false;
    if (!enabled) {
      attempts.push({ provider: id, state: 'skipped', reason: String(provider.skipReason || 'disabled') });
      continue;
    }
    try {
      const result = await provider.run();
      if (accept(result)) {
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
  return sourceMeta({
    ...meta,
    source: stale ? 'stale-cache' : 'cache',
    freshness: stale ? 'stale' : 'cached',
  });
}
