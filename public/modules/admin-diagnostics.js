// Admin-only diagnostics boundary.
// Loaded lazily only for the server-authenticated admin surface.
export function createAdminDiagnosticsModule(deps) {
  const {
    state, $, isAdmin, api, renderProvider,
    diagnosticsStateLabel, relativeAge, escapeHtml, technicalStateLabel,
    planLabel, diagPct, humanizeTechnicalText, dateTime, diagDuration,
    CLIENT_VERSION, CLIENT_API_CONTRACT, CLIENT_RELEASE_CHANNEL, SUPABASE_SCHEMA_HINT,
  } = deps;

  function renderDiagnostics() {
    const root = $('diagnosticsStatus');
    if (!root) return;
    const d = state.diagnostics;
    const badge = $('diagnosticsBadge');
    const updated = $('diagnosticsUpdated');
    const provider = $('diagnosticsProvider');
    const database = $('diagnosticsDatabase');
    const runtime = $('diagnosticsRuntime');
    const client = $('diagnosticsClient');
    const integrity = $('diagnosticsIntegrity');
    const events = $('diagnosticsEvents');
    const recommendations = $('diagnosticsRecommendations');
    if (state.diagnosticsLoading) {
      root.textContent = 'Проверяю сервер, Supabase, сохранённые данные и API-Football…';
      if (badge) { badge.textContent = 'Проверка'; badge.className = 'diagnostics-badge waiting'; }
      [provider, database, runtime, client, integrity, events, recommendations].forEach(x => { if (x) x.hidden = true; });
      return;
    }
    if (!d) {
      root.textContent = 'Диагностика ещё не загружена.';
      if (badge) { badge.textContent = 'Нет данных'; badge.className = 'diagnostics-badge'; }
      return;
    }
  
    const overall = d.overall || {};
    root.textContent = overall.label || 'Состояние системы получено.';
    if (badge) {
      badge.textContent = diagnosticsStateLabel(overall.state);
      badge.className = `diagnostics-badge ${escapeHtml(overall.state || '')}`;
    }
    if (updated) updated.textContent = d.generatedAt ? `Проверено ${relativeAge(d.generatedAt)}` : '';
  
    const p = d.provider || {};
    if (provider) {
      provider.hidden = false;
      provider.innerHTML = `
        <div class="diagnostics-block-head"><strong>Источник данных API-Football</strong><span>${escapeHtml(technicalStateLabel(p.health || 'waiting'))}</span></div>
        <div class="diagnostics-grid">
          <div><span>Тариф</span><strong>${escapeHtml(p.plan && p.plan !== 'UNKNOWN' ? planLabel(p.plan) : 'не определён')}</strong><small>${p.lastStatus ? `код ответа ${Number(p.lastStatus)}` : 'ответ ещё не получен'}</small></div>
          <div><span>Сегодня использовано</span><strong>${Number.isFinite(Number(p.dailyUsed)) && Number.isFinite(Number(p.dailyLimit)) ? `${Number(p.dailyUsed)} / ${Number(p.dailyLimit)}` : '—'}</strong><small>${diagPct(p.dailyUsedPct)}</small></div>
          <div><span>Минутное окно</span><strong>${Number.isFinite(Number(p.minuteUsed)) && Number.isFinite(Number(p.minuteLimit)) ? `${Number(p.minuteUsed)} / ${Number(p.minuteLimit)}` : '—'}</strong><small>${diagPct(p.minuteUsedPct)}</small></div>
          <div><span>Последний ответ</span><strong>${Number.isFinite(Number(p.lastLatencyMs)) ? `${Number(p.lastLatencyMs)} мс` : '—'}</strong><small>${p.lastSuccessAt ? relativeAge(p.lastSuccessAt) : humanizeTechnicalText(p.lastError || 'нет данных')}</small></div>
        </div>
        ${p.cooldownActive ? `<p class="diagnostics-warning">⏳ Пауза из-за лимита запросов активна до ${escapeHtml(dateTime(p.cooldownUntil))}.</p>` : ''}`;
    }
  
    const db = d.supabase || {};
    const cache = db.cache || {};
    const obs = d.observability || {};
    const telegramWebhook = d.telegramWebhook || {};
    if (database) {
      database.hidden = false;
      database.innerHTML = `
        <div class="diagnostics-block-head"><strong>База данных Supabase и сохранённые данные</strong><span>${db.ok ? 'в сети' : (String(db.status || '').toLowerCase() === 'offline' ? 'нет связи' : escapeHtml(technicalStateLabel(db.status || 'offline')))}</span></div>
        <div class="diagnostics-grid">
          <div><span>Доступ к базе данных</span><strong>${db.ok ? (db.recovered ? 'Восстановлено' : 'Норма') : 'Ошибка'}</strong><small>${Number.isFinite(Number(db.latencyMs)) ? `${Number(db.latencyMs)} мс` : '—'} · попыток ${Number(db.attempts || 1)}${db.recovered ? ' · первый probe не прошёл' : ''}</small></div>
          <div><span>Сохранённых записей</span><strong>${Number.isFinite(Number(cache.total)) ? Number(cache.total) : '—'}</strong><small>выборка ${Number(cache.sampled || 0)}</small></div>
          <div><span>Свежие / устаревшие</span><strong>${Number(cache.freshInSample || 0)} / ${Number(cache.staleInSample || 0)}</strong><small>в диагностической выборке</small></div>
          <div><span>Журнал ошибок</span><strong>${obs.persistent ? 'Supabase' : 'Память'}</strong><small>${obs.migrationReady ? `хранение ${Number(obs.retentionDays || 14)} дн.` : SUPABASE_SCHEMA_HINT}</small></div>
          <div><span>Telegram webhook dedupe</span><strong>${telegramWebhook.available ? (telegramWebhook.state === 'healthy' ? 'Норма' : telegramWebhook.state === 'incident' ? 'Проблема' : 'Проверить') : 'Нет данных'}</strong><small>claims ${Number(telegramWebhook.claimsRecent || 0)} · дубли ${Number(telegramWebhook.duplicateAttemptsRetained || 0)} · stale ${Number(telegramWebhook.staleProcessing || 0)}</small></div>
        </div>`;
    }
  
    const rt = d.runtime || {};
    if (runtime) {
      runtime.hidden = false;
      runtime.innerHTML = `
        <div class="diagnostics-block-head"><strong>Текущий обработчик Cloudflare</strong><span>среда</span></div>
        <div class="diagnostics-grid">
          <div><span>Запросов к серверу</span><strong>${Number(rt.apiRequests || 0)}</strong><small>успех ${diagPct(rt.apiSuccessRate)}</small></div>
          <div><span>Использование сохранённых данных</span><strong>${diagPct(rt.cacheHitRate)}</strong><small>${Number(rt.cacheHits || 0)} попаданий · ${Number(rt.cacheMisses || 0)} промахов</small></div>
          <div><span>Ограничения частоты</span><strong>${Number(rt.rateLimits || 0)}</strong><small>${Number(rt.quotaBlocks || 0)} запроса остановлено защитой квоты</small></div>
          <div><span>Защита от всплесков</span><strong>${Number(rt.burstBlocks || 0)}</strong><small>${Number(rt.singleflightJoins || 0)} объединений запросов</small></div>
          <div><span>Тайм-ауты источников</span><strong>${Number(rt.upstreamTimeouts || 0)}</strong><small>${Number(rt.userSyncSkips || 0)} синхронизаций пользователя пропущено</small></div>
          <div><span>Подтверждение Supabase probe</span><strong>${Number(rt.supabaseProbeRecoveries || 0)}</strong><small>восстановлений · ${Number(rt.supabaseProbeConfirmedFailures || 0)} подтверждённых сбоев</small></div>
          <div><span>Быстрые сохранённые данные</span><strong>${Number(rt.l1CacheEntries || 0)}</strong><small>${Number(rt.memoryPrunes || 0)} очисток памяти</small></div>
          <div><span>Ошибки маршрутов</span><strong>${Number(rt.routeErrors || 0)}</strong><small>работает ${escapeHtml(diagDuration(rt.uptimeSeconds))}</small></div>
        </div>
        <p class="tiny diagnostics-note">Счётчики среды выполнения относятся только к текущему экземпляру серверного обработчика Cloudflare. Дневной и минутный расход выше берётся непосредственно из заголовков API-Football.</p>`;
    }
  
    if (client) {
      const cp = state.clientPerf || {};
      const avg = Number(cp.completed || 0) > 0 ? Math.round(Number(cp.totalMs || 0) / Number(cp.completed)) : null;
      client.hidden = false;
      client.innerHTML = `<div class="diagnostics-block-head"><strong>📱 Клиент мини-приложения</strong><span>${escapeHtml(CLIENT_VERSION)}</span></div><div class="diagnostics-grid">
        <div><span>Сеть</span><strong>${navigator.onLine === false ? 'Нет сети' : 'В сети'}</strong><small>${navigator.connection?.effectiveType ? `тип сети: ${escapeHtml(navigator.connection.effectiveType)}` : 'тип сети —'}</small></div>
        <div><span>Средний ответ сервера</span><strong>${avg !== null ? `${avg} мс` : '—'}</strong><small>последний ${cp.lastMs !== null ? `${cp.lastMs} мс` : '—'}</small></div>
        <div><span>Запросы</span><strong>${Number(cp.requests || 0)}</strong><small>${Number(cp.completed || 0)} успешно · ${Number(cp.failed || 0)} ошибок</small></div>
        <div><span>Оптимизация</span><strong>${Number(cp.deduped || 0)} объединено</strong><small>${Number(cp.retries || 0)} авто-повторов</small></div>
        <div><span>Защита клиента</span><strong>${Number(cp.rateLimited || 0)} ограничений</strong><small>${Number(cp.timeouts || 0)} тайм-аутов</small></div>
        <div><span>Восстановление интерфейса</span><strong>${Number(cp.recoveries || 0)} восстановлений</strong><small>${Number(cp.degradedEvents || 0)} событий ухудшения</small></div>
        <div><span>Состояние сети</span><strong>${escapeHtml(technicalStateLabel(state.network.mode || 'online'))}</strong><small>${state.network.lastRecoveredAt ? `восстановлено ${escapeHtml(relativeAge(state.network.lastRecoveredAt))}` : 'без восстановлений'}</small></div>
        <div><span>Запуск</span><strong>${Number.isFinite(Number(cp.bootMs)) ? `${Number(cp.bootMs)} мс` : '—'}</strong><small>${state.startup.manifestOk ? 'манифест загружен' : `ошибок манифеста: ${Number(cp.manifestFailures || 0)}`}</small></div>
        <div><span>Контракт обмена данными</span><strong>${CLIENT_API_CONTRACT}</strong><small>канал ${escapeHtml(String(state.appManifest?.releaseChannel || CLIENT_RELEASE_CHANNEL).toUpperCase())} · минимум ${escapeHtml(state.appManifest?.minClientVersion || '—')}</small></div>
      </div>`;
    }
  
    const integrityData = d.integrity || {};
    const integrityRun = integrityData.lastRun || {};
    const integrityIssues = integrityData.recentIssues || [];
    if (integrity) {
      integrity.hidden = false;
      integrity.innerHTML = `
        <div class="diagnostics-block-head"><strong>Целостность матчей</strong><span>${escapeHtml(technicalStateLabel(integrityRun.health || (integrityData.migrationReady ? 'waiting' : 'migration')))}</span></div>
        <div class="diagnostics-grid">
          <div><span>Проверено</span><strong>${integrityRun.inspected ?? '—'}</strong><small>${integrityRun.observedAt ? relativeAge(integrityRun.observedAt) : 'ещё нет запуска'}</small></div>
          <div><span>Оценка качества</span><strong>${Number.isFinite(Number(integrityRun.qualityScore)) ? `${Math.round(Number(integrityRun.qualityScore))}%` : '—'}</strong><small>${Number(integrityRun.clean || 0)} без замечаний</small></div>
          <div><span>Скрыто защитой</span><strong>${Number(integrityRun.quarantined || 0)}</strong><small>${Number(integrityRun.duplicates || 0)} дубликатов</small></div>
          <div><span>Предупреждения</span><strong>${Number(integrityRun.warnings || 0)}</strong><small>${Number(integrityRun.errors || 0)} ошибок</small></div>
        </div>
        ${!integrityData.migrationReady ? `<p class="diagnostics-warning">${escapeHtml(SUPABASE_SCHEMA_HINT)} для постоянного журнала целостности данных.</p>` : ''}
        ${integrityIssues.length ? `<div class="integrity-issue-list">${integrityIssues.slice(0,5).map(item => `<div><b>${escapeHtml(humanizeTechnicalText(item.issue_code || item.code || 'ДАННЫЕ'))}</b><span>${escapeHtml(humanizeTechnicalText(item.message || ''))}</span><small>${escapeHtml([item.home_name || item.home, item.away_name || item.away].filter(Boolean).join(' — '))}${item.fixture_id || item.fixtureId ? ` · #${Number(item.fixture_id || item.fixtureId)}` : ''}</small></div>`).join('')}</div>` : ''}`;
    }
  
    const recent = obs.recentEvents || [];
    if (events) {
      events.hidden = false;
      events.innerHTML = `
        <div class="diagnostics-block-head"><strong>Последние события</strong><span>${recent.length}</span></div>
        <div class="diagnostics-events">${recent.length ? recent.slice(0, 8).map(item => `
          <div class="diagnostics-event ${escapeHtml(item.severity || 'info')}">
            <i></i><div><strong>${escapeHtml(humanizeTechnicalText(item.code || item.event_type || 'СОБЫТИЕ'))}</strong><span>${escapeHtml(humanizeTechnicalText(item.message || 'Без описания'))}</span><small>${escapeHtml(item.source === 'worker' ? 'сервер' : item.source === 'release' ? 'релиз' : humanizeTechnicalText(item.source || 'сервер'))}${item.endpoint ? ` · ${escapeHtml(item.endpoint)}` : ''} · ${item.created_at ? escapeHtml(relativeAge(item.created_at)) : ''}</small></div>
          </div>`).join('') : '<div class="empty compact-empty">Ошибок и предупреждений пока нет.</div>'}</div>`;
    }
  
    if (recommendations) {
      recommendations.hidden = false;
      recommendations.innerHTML = `
        <div class="diagnostics-block-head"><strong>Что делать</strong><span>автопроверка</span></div>
        <ul class="diagnostics-actions">${(d.recommendations || []).map(x => `<li>${escapeHtml(humanizeTechnicalText(x))}</li>`).join('')}</ul>`;
    }
  }
  
  async function loadDiagnostics(force = false) {
    if (!isAdmin()) return;
    if (state.diagnosticsLoading) return;
    state.diagnosticsLoading = true;
    renderDiagnostics();
    try {
      state.diagnostics = await api(`/api/diagnostics${force ? '?refresh=1' : ''}`);
      if (state.diagnostics?.provider) {
        state.provider = state.diagnostics.provider;
        state.providerObservability = state.diagnostics.providerObservability || state.providerObservability;
        renderProvider();
      }
    } catch (e) {
      state.diagnostics = { overall: { state: 'critical', label: e.message || 'Не удалось загрузить диагностику.' }, recommendations: ['Повторите проверку после обновления приложения.'] };
    } finally {
      state.diagnosticsLoading = false;
      renderDiagnostics();
    }
  }

  return Object.freeze({
    renderDiagnostics,
    loadDiagnostics,
  });
}
