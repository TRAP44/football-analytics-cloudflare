// Admin-only reminder delivery health boundary.
// Loaded lazily after the server-authenticated admin role is confirmed.
export function createAdminReminderHealthModule(deps) {
  const {
    state, $, isAdmin, SUPABASE_SCHEMA_HINT, escapeHtml, dateTime,
    technicalStateLabel, humanizeTechnicalText, api, toast,
  } = deps;

  function renderReminderHealth() {
    if (!isAdmin()) return;
    const badge = $('reminderHealthBadge');
    const status = $('reminderHealthStatus');
    const kpis = $('reminderHealthKpis');
    const recent = $('reminderHealthRecent');
    const refresh = $('reminderHealthRefreshBtn');
    const test = $('reminderTestBtn');
    if (!badge || !status || !kpis || !recent || !refresh || !test) return;
  
    refresh.disabled = Boolean(state.reminderHealthLoading);
    test.disabled = Boolean(state.reminderHealthLoading);
  
    if (state.reminderHealthLoading) {
      badge.className = 'reminder-health-badge running';
      badge.textContent = 'ПРОВЕРКА';
      status.textContent = 'Проверяю расписание и фиксацию задач доставки…';
      kpis.innerHTML = '';
      recent.innerHTML = '';
      return;
    }
  
    const r = state.reminderHealth;
    if (!r) {
      badge.className = 'reminder-health-badge';
      badge.textContent = 'ОЖИДАНИЕ';
      status.textContent = 'Состояние доставки ещё не загружено.';
      kpis.innerHTML = '';
      recent.innerHTML = '';
      return;
    }
  
    if (!r.available) {
      badge.className = 'reminder-health-badge blocked';
      badge.textContent = 'БД';
      status.textContent = r.reason || SUPABASE_SCHEMA_HINT;
      kpis.innerHTML = `<div class="data-notice stale">Перед проверкой уведомлений ${escapeHtml(SUPABASE_SCHEMA_HINT)}.</div>`;
      recent.innerHTML = '';
      return;
    }
  
    const healthy = r.health?.state === 'healthy';
    badge.className = `reminder-health-badge ${healthy ? 'healthy' : 'watch'}`;
    badge.textContent = healthy ? 'НОРМА' : 'КОНТРОЛЬ';
    status.textContent = `${r.health?.label || 'Состояние доставки'} · проверка каждые ${Number(r.scheduler?.cadenceMinutes || 5)} мин.`;
  
    const s = r.summary || {};
    kpis.innerHTML = `<div class="reminder-health-grid">
      <div><span>Активные</span><strong>${Number(s.activeUpcoming || 0)}</strong><small>будущие матчи</small></div>
      <div><span>До 90 мин.</span><strong>${Number(s.dueNext90Minutes || 0)}</strong><small>скоро к отправке</small></div>
      <div><span>До матча · 24ч</span><strong>${Number(s.prematchSent24h || 0)}</strong><small>доставлено</small></div>
      <div><span>Старт · 24ч</span><strong>${Number(s.kickoffSent24h || 0)}</strong><small>доставлено</small></div>
      <div><span>Ошибки 24ч</span><strong>${Number(s.failed24h || 0)}</strong><small>видны в мониторинге</small></div>
      <div><span>В обработке</span><strong>${Number(s.activeClaims || 0)}</strong><small>${Number(s.staleClaims || 0)} зависших</small></div>
    </div>`;
  
    recent.innerHTML = (r.recent || []).length
      ? `<div class="reminder-health-list">${r.recent.map(x => `
        <div class="${x.hasError ? 'error' : 'ok'}">
          <div><strong>${escapeHtml(x.match || `Матч #${x.fixtureId}`)}</strong><small>${x.fixtureDate ? dateTime(x.fixtureDate) : ''}</small></div>
          <span>${escapeHtml(technicalStateLabel(x.state || ''))}</span>
          <em>${Number(x.prematchAttempts || 0)} + ${Number(x.kickoffAttempts || 0)} попыт.</em>
        </div>`).join('')}</div><p class="tiny">${escapeHtml(humanizeTechnicalText(r.note || ''))}</p>`
      : '<div class="empty compact-empty">Недавних попыток доставки пока нет.</div>';
  }
  
  async function loadReminderHealth(force = false) {
    if (!isAdmin() || state.reminderHealthLoading) return;
    if (!force && state.reminderHealth) { renderReminderHealth(); return; }
    state.reminderHealthLoading = true;
    renderReminderHealth();
    try {
      state.reminderHealth = await api('/api/reminder-health', { retry: false, timeoutMs: 12000 });
    } catch (e) {
      state.reminderHealth = { available: false, reason: e.message };
    } finally {
      state.reminderHealthLoading = false;
      renderReminderHealth();
    }
  }
  
  async function sendReminderTest() {
    if (!isAdmin() || state.reminderHealthLoading) return;
    state.reminderHealthLoading = true;
    renderReminderHealth();
    try {
      const result = await api('/api/reminder-health', {
        method: 'POST',
        body: JSON.stringify({ action: 'test' }),
        retry: false,
        dedupe: false,
        timeoutMs: 12000,
      });
      toast(result.message || 'Тест отправлен');
      state.reminderHealth = null;
    } catch (e) {
      toast(e.message);
    } finally {
      state.reminderHealthLoading = false;
      await loadReminderHealth(true);
    }
  }

  return Object.freeze({
    renderReminderHealth,
    loadReminderHealth,
    sendReminderTest,
  });
}
