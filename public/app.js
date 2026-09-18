const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor('secondary_bg_color'); } catch {}
}

const state = {
  profile: null,
  offset: 0,
  matches: [],
  history: [],
  favorites: [],
  reminders: [],
  preferences: { defaultFilter: 'top', reminderMinutes: 30, kickoffNotification: true, hideYouth: true, favoriteFirst: true },
  preferencesApplied: false,
  provider: null,
  filter: 'top',
  search: '',
  currentAnalysis: null,
  currentCenter: null,
  liveRefreshTimer: null,
  liveRefreshRemaining: 0,
};

const $ = id => document.getElementById(id);
const views = ['matchesView', 'analysisView', 'historyView', 'profileView'];

function stopLiveRefresh() {
  if (state.liveRefreshTimer) clearInterval(state.liveRefreshTimer);
  state.liveRefreshTimer = null;
  state.liveRefreshRemaining = 0;
}

function showView(id) {
  if (id !== 'analysisView') stopLiveRefresh();
  views.forEach(v => $(v).classList.toggle('active', v === id));
  $('navMatches').classList.toggle('active', id === 'matchesView' || id === 'analysisView');
  $('navHistory').classList.toggle('active', id === 'historyView');
  $('navProfile').classList.toggle('active', id === 'profileView');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
}

function localDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timeOf(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function dateTime(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function dateOnly(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(iso));
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (tg?.initData) headers.set('x-telegram-init-data', tg.initData);
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status, payload: data });
  return data;
}

async function loadProfile() {
  try {
    state.profile = await api('/api/me');
    if (state.profile?.preferences) {
      state.preferences = { ...state.preferences, ...state.profile.preferences };
      if (!state.preferencesApplied) {
        state.filter = state.preferences.defaultFilter || 'top';
        state.preferencesApplied = true;
        syncFilterButtons();
        if (state.matches.length) renderMatches();
      }
    }
    renderProfile();
  } catch (e) {
    toast(e.message);
  }
}

function renderProfile() {
  if (!state.profile) return;
  const { user, quota, stats = {} } = state.profile;
  $('profileBtn').textContent = quota.plan;
  $('quotaText').textContent = `Осталось анализов: ${quota.left} из ${quota.limit}`;
  $('profileName').textContent = user.firstName || 'Пользователь';
  $('profileUsername').textContent = user.username ? `@${user.username}` : `Telegram ID ${user.id}`;
  $('profilePlan').textContent = quota.plan;
  $('profileUsage').textContent = `${quota.used} / ${quota.limit}`;
  $('memberSince').textContent = user.createdAt ? `С нами с ${dateOnly(user.createdAt)}` : '';
  $('favoriteCount').textContent = String(stats.favorites ?? state.favorites.length);
  $('reminderCount').textContent = String(stats.reminders ?? state.reminders.length);
  const prefs = state.preferences || {};
  if ($('defaultFilterSelect')) $('defaultFilterSelect').value = prefs.defaultFilter || 'top';
  if ($('reminderMinutesSelect')) $('reminderMinutesSelect').value = String(prefs.reminderMinutes || 30);
  if ($('kickoffNotificationToggle')) $('kickoffNotificationToggle').checked = prefs.kickoffNotification !== false;
  if ($('hideYouthToggle')) $('hideYouthToggle').checked = prefs.hideYouth !== false;
  if ($('favoriteFirstToggle')) $('favoriteFirstToggle').checked = prefs.favoriteFirst !== false;
  renderFavoriteTeams();
  renderReminderList();
}

function renderProvider() {
  const p = state.provider || {};
  if (!$('providerPlan')) return;
  $('providerPlan').textContent = p.plan && p.plan !== 'UNKNOWN' ? p.plan : 'Определяется';
  $('providerDaily').textContent = Number.isFinite(Number(p.dailyRemaining)) && Number.isFinite(Number(p.dailyLimit))
    ? `${p.dailyRemaining} / ${p.dailyLimit}` : '—';
  $('providerMinute').textContent = Number.isFinite(Number(p.minuteRemaining)) && Number.isFinite(Number(p.minuteLimit))
    ? `${p.minuteRemaining} / ${p.minuteLimit}` : '—';
  $('providerLiveOdds').textContent = p.liveOddsReady ? 'Авто · включены' : 'Ожидают платный план';
}

async function loadProvider() {
  try {
    const data = await api('/api/provider');
    state.provider = data.provider || state.provider;
    renderProvider();
  } catch {}
}

async function loadFavorites() {
  try {
    const data = await api('/api/favorites');
    state.favorites = data.items || [];
    renderFavoriteTeams();
  } catch (e) {
    toast(e.message);
  }
}

async function loadReminders() {
  try {
    const data = await api('/api/reminders');
    state.reminders = data.items || [];
    renderReminderList();
  } catch (e) {
    toast(e.message);
  }
}

function renderReminderList() {
  const el = $('reminderList');
  if (!el) return;
  if (!state.reminders.length) {
    el.innerHTML = '<div class="empty compact-empty">Активных напоминаний пока нет.</div>';
    return;
  }
  const rows = [...state.reminders].sort((a, b) => Date.parse(a.fixtureDate || 0) - Date.parse(b.fixtureDate || 0));
  el.innerHTML = rows.map(x => `
    <div class="reminder-row">
      <div>
        <strong>${escapeHtml(x.homeName)} — ${escapeHtml(x.awayName)}</strong>
        <span>${dateTime(x.fixtureDate)} · за ${Number(x.remindBeforeMinutes || 30)} мин.${x.kickoffNotify ? ' · + старт' : ''}</span>
      </div>
      <button class="reminder-remove" type="button" data-fixture-id="${Number(x.fixtureId)}">Отключить</button>
    </div>`).join('');
  document.querySelectorAll('.reminder-remove').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api(`/api/reminders?fixtureId=${Number(btn.dataset.fixtureId)}`, { method: 'DELETE' });
      state.reminders = state.reminders.filter(x => Number(x.fixtureId) !== Number(btn.dataset.fixtureId));
      renderReminderList();
      if (state.currentAnalysis) renderAnalysis(state.currentAnalysis);
      await loadProfile();
      toast('Напоминание отключено');
    } catch (e) { toast(e.message); }
  }));
}

