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
  matchesMeta: { refreshedAt: null, stale: false, warning: '', retryAfter: 0, catalog: {} },
  history: [],
  favorites: [],
  reminders: [],
  preferences: { defaultFilter: 'top', reminderMinutes: 30, kickoffNotification: true, hideYouth: true, favoriteFirst: true },
  preferencesApplied: false,
  provider: null,
  billing: null,
  filter: 'top',
  search: '',
  globalSearch: { query: '', remoteTeams: [], remoteCompetitions: [], loading: false, warning: '', searchedAt: null },
  currentAnalysis: null,
  currentCenter: null,
  currentTournament: null,
  tournamentBackView: 'matchesView',
  currentTeam: null,
  teamBackView: 'matchesView',
  teamCache: new Map(),
  teamIntelligenceCache: new Map(),
  teamSquadCache: new Map(),
  tournamentStandings: new Map(),
  liveRefreshTimer: null,
  liveRefreshRemaining: 0,
};

const $ = id => document.getElementById(id);
const views = ['matchesView', 'searchView', 'tournamentView', 'teamView', 'analysisView', 'historyView', 'profileView'];

function stopLiveRefresh() {
  if (state.liveRefreshTimer) clearInterval(state.liveRefreshTimer);
  state.liveRefreshTimer = null;
  state.liveRefreshRemaining = 0;
}

