// Админка: раздел «Отзывы» — последние сообщения пользователей из «Сообщить о проблеме».
// Без идентификаторов пользователей: сервер отдаёт только раздел, важность, текст и время.

export function createAdminFeedbackInbox({ elementById, api, escapeHtml, dateTime, isAdmin }) {
  if (typeof elementById !== 'function' || typeof api !== 'function' || typeof escapeHtml !== 'function') {
    throw new TypeError('Admin feedback inbox requires elementById, api and escapeHtml.');
  }
  const $ = elementById;
  const formatTime = typeof dateTime === 'function' ? dateTime : value => String(value || '');
  let data = null;
  let loading = false;
  let error = '';

  function reviewsLabel(count) {
    const n = Math.abs(Number(count) || 0) % 100;
    const last = n % 10;
    if (n > 10 && n < 20) return `${count} отзывов`;
    if (last === 1) return `${count} отзыв`;
    if (last >= 2 && last <= 4) return `${count} отзыва`;
    return `${count} отзывов`;
  }

  function itemHtml(item) {
    const severity = String(item?.severity || '');
    const tone = severity === 'BLOCKER' ? 'blocker' : severity === 'MAJOR' ? 'major' : 'minor';
    const who = item?.kind === 'beta' ? 'Бета' : 'Пользователь';
    return `<article class="admin-feedback-item ${tone}">
      <div class="admin-feedback-meta">
        <b>${escapeHtml(item?.categoryLabel || 'Другое')}</b>
        <span>${escapeHtml(item?.severityLabel || '—')}</span>
        <small>${escapeHtml(who)}${item?.createdAt ? ` · ${escapeHtml(formatTime(item.createdAt))}` : ''}</small>
      </div>
      <p>${escapeHtml(item?.note || '')}</p>
    </article>`;
  }

  function render() {
    const list = $('adminFeedbackList');
    const meta = $('adminFeedbackMeta');
    if (!list) return;
    if (loading && !data) {
      list.innerHTML = '<div class="beta-empty">Загружаю отзывы…</div>';
      return;
    }
    if (error && !data) {
      list.innerHTML = `<div class="beta-empty">Не удалось загрузить отзывы: ${escapeHtml(error)}</div>`;
      return;
    }
    const items = Array.isArray(data?.items) ? data.items : [];
    if (meta) {
      meta.textContent = data
        ? `За ${Number(data.days) || 30} дн. · ${reviewsLabel(items.length)}${data.persistent === false ? ' · только из памяти воркера' : ''}`
        : '';
    }
    // Ревью Codex (#815): после неудачного обновления показываем ошибку над старым списком,
    // чтобы не выдавать устаревшие данные за свежие.
    // Пока идёт повторная попытка, старый список всё ещё старый — пометка остаётся (ревью Codex #817).
    const stale = error
      ? `<div class="data-notice stale">⚠️ Не удалось обновить отзывы: ${escapeHtml(error)}. ${loading ? 'Повторяю попытку — пока показана' : 'Показана'} последняя загруженная версия.</div>`
      : '';
    list.innerHTML = stale + (items.length
      ? items.map(itemHtml).join('')
      : '<div class="beta-empty">Отзывов пока нет. Они появятся, когда пользователи нажмут «Сообщить о проблеме» в профиле.</div>');
  }

  async function load(force = false) {
    if (typeof isAdmin === 'function' && !isAdmin()) return;
    if (loading || (!force && data)) { render(); return; }
    loading = true;
    render();
    try {
      data = await api('/api/admin/feedback?days=30', { retry: false, timeoutMs: 9000 });
      error = '';
    } catch (e) {
      error = String(e?.message || 'ошибка сети');
    } finally {
      loading = false;
      render();
    }
  }

  return Object.freeze({ load, render });
}
