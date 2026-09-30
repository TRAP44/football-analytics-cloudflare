export function createHistoryRenderer({
  state,
  elementById,
  recoveryCardHtml,
  escapeHtml,
  safeUrl,
  dateTime,
  relativeAge,
  onReloadHistory,
  onOpenSearch,
  onOpenHistoryAnalysis,
}) {
  if (!state || typeof elementById !== 'function') {
    throw new TypeError('History renderer requires state and elementById.');
  }

  const $ = elementById;
  const reloadHistory = typeof onReloadHistory === 'function' ? onReloadHistory : () => {};
  const openSearch = typeof onOpenSearch === 'function' ? onOpenSearch : () => {};
  const openHistoryAnalysis = typeof onOpenHistoryAnalysis === 'function' ? onOpenHistoryAnalysis : () => {};

  function renderHistory() {
    const el = $('history');
    if (!el) return;
    if (state.historyLoading && !state.historyLoaded) {
      el.innerHTML = '<div class="loader">Загружаю историю…</div>';
      return;
    }
    if (state.historyLoadError && !state.historyLoaded) {
      el.innerHTML = recoveryCardHtml({ title: 'История временно недоступна', message: state.historyLoadError, retryId: 'historyRecoveryRetry' });
      $('historyRecoveryRetry')?.addEventListener('click', () => reloadHistory(true));
      return;
    }
    if (!state.history.length) {
      const retry = state.historyLoadError
        ? '<button id="historyEmptyRetry" class="secondary-btn" type="button">Обновить историю</button>'
        : '';
      el.innerHTML = `
        ${state.historyLoadError ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.historyLoadError)} Последняя загруженная история была пустой.</div>` : ''}
        <div class="empty history-empty-state">
          <strong>История пока пуста</strong>
          <p>После первого полного анализа матч появится здесь для быстрого повторного открытия.</p>
          <div class="empty-actions">
            ${retry}
            <button id="historyEmptyMatches" class="primary-setting-btn" type="button">Найти матч</button>
          </div>
        </div>`;
      $('historyEmptyRetry')?.addEventListener('click', () => reloadHistory(true));
      $('historyEmptyMatches')?.addEventListener('click', () => openSearch());
      return;
    }
    const notice = state.historyLoading
      ? '<div class="data-notice">↻ Обновляю историю…</div>'
      : state.historyLoadError
        ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.historyLoadError)} Показана последняя загруженная история.</div>`
        : '';
    el.innerHTML = notice + state.history.map(item => `
      <article class="history-item">
        <div class="history-logos">
          ${item.homeLogo ? `<img src="${safeUrl(item.homeLogo)}" alt="">` : ''}
          <span>—</span>
          ${item.awayLogo ? `<img src="${safeUrl(item.awayLogo)}" alt="">` : ''}
        </div>
        <div class="history-main">
          <strong>${escapeHtml(item.homeName)} — ${escapeHtml(item.awayName)}</strong>
          <span>${escapeHtml(item.leagueName || '')}${item.fixtureDate ? ` · ${dateTime(item.fixtureDate)}` : ''}${item.viewedAt ? ` · открыто ${relativeAge(item.viewedAt)}` : ''}</span>
          ${item.aiSignalLabel ? `<em class="history-ai-chip ${item.aiSignalCode === 'skip' ? 'skip' : ''}">AI · ${escapeHtml(item.aiSignalLabel)}${Number.isFinite(Number(item.aiConfidence)) ? ` · ${Math.round(Number(item.aiConfidence))}/100` : ''}</em>` : ''}
        </div>
        <button class="history-open" data-fixture="${Number(item.fixtureId)}" type="button" aria-label="Открыть анализ матча ${escapeHtml(item.homeName)} — ${escapeHtml(item.awayName)}">Открыть</button>
      </article>
    `).join('');
    el.querySelectorAll('.history-open').forEach(btn => btn.addEventListener('click', () => openHistoryAnalysis(Number(btn.dataset.fixture), btn)));
  }

  return Object.freeze({ renderHistory });
}