async function savePreferencesFromUi() {
  const payload = {
    defaultFilter: $('defaultFilterSelect')?.value || 'top',
    reminderMinutes: Number($('reminderMinutesSelect')?.value || 30),
    kickoffNotification: Boolean($('kickoffNotificationToggle')?.checked),
    hideYouth: Boolean($('hideYouthToggle')?.checked),
    favoriteFirst: Boolean($('favoriteFirstToggle')?.checked),
  };
  try {
    const data = await api('/api/preferences', { method: 'PUT', body: JSON.stringify(payload) });
    state.preferences = { ...state.preferences, ...(data.preferences || payload) };
    state.profile = state.profile ? { ...state.profile, preferences: state.preferences } : state.profile;
    state.filter = state.preferences.defaultFilter || state.filter;
    syncFilterButtons();
    renderMatches();
    renderProfile();
    toast('Настройки сохранены');
  } catch (e) { toast(e.message); }
}

function favoriteSet() {
  return new Set(state.favorites.map(x => Number(x.teamId)));
}

function isFavorite(teamId) {
  return favoriteSet().has(Number(teamId));
}

async function toggleFavorite(team) {
  const active = isFavorite(team.id);
  try {
    if (active) {
      await api(`/api/favorites?teamId=${Number(team.id)}`, { method: 'DELETE' });
      state.favorites = state.favorites.filter(x => Number(x.teamId) !== Number(team.id));
      toast(`${team.name}: удалено из избранного`);
    } else {
      const data = await api('/api/favorites', {
        method: 'POST',
        body: JSON.stringify({ teamId: Number(team.id), teamName: team.name, teamLogo: team.logo || '' }),
      });
      state.favorites = [data.item, ...state.favorites.filter(x => Number(x.teamId) !== Number(team.id))];
      toast(`${team.name}: добавлено в избранное`);
    }
    await loadProfile();
    renderMatches();
    renderFavoriteTeams();
  } catch (e) {
    toast(e.message);
  }
}

function renderFavoriteTeams() {
  const el = $('favoriteTeams');
  if (!el) return;
  if (!state.favorites.length) {
    el.innerHTML = '<div class="empty compact-empty">Добавьте любимые команды звёздочкой в списке матчей.</div>';
    return;
  }
  el.innerHTML = state.favorites.map(x => `
    <div class="favorite-team-row">
      <div class="favorite-team-main">
        ${x.teamLogo ? `<img src="${safeUrl(x.teamLogo)}" alt="">` : '<span class="team-placeholder">⚽</span>'}
        <strong>${escapeHtml(x.teamName)}</strong>
      </div>
      <button class="favorite-remove" type="button" data-team-id="${Number(x.teamId)}" data-team-name="${escapeHtml(x.teamName)}">Удалить</button>
    </div>
  `).join('');
  document.querySelectorAll('.favorite-remove').forEach(btn => btn.addEventListener('click', () => {
    const item = state.favorites.find(x => Number(x.teamId) === Number(btn.dataset.teamId));
    if (item) toggleFavorite({ id: item.teamId, name: item.teamName, logo: item.teamLogo });
  }));
}

async function loadMatches() {
  $('matches').innerHTML = '<div class="loader">Загружаю матчи…</div>';
  $('matchesCount').textContent = '';
  const labels = { '-1': 'Матчи вчера', '0': 'Матчи сегодня', '1': 'Матчи завтра' };
  $('matchesTitle').textContent = labels[String(state.offset)] || 'Матчи';
  try {
    const data = await api(`/api/matches?date=${localDate(state.offset)}`);
    state.matches = data.matches || [];
    if (data.provider) { state.provider = data.provider; renderProvider(); }
    if (state.filter === 'top' && !state.matches.some(x => Number(x.interestScore || 0) >= 50)) state.filter = 'all';
    syncFilterButtons();
    renderMatches();
  } catch (e) {
    $('matches').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

function syncFilterButtons() {
  document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === state.filter));
}

function filteredMatches() {
  const q = state.search.trim().toLowerCase();
  const fav = favoriteSet();
  const prefs = state.preferences || {};
  const list = state.matches.filter(m => {
    const isFavMatch = fav.has(Number(m.home?.id)) || fav.has(Number(m.away?.id));
    if (prefs.hideYouth !== false && m.youthReserve && state.filter !== 'favorites') return false;
    let byFilter = state.filter === 'all';
    if (state.filter === 'top') byFilter = Number(m.interestScore || 0) >= 50 && !m.youthReserve;
    if (['international', 'england', 'spain', 'italy', 'germany', 'france'].includes(state.filter)) byFilter = m.group === state.filter;
    if (state.filter === 'favorites') byFilter = isFavMatch;
    if (!byFilter) return false;
    if (!q) return true;
    return [m.home?.name, m.away?.name, m.league, m.country]
      .filter(Boolean)
      .some(v => String(v).toLowerCase().includes(q));
  });
  if (prefs.favoriteFirst !== false && state.filter !== 'favorites') {
    list.sort((a, b) => {
      const af = fav.has(Number(a.home?.id)) || fav.has(Number(a.away?.id)) ? 1 : 0;
      const bf = fav.has(Number(b.home?.id)) || fav.has(Number(b.away?.id)) ? 1 : 0;
      if (af !== bf) return bf - af;
      if (Boolean(a.live) !== Boolean(b.live)) return a.live ? -1 : 1;
      return Number(b.interestScore || 0) - Number(a.interestScore || 0);
    });
  }
  return list;
}

