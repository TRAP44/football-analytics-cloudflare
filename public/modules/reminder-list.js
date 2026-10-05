// @ts-check

export function createReminderListModule({
  state,
  elementById,
  querySelectorAll,
  escapeHtml,
  dateTime,
  recoveryCardHtml,
  onRetry,
  onOpenMatches,
  onRemove,
}) {
  if (!state || typeof elementById !== 'function' || typeof querySelectorAll !== 'function' || typeof escapeHtml !== 'function' || typeof dateTime !== 'function' || typeof recoveryCardHtml !== 'function' || typeof onRetry !== 'function' || typeof onOpenMatches !== 'function' || typeof onRemove !== 'function') {
    throw new TypeError('Reminder List requires state, DOM helpers, formatters and explicit callbacks.');
  }

  const $ = elementById;

  function reminderDeliveryBadge(item) {
    const status = String(item?.deliveryStatus || 'scheduled');
    if (status === 'kickoff_sent') return '<span class="reminder-delivery-badge sent">✓ Старт отправлен</span>';
    if (status === 'prematch_sent') return '<span class="reminder-delivery-badge sent">✓ Предматчевое отправлено</span>';
    if (status === 'retry_pending') return '<span class="reminder-delivery-badge retry">↻ Повтор доставки</span>';
    return '<span class="reminder-delivery-badge scheduled">● Запланировано</span>';
  }

  function renderReminderList() {
    const el = $('reminderList');
    if (!el) return;

    if (state.remindersLoading && !state.remindersLoaded) {
      el.innerHTML = '<div class="loader compact-loader">Загружаю напоминания…</div>';
      return;
    }

    if (state.remindersLoadError && !state.remindersLoaded) {
      el.innerHTML = recoveryCardHtml({
        title: 'Напоминания временно недоступны',
        message: state.remindersLoadError,
        retryId: 'remindersRetry',
        compact: true,
      });
      $('remindersRetry')?.addEventListener('click', onRetry);
      return;
    }

    if (!state.reminders.length) {
      const warning = state.remindersLoadError
        ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.remindersLoadError)} Последний загруженный список напоминаний был пуст.</div>`
        : '';
      const retry = state.remindersLoadError
        ? '<button id="remindersEmptyRetry" class="secondary-btn" type="button">Обновить</button>'
        : '';
      el.innerHTML = `${warning}<div class="empty compact-empty profile-empty-state">
        <strong>Активных напоминаний пока нет</strong>
        <p>Откройте матч и включите напоминание перед началом.</p>
        <div class="empty-actions">${retry}<button id="remindersEmptyMatches" class="secondary-btn" type="button">Перейти к матчам</button></div>
      </div>`;
      $('remindersEmptyRetry')?.addEventListener('click', onRetry);
      $('remindersEmptyMatches')?.addEventListener('click', onOpenMatches);
      return;
    }

    const rows = [...state.reminders].sort((a, b) => Date.parse(a.fixtureDate || 0) - Date.parse(b.fixtureDate || 0));
    const staleNotice = state.remindersLoadError
      ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.remindersLoadError)} Показаны последние загруженные напоминания.</div>`
      : '';

    el.innerHTML = staleNotice + rows.map(x => `
      <div class="reminder-row">
        <div>
          <strong>${escapeHtml(x.homeName)} — ${escapeHtml(x.awayName)}</strong>
          <span>${dateTime(x.fixtureDate)} · за ${Number(x.remindBeforeMinutes || 30)} мин.${x.kickoffNotify ? ' · + старт' : ''}</span>
          ${reminderDeliveryBadge(x)}
        </div>
        <button class="reminder-remove" type="button" data-fixture-id="${Number(x.fixtureId)}" ${state.reminderMutations.has(Number(x.fixtureId)) ? 'disabled' : ''}>Отключить</button>
      </div>`).join('');

    querySelectorAll('.reminder-remove').forEach(btn => btn.addEventListener('click', () => {
      const fixtureId = Number(btn.dataset.fixtureId);
      if (!fixtureId || state.reminderMutations.has(fixtureId)) return;
      onRemove(fixtureId);
    }));
  }

  return Object.freeze({
    reminderDeliveryBadge,
    renderReminderList,
  });
}
