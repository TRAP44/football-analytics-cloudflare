import { PERSONAL_WRITE_LIMITS, normalizeFavoriteWrite, sanitizeTeamLogoUrl } from './personal-write-guards.js';

export function createUserFavoritesService({
  memory,
  hasSupabase,
  supaSelectMany,
  supaRpc,
  fetchWithTimeout,
  supaHeaders,
}) {
  async function getFavorites(userId, cfg) {
    const rows = hasSupabase(cfg)
      ? await supaSelectMany(cfg, 'favorites', { telegram_id: `eq.${Number(userId)}` }, { limit: 50, order: 'created_at.desc' })
      : (memory.favorites.get(Number(userId)) || []);
    return (rows || []).map(row => ({
      ...row,
      team_logo: sanitizeTeamLogoUrl(row?.team_logo),
    }));
  }

  async function addFavorite(userId, team, cfg) {
    const normalized = normalizeFavoriteWrite({
      teamId: team?.id,
      teamName: team?.name,
      teamLogo: team?.logo,
    });
    const row = {
      telegram_id: Number(userId),
      team_id: normalized.teamId,
      team_name: normalized.teamName,
      team_logo: normalized.teamLogo,
      created_at: new Date().toISOString(),
    };
    if (hasSupabase(cfg)) {
      const result = await supaRpc(cfg, 'save_favorite_guarded', {
        p_telegram_id: row.telegram_id,
        p_team_id: row.team_id,
        p_team_name: row.team_name,
        p_team_logo: row.team_logo,
        p_limit: PERSONAL_WRITE_LIMITS.favorites,
      }, 4000);
      if (!result?.allowed) {
        const reason = String(result?.reason || 'rejected');
        const error = new Error(reason === 'limit_reached'
          ? `Можно сохранить не больше ${PERSONAL_WRITE_LIMITS.favorites} команд.`
          : 'Некорректные данные избранной команды.');
        error.code = reason === 'limit_reached' ? 'FAVORITES_LIMIT' : 'PERSONAL_DATA_INVALID';
        throw error;
      }
      return result.item || row;
    }
    const key = Number(userId);
    const list = memory.favorites.get(key) || [];
    const existing = list.some(x => Number(x.team_id) === row.team_id);
    if (!existing && list.length >= PERSONAL_WRITE_LIMITS.favorites) {
      const error = new Error(`Можно сохранить не больше ${PERSONAL_WRITE_LIMITS.favorites} команд.`);
      error.code = 'FAVORITES_LIMIT';
      throw error;
    }
    memory.favorites.set(key, [row, ...list.filter(x => Number(x.team_id) !== row.team_id)].slice(0, PERSONAL_WRITE_LIMITS.favorites));
    return row;
  }

  async function removeFavorite(userId, teamId, cfg) {
    const id = Number(teamId);
    if (hasSupabase(cfg)) {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/favorites`);
      url.searchParams.set('telegram_id', `eq.${Number(userId)}`);
      url.searchParams.set('team_id', `eq.${id}`);
      const r = await fetchWithTimeout(url, {
        method: 'DELETE',
        headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
      }, 7000, 'Supabase favorites');
      if (!r.ok) throw new Error(`Supabase favorites: HTTP ${r.status}`);
      return;
    }
    const key = Number(userId);
    memory.favorites.set(key, (memory.favorites.get(key) || []).filter(x => Number(x.team_id) !== id));
  }

  return {
    getFavorites,
    addFavorite,
    removeFavorite,
  };
}