function matchCenter(m) {
  if (m.finished && m.score?.home !== null && m.score?.away !== null) return `${m.score.home} : ${m.score.away}`;
  if (m.live) {
    const minute = Number(m.elapsed || 0) > 0 ? ` · ${Number(m.elapsed)}′` : '';
    return `${m.score?.home ?? 0}:${m.score?.away ?? 0} · LIVE${minute}`;
  }
  return timeOf(m.date);
}

function interestLabel(score) {
  const n = Number(score || 0);
  if (n >= 80) return '🔥 Очень высокий';
  if (n >= 65) return '⭐ Высокий';
  if (n >= 45) return 'Средний';
  return 'Обычный';
}

function renderMatches() {
  const list = filteredMatches();
  $('matchesCount').textContent = `Показано: ${list.length} из ${state.matches.length}`;
  if (!list.length) {
    const extra = state.filter !== 'all' ? '<button id="showAllBtn" class="secondary-btn" type="button">Показать все матчи</button>' : '';
    $('matches').innerHTML = `<div class="empty">По выбранному фильтру матчей не найдено.${extra}</div>`;
    $('showAllBtn')?.addEventListener('click', () => { state.filter = 'all'; syncFilterButtons(); renderMatches(); });
    return;
  }

  $('matches').innerHTML = list.map(m => `
    <article class="match-card ${Number(m.interestScore || 0) >= 50 ? 'top-match' : ''}">
      <div class="match-meta">
        <span>${m.isTop ? '<b class="top-tag">TOP</b> ' : ''}${escapeHtml(m.league || 'Турнир')}</span>
        <span>${escapeHtml(m.country || '')}</span>
      </div>
      <div class="interest-row">
        <span>Индекс интереса</span>
        <strong>${Number(m.interestScore || 0)}/100 · ${interestLabel(m.interestScore)}</strong>
      </div>
      <div class="team-row">
        <div class="team">
          <button class="fav-star ${isFavorite(m.home?.id) ? 'active' : ''}" type="button" data-team-id="${Number(m.home?.id)}" data-team-name="${escapeHtml(m.home?.name || '')}" data-team-logo="${escapeHtml(m.home?.logo || '')}" aria-label="Избранное">${isFavorite(m.home?.id) ? '★' : '☆'}</button>
          ${m.home?.logo ? `<img src="${safeUrl(m.home.logo)}" alt="">` : ''}
          <strong>${escapeHtml(m.home?.name || '')}</strong>
        </div>
        <div class="kickoff ${m.live ? 'live-kickoff' : ''}">${escapeHtml(matchCenter(m))}</div>
        <div class="team away">
          <strong>${escapeHtml(m.away?.name || '')}</strong>
          ${m.away?.logo ? `<img src="${safeUrl(m.away.logo)}" alt="">` : ''}
          <button class="fav-star ${isFavorite(m.away?.id) ? 'active' : ''}" type="button" data-team-id="${Number(m.away?.id)}" data-team-name="${escapeHtml(m.away?.name || '')}" data-team-logo="${escapeHtml(m.away?.logo || '')}" aria-label="Избранное">${isFavorite(m.away?.id) ? '★' : '☆'}</button>
        </div>
      </div>
      ${m.live
        ? `<button class="analyze-btn live-center-btn" data-center="${Number(m.fixtureId)}">${m.youthReserve ? '🔴 LIVE-счёт' : '🔴 LIVE-центр'}</button>`
        : m.finished
          ? `<button class="analyze-btn finished-btn" data-center="${Number(m.fixtureId)}">📋 Итоги матча</button>`
          : `<button class="analyze-btn" data-fixture="${Number(m.fixtureId)}">🧠 Предматчевый анализ</button>`}
    </article>
  `).join('');

  document.querySelectorAll('.analyze-btn[data-fixture]').forEach(btn => {
    btn.addEventListener('click', () => analyzeMatch(Number(btn.dataset.fixture), btn));
  });
  document.querySelectorAll('.analyze-btn[data-center]').forEach(btn => {
    btn.addEventListener('click', () => openMatchCenter(Number(btn.dataset.center), btn));
  });
  document.querySelectorAll('.fav-star').forEach(btn => btn.addEventListener('click', () => toggleFavorite({
    id: Number(btn.dataset.teamId), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '',
  })));
}

function statValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  return escapeHtml(String(v));
}

function minuteLabel(event) {
  const base = Number(event.minute || 0);
  const extra = Number(event.extra || 0);
  return `${base}${extra > 0 ? `+${extra}` : ''}′`;
}

function liveEventsHtml(events = []) {
  if (!events.length) return '<div class="empty compact-empty">События пока не доступны для этого матча.</div>';
  return `<div class="live-events">${events.map(e => `
    <div class="live-event ${escapeHtml(e.side || '')}">
      <span class="event-minute">${minuteLabel(e)}</span>
      <div class="event-main">
        <strong>${escapeHtml(e.label || 'Событие')}</strong>
        <span>${escapeHtml(e.player || e.teamName || '')}${e.assist ? ` · ${escapeHtml(e.assist)}` : ''}</span>
      </div>
      <span class="event-team">${escapeHtml(e.teamName || '')}</span>
    </div>`).join('')}</div>`;
}

function liveStatsHtml(stats, match) {
  const items = stats?.items || [];
  if (!items.length) return '<div class="empty compact-empty">Детальная статистика недоступна для этого матча.</div>';
  return `<div class="live-stats">
    <div class="live-stat-head"><strong>${escapeHtml(match.home?.name || '')}</strong><span></span><strong>${escapeHtml(match.away?.name || '')}</strong></div>
    ${items.map(x => `<div class="live-stat-row"><strong>${statValue(x.home)}</strong><span>${escapeHtml(x.label)}</span><strong>${statValue(x.away)}</strong></div>`).join('')}
  </div>`;
}

