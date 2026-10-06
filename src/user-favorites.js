import { PERSONAL_WRITE_LIMITS, normalizeFavoriteWrite } from './personal-write-guards.js';

export function createUserFavoritesService({
  memory,
  hasSupabase,
  supaSelectMany,
  supaRpc,
  fetchWithTimeout,
  supaHeaders,
}) {
  const runtimeMemory=memory && typeof memory === 'object' && !Array.isArray(memory) ? memory : {};
  if (!(runtimeMemory.favorites instanceof Map)) runtimeMemory.favorites=new Map();

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

  function favoriteTeamId(row) {
    const source=plainObject(row);
    const id=integerCandidate(source?.team_id);
    return id !== null && id>0 ? id : 0;
  }

  function favoriteList(value) {
    return Array.isArray(value) ? value.filter(item=>plainObject(item)) : [];
  }

  function supabaseEnabled(cfg) {
    return typeof hasSupabase === 'function' && hasSupabase(cfg) === true;
  }

  function favoritesUrl(cfg) {
    const raw=textValue(plainObject(cfg)?.supabaseUrl);
    if (!raw) throw new TypeError('Supabase favorites: invalid configuration.');
    let base;
    try {
      base=new URL(raw);
    } catch {
      throw new TypeError('Supabase favorites: invalid configuration.');
    }
    if (!['http:','https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new TypeError('Supabase favorites: invalid configuration.');
    }
    base.pathname=`${base.pathname.replace(/\/+$/g,'')}/`;
    return new URL('rest/v1/favorites',base);
  }

  async function getFavorites(userId, cfg) {
    const key=positiveId(userId,'Telegram user ID');
    if (supabaseEnabled(cfg)) {
      if (typeof supaSelectMany !== 'function') throw new TypeError('Supabase favorites read transport is unavailable.');
      const rows=await supaSelectMany(
        cfg,
        'favorites',
        {telegram_id:`eq.${key}`},
        {limit:PERSONAL_WRITE_LIMITS.favorites,order:'created_at.desc'},
      );
      if (!Array.isArray(rows)) throw new Error('Supabase favorites: invalid response payload.');
      return rows;
    }
    return favoriteList(runtimeMemory.favorites.get(key));
  }

  async function addFavorite(userId, team, cfg) {
    const telegramId=positiveId(userId,'Telegram user ID');
    const normalized=normalizeFavoriteWrite({
      teamId:team?.id,
      teamName:team?.name,
      teamLogo:team?.logo,
    });
    const row={
      telegram_id:telegramId,
      team_id:normalized.teamId,
      team_name:normalized.teamName,
      team_logo:normalized.teamLogo,
      created_at:new Date().toISOString(),
    };

    if (supabaseEnabled(cfg)) {
      if (typeof supaRpc !== 'function') throw new TypeError('Supabase favorites RPC transport is unavailable.');
      const rawResult=await supaRpc(cfg,'save_favorite_guarded',{
        p_telegram_id:row.telegram_id,
        p_team_id:row.team_id,
        p_team_name:row.team_name,
        p_team_logo:row.team_logo,
        p_limit:PERSONAL_WRITE_LIMITS.favorites,
      },4000);
      const result=plainObject(rawResult);
      if (result?.allowed !== true) {
        const reason=textValue(result?.reason) || 'rejected';
        const error=new Error(reason === 'limit_reached'
          ? `Можно сохранить не больше ${PERSONAL_WRITE_LIMITS.favorites} команд.`
          : 'Некорректные данные избранной команды.');
        error.code=reason === 'limit_reached' ? 'FAVORITES_LIMIT' : 'PERSONAL_DATA_INVALID';
        throw error;
      }

      const item=plainObject(result.item);
      const itemUserId=integerCandidate(item?.telegram_id);
      const itemTeamId=integerCandidate(item?.team_id);
      if (item && itemUserId===row.telegram_id && itemTeamId===row.team_id) return item;
      return row;
    }

    const list=favoriteList(runtimeMemory.favorites.get(telegramId));
    const existing=list.some(item=>favoriteTeamId(item)===row.team_id);
    if (!existing && list.length>=PERSONAL_WRITE_LIMITS.favorites) {
      const error=new Error(`Можно сохранить не больше ${PERSONAL_WRITE_LIMITS.favorites} команд.`);
      error.code='FAVORITES_LIMIT';
      throw error;
    }
    const next=[
      row,
      ...list.filter(item=>favoriteTeamId(item)!==row.team_id),
    ].slice(0,PERSONAL_WRITE_LIMITS.favorites);
    runtimeMemory.favorites.set(telegramId,next);
    return row;
  }

  async function removeFavorite(userId, teamId, cfg) {
    const telegramId=positiveId(userId,'Telegram user ID');
    const id=positiveId(teamId,'ID команды');
    if (supabaseEnabled(cfg)) {
      if (typeof fetchWithTimeout !== 'function' || typeof supaHeaders !== 'function') {
        throw new TypeError('Supabase favorites delete transport is unavailable.');
      }
      const url=favoritesUrl(cfg);
      url.searchParams.set('telegram_id',`eq.${telegramId}`);
      url.searchParams.set('team_id',`eq.${id}`);
      const response=await fetchWithTimeout(url,{
        method:'DELETE',
        headers:supaHeaders(cfg,{Prefer:'return=minimal'}),
      },7000,'Supabase favorites');
      if (!response?.ok) {
        const status=integerCandidate(response?.status) ?? 0;
        throw new Error(`Supabase favorites: HTTP ${status}`);
      }
      return;
    }

    const list=favoriteList(runtimeMemory.favorites.get(telegramId));
    runtimeMemory.favorites.set(
      telegramId,
      list.filter(item=>favoriteTeamId(item)!==id),
    );
  }

  return {
    getFavorites,
    addFavorite,
    removeFavorite,
  };
}
