// Phase 3 public client infrastructure boundary.
// Contains transport/bootstrap helpers only; product and authorization semantics stay outside.
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
  try { return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(d); } catch { return '—'; }
}

export function dateTime(iso) {
  const d = safeDate(iso);
  if (!d) return '';
  try { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d); } catch { return ''; }
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

async function api(path, options = {}
