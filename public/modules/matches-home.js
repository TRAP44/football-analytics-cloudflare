export function createMatchesHomeModule(deps = {}) {
  const {
    $,
    MATCH_SNAPSHOT_MAX_AGE_MS,
    MATCH_SNAPSHOT_PREFIX,
    MATCH_WATCHLIST_KEY,
    analyzeMatch,
    api,
    apiErrorCategory,
    bindCooldownRetry,
    dateTime,
    escapeHtml,
    favoriteSet,
    friendlyErrorMessage,
    hasReminder,
    isAdmin,
    isFavorite,
    localDate,
    openHistoryAnalysis,
    openMatchCenter,
    openTeam,
    openTournament,
    reminderFor,
    renderDiscoveryHome,
    renderGlobalSearch,
    renderProvider,
    russianCountLabel,
    safeUrl,
    sendActionError,
    showView,
    state,
    storageGet,
    storageRemove,
    storageSet,
    timeOf,
    toast,
    toggleFavorite,
    toggleReminder,
  } = deps;

  function matchSkeletonHtml(count = 4) {
    return `<div class="skeleton-stack" aria-hidden="true">${Array.from({ length: count }, () => '<div class="skeleton-card"><i></i><b></b><b></b><span></span></div>').join('')}</div>`;
  }
  
  function matchSnapshotKey(date) { return `${MATCH_SNAPSHOT_PREFIX}${date}`; }
  
  function readMatchSnapshot(date) {
    try {
      const raw = storageGet(matchSnapshotKey(date));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.savedAt || Date.now() - Number(parsed.savedAt) > MATCH_SNAPSHOT_MAX_AGE_MS) {
        storageRemove(matchSnapshotKey(date));
        return null;
      }
      return parsed;
    } catch { return null; }
  }
  
  function writeMatchSnapshot(date, data) {
    try {
      storageSet(matchSnapshotKey(date), JSON.stringify({
        savedAt: Date.now(),
        matches: data.matches || [],
        refreshedAt: data.refreshedAt || new Date().toISOString(),
        stale: Boolean(data.stale),
        warning: data.warning || '',
        retryAfter: Number(data.retryAfter || 0),
        catalog: data.catalog || {},
        integrity: data.integrity || null,
      }));
    } catch {}
  }
  
  function applyMatchPayload(data, { snapshot = false, refreshing = false } = {}) {
    state.matches = data.matches || [];
    state.matchesMeta = {
      refreshedAt: data.refreshedAt || null,
      stale: Boolean(data.stale || snapshot),
      warning: data.warning || '',
      retryAfter: Number(data.retryAfter || 0),
      catalog: data.catalog || {},
      integrity: data.integrity || null,
      localSnapshot: snapshot,
      refreshing: Boolean(refreshing),
    };
    if (isAdmin() && data.provider?.visibility === 'admin') { state.provider = data.provider; renderProvider(); }
    if (state.filter === 'top' && !state.matches.some(x => personalMatchInsight(x).recommended)) state.filter = 'all';
    syncFilterButtons();
    renderMatches();
    renderDiscoveryHome();
    $('matches')?.setAttribute('aria-busy', 'false');
  }
  
  async function loadMatches(options = {}) {
    const force = Boolean(options.force);
    const silent = Boolean(options.silent);
    const snapshotFastPath = Boolean(options.snapshotFastPath);
    const seq = ++state.matchesLoadSeq;
    const date = localDate(state.offset);
    const labels = { '-1': 'Матчи вчера', '0': 'Матчи сегодня', '1': 'Матчи завтра' };
    $('matchesTitle').textContent = labels[String(state.offset)] || 'Матчи';
  
    const fallbackSnapshot = readMatchSnapshot(date);
    const snapshot = !force ? fallbackSnapshot : null;
    const canReuseCurrent = Boolean(state.matches.length && state.matchesMeta?.date === date);
  
    if (snapshot && !canReuseCurrent) {
      applyMatchPayload(snapshot, { snapshot: true, refreshing: true });
      state.matchesMeta.date = date;
    } else if (canReuseCurrent) {
      state.matchesMeta.refreshing = true;
      renderMatches();
      $('matches')?.setAttribute('aria-busy', 'false');
    } else if (!silent) {
      state.matches = [];
      $('matches')?.setAttribute('aria-busy', 'true');
      $('matches').innerHTML = matchSkeletonHtml();
      $('matchesCount').textContent = '';
      if ($('dataNotice')) $('dataNotice').innerHTML = '';
    }
  
    const refresh = async () => {
      try {
        const data = await api(`/api/matches?date=${date}`, {
        timeoutMs: 6500,
        retry: false,
      });
      if (seq !== state.matchesLoadSeq) return;
      data.refreshedAt ||= new Date().toISOString();
      writeMatchSnapshot(date, data);
      applyMatchPayload(data, { snapshot: false, refreshing: false });
      state.matchesMeta.date = date;
    } catch (e) {
      if (seq !== state.matchesLoadSeq) return;
      sendActionError('matches', e, 'matchesView');
      const retry = Number(e.payload?.retryAfter || 0);
      const category = apiErrorCategory(e);
      const staleWarning = category === 'rate_limit'
        ? 'Источник матчей временно ограничил обновления. Показана последняя сохранённая версия.'
        : 'Не удалось обновить данные. Показана последняя сохранённая версия.';
      if (state.matches.length && state.matchesMeta?.date === date) {
        state.matchesMeta.stale = true;
        state.matchesMeta.refreshing = false;
        state.matchesMeta.warning = staleWarning;
        state.matchesMeta.retryAfter = retry;
        renderMatches();
        $('matches')?.setAttribute('aria-busy', 'false');
        return;
      }
      if (Array.isArray(fallbackSnapshot?.matches) && fallbackSnapshot.matches.length) {
        applyMatchPayload({
          ...fallbackSnapshot,
          stale:true,
          warning:staleWarning,
          retryAfter:retry,
        }, { snapshot:true, refreshing:false });
        state.matchesMeta.date = date;
        return;
      }
      const publicMessage = category === 'rate_limit'
        ? 'Источник матчей временно занят. Новая попытка станет доступна после короткой паузы.'
        : friendlyErrorMessage(e);
      $('matches').innerHTML = `<div class="empty error-state"><strong>Матчи сейчас не обновились</strong><span>${escapeHtml(publicMessage)}</span><button id="matchesRetryBtn" class="secondary-btn" type="button">Повторить</button></div>`;
      bindCooldownRetry(
        $('matchesRetryBtn'),
        category === 'rate_limit' ? retry : 0,
        () => loadMatches({ force: true }),
      );
      $('matches')?.setAttribute('aria-busy', 'false');
    }
    };
  
    // Repeat launches can paint a recent local snapshot immediately while the
    // normal network refresh continues in the background. First launch, force
    // refresh and snapshot misses keep the existing blocking semantics.
    if (snapshotFastPath && snapshot && !force) {
      void refresh();
      return;
    }
  
    await refresh();
  }
  function syncFilterButtons() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
      const active = btn.dataset.filter === state.filter;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const drawer = document.querySelector('.league-filter-drawer');
    if (drawer) {
      const drawerFilters = ['favorites', 'international', 'cups', 'england', 'spain', 'italy', 'germany', 'france'];
      const activeDrawerFilter = drawerFilters.includes(state.filter);
      drawer.classList.toggle('has-active-filter', activeDrawerFilter);
      const summaryValue = drawer.querySelector('[data-filter-summary-value]');
      const labels = {
        favorites: 'Избранное',
        international: 'Международные',
        cups: 'Кубки',
        england: 'Англия',
        spain: 'Испания',
        italy: 'Италия',
        germany: 'Германия',
        france: 'Франция',
      };
      if (summaryValue) {
        summaryValue.textContent = activeDrawerFilter ? labels[state.filter] : '';
        summaryValue.hidden = !activeDrawerFilter;
      }
    }
  }
  
  function normalizedSignalText(value) {
    return String(value || '').trim().toLocaleLowerCase('ru-RU');
  }
  
  function personalContextSignals() {
    const viewedTeams = new Set();
    const viewedLeagues = new Set();
    for (const item of state.history.slice(0, 20)) {
      const home = normalizedSignalText(item.homeName);
      const away = normalizedSignalText(item.awayName);
      const league = normalizedSignalText(item.leagueName);
      if (home) viewedTeams.add(home);
      if (away) viewedTeams.add(away);
      if (league) viewedLeagues.add(league);
    }
    return {
      favoriteTeams: favoriteSet(),
      viewedTeams,
      viewedLeagues,
      hasPersonalData: state.favorites.length > 0 || viewedTeams.size > 0,
    };
  }
  
  function personalMatchInsight(match, signals = personalContextSignals()) {
    const homeId = Number(match.home?.id || 0);
    const awayId = Number(match.away?.id || 0);
    const homeName = normalizedSignalText(match.home?.name);
    const awayName = normalizedSignalText(match.away?.name);
    const leagueName = normalizedSignalText(match.league || match.leagueOriginal);
    const favorite = signals.favoriteTeams.has(homeId) || signals.favoriteTeams.has(awayId);
    const viewedTeam = signals.viewedTeams.has(homeName) || signals.viewedTeams.has(awayName);
    const viewedLeague = signals.viewedLeagues.has(leagueName);
    let score = Math.min(34, Number(match.interestScore || 0) * .34) + Math.min(26, Number(match.competition?.priority || 0) * 3);
    if (favorite) score += 150;
    if (viewedTeam) score += 72;
    else if (viewedLeague) score += 18;
    if (match.live) score += 48;
    if (match.featured) score += 34;
    if (match.lowPriority) score -= 55;
    if (match.youthReserve) score -= 80;
  
    let reason = '';
    if (favorite) reason = 'Любимая команда';
    else if (viewedTeam) reason = 'Вы смотрели эту команду';
    else if (match.live) reason = 'Сейчас в эфире';
    else if (match.featured) reason = 'Главный матч';
    else if (viewedLeague) reason = 'Знакомый турнир';
    else if (Number(match.interestScore || 0) >= 80) reason = 'Высокий интерес';
  
    const baseline = Boolean(match.featured) || (Number(match.interestScore || 0) >= 68 && !match.lowPriority);
    const recommended = signals.hasPersonalData
      ? Boolean(favorite || viewedTeam || match.live || match.featured || (!match.lowPriority && Number(match.interestScore || 0) >= 74))
      : baseline;
    return { score, reason, favorite, viewedTeam, viewedLeague, recommended };
  }
  
  function homePersonalMatch(signals = personalContextSignals(), nowMs = Date.now()) {
    if (!signals.hasPersonalData) return null;
    const rows = state.matches
      .filter(match => !match.finished && !match.youthReserve)
      .map(match => ({ match, insight:personalMatchInsight(match, signals) }))
      .filter(item => item.insight.favorite || item.insight.viewedTeam)
      .sort((a, b) => {
        if (Boolean(a.match.live) !== Boolean(b.match.live)) return a.match.live ? -1 : 1;
        const scoreDelta = Number(b.insight.score || 0) - Number(a.insight.score || 0);
        if (scoreDelta) return scoreDelta;
        const aDate = Date.parse(a.match.date || '') || Number.POSITIVE_INFINITY;
        const bDate = Date.parse(b.match.date || '') || Number.POSITIVE_INFINITY;
        const aFuture = aDate >= nowMs ? 0 : 1;
        const bFuture = bDate >= nowMs ? 0 : 1;
        if (aFuture !== bFuture) return aFuture - bFuture;
        return aDate - bDate;
      });
    return rows[0] || null;
  }
  
  function homePersonalMatchMeta(item) {
    if (!item) return '';
    const match = item.match;
    const reason = item.insight.favorite ? 'Любимая команда' : 'Вы смотрели эту команду';
    const status = match.live ? 'LIVE' : timeOf(match.date);
    return [reason, status, match.league || ''].filter(Boolean).join(' · ');
  }
  
  function watchedMatch(fixtureId) {
    const id = Number(fixtureId || 0);
    return id > 0 ? state.watchlist.find(item => Number(item.fixtureId) === id) || null : null;
  }
  
  function isWatchedMatch(fixtureId) {
    return Boolean(watchedMatch(fixtureId));
  }
  
  function matchWatchlistSnapshot(match = {}) {
    return {
      fixtureId: Number(match.fixtureId || 0),
      homeName: String(match.home?.name || '').trim(),
      awayName: String(match.away?.name || '').trim(),
      league: String(match.league || '').trim(),
      date: String(match.date || '').trim(),
      homeId: Number(match.home?.id || 0),
      awayId: Number(match.away?.id || 0),
      homeLogo: String(match.home?.logo || '').trim(),
      awayLogo: String(match.away?.logo || '').trim(),
      addedAt: new Date().toISOString(),
    };
  }
  
  function persistMatchWatchlist() {
    try {
      localStorage.setItem(MATCH_WATCHLIST_KEY, JSON.stringify(state.watchlist.slice(0, 50)));
    } catch {}
  }
  
  function toggleMatchWatch(match = {}) {
    const fixtureId = Number(match.fixtureId || 0);
    if (!fixtureId || match.finished) return;
    if (isWatchedMatch(fixtureId)) {
      state.watchlist = state.watchlist.filter(item => Number(item.fixtureId) !== fixtureId);
      persistMatchWatchlist();
      toast('Матч удалён из слежения');
    } else {
      const snapshot = matchWatchlistSnapshot(match);
      if (!snapshot.homeName || !snapshot.awayName) return;
      state.watchlist = [snapshot, ...state.watchlist.filter(item => Number(item.fixtureId) !== fixtureId)].slice(0, 50);
      persistMatchWatchlist();
      toast('Матч добавлен в слежение');
    }
    renderMatches();
  }
  
  function radarFeedItems(nowMs = Date.now()) {
    const favoriteIds = favoriteSet();
    const viewed = personalContextSignals();
    const rows = [];
  
    for (const match of state.matches) {
      if (!match || match.youthReserve) continue;
      const fixtureId = Number(match.fixtureId || 0);
      if (!fixtureId) continue;
  
      const homeId = Number(match.home?.id || 0);
      const awayId = Number(match.away?.id || 0);
      const favorite = favoriteIds.has(homeId) || favoriteIds.has(awayId);
      const homeName = normalizedSignalText(match.home?.name);
      const awayName = normalizedSignalText(match.away?.name);
      const viewedTeam = viewed.viewedTeams.has(homeName) || viewed.viewedTeams.has(awayName);
      const reminder = reminderFor(fixtureId);
      const history = analysisHistoryForFixture(fixtureId);
      const watched = isWatchedMatch(fixtureId);
      const kickoffMs = Date.parse(match.date || '');
      const hoursToKickoff = Number.isFinite(kickoffMs) ? (kickoffMs - nowMs) / 3600000 : Infinity;
  
      let item = null;
      if (match.live && (watched || favorite || viewedTeam)) {
        item = {
          priority: watched ? 126 : favorite ? 120 : 105,
          tone: 'live',
          kicker: watched ? 'LIVE · ВЫ СЛЕДИТЕ' : favorite ? 'LIVE · ЛЮБИМАЯ КОМАНДА' : 'LIVE · ВЫ СМОТРЕЛИ',
          title: `${match.home?.name || ''} — ${match.away?.name || ''}`,
          meta: `${match.score?.home ?? 0} : ${match.score?.away ?? 0}${Number(match.elapsed || 0) ? ` · ${Number(match.elapsed)}′` : ''}${match.league ? ` · ${match.league}` : ''}`,
          action: 'center',
          fixtureId,
        };
      } else if (!match.finished && history && (watched || favorite || viewedTeam)) {
        item = {
          priority: watched ? 98 : favorite ? 92 : 82,
          tone: 'ai',
          kicker: 'AI-РАЗБОР ГОТОВ',
          title: `${match.home?.name || ''} — ${match.away?.name || ''}`,
          meta: [history.aiSignalLabel || 'Сохранённый разбор', Number(history.aiConfidence || 0) ? `уверенность ${Math.round(Number(history.aiConfidence))}/100` : '', timeOf(match.date)].filter(Boolean).join(' · '),
          action: 'history',
          fixtureId,
        };
      } else if (!match.finished && reminder && hoursToKickoff >= 0 && hoursToKickoff <= 24) {
        item = {
          priority: watched ? 84 : favorite ? 78 : 68,
          tone: 'reminder',
          kicker: 'НАПОМИНАНИЕ ВКЛЮЧЕНО',
          title: `${match.home?.name || ''} — ${match.away?.name || ''}`,
          meta: `${dateTime(match.date)} · за ${Number(reminder.remindBeforeMinutes || state.preferences?.reminderMinutes || 30)} мин.`,
          action: 'center',
          fixtureId,
        };
      } else if (!match.finished && watched && hoursToKickoff >= 0 && hoursToKickoff <= 24) {
        item = {
          priority: 74 - Math.min(14, Math.max(0, hoursToKickoff * .5)),
          tone: 'watching',
          kicker: 'СЛЕЖУ ЗА МАТЧЕМ',
          title: `${match.home?.name || ''} — ${match.away?.name || ''}`,
          meta: [dateTime(match.date), match.league || ''].filter(Boolean).join(' · '),
          action: 'center',
          fixtureId,
        };
      } else if (!match.finished && favorite && hoursToKickoff >= 0 && hoursToKickoff <= 6) {
        item = {
          priority: 64 - Math.min(18, Math.max(0, hoursToKickoff * 3)),
          tone: 'soon',
          kicker: 'СКОРО · ЛЮБИМАЯ КОМАНДА',
          title: `${match.home?.name || ''} — ${match.away?.name || ''}`,
          meta: [timeOf(match.date), match.league || ''].filter(Boolean).join(' · '),
          action: 'center',
          fixtureId,
        };
      }
  
      if (item) rows.push(item);
    }
  
    return rows
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
      .slice(0, 4);
  }
  
  function renderRadarFeed() {
    const wrap = $('radarFeedWrap');
    const list = $('radarFeedList');
    const meta = $('radarFeedMeta');
    if (!wrap || !list) return;
  
    const rows = radarFeedItems();
    if (!rows.length) {
      wrap.hidden = true;
      list.innerHTML = '';
      if (meta) meta.textContent = '';
      return;
    }
  
    wrap.hidden = false;
    if (meta) meta.textContent = russianCountLabel(rows.length, 'сигнал', 'сигнала', 'сигналов');
    list.innerHTML = rows.map(item => `
      <button class="radar-feed-item tone-${escapeHtml(item.tone || 'neutral')}" type="button"
        data-radar-fixture="${Number(item.fixtureId)}"
        data-radar-action="${escapeHtml(item.action || 'center')}">
        <span class="radar-feed-pulse" aria-hidden="true"></span>
        <span class="radar-feed-copy">
          <small>${escapeHtml(item.kicker || '')}</small>
          <strong>${escapeHtml(item.title || '')}</strong>
          <em>${escapeHtml(item.meta || '')}</em>
        </span>
        <b aria-hidden="true">→</b>
      </button>`).join('');
  
    list.querySelectorAll('[data-radar-fixture]').forEach(button => {
      button.addEventListener('click', () => {
        const fixtureId = Number(button.dataset.radarFixture || 0);
        if (!fixtureId) return;
        if (button.dataset.radarAction === 'history') {
          openHistoryAnalysis(fixtureId, button);
          return;
        }
        openMatchCenter(fixtureId, button);
      });
    });
  }
  
  function renderDailyOverview() {
    const root = $('dailyOverview');
    const personalCard = $('homePersonalMatchBtn');
    if (!root) return;
  
    const personalItem = homePersonalMatch();
  
    if (personalCard) {
      personalCard.hidden = !personalItem;
      personalCard.dataset.personalFixture = personalItem ? String(Number(personalItem.match.fixtureId || 0)) : '';
      personalCard.dataset.personalLive = personalItem?.match.live ? '1' : '0';
      const kicker = $('homePersonalMatchKicker');
      const text = $('homePersonalMatchText');
      const meta = $('homePersonalMatchMeta');
      if (kicker) kicker.textContent = personalItem?.match.live ? 'Для вас · LIVE' : 'Для вас';
      if (text) text.textContent = personalItem ? `${personalItem.match.home?.name || ''} — ${personalItem.match.away?.name || ''}` : 'Персональный матч';
      if (meta) meta.textContent = homePersonalMatchMeta(personalItem);
    }
    root.hidden = !personalItem;
  }
  function filteredMatches() {
    const q = state.search.trim().toLowerCase();
    const fav = favoriteSet();
    const prefs = state.preferences || {};
    const signals = personalContextSignals();
    const list = state.matches.filter(m => {
      const isFavMatch = fav.has(Number(m.home?.id)) || fav.has(Number(m.away?.id));
      if (prefs.hideYouth !== false && m.youthReserve && state.filter !== 'favorites') return false;
      let byFilter = state.filter === 'all';
      if (state.filter === 'top') byFilter = personalMatchInsight(m, signals).recommended;
      if (state.filter === 'live') byFilter = Boolean(m.live);
      if (state.filter === 'cups') byFilter = ['cup', 'continental', 'national', 'international'].includes(String(m.category || ''));
      if (state.filter === 'international') byFilter = ['continental', 'national', 'international'].includes(String(m.category || '')) || m.group === 'international';
      if (['england', 'spain', 'italy', 'germany', 'france'].includes(state.filter)) byFilter = m.group === state.filter;
      if (state.filter === 'favorites') byFilter = isFavMatch;
      if (!byFilter) return false;
      if (!q) return true;
      return [m.home?.name, m.away?.name, m.league, m.leagueOriginal, m.leagueShort, m.country, m.countryRaw, m.round, m.roundLabel]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q));
    });
    list.sort((a, b) => {
      const af = fav.has(Number(a.home?.id)) || fav.has(Number(a.away?.id)) ? 1 : 0;
      const bf = fav.has(Number(b.home?.id)) || fav.has(Number(b.away?.id)) ? 1 : 0;
      if (prefs.favoriteFirst !== false && state.filter !== 'favorites' && af !== bf) return bf - af;
      if (state.filter === 'top') {
        const personalDelta = personalMatchInsight(b, signals).score - personalMatchInsight(a, signals).score;
        if (personalDelta) return personalDelta;
      }
      if (Boolean(a.live) !== Boolean(b.live)) return a.live ? -1 : 1;
      if (Boolean(a.featured) !== Boolean(b.featured)) return a.featured ? -1 : 1;
      const ap = Number(a.competition?.priority || 0), bp = Number(b.competition?.priority || 0);
      if (ap !== bp) return bp - ap;
      const ai = Number(a.interestScore || 0), bi = Number(b.interestScore || 0);
      if (ai !== bi) return bi - ai;
      return String(a.date || '').localeCompare(String(b.date || ''));
    });
    return list;
  }
  
  function categoryLabel(category) {
    const labels = {
      league: 'Лига', cup: 'Кубок', continental: 'Еврокубок', national: 'Сборные', international: 'Международный',
      women: 'Женский футбол', friendly: 'Товарищеский', youth: 'Молодёжный', lower: 'Низшая лига',
    };
    return labels[String(category || '')] || '';
  }
  
  function matchCenter(m) {
    if ((m.finished || m.live) && m.score?.home !== null && m.score?.home !== undefined && m.score?.away !== null && m.score?.away !== undefined) {
      return `${m.score.home} : ${m.score.away}`;
    }
    if (m.live) return `${m.score?.home ?? 0} : ${m.score?.away ?? 0}`;
    return 'VS';
  }
  
  function renderPopularCompetitions() {
    const wrap = $('popularCompetitionsWrap');
    const el = $('popularCompetitions');
    if (!wrap || !el) return;
    const seen = new Set();
    const rows = state.matches
      .filter(m => Number(m.leagueId) > 0 && !m.youthReserve && !m.lowPriority)
      .sort((a, b) => {
        if (Boolean(a.live) !== Boolean(b.live)) return a.live ? -1 : 1;
        const ap = Number(a.competition?.priority || 0), bp = Number(b.competition?.priority || 0);
        if (ap !== bp) return bp - ap;
        return Number(b.interestScore || 0) - Number(a.interestScore || 0);
      })
      .filter(m => {
        const id = Number(m.leagueId);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .slice(0, 5);
    if (!rows.length) {
      wrap.hidden = true;
      el.innerHTML = '';
      return;
    }
    wrap.hidden = false;
    el.innerHTML = rows.map(m => `
      <button class="competition-shortcut" type="button" data-open-tournament="${Number(m.leagueId)}">
        ${m.leagueLogo ? `<img src="${safeUrl(m.leagueLogo)}" alt="">` : '<span class="competition-logo-placeholder">🏆</span>'}
        <span><strong>${escapeHtml(m.leagueShort || m.league || 'Турнир')}</strong><small>${escapeHtml(m.country || '')}</small></span>
        ${m.live ? '<b>ИДЁТ</b>' : ''}
      </button>`).join('');
    el.querySelectorAll('[data-open-tournament]').forEach(btn => btn.addEventListener('click', () => openTournament(Number(btn.dataset.openTournament))));
  }
  
  function favoriteStarSvg(active = false) {
    return `<svg class="fav-star-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3.7l2.55 5.17 5.71.83-4.13 4.03.98 5.69L12 16.73l-5.11 2.69.98-5.69-4.13-4.03 5.71-.83L12 3.7z"
        ${active ? 'fill="currentColor"' : 'fill="none"'} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>`;
  }
  
  function matchCardHtml(m, { grouped = false } = {}) {
    const aiHistory = analysisHistoryForFixture(m.fixtureId);
    const cardState = m.live ? 'is-live' : m.finished ? 'is-finished' : 'is-upcoming';
    const reminderActive = hasReminder(m.fixtureId);
    const reminderPending = state.reminderMutations.has(Number(m.fixtureId));
    const reminderMinutes = Number(state.preferences?.reminderMinutes || 30);
    const watchActive = isWatchedMatch(m.fixtureId);
    const liveMinute = Number(m.elapsed || 0) > 0 ? ` · ${Number(m.elapsed)}′` : '';
    const statusLabel = m.live
      ? `<b class="match-live-label">LIVE${liveMinute}</b>`
      : m.finished
        ? '<span class="match-finished-label">Завершён</span>'
        : `<span class="match-time-label">${escapeHtml(timeOf(m.date))}</span>`;
    const primaryAction = m.live
      ? `<button class="analyze-btn live-center-btn" type="button" data-center="${Number(m.fixtureId)}">Матч-центр</button>`
      : m.finished
        ? `<button class="analyze-btn finished-btn" type="button" data-center="${Number(m.fixtureId)}">Итоги матча</button>`
        : aiHistory
          ? `<button class="analyze-btn analyzed-btn" type="button" data-history-analysis="${Number(m.fixtureId)}">Открыть AI-разбор</button>`
          : `<button class="analyze-btn" type="button" data-fixture="${Number(m.fixtureId)}">Разобрать матч</button>`;
  
    const favoriteButton = team => { const active = isFavorite(team?.id); return `<button class="fav-star compact ${active ? 'active' : ''} ${state.favoriteMutations.has(Number(team?.id)) ? 'is-pending' : ''}" type="button" data-team-id="${Number(team?.id)}" data-team-name="${escapeHtml(team?.name || '')}" data-team-logo="${escapeHtml(team?.logo || '')}" aria-pressed="${active ? 'true' : 'false'}" aria-label="${active ? 'Удалить из избранного' : 'Добавить в избранное'}: ${escapeHtml(team?.name || '')}" ${state.favoriteMutations.has(Number(team?.id)) ? 'disabled' : ''}>${favoriteStarSvg(active)}</button>`; };
  
    return `
      <article class="match-card compact-match-card ${cardState}">
        <div class="match-card-topline">
          <span class="competition-name">${escapeHtml(m.league || 'Турнир')}</span>
          ${statusLabel}
        </div>
        <div class="compact-match-row">
          <button class="team-open-link compact-team" type="button" data-open-team="${Number(m.home?.id)}" data-team-name="${escapeHtml(m.home?.name || '')}" data-team-logo="${escapeHtml(m.home?.logo || '')}">
            ${m.home?.logo ? `<img src="${safeUrl(m.home.logo)}" alt="">` : '<span class="team-logo-fallback">⚽</span>'}
            <strong>${escapeHtml(m.home?.name || '')}</strong>
          </button>
          <div class="compact-score ${m.live ? 'score-live' : m.finished ? 'score-finished' : 'score-upcoming'}">${escapeHtml(matchCenter(m))}</div>
          <button class="team-open-link compact-team away" type="button" data-open-team="${Number(m.away?.id)}" data-team-name="${escapeHtml(m.away?.name || '')}" data-team-logo="${escapeHtml(m.away?.logo || '')}">
            ${m.away?.logo ? `<img src="${safeUrl(m.away.logo)}" alt="">` : '<span class="team-logo-fallback">⚽</span>'}
            <strong>${escapeHtml(m.away?.name || '')}</strong>
          </button>
        </div>
        <div class="match-card-actions compact-actions single">${primaryAction}</div>
        <div class="match-secondary-actions" aria-label="Дополнительные действия">
          <span>${favoriteButton(m.home)}${favoriteButton(m.away)}</span>
          ${!m.finished ? `<button class="match-watch-btn compact ${watchActive ? 'active' : ''}" type="button" data-watch-fixture="${Number(m.fixtureId)}" aria-pressed="${watchActive ? 'true' : 'false'}" aria-label="${watchActive ? 'Перестать следить за матчем' : 'Следить за матчем'}">${watchActive ? '👁 Слежу' : '👁 Следить'}</button>` : ''}
          ${!m.live && !m.finished ? `<button class="quick-reminder-btn compact ${reminderActive ? 'active' : ''} ${reminderPending ? 'is-pending' : ''}" type="button" data-quick-reminder="${Number(m.fixtureId)}" aria-pressed="${reminderActive ? 'true' : 'false'}" ${reminderPending ? 'disabled' : ''}>${reminderActive ? '🔔' : '🔕'} <span>${reminderActive ? 'Включено' : `${reminderMinutes} мин.`}</span></button>` : ''}
        </div>
      </article>`;
  }
  
  function bindMatchActions(root = document) {
    root.querySelectorAll('.analyze-btn[data-fixture]').forEach(btn => {
      btn.addEventListener('click', () => analyzeMatch(Number(btn.dataset.fixture), btn));
    });
    root.querySelectorAll('.analyze-btn[data-center]').forEach(btn => {
      btn.addEventListener('click', () => openMatchCenter(Number(btn.dataset.center), btn));
    });
    root.querySelectorAll('.analyze-btn[data-history-analysis]').forEach(btn => {
      btn.addEventListener('click', () => openHistoryAnalysis(Number(btn.dataset.historyAnalysis), btn));
    });
    root.querySelectorAll('.fav-star').forEach(btn => btn.addEventListener('click', () => toggleFavorite({
      id: Number(btn.dataset.teamId), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '',
    })));
    root.querySelectorAll('[data-watch-fixture]').forEach(btn => btn.addEventListener('click', () => {
      const fixtureId = Number(btn.dataset.watchFixture);
      const match = state.matches.find(item => Number(item.fixtureId) === fixtureId);
      if (match) toggleMatchWatch(match);
    }));
    root.querySelectorAll('[data-quick-reminder]').forEach(btn => btn.addEventListener('click', () => {
      const fixtureId = Number(btn.dataset.quickReminder);
      const match = state.matches.find(item => Number(item.fixtureId) === fixtureId);
      if (match) toggleReminder(match);
    }));
    root.querySelectorAll('[data-open-tournament]').forEach(btn => btn.addEventListener('click', () => openTournament(Number(btn.dataset.openTournament))));
    root.querySelectorAll('[data-open-team]').forEach(btn => btn.addEventListener('click', () => openTeam({ id: Number(btn.dataset.openTeam), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '' })));
  }
  
  
  function analysisHistoryForFixture(fixtureId) {
    const id = Number(fixtureId || 0);
    if (!id) return null;
    return state.history.find(item => Number(item.fixtureId) === id && item.aiSignalLabel) || null;
  }
  
  function renderAiCenterSummary() {
    const wrap = $('aiCenterSummary');
    if (!wrap) return;
    const upcoming = state.matches.filter(m => !m.live && !m.finished);
    const analyzed = upcoming.map(match => ({ match, history:analysisHistoryForFixture(match.fixtureId) })).filter(x => x.history);
    if (!analyzed.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
    const signals = analyzed.filter(x => x.history.aiSignalCode !== 'skip');
    const skips = analyzed.filter(x => x.history.aiSignalCode === 'skip');
    const highRisk = analyzed.filter(x => String(x.history.aiRisk || '').toLowerCase() === 'высокий');
    const strongest = [...signals].sort((a,b) => Number(b.history.aiConfidence || 0) - Number(a.history.aiConfidence || 0))[0] || null;
    const cautionPool = [...skips, ...highRisk.filter(x => !skips.some(s => Number(s.match.fixtureId) === Number(x.match.fixtureId)))];
    const caution = cautionPool.sort((a,b) => {
      const aSkip = a.history.aiSignalCode === 'skip' ? 1 : 0;
      const bSkip = b.history.aiSignalCode === 'skip' ? 1 : 0;
      return bSkip - aSkip || Number(a.history.aiConfidence || 0) - Number(b.history.aiConfidence || 0);
    })[0] || null;
    const featureButton = (item, kind) => {
      if (!item) return '';
      const h = item.history, m = item.match;
      const label = kind === 'caution' ? '⚠️ Лучше пропустить' : '🧠 Сильнейший разбор';
      const featureClass = kind === 'caution' ? 'ai-center-feature caution' : 'ai-center-feature';
      const detail = kind === 'caution'
        ? `${escapeHtml(h.aiSignalLabel || 'Высокий риск')} · ${escapeHtml(h.aiRisk || 'риск повышен')}`
        : `${escapeHtml(h.aiSignalLabel || 'AI-разбор')} · уверенность ${Math.round(Number(h.aiConfidence || 0))}/100`;
      return `<button class="${featureClass}" type="button" data-ai-center-history="${Number(m.fixtureId)}"><span>${label}</span><strong>${escapeHtml(m.home?.name || '')} — ${escapeHtml(m.away?.name || '')}</strong><small>${detail}</small></button>`;
    };
    wrap.hidden = false;
    wrap.innerHTML = `<div class="ai-center-head"><div><span>AI-ЦЕНТР</span><strong>Уже разобранные матчи</strong></div><small>Повторное открытие не тратит новый анализ</small></div><div class="ai-center-metrics"><div><b>${signals.length}</b><span>сигналов</span></div><div><b>${skips.length}</b><span>лучше пропустить</span></div><div><b>${highRisk.length}</b><span>высокий риск</span></div></div><div class="ai-center-features">${featureButton(strongest,'strong')}${featureButton(caution,'caution')}</div>`;
    wrap.querySelectorAll('[data-ai-center-history]').forEach(button => button.addEventListener('click', event => openHistoryAnalysis(Number(event.currentTarget.dataset.aiCenterHistory), event.currentTarget)));
  }
  function renderAiFocus() {
    const wrap = $('aiFocus');
    if (!wrap) return;
    const signals = personalContextSignals();
    const candidates = state.matches
      .filter(m => !m.live && !m.finished && !m.youthReserve)
      .map(m => ({ match:m, insight:personalMatchInsight(m, signals) }))
      .sort((a,b) => b.insight.score - a.insight.score || Number(b.match.interestScore || 0) - Number(a.match.interestScore || 0));
    if (!candidates.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
    const preferred = candidates.filter(x => x.insight.recommended);
    const ranked = (preferred.length ? preferred : candidates).slice(0,3);
    const rowHtml = (item, index) => {
      const m = item.match;
      const saved = analysisHistoryForFixture(m.fixtureId);
      const reason = item.insight.reason || (m.featured ? 'Главный матч дня' : Number(m.interestScore || 0) >= 75 ? 'Высокий интерес' : 'Подходит по контексту');
      const action = saved
        ? `<button type="button" data-ai-rank-history="${Number(m.fixtureId)}">Открыть разбор</button>`
        : `<button type="button" data-ai-rank-fixture="${Number(m.fixtureId)}" data-ai-focus-fixture="${Number(m.fixtureId)}">Разобрать</button>`;
      return `<article class="ai-rank-row"><b class="ai-rank-number">${index + 1}</b><div class="ai-rank-teams">${m.home?.logo ? `<img src="${safeUrl(m.home.logo)}" alt="">` : '<span>⚽</span>'}<div><strong>${escapeHtml(m.home?.name || '')} — ${escapeHtml(m.away?.name || '')}</strong><small>${escapeHtml(reason)} · ${timeOf(m.date)}${m.league ? ` · ${escapeHtml(m.league)}` : ''}</small></div>${m.away?.logo ? `<img src="${safeUrl(m.away.logo)}" alt="">` : '<span>⚽</span>'}</div>${action}</article>`;
    };
    wrap.hidden = false;
    wrap.innerHTML = `<div class="ai-rank-head"><div><span>AI-РЕЙТИНГ ДНЯ</span><strong>Матчи, которые заслуживают внимания</strong></div><small>Рейтинг по интересу, избранному и вашей истории. Это ещё не прогноз исхода. Полный вывод появится после анализа.</small></div><div class="ai-rank-list">${ranked.map(rowHtml).join('')}</div>`;
    wrap.querySelectorAll('[data-ai-rank-fixture]').forEach(button => button.addEventListener('click', event => analyzeMatch(Number(event.currentTarget.dataset.aiRankFixture), event.currentTarget)));
    wrap.querySelectorAll('[data-ai-rank-history]').forEach(button => button.addEventListener('click', event => openHistoryAnalysis(Number(event.currentTarget.dataset.aiRankHistory), event.currentTarget)));
  }
  function homeMatchSections(list, nowMs = Date.now()) {
    const soonWindowMs = 3 * 60 * 60 * 1000;
    const sections = [
      { key:'live', label:'Сейчас идут', tone:'live', matches:[] },
      { key:'soon', label:'Скоро начнутся', tone:'soon', matches:[] },
      { key:'later', label:'Позже', tone:'later', matches:[] },
      { key:'finished', label:'Завершённые', tone:'finished', matches:[] },
    ];
    for (const match of list) {
      if (match.live) {
        sections[0].matches.push(match);
        continue;
      }
      if (match.finished) {
        sections[3].matches.push(match);
        continue;
      }
      const kickoffMs = Date.parse(match.date || '');
      const startsInMs = Number.isFinite(kickoffMs) ? kickoffMs - nowMs : Number.POSITIVE_INFINITY;
      if (startsInMs >= 0 && startsInMs <= soonWindowMs) sections[1].matches.push(match);
      else sections[2].matches.push(match);
    }
    return sections.filter(section => section.matches.length);
  }
  
  function homeMatchSectionsHtml(list) {
    return homeMatchSections(list).map(section => {
      const cards = section.matches.map(match => matchCardHtml(match)).join('');
      const count = section.matches.length;
      if (section.key === 'later' || section.key === 'finished') {
        return `
          <details class="home-match-section home-match-section--${section.tone} is-collapsible" data-home-match-section="${section.key}">
            <summary class="home-match-section-head">
              <strong>${escapeHtml(section.label)}</strong>
              <span>${count}</span>
            </summary>
            <div class="home-match-section-list home-match-section-list--collapsed">
              ${cards}
            </div>
          </details>
        `;
      }
      return `
        <section class="home-match-section home-match-section--${section.tone}" data-home-match-section="${section.key}">
          <div class="home-match-section-head">
            <strong>${escapeHtml(section.label)}</strong>
            <span>${count}</span>
          </div>
          <div class="home-match-section-list">
            ${cards}
          </div>
        </section>
      `;
    }).join('');
  }
  
  function renderMatches() {
    const list = filteredMatches();
    const integrity = state.matchesMeta?.integrity || {};
    if ($('matchesCount')) $('matchesCount').textContent = '';
    renderDailyOverview();
    renderRadarFeed();
    renderAiFocus();
    renderAiCenterSummary();
    renderPopularCompetitions();
  
    if ($('dataNotice')) {
      const notices = [];
      if (state.matchesMeta?.stale && !state.matchesMeta?.refreshing) notices.push(`<div class="data-notice stale">⚠️ ${escapeHtml(state.matchesMeta.warning || 'Показаны последние сохранённые данные.')}</div>`);
      if (Number(integrity.quarantined || 0) > 0) notices.push('<div class="data-notice integrity-notice">Некоторые матчи временно скрыты, пока мы проверяем данные.</div>');
      $('dataNotice').innerHTML = notices.join('');
    }
  
    if (!list.length) {
      const filtered = state.filter !== 'all';
      const extra = filtered ? '<button id="showAllBtn" class="secondary-btn" type="button">Показать все матчи</button>' : '';
      $('matches').innerHTML = `<div class="empty match-empty-state">
        <strong>${filtered ? 'По этому фильтру матчей нет' : 'Матчей на эту дату пока нет'}</strong>
        <p>${filtered ? 'Снимите фильтр или найдите нужную команду через поиск.' : 'Попробуйте поиск по команде или выберите соседнюю дату.'}</p>
        <div class="empty-actions">${extra}<button id="matchesEmptySearch" class="primary-setting-btn" type="button">Найти матч</button></div>
      </div>`;
      $('showAllBtn')?.addEventListener('click', () => { state.filter = 'all'; syncFilterButtons(); renderMatches(); });
      $('matchesEmptySearch')?.addEventListener('click', () => {
        renderDiscoveryHome();
        renderGlobalSearch();
        showView('searchView');
        setTimeout(() => $('globalSearchInput')?.focus({ preventScroll: true }), 80);
      });
      return;
    }
  
    $('matches').innerHTML = homeMatchSectionsHtml(list);
    bindMatchActions($('matches'));
  }

  return {
    matchSkeletonHtml,
    matchSnapshotKey,
    readMatchSnapshot,
    writeMatchSnapshot,
    applyMatchPayload,
    loadMatches,
    syncFilterButtons,
    normalizedSignalText,
    personalContextSignals,
    personalMatchInsight,
    homePersonalMatch,
    homePersonalMatchMeta,
    watchedMatch,
    isWatchedMatch,
    matchWatchlistSnapshot,
    persistMatchWatchlist,
    toggleMatchWatch,
    radarFeedItems,
    renderRadarFeed,
    renderDailyOverview,
    filteredMatches,
    categoryLabel,
    matchCenter,
    renderPopularCompetitions,
    favoriteStarSvg,
    matchCardHtml,
    bindMatchActions,
    analysisHistoryForFixture,
    renderAiCenterSummary,
    renderAiFocus,
    homeMatchSections,
    homeMatchSectionsHtml,
    renderMatches,
  };
}