function showView(id) {
  if (id !== 'analysisView') stopLiveRefresh();
  views.forEach(v => $(v).classList.toggle('active', v === id));
  $('navMatches').classList.toggle('active', id === 'matchesView' || id === 'tournamentView' || id === 'teamView' || id === 'analysisView');
  $('navSearch')?.classList.toggle('active', id === 'searchView');
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

function relativeAge(iso) {
  const ms = Date.now() - Date.parse(iso || '');
  if (!Number.isFinite(ms) || ms < 0) return '';
  const sec = Math.floor(ms / 1000);
  if (sec < 15) return 'только что';
  if (sec < 60) return `${sec} сек. назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин. назад`;
  const h = Math.floor(min / 60);
  return `${h} ч. назад`;
}

function coverageLabel(tier) {
  if (tier === 'enhanced') return { text: 'Расширенное', cls: 'enhanced' };
  if (tier === 'basic') return { text: 'Базовое', cls: 'basic' };
  return { text: 'Стандартное', cls: 'standard' };
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
renderDiscoveryHome();
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
  renderBilling();
}

function renderBilling() {
  if (!$('billingStatus')) return;
  const b = state.billing;
  const quota = state.profile?.quota || {};
  const currentPlan = String(b?.current?.plan || quota.plan || 'FREE').toUpperCase();
  const currentUntil = b?.current?.subscriptionUntil || state.profile?.billing?.subscriptionUntil || null;
  const canceled = Boolean(b?.current?.canceled ?? state.profile?.billing?.canceled);

  document.querySelectorAll('.pricing-card[data-plan]').forEach(card => {
    card.classList.toggle('current', card.dataset.plan === currentPlan);
  });

  const pro = b?.plans?.PRO || { stars: 199, dailyLimit: 20 };
  const premium = b?.plans?.PREMIUM || { stars: 399, dailyLimit: 100 };
  if ($('proPrice')) $('proPrice').textContent = `${pro.stars} ⭐ / 30 дней`;
  if ($('premiumPrice')) $('premiumPrice').textContent = `${premium.stars} ⭐ / 30 дней`;
  if ($('proLimit')) $('proLimit').textContent = `${pro.dailyLimit} анализов / день`;
  if ($('premiumLimit')) $('premiumLimit').textContent = `${premium.dailyLimit} анализов / день`;

  const ready = Boolean(b?.ready);
  $('billingStatus').className = `billing-status ${ready ? 'ready' : 'waiting'}`;
  $('billingStatus').textContent = ready
    ? '⭐ Telegram Stars подключены. Оплата и автопродление готовы.'
    : '⚙️ Telegram Stars подготовлены, но webhook ещё не активирован.';

  const proBtn = $('proBtn');
  const premiumBtn = $('premiumBtn');
  [proBtn, premiumBtn].forEach(btn => { if (btn) btn.disabled = !ready; });
  if (proBtn) proBtn.textContent = currentPlan === 'PRO' ? 'Текущий PRO' : `Подключить за ${pro.stars} ⭐`;
  if (premiumBtn) premiumBtn.textContent = currentPlan === 'PREMIUM' ? 'Текущий PREMIUM' : `Подключить за ${premium.stars} ⭐`;
  if (proBtn && currentPlan === 'PRO') proBtn.disabled = true;
  if (premiumBtn && currentPlan === 'PREMIUM') premiumBtn.disabled = true;

  const details = $('subscriptionDetails');
  const manage = $('subscriptionManageBtn');
  if (currentPlan !== 'FREE' && currentUntil) {
    details.hidden = false;
    details.innerHTML = `<strong>${escapeHtml(currentPlan)}</strong><span>Активен до ${escapeHtml(dateTime(currentUntil))}${canceled ? ' · автопродление отключено' : ' · автопродление включено'}</span>`;
    manage.hidden = false;
    manage.textContent = canceled ? '↻ Возобновить автопродление' : 'Отключить автопродление';
    manage.dataset.action = canceled ? 'resume' : 'cancel';
  } else {
    details.hidden = true;
    manage.hidden = true;
  }
}

async function loadBilling() {
  try {
    state.billing = await api('/api/billing/plans');
    renderBilling();
  } catch (e) {
    state.billing = { ready: false };
    renderBilling();
  }
}

async function syncBilling(showToast = true) {
  try {
    const result = await api('/api/billing/sync', { method: 'POST', body: '{}' });
    await loadProfile();
    await loadBilling();
    if (showToast) toast(result.synced ? 'Подписка синхронизирована' : 'Новых платежей не найдено');
  } catch (e) { if (showToast) toast(e.message); }
}

async function buyPlan(plan) {
  if (!state.billing?.ready) {
    toast('Оплата ещё не активирована администратором.');
    return;
  }
  if (!tg?.openInvoice) {
    toast('Оплата доступна только внутри Telegram.');
    return;
  }
  try {
    const invoice = await api('/api/billing/invoice', { method: 'POST', body: JSON.stringify({ plan }) });
    tg.openInvoice(invoice.invoiceUrl, async status => {
      const value = typeof status === 'string' ? status : status?.status;
      if (value === 'paid') {
        toast('Платёж принят. Активируем подписку…');
        await new Promise(resolve => setTimeout(resolve, 700));
        await syncBilling(false);
        toast(`${plan} активирован`);
      } else if (value === 'pending') {
        toast('Платёж обрабатывается. Нажмите «Проверить оплату» через несколько секунд.');
      } else if (value === 'failed') {
        toast('Telegram не смог завершить платёж.');
      }
    });
  } catch (e) { toast(e.message); }
}

async function manageSubscription(action) {
  try {
    const data = await api('/api/billing/subscription', { method: 'POST', body: JSON.stringify({ action }) });
    await loadProfile();
    await loadBilling();
    toast(data.canceled ? 'Автопродление отключено' : 'Автопродление включено');
  } catch (e) { toast(e.message); }
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
  if ($('providerPlayerStats')) $('providerPlayerStats').textContent = p.playerStatsReady ? 'Авто · PRO+' : 'Экономный режим';
  if ($('providerOddsMovement')) $('providerOddsMovement').textContent = p.oddsMovementReady ? 'История включена' : 'После PRO';
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
    renderDiscoveryHome();
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
    if (state.currentTournament) renderTournamentMatches();
    renderFavoriteTeams();
    renderDiscoveryHome();
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
      <button class="favorite-team-main team-open-link" type="button" data-open-team="${Number(x.teamId)}" data-team-name="${escapeHtml(x.teamName)}" data-team-logo="${escapeHtml(x.teamLogo || '')}">
        ${x.teamLogo ? `<img src="${safeUrl(x.teamLogo)}" alt="">` : '<span class="team-placeholder">⚽</span>'}
        <strong>${escapeHtml(x.teamName)}</strong>
      </button>
      <button class="favorite-remove" type="button" data-team-id="${Number(x.teamId)}" data-team-name="${escapeHtml(x.teamName)}">Удалить</button>
    </div>
  `).join('');
  document.querySelectorAll('.favorite-remove').forEach(btn => btn.addEventListener('click', () => {
    const item = state.favorites.find(x => Number(x.teamId) === Number(btn.dataset.teamId));
    if (item) toggleFavorite({ id: item.teamId, name: item.teamName, logo: item.teamLogo });
  }));
  el.querySelectorAll('[data-open-team]').forEach(btn => btn.addEventListener('click', () => openTeam({ id: Number(btn.dataset.openTeam), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '' })));
}


const RECENT_TEAMS_KEY = 'football_recent_teams_v1';

function getRecentTeams() {
  try {
    const rows = JSON.parse(localStorage.getItem(RECENT_TEAMS_KEY) || '[]');
    return Array.isArray(rows) ? rows.filter(x => Number(x?.id) > 0 && x?.name).slice(0, 10) : [];
  } catch { return []; }
}

function rememberTeam(team) {
  if (!team?.id || !team?.name) return;
  try {
    const row = { id: Number(team.id), name: String(team.name), logo: String(team.logo || ''), country: String(team.country || ''), viewedAt: new Date().toISOString() };
    const next = [row, ...getRecentTeams().filter(x => Number(x.id) !== row.id)].slice(0, 10);
    localStorage.setItem(RECENT_TEAMS_KEY, JSON.stringify(next));
  } catch {}
}

function clearRecentTeams() {
  try { localStorage.removeItem(RECENT_TEAMS_KEY); } catch {}
  renderDiscoveryHome();
}

function discoveryTeamCard(team, badge = '') {
  return `<button class="discovery-team-card" type="button" data-search-team="${Number(team.id)}" data-team-name="${escapeHtml(team.name || '')}" data-team-logo="${escapeHtml(team.logo || '')}" data-team-country="${escapeHtml(team.country || '')}">
    <span class="discovery-team-logo">${team.logo ? `<img src="${safeUrl(team.logo)}" alt="">` : '⚽'}</span>
    <span class="discovery-team-copy"><strong>${escapeHtml(team.name || 'Команда')}</strong><small>${escapeHtml(team.country || badge || '')}${team.national ? ' · сборная' : ''}</small></span>
    ${badge ? `<i>${escapeHtml(badge)}</i>` : '<b>›</b>'}
  </button>`;
}

function discoveryCompetitionCard(comp, badge = '') {
  return `<button class="discovery-competition-card" type="button" data-search-competition="${Number(comp.leagueId)}" data-season="${Number(comp.season || new Date().getFullYear())}" data-comp-name="${escapeHtml(comp.name || comp.shortName || 'Турнир')}" data-comp-short="${escapeHtml(comp.shortName || comp.name || 'Турнир')}" data-comp-country="${escapeHtml(comp.country || '')}" data-comp-category="${escapeHtml(comp.category || '')}" data-comp-tier="${escapeHtml(comp.tier || 'standard')}">
    <span class="discovery-comp-icon">🏆</span><span><strong>${escapeHtml(comp.shortName || comp.name || 'Турнир')}</strong><small>${escapeHtml(comp.country || '')}${badge ? ` · ${escapeHtml(badge)}` : ''}</small></span><b>›</b>
  </button>`;
}

function bindDiscoveryActions(root = document) {
  root.querySelectorAll?.('[data-search-team]').forEach(btn => btn.addEventListener('click', () => openTeam({
    id: Number(btn.dataset.searchTeam), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '', country: btn.dataset.teamCountry || '',
  })));
  root.querySelectorAll?.('[data-search-competition]').forEach(btn => btn.addEventListener('click', () => openTournamentMeta({
    leagueId: Number(btn.dataset.searchCompetition), season: Number(btn.dataset.season || new Date().getFullYear()), name: btn.dataset.compName || 'Турнир', shortName: btn.dataset.compShort || btn.dataset.compName || 'Турнир', country: btn.dataset.compCountry || '', category: btn.dataset.compCategory || '', tier: btn.dataset.compTier || 'standard', logo: '',
  })));
}

function localDiscoveryResults(query) {
  const q = String(query || '').trim().toLowerCase().replace(/ё/g, 'е');
  if (!q) return { teams: [], competitions: [] };
  const teams = new Map(), competitions = new Map();
  for (const m of state.matches) {
    for (const team of [m.home, m.away]) {
      if (!team?.id || !team?.name) continue;
      const hay = `${team.name} ${m.country || ''}`.toLowerCase().replace(/ё/g, 'е');
      if (hay.includes(q) && !teams.has(Number(team.id))) teams.set(Number(team.id), { ...team, country: m.country || '' });
    }
    const chay = `${m.league || ''} ${m.leagueOriginal || ''} ${m.leagueShort || ''} ${m.country || ''}`.toLowerCase().replace(/ё/g, 'е');
    if (Number(m.leagueId) > 0 && chay.includes(q) && !competitions.has(Number(m.leagueId))) competitions.set(Number(m.leagueId), {
      leagueId: Number(m.leagueId), season: Number(m.season || new Date().getFullYear()), name: m.league || m.leagueOriginal || 'Турнир', shortName: m.leagueShort || m.league || 'Турнир', country: m.country || '', category: m.category || '', tier: m.competition?.tier || 'standard', logo: m.leagueLogo || '',
    });
  }
  return { teams: [...teams.values()].slice(0, 10), competitions: [...competitions.values()].slice(0, 8) };
}

function mergeById(first = [], second = [], idKey = 'id') {
  const seen = new Set(), out = [];
  for (const row of [...first, ...second]) {
    const id = Number(row?.[idKey] || 0);
    if (!id || seen.has(id)) continue;
    seen.add(id); out.push(row);
  }
  return out;
}

function renderDiscoveryHome() {
  const recentEl = $('searchRecent');
  const favEl = $('searchFavorites');
  const compEl = $('searchCompetitions');
  if (recentEl) {
    const rows = getRecentTeams();
    recentEl.innerHTML = rows.length ? rows.map(x => discoveryTeamCard(x, 'Недавно')).join('') : '<div class="empty compact-empty">Открытые команды появятся здесь.</div>';
  }
  if (favEl) {
    favEl.innerHTML = state.favorites.length ? state.favorites.slice(0, 10).map(x => discoveryTeamCard({ id:x.teamId, name:x.teamName, logo:x.teamLogo }, 'Избранное')).join('') : '<div class="empty compact-empty">Добавьте команду в избранное — она появится здесь.</div>';
  }
  if (compEl) {
    const seen = new Set();
    const comps = state.matches.filter(m => Number(m.leagueId) > 0 && !m.lowPriority).sort((a,b) => Number(b.competition?.priority||0)-Number(a.competition?.priority||0)).filter(m => { const id=Number(m.leagueId); if(seen.has(id)) return false; seen.add(id); return true; }).slice(0,8);
    compEl.innerHTML = comps.length ? comps.map(m => `<button class="competition-shortcut" type="button" data-open-tournament="${Number(m.leagueId)}">${m.leagueLogo ? `<img src="${safeUrl(m.leagueLogo)}" alt="">` : '<span class="competition-logo-placeholder">🏆</span>'}<span><strong>${escapeHtml(m.leagueShort || m.league || 'Турнир')}</strong><small>${escapeHtml(m.country || '')}</small></span>${m.live ? '<b>LIVE</b>' : ''}</button>`).join('') : '<div class="empty compact-empty">Сначала загрузите список матчей.</div>';
    compEl.querySelectorAll?.('[data-open-tournament]').forEach(btn => btn.addEventListener('click', () => openTournament(Number(btn.dataset.openTournament))));
  }
  bindDiscoveryActions($('searchRecent'));
  bindDiscoveryActions($('searchFavorites'));
}

function renderGlobalSearch() {
  const query = String(state.globalSearch.query || '').trim();
  const wrap = $('searchResultsWrap'), out = $('searchResults'), meta = $('searchResultsMeta'), status = $('searchStatus');
  if (!wrap || !out) return;
  if (!query) {
    wrap.hidden = true;
    if (status) status.innerHTML = '';
    renderDiscoveryHome();
    return;
  }
  const local = localDiscoveryResults(query);
  const teams = mergeById(local.teams, state.globalSearch.remoteTeams, 'id');
  const comps = mergeById(local.competitions, state.globalSearch.remoteCompetitions, 'leagueId');
  wrap.hidden = false;
  if (meta) meta.textContent = `${teams.length} команд · ${comps.length} турниров`;
  if (status) {
    status.innerHTML = state.globalSearch.loading ? '<div class="data-notice">🔎 Ищу по футбольному каталогу…</div>' : state.globalSearch.warning ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.globalSearch.warning)}</div>` : '';
  }
  const teamHtml = teams.length ? `<section class="panel search-result-block"><div class="mini-section-head"><strong>Команды</strong><span>${teams.length}</span></div><div class="discovery-grid">${teams.slice(0,16).map(x => discoveryTeamCard(x, x.youthReserve ? 'Youth/Reserve' : '')).join('')}</div></section>` : '';
  const compHtml = comps.length ? `<section class="panel search-result-block"><div class="mini-section-head"><strong>Турниры</strong><span>${comps.length}</span></div><div class="discovery-grid">${comps.slice(0,10).map(x => discoveryCompetitionCard(x)).join('')}</div></section>` : '';
  out.innerHTML = teamHtml + compHtml || `<div class="empty">Ничего не найдено. Для команды вне сегодняшнего списка введите минимум 3 символа и нажмите «Найти».</div>`;
  bindDiscoveryActions(out);
}

