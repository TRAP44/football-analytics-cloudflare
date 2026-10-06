import { PERSONAL_WRITE_LIMITS, normalizeFavoritePlayerWrite } from './personal-write-guards.js';

export function createFavoritePlayersService({
  memory,
  hasSupabase,
  supaSelectMany,
  supaRpc,
  fetchWithTimeout,
  supaHeaders,
}) {
  const runtimeMemory=memory && typeof memory === 'object' && !Array.isArray(memory) ? memory : {};
  if (!(runtimeMemory.favoritePlayers instanceof Map)) runtimeMemory.favoritePlayers=new Map();

  function personalDataError(message) {
    const error=new Error(message);
    error.code='PERSONAL_DATA_INVALID';
    return error;
  }

  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function textValue(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function integerCandidate(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== 'string') return null;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  }

  function positiveId(value, label) {
    const number=integerCandidate(value);
    if (number === null || number<=0) throw personalDataError(`Некорректный ${label}.`);
    return number;
  }

  function favoritePlayerId(row) {
    const source=plainObject(row);
    const id=integerCandidate(source?.player_id);
    return id !== null && id>0 ? id : 0;
  }

  function favoritePlayerList(value) {
    return Array.isArray(value) ? value.filter(item=>plainObject(item)) : [];
  }

  function supabaseEnabled(cfg) {
    try {
      return typeof hasSupabase === 'function' && hasSupabase(cfg) === true;
    } catch {
      return false;
    }
  }

  function favoritePlayersUrl(cfg) {
    const raw=textValue(plainObject(cfg)?.supabaseUrl);
    if (!raw) throw new TypeError('Supabase favorite players: invalid configuration.');

    let base;
    try {
      base=new URL(raw);
    } catch {
      throw new TypeError('Supabase favorite players: invalid configuration.');
    }
    if (!['http:','https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new TypeError('Supabase favorite players: invalid configuration.');
    }
    base.pathname=`${base.pathname.replace(/\/+$/g,'')}/`;
    return new URL('rest/v1/favorite_players',base);
  }

  async function getFavoritePlayers(userId, cfg) {
    const telegramId=positiveId(userId,'Telegram user ID');
    if (supabaseEnabled(cfg)) {
      if (typeof supaSelectMany !== 'function') {
        throw new TypeError('Supabase favorite players read transport is unavailable.');
      }
      const rows=await supaSelectMany(
        cfg,
        'favorite_players',
        {telegram_id:`eq.${telegramId}`},
        {limit:PERSONAL_WRITE_LIMITS.favoritePlayers,order:'created_at.desc'},
      );
      if (!Array.isArray(rows)) throw new Error('Supabase favorite players: invalid response payload.');
      return rows;
    }
    return favoritePlayerList(runtimeMemory.favoritePlayers.get(telegramId));
  }

  async function addFavoritePlayer(userId, player, cfg) {
    const telegramId=positiveId(userId,'Telegram user ID');
    const normalized=normalizeFavoritePlayerWrite({
      playerId:player?.id,
      playerName:player?.name,
      teamId:player?.teamId,
    });
    const row={
      telegram_id:telegramId,
      player_id:normalized.playerId,
      player_name:normalized.playerName,
      team_id:normalized.teamId,
      created_at:new Date().toISOString(),
    };

    if (supabaseEnabled(cfg)) {
      if (typeof supaRpc !== 'function') {
        throw new TypeError('Supabase favorite players RPC transport is unavailable.');
      }
      const rawResult=await supaRpc(cfg,'save_favorite_player_guarded',{
        p_telegram_id:row.telegram_id,
        p_player_id:row.player_id,
        p_player_name:row.player_name,
        p_team_id:row.team_id,
        p_limit:PERSONAL_WRITE_LIMITS.favoritePlayers,
      },4000);
      const result=plainObject(rawResult);
      if (result?.allowed !== true) {
        const reason=textValue(result?.reason) || 'rejected';
        const error=new Error(reason === 'limit_reached'
          ? `Можно отслеживать не больше ${PERSONAL_WRITE_LIMITS.favoritePlayers} игроков.`
          : 'Некорректные данные игрока.');
        error.code=reason === 'limit_reached' ? 'FAVORITE_PLAYERS_LIMIT' : 'PERSONAL_DATA_INVALID';
        throw error;
      }

      const item=plainObject(result.item);
      const itemUserId=integerCandidate(item?.telegram_id);
      const itemPlayerId=integerCandidate(item?.player_id);
      const itemTeamId=integerCandidate(item?.team_id);
      if (
        item
        && itemUserId===row.telegram_id
        && itemPlayerId===row.player_id
        && itemTeamId===row.team_id
      ) return item;
      return row;
    }

    const list=favoritePlayerList(runtimeMemory.favoritePlayers.get(telegramId));
    const existing=list.some(item=>favoritePlayerId(item)===row.player_id);
    if (!existing && list.length>=PERSONAL_WRITE_LIMITS.favoritePlayers) {
      const error=new Error(`Можно отслеживать не больше ${PERSONAL_WRITE_LIMITS.favoritePlayers} игроков.`);
      error.code='FAVORITE_PLAYERS_LIMIT';
      throw error;
    }
    runtimeMemory.favoritePlayers.set(
      telegramId,
      [
        row,
        ...list.filter(item=>favoritePlayerId(item)!==row.player_id),
      ].slice(0,PERSONAL_WRITE_LIMITS.favoritePlayers),
    );
    return row;
  }

  async function removeFavoritePlayer(userId, playerId, cfg) {
    const telegramId=positiveId(userId,'Telegram user ID');
    const id=positiveId(playerId,'игрок');
    if (supabaseEnabled(cfg)) {
      if (typeof fetchWithTimeout !== 'function' || typeof supaHeaders !== 'function') {
        throw new TypeError('Supabase favorite players delete transport is unavailable.');
      }
      const url=favoritePlayersUrl(cfg);
      url.searchParams.set('telegram_id',`eq.${telegramId}`);
      url.searchParams.set('player_id',`eq.${id}`);
      const response=await fetchWithTimeout(url,{
        method:'DELETE',
        headers:supaHeaders(cfg,{Prefer:'return=minimal'}),
      },7000,'Supabase favorite players');
      if (!response?.ok) {
        const status=integerCandidate(response?.status) ?? 0;
        throw new Error(`Supabase favorite players: HTTP ${status}`);
      }
      return;
    }

    const list=favoritePlayerList(runtimeMemory.favoritePlayers.get(telegramId));
    runtimeMemory.favoritePlayers.set(
      telegramId,
      list.filter(item=>favoritePlayerId(item)!==id),
    );
  }

  return {
    getFavoritePlayers,
    addFavoritePlayer,
    removeFavoritePlayer,
  };
}
