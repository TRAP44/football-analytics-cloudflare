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
  currentAnalysis: null,
  currentCenter: null,
  currentTournament: null,
  tournamentStandings: new Map(),
  liveRefreshTimer: null,
  liveRefreshRemaining: 0,
};

const $ = id => document.getElementById(id);
const views = ['matchesView', 'tournamentView', 'analysisView', 'historyView', 'profileView'];

function stopLiveRefresh() {
  if (state.liveRefreshTimer) clearInterval(state.liveRefreshTimer);
  state.liveRefreshTimer = null;
  state.liveRefreshRemaining = 0;
}

function showView(id) {
  if (id !== 'analysisView') stopLiveRefresh();
  views.forEach(v => $(v).classList.toggle('active', v === id));
  $('navMatches').classList.toggle('active', id === 'matchesView' || id === 'tournamentView' || id === 'analysisView');
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
          <td><div class="standing-team">${row.team?.logo ? `<img src="${safeUrl(row.team.logo)}" alt="">` : ''}<strong>${escapeHtml(row.team?.name || '')}</strong></div></td>
          <td>${Number(row.played)}</td><td class="wide-stat">${Number(row.win)}</td><td class="wide-stat">${Number(row.draw)}</td><td class="wide-stat">${Number(row.lose)}</td>
          <td>${Number(row.goalsFor)}:${Number(row.goalsAgainst)}</td><td class="${Number(row.goalsDiff) > 0 ? 'positive' : Number(row.goalsDiff) < 0 ? 'negative' : ''}">${Number(row.goalsDiff) > 0 ? '+' : ''}${Number(row.goalsDiff)}</td><td><b>${Number(row.points)}</b></td><td>${standingFormHtml(row.form)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="tiny table-note">Таблица загружается только при открытии этой вкладки и кэшируется на 6 часов, чтобы не расходовать бесплатную квоту API.</p>
    </section>`).join('')}`;
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
$('tournamentBackBtn')?.addEventListener('click', () => showView('matchesView'));
document.querySelectorAll('.tournament-tab').forEach(btn => btn.addEventListener('click', () => setTournamentTab(btn.dataset.tournamentTab || 'matches')));
$('profileBtn').addEventListener('click', () => showView('profileView'));
$('navMatches').addEventListener('click', () => showView('matchesView'));
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
