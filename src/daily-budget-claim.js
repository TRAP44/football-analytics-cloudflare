// Суточный потолок поверх claim_provider_request.
//
// RPC claim_provider_request ограничивает окно 3600 секундами (окно больше
// часа молча превращается в часовое), поэтому «сутки» собираются из 24
// часовых корзин со стабильными ключами `${prefix}:hHH` (строк в таблице
// provider_rate_windows всегда не больше 24 на префикс). Использовано за
// сутки = сумма request_count корзин, чьё окно началось сегодня (UTC).
// Ошибка чтения или RPC — отказ (fail-closed): потолок защищает бюджет.
//
// Атомарность: прошлые часы сегодня уже закрыты и не меняются, поэтому
// лимит текущей корзины = суточный лимит − сумма ПРОШЛЫХ часов. RPC сам
// сериализует инкременты внутри текущей корзины, и параллельные запросы
// не превысят суточный потолок, даже прочитав одинаковое состояние.
// В последние секунды часа claim не делается: окно в БД могло бы уже
// смениться, и корзина прошлого часа перезаписалась бы. Часы проверяются
// дважды — до чтения и сразу перед claim (чтение может длиться секунды).

const HOUR_SECONDS = 3600;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const HOUR_EDGE_MS = 5_000;

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function dailyBudgetKey(prefix, nowMs = Date.now()) {
  const hour = String(new Date(nowMs).getUTCHours()).padStart(2, '0');
  return `${prefix}:h${hour}`;
}

function usage(rows, prefix, nowMs) {
  const dayStart = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const dayEnd = dayStart + DAY_MS;
  const hourStart = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  let previous = 0;
  let current = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const item = plainObject(row);
    if (!item || typeof item.bucket_key !== 'string' || !item.bucket_key.startsWith(`${prefix}:h`)) continue;
    const started = Date.parse(String(item.window_started_at || ''));
    const count = Number(item.request_count);
    if (!Number.isFinite(started) || started < dayStart || started >= dayEnd) continue;
    if (!Number.isInteger(count) || count <= 0) continue;
    if (started >= hourStart) current += count;
    else previous += count;
  }
  return { previous, current };
}

export function dailyBudgetUsed(rows, prefix, nowMs = Date.now()) {
  const { previous, current } = usage(rows, prefix, nowMs);
  return previous + current;
}

export async function claimDailyBudget({ cfg, supaRpc, supaSelectMany, prefix, limit, now = Date.now } = {}) {
  const clock = () => {
    const value = Number(typeof now === 'function' ? now() : now);
    return Number.isFinite(value) ? value : Date.now();
  };
  const nearHourEnd = ms => HOUR_MS - (ms % HOUR_MS) <= HOUR_EDGE_MS;
  if (!Number.isInteger(limit) || limit <= 0) return { allowed: false, used: 0, reason: 'disabled' };
  if (typeof supaRpc !== 'function' || typeof supaSelectMany !== 'function' || !/^[a-z0-9:-]{3,80}$/.test(String(prefix || ''))) {
    return { allowed: false, used: 0, reason: 'budget_unavailable' };
  }
  const nowMs = clock();
  if (nearHourEnd(nowMs)) return { allowed: false, used: 0, reason: 'hour_boundary' };
  let used;
  let previous;
  try {
    const rows = await supaSelectMany(
      cfg,
      'provider_rate_windows',
      { bucket_key: `like.${prefix}:h*` },
      { select: 'bucket_key,window_started_at,request_count', limit: 30 },
    );
    if (!Array.isArray(rows)) throw new TypeError('provider_rate_windows lookup returned an invalid response.');
    const counted = usage(rows, prefix, nowMs);
    previous = counted.previous;
    used = counted.previous + counted.current;
  } catch {
    return { allowed: false, used: 0, reason: 'budget_unavailable' };
  }
  if (used >= limit) return { allowed: false, used, reason: 'daily_limit' };
  const claimMs = clock();
  if (Math.floor(claimMs / HOUR_MS) !== Math.floor(nowMs / HOUR_MS) || nearHourEnd(claimMs)) {
    return { allowed: false, used, reason: 'hour_boundary' };
  }
  try {
    const result = plainObject(await supaRpc(cfg, 'claim_provider_request', {
      p_bucket_key: dailyBudgetKey(prefix, nowMs),
      // Только остаток после закрытых часов: так потолок атомарен (см. выше).
      p_limit: limit - previous,
      p_window_seconds: HOUR_SECONDS,
    }, 1800));
    return result?.allowed === true
      ? { allowed: true, used: used + 1, reason: '' }
      : { allowed: false, used, reason: 'daily_limit' };
  } catch {
    return { allowed: false, used, reason: 'budget_unavailable' };
  }
}
