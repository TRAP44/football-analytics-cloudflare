import {
  positiveEntityId,
  uiErrorMessage,
} from './entity-state-safety.js';

function plainObject(value) {
  try {
    return value && typeof value==='object' && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function safeRead(value,key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function safeText(value,max=120,fallback='') {
  if (typeof value!=='string') return fallback;
  const text=value
    .replace(/[\u0000-\u001f\u007f]+/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,max);
  return text || fallback;
}

function favoriteRows(state) {
  const raw=safeRead(state,'favorites');
  if (!Array.isArray(raw)) return [];

  const rows=[];
  const seen=new Set();
  for (const value of raw.slice(0,100)) {
    const item=plainObject(value);
    if (!item) continue;
    const teamId=positiveEntityId(safeRead(item,'teamId'));
    if (!teamId || seen.has(teamId)) continue;
    seen.add(teamId);
    rows.push({
      teamId,
      teamName:safeText(safeRead(item,'teamName'),120,'Команда'),
      teamLogo:typeof safeRead(item,'teamLogo')==='string'
        ? safeRead(item,'teamLogo')
        : '',
    });
  }
  return rows;
}

function mutationSet(state) {
  const value=safeRead(state,'favoriteMutations');
  return value instanceof Set ? value : new Set();
}

function safeUrlValue(safeUrl,value) {
  try {
    const result=safeUrl(value);
    return typeof result==='string' ? result : '';
  } catch {
    return '';
  }
}

function safeEscape(escapeHtml,value) {
  try {
    return escapeHtml(value);
  } catch {
    return '';
  }
}

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
  if (
    !plainObject(state)
    || typeof elementById!=='function'
    || typeof escapeHtml!=='function'
    || typeof safeUrl!=='function'
    || typeof recoveryCardHtml!=='function'
    || typeof onRetryLoad!=='function'
    || typeof onShowMatches!=='function'
    || typeof onRemoveFavorite!=='function'
    || typeof onOpenTeam!=='function'
  ) {
    throw new TypeError(
      'Favorite Teams renderer requires state, DOM helpers, formatters and explicit callbacks.',
    );
  }

  const $=elementById;

  function bindClick(id,handler) {
    const element=$(id);
    if (!element || typeof element.addEventListener!=='function') return;
    element.addEventListener('click',handler);
  }

  function renderFavoriteTeams() {
    const el=$('favoriteTeams');
    if (!el) return;

    const loaded=safeRead(state,'favoritesLoaded')===true;
    const loading=safeRead(state,'favoritesLoading')===true;
    const loadError=uiErrorMessage(
      {message:safeRead(state,'favoritesLoadError')},
      '',
    );
    const rows=favoriteRows(state);
    const pending=mutationSet(state);

    if (loading && !loaded) {
      el.innerHTML='<div class="loader compact-loader">Загружаю избранное…</div>';
      return;
    }

    if (loadError && !loaded) {
      el.innerHTML=recoveryCardHtml({
        title:'Избранное временно недоступно',
        message:loadError,
        retryId:'favoritesRetry',
        compact:true,
      });
      bindClick('favoritesRetry',onRetryLoad);
      return;
    }

    if (!rows.length) {
      const warning=loadError
        ? `<div class="data-notice stale">⚠️ ${safeEscape(escapeHtml,loadError)} Последний загруженный список избранного был пуст.</div>`
        : '';
      const retry=loadError
        ? '<button id="favoritesEmptyRetry" class="secondary-btn" type="button">Обновить</button>'
        : '';
      el.innerHTML=`${warning}<div class="empty compact-empty profile-empty-state">
        <strong>Избранных команд пока нет</strong>
        <p>Добавьте команду звёздочкой в списке матчей.</p>
        <div class="empty-actions">${retry}<button id="favoritesEmptyMatches" class="secondary-btn" type="button">Перейти к матчам</button></div>
      </div>`;
      bindClick('favoritesEmptyRetry',onRetryLoad);
      bindClick('favoritesEmptyMatches',onShowMatches);
      return;
    }

    const staleNotice=loadError
      ? `<div class="data-notice stale">⚠️ ${safeEscape(escapeHtml,loadError)} Показано последнее загруженное избранное.</div>`
      : '';

    const teamById=new Map();
    el.innerHTML=staleNotice+rows.map(item=>{
      const logo=safeUrlValue(safeUrl,item.teamLogo);
      const escapedLogo=safeEscape(escapeHtml,logo);
      const escapedName=safeEscape(escapeHtml,item.teamName);
      const isPending=pending.has(item.teamId);
      teamById.set(item.teamId,{
        id:item.teamId,
        name:item.teamName,
        logo,
      });
      return `
      <div class="favorite-team-row">
        <button class="favorite-team-main team-open-link" type="button" data-open-team="${item.teamId}" data-team-name="${escapedName}" data-team-logo="${escapedLogo}">
          ${logo ? `<img src="${escapedLogo}" alt="">` : '<span class="team-placeholder">⚽</span>'}
          <strong>${escapedName}</strong>
        </button>
        <button class="favorite-remove" type="button" data-team-id="${item.teamId}" data-team-name="${escapedName}" ${isPending ? 'disabled' : ''}>Удалить</button>
      </div>
    `;
    }).join('');

    const removeButtons=typeof el.querySelectorAll==='function'
      ? el.querySelectorAll('.favorite-remove')
      : [];
    for (const button of removeButtons) {
      if (!button || typeof button.addEventListener!=='function') continue;
      button.addEventListener('click',()=>{
        const dataset=plainObject(safeRead(button,'dataset')) || {};
        const teamId=positiveEntityId(safeRead(dataset,'teamId'));
        if (!teamId || mutationSet(state).has(teamId)) return;
        const item=teamById.get(teamId);
        if (item) onRemoveFavorite(item);
      });
    }

    const openButtons=typeof el.querySelectorAll==='function'
      ? el.querySelectorAll('[data-open-team]')
      : [];
    for (const button of openButtons) {
      if (!button || typeof button.addEventListener!=='function') continue;
      button.addEventListener('click',()=>{
        const dataset=plainObject(safeRead(button,'dataset')) || {};
        const teamId=positiveEntityId(safeRead(dataset,'openTeam'));
        if (!teamId) return;
        const item=teamById.get(teamId);
        if (item) onOpenTeam(item);
      });
    }
  }

  return Object.freeze({renderFavoriteTeams});
}
