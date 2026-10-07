export function createJourneyStateModule({
  elementById,
  escapeHtml,
}) {
  if (typeof elementById !== 'function' || typeof escapeHtml !== 'function') {
    throw new TypeError('Journey State requires elementById and escapeHtml.');
  }

  const $ = elementById;

  function renderJourneyState(kind, { title = '', message = '', retry = null } = {}) {
    const root = $('analysis');
    if (!root) return;
    const loading = kind === 'loading';
    const canRetry = !loading && typeof retry === 'function';
    root.setAttribute('aria-busy', loading ? 'true' : 'false');
    root.innerHTML = `<section class="panel journey-state ${loading ? 'is-loading' : 'is-error'}" role="status" aria-live="polite">
      <span class="journey-state-icon">${loading ? '⏳' : '↻'}</span>
      <div><strong>${escapeHtml(title || (loading ? 'Загружаем…' : 'Не удалось открыть раздел'))}</strong><p>${escapeHtml(message || (loading ? 'Подготавливаем данные матча.' : 'Попробуйте ещё раз.'))}</p></div>
      ${canRetry ? '<button id="analysisStateRetry" class="primary-setting-btn" type="button">Повторить</button>' : ''}
    </section>`;
    if (canRetry) $('analysisStateRetry')?.addEventListener('click', retry, { once: true });
  }

  return Object.freeze({ renderJourneyState });
}
