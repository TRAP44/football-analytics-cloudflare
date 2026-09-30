const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const positiveId = value => {
  const id = Number(value || 0);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
};

export function createPlayerFollowModule({
  state,
  api,
  toast = () => {},
  onChange = () => {},
}) {
  state.favoritePlayers = Array.isArray(state.favoritePlayers) ? state.favoritePlayers : [];
  state.favoritePlayersLoaded = Boolean(state.favoritePlayersLoaded);
  state.favoritePlayersLoading = Boolean(state.favoritePlayersLoading);
  state.favoritePlayersLoadError = String(state.favoritePlayersLoadError || '');
  state.favoritePlayersRevision = Number(state.favoritePlayersRevision || 0);
  state.favoritePlayerMutations = state.favoritePlayerMutations instanceof Set
    ? state.favoritePlayerMutations
    : new Set();

  const playerIdOf = player => positiveId(player?.data?.id || player?.playerId);
  const teamIdOf = player => positiveId(player?.team?.id || player?.teamId);
  const fixtureIdOf = player => positiveId(player?.match?.fixtureId || player?.fixtureId);

  function isFollowing(playerId) {
    const id = positiveId(playerId);
    return Boolean(id && state.favoritePlayers.some(item => positiveId(item?.playerId) === id));
  }

  function syncProfileCount() {
    if (!state.profile) return;
    state.profile = {
      ...state.profile,
      stats: {
        ...(state.profile.stats || {}),
        favoritePlayers: state.favoritePlayers.length,
      },
    };
  }

  function controlHtml(player) {
    const playerId = playerIdOf(player);
    const teamId = teamIdOf(player);
    const fixtureId = fixtureIdOf(player);
    if (!playerId || !teamId || !fixtureId) {
      return '<button class="btn secondary player-follow-btn" type="button" disabled>☆ Следить за игроком</button>';
    }

    const pending = state.favoritePlayerMutations.has(playerId);
    const active = isFollowing(playerId);

    if (!state.favoritePlayersLoaded) {
      if (state.favoritePlayersLoadError) {
        return `<button class="btn secondary player-follow-btn has-error" type="button" data-player-follow-retry title="${esc(state.favoritePlayersLoadError)}">↻ Проверить статус</button>`;
      }
      return '<button class="btn secondary player-follow-btn" type="button" disabled aria-busy="true">Загрузка статуса…</button>';
    }

    const label = pending
      ? (active ? 'Сохраняю…' : 'Удаляю…')
      : (active ? '★ Вы отслеживаете игрока' : '☆ Следить за игроком');

    return `<button
      class="btn secondary player-follow-btn ${active ? 'is-active' : ''} ${pending ? 'is-pending' : ''}"
      type="button"
      data-player-follow-toggle
      data-player-id="${playerId}"
      aria-pressed="${active ? 'true' : 'false'}"
      ${pending ? 'disabled aria-busy="true"' : ''}
    >${label}</button>`;
  }

  async function loadFavoritePlayers({ force = false } = {}) {
    if (state.favoritePlayersLoading) return false;
    if (state.favoritePlayersLoaded && !force) return true;

    const revisionAtStart = state.favoritePlayersRevision;
    state.favoritePlayersLoading = true;
    state.favoritePlayersLoadError = '';
    onChange();

    try {
      const data = await api('/api/favorite-players');
      if (revisionAtStart !== state.favoritePlayersRevision) return false;
      state.favoritePlayers = Array.isArray(data?.items) ? data.items : [];
      state.favoritePlayersLoaded = true;
      state.favoritePlayersLoadError = '';
      syncProfileCount();
      return true;
    } catch (error) {
      if (revisionAtStart !== state.favoritePlayersRevision) return false;
      state.favoritePlayersLoadError = error?.message || 'Не удалось загрузить отслеживаемых игроков.';
      if (state.favoritePlayersLoaded) {
        toast('Игроки временно не обновились — показаны последние данные.');
      }
      return false;
    } finally {
      state.favoritePlayersLoading = false;
      onChange();
    }
  }

  async function togglePlayerFollow(player) {
    const playerId = playerIdOf(player);
    const teamId = teamIdOf(player);
    const fixtureId = fixtureIdOf(player);
    if (!playerId || !teamId || !fixtureId || state.favoritePlayerMutations.has(playerId)) return false;

    if (!state.favoritePlayersLoaded) {
      const loaded = await loadFavoritePlayers({ force: true });
      if (!loaded) return false;
    }

    const active = isFollowing(playerId);
    const previousItems = state.favoritePlayers.map(item => ({ ...item }));
    const previousStats = state.profile?.stats ? { ...state.profile.stats } : null;
    const playerName = String(player?.data?.name || '').trim() || 'Игрок';

    state.favoritePlayerMutations.add(playerId);
    state.favoritePlayersRevision += 1;
    state.favoritePlayersLoadError = '';

    if (active) {
      state.favoritePlayers = state.favoritePlayers.filter(item => positiveId(item?.playerId) !== playerId);
    } else {
      state.favoritePlayers = [{
        playerId,
        playerName,
        teamId,
        createdAt: new Date().toISOString(),
        optimistic: true,
      }, ...state.favoritePlayers.filter(item => positiveId(item?.playerId) !== playerId)];
    }
    syncProfileCount();
    onChange();

    try {
      if (active) {
        await api(`/api/favorite-players?playerId=${playerId}`, { method: 'DELETE' });
        toast(`${playerName}: отслеживание отключено`);
      } else {
        const data = await api('/api/favorite-players', {
          method: 'POST',
          body: JSON.stringify({ playerId, teamId, fixtureId }),
        });
        const saved = data?.item || { playerId, playerName, teamId };
        state.favoritePlayers = [
          saved,
          ...state.favoritePlayers.filter(item => positiveId(item?.playerId) !== playerId),
        ];
        syncProfileCount();
        toast(`${playerName}: игрок отслеживается`);
      }
      return true;
    } catch (error) {
      state.favoritePlayers = previousItems;
      if (state.profile && previousStats) {
        state.profile = { ...state.profile, stats: previousStats };
      }
      state.favoritePlayersLoadError = error?.message || 'Не удалось изменить отслеживание игрока.';
      toast(`Не удалось изменить отслеживание: ${state.favoritePlayersLoadError}`);
      return false;
    } finally {
      state.favoritePlayerMutations.delete(playerId);
      onChange();
    }
  }

  function bind(root, player) {
    if (!root || !player) return;
    root.querySelector('[data-player-follow-toggle]')?.addEventListener('click', () => {
      void togglePlayerFollow(player);
    });
    root.querySelector('[data-player-follow-retry]')?.addEventListener('click', () => {
      void loadFavoritePlayers({ force: true });
    });
  }

  return {
    isFollowing,
    controlHtml,
    loadFavoritePlayers,
    togglePlayerFollow,
    bind,
  };
}