async function runGlobalSearch() {
  const input = $('globalSearchInput');
  const query = String(input?.value || '').trim();
  state.globalSearch.query = query;
  state.globalSearch.warning = '';
  if (query.length < 3) { state.globalSearch.remoteTeams = []; state.globalSearch.remoteCompetitions = []; renderGlobalSearch(); return; }
  state.globalSearch.loading = true; renderGlobalSearch();
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
    state.globalSearch.remoteTeams = data.teams || [];
    state.globalSearch.remoteCompetitions = data.competitions || [];
    state.globalSearch.warning = data.warning || data.hint || '';
    state.globalSearch.searchedAt = data.refreshedAt || new Date().toISOString();
    if (data.provider) { state.provider = data.provider; renderProvider(); }
  } catch (e) {
    state.globalSearch.warning = e.message;
  } finally {
    state.globalSearch.loading = false; renderGlobalSearch();
  }
}

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

async function loadMatches() {
  $('matches').innerHTML = '<div class="loader">Загружаю матчи…</div>';
  $('matchesCount').textContent = '';
  if ($('dataNotice')) $('dataNotice').innerHTML = '';
  const labels = { '-1': 'Матчи вчера', '0': 'Матчи сегодня', '1': 'Матчи завтра' };
  $('matchesTitle').textContent = labels[String(state.offset)] || 'Матчи';
  try {
    const data = await api(`/api/matches?date=${localDate(state.offset)}`);
    state.matches = data.matches || [];
    state.matchesMeta = {
      refreshedAt: data.refreshedAt || null,
      stale: Boolean(data.stale),
      warning: data.warning || '',
      retryAfter: Number(data.retryAfter || 0),
      catalog: data.catalog || {},
    };
    if (data.provider) { state.provider = data.provider; renderProvider(); }
    if (state.filter === 'top' && !state.matches.some(x => x.featured || (Number(x.interestScore || 0) >= 68 && !x.lowPriority))) state.filter = 'all';
    syncFilterButtons();
    renderMatches();
    renderDiscoveryHome();
  } catch (e) {
    const retry = Number(e.payload?.retryAfter || 0);
    const suffix = retry ? `<br><span class="tiny">Повторите примерно через ${retry} сек.</span>` : '';
    $('matches').innerHTML = `<div class="empty">${escapeHtml(e.message)}${suffix}</div>`;
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
    if (state.filter === 'top') byFilter = Boolean(m.featured) || (Number(m.interestScore || 0) >= 68 && !m.lowPriority);
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

function categoryClass(category) {
  const c = String(category || 'other').replace(/[^a-z]/g, '');
  return `cat-${c || 'other'}`;
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

function competitionGroups(list) {
  const groups = new Map();
  for (const m of list) {
    const key = Number(m.leagueId || 0) || `${m.league || ''}:${m.country || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  return [...groups.values()].sort((a, b) => {
    const aLive = a.some(x => x.live) ? 1 : 0;
    const bLive = b.some(x => x.live) ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    const ap = Math.max(...a.map(x => Number(x.competition?.priority || 0)));
    const bp = Math.max(...b.map(x => Number(x.competition?.priority || 0)));
    if (ap !== bp) return bp - ap;
    const ai = Math.max(...a.map(x => Number(x.interestScore || 0)));
    const bi = Math.max(...b.map(x => Number(x.interestScore || 0)));
    if (ai !== bi) return bi - ai;
    return String(a[0]?.date || '').localeCompare(String(b[0]?.date || ''));
  });
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
    .slice(0, 7);
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
      ${m.live ? '<b>LIVE</b>' : ''}
    </button>`).join('');
  el.querySelectorAll('[data-open-tournament]').forEach(btn => btn.addEventListener('click', () => openTournament(Number(btn.dataset.openTournament))));
}

function matchCardHtml(m, { grouped = false } = {}) {
  return `
    <article class="match-card ${Number(m.interestScore || 0) >= 50 ? 'top-match' : ''}">
      ${grouped ? '' : `<div class="match-meta"><span class="competition-name">${m.featured ? '<b class="top-tag">ГЛАВНЫЙ</b> ' : ''}${escapeHtml(m.league || 'Турнир')}</span><span>${escapeHtml(m.country || '')}</span></div>`}
      <div class="catalog-row">
        ${m.category ? `<span class="competition-chip ${categoryClass(m.category)}">${escapeHtml(categoryLabel(m.category))}</span>` : ''}
        ${m.roundLabel ? `<span class="round-chip">${escapeHtml(m.roundLabel)}</span>` : ''}
        <span class="coverage-mini">Покрытие: ${escapeHtml(coverageLabel(m.coverageTier).text)}</span>
      </div>
      <div class="interest-row">
        <span>Индекс интереса</span>
        <strong>${Number(m.interestScore || 0)}/100 · ${interestLabel(m.interestScore)}</strong>
      </div>
      <div class="team-row">
        <div class="team">
          <button class="fav-star ${isFavorite(m.home?.id) ? 'active' : ''}" type="button" data-team-id="${Number(m.home?.id)}" data-team-name="${escapeHtml(m.home?.name || '')}" data-team-logo="${escapeHtml(m.home?.logo || '')}" aria-label="Избранное">${isFavorite(m.home?.id) ? '★' : '☆'}</button>
          <button class="team-open-link match-team-open" type="button" data-open-team="${Number(m.home?.id)}" data-team-name="${escapeHtml(m.home?.name || '')}" data-team-logo="${escapeHtml(m.home?.logo || '')}">
            ${m.home?.logo ? `<img src="${safeUrl(m.home.logo)}" alt="">` : ''}
            <strong>${escapeHtml(m.home?.name || '')}</strong>
          </button>
        </div>
        <div class="kickoff ${m.live ? 'live-kickoff' : ''}">${escapeHtml(matchCenter(m))}</div>
        <div class="team away">
          <button class="team-open-link match-team-open away-open" type="button" data-open-team="${Number(m.away?.id)}" data-team-name="${escapeHtml(m.away?.name || '')}" data-team-logo="${escapeHtml(m.away?.logo || '')}">
            <strong>${escapeHtml(m.away?.name || '')}</strong>
            ${m.away?.logo ? `<img src="${safeUrl(m.away.logo)}" alt="">` : ''}
          </button>
          <button class="fav-star ${isFavorite(m.away?.id) ? 'active' : ''}" type="button" data-team-id="${Number(m.away?.id)}" data-team-name="${escapeHtml(m.away?.name || '')}" data-team-logo="${escapeHtml(m.away?.logo || '')}" aria-label="Избранное">${isFavorite(m.away?.id) ? '★' : '☆'}</button>
        </div>
      </div>
      ${m.live
        ? `<button class="analyze-btn live-center-btn" data-center="${Number(m.fixtureId)}">${m.youthReserve ? '🔴 LIVE-счёт' : '🔴 LIVE-центр'}</button>`
        : m.finished
          ? `<button class="analyze-btn finished-btn" data-center="${Number(m.fixtureId)}">📋 Итоги матча</button>`
          : `<button class="analyze-btn" data-fixture="${Number(m.fixtureId)}">🧠 Предматчевый анализ</button>`}
    </article>`;
}

function bindMatchActions(root = document) {
  root.querySelectorAll('.analyze-btn[data-fixture]').forEach(btn => {
    btn.addEventListener('click', () => analyzeMatch(Number(btn.dataset.fixture), btn));
  });
  root.querySelectorAll('.analyze-btn[data-center]').forEach(btn => {
    btn.addEventListener('click', () => openMatchCenter(Number(btn.dataset.center), btn));
  });
  root.querySelectorAll('.fav-star').forEach(btn => btn.addEventListener('click', () => toggleFavorite({
    id: Number(btn.dataset.teamId), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '',
  })));
  root.querySelectorAll('[data-open-tournament]').forEach(btn => btn.addEventListener('click', () => openTournament(Number(btn.dataset.openTournament))));
  root.querySelectorAll('[data-open-team]').forEach(btn => btn.addEventListener('click', () => openTeam({ id: Number(btn.dataset.openTeam), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '' })));
}

function renderMatches() {
  const list = filteredMatches();
  const age = relativeAge(state.matchesMeta?.refreshedAt);
  const catalog = state.matchesMeta?.catalog || {};
  const groups = competitionGroups(list);
  const bits = [`Показано: ${list.length} из ${state.matches.length}`];
  if (groups.length) bits.push(`турниров: ${groups.length}`);
  if (Number(catalog.live || 0) > 0) bits.push(`LIVE: ${Number(catalog.live)}`);
  if (Number(catalog.featured || 0) > 0) bits.push(`главных: ${Number(catalog.featured)}`);
  if (age) bits.push(`обновлено ${age}`);
  $('matchesCount').textContent = bits.join(' · ');
  renderPopularCompetitions();
  if ($('dataNotice')) {
    $('dataNotice').innerHTML = state.matchesMeta?.stale
      ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.matchesMeta.warning || 'Показаны последние сохранённые данные.')}</div>`
      : '';
  }
  if (!list.length) {
    const extra = state.filter !== 'all' ? '<button id="showAllBtn" class="secondary-btn" type="button">Показать все матчи</button>' : '';
    $('matches').innerHTML = `<div class="empty">По выбранному фильтру матчей не найдено.${extra}</div>`;
    $('showAllBtn')?.addEventListener('click', () => { state.filter = 'all'; syncFilterButtons(); renderMatches(); });
    return;
  }

  $('matches').innerHTML = groups.map(rows => {
    const first = rows[0];
    const liveCount = rows.filter(x => x.live).length;
    return `<section class="competition-group">
      <button class="competition-group-head" type="button" data-open-tournament="${Number(first.leagueId)}">
        <span class="competition-group-logo">${first.leagueLogo ? `<img src="${safeUrl(first.leagueLogo)}" alt="">` : '🏆'}</span>
        <span class="competition-group-main"><strong>${escapeHtml(first.league || 'Турнир')}</strong><small>${escapeHtml(first.country || '')}${first.season ? ` · сезон ${Number(first.season)}` : ''}</small></span>
        <span class="competition-group-count">${liveCount ? `<b>${liveCount} LIVE</b>` : ''}<small>${rows.length} ${rows.length === 1 ? 'матч' : 'матчей'}</small><i>›</i></span>
      </button>
      <div class="competition-group-matches">${rows.map(m => matchCardHtml(m, { grouped: true })).join('')}</div>
    </section>`;
  }).join('');
  bindMatchActions($('matches'));
}

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
      <div><span>LIVE сейчас</span><strong>${live}</strong></div>
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
          <td><button class="standing-team team-open-link" type="button" data-open-team="${Number(row.team?.id)}" data-team-name="${escapeHtml(row.team?.name || '')}" data-team-logo="${escapeHtml(row.team?.logo || '')}">${row.team?.logo ? `<img src="${safeUrl(row.team.logo)}" alt="">` : ''}<strong>${escapeHtml(row.team?.name || '')}</strong></button></td>
          <td>${Number(row.played)}</td><td class="wide-stat">${Number(row.win)}</td><td class="wide-stat">${Number(row.draw)}</td><td class="wide-stat">${Number(row.lose)}</td>
          <td>${Number(row.goalsFor)}:${Number(row.goalsAgainst)}</td><td class="${Number(row.goalsDiff) > 0 ? 'positive' : Number(row.goalsDiff) < 0 ? 'negative' : ''}">${Number(row.goalsDiff) > 0 ? '+' : ''}${Number(row.goalsDiff)}</td><td><b>${Number(row.points)}</b></td><td>${standingFormHtml(row.form)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="tiny table-note">Таблица загружается только при открытии этой вкладки и кэшируется на 6 часов, чтобы не расходовать бесплатную квоту API.</p>
    </section>`).join('')}`;
  el.querySelectorAll('[data-open-team]').forEach(btn => btn.addEventListener('click', () => openTeam({ id: Number(btn.dataset.openTeam), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '' })));
}

async function loadTournamentStandings(force = false) {
  const t = state.currentTournament;
  if (!t) return;
  const key = tournamentKey(t);
  const el = $('tournamentTable');
  if (!force && state.tournamentStandings.has(key)) {
    renderTournamentStandings(state.tournamentStandings.get(key));
    return;
  }
  el.innerHTML = '<div class="loader">Загружаю таблицу турнира…</div>';
  try {
    const data = await api(`/api/tournament?leagueId=${Number(t.leagueId)}&season=${Number(t.season)}`);
    state.tournamentStandings.set(key, data);
    if (data.provider) { state.provider = data.provider; renderProvider(); }
    renderTournamentStandings(data);
  } catch (e) {
    el.innerHTML = `<div class="empty compact-empty">${escapeHtml(e.message)}</div>`;
  }
}

function setTournamentTab(tab, load = true) {
  document.querySelectorAll('.tournament-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tournamentTab === tab));
  $('tournamentMatchesPanel').classList.toggle('active', tab === 'matches');
  $('tournamentTablePanel').classList.toggle('active', tab === 'table');
  if (tab === 'table' && load) loadTournamentStandings(false);
}


function activeViewId() { return document.querySelector('.view.active')?.id || 'matchesView'; }
function teamResultBadge(result) {
  const r = String(result || '').toUpperCase();
  if (!['W','D','L'].includes(r)) return '';
  return `<span class="team-result ${r === 'W' ? 'win' : r === 'D' ? 'draw' : 'loss'}">${r === 'W' ? 'В' : r === 'D' ? 'Н' : 'П'}</span>`;
}
function teamMatchRow(m) {
  const center = m.live ? `<button class="mini-match-action live" type="button" data-center="${Number(m.fixtureId)}">LIVE</button>` : m.finished ? `<span class="team-score">${m.score?.home ?? '—'} : ${m.score?.away ?? '—'}</span>` : `<button class="mini-match-action" type="button" data-fixture="${Number(m.fixtureId)}">Анализ</button>`;
  return `<article class="team-fixture-row"><div class="team-fixture-date"><strong>${escapeHtml(dateTime(m.date))}</strong><small>${escapeHtml(m.roundLabel || m.league || '')}</small></div><div class="team-fixture-opponent">${m.opponent?.logo ? `<img src="${safeUrl(m.opponent.logo)}" alt="">` : '<span>⚽</span>'}<div><strong>${escapeHtml(m.opponent?.name || '')}</strong><small>${m.venue === 'home' ? 'Дома' : 'В гостях'} · ${escapeHtml(m.league || '')}</small></div></div><div class="team-fixture-outcome">${teamResultBadge(m.result)}${center}</div></article>`;
}
function bindTeamFixtureActions(root) {
  root.querySelectorAll('[data-fixture]').forEach(btn => btn.addEventListener('click', () => analyzeMatch(Number(btn.dataset.fixture), btn)));
  root.querySelectorAll('[data-center]').forEach(btn => btn.addEventListener('click', () => openMatchCenter(Number(btn.dataset.center), btn)));
  root.querySelectorAll('[data-open-tournament]').forEach(btn => btn.addEventListener('click', openTournamentFromTeam));
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
function renderTeamIntelligence(data) {
  const el = $('teamIntelligence'); if (!el) return;
  if (!data?.available || !data?.stats?.available) {
    el.innerHTML = `<div class="empty compact-empty">${escapeHtml(data?.reason || 'Сезонная статистика для этой команды сейчас недоступна.')}</div>`;
    return;
  }
  const s=data.stats, f=s.fixtures||{}, d=s.derived||{}, g=s.goals||{}, b=s.biggest||{};
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
    <section class="panel season-records">
      <h2>📌 Максимумы сезона</h2>
      <div class="season-record-grid">
        <div><span>Крупнейшая победа дома</span><strong>${escapeHtml(b.winHome || '—')}</strong></div>
        <div><span>Крупнейшая победа в гостях</span><strong>${escapeHtml(b.winAway || '—')}</strong></div>
        <div><span>Крупнейшее поражение дома</span><strong>${escapeHtml(b.lossHome || '—')}</strong></div>
        <div><span>Крупнейшее поражение в гостях</span><strong>${escapeHtml(b.lossAway || '—')}</strong></div>
      </div>
      <p class="tiny">Данные этой вкладки загружаются только при открытии и кэшируются на 6 часов.</p>
    </section>`;
}
async function loadTeamIntelligence(force=false) {
  const team=state.currentTeam, comp=team?.data?.primaryCompetition, el=$('teamIntelligence');
  if(!team?.id || !el) return;
  if(!comp?.leagueId || !comp?.season){ el.innerHTML='<div class="empty compact-empty">Сначала нужно определить основной турнир команды.</div>'; return; }
  const key=`${Number(team.id)}:${Number(comp.leagueId)}:${Number(comp.season)}`;
  if(!force && state.teamIntelligenceCache.has(key)){ renderTeamIntelligence(state.teamIntelligenceCache.get(key)); return; }
  el.innerHTML='<div class="loader">Загружаю сезонную статистику…</div>';
  const q=new URLSearchParams({teamId:String(Number(team.id)),leagueId:String(Number(comp.leagueId)),season:String(Number(comp.season)),teamName:team.name||'',teamLogo:team.logo||'',leagueName:comp.name||'',leagueLogo:comp.logo||'',country:comp.country||''});
  try{const data=await api(`/api/team/intelligence?${q.toString()}`);state.teamIntelligenceCache.set(key,data);if(data.provider){state.provider=data.provider;renderProvider();}renderTeamIntelligence(data);}catch(e){el.innerHTML=`<div class="empty compact-empty">${escapeHtml(e.message)}</div>`;}
}
function playerCard(p) {
  return `<div class="squad-player">${p.photo?`<img src="${safeUrl(p.photo)}" alt="">`:'<span class="squad-avatar">👤</span>'}<div><strong>${escapeHtml(p.name||'')}</strong><small>${p.number?`№${Number(p.number)} · `:''}${p.age?`${Number(p.age)} лет`:'Возраст —'}</small></div></div>`;
}
function renderTeamSquad(data) {
  const el=$('teamSquad'); if(!el) return;
  if(!data?.available || !data?.groups?.length){el.innerHTML=`<div class="empty compact-empty">${escapeHtml(data?.reason||'Состав команды сейчас недоступен.')}</div>`;return;}
  const sm=data.summary||{};
  const warning=data.stale?`<div class="data-notice stale">⚠️ ${escapeHtml(data.warning||'Показан сохранённый состав.')}</div>`:'';
  el.innerHTML=`${warning}<section class="panel squad-summary-panel"><div class="mini-section-head"><strong>👥 Состав команды</strong><span>${Number(sm.total||0)} игроков</span></div><div class="squad-summary-grid"><div><span>Средний возраст</span><strong>${sm.averageAge??'—'}</strong></div><div><span>Вратари</span><strong>${Number(sm.goalkeepers||0)}</strong></div><div><span>Защитники</span><strong>${Number(sm.defenders||0)}</strong></div><div><span>Полузащитники</span><strong>${Number(sm.midfielders||0)}</strong></div><div><span>Нападающие</span><strong>${Number(sm.attackers||0)}</strong></div></div></section>${data.groups.map(group=>`<section class="panel squad-group"><div class="mini-section-head"><strong>${escapeHtml(group.label||'Игроки')}</strong><span>${group.players?.length||0}</span></div><div class="squad-player-grid">${(group.players||[]).map(playerCard).join('')}</div></section>`).join('')}<p class="tiny squad-cache-note">Состав загружается только при открытии вкладки и кэшируется на 12 часов. Статистика отдельных игроков будет подключена после перехода на расширенный API-план.</p>`;
}
async function loadTeamSquad(force=false) {
  const team=state.currentTeam, el=$('teamSquad'); if(!team?.id||!el) return;
  const key=String(Number(team.id)); if(!force&&state.teamSquadCache.has(key)){renderTeamSquad(state.teamSquadCache.get(key));return;}
  el.innerHTML='<div class="loader">Загружаю состав…</div>';
  try{const data=await api(`/api/team/squad?teamId=${Number(team.id)}`);state.teamSquadCache.set(key,data);if(data.provider){state.provider=data.provider;renderProvider();}renderTeamSquad(data);}catch(e){el.innerHTML=`<div class="empty compact-empty">${escapeHtml(e.message)}</div>`;}
}

