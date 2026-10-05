export function createPlayerHubModule(deps = {}) {
  const {
    $,
    activeViewId,
    api,
    buildPlayerComparisonCandidates,
    escapeHtml,
    friendlyErrorMessage,
    loadFavoritePlayers,
    playerComparisonHtml,
    playerFollowModule,
    publicText,
    safeUrl,
    samePlayer,
    sendProductAction,
    showView,
    state,
    toast,
  } = deps;

  function playerPositionLabel(value = '') {
    const key = String(value || '').trim().toLowerCase();
    return ({ g:'Вратарь', goalkeeper:'Вратарь', d:'Защитник', defender:'Защитник', m:'Полузащитник', midfielder:'Полузащитник', f:'Нападающий', attacker:'Нападающий' })[key] || publicText(value) || 'Позиция не указана';
  }
  
  function playerHubMetric(label, value, suffix = '') {
    const shown = value === null || value === undefined || value === '' ? '—' : `${escapeHtml(String(value))}${suffix}`;
    return `<div class="player-hub-metric"><span>${escapeHtml(label)}</span><strong>${shown}</strong></div>`;
  }
  
  function playerSquadProfile(data = {}, player = {}) {
    const targetId = Number(player?.data?.id || 0);
    const targetName = String(player?.data?.name || '').trim().toLowerCase();
    for (const group of (data?.groups || [])) {
      for (const item of (group?.players || [])) {
        const sameId = targetId > 0 && Number(item?.id || 0) === targetId;
        const sameName = !targetId && targetName && String(item?.name || '').trim().toLowerCase() === targetName;
        if (sameId || sameName) return {
          found: true,
          group: String(group?.label || 'Состав'),
          age: Number(item?.age || 0) || null,
          number: Number(item?.number || 0) || null,
          position: item?.position || player?.data?.position || '',
          photo: item?.photo || player?.data?.photo || '',
          stale: Boolean(data?.stale),
          warning: String(data?.warning || ''),
        };
      }
    }
    return { found: false, stale: Boolean(data?.stale), warning: String(data?.warning || '') };
  }
  
  function playerSquadProfileHtml(profile = {}) {
    if (profile.loading) return `<section class="panel player-hub-profile"><div class="center-section-title"><div><h2>Профиль игрока</h2><p>Сверяю с составом команды</p></div></div><div class="loader compact-loader">Загружаю профиль…</div></section>`;
    if (profile.error) return `<section class="panel player-hub-profile"><div class="center-section-title"><div><h2>Профиль игрока</h2><p>Дополнительные данные команды</p></div></div><div class="empty compact-empty">Профиль состава временно недоступен. Данные текущего матча остаются актуальными.</div></section>`;
    if (!profile.found) return `<section class="panel player-hub-profile"><div class="center-section-title"><div><h2>Профиль игрока</h2><p>Дополнительные данные команды</p></div></div><div class="empty compact-empty">Игрок не найден в текущем составе команды.</div></section>`;
    return `<section class="panel player-hub-profile">
      <div class="center-section-title"><div><h2>Профиль игрока</h2><p>Данные из текущего состава команды</p></div></div>
      ${profile.stale ? `<div class="data-notice stale">⚠️ ${escapeHtml(profile.warning || 'Показан сохранённый состав команды.')}</div>` : ''}
      <div class="player-hub-profile-grid">
        <div><span>Возраст</span><strong>${profile.age ?? '—'}</strong></div>
        <div><span>Номер</span><strong>${profile.number ? `№${profile.number}` : '—'}</strong></div>
        <div><span>Позиция</span><strong>${escapeHtml(playerPositionLabel(profile.position))}</strong></div>
        <div><span>Группа состава</span><strong>${escapeHtml(profile.group || '—')}</strong></div>
      </div>
      <p class="tiny">Профиль загружается лениво через уже существующий кэш состава команды и не создаёт отдельный запрос на сезонную статистику игрока.</p>
    </section>`;
  }
  
  async function loadPlayerSquadProfile(player = state.currentPlayer) {
    const teamId = Number(player?.team?.id || 0);
    if (!teamId || !player) return;
    const key = String(teamId);
    player.squadProfile = { loading: true };
    renderPlayerHub(player);
    try {
      let data = state.teamSquadCache.get(key);
      if (!data) {
        data = await api(`/api/team/squad?teamId=${teamId}`);
        state.teamSquadCache.set(key, data);
      }
      if (state.currentPlayer !== player) return;
      player.squadProfile = playerSquadProfile(data, player);
      if (player.squadProfile.photo && !player.data.photo) player.data.photo = player.squadProfile.photo;
      if (player.squadProfile.position && !player.data.position) player.data.position = player.squadProfile.position;
      renderPlayerHub(player);
    } catch (error) {
      if (state.currentPlayer !== player) return;
      player.squadProfile = { error: true, message: error?.message || 'Не удалось загрузить профиль.' };
      renderPlayerHub(player);
    }
  }
  
  function playerSeasonStatProfile(data = {}, player = {}) {
    const targetId = Number(player?.data?.id || 0);
    const targetName = String(player?.data?.name || '').trim().toLowerCase();
    const stats = data?.playerStats || {};
    const rows = Array.isArray(stats.players) ? stats.players : [];
    const found = rows.find(item => {
      const sameId = targetId > 0 && Number(item?.id || 0) === targetId;
      const sameName = targetName && String(item?.name || '').trim().toLowerCase() === targetName;
      return sameId || sameName;
    });
    if (!found) {
      return {
        found: false,
        available: Boolean(stats.available),
        partial: Boolean(stats.partial),
        sourceLabel: String(stats.sourceMeta?.label || stats.sourceMeta?.provider || ''),
        reason: String(stats.reason || ''),
      };
    }
    return {
      found: true,
      partial: Boolean(stats.partial || !stats.complete),
      sourceLabel: String(stats.sourceMeta?.label || stats.sourceMeta?.provider || ''),
      scope: String(stats.scope || ''),
      appearances: Number.isFinite(Number(found.games?.appearances)) ? Number(found.games.appearances) : null,
      lineups: Number.isFinite(Number(found.games?.lineups)) ? Number(found.games.lineups) : null,
      minutes: Number.isFinite(Number(found.games?.minutes)) ? Number(found.games.minutes) : null,
      rating: Number.isFinite(Number(found.games?.rating)) ? Number(found.games.rating) : null,
      goals: Number.isFinite(Number(found.goals?.total)) ? Number(found.goals.total) : null,
      assists: Number.isFinite(Number(found.goals?.assists)) ? Number(found.goals.assists) : null,
      keyPasses: Number.isFinite(Number(found.passes?.key)) ? Number(found.passes.key) : null,
      passAccuracy: Number.isFinite(Number(found.passes?.accuracy)) ? Number(found.passes.accuracy) : null,
      yellow: Number.isFinite(Number(found.cards?.yellow)) ? Number(found.cards.yellow) : null,
      red: Number.isFinite(Number(found.cards?.red)) ? Number(found.cards.red) + Number(found.cards?.yellowRed || 0) : null,
      injured: found.injured === true,
    };
  }
  
  function playerSeasonStatsHtml(profile = {}) {
    if (profile.loading) return `<section class="panel player-hub-season"><div class="center-section-title"><div><h2>Сезон</h2><p>Собираю уже доступную статистику команды</p></div></div><div class="loader compact-loader">Загружаю сезонные показатели…</div></section>`;
    if (profile.error) return `<section class="panel player-hub-season"><div class="center-section-title"><div><h2>Сезон</h2><p>Статистика игрока</p></div></div><div class="empty compact-empty">Сезонные показатели временно недоступны. Статистика текущего матча остаётся доступной.</div></section>`;
    if (!profile.found) {
      const detail = profile.reason === 'quota_guard'
        ? 'Источник сейчас бережёт квоту — отдельный запрос ради игрока не выполняется.'
        : 'Игрок не найден в доступной сезонной выборке команды.';
      return `<section class="panel player-hub-season"><div class="center-section-title"><div><h2>Сезон</h2><p>Статистика игрока</p></div></div><div class="empty compact-empty">${escapeHtml(detail)}</div></section>`;
    }
    const rating = profile.rating === null ? '—' : profile.rating.toFixed(2);
    const minutes = profile.minutes === null ? '—' : profile.minutes;
    const lineups = profile.lineups === null ? '—' : profile.lineups;
    const keyPasses = profile.keyPasses === null ? '—' : profile.keyPasses;
    const accuracy = profile.passAccuracy === null ? '—' : `${profile.passAccuracy}%`;
    return `<section class="panel player-hub-season">
      <div class="center-section-title"><div><h2>Показатели сезона</h2><p>${escapeHtml(profile.sourceLabel || 'Данные команды')}${profile.partial ? ' · частичное покрытие' : ''}</p></div></div>
      ${profile.injured ? '<div class="data-notice stale">⚠️ В сезонных данных игрок отмечен как травмированный.</div>' : ''}
      <div class="player-hub-season-grid">
        ${playerHubMetric('Матчи', profile.appearances)}
        ${playerHubMetric('В старте', lineups)}
        ${playerHubMetric('Минуты', minutes)}
        ${playerHubMetric('Голы', profile.goals)}
        ${playerHubMetric('Ассисты', profile.assists)}
        ${playerHubMetric('Рейтинг', rating)}
        ${playerHubMetric('Ключ. передачи', keyPasses)}
        ${playerHubMetric('Точность паса', accuracy)}
        ${playerHubMetric('Жёлтые', profile.yellow === null ? '—' : profile.yellow)}
        ${playerHubMetric('Красные', profile.red === null ? '—' : profile.red)}
      </div>
      <p class="tiny">Player Hub использует общий Team Intelligence cache. Отдельного player endpoint и отдельного запроса только ради этого профиля нет.</p>
    </section>`;
  }
  
  async function loadPlayerSeasonStats(player = state.currentPlayer) {
    const teamId = Number(player?.team?.id || 0);
    const leagueId = Number(player?.match?.leagueId || 0);
    const season = Number(player?.match?.season || 0);
    if (!player || !teamId || !leagueId || !season) {
      if (player) {
        player.seasonStats = { found:false, reason:'competition_context_missing' };
        renderPlayerHub(player);
      }
      return;
    }
  
    const key = `${teamId}:${leagueId}:${season}`;
    player.seasonStats = { loading:true };
    renderPlayerHub(player);
    try {
      let data = state.teamIntelligenceCache.get(key);
      if (!data) {
        const q = new URLSearchParams({
          teamId:String(teamId),
          leagueId:String(leagueId),
          season:String(season),
          teamName:String(player.team?.name || ''),
          teamLogo:String(player.team?.logo || ''),
          leagueName:String(player.match?.league || ''),
          leagueLogo:String(player.match?.leagueLogo || ''),
          country:String(player.match?.country || ''),
        });
        data = await api(`/api/team/intelligence?${q.toString()}`);
        state.teamIntelligenceCache.set(key, data);
      }
      if (state.currentPlayer !== player) return;
      player.seasonStats = playerSeasonStatProfile(data, player);
      renderPlayerHub(player);
    } catch (error) {
      if (state.currentPlayer !== player) return;
      player.seasonStats = { error:true, message:error?.message || 'Не удалось загрузить сезонные показатели.' };
      renderPlayerHub(player);
    }
  }
  
  
  function playerComparisonSquadSources(player = state.currentPlayer) {
    const match = player?.match || {};
    const teams = [player?.team, match?.home, match?.away].filter(Boolean);
    const seen = new Set();
    return teams.flatMap(team => {
      const teamId = Number(team?.id || 0);
      if (!teamId || seen.has(teamId)) return [];
      seen.add(teamId);
      const data = state.teamSquadCache.get(String(teamId));
      return data ? [{ team:{ ...team }, data }] : [];
    });
  }
  
  function enrichPlayerComparisonCandidate(candidate = {}) {
    const teamId = Number(candidate?.team?.id || 0);
    const leagueId = Number(candidate?.match?.leagueId || 0);
    const season = Number(candidate?.match?.season || 0);
    if (teamId && !candidate.squadProfile) {
      const squadData = state.teamSquadCache.get(String(teamId));
      if (squadData) candidate.squadProfile = playerSquadProfile(squadData, candidate);
    }
    if (teamId && leagueId && season && !candidate.seasonStats) {
      const intelligenceKey = `${teamId}:${leagueId}:${season}`;
      const data = state.teamIntelligenceCache.get(intelligenceKey);
      if (data) candidate.seasonStats = playerSeasonStatProfile(data, candidate);
    }
    return candidate;
  }
  
  function playerComparisonCandidatesFor(player = state.currentPlayer) {
    return buildPlayerComparisonCandidates(player, {
      center: state.currentCenter || {},
      squads: playerComparisonSquadSources(player),
    }).map(enrichPlayerComparisonCandidate);
  }
  
  async function hydrateComparisonPlayer(primary, secondary) {
    if (!primary || !secondary || samePlayer(primary, secondary)) return;
    const comparison = primary.comparison || (primary.comparison = { open:true });
    const requestSeq = ++state.playerComparisonRequestSeq;
    comparison.loading = true;
    comparison.error = '';
    renderPlayerHub(primary);
  
    try {
      const teamId = Number(secondary?.team?.id || 0);
      const leagueId = Number(secondary?.match?.leagueId || 0);
      const season = Number(secondary?.match?.season || 0);
  
      if (teamId && !secondary.squadProfile?.found) {
        let squadData = state.teamSquadCache.get(String(teamId));
        if (!squadData) {
          squadData = await api(`/api/team/squad?teamId=${teamId}`);
          state.teamSquadCache.set(String(teamId), squadData);
        }
        secondary.squadProfile = playerSquadProfile(squadData, secondary);
        if (secondary.squadProfile?.photo && !secondary.data?.photo) secondary.data.photo = secondary.squadProfile.photo;
        if (secondary.squadProfile?.position && !secondary.data?.position) secondary.data.position = secondary.squadProfile.position;
      }
  
      if (teamId && leagueId && season && !secondary.seasonStats?.found) {
        const intelligenceKey = `${teamId}:${leagueId}:${season}`;
        let data = state.teamIntelligenceCache.get(intelligenceKey);
        if (!data) {
          const q = new URLSearchParams({
            teamId:String(teamId),
            leagueId:String(leagueId),
            season:String(season),
            teamName:String(secondary.team?.name || ''),
            teamLogo:String(secondary.team?.logo || ''),
            leagueName:String(secondary.match?.league || ''),
            leagueLogo:String(secondary.match?.leagueLogo || ''),
            country:String(secondary.match?.country || ''),
          });
          data = await api(`/api/team/intelligence?${q.toString()}`);
          state.teamIntelligenceCache.set(intelligenceKey, data);
        }
        secondary.seasonStats = playerSeasonStatProfile(data, secondary);
      } else if (!secondary.seasonStats && (!teamId || !leagueId || !season)) {
        secondary.seasonStats = { found:false, reason:'competition_context_missing' };
      }
    } catch (error) {
      comparison.error = friendlyErrorMessage(error);
    } finally {
      if (state.currentPlayer !== primary || requestSeq !== state.playerComparisonRequestSeq) return;
      comparison.loading = false;
      renderPlayerHub(primary);
    }
  }
  
  function bindPlayerComparisonActions(player, candidates = []) {
    const root = $('playerHub');
    if (!root || !player) return;
    root.querySelector('[data-player-comparison-open]')?.addEventListener('click', () => {
      player.comparison = { ...(player.comparison || {}), open:true, error:'' };
      renderPlayerHub(player);
    });
    root.querySelector('[data-player-comparison-close]')?.addEventListener('click', () => {
      player.comparison = { open:false, secondary:null, loading:false, error:'' };
      state.playerComparisonRequestSeq += 1;
      renderPlayerHub(player);
    });
    root.querySelector('[data-player-comparison-change]')?.addEventListener('click', () => {
      player.comparison = { ...(player.comparison || {}), open:true, secondary:null, loading:false, error:'' };
      state.playerComparisonRequestSeq += 1;
      renderPlayerHub(player);
    });
    root.querySelectorAll('[data-player-comparison-candidate]').forEach(button => button.addEventListener('click', () => {
      const candidate = candidates[Number(button.dataset.playerComparisonCandidate || -1)];
      if (!candidate) return;
      if (samePlayer(player, candidate)) return toast('Нельзя сравнить игрока с самим собой.');
      player.comparison = { open:true, secondary:candidate, loading:false, error:'' };
      renderPlayerHub(player);
      void hydrateComparisonPlayer(player, candidate);
    }));
  }
  
  function renderPlayerHub(player = state.currentPlayer) {
    const root = $('playerHub');
    if (!root) return;
    if (!player) {
      root.innerHTML = '<div class="empty">Игрок не выбран.</div>';
      return;
    }
    const match = player.match || {};
    const team = player.team || {};
    const p = player.data || {};
    const rating = Number.isFinite(Number(p.rating)) ? Number(p.rating).toFixed(1) : '—';
    root.innerHTML = `
      <section class="panel player-hub-hero">
        <div class="player-hub-main">
          <div class="player-hub-photo">${p.photo ? `<img src="${safeUrl(p.photo)}" alt="">` : '<span>👤</span>'}</div>
          <div class="player-hub-copy">
            <span>PLAYER HUB · ТЕКУЩИЙ МАТЧ</span>
            <h2>${escapeHtml(p.name || 'Игрок')}</h2>
            <p>${escapeHtml(team.name || 'Команда')} · ${escapeHtml(playerPositionLabel(p.position))}</p>
          </div>
          <div class="player-hub-rating"><span>Рейтинг</span><strong>${rating}</strong></div>
        </div>
        <div class="player-hub-match">
          <span>${escapeHtml(match.league || '')}</span>
          <strong>${escapeHtml(match.home?.name || '')} — ${escapeHtml(match.away?.name || '')}</strong>
          <small>${escapeHtml(match.statusLabel || '')}</small>
        </div>
        <div class="player-hub-actions">
          ${playerFollowModule.controlHtml(player)}
          <button class="btn secondary" type="button" data-player-comparison-open>⚖️ Сравнить</button>
        </div>
      </section>
  
      ${player.comparison?.open ? playerComparisonHtml({
        primary:player,
        secondary:player.comparison?.secondary || null,
        candidates:playerComparisonCandidatesFor(player),
        loading:Boolean(player.comparison?.loading),
        error:String(player.comparison?.error || ''),
      }) : ''}
  
      ${playerSquadProfileHtml(player.squadProfile || {})}
      ${playerSeasonStatsHtml(player.seasonStats || {})}
  
      <section class="panel">
        <div class="center-section-title"><div><h2>Показатели в матче</h2><p>Только данные, уже полученные для этого матча</p></div></div>
        <div class="player-hub-metrics">
          ${playerHubMetric('Минуты', Number(p.minutes || 0))}
          ${playerHubMetric('Голы', Number(p.goals || 0))}
          ${playerHubMetric('Ассисты', Number(p.assists || 0))}
          ${playerHubMetric('Удары в створ', Number(p.shotsOn || 0))}
          ${playerHubMetric('Ключевые передачи', Number(p.keyPasses || 0))}
          ${playerHubMetric('Отборы', Number(p.tackles || 0))}
          ${playerHubMetric('Перехваты', Number(p.interceptions || 0))}
          ${playerHubMetric('Сейвы', Number(p.saves || 0))}
        </div>
      </section>
  
      <section class="panel player-hub-context">
        <div class="center-section-title"><div><h2>Роль в текущем матче</h2><p>Краткий контекст без дополнительного запроса к источнику</p></div></div>
        <div class="player-hub-context-grid">
          <div><span>Позиция</span><strong>${escapeHtml(playerPositionLabel(p.position))}</strong></div>
          <div><span>Impact</span><strong>${Number.isFinite(Number(p.impact)) ? Number(p.impact).toFixed(1) : '—'}</strong></div>
          <div><span>Команда</span><strong>${escapeHtml(team.name || '—')}</strong></div>
          <div><span>Источник</span><strong>данные матча</strong></div>
        </div>
        <p class="tiny">Контекст матча остаётся независимым от сезонной выборки: если сезонные данные ограничены квотой или покрытием, текущая статистика игрока продолжает отображаться.</p>
      </section>
    `;
    bindPlayerComparisonActions(player, playerComparisonCandidatesFor(player));
    playerFollowModule.bind(root, player);
  }
  
  function openPlayerFromMatch(playerId, side = '') {
    const center = state.currentCenter || {};
    const match = center.match || {};
    const key = side === 'away' ? 'away' : 'home';
    const player = (center.playerLeaders?.[key] || []).find(item => Number(item.id || 0) === Number(playerId || 0));
    if (!player) return toast('Данные игрока для этого матча уже недоступны.');
    const current = activeViewId();
    if (current !== 'playerView') state.playerBackView = current || 'analysisView';
    state.currentPlayer = {
      data: { ...player },
      team: { ...(match[key] || {}) },
      match: { ...match },
      source: 'match_center',
    };
    renderPlayerHub();
    sendProductAction('player_open', current || 'analysisView');
    showView('playerView');
    if (!state.favoritePlayersLoaded && !state.favoritePlayersLoading) void loadFavoritePlayers();
    void loadPlayerSquadProfile(state.currentPlayer);
    void loadPlayerSeasonStats(state.currentPlayer);
  }

  return {
    playerPositionLabel,
    playerHubMetric,
    playerSquadProfile,
    playerSquadProfileHtml,
    loadPlayerSquadProfile,
    playerSeasonStatProfile,
    playerSeasonStatsHtml,
    loadPlayerSeasonStats,
    playerComparisonSquadSources,
    enrichPlayerComparisonCandidate,
    playerComparisonCandidatesFor,
    hydrateComparisonPlayer,
    bindPlayerComparisonActions,
    renderPlayerHub,
    openPlayerFromMatch,
  };
}
