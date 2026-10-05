export function createDiscoveryModule(deps = {}) {
  const {
    $,
    RECENT_TEAMS_KEY,
    activeViewId,
    analyzeMatch,
    api,
    apiErrorCategory,
    bindGlobalSearchControls,
    createGlobalSearchController,
    createGlobalSearchRenderer,
    dateTime,
    escapeHtml,
    friendlyErrorMessage,
    isAdmin,
    localDiscoveryResults,
    mergeById,
    openMatchCenter,
    openTeam,
    openTournament,
    renderGlobalSearch,
    renderProvider,
    renderTournamentHero,
    renderTournamentMatches,
    runGlobalSearch,
    runtimeAllows,
    safeUrl,
    sendActionError,
    sendOperationTiming,
    sendProductAction,
    setGlobalSearchMode,
    setTournamentTab,
    showView,
    state,
    toast,
  } = deps;

  function storageGet(key) {
    try { return localStorage.getItem(key); }
    catch { state.storageAvailable = false; return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch { state.storageAvailable = false; return false; }
  }
  function storageRemove(key) {
    try { localStorage.removeItem(key); return true; }
    catch { state.storageAvailable = false; return false; }
  }
  
  const RECENT_TEAMS_KEY = 'football_recent_teams_v1';
  
  function getRecentTeams() {
    try {
      const rows = JSON.parse(storageGet(RECENT_TEAMS_KEY) || '[]');
      return Array.isArray(rows) ? rows.filter(x => Number(x?.id) > 0 && x?.name).slice(0, 10) : [];
    } catch { return []; }
  }
  
  function rememberTeam(team) {
    if (!team?.id || !team?.name) return;
    try {
      const row = { id: Number(team.id), name: String(team.name), logo: String(team.logo || ''), country: String(team.country || ''), viewedAt: new Date().toISOString() };
      const next = [row, ...getRecentTeams().filter(x => Number(x.id) !== row.id)].slice(0, 10);
      storageSet(RECENT_TEAMS_KEY, JSON.stringify(next));
    } catch {}
  }
  
  function clearRecentTeams() {
    storageRemove(RECENT_TEAMS_KEY)
    renderDiscoveryHome();
  }
  
  function discoveryTeamCard(team, badge = '') {
    return `<button class="discovery-team-card" type="button" data-search-team="${Number(team.id)}" data-team-name="${escapeHtml(team.name || '')}" data-team-logo="${escapeHtml(team.logo || '')}" data-team-country="${escapeHtml(team.country || '')}">
      <span class="discovery-team-logo">${team.logo ? `<img src="${safeUrl(team.logo)}" alt="">` : '⚽'}</span>
      <span class="discovery-team-copy"><strong>${escapeHtml(team.name || 'Команда')}</strong><small>${escapeHtml(team.country || badge || '')}${team.national ? ' · сборная' : ''}</small></span>
      ${badge ? `<i>${escapeHtml(badge)}</i>` : '<b>›</b>'}
    </button>`;
  }
  
  function searchTeamSummaryCard(team) {
    return `<button class="search-entity-summary search-team-summary" type="button" data-search-team="${Number(team.id)}" data-team-name="${escapeHtml(team.name || '')}" data-team-logo="${escapeHtml(team.logo || '')}" data-team-country="${escapeHtml(team.country || '')}" aria-label="Открыть ${escapeHtml(team.name || 'команду')}">
      <span class="discovery-team-logo">${team.logo ? `<img src="${safeUrl(team.logo)}" alt="">` : '⚽'}</span>
      <span><small>КОМАНДА НАЙДЕНА</small><strong>${escapeHtml(team.name || 'Команда')}</strong><em>${escapeHtml(team.country || '')}${team.national ? ' · сборная' : ''}</em></span>
      <b>Открыть →</b>
    </button>`;
  }
  
  function knownTeamSummaryCard(team) {
    return `<button class="search-entity-summary known-team-summary" type="button" data-known-team-query="${escapeHtml(team.name || '')}" aria-label="Повторить поиск ${escapeHtml(team.name || 'команды')}">
      <span class="discovery-team-logo">✓</span>
      <span><small>КЛУБ РАСПОЗНАН</small><strong>${escapeHtml(team.name || 'Команда')}</strong><em>${escapeHtml(team.country || '')} · источник пока не вернул календарь</em></span>
      <b>Повторить →</b>
    </button>`;
  }
  
  function searchCompetitionSummaryCard(comp) {
    return `<button class="search-entity-summary search-competition-summary" type="button"
      data-search-competition="${Number(comp.leagueId)}"
      data-season="${Number(comp.season || new Date().getFullYear())}"
      data-comp-name="${escapeHtml(comp.name || comp.shortName || 'Турнир')}"
      data-comp-short="${escapeHtml(comp.shortName || comp.name || 'Турнир')}"
      data-comp-country="${escapeHtml(comp.country || '')}"
      data-comp-category="${escapeHtml(comp.category || '')}"
      data-comp-tier="${escapeHtml(comp.tier || 'standard')}"
      aria-label="Открыть турнир ${escapeHtml(comp.shortName || comp.name || 'Турнир')}">
      <span class="discovery-team-logo">${comp.logo ? `<img src="${safeUrl(comp.logo)}" alt="">` : '🏆'}</span>
      <span><small>ТУРНИР НАЙДЕН</small><strong>${escapeHtml(comp.shortName || comp.name || 'Турнир')}</strong><em>${escapeHtml(comp.country || '')}</em></span>
      <b>Открыть →</b>
    </button>`;
  }
  
  function bindDiscoveryActions(root = document) {
    root.querySelectorAll?.('[data-search-team]').forEach(btn => btn.addEventListener('click', () => openTeam({
      id: Number(btn.dataset.searchTeam), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '', country: btn.dataset.teamCountry || '',
    })));
    root.querySelectorAll?.('[data-search-competition]').forEach(btn => btn.addEventListener('click', () => openTournamentMeta({
      leagueId: Number(btn.dataset.searchCompetition), season: Number(btn.dataset.season || new Date().getFullYear()), name: btn.dataset.compName || 'Турнир', shortName: btn.dataset.compShort || btn.dataset.compName || 'Турнир', country: btn.dataset.compCountry || '', category: btn.dataset.compCategory || '', tier: btn.dataset.compTier || 'standard', logo: '',
    })));
    root.querySelectorAll?.('[data-known-team-query]').forEach(btn => btn.addEventListener('click', () => {
      const query=String(btn.dataset.knownTeamQuery || '').trim();
      const input=$('globalSearchInput');
      if (!query || !input) return;
      input.value=query;
      state.globalSearch.query=query;
      void runGlobalSearch();
    }));
  }
  
  function setDiscoveryHomeVisibility(visible) {
    ['searchRecentWrap', 'searchFavoritesWrap', 'searchCompetitionsWrap'].forEach(id => {
      const el = $(id);
      if (el) el.hidden = !visible;
    });
  }
  
  function renderDiscoveryHome() {
    const recentEl = $('searchRecent');
    const favEl = $('searchFavorites');
    const compEl = $('searchCompetitions');
    setDiscoveryHomeVisibility(!String(state.globalSearch.query || '').trim());
    if (recentEl) {
      const rows = getRecentTeams();
      recentEl.innerHTML = rows.map(x => discoveryTeamCard(x, 'Недавно')).join('');
      if ($('searchRecentWrap')) $('searchRecentWrap').hidden = !rows.length || Boolean(String(state.globalSearch.query || '').trim());
    }
    if (favEl) {
      const rows = state.favorites.slice(0, 10);
      favEl.innerHTML = rows.map(x => discoveryTeamCard({ id:x.teamId, name:x.teamName, logo:x.teamLogo }, 'Избранное')).join('');
      if ($('searchFavoritesWrap')) $('searchFavoritesWrap').hidden = !rows.length || Boolean(String(state.globalSearch.query || '').trim());
    }
    if (compEl) {
      const seen = new Set();
      const comps = state.matches.filter(m => Number(m.leagueId) > 0 && !m.lowPriority).sort((a,b) => Number(b.competition?.priority||0)-Number(a.competition?.priority||0)).filter(m => { const id=Number(m.leagueId); if(seen.has(id)) return false; seen.add(id); return true; }).slice(0,8);
      compEl.innerHTML = comps.length ? comps.map(m => `<button class="competition-shortcut" type="button" data-open-tournament="${Number(m.leagueId)}">${m.leagueLogo ? `<img src="${safeUrl(m.leagueLogo)}" alt="">` : '<span class="competition-logo-placeholder">🏆</span>'}<span><strong>${escapeHtml(m.leagueShort || m.league || 'Турнир')}</strong><small>${escapeHtml(m.country || '')}</small></span>${m.live ? '<b>ИДЁТ</b>' : ''}</button>`).join('') : '<div class="empty compact-empty">Сначала загрузите список матчей.</div>';
      compEl.querySelectorAll?.('[data-open-tournament]').forEach(btn => btn.addEventListener('click', () => openTournament(Number(btn.dataset.openTournament))));
    }
    bindDiscoveryActions($('searchRecent'));
    bindDiscoveryActions($('searchFavorites'));
  }
  
  function russianCountLabel(value, one, few, many) {
    const n = Math.max(0, Math.trunc(Number(value) || 0));
    const mod10 = n % 10;
    const mod100 = n % 100;
    const word = mod10 === 1 && mod100 !== 11
      ? one
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? few
        : many;
    return `${n} ${word}`;
  }
  
  function searchMatchCard(match) {
    const finished = Boolean(match?.finished);
    const primary=Boolean(match?.selection?.primary || Number(match?.fixtureId || 0)===Number(state.globalSearch.primaryFixtureId || 0));
    const live = Boolean(match?.live);
    const score = finished || live ? `${match?.score?.home ?? '—'} : ${match?.score?.away ?? '—'}` : '';
    const status = live ? (match.statusLabel || 'Матч идёт') : finished ? 'Завершён' : dateTime(match.date);
    const action = finished || live
      ? `<button class="search-match-action" type="button" data-search-center="${Number(match.fixtureId)}">${finished ? 'Итоги' : 'Центр матча'}</button>`
      : `<button class="search-match-action" type="button" data-search-fixture="${Number(match.fixtureId)}">Разобрать матч</button>`;
    const primaryLabel=primary ? `<div class="search-match-primary"><b>⭐ ОСНОВНОЙ МАТЧ</b><span>${escapeHtml(match?.selection?.reason || state.globalSearch.matchDiscovery?.primaryReason || 'Основной выбор MatchRadar для анализа')}</span></div>` : '';
    return `<article class="search-match-card ${live ? 'is-live' : finished ? 'is-finished' : 'is-upcoming'} ${primary ? 'is-primary' : ''}">${primaryLabel}
      <div class="search-match-meta"><span>${escapeHtml(match.league || match.competition?.name || 'Матч')}</span><small>${escapeHtml(status)}</small></div>
      <div class="search-match-teams">
        <span>${match.home?.logo ? `<img src="${safeUrl(match.home.logo)}" alt="">` : '⚽'}<strong>${escapeHtml(match.home?.name || 'Хозяева')}</strong></span>
        <b>${score || '—'}</b>
        <span>${match.away?.logo ? `<img src="${safeUrl(match.away.logo)}" alt="">` : '⚽'}<strong>${escapeHtml(match.away?.name || 'Гости')}</strong></span>
      </div>
      <div class="search-match-footer">${action}</div>
    </article>`;
  }
  
  function bindSearchMatchActions(root) {
    root?.querySelectorAll?.('[data-search-fixture]').forEach(btn => btn.addEventListener('click', () => analyzeMatch(Number(btn.dataset.searchFixture), btn)));
    root?.querySelectorAll?.('[data-search-center]').forEach(btn => btn.addEventListener('click', () => openMatchCenter(Number(btn.dataset.searchCenter), btn)));
  }
  
  let renderGlobalSearch = () => {};
  
  const {
    localDiscoveryResults,
    mergeById,
    runGlobalSearch,
    setGlobalSearchMode,
    bindGlobalSearchControls,
  } = createGlobalSearchController({
    state,
    elementById: $,
    querySelectorAll: selector => document.querySelectorAll(selector),
    runtimeAllows,
    api,
    renderSearch: () => renderGlobalSearch(),
    sendProductAction,
    sendOperationTiming,
    isAdmin,
    renderProvider,
    apiErrorCategory,
    friendlyErrorMessage,
    sendActionError,
    toast,
  });
  
  ({ renderGlobalSearch } = createGlobalSearchRenderer({
    state,
    elementById: $,
    querySelectorAll: selector => document.querySelectorAll(selector),
    escapeHtml,
    localDiscoveryResults,
    mergeById,
    russianCountLabel,
    searchTeamSummaryCard,
    knownTeamSummaryCard,
    searchCompetitionSummaryCard,
    searchMatchCard,
    setDiscoveryHomeVisibility,
    onRenderDiscoveryHome: () => renderDiscoveryHome(),
    onRetry: () => runGlobalSearch({ manual:true }),
    onBindDiscoveryActions: root => bindDiscoveryActions(root),
    onBindSearchMatchActions: root => bindSearchMatchActions(root),
    onSetMode: mode => setGlobalSearchMode(mode),
  }));
  
  function openTournamentMeta(meta) {
    const current = activeViewId(); if (current !== 'tournamentView') state.tournamentBackView = current;
    const existing = state.matches.find(m => Number(m.leagueId) === Number(meta?.leagueId));
    if (existing) return openTournament(Number(meta.leagueId));
    if (!meta?.leagueId) return;
    state.currentTournament = {
      leagueId:Number(meta.leagueId), season:Number(meta.season || new Date().getFullYear()), name:meta.name || 'Турнир', shortName:meta.shortName || meta.name || 'Турнир', country:meta.country || '', logo:meta.logo || '', category:meta.category || '', tier:meta.tier || 'standard',
    };
    renderTournamentHero(); renderTournamentMatches(); setTournamentTab('matches', false); showView('tournamentView');
  }

  return {
    storageGet,
    storageSet,
    storageRemove,
    getRecentTeams,
    rememberTeam,
    clearRecentTeams,
    discoveryTeamCard,
    searchTeamSummaryCard,
    knownTeamSummaryCard,
    searchCompetitionSummaryCard,
    bindDiscoveryActions,
    setDiscoveryHomeVisibility,
    renderDiscoveryHome,
    russianCountLabel,
    searchMatchCard,
    bindSearchMatchActions,
    openTournamentMeta,
  };
}
