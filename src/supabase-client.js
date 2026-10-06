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
  const protectedHeaderNames = new Set([
    'apikey',
    'authorization',
    'proxy-authorization',
    'content-type',
  ]);

  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function nonEmptyText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function boundedInteger(value, fallback, min, max) {
    let number = null;
    if (typeof value === 'number' && Number.isSafeInteger(value)) number = value;
    else if (typeof value === 'string' && /^\d+$/.test(value.trim())) number = Number(value.trim());
    if (!Number.isSafeInteger(number) || number < min || number > max) return fallback;
    return number;
  }

  function safeRedact(value, max = 180) {
    try {
      const redacted = redact(value, max);
      return String(redacted ?? '').slice(0, max);
    } catch {
      return '';
    }
  }

  function supabaseConfig(cfg) {
    const source = plainObject(cfg);
    const rawUrl = nonEmptyText(source?.supabaseUrl);
    const key = nonEmptyText(source?.supabaseKey);
    if (!rawUrl || !key) throw new TypeError('Supabase configuration requires supabaseUrl and supabaseKey.');

    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new TypeError('Supabase configuration contains an invalid supabaseUrl.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new TypeError('Supabase configuration contains an invalid supabaseUrl.');
    }
    url.pathname = `${url.pathname.replace(/\/+$/g, '')}/`;
    return { baseUrl:url, key };
  }

  function resourceSegment(value, label) {
    const resource = nonEmptyText(value);
    if (!resource || resource.length > 128 || /[\u0000-\u001f\u007f]/u.test(resource)) {
      throw new TypeError(`Supabase ${label} must be a non-empty resource name.`);
    }
    return encodeURIComponent(resource);
  }

  function restUrl(cfg, resource, { rpc = false } = {}) {
    const { baseUrl } = supabaseConfig(cfg);
    const prefix = rpc ? 'rest/v1/rpc/' : 'rest/v1/';
    return new URL(`${prefix}${resourceSegment(resource, rpc ? 'RPC function' : 'table')}`, baseUrl);
  }

  function queryEntries(params, label) {
    const source = plainObject(params) || {};
    return Object.entries(source).map(([rawKey, value]) => {
      const key = nonEmptyText(rawKey);
      if (!key || /[\u0000-\u001f\u007f]/u.test(key)) {
        throw new TypeError(`Supabase ${label}: invalid query parameter name.`);
      }
      if (!['string','number','boolean'].includes(typeof value)) {
        throw new TypeError(`Supabase ${label}: invalid query parameter value for ${key}.`);
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new TypeError(`Supabase ${label}: invalid query parameter value for ${key}.`);
      }
      return [key, String(value)];
    });
  }

  function applyQueryParams(url, params, label) {
    for (const [key, value] of queryEntries(params, label)) url.searchParams.set(key, value);
  }

  function responseArray(value, label) {
    if (!Array.isArray(value)) throw new Error(`Supabase ${label}: invalid response payload.`);
    return value;
  }

  function isTransientSecretReadAuthResponse(response, cfg) {
    if (Number(response?.status || 0) !== 401) return false;
    if (!nonEmptyText(plainObject(cfg)?.supabaseKey).startsWith('sb_secret_')) return false;
    const proxyStatus = String(response?.headers?.get?.('proxy-status') || '');
    return /(?:^|[;,\s])PostgREST(?:[;,\s]|$)/i.test(proxyStatus)
      && /(?:^|[;,\s])error=PGRST303(?:[;,\s]|$)/i.test(proxyStatus);
  }

  async function supaReadFetch(url, init, timeoutMs, source, cfg = null) {
    let lastResponse = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchWithTimeout(url, init, timeoutMs, source);
        lastResponse = response;
        const retryableStatus = retryableReadStatuses.has(Number(response?.status || 0));
        const transientSecretAuth = isTransientSecretReadAuthResponse(response, cfg);
        if ((!retryableStatus && !transientSecretAuth) || attempt === 1) return response;
      } catch (error) {
        if (attempt === 1) throw error;
      }
      await sleep(180 * (attempt + 1));
    }
    return lastResponse;
  }

  async function supaIdempotentUpsertFetch(url, init, timeoutMs, source, cfg = null) {
    const response = await fetchWithTimeout(url, init, timeoutMs, source);
    if (!isTransientSecretReadAuthResponse(response, cfg)) return response;
    await sleep(180);
    return await fetchWithTimeout(url, init, timeoutMs, source);
  }

  function hasSupabase(cfg) {
    const source = plainObject(cfg);
    return Boolean(nonEmptyText(source?.supabaseUrl) && nonEmptyText(source?.supabaseKey));
  }

  function supaHeaders(cfg, extra = {}) {
    // Supabase sb_secret_* keys are opaque API keys, not JWTs.
    // Keep them in apikey only; Bearer would make PostgREST parse them as JWTs.
    const { key } = supabaseConfig(cfg);
    const headers = {
      apikey: key,
      'content-type': 'application/json',
    };
    for (const [rawKey, value] of Object.entries(plainObject(extra) || {})) {
      const normalized = nonEmptyText(rawKey).toLowerCase();
      if (
        !normalized
        || protectedHeaderNames.has(normalized)
        || /[\u0000-\u001f\u007f]/u.test(normalized)
      ) continue;
      if (!['string','number','boolean'].includes(typeof value)) continue;
      headers[rawKey] = String(value);
    }
    return headers;
  }

  function supaRpcHeaders(cfg, extra = {}) {
    const headers = supaHeaders(cfg);
    const allowed = new Set([
      'x-analysis-usage-lifecycle',
      'x-analysis-operation-id',
      'x-analysis-usage-action',
    ]);
    for (const [key, value] of Object.entries(plainObject(extra) || {})) {
      const normalized = nonEmptyText(key).toLowerCase();
      if (!allowed.has(normalized)) continue;
      if (!['string','number','boolean'].includes(typeof value)) continue;
      headers[normalized] = String(value);
    }
    return headers;
  }

  async function supaSelectOne(cfg, table, params) {
    const tableName = nonEmptyText(table);
    const url = restUrl(cfg, tableName);
    url.searchParams.set('select', '*');
    url.searchParams.set('limit', '1');
    applyQueryParams(url, params, tableName);
    const response = await supaReadFetch(url, { headers: supaHeaders(cfg) }, 7000, `Supabase ${tableName}`, cfg);
    if (!response.ok) throw new Error(`Supabase ${tableName}: HTTP ${response.status}`);
    const rows = responseArray(await response.json(), tableName);
    return rows[0] ?? null;
  }

  async function supaSelectMany(cfg, table, params = {}, { limit = 20, order = '', select = '*' } = {}) {
    const tableName = nonEmptyText(table);
    const url = restUrl(cfg, tableName);
    const safeSelect = nonEmptyText(select) || '*';
    const safeOrder = nonEmptyText(order);
    const safeLimit = boundedInteger(limit, 20, 1, 1000);
    url.searchParams.set('select', safeSelect);
    url.searchParams.set('limit', String(safeLimit));
    if (safeOrder) url.searchParams.set('order', safeOrder);
    applyQueryParams(url, params, tableName);
    const response = await supaReadFetch(url, { headers: supaHeaders(cfg) }, 7000, `Supabase ${tableName}`, cfg);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const detail = safeRedact(text, 160);
      throw new Error(`Supabase ${tableName}: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
    }
    return responseArray(await response.json(), tableName);
  }

  async function supaSelectPaged(cfg, table, params = {}, { pageSize = 500, maxRows = 5000, order = '' } = {}) {
    const rows = [];
    const size = boundedInteger(pageSize, 500, 1, 1000);
    const requestedCap = boundedInteger(maxRows, 5000, 1, 10000);
    const cap = Math.max(size, requestedCap);
    for (let offset = 0; offset < cap; offset += size) {
      const requested = Math.min(size, cap - offset);
      const page = await supaSelectMany(cfg, table, { ...(plainObject(params) || {}), offset:String(offset) }, {
        limit: requested,
        order,
      });
      rows.push(...page.slice(0, requested));
      if (page.length < requested) return { rows, truncated:false };
    }
    return { rows:rows.slice(0, cap), truncated:rows.length >= cap };
  }

  async function supaUpsert(cfg, table, rows, onConflict) {
    const tableName = nonEmptyText(table);
    const url = restUrl(cfg, tableName);
    const conflict = nonEmptyText(onConflict);
    if (conflict) url.searchParams.set('on_conflict', conflict);
    const response = await supaIdempotentUpsertFetch(url, {
      method: 'POST',
      headers: supaHeaders(cfg, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
    }, 7000, `Supabase ${tableName}`, cfg);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const detail = safeRedact(text, 180);
      throw new Error(`Supabase ${tableName}: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
    }
  }

  async function supaInsertIgnore(cfg, table, rows, onConflict) {
    const tableName = nonEmptyText(table);
    const url = restUrl(cfg, tableName);
    const conflict = nonEmptyText(onConflict);
    if (conflict) url.searchParams.set('on_conflict', conflict);
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: supaHeaders(cfg, { Prefer: 'resolution=ignore-duplicates,return=minimal' }),
      body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
    }, 7000, `Supabase ${tableName}`);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const detail = safeRedact(text, 180);
      throw new Error(`Supabase ${tableName}: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
    }
  }

  async function supaPatch(cfg, table, filters, patch) {
    const tableName = nonEmptyText(table);
    const filterEntries = queryEntries(filters, tableName);
    if (!filterEntries.length) throw new TypeError(`Supabase ${tableName}: PATCH requires at least one filter.`);
    const url = restUrl(cfg, tableName);
    for (const [key, value] of filterEntries) url.searchParams.set(key, value);
    const response = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
      body: JSON.stringify(patch || {}),
    }, 7000, `Supabase ${tableName}`);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const detail = safeRedact(text, 180);
      throw new Error(`Supabase ${tableName}: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
    }
  }

  async function supaDelete(cfg, table, filters = {}) {
    const tableName = nonEmptyText(table);
    const filterEntries = queryEntries(filters, tableName);
    if (!filterEntries.length) throw new TypeError(`Supabase ${tableName}: DELETE requires at least one filter.`);
    const url = restUrl(cfg, tableName);
    for (const [key, value] of filterEntries) url.searchParams.set(key, value);
    const response = await fetchWithTimeout(url, {
      method: 'DELETE',
      headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
    }, 7000, `Supabase ${tableName}`);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const detail = safeRedact(text, 180);
      throw new Error(`Supabase ${tableName}: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
    }
  }

  async function supaRpc(cfg, functionName, payload = {}, timeoutMs = 7000, extraHeaders = {}) {
    const rpcName = nonEmptyText(functionName);
    const url = restUrl(cfg, rpcName, { rpc:true });
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: supaRpcHeaders(cfg, extraHeaders),
      body: JSON.stringify(payload || {}),
    }, boundedInteger(timeoutMs, 7000, 500, 120000), `Supabase RPC ${rpcName}`);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = typeof body?.message === 'string' ? safeRedact(body.message, 180) : '';
      const error = new Error(`Supabase RPC ${rpcName}: HTTP ${response.status}${message ? ` — ${message}` : ''}`);
      error.code = typeof body?.code === 'string' && body.code.trim()
        ? body.code.trim()
        : `HTTP_${response.status}`;
      error.detail = body?.details ?? null;
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
