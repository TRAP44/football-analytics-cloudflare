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
  renderFavoriteTeams();
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
  } catch (e) {
    toast(e.message);
  }
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
  return state.matches.filter(m => {
    let byFilter = state.filter === 'all';
    if (state.filter === 'top') byFilter = Number(m.interestScore || 0) >= 50 && !m.youthReserve;
    if (['international', 'england', 'spain', 'italy', 'germany', 'france'].includes(state.filter)) byFilter = m.group === state.filter;
    if (state.filter === 'favorites') byFilter = fav.has(Number(m.home?.id)) || fav.has(Number(m.away?.id));
    if (!byFilter) return false;
    if (!q) return true;
    return [m.home?.name, m.away?.name, m.league, m.country]
      .filter(Boolean)
      .some(v => String(v).toLowerCase().includes(q));
  });
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
  state.liveRefreshRemaining = 60;
  updateLiveCountdown();
  state.liveRefreshTimer = setInterval(async () => {
    state.liveRefreshRemaining -= 1;
    updateLiveCountdown();
    if (state.liveRefreshRemaining <= 0) {
      state.liveRefreshRemaining = 60;
      try {
        const data = await api(`/api/match-center?fixtureId=${Number(fixtureId)}&t=${Date.now()}`);
        state.currentCenter = data;
        renderMatchCenter(data);
        if (data.mode !== 'live') stopLiveRefresh();
      } catch (e) {
        state.liveRefreshRemaining = 60;
        toast(e.message);
      }
    }
  }, 1000);
}

function renderMatchCenter(d) {
  state.currentCenter = d;
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
      ${live ? '<p id="liveRefreshText" class="live-refresh-text">Автообновление через 60 сек.</p>' : `<p class="live-refresh-text">Данные матча сохранены в общем кэше.</p>`}
      <button id="centerRefreshBtn" class="reminder-btn" type="button">↻ Обновить сейчас</button>
    </section>

    ${d.note ? `<section class="panel"><p class="tiny warning">${escapeHtml(d.note)}</p></section>` : ''}

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

function absenceList(title, items) {
  if (!items?.length) return `<div class="data-card"><span>${escapeHtml(title)}</span><strong>Нет данных</strong></div>`;
  return `<div class="panel"><h2>${escapeHtml(title)}</h2><ul class="list">${items.slice(0, 10).map(x => `<li><strong>${escapeHtml(x.name)}</strong>${x.reason ? ` — ${escapeHtml(x.reason)}` : ''}${x.type ? ` (${escapeHtml(x.type)})` : ''}</li>`).join('')}</ul></div>`;
}

function hasReminder(fixtureId) {
  return state.reminders.some(x => Number(x.fixtureId) === Number(fixtureId));
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
        }),
      });
      await loadReminders();
      toast('Напомним примерно за 30 минут до матча');
    }
    await loadProfile();
    renderAnalysis(state.currentAnalysis);
  } catch (e) {
    toast(e.message);
  }
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
  const reminderActive = hasReminder(m.fixtureId);

  $('analysis').innerHTML = `
    <section class="panel analysis-hero">
      <div class="logos">
        ${m.home?.logo ? `<img src="${safeUrl(m.home.logo)}" alt="">` : ''}
        <span>VS</span>
        ${m.away?.logo ? `<img src="${safeUrl(m.away.logo)}" alt="">` : ''}
      </div>
      <h2>${escapeHtml(m.home?.name || '')} — ${escapeHtml(m.away?.name || '')}</h2>
      <p>${escapeHtml(m.league || '')} · ${dateTime(m.date)}</p>
      <div class="probs">
        <div class="prob"><span>П1</span><strong>${pct(p.home)}</strong></div>
        <div class="prob"><span>Ничья</span><strong>${pct(p.draw)}</strong></div>
        <div class="prob"><span>П2</span><strong>${pct(p.away)}</strong></div>
      </div>
      <button id="reminderBtn" class="reminder-btn ${reminderActive ? 'active' : ''}" type="button">${reminderActive ? '🔔 Напоминание включено' : '🔕 Напомнить за 30 минут'}</button>
      <p>${d.cached ? '⚡ Результат из кэша' : '🆕 Свежий анализ'} · полнота ${d.completeness?.score ?? 0}/${d.completeness?.max ?? 7}</p>
    </section>

    <section class="panel">
      <h2>💹 Рынок и модель</h2>
      <div class="data-grid" style="margin-top:12px">
        <div class="data-card"><span>Средние кэфы 1 / X / 2</span><strong>${market?.odds ? `${market.odds.home} / ${market.odds.draw} / ${market.odds.away}` : 'Нет данных'}</strong></div>
        <div class="data-card"><span>Букмекеров в выборке</span><strong>${market?.bookmakers ?? '—'}</strong></div>
        <div class="data-card"><span>API-Football</span><strong>${escapeHtml(pred?.winner || 'Нет данных')}</strong></div>
        <div class="data-card"><span>Подсказка модели</span><strong>${escapeHtml(pred?.advice || 'Нет данных')}</strong></div>
      </div>
    </section>

    ${absenceList(`🚑 Потери — ${m.home?.name || 'Хозяева'}`, d.absences?.home)}
    ${absenceList(`🚑 Потери — ${m.away?.name || 'Гости'}`, d.absences?.away)}

    <section class="panel">
      <h2>👥 Составы</h2>
      <div class="data-grid" style="margin-top:12px">
        <div class="data-card"><span>${escapeHtml(m.home?.name || '')}</span><strong>${escapeHtml(homeLine?.formation || 'Ещё не опубликован')}</strong></div>
        <div class="data-card"><span>${escapeHtml(m.away?.name || '')}</span><strong>${escapeHtml(awayLine?.formation || 'Ещё не опубликован')}</strong></div>
      </div>
      ${(homeLine?.startXI?.length || awayLine?.startXI?.length) ? `<ul class="list"><li><strong>${escapeHtml(m.home?.name || '')}:</strong> ${escapeHtml((homeLine?.startXI || []).join(', '))}</li><li><strong>${escapeHtml(m.away?.name || '')}:</strong> ${escapeHtml((awayLine?.startXI || []).join(', '))}</li></ul>` : '<p class="muted">Подтверждённые стартовые составы появляются ближе к матчу.</p>'}
    </section>

    <section class="panel">
      <h2>🤝 Последние очные</h2>
      <div class="data-grid" style="margin-top:12px">
        <div class="data-card"><span>${escapeHtml(m.home?.name || '')}</span><strong>${h2h.homeWins ?? 0} побед</strong></div>
        <div class="data-card"><span>${escapeHtml(m.away?.name || '')}</span><strong>${h2h.awayWins ?? 0} побед</strong></div>
      </div>
      <p class="muted">Ничьих: ${h2h.draws ?? 0}</p>
    </section>

    <section class="panel">
      <h2>🌐 Свежий веб-контекст</h2>
      <p>${escapeHtml(news.answer || 'Tavily не подключён или свежая сводка не найдена.')}</p>
      ${news.results?.length ? `<div class="news-links">${news.results.slice(0, 4).map(r => `<a href="${safeUrl(r.url)}" target="_blank" rel="noopener">↗ ${escapeHtml(r.title || 'Источник')}</a>`).join('')}</div>` : ''}
    </section>

    <section class="panel"><p class="tiny warning">${escapeHtml(d.disclaimer || '')}</p></section>
  `;
  $('reminderBtn')?.addEventListener('click', () => toggleReminder(m));
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

await Promise.all([loadProfile(), loadFavorites(), loadReminders(), loadMatches(), loadHistory(false)]);
renderProfile();
