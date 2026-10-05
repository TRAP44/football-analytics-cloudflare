export function createTournamentModule(deps = {}) {
  const {
    $,
    activeViewId,
    api,
    bindMatchActions,
    categoryLabel,
    dateOnly,
    escapeHtml,
    isAdmin,
    localDate,
    matchCardHtml,
    openTeam,
    recoveryCardHtml,
    renderProvider,
    safeUrl,
    showView,
    state,
    toast,
  } = deps;

  function currentTournamentMatches(leagueId = state.currentTournament?.leagueId) {
    return state.matches.filter(m => Number(m.leagueId) === Number(leagueId));
  }
  
  function tournamentKey(t) {
    return `${Number(t?.leagueId || 0)}:${Number(t?.season || 0)}`;
  }
  
  function openTournament(leagueId) {
    const current = activeViewId(); if (current !== 'tournamentView') state.tournamentBackView = current;
    const rows = currentTournamentMatches(leagueId);
    const source = rows[0] || state.matches.find(m => Number(m.leagueId) === Number(leagueId));
    if (!source) {
      toast('Турнир не найден в текущем списке матчей.');
      return;
    }
    state.currentTournament = {
      leagueId: Number(source.leagueId),
      season: Number(source.season || new Date().getFullYear()),
      name: source.league || source.leagueOriginal || 'Турнир',
      shortName: source.leagueShort || source.league || 'Турнир',
      country: source.country || '',
      logo: source.leagueLogo || '',
      category: source.category || '',
      tier: source.competition?.tier || 'standard',
    };
    renderTournamentHero();
    renderTournamentMatches();
    setTournamentTab('matches', false);
    showView('tournamentView');
  }
  
  function renderTournamentHero() {
    const t = state.currentTournament;
    if (!t) return;
    const rows = currentTournamentMatches(t.leagueId);
    const live = rows.filter(x => x.live).length;
    $('tournamentHero').innerHTML = `<section class="panel tournament-hero">
      <div class="tournament-identity">
        <div class="tournament-logo">${t.logo ? `<img src="${safeUrl(t.logo)}" alt="">` : '🏆'}</div>
        <div><span>${escapeHtml(t.country || '')}</span><h2>${escapeHtml(t.name)}</h2><p>Сезон ${Number(t.season)} · ${escapeHtml(categoryLabel(t.category) || 'Турнир')}</p></div>
      </div>
      <div class="tournament-summary">
        <div><span>Матчей в выбранный день</span><strong>${rows.length}</strong></div>
        <div><span>Сейчас идут</span><strong>${live}</strong></div>
        <div><span>Покрытие</span><strong>${escapeHtml(t.tier === 'elite' ? 'Высокое' : t.tier === 'major' ? 'Хорошее' : 'Стандарт')}</strong></div>
      </div>
    </section>`;
  }
  
  function renderTournamentMatches() {
    const t = state.currentTournament;
    if (!t) return;
    const rows = currentTournamentMatches(t.leagueId);
    const el = $('tournamentMatches');
    if (!rows.length) {
      el.innerHTML = '<div class="empty">В выбранный день матчей этого турнира нет.</div>';
      return;
    }
    el.innerHTML = `<div class="tournament-day-note">Матчи на ${escapeHtml(dateOnly(localDate(state.offset)))}</div><div class="tournament-match-list">${rows.map(m => matchCardHtml(m, { grouped: true })).join('')}</div>`;
    bindMatchActions(el);
  }
  
  function standingFormHtml(form = '') {
    const chars = String(form || '').toUpperCase().split('').filter(x => ['W','D','L'].includes(x)).slice(-5);
    if (!chars.length) return '<span class="standings-form-empty">—</span>';
    return `<span class="standings-form">${chars.map(x => `<i class="${x === 'W' ? 'win' : x === 'D' ? 'draw' : 'loss'}">${x === 'W' ? 'В' : x === 'D' ? 'Н' : 'П'}</i>`).join('')}</span>`;
  }
  
  function renderTournamentStandings(data) {
    const el = $('tournamentTable');
    const t = state.currentTournament;
    if (!el || !t) return;
    if (!data?.available || !data?.groups?.length) {
      el.innerHTML = `<div class="empty compact-empty">${escapeHtml(data?.reason || 'Таблица турнира сейчас недоступна.')}${data?.warning ? `<br><span class="tiny">${escapeHtml(data.warning)}</span>` : ''}</div>`;
      return;
    }
    const currentIds = new Set(currentTournamentMatches(t.leagueId).flatMap(m => [Number(m.home?.id), Number(m.away?.id)]));
    el.innerHTML = `${data.stale ? `<div class="data-notice stale">⚠️ ${escapeHtml(data.warning || 'Показана сохранённая таблица.')}</div>` : ''}${data.groups.map((group, gi) => `
      <section class="panel standings-panel">
        ${group.name ? `<h2>${escapeHtml(group.name)}</h2>` : `<h2>Турнирная таблица</h2>`}
        <div class="standings-scroll"><table class="standings-table">
          <thead><tr><th>#</th><th>Команда</th><th>И</th><th class="wide-stat">В</th><th class="wide-stat">Н</th><th class="wide-stat">П</th><th>М</th><th>+/-</th><th>О</th><th>Форма</th></tr></thead>
          <tbody>${group.rows.map(row => `<tr class="${currentIds.has(Number(row.team?.id)) ? 'today-team' : ''}">
            <td><b>${Number(row.rank)}</b></td>
            <td>${Number(row.team?.id || 0) > 0
              ? `<button class="standing-team team-open-link" type="button" data-open-team="${Number(row.team.id)}" data-team-name="${escapeHtml(row.team?.name || '')}" data-team-logo="${escapeHtml(row.team?.logo || '')}">${row.team?.logo ? `<img src="${safeUrl(row.team.logo)}" alt="">` : ''}<strong>${escapeHtml(row.team?.name || '')}</strong></button>`
              : `<span class="standing-team standing-team-readonly"><strong>${escapeHtml(row.team?.name || '')}</strong></span>`}</td>
            <td>${Number(row.played)}</td><td class="wide-stat">${Number(row.win)}</td><td class="wide-stat">${Number(row.draw)}</td><td class="wide-stat">${Number(row.lose)}</td>
            <td>${Number(row.goalsFor)}:${Number(row.goalsAgainst)}</td><td class="${Number(row.goalsDiff) > 0 ? 'positive' : Number(row.goalsDiff) < 0 ? 'negative' : ''}">${Number(row.goalsDiff) > 0 ? '+' : ''}${Number(row.goalsDiff)}</td><td><b>${Number(row.points)}</b></td><td>${standingFormHtml(row.form)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <p class="tiny table-note">Источник: ${escapeHtml(data.sourceMeta?.label || 'API-Football')}${data.sourceMeta?.fallback ? ' · резервный источник' : ''}. ${data.sourceMeta?.attribution ? escapeHtml(data.sourceMeta.attribution) + '. ' : ''}Свежие данные сохраняются в общем кэше; резервные таблицы перепроверяются чаще основного источника.</p>
      </section>`).join('')}`;
    el.querySelectorAll('[data-open-team]').forEach(btn => btn.addEventListener('click', () => openTeam({ id: Number(btn.dataset.openTeam), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '' })));
  }
  
  async function loadTournamentStandings(force = false) {
    const t = state.currentTournament;
    if (!t) return;
    const key = tournamentKey(t);
    const seq = ++state.tournamentStandingsRequestSeq;
    const el = $('tournamentTable');
    if (!force && state.tournamentStandings.has(key)) {
      if (key === tournamentKey(state.currentTournament)) renderTournamentStandings(state.tournamentStandings.get(key));
      return;
    }
    el.innerHTML = '<div class="loader">Загружаю таблицу турнира…</div>';
    try {
      const data = await api(`/api/tournament?leagueId=${Number(t.leagueId)}&season=${Number(t.season)}`);
      state.tournamentStandings.set(key, data);
      if (seq !== state.tournamentStandingsRequestSeq || key !== tournamentKey(state.currentTournament)) return;
      if (isAdmin() && data.provider?.visibility === 'admin') { state.provider = data.provider; renderProvider(); }
      renderTournamentStandings(data);
    } catch (e) {
      if (seq !== state.tournamentStandingsRequestSeq || key !== tournamentKey(state.currentTournament)) return;
      const cached = state.tournamentStandings.get(key);
      if (cached) {
        renderTournamentStandings(cached);
        el.insertAdjacentHTML('afterbegin', `<div class="data-notice stale">⚠️ ${escapeHtml(e.message)} Показана последняя сохранённая таблица.</div>`);
        return;
      }
      el.innerHTML = recoveryCardHtml({ title: 'Таблица временно недоступна', message: e.message, retryId: 'tournamentStandingsRetry', compact: true });
      $('tournamentStandingsRetry')?.addEventListener('click', () => loadTournamentStandings(true));
    }
  }
  
  function setTournamentTab(tab, load = true) {
    const buttons = [...document.querySelectorAll('.tournament-tab')];
    const panels = [['tournamentMatchesPanel', 'matches'], ['tournamentTablePanel', 'table']];
    buttons.forEach(btn => {
      const active = btn.dataset.tournamentTab === tab;
      const name = btn.dataset.tournamentTab || 'matches';
      btn.id = `tournament-tab-${name}`;
      btn.classList.toggle('active', active);
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', `tournament-panel-${name}`);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });
    panels.forEach(([id, key]) => {
      const panel = $(id);
      if (!panel) return;
      const active = tab === key;
      panel.id = `tournament-panel-${key}`;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
      panel.toggleAttribute('inert', !active);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `tournament-tab-${key}`);
      panel.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    if (tab === 'table' && load) loadTournamentStandings(false);
  }

  return {
    currentTournamentMatches,
    tournamentKey,
    openTournament,
    renderTournamentHero,
    renderTournamentMatches,
    standingFormHtml,
    renderTournamentStandings,
    loadTournamentStandings,
    setTournamentTab,
  };
}
