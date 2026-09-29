export function createSupabaseClient({ fetchWithTimeout, redactMessage, sleepMs } = {}) {
  if (typeof fetchWithTimeout !== 'function') {
    throw new TypeError('createSupabaseClient requires fetchWithTimeout');
  }

  const redact = typeof redactMessage === 'function'
    ? redactMessage
    : (value, max = 180) => String(value ?? '').slice(0, max);

  const sleep = typeof sleepMs === 'function'
    ? sleepMs
    : ms => new Promise(resolve => setTimeout(resolve, ms));
  const retryableReadStatuses = new Set([408, 503, 504]);

  async function supaReadFetch(url, init, timeoutMs, source) {
    let lastResponse = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchWithTimeout(url, init, timeoutMs, source);
        lastResponse = response;
        if (!retryableReadStatuses.has(Number(response?.status || 0)) || attempt === 1) return response;
      } catch (error) {
        if (attempt === 1) throw error;
      }
      await sleep(180 * (attempt + 1));
    }
    return lastResponse;
  }

  function hasSupabase(cfg) {
    return Boolean(cfg?.supabaseUrl && cfg?.supabaseKey);
  }

  function supaHeaders(cfg, extra = {}) {
    // Supabase sb_secret_* keys are opaque API keys, not JWTs.
    // Keep them in apikey only; Bearer would make PostgREST parse them as JWTs.
    return {
      apikey: cfg.supabaseKey,
      'content-type': 'application/json',
      ...extra,
    };
  }

  async function supaSelectOne(cfg, table, params) {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
    url.searchParams.set('select', '*');
    url.searchParams.set('limit', '1');
    for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, value);
    const response = await supaReadFetch(url, { headers: supaHeaders(cfg) }, 7000, `Supabase ${table}`);
    if (!response.ok) throw new Error(`Supabase ${table}: HTTP ${response.status}`);
    const rows = await response.json();
    return rows?.[0] || null;
  }

  async function supaSelectMany(cfg, table, params = {}, { limit = 20, order = '', select = '*' } = {}) {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
    url.searchParams.set('select', String(select || '*'));
    url.searchParams.set('limit', String(limit));
    if (order) url.searchParams.set('order', order);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await supaReadFetch(url, { headers: supaHeaders(cfg) }, 7000, `Supabase ${table}`);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Supabase ${table}: HTTP ${response.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
    }
    return await response.json();
  }

  async function supaSelectPaged(cfg, table, params = {}, { pageSize = 500, maxRows = 5000, order = '' } = {}) {
    const rows = [];
    const size = Math.max(1, Math.min(1000, Number(pageSize || 500)));
    const cap = Math.max(size, Math.min(10000, Number(maxRows || 5000)));
    for (let offset = 0; offset < cap; offset += size) {
      const page = await supaSelectMany(cfg, table, { ...params, offset: String(offset) }, {
        limit: Math.min(size, cap - offset),
        order,
      });
      rows.push(...page);
      if (page.length < Math.min(size, cap - offset)) return { rows, truncated: false };
    }
    return { rows, truncated: rows.length >= cap };
  }

  async function supaUpsert(cfg, table, rows, onConflict) {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
    if (onConflict) url.searchParams.set('on_conflict', onConflict);
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: supaHeaders(cfg, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
    }, 7000, `Supabase ${table}`);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Supabase ${table}: HTTP ${response.status}${text ? ` — ${text.slice(0, 180)}` : ''}`);
    }
  }

  async function supaInsertIgnore(cfg, table, rows, onConflict) {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
    if (onConflict) url.searchParams.set('on_conflict', onConflict);
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: supaHeaders(cfg, { Prefer: 'resolution=ignore-duplicates,return=minimal' }),
      body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
    }, 7000, `Supabase ${table}`);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Supabase ${table}: HTTP ${response.status}${text ? ` — ${text.slice(0, 180)}` : ''}`);
    }
  }

  async function supaPatch(cfg, table, filters, patch) {
    const filterEntries = Object.entries(filters || {});
    if (!filterEntries.length) throw new TypeError(`Supabase ${table}: PATCH requires at least one filter.`);
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
    for (const [key, value] of filterEntries) url.searchParams.set(key, value);
    const response = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
      body: JSON.stringify(patch || {}),
    }, 7000, `Supabase ${table}`);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Supabase ${table}: HTTP ${response.status}${text ? ` — ${text.slice(0, 180)}` : ''}`);
    }
  }

  async function supaDelete(cfg, table, filters = {}) {
    const filterEntries = Object.entries(filters || {});
    if (!filterEntries.length) throw new TypeError(`Supabase ${table}: DELETE requires at least one filter.`);
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
    for (const [key, value] of filterEntries) url.searchParams.set(key, value);
    const response = await fetchWithTimeout(url, {
      method: 'DELETE',
      headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
    }, 7000, `Supabase ${table}`);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Supabase ${table}: HTTP ${response.status}${text ? ` — ${text.slice(0, 180)}` : ''}`);
    }
  }

  async function supaRpc(cfg, functionName, payload = {}, timeoutMs = 7000) {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/rpc/${functionName}`);
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: supaHeaders(cfg),
      body: JSON.stringify(payload || {}),
    }, Math.max(500, Number(timeoutMs || 7000)), `Supabase RPC ${functionName}`);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(`Supabase RPC ${functionName}: HTTP ${response.status}${body?.message ? ` — ${redact(body.message, 180)}` : ''}`);
      error.code = String(body?.code || `HTTP_${response.status}`);
      error.detail = body?.details || null;
      throw error;
    }
    return Array.isArray(body) && body.length === 1 ? body[0] : body;
  }

  return {
    hasSupabase,
    supaHeaders,
    supaSelectOne,
    supaSelectMany,
    supaSelectPaged,
    supaUpsert,
    supaInsertIgnore,
    supaPatch,
    supaDelete,
    supaRpc,
  };
}
