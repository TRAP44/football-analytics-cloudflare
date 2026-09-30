export function createGlobalSearchRenderer({
  state,
  elementById,
  querySelectorAll,
  escapeHtml,
  localDiscoveryResults,
  mergeById,
  russianCountLabel,
  searchTeamSummaryCard,
  knownTeamSummaryCard,
  searchCompetitionSummaryCard,
  searchMatchCard,
  setDiscoveryHomeVisibility,
  onRenderDiscoveryHome,
  onRetry,
  onBindDiscoveryActions,
  onBindSearchMatchActions,
  onSetMode,
}) {
  if (!state || typeof elementById !== 'function') {
    throw new TypeError('Global search renderer requires state and elementById.');
  }

  const $ = elementById;
  const selectAll = typeof querySelectorAll === 'function' ? querySelectorAll : () => [];
  const renderDiscoveryHome = typeof onRenderDiscoveryHome === 'function' ? onRenderDiscoveryHome : () => {};
  const retry = typeof onRetry === 'function' ? onRetry : () => {};
  const bindDiscoveryActions = typeof onBindDiscoveryActions === 'function' ? onBindDiscoveryActions : () => {};
  const bindSearchMatchActions = typeof onBindSearchMatchActions === 'function' ? onBindSearchMatchActions : () => {};
  const setMode = typeof onSetMode === 'function' ? onSetMode : () => {};

  function renderGlobalSearch() {
    const query = String(state.globalSearch.query || '').trim();
    const wrap = $('searchResultsWrap');
    const out = $('searchResults');
    const meta = $('searchResultsMeta');
    const status = $('searchStatus');

    setDiscoveryHomeVisibility(!query);

    const searchButton = $('globalSearchBtn');
    if (searchButton) {
      searchButton.disabled = Boolean(state.globalSearch.loading);
      searchButton.textContent = state.globalSearch.loading ? 'Ищу…' : 'Найти';
    }

    if (!wrap || !out) return;

    selectAll('[data-search-mode]').forEach(btn => {
      const active = btn.dataset.searchMode === state.globalSearch.mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    if (!query) {
      wrap.hidden = true;
      if (status) status.innerHTML = '';
      renderDiscoveryHome();
      return;
    }

    const local = localDiscoveryResults(query);
    const teams = mergeById(local.teams, state.globalSearch.remoteTeams, 'id');
    const knownTeams = state.globalSearch.knownTeams || [];
    const comps = mergeById(local.competitions, state.globalSearch.remoteCompetitions, 'leagueId');
    const matches = mergeById(state.globalSearch.remoteMatches, local.matches, 'fixtureId');
    const upcoming = matches
      .filter(x => !x.finished)
      .sort((a, b) => Number(a?.selection?.rank || 999) - Number(b?.selection?.rank || 999) || Date.parse(a.date || 0) - Date.parse(b.date || 0));
    const finished = matches
      .filter(x => x.finished)
      .sort((a, b) => Number(a?.selection?.rank || 999) - Number(b?.selection?.rank || 999) || Date.parse(b.date || 0) - Date.parse(a.date || 0));
    const mode = state.globalSearch.mode || 'all';

    wrap.hidden = false;

    if (meta) {
      meta.textContent = `${russianCountLabel(teams.length || knownTeams.length, 'команда', 'команды', 'команд')} · ${russianCountLabel(comps.length, 'лига', 'лиги', 'лиг')} · ${russianCountLabel(matches.length, 'матч', 'матча', 'матчей')}`;
    }

    if (status) {
      const localCount = local.teams.length + local.competitions.length + local.matches.length;
      const stateName = String(state.globalSearch.status || (state.globalSearch.loading ? 'searching' : 'idle'));
      const resolved = state.globalSearch.resolvedQuery
        ? `<small class="search-state-note">Понял запрос: <strong>${escapeHtml(state.globalSearch.resolvedQuery)}</strong></small>`
        : '';

      if (state.globalSearch.loading) {
        status.innerHTML = localCount
          ? '<div class="search-state is-refreshing"><span>↻</span><div><strong>Обновляем результаты</strong><small>Найденное уже можно открывать.</small></div></div>'
          : '<div class="search-state is-searching"><span>🔎</span><div><strong>Ищем</strong><small>Проверяем доступные матчи и команды.</small></div></div>';
      } else if (stateName === 'timeout') {
        status.innerHTML = '<div class="search-state is-warning"><span>⏱</span><div><strong>Источник отвечает слишком долго</strong><small>Показали всё, что уже было доступно. Приложением можно пользоваться дальше.</small></div><button id="searchRetryBtn" class="secondary-btn" type="button">Повторить</button></div>';
      } else if (stateName === 'error') {
        status.innerHTML = `<div class="search-state is-warning"><span>↻</span><div><strong>Не удалось обновить поиск</strong><small>${escapeHtml(state.globalSearch.warning || 'Показаны доступные локальные результаты.')}</small></div><button id="searchRetryBtn" class="secondary-btn" type="button">Повторить</button></div>`;
      } else if (matches.length) {
        status.innerHTML = `<div class="search-state is-success"><span>✓</span><div><strong>Матч найден</strong><small>${matches.length > 1 ? `Найдено матчей: ${matches.length}` : 'Можно открыть карточку или запустить анализ.'}</small>${resolved}</div></div>`;
      } else if (teams.length || knownTeams.length || comps.length) {
        status.innerHTML = `<div class="search-state is-success"><span>✓</span><div><strong>Команда или турнир найден</strong><small>Откройте результат — доступные матчи появятся внутри.</small>${resolved}</div></div>`;
      } else if (query.length >= 2 && ['empty', 'done'].includes(stateName)) {
        status.innerHTML = '<div class="search-state"><span>—</span><div><strong>Матчей сейчас нет</strong><small>Попробуйте другое название или повторите поиск позже.</small></div></div>';
      } else {
        status.innerHTML = '';
      }

      $('searchRetryBtn')?.addEventListener('click', retry);
    }

    const sections = [];

    if ((mode === 'all' || mode === 'teams') && teams.length) {
      sections.push(`<section class="panel search-result-block compact-entity-results"><div class="mini-section-head"><strong>Команда</strong><span>${teams.length}</span></div><div class="search-entity-list">${teams.slice(0, 5).map(searchTeamSummaryCard).join('')}</div></section>`);
    }

    if ((mode === 'all' || mode === 'teams') && !teams.length && knownTeams.length) {
      sections.push(`<section class="panel search-result-block compact-entity-results"><div class="mini-section-head"><strong>Распознано</strong><span>${knownTeams.length}</span></div><div class="search-entity-list">${knownTeams.slice(0, 5).map(knownTeamSummaryCard).join('')}</div></section>`);
    }

    if ((mode === 'all' || mode === 'competitions') && comps.length) {
      sections.push(`<section class="panel search-result-block compact-entity-results"><div class="mini-section-head"><strong>Турнир</strong><span>${comps.length}</span></div><div class="search-entity-list">${comps.slice(0, 3).map(searchCompetitionSummaryCard).join('')}</div></section>`);
    }

    if ((mode === 'all' || mode === 'upcoming') && upcoming.length) {
      sections.push(`<section class="panel search-result-block"><div class="mini-section-head"><strong>Предстоящие матчи</strong><span>${upcoming.length}</span></div><div class="search-match-list">${upcoming.slice(0, 12).map(searchMatchCard).join('')}</div></section>`);
    }

    if ((mode === 'all' || mode === 'finished') && finished.length) {
      sections.push(`<section class="panel search-result-block"><div class="mini-section-head"><strong>Завершённые матчи</strong><span>${finished.length}</span></div><div class="search-match-list">${finished.slice(0, 12).map(searchMatchCard).join('')}</div></section>`);
    }

    out.innerHTML = sections.join('') || (state.globalSearch.loading ? '' : `<div class="empty search-empty-state">
      <strong>Ничего не найдено в этом разделе</strong>
      <p>Попробуйте другое название команды или лиги либо переключите фильтр поиска.</p>
      <div class="empty-actions"><button id="searchEmptyAll" class="secondary-btn" type="button">Показать всё</button></div>
    </div>`);

    bindDiscoveryActions(out);
    bindSearchMatchActions(out);
    $('searchEmptyAll')?.addEventListener('click', () => setMode('all'));
  }

  return Object.freeze({ renderGlobalSearch });
}
