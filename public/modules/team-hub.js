export function createTeamHubModule(deps = {}) {
  const {
    $,
    activeViewId,
    analyzeMatch,
    api,
    dateTime,
    escapeHtml,
    isAdmin,
    isFavorite,
    openMatchCenter,
    openTournament,
    recoveryCardHtml,
    rememberTeam,
    renderDiscoveryHome,
    renderProvider,
    renderTournamentHero,
    renderTournamentMatches,
    russianCountLabel,
    safeUrl,
    setTournamentTab,
    showView,
    state,
    toast,
    toggleFavorite,
  } = deps;

  function teamResultBadge(result) {
    const r = String(result || '').toUpperCase();
    if (!['W','D','L'].includes(r)) return '';
    return `<span class="team-result ${r === 'W' ? 'win' : r === 'D' ? 'draw' : 'loss'}">${r === 'W' ? 'В' : r === 'D' ? 'Н' : 'П'}</span>`;
  }
  function teamMatchRow(m) {
    const center = m.live ? `<button class="mini-match-action live" type="button" data-center="${Number(m.fixtureId)}">Сейчас</button>` : m.finished ? `<span class="team-score">${m.score?.home ?? '—'} : ${m.score?.away ?? '—'}</span>` : `<button class="mini-match-action" type="button" data-fixture="${Number(m.fixtureId)}">Анализ</button>`;
    return `<article class="team-fixture-row"><div class="team-fixture-date"><strong>${escapeHtml(dateTime(m.date))}</strong><small>${escapeHtml(m.roundLabel || m.league || '')}</small></div><div class="team-fixture-opponent">${m.opponent?.logo ? `<img src="${safeUrl(m.opponent.logo)}" alt="">` : '<span>⚽</span>'}<div><strong>${escapeHtml(m.opponent?.name || '')}</strong><small>${m.venue === 'home' ? 'Дома' : 'В гостях'} · ${escapeHtml(m.league || '')}</small></div></div><div class="team-fixture-outcome">${teamResultBadge(m.result)}${center}</div></article>`;
  }
  function bindTeamFixtureActions(root) {
    root.querySelectorAll('[data-fixture]').forEach(btn => btn.addEventListener('click', () => analyzeMatch(Number(btn.dataset.fixture), btn)));
    root.querySelectorAll('[data-center]').forEach(btn => btn.addEventListener('click', () => openMatchCenter(Number(btn.dataset.center), btn)));
    root.querySelectorAll('[data-open-tournament]').forEach(btn => btn.addEventListener('click', () => openTournamentFromTeam(false)));
  }
  
  function teamPercent(value) {
    return value === null || value === undefined ? '—' : `${Number(value).toFixed(Number(value) % 1 ? 1 : 0)}%`;
  }
  function teamDecimal(value) {
    return value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : String(Math.round(Number(value) * 100) / 100);
  }
  function teamFormBadges(form='') {
    return String(form || '').slice(-12).split('').map(teamResultBadge).join('') || '<span class="muted">—</span>';
  }
  function seasonSplitCard(label, played, wins, draws, losses, ppg, gf, ga) {
    return `<div class="season-split-card"><div class="mini-section-head"><strong>${escapeHtml(label)}</strong><span>${Number(played || 0)} игр</span></div><div class="season-split-line"><span>В / Н / П</span><b>${Number(wins||0)} / ${Number(draws||0)} / ${Number(losses||0)}</b></div><div class="season-split-line"><span>Очки / матч</span><b>${teamDecimal(ppg)}</b></div><div class="season-split-line"><span>Голы</span><b>${Number(gf||0)} : ${Number(ga||0)}</b></div></div>`;
  }
  function teamPlayerSeasonStatsHtml(data = {}) {
    const p=data?.playerStats || {};
    const players=Array.isArray(p.players) ? p.players : [];
    const sourceLabel=String(p.sourceMeta?.label || p.sourceMeta?.provider || '');
    if (!p.available || !players.length) {
      const reason=String(p.reason || 'Статистика игроков сезона сейчас недоступна.');
      return `<section class="panel team-player-season-panel">
        <div class="mini-section-head"><strong>👤 Игроки сезона</strong><span>${escapeHtml(sourceLabel || 'по доступности')}</span></div>
        <div class="empty compact-empty">${escapeHtml(reason==='all_player_sources_unavailable' ? 'Статистика игроков сезона сейчас недоступна в настроенных источниках.' : reason==='quota_guard' ? 'Статистика игроков не запрашивается сейчас: сохраняем квоту источника данных.' : reason)}</div>
      </section>`;
    }
  
    const rows=players.slice(0,10);
    const scopeNote=p.complete
      ? `Полная доступная выборка команды · ${Number(p.summary?.count || players.length)} игроков`
      : p.scope==='competition-scorers'
        ? 'Резервный источник: показаны только игроки команды, присутствующие в таблице бомбардиров турнира.'
        : `Частичная выборка · загружено ${Number(p.summary?.pagesLoaded || 0)} из ${Number(p.summary?.pagesTotal || 0)} страниц`;
    const rowHtml=rows.map(player => {
      const yellow=Number(player.cards?.yellow || 0);
      const red=Number(player.cards?.red || 0)+Number(player.cards?.yellowRed || 0);
      const rating=player.games?.rating===null || player.games?.rating===undefined ? '—' : teamDecimal(player.games.rating);
      const availability=player.injured===true ? '<span class="player-season-alert">травмирован</span>' : '';
      return `<div class="player-season-row">
        <div class="player-season-name"><strong>${escapeHtml(player.name || 'Игрок')}</strong><small>${escapeHtml(player.games?.position || player.nationality || '—')} ${availability}</small></div>
        <span><small>Матчи</small><b>${Number(player.games?.appearances || 0)}</b></span>
        <span><small>Голы</small><b>${Number(player.goals?.total || 0)}</b></span>
        <span><small>Ассисты</small><b>${Number(player.goals?.assists || 0)}</b></span>
        <span><small>Рейтинг</small><b>${rating}</b></span>
        <span><small>Карточки</small><b>${yellow} / ${red}</b></span>
      </div>`;
    }).join('');
  
    return `<section class="panel team-player-season-panel">
      <div class="mini-section-head"><strong>👤 Игроки сезона</strong><span>${escapeHtml(sourceLabel || 'источник данных')}</span></div>
      <div class="player-season-table">
        <div class="player-season-head"><span>Игрок</span><span>М</span><span>Г</span><span>А</span><span>R</span><span>Ж / К</span></div>
        ${rowHtml}
      </div>
      <p class="tiny">${escapeHtml(scopeNote)}. Сортировка: голы, ассисты, матчи, минуты — без искусственного рейтинга.</p>
    </section>`;
  }
  
  function renderTeamIntelligence(data) {
    const el = $('teamIntelligence'); if (!el) return;
    if (!data?.available || !data?.stats?.available) {
      el.innerHTML = `<div class="empty compact-empty">${escapeHtml(data?.reason || 'Сезонная статистика для этой команды сейчас недоступна.')}</div>`;
      return;
    }
    const s=data.stats, f=s.fixtures||{}, d=s.derived||{}, g=s.goals||{}, b=s.biggest||{};
    const playerStatsHtml=teamPlayerSeasonStatsHtml(data);
    const warning=data.stale ? `<div class="data-notice stale">⚠️ ${escapeHtml(data.warning || 'Показана сохранённая сезонная статистика.')}</div>` : '';
    const leagueTitle=[s.league?.name, s.league?.season].filter(Boolean).join(' · ');
    const goalDiff=Number(g.difference||0);
    el.innerHTML = `${warning}
      <section class="panel intelligence-hero">
        <div class="mini-section-head"><strong>📊 Сезонная статистика</strong><span>${escapeHtml(leagueTitle)}</span></div>
        <div class="intelligence-kpis">
          <div><span>Матчи</span><strong>${Number(f.played?.total||0)}</strong></div>
          <div><span>Очки / матч</span><strong>${teamDecimal(d.ppg)}</strong></div>
          <div><span>Победы</span><strong>${teamPercent(d.winRate)}</strong></div>
          <div><span>Разница</span><strong class="${goalDiff>0?'positive':goalDiff<0?'negative':''}">${goalDiff>0?'+':''}${goalDiff}</strong></div>
        </div>
        <div class="team-season-form"><span>Форма сезона</span><div>${teamFormBadges(s.form)}</div></div>
      </section>
      <section class="panel">
        <h2>🏠 Дома / ✈️ В гостях</h2>
        <div class="season-split-grid">
          ${seasonSplitCard('Дома',f.played?.home,f.wins?.home,f.draws?.home,f.losses?.home,d.homePpg,g.for?.home,g.against?.home)}
          ${seasonSplitCard('В гостях',f.played?.away,f.wins?.away,f.draws?.away,f.losses?.away,d.awayPpg,g.for?.away,g.against?.away)}
        </div>
      </section>
      <section class="panel">
        <h2>⚽ Атака и оборона</h2>
        <div class="team-kpi-grid intelligence-detail-grid">
          <div><span>Забито / матч</span><strong>${teamDecimal(d.goalsForPerMatch)}</strong></div>
          <div><span>Пропущено / матч</span><strong>${teamDecimal(d.goalsAgainstPerMatch)}</strong></div>
          <div><span>Сухие матчи</span><strong>${teamPercent(d.cleanSheetRate)}</strong></div>
          <div><span>Без гола</span><strong>${teamPercent(d.failedToScoreRate)}</strong></div>
          <div><span>Всего голов</span><strong>${Number(g.for?.total||0)} : ${Number(g.against?.total||0)}</strong></div>
          <div><span>Схема</span><strong>${escapeHtml(s.mostUsedLineup?.formation || '—')}</strong></div>
        </div>
      </section>
      ${playerStatsHtml}
      <section class="panel season-records">
        <h2>📌 Максимумы сезона</h2>
        <div class="season-record-grid">
          <div><span>Крупнейшая победа дома</span><strong>${escapeHtml(b.winHome || '—')}</strong></div>
          <div><span>Крупнейшая победа в гостях</span><strong>${escapeHtml(b.winAway || '—')}</strong></div>
          <div><span>Крупнейшее поражение дома</span><strong>${escapeHtml(b.lossHome || '—')}</strong></div>
          <div><span>Крупнейшее поражение в гостях</span><strong>${escapeHtml(b.lossAway || '—')}</strong></div>
        </div>
        <p class="tiny">Данные этой вкладки загружаются только при открытии и сохраняются на 6 часов.</p>
      </section>`;
  }
  async function loadTeamIntelligence(force=false) {
    const team=state.currentTeam, comp=team?.data?.primaryCompetition, el=$('teamIntelligence');
    if(!team?.id || !el) return;
    if(!comp?.leagueId || !comp?.season){ el.innerHTML='<div class="empty compact-empty">Сначала нужно определить основной турнир команды.</div>'; return; }
    const key=`${Number(team.id)}:${Number(comp.leagueId)}:${Number(comp.season)}`;
    const seq=++state.teamIntelligenceRequestSeq;
    if(!force && state.teamIntelligenceCache.has(key)){
      if(Number(state.currentTeam?.id)===Number(team.id)) renderTeamIntelligence(state.teamIntelligenceCache.get(key));
      return;
    }
    el.innerHTML='<div class="loader">Загружаю сезонную статистику…</div>';
    const q=new URLSearchParams({teamId:String(Number(team.id)),leagueId:String(Number(comp.leagueId)),season:String(Number(comp.season)),teamName:team.name||'',teamLogo:team.logo||'',leagueName:comp.name||'',leagueLogo:comp.logo||'',country:comp.country||''});
    try{
      const data=await api(`/api/team/intelligence?${q.toString()}`);
      state.teamIntelligenceCache.set(key,data);
      if(seq!==state.teamIntelligenceRequestSeq || Number(state.currentTeam?.id)!==Number(team.id)) return;
      if(isAdmin() && data.provider?.visibility==='admin'){state.provider=data.provider;renderProvider();}
      renderTeamIntelligence(data);
    }catch(e){
      if(seq!==state.teamIntelligenceRequestSeq || Number(state.currentTeam?.id)!==Number(team.id)) return;
      const cached=state.teamIntelligenceCache.get(key);
      if(cached){renderTeamIntelligence(cached);el.insertAdjacentHTML('afterbegin',`<div class="data-notice stale">⚠️ ${escapeHtml(e.message)} Показаны сохранённые показатели.</div>`);}
      else{el.innerHTML=recoveryCardHtml({title:'Статистика команды временно недоступна',message:e.message,retryId:'teamIntelligenceRetry',compact:true});$('teamIntelligenceRetry')?.addEventListener('click',()=>loadTeamIntelligence(true));}
    }
  }
  function playerCard(p) {
    return `<div class="squad-player">${p.photo?`<img src="${safeUrl(p.photo)}" alt="">`:'<span class="squad-avatar">👤</span>'}<div><strong>${escapeHtml(p.name||'')}</strong><small>${p.number?`№${Number(p.number)} · `:''}${p.age?`${Number(p.age)} лет`:'Возраст —'}</small></div></div>`;
  }
  function renderTeamSquad(data) {
    const el=$('teamSquad'); if(!el) return;
    if(!data?.available || !data?.groups?.length){el.innerHTML=`<div class="empty compact-empty">${escapeHtml(data?.reason||'Состав команды сейчас недоступен.')}</div>`;return;}
    const sm=data.summary||{};
    const warning=data.stale?`<div class="data-notice stale">⚠️ ${escapeHtml(data.warning||'Показан сохранённый состав.')}</div>`:'';
    el.innerHTML=`${warning}<section class="panel squad-summary-panel"><div class="mini-section-head"><strong>👥 Состав команды</strong><span>${Number(sm.total||0)} игроков</span></div><div class="squad-summary-grid"><div><span>Средний возраст</span><strong>${sm.averageAge??'—'}</strong></div><div><span>Вратари</span><strong>${Number(sm.goalkeepers||0)}</strong></div><div><span>Защитники</span><strong>${Number(sm.defenders||0)}</strong></div><div><span>Полузащитники</span><strong>${Number(sm.midfielders||0)}</strong></div><div><span>Нападающие</span><strong>${Number(sm.attackers||0)}</strong></div></div></section>${data.groups.map(group=>`<section class="panel squad-group"><div class="mini-section-head"><strong>${escapeHtml(group.label||'Игроки')}</strong><span>${group.players?.length||0}</span></div><div class="squad-player-grid">${(group.players||[]).map(playerCard).join('')}</div></section>`).join('')}<p class="tiny squad-cache-note">Состав загружается только при открытии вкладки и сохраняется на 12 часов. Статистика отдельных игроков будет подключена после перехода на расширенный тариф источника данных.</p>`;
  }
  async function loadTeamSquad(force=false) {
    const team=state.currentTeam, el=$('teamSquad'); if(!team?.id||!el) return;
    const key=String(Number(team.id));
    const seq=++state.teamSquadRequestSeq;
    if(!force&&state.teamSquadCache.has(key)){
      if(Number(state.currentTeam?.id)===Number(team.id)) renderTeamSquad(state.teamSquadCache.get(key));
      return;
    }
    el.innerHTML='<div class="loader">Загружаю состав…</div>';
    try{
      const data=await api(`/api/team/squad?teamId=${Number(team.id)}`);
      state.teamSquadCache.set(key,data);
      if(seq!==state.teamSquadRequestSeq || Number(state.currentTeam?.id)!==Number(team.id)) return;
      if(isAdmin() && data.provider?.visibility==='admin'){state.provider=data.provider;renderProvider();}
      renderTeamSquad(data);
    }catch(e){
      if(seq!==state.teamSquadRequestSeq || Number(state.currentTeam?.id)!==Number(team.id)) return;
      const cached=state.teamSquadCache.get(key);
      if(cached){renderTeamSquad(cached);el.insertAdjacentHTML('afterbegin',`<div class="data-notice stale">⚠️ ${escapeHtml(e.message)} Показан сохранённый состав.</div>`);}
      else{el.innerHTML=recoveryCardHtml({title:'Состав временно недоступен',message:e.message,retryId:'teamSquadRetry',compact:true});$('teamSquadRetry')?.addEventListener('click',()=>loadTeamSquad(true));}
    }
  }
  
  function renderTeamHub(data) {
    const team = data?.team || state.currentTeam || {}; state.currentTeam = { ...state.currentTeam, ...team, data };
    const fav = isFavorite(team.id), favoritePending = state.favoriteMutations.has(Number(team.id)), comp = data?.primaryCompetition, standing = data?.standing, form = data?.form, next = data?.liveNow || data?.nextMatch;
    const stale = data?.stale ? `<div class="data-notice stale">⚠️ ${escapeHtml(data.warning || 'Показаны сохранённые данные команды.')}</div>` : '';
    $('teamHero').innerHTML = `${stale}<section class="panel team-hero"><div class="team-hero-main"><div class="team-hero-logo">${team.logo ? `<img src="${safeUrl(team.logo)}" alt="">` : '⚽'}</div><div class="team-hero-copy"><span>СТРАНИЦА КОМАНДЫ</span><h2>${escapeHtml(team.name || 'Команда')}</h2><p>${comp ? `${escapeHtml(comp.name)} · ${escapeHtml(comp.country || '')}` : 'Турнир определяется по последним матчам'}</p></div><button id="teamFavoriteBtn" class="team-favorite-big ${fav ? 'active' : ''} ${favoritePending ? 'is-pending' : ''}" type="button" data-team-id="${Number(team.id)}" aria-pressed="${fav ? 'true' : 'false'}" aria-label="${fav ? 'Удалить команду из избранного' : 'Добавить команду в избранное'}" ${favoritePending ? 'disabled' : ''}>${fav ? '★' : '☆'}</button></div><div class="team-hero-stats"><div><span>Форма</span><strong>${form?.form ? escapeHtml(form.form.replace(/W/g,'В').replace(/D/g,'Н').replace(/L/g,'П')) : '—'}</strong></div><div><span>Очки / матч</span><strong>${form?.ppg ?? '—'}</strong></div><div><span>Голы</span><strong>${form ? `${form.gfAvg} / ${form.gaAvg}` : '—'}</strong></div><div><span>Место</span><strong>${standing?.rank ? `${standing.rank}` : '—'}</strong></div></div>${comp ? `<button id="teamTournamentBtn" class="secondary-btn team-tournament-btn" type="button">🏆 ${escapeHtml(comp.shortName || comp.name)} · открыть турнир</button>` : ''}</section>`;
    $('teamFavoriteBtn')?.addEventListener('click', async () => { await toggleFavorite({ id:Number(team.id), name:team.name||'', logo:team.logo||'' }); renderTeamHub(state.currentTeam?.data || data); });
    $('teamTournamentBtn')?.addEventListener('click', () => openTournamentFromTeam(false));
    const formHtml = form ? `<section class="panel team-form-panel"><h2>📈 Последние ${russianCountLabel(form.sample || 0, 'матч', 'матча', 'матчей')}</h2><div class="team-form-line">${String(form.form || '').split('').map(teamResultBadge).join('')}</div><div class="team-kpi-grid"><div><span>Победы</span><strong>${Number(form.wins||0)}</strong></div><div><span>Ничьи</span><strong>${Number(form.draws||0)}</strong></div><div><span>Поражения</span><strong>${Number(form.losses||0)}</strong></div><div><span>Забивает</span><strong>${form.gfAvg ?? '—'}</strong></div><div><span>Пропускает</span><strong>${form.gaAvg ?? '—'}</strong></div><div><span>ОЗ</span><strong>${form.bttsPct ?? '—'}%</strong></div></div></section>` : '<section class="panel"><div class="empty compact-empty">Пока недостаточно завершённых матчей для формы.</div></section>';
    const nextHtml = next ? `<section class="panel next-team-match"><div class="mini-section-head"><strong>${next.live ? '🔴 Матч идёт' : '⏭ Ближайший матч'}</strong><span>${escapeHtml(dateTime(next.date))}</span></div>${teamMatchRow(next)}</section>` : '<section class="panel"><div class="empty compact-empty">Ближайший матч в доступном окне не найден.</div></section>';
    const positionHtml = standing ? `<section class="panel team-standing-card"><h2>🏆 Положение в турнире</h2><div class="team-standing-summary"><strong>${Number(standing.rank)} место</strong><span>${Number(standing.points)} очков · ${russianCountLabel(standing.played, 'матч', 'матча', 'матчей')} · ${Number(standing.goalsFor)}:${Number(standing.goalsAgainst)}</span></div></section>` : `<section class="panel team-standing-card"><h2>🏆 Положение в турнире</h2><p class="muted">Позиция появится после загрузки таблицы турнира. Так мы не делаем отдельный запрос к источнику данных автоматически.</p>${comp ? '<button id="teamStandingTableBtn" class="secondary-btn" type="button">Открыть турнирную таблицу</button>' : ''}</section>`;
    $('teamOverview').innerHTML = `${nextHtml}${formHtml}${positionHtml}`;
    bindTeamFixtureActions($('teamOverview'));
    $('teamStandingTableBtn')?.addEventListener('click', () => openTournamentFromTeam(true));
    $('teamResults').innerHTML = data?.recent?.length ? `<div class="team-fixtures-list">${data.recent.map(teamMatchRow).join('')}</div>` : '<div class="empty">Завершённых матчей в доступном окне нет.</div>';
    $('teamSchedule').innerHTML = data?.upcoming?.length ? `<div class="team-fixtures-list">${data.upcoming.map(teamMatchRow).join('')}</div>` : '<div class="empty">Предстоящих матчей в доступном окне нет.</div>';
    bindTeamFixtureActions($('teamResults')); bindTeamFixtureActions($('teamSchedule'));
  }
  async function loadTeamHub(team, force=false) {
    const key=String(Number(team?.id||0)); if (!key || key==='0') return;
    const seq=++state.teamHubRequestSeq;
    const cached=state.teamCache.get(key);
    if (cached && !force) {
      if(String(Number(state.currentTeam?.id||0))===key) renderTeamHub(cached);
      return;
    }
    if (!cached && String(Number(state.currentTeam?.id||0))===key) {
      $('teamHero').innerHTML='<div class="loader">Загружаю страницу команды…</div>'; $('teamOverview').innerHTML=''; $('teamIntelligence').innerHTML='<div class="empty compact-empty">Откройте вкладку «Статистика», чтобы загрузить сезонные данные.</div>'; $('teamSquad').innerHTML='<div class="empty compact-empty">Откройте вкладку «Состав», чтобы загрузить игроков.</div>'; $('teamResults').innerHTML=''; $('teamSchedule').innerHTML='';
    }
    try {
      const q=new URLSearchParams({teamId:String(Number(team.id)),name:team.name||'',logo:team.logo||''});
      const data=await api(`/api/team?${q.toString()}`);
      state.teamCache.set(key,data);
      if(seq!==state.teamHubRequestSeq || String(Number(state.currentTeam?.id||0))!==key) return;
      if(isAdmin() && data.provider?.visibility==='admin'){state.provider=data.provider;renderProvider();}
      renderTeamHub(data);
    } catch(e) {
      if(seq!==state.teamHubRequestSeq || String(Number(state.currentTeam?.id||0))!==key) return;
      if (cached) {
        renderTeamHub(cached);
        $('teamHero')?.insertAdjacentHTML('afterbegin', `<div class="data-notice stale">⚠️ ${escapeHtml(e.message)} Показана последняя открытая версия команды.</div>`);
        return;
      }
      $('teamHero').innerHTML=recoveryCardHtml({ title:'Страница команды временно недоступна', message:e.message, retryId:'teamHubRetry' });
      $('teamHubRetry')?.addEventListener('click', () => loadTeamHub(team, true));
    }
  }
  function openTeam(team) {
    if(!team?.id) return; rememberTeam(team); renderDiscoveryHome(); const current=activeViewId(); if(current!=='teamView') state.teamBackView=current;
    state.currentTeam={id:Number(team.id),name:team.name||'',logo:team.logo||'',data:null}; setTeamTab('overview'); showView('teamView'); loadTeamHub(state.currentTeam,false);
  }
  function setTeamTab(tab) {
    const buttons = [...document.querySelectorAll('.team-tab')];
    buttons.forEach(btn => {
      const active = btn.dataset.teamTab === tab;
      const name = btn.dataset.teamTab || 'overview';
      btn.id = `team-tab-${name}`;
      btn.classList.toggle('active', active);
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', `team-panel-${name}`);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });
    const panels = [
      ['teamOverviewPanel', 'overview'],
      ['teamIntelligencePanel', 'intelligence'],
      ['teamSquadPanel', 'squad'],
      ['teamResultsPanel', 'results'],
      ['teamSchedulePanel', 'schedule'],
    ];
    panels.forEach(([id, key]) => {
      const panel = $(id);
      if (!panel) return;
      const active = tab === key;
      panel.id = `team-panel-${key}`;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
      panel.toggleAttribute('inert', !active);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `team-tab-${key}`);
      panel.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    if(tab==='intelligence') loadTeamIntelligence(false);
    if(tab==='squad') loadTeamSquad(false);
  }
  function openTournamentFromTeam(openTable = false) {
    state.tournamentBackView = 'teamView';
    const comp=state.currentTeam?.data?.primaryCompetition;
    if(!comp?.leagueId) return toast('Основной турнир команды пока не определён.');
    const existing=state.matches.find(m=>Number(m.leagueId)===Number(comp.leagueId));
    if(existing) {
      openTournament(Number(comp.leagueId));
      if (openTable) setTournamentTab('table', true);
      return;
    }
    state.currentTournament={leagueId:Number(comp.leagueId),season:Number(comp.season||new Date().getFullYear()),name:comp.name||'Турнир',shortName:comp.shortName||comp.name||'Турнир',country:comp.country||'',logo:comp.logo||'',category:comp.category||'',tier:comp.tier||'standard'};
    renderTournamentHero();
    renderTournamentMatches();
    setTournamentTab('table', true);
    showView('tournamentView');
  }

  return {
    teamResultBadge,
    teamMatchRow,
    bindTeamFixtureActions,
    teamPercent,
    teamDecimal,
    teamFormBadges,
    seasonSplitCard,
    teamPlayerSeasonStatsHtml,
    renderTeamIntelligence,
    loadTeamIntelligence,
    playerCard,
    renderTeamSquad,
    loadTeamSquad,
    renderTeamHub,
    loadTeamHub,
    openTeam,
    setTeamTab,
    openTournamentFromTeam,
  };
}