function lineupLiveHtml(lineups, match) {
  const home = lineups?.home;
  const away = lineups?.away;
  if (!home && !away) return '<div class="empty compact-empty">Составы не опубликованы или не входят в покрытие турнира.</div>';
  return `<div class="data-grid">
    <div class="data-card"><span>${escapeHtml(match.home?.name || '')}</span><strong>${escapeHtml(home?.formation || '—')}</strong><p>${escapeHtml((home?.startXI || []).join(', ') || 'Нет стартового состава')}</p></div>
    <div class="data-card"><span>${escapeHtml(match.away?.name || '')}</span><strong>${escapeHtml(away?.formation || '—')}</strong><p>${escapeHtml((away?.startXI || []).join(', ') || 'Нет стартового состава')}</p></div>
  </div>`;
}

function updateLiveCountdown() {
  const el = $('liveRefreshText');
  if (!el || !state.currentCenter || state.currentCenter.mode !== 'live') return;
  el.textContent = `Автообновление через ${Math.max(0, state.liveRefreshRemaining)} сек.`;
}

function startLiveRefresh(fixtureId) {
  stopLiveRefresh();
  state.liveRefreshRemaining = Math.max(15, Number(state.currentCenter?.refreshSeconds || 60));
  updateLiveCountdown();
  state.liveRefreshTimer = setInterval(async () => {
    state.liveRefreshRemaining -= 1;
    updateLiveCountdown();
    if (state.liveRefreshRemaining <= 0) {
      state.liveRefreshRemaining = Math.max(15, Number(state.currentCenter?.refreshSeconds || 60));
      try {
        const data = await api(`/api/match-center?fixtureId=${Number(fixtureId)}&t=${Date.now()}`);
        state.currentCenter = data;
        renderMatchCenter(data);
        if (data.mode !== 'live') stopLiveRefresh();
      } catch (e) {
        state.liveRefreshRemaining = Math.max(15, Number(state.currentCenter?.refreshSeconds || 60));
        toast(e.message);
      }
    }
  }, 1000);
}

function renderMatchCenter(d) {
  state.currentCenter = d;
  if (d?.provider) { state.provider = d.provider; renderProvider(); }
  state.currentAnalysis = null;
  const m = d.match || {};
  const live = d.mode === 'live';
  const finished = d.mode === 'finished';
  const score = m.score || {};
  const scoreText = `${score.home ?? 0} : ${score.away ?? 0}`;
  $('analysis').innerHTML = `
    <section class="panel live-hero ${live ? 'is-live' : ''}">
      <div class="live-status-row">
        <span class="live-pill ${live ? 'active' : 'finished'}">${live ? '● LIVE' : finished ? '✓ ЗАВЕРШЁН' : 'МАТЧ'}</span>
        <span>${escapeHtml(m.statusLabel || m.status || '')}</span>
      </div>
      <div class="logos">
        ${m.home?.logo ? `<img src="${safeUrl(m.home.logo)}" alt="">` : ''}
        <strong class="live-score">${escapeHtml(scoreText)}</strong>
        ${m.away?.logo ? `<img src="${safeUrl(m.away.logo)}" alt="">` : ''}
      </div>
      <h2>${escapeHtml(m.home?.name || '')} — ${escapeHtml(m.away?.name || '')}</h2>
      <p>${escapeHtml(m.league || '')}${m.venue ? ` · ${escapeHtml(m.venue)}` : ''}</p>
      ${live ? `<p id="liveRefreshText" class="live-refresh-text">Автообновление через ${Number(d.refreshSeconds || 60)} сек.</p>` : `<p class="live-refresh-text">Данные матча сохранены в общем кэше.</p>`}
      <button id="centerRefreshBtn" class="reminder-btn" type="button">↻ Обновить сейчас</button>
    </section>

    ${d.note ? `<section class="panel"><p class="tiny warning">${escapeHtml(d.note)}</p></section>` : ''}

    ${live ? `<section class="panel provider-live-panel">
      <h2>📡 Источник LIVE</h2>
      <div class="provider-live-grid">
        <div><span>План данных</span><strong>${escapeHtml(d.provider?.plan || 'UNKNOWN')}</strong></div>
        <div><span>Обновление</span><strong>${Number(d.refreshSeconds || 60)} сек.</strong></div>
        <div><span>Live odds</span><strong>${d.liveOdds ? 'Доступны' : (d.provider?.liveOddsReady ? 'Нет рынка' : 'Платный режим')}</strong></div>
      </div>
    </section>` : ''}

    ${d.liveOdds ? `<section class="panel">
      <h2>💹 LIVE-коэффициенты 1X2</h2>
      <div class="odds-grid">
        <div><span>П1</span><strong>${d.liveOdds.odds?.home ?? '—'}</strong></div>
        <div><span>X</span><strong>${d.liveOdds.odds?.draw ?? '—'}</strong></div>
        <div><span>П2</span><strong>${d.liveOdds.odds?.away ?? '—'}</strong></div>
      </div>
      <p class="tiny">Источников в live-выборке: ${Number(d.liveOdds.sources || 0)}${d.liveOdds.updatedAt ? ` · обновление ${escapeHtml(String(d.liveOdds.updatedAt))}` : ''}</p>
    </section>` : ''}

    <section class="panel">
      <h2>📊 ${live ? 'LIVE-статистика' : 'Статистика матча'}</h2>
      <div style="margin-top:12px">${liveStatsHtml(d.statistics, m)}</div>
    </section>

    <section class="panel">
      <h2>⚡ События матча</h2>
      <div style="margin-top:12px">${liveEventsHtml(d.events)}</div>
    </section>

    <section class="panel">
      <h2>👥 Составы</h2>
      <div style="margin-top:12px">${lineupLiveHtml(d.lineups, m)}</div>
    </section>

    <section class="panel coverage-panel">
      <h2>Покрытие данных</h2>
      <div class="coverage-grid">
        <span>${d.availability?.events ? '✅' : '—'} События</span>
        <span>${d.availability?.statistics ? '✅' : '—'} Статистика</span>
        <span>${d.availability?.lineups ? '✅' : '—'} Составы</span>
      </div>
      ${d.availability?.limitedCoverage ? '<div class="coverage-badge limited">Ограниченное покрытие · экономим API-лимит</div>' : ''}
      <p class="tiny">Обновлено: ${dateTime(d.generatedAt)}${d.cached ? ' · кэш' : ' · свежие данные'}</p>
    </section>
  `;
  $('centerRefreshBtn')?.addEventListener('click', async () => {
    const btn = $('centerRefreshBtn');
    btn.disabled = true; btn.textContent = '⏳ Обновляю…';
    try {
      // Cache is intentionally shared for 60 seconds, so manual refresh can
      // return the same snapshot without wasting API quota.
      const data = await api(`/api/match-center?fixtureId=${Number(m.fixtureId)}&t=${Date.now()}`);
      state.currentCenter = data;
      renderMatchCenter(data);
    } catch (e) { toast(e.message); }
  });
  if (live) startLiveRefresh(m.fixtureId); else stopLiveRefresh();
}

