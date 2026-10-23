import {positiveEntityId} from './entity-state-safety.js';

export function playerLaunchIntent(scope=globalThis){
  try{
    const hash=new URLSearchParams(String(scope?.location?.hash || '').slice(1));
    const start=scope?.Telegram?.WebApp?.initDataUnsafe?.start_param || hash.get('tgWebAppStartParam') || '';
    const match=/^player_(\d{1,16})_(\d{1,16})$/.exec(start);
    const params=new URLSearchParams(scope?.location?.search || '');
    const teamId=positiveEntityId(match ? match[1] : params.get('view')==='player' ? params.get('teamId') : 0);
    const playerId=positiveEntityId(match ? match[2] : params.get('view')==='player' ? params.get('playerId') : 0);
    return teamId && playerId ? {teamId,playerId} : null;
  }catch{return null;}
}

export function playerTelegramUrl(){return 'https://t.me/MatchRadarAIBot';}

export function rememberPlayerReturn(player,userId,scope=globalThis){
  const owner=positiveEntityId(userId),teamId=positiveEntityId(player?.team?.id),playerId=positiveEntityId(player?.data?.id);
  if(!owner || !teamId || !playerId)return false;
  try{scope.localStorage.setItem(`matchradar:player-return:v1:${owner}`,JSON.stringify({owner,teamId,playerId,expiresAt:Date.now()+600000}));return true;}catch{return false;}
}

export function takePlayerReturn(userId,scope=globalThis){
  const owner=positiveEntityId(userId);if(!owner)return null;
  const key=`matchradar:player-return:v1:${owner}`;
  try{
    const raw=scope.localStorage.getItem(key);if(!raw)return null;
    scope.localStorage.removeItem(key);
    const item=JSON.parse(raw),now=Date.now();
    if(item?.owner!==owner || !Number.isFinite(item?.expiresAt) || item.expiresAt<=now || item.expiresAt>now+600000)return null;
    const teamId=positiveEntityId(item.teamId),playerId=positiveEntityId(item.playerId);
    return teamId && playerId ? {teamId,playerId} : null;
  }catch{return null;}
}

export function squadPlayer(squad,playerId,teamId){
  if(positiveEntityId(squad?.team?.id)!==positiveEntityId(teamId) || !positiveEntityId(teamId))return null;
  const groups=Array.isArray(squad?.groups) ? squad.groups : [];
  const players=Array.isArray(squad?.players) ? squad.players : groups.flatMap(group=>Array.isArray(group?.players)?group.players:[]);
  return players.find(player=>positiveEntityId(player?.id)===positiveEntityId(playerId) && positiveEntityId(playerId)) || null;
}

export function favoritePlayersHtml(state,esc){
  if(state.favoritePlayersAuthRequired)return '<p class="empty compact-empty">Обновите вход, чтобы увидеть ваших игроков.</p><button class="btn secondary" type="button" data-favorite-player-auth>Обновить вход</button>';
  if(!state.favoritePlayersLoaded){
    return state.favoritePlayersLoadError ? '<p class="empty compact-empty">Не удалось загрузить игроков.</p><button class="btn secondary" type="button" data-favorite-player-retry>Повторить</button>' : '<p class="empty compact-empty" role="status">Загружаю игроков…</p>';
  }
  const items=(Array.isArray(state.favoritePlayers)?state.favoritePlayers:[]).filter(item=>positiveEntityId(item?.playerId) && positiveEntityId(item?.teamId));
  if(!items.length)return '<p class="empty compact-empty">Откройте состав любимой команды и добавьте игрока в избранное.</p>';
  return items.map(item=>`<button class="saved-player-row" type="button" data-saved-player="${positiveEntityId(item.playerId)}" data-player-team="${positiveEntityId(item.teamId)}"><span class="saved-player-star" aria-hidden="true">★</span><strong>${esc(item.playerName || 'Игрок')}</strong><span aria-hidden="true">›</span></button>`).join('');
}
