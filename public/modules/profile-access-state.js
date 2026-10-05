// @ts-check

export function createProfileAccessStateModule({
  elementById,
  escapeHtml,
  onRetry,
}) {
  if (typeof elementById !== 'function' || typeof escapeHtml !== 'function' || typeof onRetry !== 'function') {
    throw new TypeError('Profile Access State requires elementById, escapeHtml and onRetry.');
  }

  const $ = elementById;

  function renderProfileAccessState(kind = 'ready', message = '') {
    const view = $('profileView');
    const root = $('profileRecovery');
    if (!view || !root) return;
    const unavailable = kind !== 'ready';
    view.classList.toggle('profile-unavailable', unavailable);
    root.hidden = !unavailable;
    if (!unavailable) {
      root.innerHTML = '';
      return;
    }

    const loading = kind === 'loading';
    root.innerHTML = `<section class="panel journey-state ${loading ? 'is-loading' : 'is-error'}" role="status" aria-live="polite">
      <span class="journey-state-icon">${loading ? '⏳' : '↻'}</span>
      <div><strong>${loading ? 'Загружаем профиль' : 'Профиль временно недоступен'}</strong><p>${escapeHtml(message || (loading ? 'Получаем ваши настройки и избранное.' : 'Не удалось обновить профиль.'))}</p></div>
      ${loading ? '' : '<button id="profileRecoveryRetry" class="primary-setting-btn" type="button">Повторить</button>'}
    </section>`;

    if (!loading) {
      $('profileRecoveryRetry')?.addEventListener('click', onRetry, { once: true });
    }
  }

  return Object.freeze({ renderProfileAccessState });
}
