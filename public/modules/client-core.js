// Phase 3 public client infrastructure boundary.
// Transport/bootstrap helpers only; product and authorization semantics remain outside.
export function initTelegramWebApp(scope = window) {
  const tg = scope.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    try { tg.setHeaderColor('secondary_bg_color'); } catch {}
  }
  return tg;
}

export function localDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function safeDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function timeOf(iso) {
  const d = safeDate(iso);
  if (!d) return '—';
  try { return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d); } catch { return '—'; }
}

export function dateTime(iso) {
  const d = safeDate(iso);
  if (!d) return '';
  try { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d); } catch { return ''; }
}

export function dateOnly(iso) {
  const d = safeDate(iso);
  if (!d) return '';
  try { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(d); } catch { return ''; }
}

export function relativeAge(iso) {
  const ms = Date.now() - Date.parse(iso || '');
  if (!Number.isFinite(ms) || ms < 0) return '';
  const sec = Math.floor(ms / 1000);
  if (sec < 15) return 'только что';
  if (sec < 60) return `${sec} сек. назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин. назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч. назад`;
  const days = Math.floor(h / 24);
  return `${days} дн. назад`;
}

const PHASE5_SESSION_KEY = 'football-analytics:phase5-session:v2';

export function phase5SessionToken(scope = globalThis) {
  try {
    const storage = scope?.sessionStorage;
    const existing = String(storage?.getItem(PHASE5_SESSION_KEY) || '').toLowerCase();
    if (/^[0-9a-f]{32}$/.test(existing)) return existing;
    const bytes = new Uint8Array(16);
    if (scope?.crypto?.getRandomValues) scope.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    const token = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    storage?.setItem(PHASE5_SESSION_KEY, token);
    return token;
  } catch {
    return '';
  }
}

export function createApiClient(deps) {
  const { state, tg, inflightGetRequests, observeServerVersion, showBootRecovery, applyRuntimeUi, normalizeApiError, noteRequestSuccess, noteRequestFailure } = deps;
  const validationSession = phase5SessionToken();
  return async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const isGet = method === 'GET';
  const timeoutMs = Number(options.timeoutMs || 12000);
  const retryable = isGet && options.retry !== false;
  const dedupe = isGet && options.dedupe !== false;
  const requestKey = `${method}:${path}`;

  if (dedupe && inflightGetRequests.has(requestKey)) {
    state.clientPerf.deduped += 1;
    return inflightGetRequests.get(requestKey);
  }

  const task = (async () => {
    let attempt = 0;
    while (true) {
      const started = performance.now();
      state.clientPerf.requests += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), timeoutMs);
      const headers = new Headers(options.headers || {});
      headers.set('Content-Type', 'application/json');
      if (tg?.initData) headers.set('x-telegram-init-data', tg.initData);
      if (validationSession) headers.set('x-phase5-session', validationSession);
      try {
        const { timeoutMs: _timeoutMs, retry: _retry, dedupe: _dedupe, ...fetchOptions } = options;
        const response = await fetch(path, { ...fetchOptions, method, headers, signal: controller.signal });
        const serverVersion = String(response.headers.get('x-app-version') || '');
        if (serverVersion) observeServerVersion(serverVersion, response);
        if (state.compatibilityBlocked) {
          showBootRecovery({ blocking: true, title: 'Нужно обновить приложение', text: state.compatibilityReason });
          throw Object.assign(new Error(state.compatibilityReason), { status: 426, payload: { category: 'compatibility' } });
        }
        const data = await response.json().catch(() => ({}));
        const runtimeFromPayload = data?.runtime || data?.dataCapabilities?.runtime || data?.features?.runtime || null;
        if (runtimeFromPayload) {
          state.runtimeStatus = runtimeFromPayload;
          applyRuntimeUi();
        }
        if (!response.ok) {
          if (response.status === 403 && String(data?.code || '') === 'CLOSED_BETA_ACCESS_REQUIRED') {
            state.closedBetaBlocked = true;
            showBootRecovery({
              blocking: true,
              title: 'Доступ временно ограничен',
              text: 'Для этого аккаунта доступ временно ограничен.',
            });
          }
          const error = Object.assign(new Error(data.error || `HTTP ${response.status}`), {
            status: response.status,
            payload: data,
            retryAfter: Number(data.retryAfter || response.headers.get('retry-after') || 0),
          });
          if (response.status === 429) state.clientPerf.rateLimited += 1;
          if (retryable && attempt < 1 && [502, 503, 504].includes(response.status) && !['maintenance','feature_disabled'].includes(String(data.category || ''))) throw Object.assign(error, { transient: true });
          throw error;
        }
        const elapsed = Math.round(performance.now() - started);
        state.clientPerf.completed += 1;
        state.clientPerf.lastMs = elapsed;
        state.clientPerf.totalMs += elapsed;
        noteRequestSuccess();
        return data;
      } catch (error) {
        const aborted = error?.name === 'AbortError';
        const transient = Boolean(error?.transient) || aborted || (!error?.status && navigator.onLine !== false);
        if (retryable && attempt < 1 && transient) {
          attempt += 1;
          state.clientPerf.retries += 1;
          await new Promise(resolve => setTimeout(resolve, 350 + Math.floor(Math.random() * 250)));
          continue;
        }
        state.clientPerf.failed += 1;
        let finalError = error;
        if (aborted) {
          state.clientPerf.timeouts += 1;
          finalError = Object.assign(new Error('Сервер отвечает слишком долго.'), { status: 408, payload: { category: 'timeout' } });
        } else if (navigator.onLine === false && !error?.status) {
          finalError = Object.assign(new Error('Нет подключения к интернету.'), { status: 0 });
        }
        finalError = normalizeApiError(finalError);
        noteRequestFailure(finalError);
        throw finalError;
      } finally {
        clearTimeout(timeout);
      }
    }
  })();

  if (dedupe) inflightGetRequests.set(requestKey, task);
  try { return await task; }
  finally { if (dedupe && inflightGetRequests.get(requestKey) === task) inflightGetRequests.delete(requestKey); }
  };
}
