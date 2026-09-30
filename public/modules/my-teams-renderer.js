export function createMyTeamsRenderer({
  state,
  elementById,
  escapeHtml,
  safeUrl,
  isLiveMatch,
  isFinishedMatch,
  scoreText,
  timeOf,
  onOpenTeam,
  onAnalyzeMatch,
}) {
  if (!state || typeof elementById !== 'function' || typeof escapeHtml !== 'function' || typeof safeUrl !== 'function' ||
      typeof isLiveMatch !== 'function' || typeof isFinishedMatch !== 'function' || typeof scoreText !== 'function' ||
      typeof timeOf !== 'function' || typeof onOpenTeam !== 'function' || typeof onAnalyzeMatch !== 'function') {
    throw new TypeError('My Teams renderer requires state, formatters, match predicates and explicit callbacks.');
  }

  const $ = elementById;

  function renderMyTeams() {
    const root = $('myTeamsList');
    const onboarding = $('myTeamsOnboarding');
    if (!root) return;

    if (state.favoritesLoading && !state.favoritesLoaded) {
      root.innerHTML = '<div class="loader compact-loader">Загружаю ваши команды…</div>';
      if (onboarding) onboarding.hidden = true;
      return;
    }

    if (!state.favorites.length) {
      root.innerHTML = '';
      if (onboarding) onboarding.hidden = false;
      return;
    }

    if (onboarding) onboarding.hidden = true;
    root.innerHTML = state.favorites.map(team => {
      const id = Number(team.teamId || 0);
      const logo = safeUrl(team.teamLogo);
      const related = state.matches.filter(match => [Number(match.home?.id), Number(match.away?.id)].includes(id));
      const live = related.find(match => isLiveMatch(match));
      const upcoming = related
        .filter(match => !isFinishedMatch(match) && !isLiveMatch(match))
        .sort((a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0))[0];
      const recent = related
        .filter(match => isFinishedMatch(match))
        .sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0))[0];
      const focus = live || upcoming || recent;
      const status = live ? '🔴 Матч идёт' : upcoming ? 'Ближайший матч' : recent ? 'Последний матч' : 'Матчи пока не найдены';
      return `<article class="panel my-team-card">
        <button class="my-team-head team-open-link" type="button" data-open-team="${id}" data-team-name="${escapeHtml(team.teamName || '')}" data-team-logo="${escapeHtml(logo)}">
          ${logo ? `<img src="${logo}" alt="">` : '<span class="team-placeholder">⚽</span>'}
          <span><strong>${escapeHtml(team.teamName || 'Команда')}</strong><small>${status}</small></span>
          <b>Открыть →</b>
        </button>
        ${focus ? `<button class="my-team-match" type="button" data-team-fixture="${Number(focus.fixtureId)}"><span>${escapeHtml(focus.home?.name || '')} — ${escapeHtml(focus.away?.name || '')}</span><strong>${isLiveMatch(focus) ? escapeHtml(scoreText(focus)) : timeOf(focus.date)}</strong><small>Открыть матч →</small></button>` : '<div class="empty compact-empty">Данные по ближайшему матчу пока недоступны.</div>'}
      </article>`;
    }).join('');

    root.querySelectorAll('[data-open-team]').forEach(btn => btn.addEventListener('click', () => onOpenTeam({
      id: Number(btn.dataset.openTeam),
      name: btn.dataset.teamName || '',
      logo: btn.dataset.teamLogo || '',
    })));
    root.querySelectorAll('[data-team-fixture]').forEach(btn => btn.addEventListener('click', () => {
      onAnalyzeMatch(Number(btn.dataset.teamFixture), btn);
    }));
  }

  return Object.freeze({ renderMyTeams });
}