function renderTeamHub(data) {
  const team = data?.team || state.currentTeam || {}; state.currentTeam = { ...state.currentTeam, ...team, data };
  const fav = isFavorite(team.id), comp = data?.primaryCompetition, standing = data?.standing, form = data?.form, next = data?.liveNow || data?.nextMatch;
  const stale = data?.stale ? `<div class="data-notice stale">⚠️ ${escapeHtml(data.warning || 'Показаны сохранённые данные команды.')}</div>` : '';
  $('teamHero').innerHTML = `${stale}<section class="panel team-hero"><div class="team-hero-main"><div class="team-hero-logo">${team.logo ? `<img src="${safeUrl(team.logo)}" alt="">` : '⚽'}</div><div class="team-hero-copy"><span>СТРАНИЦА КОМАНДЫ</span><h2>${escapeHtml(team.name || 'Команда')}</h2><p>${comp ? `${escapeHtml(comp.name)} · ${escapeHtml(comp.country || '')}` : 'Турнир определяется по последним матчам'}</p></div><button id="teamFavoriteBtn" class="team-favorite-big ${fav ? 'active' : ''}" type="button">${fav ? '★' : '☆'}</button></div><div class="team-hero-stats"><div><span>Форма</span><strong>${form?.form ? escapeHtml(form.form.replace(/W/g,'В').replace(/D/g,'Н').replace(/L/g,'П')) : '—'}</strong></div><div><span>Очки / матч</span><strong>${form?.ppg ?? '—'}</strong></div><div><span>Голы</span><strong>${form ? `${form.gfAvg} / ${form.gaAvg}` : '—'}</strong></div><div><span>Место</span><strong>${standing?.rank ? `${standing.rank}` : '—'}</strong></div></div>${comp ? `<button id="teamTournamentBtn" class="secondary-btn team-tournament-btn" type="button">🏆 ${escapeHtml(comp.shortName || comp.name)} · открыть турнир</button>` : ''}</section>`;
  $('teamFavoriteBtn')?.addEventListener('click', async () => { await toggleFavorite({ id:Number(team.id), name:team.name||'', logo:team.logo||'' }); renderTeamHub(state.currentTeam?.data || data); });
  $('teamTournamentBtn')?.addEventListener('click', openTournamentFromTeam);
  const formHtml = form ? `<section class="panel team-form-panel"><h2>📈 Последние ${Number(form.sample || 0)} матчей</h2><div class="team-form-line">${String(form.form || '').split('').map(teamResultBadge).join('')}</div><div class="team-kpi-grid"><div><span>Победы</span><strong>${Number(form.wins||0)}</strong></div><div><span>Ничьи</span><strong>${Number(form.draws||0)}</strong></div><div><span>Поражения</span><strong>${Number(form.losses||0)}</strong></div><div><span>Забивает</span><strong>${form.gfAvg ?? '—'}</strong></div><div><span>Пропускает</span><strong>${form.gaAvg ?? '—'}</strong></div><div><span>ОЗ</span><strong>${form.bttsPct ?? '—'}%</strong></div></div></section>` : '<section class="panel"><div class="empty compact-empty">Пока недостаточно завершённых матчей для формы.</div></section>';
  const nextHtml = next ? `<section class="panel next-team-match"><div class="mini-section-head"><strong>${next.live ? '🔴 Матч идёт' : '⏭ Ближайший матч'}</strong><span>${escapeHtml(dateTime(next.date))}</span></div>${teamMatchRow(next)}</section>` : '<section class="panel"><div class="empty compact-empty">Ближайший матч в доступном окне не найден.</div></section>';
  const positionHtml = standing ? `<section class="panel team-standing-card"><h2>🏆 Положение в турнире</h2><div class="team-standing-summary"><strong>${Number(standing.rank)} место</strong><span>${Number(standing.points)} очков · ${Number(standing.played)} матчей · ${Number(standing.goalsFor)}:${Number(standing.goalsAgainst)}</span></div></section>` : `<section class="panel team-standing-card"><h2>🏆 Положение в турнире</h2><p class="muted">Позиция появится после загрузки таблицы турнира. Так мы не расходуем отдельный API-запрос автоматически.</p>${comp ? '<button class="secondary-btn" type="button" data-open-tournament="1">Открыть турнир и таблицу</button>' : ''}</section>`;
  $('teamOverview').innerHTML = `${nextHtml}${formHtml}${positionHtml}`; bindTeamFixtureActions($('teamOverview'));
  $('teamResults').innerHTML = data?.recent?.length ? `<div class="team-fixtures-list">${data.recent.map(teamMatchRow).join('')}</div>` : '<div class="empty">Завершённых матчей в доступном окне нет.</div>';
  $('teamSchedule').innerHTML = data?.upcoming?.length ? `<div class="team-fixtures-list">${data.upcoming.map(teamMatchRow).join('')}</div>` : '<div class="empty">Предстоящих матчей в доступном окне нет.</div>';
  bindTeamFixtureActions($('teamResults')); bindTeamFixtureActions($('teamSchedule'));
}
async function loadTeamHub(team, force=false) {
  const key=String(Number(team?.id||0)); if (!key || key==='0') return;
  const cached=state.teamCache.get(key); if (cached && !force) { renderTeamHub(cached); return; }
  $('teamHero').innerHTML='<div class="loader">Загружаю страницу команды…</div>'; $('teamOverview').innerHTML=''; $('teamIntelligence').innerHTML='<div class="empty compact-empty">Откройте вкладку «Статистика», чтобы загрузить сезонные данные.</div>'; $('teamSquad').innerHTML='<div class="empty compact-empty">Откройте вкладку «Состав», чтобы загрузить игроков.</div>'; $('teamResults').innerHTML=''; $('teamSchedule').innerHTML='';
  try { const q=new URLSearchParams({teamId:String(Number(team.id)),name:team.name||'',logo:team.logo||''}); const data=await api(`/api/team?${q.toString()}`); state.teamCache.set(key,data); if(data.provider){state.provider=data.provider;renderProvider();} renderTeamHub(data); }
  catch(e){ $('teamHero').innerHTML=`<div class="empty">${escapeHtml(e.message)}</div>`; }
}
function openTeam(team) {
  if(!team?.id) return; rememberTeam(team); renderDiscoveryHome(); const current=activeViewId(); if(current!=='teamView') state.teamBackView=current;
  state.currentTeam={id:Number(team.id),name:team.name||'',logo:team.logo||'',data:null}; setTeamTab('overview'); showView('teamView'); loadTeamHub(state.currentTeam,false);
}
function setTeamTab(tab) {
  document.querySelectorAll('.team-tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.teamTab===tab));
  $('teamOverviewPanel')?.classList.toggle('active',tab==='overview');
  $('teamIntelligencePanel')?.classList.toggle('active',tab==='intelligence');
  $('teamSquadPanel')?.classList.toggle('active',tab==='squad');
  $('teamResultsPanel')?.classList.toggle('active',tab==='results');
  $('teamSchedulePanel')?.classList.toggle('active',tab==='schedule');
  if(tab==='intelligence') loadTeamIntelligence(false);
  if(tab==='squad') loadTeamSquad(false);
}
function openTournamentFromTeam() {
  state.tournamentBackView = 'teamView';
  const comp=state.currentTeam?.data?.primaryCompetition; if(!comp?.leagueId) return toast('Основной турнир команды пока не определён.');
  const existing=state.matches.find(m=>Number(m.leagueId)===Number(comp.leagueId)); if(existing) return openTournament(Number(comp.leagueId));
  state.currentTournament={leagueId:Number(comp.leagueId),season:Number(comp.season||new Date().getFullYear()),name:comp.name||'Турнир',shortName:comp.shortName||comp.name||'Турнир',country:comp.country||'',logo:comp.logo||'',category:comp.category||'',tier:comp.tier||'standard'};
  renderTournamentHero(); renderTournamentMatches(); setTournamentTab('table',true); showView('tournamentView');
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


function signedPp(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)} п.п.`;
}

function oddsMovementHtml(move) {
  if (!move?.baseline || !move?.probabilityChange) return '<p class="muted">История движения появится после нескольких LIVE-снимков.</p>';
  const row = (label, key) => {
    const d = Number(move.probabilityChange?.[key] || 0);
    const cls = d > .4 ? 'up' : d < -.4 ? 'down' : 'flat';
    const arrow = d > .4 ? '↑' : d < -.4 ? '↓' : '→';
    return `<div class="odds-move-row ${cls}"><span>${label}</span><strong>${move.baseline?.[key] ?? '—'} → ${move.current?.[key] ?? '—'}</strong><b>${arrow} ${signedPp(d)}</b></div>`;
  };
  return `<div class="odds-movement-grid">${row('П1','home')}${row('X','draw')}${row('П2','away')}</div><p class="tiny">Сравнение с самым ранним сохранённым LIVE-снимком${move.from ? ` · ${dateTime(move.from)}` : ''}. Изменение указано в implied probability.</p>`;
}

function livePressureHtml(p, m) {
  if (!p) return '';
  const home = Math.max(0, Math.min(100, Number(p.home || 0)));
  const away = 100 - home;
  const lead = p.leader === 'home' ? m.home?.name : p.leader === 'away' ? m.away?.name : 'Баланс';
  return `<section class="panel pulse-panel"><h2>⚡ Пульс матча</h2><div class="pulse-names"><span>${escapeHtml(m.home?.name || '')}</span><strong>${escapeHtml(lead || 'Баланс')}</strong><span>${escapeHtml(m.away?.name || '')}</span></div><div class="pulse-bar"><i style="width:${home}%"></i><b style="width:${away}%"></b></div><div class="pulse-values"><span>${home}</span><span>${away}</span></div><p class="tiny">${escapeHtml(p.note || '')}</p></section>`;
}

function playerMetricText(p) {
  const bits = [];
  if (Number(p.goals)) bits.push(`${p.goals} гол`);
  if (Number(p.assists)) bits.push(`${p.assists} ассист`);
  if (Number(p.saves)) bits.push(`${p.saves} сейв`);
  if (Number(p.shotsOn)) bits.push(`${p.shotsOn} в створ`);
  if (Number(p.keyPasses)) bits.push(`${p.keyPasses} ключ. пас`);
  if (!bits.length && Number(p.minutes)) bits.push(`${p.minutes} мин`);
  return bits.join(' · ') || '—';
}

function playerLeadersHtml(leaders, m) {
  const side = (title, list) => `<div class="player-leader-side"><h3>${escapeHtml(title)}</h3>${list?.length ? list.map((p,i) => `<div class="player-leader-row">${p.photo ? `<img src="${safeUrl(p.photo)}" alt="">` : '<span class="player-photo-placeholder">👤</span>'}<div><strong>${i+1}. ${escapeHtml(p.name)}</strong><small>${escapeHtml(playerMetricText(p))}</small></div><b>${p.rating ? p.rating.toFixed(1) : '—'}</b></div>`).join('') : '<p class="muted">Статистика игроков недоступна.</p>'}</div>`;
  return `<div class="player-leaders-grid">${side(m.home?.name || 'Хозяева', leaders?.home || [])}${side(m.away?.name || 'Гости', leaders?.away || [])}</div>`;
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

    ${d.stale ? `<section class="panel stale-panel"><strong>⚠️ Показан последний сохранённый LIVE-снимок</strong><p>${escapeHtml(d.warning || 'Провайдер временно ограничил запросы.')}</p></section>` : ''}
    ${d.note ? `<section class="panel"><p class="tiny warning">${escapeHtml(d.note)}</p></section>` : ''}

    ${live ? `<section class="panel provider-live-panel">
      <h2>📡 Источник LIVE</h2>
      <div class="provider-live-grid">
        <div><span>План данных</span><strong>${escapeHtml(d.provider?.plan || 'UNKNOWN')}</strong></div>
        <div><span>Обновление</span><strong>${Number(d.refreshSeconds || 60)} сек.</strong></div>
        <div><span>Live odds</span><strong>${d.liveOdds ? 'Доступны' : (d.provider?.liveOddsReady ? 'Нет рынка' : 'Платный режим')}</strong></div>
        <div><span>Player stats</span><strong>${d.availability?.players ? 'Доступны' : (d.provider?.playerStatsReady ? 'Нет данных' : 'PRO+')}</strong></div>
      </div>
    </section>` : ''}

    ${livePressureHtml(d.livePressure, m)}

    ${d.liveOdds ? `<section class="panel">
      <h2>💹 LIVE-коэффициенты 1X2</h2>
      <div class="odds-grid">
        <div><span>П1</span><strong>${d.liveOdds.odds?.home ?? '—'}</strong></div>
        <div><span>X</span><strong>${d.liveOdds.odds?.draw ?? '—'}</strong></div>
        <div><span>П2</span><strong>${d.liveOdds.odds?.away ?? '—'}</strong></div>
      </div>
      <p class="tiny">Источников в live-выборке: ${Number(d.liveOdds.sources || 0)}${d.liveOdds.updatedAt ? ` · обновление ${escapeHtml(String(d.liveOdds.updatedAt))}` : ''}</p>
      <div class="odds-movement-wrap"><h3>Движение рынка</h3>${oddsMovementHtml(d.oddsMovement)}</div>
    </section>` : ''}

    <section class="panel">
      <h2>📊 ${live ? 'LIVE-статистика' : 'Статистика матча'}</h2>
      <div style="margin-top:12px">${liveStatsHtml(d.statistics, m)}</div>
    </section>

    ${(d.playerLeaders?.home?.length || d.playerLeaders?.away?.length) ? `<section class="panel"><h2>⭐ Игроки матча</h2><p class="tiny">Рейтинг и ключевые действия по данным провайдера. Не все турниры поддерживают player stats.</p>${playerLeadersHtml(d.playerLeaders, m)}</section>` : ''}

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
        <span>${d.availability?.players ? '✅' : '—'} Игроки</span>
        <span>${d.oddsMovement?.baseline ? '✅' : '—'} Движение линии</span>
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
    if (e.status === 429 && String(e.payload?.code || '').startsWith('FOOTBALL_')) {
      toast(e.payload?.retryAfter ? `Футбольный API на паузе. Повторите через ~${e.payload.retryAfter} сек.` : e.message);
    } else if (e.status === 429) toast('Дневной лимит анализов исчерпан.');
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


function comparisonValue(metric, side) {
  const value = Number(metric?.[side === 'home' ? 'homeValue' : 'awayValue']);
  if (!Number.isFinite(value)) return '—';
  if (metric.format === 'percent') return `${Math.round(value)}%`;
  if (metric.format === 'rank') return `${Math.round(value)} место`;
  if (metric.format === 'integer') return String(Math.round(value));
  return value.toFixed(1);
}

function comparisonMetricRow(metric) {
  const edge = metric?.edge || 'even';
  const edgeLabel = edge === 'home' ? '← преимущество' : edge === 'away' ? 'преимущество →' : '≈ близко';
  return `<div class="comparison-row ${escapeHtml(edge)}">
    <div class="comparison-values"><strong>${comparisonValue(metric,'home')}</strong><span>${escapeHtml(metric.label || '')}</span><strong>${comparisonValue(metric,'away')}</strong></div>
    <div class="comparison-track"><i class="home"></i><b>${escapeHtml(edgeLabel)}</b><i class="away"></i></div>
    ${metric.note ? `<small>${escapeHtml(metric.note)}</small>` : ''}
  </div>`;
}

function comparisonAdvantages(title, items = [], side = '') {
  return `<div class="comparison-advantages-card ${side}"><strong>${escapeHtml(title)}</strong>${items.length
    ? `<ul>${items.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`
    : '<p>Явного перевеса по доступным метрикам нет.</p>'}</div>`;
}

function comparisonTeamHeader(team, side, edges) {
  return `<button class="comparison-team-head ${side}" type="button" data-open-team="${Number(team?.id || 0)}" data-team-name="${escapeHtml(team?.name || '')}" data-team-logo="${safeUrl(team?.logo || '')}">
    ${team?.logo ? `<img src="${safeUrl(team.logo)}" alt="">` : '<span class="comparison-logo-placeholder">⚽</span>'}
    <span><strong>${escapeHtml(team?.name || '')}</strong><small>${Number(edges || 0)} метрик с преимуществом</small></span>
  </button>`;
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
  const comparison = d.comparison || { metrics: [], advantages: { home: [], away: [] }, score: { home: 0, away: 0, even: 0 }, dataReuse: {} };
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
        <span>${d.stale ? '⚠️ Устаревший кэш' : d.cached ? '⚡ Кэш' : '🆕 Свежий'} · ${d.completeness?.score ?? 0}/${d.completeness?.max ?? 10}</span>
        <span>Обновлено ${d.generatedAt ? `${timeOf(d.generatedAt)} · ${relativeAge(d.generatedAt)}` : '—'}</span>
      </div>

      <div class="experience-actions">
        <button id="reminderBtn" class="reminder-btn ${reminderActive ? 'active' : ''}" type="button">${reminderActive ? `🔔 За ${Number(activeReminder?.remindBeforeMinutes || 30)} мин.${activeReminder?.kickoffNotify ? ' + старт' : ''}` : `🔕 Напомнить за ${Number(state.preferences?.reminderMinutes || 30)} минут`}</button>
        <button id="shareAnalysisBtn" class="share-analysis-btn" type="button">↗ Поделиться</button>
      </div>
    </section>

    ${d.stale ? `<section class="panel stale-panel"><strong>⚠️ Использован последний сохранённый анализ</strong><p>${escapeHtml(d.warning || 'Свежие данные временно недоступны из-за ограничения провайдера.')}</p></section>` : ''}

    <div class="analysis-tabs" role="tablist">
      <button class="analysis-tab-btn active" data-tab="overview" type="button">Обзор</button>
      <button class="analysis-tab-btn" data-tab="form" type="button">Форма</button>
      <button class="analysis-tab-btn" data-tab="comparison" type="button">Сравнение</button>
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

    <div class="analysis-tab-panel" data-panel="comparison">
      <section class="panel comparison-hero-panel">
        <div class="comparison-heads">
          ${comparisonTeamHeader(m.home, 'home', comparison.score?.home)}
          <div class="comparison-score"><span>МЕТРИКИ</span><strong>${Number(comparison.score?.home || 0)} : ${Number(comparison.score?.away || 0)}</strong><small>${Number(comparison.score?.even || 0)} близких</small></div>
          ${comparisonTeamHeader(m.away, 'away', comparison.score?.away)}
        </div>
        <div class="comparison-balance">${escapeHtml(comparison.balanceLabel || 'Сравнение строится по доступным данным')}</div>
      </section>

      <section class="panel">
        <div class="comparison-section-head"><h2>⚖️ Команда к команде</h2><span>${comparison.metrics?.length || 0} метрик</span></div>
        ${comparison.metrics?.length ? `<div class="comparison-metrics">${comparison.metrics.map(comparisonMetricRow).join('')}</div>` : '<div class="empty compact-empty">Недостаточно сопоставимых данных для детального сравнения.</div>'}
      </section>

      <section class="panel">
        <h2>🔎 Ключевые преимущества</h2>
        <div class="comparison-advantages-grid">
          ${comparisonAdvantages(m.home?.name || 'Хозяева', comparison.advantages?.home || [], 'home')}
          ${comparisonAdvantages(m.away?.name || 'Гости', comparison.advantages?.away || [], 'away')}
        </div>
      </section>

      <section class="panel comparison-reuse-panel">
        <div class="comparison-section-head"><h2>♻️ Переиспользование данных</h2><span>+${Number(comparison.dataReuse?.separateApiRequests || 0)} API</span></div>
        <p>${escapeHtml(comparison.dataReuse?.note || 'Сравнение использует уже загруженные данные.')}</p>
        <div class="reuse-chips">${(comparison.dataReuse?.sources || []).map(x=>`<span>${escapeHtml(x)}</span>`).join('')}</div>
        <div class="reuse-status"><span>${comparison.dataReuse?.seasonStatsCached ? '✓' : '—'} Сезонная статистика из кэша</span><span>${comparison.dataReuse?.standingsCached ? '✓' : '—'} Таблица из кэша</span></div>
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
          <div><span>Статус</span><strong>${d.stale ? 'Устаревший кэш' : d.cached ? 'Кэш' : 'Свежий'}</strong></div>
          <div><span>Режим данных</span><strong>${escapeHtml(d.dataPolicy?.mode || 'standard')}</strong></div>
        </div>
        ${d.dataPolicy?.skipped?.length ? `<div class="policy-list"><strong>Что было пропущено для экономии/качества:</strong><ul>${d.dataPolicy.skipped.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>` : ''}
        <p class="tiny warning">${escapeHtml(d.disclaimer || '')}</p>
      </section>
    </div>
  `;

  $('reminderBtn')?.addEventListener('click', () => toggleReminder(m));
  $('shareAnalysisBtn')?.addEventListener('click', () => shareAnalysis(d));
  $('analysis')?.querySelectorAll('[data-open-team]').forEach(btn => btn.addEventListener('click', () => openTeam({
    id: Number(btn.dataset.openTeam), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '',
  })));
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

$('globalSearchBtn')?.addEventListener('click', runGlobalSearch);
$('globalSearchInput')?.addEventListener('input', e => { state.globalSearch.query = e.target.value || ''; state.globalSearch.remoteTeams = []; state.globalSearch.remoteCompetitions = []; state.globalSearch.warning = ''; renderGlobalSearch(); });
$('globalSearchInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runGlobalSearch(); } });
$('clearRecentTeamsBtn')?.addEventListener('click', clearRecentTeams);
$('refreshBtn').addEventListener('click', loadMatches);
$('historyRefreshBtn').addEventListener('click', () => loadHistory(true));
$('backBtn').addEventListener('click', () => showView('matchesView'));
$('tournamentBackBtn')?.addEventListener('click', () => showView(state.tournamentBackView || 'matchesView'));
$('teamBackBtn')?.addEventListener('click', () => showView(state.teamBackView || 'matchesView'));
document.querySelectorAll('.tournament-tab').forEach(btn => btn.addEventListener('click', () => setTournamentTab(btn.dataset.tournamentTab || 'matches')));
document.querySelectorAll('.team-tab').forEach(btn => btn.addEventListener('click', () => setTeamTab(btn.dataset.teamTab || 'overview')));
$('profileBtn').addEventListener('click', () => showView('profileView'));
$('navMatches').addEventListener('click', () => showView('matchesView'));
$('navSearch')?.addEventListener('click', () => { renderDiscoveryHome(); renderGlobalSearch(); showView('searchView'); setTimeout(() => $('globalSearchInput')?.focus(), 80); });
$('navHistory').addEventListener('click', async () => { await loadHistory(true); showView('historyView'); });
$('navProfile').addEventListener('click', () => showView('profileView'));
$('proBtn')?.addEventListener('click', () => buyPlan('PRO'));
$('premiumBtn')?.addEventListener('click', () => buyPlan('PREMIUM'));
$('billingSyncBtn')?.addEventListener('click', () => syncBilling(true));
$('subscriptionManageBtn')?.addEventListener('click', () => manageSubscription($('subscriptionManageBtn').dataset.action || 'cancel'));
$('savePreferencesBtn')?.addEventListener('click', savePreferencesFromUi);

await Promise.all([loadProfile(), loadFavorites(), loadReminders(), loadMatches(), loadHistory(false)]);
await loadProvider();
renderProfile();
