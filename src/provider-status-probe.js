// Фоновые задания (предматчевые прогнозы, кривая по ходу матча) решают, можно ли
// обращаться к API-Football, по снимку квоты провайдера. В процессе cron-runner
// своей памяти о квоте нет, а общий снимок в Supabase живёт 30 минут после
// последнего запроса к провайдеру. Когда пользователи не открывают приложение,
// снимок истекает, тариф становится UNKNOWN и задания молча ждут бесконечно
// (12.10: 0 новых прогнозов при лимите 60 в сутки).
//
// Решение: если снимка нет или он не подтверждает тариф, задание само
// спрашивает /status. По документации API-Football этот запрос не расходует
// дневную квоту. Ответ обновляет снимок через заголовки (общий шлюз), а если
// заголовков нет — по телу ответа (requests.limit_day / requests.current).

const PROBE_MAX_AGE_MS = 30 * 60_000;

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function utcDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Нужно ли спросить /status перед решением о бюджете. */
export function providerSnapshotNeedsProbe(snapshot, nowMs = Date.now()) {
  const snap = plainObject(snapshot) || {};
  if (snap.cooldownActive === true) return false;
  const plan = String(snap.plan || 'UNKNOWN').toUpperCase();
  if (['PRO', 'ULTRA', 'MEGA'].includes(plan)) return false;
  if (plan !== 'FREE') return true;
  // Бесплатный тариф: остаток нужен свежий и за текущие сутки UTC.
  const updatedMs = Date.parse(String(snap.updatedAt || ''));
  if (!Number.isFinite(updatedMs)) return true;
  return utcDate(updatedMs) !== utcDate(nowMs) || nowMs - updatedMs > PROBE_MAX_AGE_MS;
}

function count(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

/** Квота из тела ответа /status: { requests: { current, limit_day } }. */
export function quotaFromStatusBody(body, inferPlan) {
  const requests = plainObject(plainObject(body)?.requests);
  if (!requests || typeof inferPlan !== 'function') return null;
  const limit = count(requests.limit_day);
  const current = count(requests.current);
  if (limit === null || limit <= 0 || current === null) return null;
  const plan = String(inferPlan(limit) || 'UNKNOWN').toUpperCase();
  if (!['FREE', 'PRO', 'ULTRA', 'MEGA'].includes(plan)) return null;
  return { plan, dailyLimit: limit, dailyRemaining: Math.max(0, limit - current) };
}

/**
 * Загружает общий снимок квоты и, если он не подтверждает тариф, один раз
 * спрашивает /status. Ошибки не пробрасываются: решение о бюджете примет
 * providerBudgetDecision по тому снимку, что есть.
 */
export async function ensureProviderSnapshot({ cfg, loadSharedProviderState, providerSnapshot, probeProviderStatus, nowMs = Date.now() } = {}) {
  if (typeof loadSharedProviderState === 'function') {
    try {
      await loadSharedProviderState(cfg);
    } catch {}
  }
  if (typeof probeProviderStatus !== 'function' || typeof providerSnapshot !== 'function') return { probed: false };
  let needs = false;
  try {
    needs = providerSnapshotNeedsProbe(providerSnapshot(), nowMs);
  } catch {
    needs = false;
  }
  if (!needs) return { probed: false };
  try {
    await probeProviderStatus(cfg);
    return { probed: true, ok: true };
  } catch {
    return { probed: true, ok: false };
  }
}
