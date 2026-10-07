export function createMyTeamsRenderer({
  state,
  elementById,
  escapeHtml,
  safeUrl,
  timeOf,
  onOpenTeam,
  onOpenMatch,
}) {
  if (!state || typeof elementById !== 'function' || typeof escapeHtml !== 'function' || typeof safeUrl !== 'function' ||
      typeof timeOf !== 'function' || typeof onOpenTeam !== 'function' || typeof onOpenMatch !== 'function') {
    throw new TypeError('My Teams renderer requires state, formatters and explicit callbacks.');
  }

  const $ = elementById;

  function positiveId(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : 0;
    if (typeof value !== 'string') return 0;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return 0;
    const parsed=Number(raw);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
  }

  function safeText(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
  }

  function validDateMs(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed=Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function renderMyTeams() {
    const root = $('myTeamsList');
    const onboarding = $('myTeamsOnboarding');
    if (!root) return;

    const favorites=Array.isArray(state.favorites) ? state.favorites : [];
    const matches=Array.isArray(state.matches) ? state.matches : [];

    if (state.favoritesLoading === true && state.favoritesLoaded !== true) {
      root.innerHTML = '<div class="loader compact-loader">Загружаю ваши команды…</div>';
      if (onboarding) onboarding.hidden = true;
      return;
    }

    const validFavorites=favorites.filter(team => team && typeof team === 'object' && !Array.isArray(team) && positiveId(team.teamId));
    if (!validFavorites.length) {
      root.innerHTML = '';
      if (onboarding) onboarding.hidden = false;
      return;
    }

    if (onboarding) onboarding.hidden = true;
    root.innerHTML = validFavorites.map(team => {
      const id = positiveId(team.teamId);
      const teamName=safeText(team.teamName,'Команда');
      const rawLogo=safeText(team.teamLogo);
      const logo = rawLogo ? safeUrl(rawLogo) : '';
      const related = matches.filter(match => {
        if (!match || typeof match !== 'object' || Array.isArray(match) || !positiveId(match.fixtureId)) return false;
        return [positiveId(match.home?.id), positiveId(match.away?.id)].includes(id);
      });
      const live = related.find(match => match.live === true);
      const upcoming = related
        .filter(match => match.finished !== true && match.live !== true && validDateMs(match.date) !== null)
        .sort((a, b) => validDateMs(a.date) - validDateMs(b.date))[0];
      const recent = related
        .filter(match => match.finished === true && validDateMs(match.date) !== null)
        .sort((a, b) => validDateMs(b.date) - validDateMs(a.date))[0];
      const focus = live || upcoming || recent;
      const status = live ? '🔴 Матч идёт' : upcoming ? 'Ближайший матч' : recent ? 'Последний матч' : 'Матчи пока не найдены';
      const fixtureId=focus ? positiveId(focus.fixtureId) : 0;
      const homeName=safeText(focus?.home?.name);
      const awayName=safeText(focus?.away?.name);
      return `<article class="panel my-team-card">
        <button class="my-team-head team-open-link" type="button" data-open-team="${id}" data-team-name="${escapeHtml(teamName)}" data-team-logo="${escapeHtml(logo)}">
          ${logo ? `<img src="${escapeHtml(logo)}" alt="">` : '<span class="team-placeholder">⚽</span>'}
          <span><strong>${escapeHtml(teamName)}</strong><small>${status}</small></span>
          <b>Открыть →</b>
        </button>
        ${focus && fixtureId ? `<button class="my-team-match" type="button" data-team-fixture="${fixtureId}"><span>${escapeHtml(homeName)} — ${escapeHtml(awayName)}</span><strong>${live ? escapeHtml(`${focus.score?.home ?? '—'} : ${focus.score?.away ?? '—'}`) : escapeHtml(timeOf(focus.date))}</strong><small>Открыть матч →</small></button>` : '<div class="empty compact-empty">Данные по ближайшему матчу пока недоступны.</div>'}
      </article>`;
    }).join('');

    root.querySelectorAll('[data-open-team]').forEach(btn => btn.addEventListener('click', () => {
      const id=positiveId(btn.dataset.openTeam);
      if (!id) return;
      onOpenTeam({
        id,
        name:safeText(btn.dataset.teamName),
        logo:safeText(btn.dataset.teamLogo),
      });
    }));
    root.querySelectorAll('[data-team-fixture]').forEach(btn => btn.addEventListener('click', () => {
      const fixtureId=positiveId(btn.dataset.teamFixture);
      if (!fixtureId) return;
      onOpenMatch(fixtureId, btn);
    }));
  }

  return Object.freeze({ renderMyTeams });
}
