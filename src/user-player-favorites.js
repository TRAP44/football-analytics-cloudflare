import { PERSONAL_WRITE_LIMITS, normalizeFavoritePlayerWrite } from './personal-write-guards.js';

export function createFavoritePlayersService({
  memory,
  hasSupabase,
  supaSelectMany,
  supaRpc,
  fetchWithTimeout,
  supaHeaders,
}) {
  async function getFavoritePlayers(userId, cfg) {
    if (hasSupabase(cfg)) {
      return await supaSelectMany(
        cfg,
        'favorite_players',
        { telegram_id: `eq.${Number(userId)}` },
        { limit: PERSONAL_WRITE_LIMITS.favoritePlayers, order: 'created_at.desc' },
      );
    }
    return memory.favoritePlayers.get(Number(userId)) || [];
  }

  async function addFavoritePlayer(userId, player, cfg) {
    const normalized = normalizeFavoritePlayerWrite({
      playerId: player?.id,
      playerName: player?.name,
      teamId: player?.teamId,
    });
    const row = {
      telegram_id: Number(userId),
      player_id: normalized.playerId,
      player_name: normalized.playerName,
      team_id: normalized.teamId,
      created_at: new Date().toISOString(),
    };

    if (hasSupabase(cfg)) {
      const result = await supaRpc(cfg, 'save_favorite_player_guarded', {
        p_telegram_id: row.telegram_id,
        p_player_id: row.player_id,
        p_player_name: row.player_name,
        p_team_id: row.team_id,
        p_limit: PERSONAL_WRITE_LIMITS.favoritePlayers,
      }, 4000);
      if (!result?.allowed) {
        const reason = String(result?.reason || 'rejected');
        const error = new Error(reason === 'limit_reached'
          ? `Можно отслеживать не больше ${PERSONAL_WRITE_LIMITS.favoritePlayers} игроков.`
          : 'Некорректные данные игрока.');
        error.code = reason === 'limit_reached' ? 'FAVORITE_PLAYERS_LIMIT' : 'PERSONAL_DATA_INVALID';
        throw error;
      }
      return result.item || row;
    }

    const key = Number(userId);
    const list = memory.favoritePlayers.get(key) || [];
    const existing = list.some(item => Number(item.player_id) === row.player_id);
    if (!existing && list.length >= PERSONAL_WRITE_LIMITS.favoritePlayers) {
      const error = new Error(`Можно отслеживать не больше ${PERSONAL_WRITE_LIMITS.favoritePlayers} игроков.`);
      error.code = 'FAVORITE_PLAYERS_LIMIT';
      throw error;
    }
    memory.favoritePlayers.set(
      key,
      [row, ...list.filter(item => Number(item.player_id) !== row.player_id)].slice(0, PERSONAL_WRITE_LIMITS.favoritePlayers),
    );
    return row;
  }

  async function removeFavoritePlayer(userId, playerId, cfg) {
    const id = Number(playerId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      const error = new Error('Некорректный игрок.');
      error.code = 'PERSONAL_DATA_INVALID';
      throw error;
    }
    if (hasSupabase(cfg)) {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/favorite_players`);
      url.searchParams.set('telegram_id', `eq.${Number(userId)}`);
      url.searchParams.set('player_id', `eq.${id}`);
      const response = await fetchWithTimeout(url, {
        method: 'DELETE',
        headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
      }, 7000, 'Supabase favorite players');
      if (!response.ok) throw new Error(`Supabase favorite players: HTTP ${response.status}`);
      return;
    }
    const key = Number(userId);
    memory.favoritePlayers.set(
      key,
      (memory.favoritePlayers.get(key) || []).filter(item => Number(item.player_id) !== id),
    );
  }

  return {
    getFavoritePlayers,
    addFavoritePlayer,
    removeFavoritePlayer,
  };
}