async function openMatchCenter(fixtureId, btn) {
  const original = btn?.textContent || '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Загружаю матч…'; }
  try {
    const data = await api(`/api/match-center?fixtureId=${Number(fixtureId)}`);
    renderMatchCenter(data);
    showView('analysisView');
  } catch (e) {
    toast(e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

async function analyzeMatch(fixtureId, btn) {
  stopLiveRefresh();
  state.currentCenter = null;
  const original = btn?.textContent || '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Собираю данные…'; }
  try {
    const data = await api('/api/analyze', { method: 'POST', body: JSON.stringify({ fixtureId }) });
    state.currentAnalysis = data;
    if (data.provider) { state.provider = data.provider; renderProvider(); }
    renderAnalysis(data);
    if (state.profile && data.quota) {
      state.profile.quota = data.quota;
      renderProfile();
    }
    await Promise.all([loadHistory(false), loadReminders()]);
    showView('analysisView');
  } catch (e) {
    if (e.status === 429) toast('Дневной лимит анализов исчерпан.');
    else toast(e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

async function loadHistory(showLoader = true) {
  if (showLoader) $('history').innerHTML = '<div class="loader">Загружаю историю…</div>';
  try {
    const data = await api('/api/history');
    state.history = data.items || [];
    renderHistory();
  } catch (e) {
    $('history').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

function renderHistory() {
  if (!state.history.length) {
    $('history').innerHTML = '<div class="empty">История пока пуста. Сделайте первый полный анализ матча.</div>';
    return;
  }
  $('history').innerHTML = state.history.map(item => `
    <article class="history-item">
      <div class="history-logos">
        ${item.homeLogo ? `<img src="${safeUrl(item.homeLogo)}" alt="">` : ''}
        <span>—</span>
        ${item.awayLogo ? `<img src="${safeUrl(item.awayLogo)}" alt="">` : ''}
      </div>
      <div class="history-main">
        <strong>${escapeHtml(item.homeName)} — ${escapeHtml(item.awayName)}</strong>
        <span>${escapeHtml(item.leagueName || '')}${item.fixtureDate ? ` · ${dateTime(item.fixtureDate)}` : ''}</span>
      </div>
      <button class="history-open" data-fixture="${Number(item.fixtureId)}" type="button">Открыть</button>
    </article>
  `).join('');
  document.querySelectorAll('.history-open').forEach(btn => btn.addEventListener('click', () => analyzeMatch(Number(btn.dataset.fixture), btn)));
}

function pct(v) { return Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}%` : '—'; }

function formSequence(form) {
  if (!form) return '—';
  return String(form).split('').map(x => x === 'W' ? 'П' : x === 'D' ? 'Н' : x === 'L' ? 'ПР' : x).join(' · ');
}

function formCard(title, form) {
  const o = form?.overall;
  const v = form?.venue;
  if (!o?.sample) return `<div class="form-team-card"><strong>${escapeHtml(title)}</strong><p class="muted">Недостаточно данных по последним матчам.</p></div>`;
  return `<div class="form-team-card">
    <strong>${escapeHtml(title)}</strong>
    <div class="form-sequence">${escapeHtml(formSequence(o.form))}</div>
    <div class="mini-metrics">
      <span><b>${o.ppg}</b><small>очки/матч</small></span>
      <span><b>${o.gfAvg}</b><small>забито</small></span>
      <span><b>${o.gaAvg}</b><small>пропущено</small></span>
      <span><b>${o.over25Pct}%</b><small>ТБ 2.5</small></span>
    </div>
    ${v?.sample ? `<p class="muted">${form.preferredVenue === 'home' ? 'Дома' : 'В гостях'}: ${v.ppg} очка/матч · выборка ${v.sample}</p>` : ''}
  </div>`;
}

function modelWeightsText(weights = {}) {
  const names = { market: 'рынок', apiPrediction: 'API', recentForm: 'форма', h2h: 'H2H' };
  const parts = Object.entries(weights).filter(([,v]) => Number(v) > 0).map(([k,v]) => `${names[k] || k} ${Number(v).toFixed(0)}%`);
  return parts.length ? parts.join(' · ') : 'Недостаточно сигналов';
}

function bullets(items = [], empty = 'Нет существенных факторов.') {
  if (!items?.length) return `<p class="muted">${escapeHtml(empty)}</p>`;
  return `<ul class="list analysis-list">${items.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
}

function absenceList(title, items) {
  if (!items?.length) return `<div class="data-card"><span>${escapeHtml(title)}</span><strong>Нет данных</strong></div>`;
  return `<div class="panel"><h2>${escapeHtml(title)}</h2><ul class="list">${items.slice(0, 10).map(x => `<li><strong>${escapeHtml(x.name)}</strong>${x.reason ? ` — ${escapeHtml(x.reason)}` : ''}${x.type ? ` (${escapeHtml(x.type)})` : ''}</li>`).join('')}</ul></div>`;
}

function reminderFor(fixtureId) {
  return state.reminders.find(x => Number(x.fixtureId) === Number(fixtureId)) || null;
}

function hasReminder(fixtureId) {
  return Boolean(reminderFor(fixtureId));
}

async function toggleReminder(match) {
  if (!match?.fixtureId) return;
  const active = hasReminder(match.fixtureId);
  try {
    if (active) {
      await api(`/api/reminders?fixtureId=${Number(match.fixtureId)}`, { method: 'DELETE' });
      state.reminders = state.reminders.filter(x => Number(x.fixtureId) !== Number(match.fixtureId));
      toast('Напоминание отключено');
    } else {
      await api('/api/reminders', {
        method: 'POST',
        body: JSON.stringify({
          fixtureId: Number(match.fixtureId),
          homeName: match.home?.name || '',
          awayName: match.away?.name || '',
          leagueName: match.league || '',
          fixtureDate: match.date || '',
          reminderMinutes: Number(state.preferences?.reminderMinutes || 30),
          kickoffNotify: state.preferences?.kickoffNotification !== false,
        }),
      });
      await loadReminders();
      toast(`Напомним примерно за ${Number(state.preferences?.reminderMinutes || 30)} минут до матча${state.preferences?.kickoffNotification !== false ? ' и около старта' : ''}`);
    }
    await loadProfile();
    renderAnalysis(state.currentAnalysis);
  } catch (e) {
    toast(e.message);
  }
}

function clampPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function qualityInfo(completeness = {}) {
  const score = Number(completeness.score || 0);
  const max = Math.max(1, Number(completeness.max || 10));
  const ratio = score / max;
  if (ratio >= .8) return { label: 'Высокая полнота', cls: 'good' };
  if (ratio >= .55) return { label: 'Средняя полнота', cls: 'medium' };
  return { label: 'Ограниченные данные', cls: 'low' };
}

function probabilityStrip(p = {}) {
  const home = clampPercent(p.home);
  const draw = clampPercent(p.draw);
  const away = clampPercent(p.away);
  const total = home + draw + away || 1;
  const h = home / total * 100;
  const d = draw / total * 100;
  const a = away / total * 100;
  return `<div class="probability-strip" aria-label="Вероятности исхода">
    <span class="prob-segment home" style="width:${h.toFixed(2)}%"></span>
    <span class="prob-segment draw" style="width:${d.toFixed(2)}%"></span>
    <span class="prob-segment away" style="width:${a.toFixed(2)}%"></span>
  </div>`;
}

function analysisSourceStatus(d) {
  const parts = [];
  if (d.market) parts.push('Рынок');
  if (d.apiPrediction) parts.push('API');
  if (d.recentForm?.home?.overall?.sample || d.recentForm?.away?.overall?.sample) parts.push('Форма');
  if ((d.h2h?.homeWins || 0) + (d.h2h?.awayWins || 0) + (d.h2h?.draws || 0) > 0) parts.push('H2H');
  if (d.news?.answer) parts.push('Новости');
  return parts.length ? parts.join(' · ') : 'Базовые данные';
}

function compactAbsence(title, items) {
  if (!items?.length) return `<div class="squad-block"><div class="squad-title">${escapeHtml(title)}</div><p class="muted">Заявленных потерь нет или данные недоступны.</p></div>`;
  return `<div class="squad-block"><div class="squad-title">${escapeHtml(title)}</div><ul class="compact-list">${items.slice(0, 10).map(x => `<li><strong>${escapeHtml(x.name)}</strong><span>${escapeHtml([x.reason, x.type].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul></div>`;
}

function lineupBlock(title, lineup) {
  const players = lineup?.startXI || [];
  return `<div class="squad-block"><div class="squad-title">${escapeHtml(title)} <span>${escapeHtml(lineup?.formation || '')}</span></div>${players.length ? `<div class="lineup-list">${players.map((x,i) => `<span><b>${i+1}</b>${escapeHtml(x)}</span>`).join('')}</div>` : '<p class="muted">Стартовый состав ещё не опубликован.</p>'}</div>`;
}

async function shareAnalysis(d) {
  const m = d?.match || {};
  const p = d?.probabilities || {};
  const text = [
    `⚽ ${m.home?.name || ''} — ${m.away?.name || ''}`,
    `${m.league || ''}${m.date ? ` · ${dateTime(m.date)}` : ''}`,
    `П1 ${pct(p.home)} · X ${pct(p.draw)} · П2 ${pct(p.away)}`,
    `Наиболее вероятно: ${d?.likelyOutcome || '—'}`,
    `Уверенность: ${d?.confidence?.score ?? '—'}/100`,
    '',
    'Football Analytics · аналитическая оценка, не гарантия результата.'
  ].join('\n');
  try {
    if (navigator.share) {
      await navigator.share({ title: `${m.home?.name || ''} — ${m.away?.name || ''}`, text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast('Краткий анализ скопирован');
  } catch (e) {
    if (e?.name !== 'AbortError') toast('Не удалось поделиться анализом');
  }
}

function bindAnalysisTabs() {
  const buttons = [...document.querySelectorAll('.analysis-tab-btn')];
  const panels = [...document.querySelectorAll('.analysis-tab-panel')];
  buttons.forEach(btn => btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    buttons.forEach(x => x.classList.toggle('active', x === btn));
    panels.forEach(x => x.classList.toggle('active', x.dataset.panel === tab));
    const target = document.querySelector('.analysis-tabs');
    if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }));
}

function renderAnalysis(d) {
  if (!d) return;
  state.currentAnalysis = d;
  const p = d.probabilities || {};
  const m = d.match || {};
  const market = d.market;
  const pred = d.apiPrediction;
  const h2h = d.h2h || {};
  const news = d.news || {};
  const homeLine = d.lineups?.home;
  const awayLine = d.lineups?.away;
  const activeReminder = reminderFor(m.fixtureId);
  const reminderActive = Boolean(activeReminder);
  const confidence = d.confidence || {};
  const goal = d.goalModel;
  const recent = d.recentForm || {};
  const quality = qualityInfo(d.completeness);
  const confidenceScore = clampPercent(confidence.score);

  $('analysis').innerHTML = `
    <section class="panel match-experience-hero">
      <div class="match-experience-meta">
        <span>${escapeHtml(m.league || 'Турнир')}${m.country ? ` · ${escapeHtml(m.country)}` : ''}</span>
        <span>${dateTime(m.date)}</span>
      </div>

      <div class="match-experience-teams">
        <div class="experience-team">
          ${m.home?.logo ? `<img src="${safeUrl(m.home.logo)}" alt="">` : '<div class="experience-logo-placeholder">⚽</div>'}
          <strong>${escapeHtml(m.home?.name || '')}</strong>
          <small>Хозяева</small>
        </div>
        <div class="experience-vs">
          <span>VS</span>
          ${m.venue ? `<small>${escapeHtml(m.venue)}</small>` : ''}
        </div>
        <div class="experience-team">
          ${m.away?.logo ? `<img src="${safeUrl(m.away.logo)}" alt="">` : '<div class="experience-logo-placeholder">⚽</div>'}
          <strong>${escapeHtml(m.away?.name || '')}</strong>
          <small>Гости</small>
        </div>
      </div>

      <div class="experience-callout">
        <span>Наиболее вероятный исход</span>
        <strong>${escapeHtml(d.likelyOutcome || 'Недостаточно данных')}</strong>
      </div>

      <div class="experience-prob-labels">
        <div><span>П1</span><strong>${pct(p.home)}</strong></div>
        <div><span>X</span><strong>${pct(p.draw)}</strong></div>
        <div><span>П2</span><strong>${pct(p.away)}</strong></div>
      </div>
      ${probabilityStrip(p)}

      <div class="experience-health-row">
        <span class="quality-pill ${quality.cls}">● ${quality.label}</span>
        <span>${d.cached ? '⚡ Кэш' : '🆕 Свежий'} · ${d.completeness?.score ?? 0}/${d.completeness?.max ?? 10}</span>
        <span>Обновлено ${d.generatedAt ? timeOf(d.generatedAt) : '—'}</span>
      </div>

      <div class="experience-actions">
        <button id="reminderBtn" class="reminder-btn ${reminderActive ? 'active' : ''}" type="button">${reminderActive ? `🔔 За ${Number(activeReminder?.remindBeforeMinutes || 30)} мин.${activeReminder?.kickoffNotify ? ' + старт' : ''}` : `🔕 Напомнить за ${Number(state.preferences?.reminderMinutes || 30)} минут`}</button>
        <button id="shareAnalysisBtn" class="share-analysis-btn" type="button">↗ Поделиться</button>
      </div>
    </section>

    <div class="analysis-tabs" role="tablist">
      <button class="analysis-tab-btn active" data-tab="overview" type="button">Обзор</button>
      <button class="analysis-tab-btn" data-tab="form" type="button">Форма</button>
      <button class="analysis-tab-btn" data-tab="market" type="button">Рынок</button>
      <button class="analysis-tab-btn" data-tab="squads" type="button">Составы</button>
      <button class="analysis-tab-btn" data-tab="context" type="button">Контекст</button>
    </div>

    <div class="analysis-tab-panel active" data-panel="overview">
      <section class="panel experience-dashboard">
        <div class="dashboard-metric confidence-metric">
          <span>Уверенность модели</span>
          <strong>${confidence.score ?? '—'}/100</strong>
          <small>${escapeHtml(confidence.label || '—')}</small>
          <div class="confidence-bar"><span style="width:${confidenceScore}%"></span></div>
        </div>
        <div class="dashboard-metric">
          <span>Источники</span>
          <strong>${escapeHtml(analysisSourceStatus(d))}</strong>
          <small>Сигналы объединяются динамически</small>
        </div>
        <div class="dashboard-metric">
          <span>Расхождение</span>
          <strong>${Number.isFinite(Number(confidence.disagreement)) ? `${Number(confidence.disagreement).toFixed(1)} п.п.` : '—'}</strong>
          <small>Чем меньше, тем согласованнее источники</small>
        </div>
      </section>

      <section class="panel">
        <h2>🧩 Почему такая оценка</h2>
        ${bullets(d.insights, 'Пока нет сильных дополнительных факторов.')}
      </section>

      <section class="panel goal-visual-panel">
        <h2>⚽ Голевая модель</h2>
        ${goal ? `<div class="goal-score-visual">
          <div><span>${escapeHtml(m.home?.name || 'Хозяева')}</span><strong>${goal.homeExpected}</strong></div>
          <div class="goal-divider">:</div>
          <div><span>${escapeHtml(m.away?.name || 'Гости')}</span><strong>${goal.awayExpected}</strong></div>
        </div>
        <div class="goal-market-grid">
          <div><span>ТБ 2.5</span><strong>${pct(goal.over25)}</strong><div class="mini-progress"><i style="width:${clampPercent(goal.over25)}%"></i></div></div>
          <div><span>Обе забьют</span><strong>${pct(goal.btts)}</strong><div class="mini-progress"><i style="width:${clampPercent(goal.btts)}%"></i></div></div>
        </div>
        <p class="muted">Poisson-эвристика по недавней результативности. Это не официальный xG.</p>` : '<p class="muted">Недостаточно недавних матчей для голевой модели.</p>'}
      </section>

      <section class="panel risk-panel">
        <h2>⚠️ Риски и ограничения</h2>
        ${bullets(d.risks, 'Критичных ограничений по доступным данным не найдено.')}
      </section>
    </div>

    <div class="analysis-tab-panel" data-panel="form">
      <section class="panel">
        <h2>📈 Форма команд</h2>
        <div class="form-grid experience-form-grid">
          ${formCard(m.home?.name || 'Хозяева', recent.home)}
          ${formCard(m.away?.name || 'Гости', recent.away)}
        </div>
      </section>
      <section class="panel">
        <h2>🤝 Последние очные встречи</h2>
        <div class="h2h-visual">
          <div><strong>${h2h.homeWins ?? 0}</strong><span>${escapeHtml(m.home?.name || '')}</span></div>
          <div class="h2h-draw"><strong>${h2h.draws ?? 0}</strong><span>Ничьи</span></div>
          <div><strong>${h2h.awayWins ?? 0}</strong><span>${escapeHtml(m.away?.name || '')}</span></div>
        </div>
      </section>
    </div>

    <div class="analysis-tab-panel" data-panel="market">
      <section class="panel">
        <h2>💹 Рынок 1X2</h2>
        <div class="odds-grid">
          <div><span>П1</span><strong>${market?.odds?.home ?? '—'}</strong></div>
          <div><span>X</span><strong>${market?.odds?.draw ?? '—'}</strong></div>
          <div><span>П2</span><strong>${market?.odds?.away ?? '—'}</strong></div>
        </div>
        <p class="muted">Букмекеров в выборке: ${market?.bookmakers ?? '—'}. Коэффициенты отражают рынок, а не гарантированный исход.</p>
      </section>
      <section class="panel">
        <h2>🧠 Состав модели</h2>
        <p class="muted">${escapeHtml(d.modelBreakdown?.method || 'Модель объединяет доступные статистические сигналы.')}</p>
        <div class="model-weights">${escapeHtml(modelWeightsText(d.modelBreakdown?.weights || {}))}</div>
        <div class="model-api-card">
          <span>API-Football</span>
          <strong>${escapeHtml(pred?.winner || 'Нет данных')}</strong>
          <small>${escapeHtml(pred?.advice || 'Подсказка недоступна')}</small>
        </div>
      </section>
    </div>

    <div class="analysis-tab-panel" data-panel="squads">
      <section class="panel">
        <h2>🚑 Потери</h2>
        <div class="squad-grid">
          ${compactAbsence(m.home?.name || 'Хозяева', d.absences?.home)}
          ${compactAbsence(m.away?.name || 'Гости', d.absences?.away)}
        </div>
      </section>
      <section class="panel">
        <h2>👥 Стартовые составы</h2>
        <div class="squad-grid">
          ${lineupBlock(m.home?.name || 'Хозяева', homeLine)}
          ${lineupBlock(m.away?.name || 'Гости', awayLine)}
        </div>
      </section>
    </div>

    <div class="analysis-tab-panel" data-panel="context">
      <section class="panel">
        <h2>🌐 Свежий веб-контекст</h2>
        <p class="context-answer">${escapeHtml(news.answer || 'Tavily не подключён или свежая сводка не найдена.')}</p>
        ${news.results?.length ? `<div class="news-links">${news.results.slice(0, 5).map(r => `<a href="${safeUrl(r.url)}" target="_blank" rel="noopener">↗ ${escapeHtml(r.title || 'Источник')}</a>`).join('')}</div>` : ''}
      </section>
      <section class="panel data-transparency-panel">
        <h2>🔎 Прозрачность данных</h2>
        <div class="transparency-grid">
          <div><span>Полнота</span><strong>${d.completeness?.score ?? 0}/${d.completeness?.max ?? 10}</strong></div>
          <div><span>Анализ</span><strong>v${escapeHtml(d.analysisVersion || '—')}</strong></div>
          <div><span>Статус</span><strong>${d.cached ? 'Кэш' : 'Свежий'}</strong></div>
        </div>
        <p class="tiny warning">${escapeHtml(d.disclaimer || '')}</p>
      </section>
    </div>
  `;

  $('reminderBtn')?.addEventListener('click', () => toggleReminder(m));
  $('shareAnalysisBtn')?.addEventListener('click', () => shareAnalysis(d));
  bindAnalysisTabs();
}

function safeUrl(url) {
  try {
    const u = new URL(url, location.origin);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
  } catch { return ''; }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

document.querySelectorAll('.date-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.date-btn').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    state.offset = Number(btn.dataset.offset);
    loadMatches();
  });
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.filter = btn.dataset.filter;
    syncFilterButtons();
    renderMatches();
  });
});

$('matchSearch').addEventListener('input', e => {
  state.search = e.target.value || '';
  renderMatches();
});

$('refreshBtn').addEventListener('click', loadMatches);
$('historyRefreshBtn').addEventListener('click', () => loadHistory(true));
$('backBtn').addEventListener('click', () => showView('matchesView'));
$('profileBtn').addEventListener('click', () => showView('profileView'));
$('navMatches').addEventListener('click', () => showView('matchesView'));
$('navHistory').addEventListener('click', async () => { await loadHistory(true); showView('historyView'); });
$('navProfile').addEventListener('click', () => showView('profileView'));
$('proBtn').addEventListener('click', () => toast('Telegram Stars подключим в следующем платёжном этапе.'));
$('premiumBtn').addEventListener('click', () => toast('PREMIUM будет доступен после подключения Telegram Stars.'));
$('savePreferencesBtn')?.addEventListener('click', savePreferencesFromUi);

await Promise.all([loadProfile(), loadFavorites(), loadReminders(), loadMatches(), loadHistory(false)]);
await loadProvider();
renderProfile();
