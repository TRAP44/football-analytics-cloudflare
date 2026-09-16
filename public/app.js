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
};

const $ = id => document.getElementById(id);
const views = ['matchesView', 'analysisView', 'profileView'];

function showView(id) {
  views.forEach(v => $(v).classList.toggle('active', v === id));
  $('navMatches').classList.toggle('active', id === 'matchesView' || id === 'analysisView');
  $('navProfile').classList.toggle('active', id === 'profileView');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
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

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (tg?.initData) headers.set('x-telegram-init-data', tg.initData);
  const response = await fetch(path, { ...options, headers });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(json.error || `HTTP ${response.status}`), { status: response.status, payload: json });
  return json;
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
  const { user, quota } = state.profile;
  $('profileBtn').textContent = quota.plan;
  $('quotaText').textContent = `Осталось анализов: ${quota.left} из ${quota.limit}`;
  $('profileName').textContent = user.firstName || 'Пользователь';
  $('profileUsername').textContent = user.username ? `@${user.username}` : `Telegram ID ${user.id}`;
  $('profilePlan').textContent = quota.plan;
  $('profileUsage').textContent = `${quota.used} / ${quota.limit}`;
}

async function loadMatches() {
  $('matches').innerHTML = '<div class="loader">Загружаю матчи…</div>';
  const labels = { '-1': 'Матчи вчера', '0': 'Матчи сегодня', '1': 'Матчи завтра' };
  $('matchesTitle').textContent = labels[String(state.offset)] || 'Матчи';
  try {
    const data = await api(`/api/matches?date=${localDate(state.offset)}`);
    state.matches = data.matches || [];
    renderMatches();
  } catch (e) {
    $('matches').innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

function renderMatches() {
  if (!state.matches.length) {
    $('matches').innerHTML = '<div class="empty">На выбранную дату матчи не найдены в доступных данных API.</div>';
    return;
  }
  $('matches').innerHTML = state.matches.map(m => `
    <article class="match-card">
      <div class="match-meta">
        <span>${escapeHtml(m.league || 'Турнир')}</span>
        <span>${escapeHtml(m.country || '')}</span>
      </div>
      <div class="team-row">
        <div class="team">
          ${m.home.logo ? `<img src="${safeUrl(m.home.logo)}" alt="">` : ''}
          <strong>${escapeHtml(m.home.name)}</strong>
        </div>
        <div class="kickoff">${timeOf(m.date)}</div>
        <div class="team away">
          <strong>${escapeHtml(m.away.name)}</strong>
          ${m.away.logo ? `<img src="${safeUrl(m.away.logo)}" alt="">` : ''}
        </div>
      </div>
      <button class="analyze-btn" data-fixture="${Number(m.fixtureId)}">🧠 Полный анализ</button>
    </article>
  `).join('');

  document.querySelectorAll('.analyze-btn').forEach(btn => {
    btn.addEventListener('click', () => analyzeMatch(Number(btn.dataset.fixture), btn));
  });
}

async function analyzeMatch(fixtureId, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Собираю данные…';
  try {
    const data = await api('/api/analyze', { method: 'POST', body: JSON.stringify({ fixtureId }) });
    renderAnalysis(data);
    if (state.profile && data.quota) {
      state.profile.quota = data.quota;
      renderProfile();
    }
    showView('analysisView');
  } catch (e) {
    if (e.status === 429) toast('Дневной лимит анализов исчерпан.');
    else toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function pct(v) { return Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}%` : '—'; }

function absenceList(title, items) {
  if (!items?.length) return `<div class="data-card"><span>${escapeHtml(title)}</span><strong>Нет данных</strong></div>`;
  return `<div class="panel"><h2>${escapeHtml(title)}</h2><ul class="list">${items.slice(0, 10).map(x => `<li><strong>${escapeHtml(x.name)}</strong>${x.reason ? ` — ${escapeHtml(x.reason)}` : ''}${x.type ? ` (${escapeHtml(x.type)})` : ''}</li>`).join('')}</ul></div>`;
}

function renderAnalysis(d) {
  const p = d.probabilities || {};
  const m = d.match || {};
  const market = d.market;
  const pred = d.apiPrediction;
  const h2h = d.h2h || {};
  const news = d.news || {};
  const homeLine = d.lineups?.home;
  const awayLine = d.lineups?.away;

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

    <section class="panel">
      <p class="tiny warning">${escapeHtml(d.disclaimer || '')}</p>
    </section>
  `;
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

$('refreshBtn').addEventListener('click', loadMatches);
$('backBtn').addEventListener('click', () => showView('matchesView'));
$('profileBackBtn').addEventListener('click', () => showView('matchesView'));
$('profileBtn').addEventListener('click', () => showView('profileView'));
$('navMatches').addEventListener('click', () => showView('matchesView'));
$('navProfile').addEventListener('click', () => showView('profileView'));
$('proBtn').addEventListener('click', () => toast('Telegram Stars подключим на следующем этапе.'));

await Promise.all([loadProfile(), loadMatches()]);
