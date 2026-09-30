export function createAdminProductionReadinessModule({
  state,
  elementById,
  isAdmin,
  escapeHtml,
  humanizeTechnicalText,
  api,
}) {
  if (!state || typeof elementById !== 'function' || typeof isAdmin !== 'function') {
    throw new TypeError('Admin Production Readiness requires state, elementById and isAdmin.');
  }

  const $ = elementById;

  function productionStateLabel(stateValue) {
    if (stateValue === 'ready') return 'ГОТОВО';
    if (stateValue === 'warning') return 'ПРОВЕРИТЬ';
    if (stateValue === 'blocked') return 'ЗАБЛОКИРОВАНО';
    return '—';
  }
  
  function renderProductionReadiness() {
    if (!isAdmin()) return;
    const root = $('productionReadinessStatus');
    const badge = $('productionReadinessBadge');
    const score = $('productionReadinessScore');
    const checks = $('productionReadinessChecks');
    const runtime = $('productionReadinessRuntime');
    if (!root || !badge || !score || !checks || !runtime) return;
  
    if (state.productionReadinessLoading) {
      root.textContent = 'Проверяю объединение запросов, частотную защиту, тайм-ауты и ограничение памяти…';
      badge.textContent = 'ПРОВЕРКА';
      badge.className = 'production-badge running';
      score.textContent = '—';
      checks.innerHTML = '';
      runtime.innerHTML = '';
      return;
    }
  
    const r = state.productionReadiness;
    if (!r) {
      root.textContent = 'Проверка производственной безопасности ещё не запускалась.';
      badge.textContent = 'ОЖИДАНИЕ';
      badge.className = 'production-badge';
      score.textContent = '—';
      checks.innerHTML = '';
      runtime.innerHTML = '';
      return;
    }
  
    root.textContent = r.label || 'Проверка завершена.';
    badge.textContent = productionStateLabel(r.status);
    badge.className = `production-badge ${escapeHtml(r.status || '')}`;
    score.textContent = `${Number(r.score || 0)}%`;
  
    checks.innerHTML = (r.checks || []).map(x => `
      <div class="production-check ${escapeHtml(x.state || '')}">
        <span>${x.state === 'pass' ? '✓' : x.state === 'fail' ? '×' : '!'}</span>
        <div><strong>${escapeHtml(humanizeTechnicalText(x.label || ''))}</strong><small>${escapeHtml(humanizeTechnicalText(x.detail || ''))}</small></div>
        <em>${x.blocking ? 'обязательно' : 'защита'}</em>
      </div>`).join('');
  
    const s = r.safety || {};
    const telegramWebhook = r.diagnostics?.telegramWebhook || {};
    runtime.innerHTML = `
      <div class="production-runtime-grid">
        <div><span>Объединено одинаковых запросов</span><strong>${Number(s.singleflight?.joins || 0)}</strong><small>${Number(s.singleflight?.active || 0)} сейчас</small></div>
        <div><span>Блокировки частых запросов</span><strong>${Number(s.burstGuard?.blocked || 0)}</strong><small>${Number(s.burstGuard?.activeBuckets || 0)} активных групп</small></div>
        <div><span>Telegram dedupe</span><strong>${telegramWebhook.available ? (telegramWebhook.state === 'healthy' ? 'Норма' : telegramWebhook.state === 'incident' ? 'Проблема' : 'Проверить') : 'Нет данных'}</strong><small>дубли ${Number(telegramWebhook.duplicateAttemptsRetained || 0)} · stale ${Number(telegramWebhook.staleProcessing || 0)} · failed ${Number(telegramWebhook.failedCurrent || 0)}</small></div>
        <div><span>Тайм-ауты источников</span><strong>${Number(s.upstream?.timeouts || 0)}</strong><small>БД ${Number(s.upstream?.supabaseTimeoutMs || 0)/1000}с · источник данных ${Number(s.upstream?.apiFootballTimeoutMs || 0)/1000}с</small></div>
        <div><span>Быстрые сохранённые данные</span><strong>${Number(s.memory?.cacheEntries || 0)}</strong><small>мягкий лимит ${Number(s.memory?.cacheSoftLimit || 0)}</small></div>
        <div><span>Сохранённые данные профилей</span><strong>${Number(s.memory?.userSyncEntries || 0)}</strong><small>${Math.round(Number(s.memory?.userSyncTtlSeconds || 0)/60)} мин.</small></div>
        <div><span>Очистка памяти</span><strong>${Number(s.memory?.pruned || 0)}</strong><small>в этом экземпляре</small></div>
      </div>
      <p class="tiny">${escapeHtml(humanizeTechnicalText(r.policy?.note || ''))}</p>`;
  }
  
  async function loadProductionReadiness(force = false) {
    if (!isAdmin()) return;
    if (state.productionReadinessLoading) return;
    if (!force && state.productionReadiness) { renderProductionReadiness(); return; }
    state.productionReadinessLoading = true;
    renderProductionReadiness();
    try {
      state.productionReadiness = await api(`/api/production-readiness${force ? '?refresh=1' : ''}`, {
        retry: false,
        timeoutMs: 15000,
      });
    } catch (e) {
      state.productionReadiness = {
        status: 'blocked',
        label: e.message || 'Проверка производственной безопасности не выполнена.',
        score: 0,
        checks: [],
        safety: {},
        policy: {},
      };
    } finally {
      state.productionReadinessLoading = false;
      renderProductionReadiness();
    }
  }

  return Object.freeze({
    renderProductionReadiness,
    loadProductionReadiness,
  });
}
