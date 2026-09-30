// Admin-only release monitoring boundary.
// Loaded lazily after the server-authenticated admin role is confirmed.
export function createAdminReleaseMonitorModule(deps) {
  const {
    state, $, isAdmin, escapeHtml, relativeAge, humanizeTechnicalText,
    dateTime, toast, api,
  } = deps;

  function releaseMonitorStateLabel(stateValue) {
    return stateValue === 'healthy' ? 'СТАБИЛЬНО' : stateValue === 'watch' ? 'КОНТРОЛЬ' : stateValue === 'incident' ? 'ИНЦИДЕНТ' : 'ОЖИДАНИЕ';
  }
  
  function releaseMonitorDelta(value) {
    const n = Number(value || 0);
    if (!n) return '0';
    return `${n > 0 ? '+' : ''}${n}`;
  }
  
  function renderReleaseMonitor() {
    if (!isAdmin()) return;
    const badge = $('releaseMonitorBadge');
    const title = $('releaseMonitorStatus');
    const meta = $('releaseMonitorMeta');
    const kpis = $('releaseMonitorKpis');
    const client = $('releaseMonitorClient');
    const digest = $('releaseMonitorDigest');
    const regression = $('releaseMonitorRegression');
    const issues = $('releaseMonitorIssues');
    const incidents = $('releaseMonitorIncidents');
    if (!badge || !title || !meta || !kpis || !client || !digest || !regression || !issues || !incidents) return;
  
    if (state.releaseMonitorLoading) {
      badge.className = 'release-monitor-badge running';
      badge.textContent = 'ПРОВЕРКА';
      title.textContent = 'Собираю операционные события…';
      meta.textContent = 'Без API-Football';
      kpis.innerHTML = client.innerHTML = digest.innerHTML = regression.innerHTML = issues.innerHTML = incidents.innerHTML = '';
      return;
    }
  
    const r = state.releaseMonitor;
    if (!r?.available) {
      badge.className = 'release-monitor-badge';
      badge.textContent = 'ОЖИДАНИЕ';
      title.textContent = 'Мониторинг выпуска ещё не запускался.';
      meta.textContent = 'Показывает ошибки, восстановление клиента и операционные лимиты.';
      kpis.innerHTML = client.innerHTML = digest.innerHTML = regression.innerHTML = issues.innerHTML = incidents.innerHTML = '';
      return;
    }
  
    const health = r.health || {};
    badge.className = `release-monitor-badge ${escapeHtml(health.state || '')}`;
    badge.textContent = releaseMonitorStateLabel(health.state);
    title.textContent = health.label || 'Мониторинг выпуска';
    meta.textContent = `${Number(health.score || 0)}% · ${Number(r.hours || 24)}ч · ${r.persistent ? 'журнал событий' : 'память процесса'} · ${relativeAge(r.generatedAt)}`;
  
    const c = r.current || {};
    const p = r.previous || {};
    const budget = c.operationalBudget || {};
    kpis.innerHTML = `<div class="release-monitor-kpis">
      <div><span>Ошибки</span><strong>${Number(c.errorLike || 0)}</strong><small>${releaseMonitorDelta(r.trend?.errorsDelta)} к прошлому периоду</small></div>
      <div><span>Предупреждения</span><strong>${Number(c.warningLike || 0)}</strong><small>${releaseMonitorDelta(r.trend?.warningsDelta)} к прошлому периоду</small></div>
      <div><span>Лимит событий</span><strong>${Number(budget.remaining || 0)}/${Number(budget.allowance || 0)}</strong><small>${budget.exhausted ? 'превышен' : 'остаток событий'}</small></div>
      <div><span>Событий</span><strong>${Number(c.total || 0)}</strong><small>предыдущий период ${Number(p.total || 0)}</small></div>
    </div>`;
  
    const cc = c.client || {};
    client.innerHTML = `<div class="release-monitor-section-head"><strong>📱 Телеметрия клиента</strong><span>только разрешённые поля · без пользовательского контента</span></div>
      <div class="release-client-grid">
        <div><span>Успешный запуск</span><strong>${Number(cc.bootOk || 0)}</strong></div>
        <div><span>Восстановление запуска</span><strong>${Number(cc.bootRecovery || 0)}</strong></div>
        <div><span>Блокировка версии</span><strong>${Number(cc.compatibilityBlocks || 0)}</strong></div>
        <div><span>Ошибки клиента</span><strong>${Number(cc.clientErrors || 0)}</strong></div>
        <div><span>Восстановление сети</span><strong>${Number(cc.networkRecovery || 0)}</strong></div>
      </div>`;
  
    const dd = r.dailyDigest || {};
    const dr = dd.latestRun || {};
    const di = dd.incident || {};
    const da = dd.alertDelivery || {};
    const reliability = dd.reliability || {};
    const slo = dd.reliabilitySlo || {};
    const sloState = String(slo.state || 'collecting');
    const sloStateLabel = sloState === 'healthy' ? 'SLO в норме' : sloState === 'watch' ? 'SLO требует контроля' : 'SLO собирает данные';
    const sloReasons = Array.isArray(slo.reasons) && slo.reasons.length ? slo.reasons : (slo.reason ? [slo.reason] : []);
    const ddState = String(dd.state || 'collecting');
    const ddStateLabel = ddState === 'healthy' ? 'Норма' : ddState === 'incident' ? 'Инцидент' : ddState === 'watch' ? 'Контроль' : 'Нет данных';
    const completion = dr.completionRate === null || dr.completionRate === undefined
      ? '—'
      : `${(Number(dr.completionRate) * 100).toFixed(1)}%`;
    const reliabilityCompletion = reliability.completionRate === null || reliability.completionRate === undefined
      ? '—'
      : `${(Number(reliability.completionRate) * 100).toFixed(1)}%`;
    const reliabilityCoverage = Number.isFinite(Number(reliability.coverageRate))
      ? `${(Number(reliability.coverageRate) * 100).toFixed(0)}%`
      : '—';
    const recoveryAvg = reliability.incidents?.averageRecoveryMinutes === null || reliability.incidents?.averageRecoveryMinutes === undefined
      ? '—'
      : `${Number(reliability.incidents.averageRecoveryMinutes).toFixed(1)} мин`;
    const alertStates = da.states || {};
    const dailyRows = Array.isArray(reliability.daily) ? reliability.daily.slice(-7).reverse() : [];
    digest.innerHTML = `<div class="release-monitor-section-head"><strong>📨 Daily Digest</strong><span>${escapeHtml(ddStateLabel)} · только агрегаты</span></div>
      ${dd.available ? `<div class="release-client-grid">
        <div><span>Состояние</span><strong>${escapeHtml(ddStateLabel)}</strong><small>${escapeHtml(humanizeTechnicalText(dr.code || ''))}</small></div>
        <div><span>Последний запуск</span><strong>${dr.at ? escapeHtml(relativeAge(dr.at)) : '—'}</strong><small>${dr.durationMs ? `${Math.round(Number(dr.durationMs)/1000)} сек` : '—'}</small></div>
        <div><span>Доставлено</span><strong>${Number(dr.sent || 0)}/${Number(dr.eligible || 0)}</strong><small>completion ${completion}</small></div>
        <div><span>Backlog</span><strong>${Number(dr.remaining || 0)}</strong><small>deferred ${Number(dr.deferred || 0)}</small></div>
        <div><span>Sealed claims</span><strong>${Number(dr.sealedClaims || 0)}</strong><small>oldest ${Math.round(Number(dr.oldestActiveClaimAgeMs || 0)/1000)} сек</small></div>
        <div><span>Ошибки / rate-limit</span><strong>${Number(dr.failed || 0)} / ${Number(dr.rateLimited || 0)}</strong><small>${dr.truncated ? 'scan truncated' : 'scan complete'}</small></div>
        <div><span>Инцидент</span><strong>${di.active ? 'Активен' : 'Нет'}</strong><small>${escapeHtml(di.incidentId || '—')}</small></div>
        <div><span>Последнее восстановление</span><strong>${di.lastRecoveryAt ? escapeHtml(relativeAge(di.lastRecoveryAt)) : '—'}</strong><small>история ${Number(di.historyCount || 0)}</small></div>
        <div><span>Alert delivery</span><strong>${Number(alertStates.sent || 0)} sent</strong><small>retry ${Number(alertStates.retry_pending || 0)} · unknown ${Number(alertStates.unknown || 0)} · terminal ${Number(alertStates.terminal_failed || 0)}</small></div>
      </div>
      <div class="release-monitor-section-head"><strong>Надёжность · ${Number(reliability.days || r.digestDays || 7)} дн.</strong><span>${Number(reliability.sampleDays || 0)}/${Number(reliability.expectedDays || reliability.days || 0)} дней · coverage ${reliabilityCoverage}</span></div>
      <div class="release-client-grid">
        <div><span>Reliability SLO</span><strong>${escapeHtml(sloStateLabel)}</strong><small>${escapeHtml(humanizeTechnicalText(slo.code || slo.reason || ''))}${sloReasons.length > 1 ? ` · ${sloReasons.length} сигналов` : ''}</small></div>
        <div><span>Completion rate</span><strong>${reliabilityCompletion}</strong><small>${Number(reliability.totals?.sent || 0)}/${Number(reliability.totals?.claimed || 0)} deliveries</small></div>
        <div><span>Backlog</span><strong>${Number(reliability.backlog?.days || 0)} дн.</strong><small>${Number(reliability.backlog?.occurrences || 0)} запусков · max ${Number(reliability.backlog?.maxRecipients || 0)}</small></div>
        <div><span>Rate-limit</span><strong>${Number(reliability.rateLimitDays || 0)} дн.</strong><small>${Number(reliability.totals?.rateLimited || 0)} событий</small></div>
        <div><span>Инциденты</span><strong>${Number(reliability.incidents?.count || 0)}</strong><small>active ${Number(reliability.incidents?.active || 0)} · recovered ${Number(reliability.incidents?.recovered || 0)}</small></div>
        <div><span>Среднее восстановление</span><strong>${recoveryAvg}</strong><small>max ${reliability.incidents?.maxRecoveryMinutes ?? '—'} мин</small></div>
        <div><span>Degraded / sealed</span><strong>${Number(reliability.degradedDays || 0)} / ${Number(reliability.sealedClaimDays || 0)}</strong><small>truncated ${Number(reliability.truncatedDays || 0)} дн.</small></div>
      </div>
      <details class="release-incidents"><summary>Daily history · последние ${dailyRows.length}</summary>
        <div class="release-issue-list">${dailyRows.length ? dailyRows.map(day => `<div><strong>${escapeHtml(day.date || '—')}</strong><span>${day.completionRate === null || day.completionRate === undefined ? '—' : `${(Number(day.completionRate)*100).toFixed(1)}%`} · backlog ${Number(day.finalRemaining || 0)} · RL ${Number(day.rateLimited || 0)}</span></div>`).join('') : '<div class="empty compact-empty">Истории за выбранный период пока нет.</div>'}</div>
      </details>` : '<div class="empty compact-empty">Daily Digest ещё не создавал операционных событий за доступный период.</div>'}`;
  
    const regressionData = r.postDeployRegression || {};
    const regressionResponse = regressionData.response || {available:false,state:'new',nextState:null,lifecycleState:'healthy',history:[]};
    const regressionRows = Array.isArray(regressionData.timeline) ? regressionData.timeline : [];
    const regressionSlo = regressionData.slo || {thresholds:{},summary:{},current:null};
    const regressionCurrentSlo = regressionSlo.current || null;
    const regressionSloSummary = regressionSlo.summary || {};
    const regressionThresholds = regressionSlo.thresholds || {};
    const sloValue = value => Number.isFinite(Number(value)) ? `${Number(value)} мин` : '—';
    const sloStatusLabel = status => status === 'met' ? 'SLO выполнен' : status === 'breached' ? 'SLO нарушен' : 'ожидание';
    const lifecycleRows = regressionRows.filter(x => x?.source === 'release_regression');
    const alertRows = regressionRows.filter(x => x?.source === 'release_regression_alert');
    const responseRows = regressionRows.filter(x => x?.source === 'release_regression_response');
    const latestLifecycle = lifecycleRows[0] || null;
    const lifecycleState = String(regressionResponse.lifecycleState || latestLifecycle?.lifecycleState || 'healthy');
    const regressionStateLabel = lifecycleState === 'incident'
      ? 'ИНЦИДЕНТ'
      : lifecycleState === 'watch'
        ? 'КОНТРОЛЬ'
        : lifecycleState === 'recovered'
          ? 'ВОССТАНОВЛЕНО'
          : 'НЕТ АКТИВНОЙ РЕГРЕССИИ';
    const latestAlert = alertRows[0] || null;
    const alertCode = String(latestAlert?.code || '');
    const alertLabel = !latestAlert
      ? 'Нет событий доставки'
      : alertCode.includes('SENT')
        ? 'Доставлено'
        : alertCode.includes('DUPLICATE')
          ? 'Дубль подавлен'
          : alertCode.includes('RETRY')
            ? 'Ожидает retry'
            : alertCode.includes('FAILED')
              ? 'Ошибка доставки'
              : 'Проверить';
    const responseStateLabel = {
      new:'NEW',
      acknowledged:'ACKNOWLEDGED',
      investigating:'INVESTIGATING',
      resolved:'RESOLVED',
      unavailable:'НЕДОСТУПНО',
    }[String(regressionResponse.state || 'new')] || 'NEW';
    const nextResponseState=String(regressionResponse.nextState || '');
    const nextResponseLabel={
      acknowledged:'Подтвердить инцидент',
      investigating:'Начать расследование',
      resolved:'Закрыть инцидент',
    }[nextResponseState] || '';
    const operatorAction = lifecycleState === 'incident'
      ? (regressionResponse.state === 'investigating'
        ? 'Продолжать расследование и дождаться фактического RECOVERED. Закрытие вручную до recovery заблокировано.'
        : 'Подтвердить инцидент и начать расследование. Автоматический rollback не выполняется.')
      : lifecycleState === 'recovered'
        ? (regressionResponse.state === 'investigating'
          ? 'Recovery подтверждён мониторингом. Инцидент можно закрыть вручную после финальной проверки.'
          : 'Проверить audit trail и завершить ручной response lifecycle.')
        : lifecycleState === 'watch'
          ? 'Дождаться подтверждения INCIDENT или RECOVERED. WATCH не создаёт ручной incident response.'
          : 'Активного regression incident нет.';
  
    regression.innerHTML = `<div class="release-monitor-section-head"><strong>🧭 Post-deploy regression</strong><span>incident response · audit trail</span></div>
      <div class="release-client-grid">
        <div><span>Lifecycle</span><strong>${escapeHtml(regressionStateLabel)}</strong><small>${latestLifecycle?.createdAt ? escapeHtml(relativeAge(latestLifecycle.createdAt)) : 'нет transition'}</small></div>
        <div><span>Response</span><strong>${escapeHtml(responseStateLabel)}</strong><small>${escapeHtml(regressionResponse.reason || '—')}</small></div>
        <div><span>Alert delivery</span><strong>${escapeHtml(alertLabel)}</strong><small>${latestAlert?.createdAt ? escapeHtml(relativeAge(latestAlert.createdAt)) : 'нет alert events'}</small></div>
        <div><span>Audit events</span><strong>${responseRows.length}</strong><small>ACK / INVESTIGATING / RESOLVED</small></div>
      </div>
      <div class="release-client-grid">
        <div><span>ACK latency</span><strong>${sloValue(regressionCurrentSlo?.ackLatencyMinutes)}</strong><small>${escapeHtml(sloStatusLabel(regressionCurrentSlo?.ackStatus))} · цель ${Number(regressionThresholds.ackMinutes || 30)} мин</small></div>
        <div><span>Investigation latency</span><strong>${sloValue(regressionCurrentSlo?.investigationLatencyMinutes)}</strong><small>метрика без отдельного SLA</small></div>
        <div><span>Recovery latency</span><strong>${sloValue(regressionCurrentSlo?.recoveryLatencyMinutes)}</strong><small>${escapeHtml(sloStatusLabel(regressionCurrentSlo?.recoveryStatus))} · цель ${Number(regressionThresholds.recoveryMinutes || 360)} мин</small></div>
        <div><span>Resolution latency</span><strong>${sloValue(regressionCurrentSlo?.resolutionLatencyMinutes)}</strong><small>метрика без отдельного SLA</small></div>
      </div>
      <div class="data-notice">${regressionCurrentSlo?.ackCriticalOverdue ? '🚨 ACK просрочен критически. ' : ''}<strong>SLO:</strong> ACK ${regressionSloSummary.ackSloPct ?? '—'}% · recovery ${regressionSloSummary.recoverySloPct ?? '—'}% · incidents ${Number(regressionSloSummary.incidents || 0)}.</div>
      <div class="data-notice">🛠 <strong>Ручное действие:</strong> ${escapeHtml(operatorAction)}</div>
      ${regressionResponse.available && nextResponseState ? `<div class="release-monitor-actions">
        <button class="reminder-btn regression-response-btn" type="button" data-response-state="${escapeHtml(nextResponseState)}" ${state.releaseRegressionResponsePending ? 'disabled' : ''}>${state.releaseRegressionResponsePending ? 'Сохраняю…' : escapeHtml(nextResponseLabel)}</button>
      </div>` : ''}
      <details class="release-incidents"><summary>Regression timeline · ${regressionRows.length}</summary>
        <div class="release-issue-list">${regressionRows.length ? regressionRows.slice(0,20).map(x => `<div><strong>${escapeHtml(humanizeTechnicalText(x.code || x.source || ''))}</strong><span>${escapeHtml(dateTime(x.createdAt))}</span></div>`).join('') : '<div class="empty compact-empty">Lifecycle, alert и response events для текущего deployment пока не зафиксированы.</div>'}</div>
      </details>
      <p class="tiny">SLO: ACK ≤ ${Number(regressionThresholds.ackMinutes || 30)} мин, critical overdue ACK ≥ ${Number(regressionThresholds.ackCriticalMinutes || 120)} мин, recovery ≤ ${Number(regressionThresholds.recoveryMinutes || 360)} мин. Investigation и resolution отображаются как latency metrics без нового SLA. State machine: NEW → ACKNOWLEDGED → INVESTIGATING → RESOLVED. RESOLVED разрешён только после RECOVERED. Auto-rollback и другие runtime mutations отсутствуют.</p>`;
  
    regression.querySelectorAll('.regression-response-btn').forEach(button=>{
      button.addEventListener('click',()=>transitionPostDeployRegressionResponse(String(button.dataset.responseState || '')));
    });
  
    const codes = c.topCodes || [];
    issues.innerHTML = `<div class="release-monitor-section-head"><strong>Главные сигналы</strong><span>предупреждение/ошибка/критическая</span></div>
      ${codes.length ? `<div class="release-issue-list">${codes.map(x => `<div><strong>${escapeHtml(humanizeTechnicalText(x.key))}</strong><span>${Number(x.count || 0)}</span></div>`).join('')}</div>` : '<div class="empty compact-empty">Ошибок и предупреждений за период нет.</div>'}`;
  
    const rows = r.incidents || [];
    incidents.innerHTML = `<details class="release-incidents"><summary>Последние события · ${rows.length}</summary>
      <div>${rows.length ? rows.map(x => `<article class="${escapeHtml(x.severity || 'warning')}">
        <div><strong>${escapeHtml(humanizeTechnicalText(x.code || x.source || ''))}</strong><span>${escapeHtml(dateTime(x.createdAt))}</span></div>
        <p>${escapeHtml(humanizeTechnicalText(x.message || ''))}</p>
        <small>${escapeHtml(x.source === 'worker' ? 'сервер' : x.source === 'release' ? 'релиз' : humanizeTechnicalText(x.source || ''))}${x.endpoint ? ` · ${escapeHtml(x.endpoint)}` : ''}</small>
      </article>`).join('') : '<div class="empty compact-empty">Нет событий.</div>'}</div>
    </details>
    <p class="tiny">${escapeHtml(humanizeTechnicalText(r.policy?.note || ''))}</p>`;
  }
  
  async function transitionPostDeployRegressionResponse(targetState='') {
    if (!isAdmin() || state.releaseRegressionResponsePending || !targetState) return;
    const deploySha=String(state.releaseMonitor?.postDeployRegression?.response?.deploySha || '');
    state.releaseRegressionResponsePending=true;
    renderReleaseMonitor();
    try {
      const result=await api('/api/post-deploy-regression-response',{
        method:'POST',
        body:JSON.stringify({state:targetState,deploySha}),
        retry:false,
        dedupe:false,
        timeoutMs:10000,
      });
      const labels={
        acknowledged:'Инцидент подтверждён.',
        investigating:'Расследование начато.',
        resolved:'Инцидент закрыт.',
      };
      toast(labels[String(result?.state || targetState)] || 'Состояние инцидента обновлено.');
      state.releaseMonitor=null;
      await loadReleaseMonitor(true);
    } catch (e) {
      toast(e.message);
      if (Number(e?.status || 0)===409) {
        state.releaseMonitor=null;
        await loadReleaseMonitor(true);
      }
    } finally {
      state.releaseRegressionResponsePending=false;
      renderReleaseMonitor();
    }
  }
  
  async function loadReleaseMonitor(force = false) {
    if (!isAdmin() || state.releaseMonitorLoading) return;
    if (!force && state.releaseMonitor) { renderReleaseMonitor(); return; }
    state.releaseMonitorLoading = true;
    renderReleaseMonitor();
    try {
      const hours = Number($('releaseMonitorPeriod')?.value || state.releaseMonitorHours || 24);
      const digestDays = Number($('releaseMonitorDigestPeriod')?.value || state.releaseMonitorDigestDays || 7) >= 30 ? 30 : 7;
      state.releaseMonitorHours = hours;
      state.releaseMonitorDigestDays = digestDays;
      state.releaseMonitor = await api(`/api/release-monitor?hours=${hours}&digestDays=${digestDays}${force ? '&refresh=1' : ''}`, {
        retry: false,
        timeoutMs: 12000,
      });
    } catch (e) {
      state.releaseMonitor = { available: false, reason: e.message };
      toast(e.message);
    } finally {
      state.releaseMonitorLoading = false;
      renderReleaseMonitor();
    }
  }

  return Object.freeze({
    renderReleaseMonitor,
    loadReleaseMonitor,
    transitionPostDeployRegressionResponse,
  });
}
