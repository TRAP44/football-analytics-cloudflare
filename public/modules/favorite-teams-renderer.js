export function createFavoriteTeamsRenderer({
  state,
  elementById,
  escapeHtml,
  safeUrl,
  recoveryCardHtml,
  onRetryLoad,
  onShowMatches,
  onRemoveFavorite,
  onOpenTeam,
}) {
  if (!state || typeof elementById !== 'function' || typeof escapeHtml !== 'function' || typeof safeUrl !== 'function') {
    throw new TypeError('Favorite Teams renderer requires state, elementById, escapeHtml and safeUrl.');
  }

  const $ = elementById;

  function renderFavoriteTeams() {
    const el = $('favoriteTeams');
    if (!el) return;

    if (state.favoritesLoading && !state.favoritesLoaded) {
      el.innerHTML = '<div class="loader compact-loader">Загружаю избранное…</div>';
      return;
    }

    if (state.favoritesLoadError && !state.favoritesLoaded) {
      el.innerHTML = recoveryCardHtml({
        title: 'Избранное временно недоступно',
        message: state.favoritesLoadError,
        retryId: 'favoritesRetry',
        compact: true,
      });
      $('favoritesRetry')?.addEventListener('click', onRetryLoad);
      return;
    }

    if (!state.favorites.length) {
      const warning = state.favoritesLoadError
        ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.favoritesLoadError)} Последний загруженный список избранного был пуст.</div>`
        : '';
      const retry = state.favoritesLoadError
        ? '<button id="favoritesEmptyRetry" class="secondary-btn" type="button">Обновить</button>'
        : '';
      el.innerHTML = `${warning}<div class="empty compact-empty profile-empty-state">
        <strong>Избранных команд пока нет</strong>
        <p>Добавьте команду звёздочкой в списке матчей.</p>
        <div class="empty-actions">${retry}<button id="favoritesEmptyMatches" class="secondary-btn" type="button">Перейти к матчам</button></div>
      </div>`;
      $('favoritesEmptyRetry')?.addEventListener('click', onRetryLoad);
      $('favoritesEmptyMatches')?.addEventListener('click', onShowMatches);
      return;
    }

    const staleNotice = state.favoritesLoadError
      ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.favoritesLoadError)} Показано последнее загруженное избранное.</div>`
      : '';
    el.innerHTML = staleNotice + state.favorites.map(item => `
      <div class="favorite-team-row">
        <button class="favorite-team-main team-open-link" type="button" data-open-team="${Number(item.teamId)}" data-team-name="${escapeHtml(item.teamName)}" data-team-logo="${escapeHtml(item.teamLogo || '')}">
          ${item.teamLogo ? `<img src="${safeUrl(item.teamLogo)}" alt="">` : '<span class="team-placeholder">⚽</span>'}
          <strong>${escapeHtml(item.teamName)}</strong>
        </button>
        <button class="favorite-remove" type="button" data-team-id="${Number(item.teamId)}" data-team-name="${escapeHtml(item.teamName)}" ${state.favoriteMutations.has(Number(item.teamId)) ? 'disabled' : ''}>Удалить</button>
      </div>
    `).join('');

    el.querySelectorAll('.favorite-remove').forEach(button => button.addEventListener('click', () => {
      const item = state.favorites.find(entry => Number(entry.teamId) === Number(button.dataset.teamId));
      if (item) onRemoveFavorite?.({ id: item.teamId, name: item.teamName, logo: item.teamLogo });
    }));

    el.querySelectorAll('[data-open-team]').forEach(button => button.addEventListener('click', () => {
      onOpenTeam?.({
        id: Number(button.dataset.openTeam),
        name: button.dataset.teamName || '',
        logo: button.dataset.teamLogo || '',
      });
    }));
  }

  return Object.freeze({ renderFavoriteTeams });
}
