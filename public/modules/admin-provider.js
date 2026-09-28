// Phase 3 admin-only provider/ops boundary.
// Loaded lazily only after the server-authenticated profile reports admin role.
// Server-side authorization remains authoritative.
export function createAdminProviderModule(deps) {
  if (!document.querySelector('link[data-admin-styles]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/styles/admin.css?v=6.120.0';
    link.dataset.adminStyles = 'true';
    document.head.append(link);
  }
  const { state, $, isAdmin, humanizeTechnicalText, escapeHtml, planLabel, dateTime, technicalStateLabel, freshnessSourceLabel, toast, api, renderAdminOverview } = deps;

  function providerAuditStateLabel(stateValue) {
    return ({
      available: 'Данные',
      empty: 'Пусто',
      error: 'Ошибка',
      preview: 'После повышения тарифа',
      not_applicable: 'Не нужно',
    })[stateValue] || '—';
  }
  
  function renderProviderAudit() {
    if (!isAdmin()) return;
    const transition = state.providerTransition || {};
    const audit = state.providerAudit;
    const status = $('providerAuditStatus');
    const result = $('providerAuditResult');
    const runBtn = $('providerAuditBtn');
    const probeBtn = $('providerProbeBtn');
  
    if ($('providerTransitionMode')) $('providerTransitionMode').textContent = humanizeTechnicalText(transition.label || 'Ожидаем тариф');
    if ($('providerRefreshCadence')) $('providerRefreshCadence').textContent = transition.liveRefreshSeconds ? `${transition.liveRefreshSeconds} сек.` : '—';
    if ($('providerExpectedDaily')) $('providerExpectedDaily').textContent = transition.expected?.daily ? String(transition.expected.daily) : '—';
    if ($('providerExpectedMinute')) $('providerExpectedMinute').textContent = transition.expected?.minute ? String(transition.expected.minute) : '—';
  
    const budget = state.providerBudget || {};
    if ($('quotaBudgetMode')) $('quotaBudgetMode').textContent = humanizeTechnicalText(budget.label || 'Ожидаем данные');
    if ($('quotaBudgetDaily')) $('quotaBudgetDaily').textContent = Number.isFinite(Number(budget.daily?.remaining))
      ? `${budget.daily.remaining} · резерв ${Number(budget.daily?.reserve || 0)}` : '—';
    if ($('quotaBudgetMinute')) $('quotaBudgetMinute').textContent = Number.isFinite(Number(budget.minute?.remaining))
      ? `${budget.minute.remaining} · резерв ${Number(budget.minute?.reserve || 0)}` : '—';
    if ($('quotaFeatureApi')) $('quotaFeatureApi').textContent = String(Number(budget.counters?.api || 0));
    if ($('quotaFeatureCache')) $('quotaFeatureCache').textContent = String(Number(budget.counters?.cache || 0));
    if ($('quotaFeatureStale')) $('quotaFeatureStale').textContent = String(Number(budget.counters?.stale || 0));
    if ($('quotaFeatureSkipped')) $('quotaFeatureSkipped').textContent = String(Number(budget.counters?.skipped || 0));
    if ($('quotaBudgetNote')) $('quotaBudgetNote').textContent = humanizeTechnicalText(budget.note || 'Сохранение данных по функциям активно.');
  
    const featureList = $('quotaFeatureList');
    if (featureList) {
      const rows = Object.entries(budget.counters?.byFeature || {});
      featureList.innerHTML = rows.length ? rows.map(([name, c]) => `
        <div class="quota-feature-row">
          <strong>${escapeHtml(humanizeTechnicalText(name))}</strong>
          <span>источник ${Number(c.api || 0)}</span>
          <span>сохранено ${Number(c.cache || 0)}</span>
          <span>резерв ${Number(c.stale || 0)}</span>
          <span>пропуск ${Number(c.skipped || 0)}</span>
        </div>`).join('') : '<div class="empty compact-empty">Счётчики появятся после открытия центра матча.</div>';
    }
  
    if (runBtn) runBtn.disabled = Boolean(state.providerAuditLoading || state.providerE2ELoading);
    if (probeBtn) probeBtn.disabled = Boolean(state.providerAuditLoading || state.providerE2ELoading);
    if ($('providerE2EBtn')) $('providerE2EBtn').disabled = Boolean(state.providerAuditLoading || state.providerE2ELoading);
  
    if (!status || !result) return;
    if (state.providerAuditLoading) {
      status.textContent = '⏳ Выполняю контролируемую проверку источников данных…';
      result.hidden = true;
      return;
    }
    if (!audit) {
      status.textContent = transition.paid
        ? 'Тариф обнаружен. Укажите номер матча и запустите проверку.'
        : 'Сначала обновите тариф. На бесплатном плане полная проверка будет заблокирована для экономии квоты.';
      result.hidden = true;
      return;
    }
  
    result.hidden = false;
    const summary = audit.summary || {};
    const blocked = Boolean(audit.blocked);
    status.textContent = blocked
      ? humanizeTechnicalText(audit.note || 'Полная проверка заблокирована защитой квоты.')
      : `${humanizeTechnicalText(summary.label || 'Проверка завершена')} · ${Number(summary.score || 0)}% · ${Number(audit.durationMs || 0)} мс`;
  
    const fixture = audit.fixture || {};
    const endpoints = audit.endpoints || [];
    result.innerHTML = `
      <div class="provider-audit-head">
        <div><strong>${escapeHtml(fixture.home || '—')} — ${escapeHtml(fixture.away || '—')}</strong><span>Матч #${Number(fixture.fixtureId || 0)} · ${escapeHtml(humanizeTechnicalText(fixture.status || ''))}</span></div>
        <span class="provider-audit-score ${blocked ? 'blocked' : Number(summary.score || 0) >= 80 ? 'good' : 'warn'}">${blocked ? 'ЗАЩИТА' : `${Number(summary.score || 0)}%`}</span>
      </div>
      <div class="provider-audit-cost">
        <span>Запросов этого запуска</span><strong>${Number(audit.cost?.usedNow || 0)}</strong>
        <small>полная проверка максимум ${Number(audit.cost?.maxFullAudit || 0)}</small>
      </div>
      <div class="provider-endpoint-grid">${endpoints.map(x => `
        <div class="provider-endpoint-row ${escapeHtml(x.state || '')}">
          <div><strong>${escapeHtml(humanizeTechnicalText(x.label || x.key || ''))}</strong><small>${escapeHtml(humanizeTechnicalText(x.note || ''))}</small></div>
          <span>${providerAuditStateLabel(x.state)}</span>
          <em>${Number.isFinite(Number(x.latencyMs)) ? `${Number(x.latencyMs)} мс` : ''}</em>
        </div>`).join('')}</div>
      <p class="tiny">${escapeHtml(humanizeTechnicalText(audit.note || ''))}</p>`;
  }
  
  
  function e2eStepIcon(stateValue) {
    return stateValue === 'pass' ? '✓'
      : stateValue === 'fail' ? '×'
        : stateValue === 'warn' ? '!'
          : stateValue === 'hold' ? '⏸' : '•';
  }
  
  function e2eStepLabel(stateValue) {
    return stateValue === 'pass' ? 'Готово'
      : stateValue === 'fail' ? 'Ошибка'
        : stateValue === 'warn' ? 'Проверить'
          : stateValue === 'hold' ? 'Ожидание' : '—';
  }
  
  function renderExpandedDataReleaseGate() {
    if (!isAdmin()) return;
    const result = state.providerE2E;
    const transition = state.providerTransition || {};
    const budget = state.providerBudget || {};
    const badge = $('expandedGateBadge');
    const title = $('expandedGateTitle');
    const meta = $('expandedGateMeta');
    const stepsEl = $('expandedGateSteps');
    const details = $('expandedGateDetails');
    const btn = $('providerE2EBtn');
  
    if (btn) btn.disabled = Boolean(state.providerE2ELoading || state.providerAuditLoading);
    if (!badge || !title || !meta || !stepsEl || !details) return;
  
    if (state.providerE2ELoading) {
      badge.className = 'expanded-gate-badge running';
      badge.textContent = 'ВЫП.';
      title.textContent = 'Выполняется сквозная проверка расширенных данных…';
      meta.textContent = 'На повышенной квоте проверка может занять несколько десятков секунд.';
      stepsEl.innerHTML = '<div class="empty compact-empty">Проверяю источник данных → покрытие → центр матча → повторное использование сохранённых данных.</div>';
      details.hidden = true;
      return;
    }
  
    if (!result) {
      const paid = Boolean(transition.paid);
      badge.className = `expanded-gate-badge ${paid ? 'ready' : 'hold'}`;
      badge.textContent = paid ? 'ГОТОВ?' : 'ОЖИДАНИЕ';
      title.textContent = paid ? 'Тариф обнаружен — можно запускать сквозную проверку' : 'Сквозная проверка расширенных данных';
      meta.textContent = paid
        ? `${planLabel(transition.plan || 'PAID')} · ${humanizeTechnicalText(budget.label || 'режим не определён')}`
        : `${planLabel(transition.plan || 'FREE')} · полная проверка не тратит квоту до повышения тарифа`;
      stepsEl.innerHTML = `
        <div class="expanded-gate-empty">
          <strong>${paid ? 'Запустите финальную проверку на реальном матче.' : 'На бесплатном плане проверка безопасно остановится после одного запроса состояния.'}</strong>
          <p>Пользовательская монетизация остаётся выключенной.</p>
        </div>`;
      details.hidden = true;
      return;
    }
  
    const status = result.status || {};
    const cls = status.code === 'READY' ? 'ready'
      : status.code === 'READY_WITH_LIMITATIONS' ? 'warn'
        : status.code === 'NEEDS_ATTENTION' ? 'fail' : 'hold';
    badge.className = `expanded-gate-badge ${cls}`;
    badge.textContent = status.code === 'READY' ? 'ГОТОВО'
      : status.code === 'READY_WITH_LIMITATIONS' ? 'ОГРАН.'
        : status.code === 'NEEDS_ATTENTION' ? 'ПРОВЕРИТЬ' : 'ОЖИДАНИЕ';
    title.textContent = humanizeTechnicalText(status.label || 'Сквозная проверка расширенных данных');
    meta.textContent = `Матч #${Number(result.fixtureId || 0)} · ${dateTime(result.generatedAt)} · ${Number(result.durationMs || 0)} мс`;
  
    stepsEl.innerHTML = (result.steps || []).map(step => `
      <div class="expanded-gate-step ${escapeHtml(step.state || '')}">
        <span>${e2eStepIcon(step.state)}</span>
        <div><strong>${escapeHtml(humanizeTechnicalText(step.label || ''))}</strong><small>${escapeHtml(humanizeTechnicalText(step.note || ''))}</small></div>
        <em>${e2eStepLabel(step.state)}</em>
      </div>`).join('');
  
    details.hidden = false;
    const coverage = result.coverageAudit?.summary;
    const freshness = result.matchCenter?.dataFreshness || {};
    const sourceCounts = Object.values(freshness).reduce((acc, x) => {
      const key = x?.source || 'other';
      acc[key] = Number(acc[key] || 0) + 1;
      return acc;
    }, {});
    details.innerHTML = `
      <div class="expanded-gate-metrics">
        <div><span>Тариф</span><strong>${escapeHtml(planLabel(result.transition?.plan || '—'))}</strong></div>
        <div><span>Покрытие</span><strong>${coverage ? `${Number(coverage.score || 0)}%` : '—'}</strong></div>
        <div><span>Повтор из сохранённых данных</span><strong>${result.cacheVerification?.cached ? 'Да' : result.blocked ? '—' : 'Проверить'}</strong></div>
        <div><span>Расход за день</span><strong>${Number.isFinite(Number(result.requestCost?.observedDailyDelta)) ? Number(result.requestCost.observedDailyDelta) : '—'}</strong></div>
      </div>
      ${result.matchCenter?.fixture ? `<div class="expanded-gate-fixture">
        <strong>${escapeHtml(result.matchCenter.fixture.home?.name || '')} — ${escapeHtml(result.matchCenter.fixture.away?.name || '')}</strong>
        <span>${escapeHtml(technicalStateLabel(result.matchCenter.mode || 'waiting'))} · первый ответ ${Number(result.matchCenter.firstResponseMs || 0)} мс · повтор из сохранённых данных ${Number(result.cacheVerification?.secondResponseMs || 0)} мс</span>
      </div>` : ''}
      ${Object.keys(sourceCounts).length ? `<div class="expanded-gate-sources">${Object.entries(sourceCounts).map(([key,value]) => `<span>${escapeHtml(freshnessSourceLabel(key))} <b>${Number(value)}</b></span>`).join('')}</div>` : ''}
      <p class="tiny">${escapeHtml(humanizeTechnicalText(result.note || ''))}</p>`;
  }
  
  async function runProviderE2E(fixtureId) {
    if (!isAdmin() || state.providerE2ELoading || state.providerAuditLoading) return;
    const id = Number(fixtureId || $('providerAuditFixtureId')?.value || 0);
    if (!id) { toast('Укажите номер матча'); return; }
    if ($('providerAuditFixtureId')) $('providerAuditFixtureId').value = String(id);
  
    state.providerE2ELoading = true;
    renderExpandedDataReleaseGate();
    try {
      const data = await api(`/api/provider/e2e-validation?fixtureId=${id}`, {
        retry: false,
        dedupe: false,
        timeoutMs: 60000,
      });
      state.providerE2E = data;
      state.provider = data.provider || state.provider;
      state.providerTransition = data.transition || state.providerTransition;
      state.providerBudget = data.budget || state.providerBudget;
      if (data.coverageAudit) state.providerAudit = { ...data.coverageAudit, fixture: data.coverageAudit.fixture || state.providerAudit?.fixture };
      toast(data.status?.ready ? 'Сквозная проверка расширенных данных пройдена' : (data.status?.label || 'Сквозная проверка завершена'));
    } catch (e) {
      toast(e.message);
    } finally {
      state.providerE2ELoading = false;
      renderProvider();
    }
  }
  
  function renderProvider() {
    if (!isAdmin()) return;
    const p = state.provider || {};
    if (!$('providerPlan')) return;
    $('providerPlan').textContent = p.plan && p.plan !== 'UNKNOWN' ? planLabel(p.plan) : 'Определяется';
    $('providerDaily').textContent = Number.isFinite(Number(p.dailyRemaining)) && Number.isFinite(Number(p.dailyLimit))
      ? `${p.dailyRemaining} / ${p.dailyLimit}` : '—';
    $('providerMinute').textContent = Number.isFinite(Number(p.minuteRemaining)) && Number.isFinite(Number(p.minuteLimit))
      ? `${p.minuteRemaining} / ${p.minuteLimit}` : '—';
    $('providerLiveOdds').textContent = p.liveOddsReady ? 'Авто · расширенный режим' : 'Экономный режим';
    if ($('providerPlayerStats')) $('providerPlayerStats').textContent = p.playerStatsReady ? 'Авто · расширенный' : 'По требованию';
    if ($('providerOddsMovement')) $('providerOddsMovement').textContent = p.oddsMovementReady ? 'История включена' : 'Экономный режим';

    const sloReport = state.providerObservability || {};
    const slo = sloReport.overall || {};
    const sloLabels = {
      healthy:'В норме',
      watch:'Нужен контроль',
      incident:'Нарушен',
      collecting:'Собираем данные',
      idle:'Нет запросов',
    };
    if ($('providerSloState')) $('providerSloState').textContent = sloLabels[slo.state] || 'Собираем данные';
    if ($('providerSloSuccess')) $('providerSloSuccess').textContent = Number.isFinite(Number(slo.successRatePct))
      ? `${Number(slo.successRatePct).toFixed(1)}% · ${Number(slo.successes || 0)}/${Number(slo.requests || 0)}`
      : '—';
    if ($('providerSloRetry')) $('providerSloRetry').textContent = Number.isFinite(Number(slo.retryRatePct))
      ? `${Number(slo.retryRatePct).toFixed(1)}% · ${Number(slo.retries || 0)}`
      : '—';
    if ($('providerSloLatency')) $('providerSloLatency').textContent = Number.isFinite(Number(slo.avgAttemptLatencyMs))
      ? `${Number(slo.avgAttemptLatencyMs)} мс`
      : '—';
    if ($('providerSloNote')) {
      const persistence = sloReport.persistent ? '24-часовые окна сохраняются в журнале.' : 'Показана локальная выборка текущего Worker.';
      $('providerSloNote').textContent = `${humanizeTechnicalText(slo.label || 'SLO собирает рабочую выборку.')} ${persistence}`;
    }

    const incident = sloReport.incident || {};
    const incidentPanel = $('providerSloIncidentPanel');
    const activeIncident = incident.activeIncident || null;
    const incidentHistory = Array.isArray(incident.history) ? incident.history : [];
    if (incidentPanel) {
      const hasIncidentEvidence = Boolean(activeIncident || incidentHistory.length);
      incidentPanel.hidden = !hasIncidentEvidence;
      incidentPanel.classList.toggle('incident', activeIncident?.state === 'incident');
      incidentPanel.classList.toggle('watch', activeIncident?.state === 'watch');
      incidentPanel.classList.toggle('recovered', !activeIncident && incidentHistory.length > 0);

      if ($('providerSloIncidentBadge')) {
        $('providerSloIncidentBadge').textContent = activeIncident?.state === 'incident'
          ? 'ИНЦИДЕНТ'
          : activeIncident?.state === 'watch'
            ? 'КОНТРОЛЬ'
            : 'ВОССТАНОВЛЕНО';
      }
      if ($('providerSloIncidentTitle')) {
        $('providerSloIncidentTitle').textContent = activeIncident
          ? (activeIncident.state === 'incident' ? 'Устойчивая деградация provider SLO' : 'Provider SLO требует контроля')
          : 'Активных provider SLO инцидентов нет';
      }
      if ($('providerSloIncidentMeta')) {
        const latest = activeIncident || incidentHistory[0] || {};
        const started = latest.startedAt ? dateTime(latest.startedAt) : '—';
        const duration = Number.isFinite(Number(latest.durationMinutes)) ? `${Number(latest.durationMinutes).toFixed(1)} мин` : '—';
        $('providerSloIncidentMeta').textContent = activeIncident
          ? `Подтверждено двумя SLO-окнами · начало ${started} · длительность ${duration}`
          : `Последнее восстановление: ${latest.recoveredAt ? dateTime(latest.recoveredAt) : '—'}`;
      }
      if ($('providerSloIncidentRunbook')) {
        const steps = activeIncident?.runbook || [];
        $('providerSloIncidentRunbook').innerHTML = steps.length
          ? `<strong>Что проверить</strong><ul>${steps.map(step => `<li>${escapeHtml(humanizeTechnicalText(step))}</li>`).join('')}</ul>`
          : '<span>Автоматические rollback и отключение функций не выполняются.</span>';
      }
      if ($('providerSloIncidentHistory')) {
        $('providerSloIncidentHistory').innerHTML = incidentHistory.length
          ? incidentHistory.slice(0,3).map(item => `<div><span>${item.active ? 'Активен' : 'Восстановлен'}</span><strong>${escapeHtml(humanizeTechnicalText(item.highestState === 'incident' ? 'Инцидент' : 'Контроль'))}</strong><small>${escapeHtml(item.startedAt ? dateTime(item.startedAt) : '—')} · ${Number.isFinite(Number(item.durationMinutes)) ? `${Number(item.durationMinutes).toFixed(1)} мин` : '—'}</small></div>`).join('')
          : '';
      }
    }

    renderProviderAudit();
    renderExpandedDataReleaseGate();
    renderAdminOverview();
  }
  
  async function loadProvider() {
    if (!isAdmin()) return;
    try {
      const data = await api('/api/provider');
      state.provider = data.provider || state.provider;
      state.providerTransition = data.transition || state.providerTransition;
      state.providerBudget = data.budget || state.providerBudget;
      state.providerObservability = data.providerObservability || state.providerObservability;
      state.providerAudit = data.lastAudit || state.providerAudit;
      state.providerE2E = data.lastE2E || state.providerE2E;
      state.providerLoaded = true;
      renderProvider();
    } catch {}
  }
  
  async function probeProvider() {
    if (!isAdmin() || state.providerAuditLoading) return;
    state.providerAuditLoading = true;
    renderProviderAudit();
    try {
      const data = await api('/api/provider/probe?refresh=1', { retry: false, dedupe: false });
      state.provider = data.provider || state.provider;
      state.providerTransition = data.transition || state.providerTransition;
      try {
        const budgetData = await api('/api/provider/budget', { retry: false });
        state.providerBudget = budgetData.budget || state.providerBudget;
      } catch {}
      toast(data.probe?.ok ? 'Тариф и квоты обновлены' : (data.probe?.note || 'Проверка тарифа завершена'));
    } catch (e) {
      toast(e.message);
    } finally {
      state.providerAuditLoading = false;
      renderProvider();
    }
  }
  
  async function runProviderCoverageAudit(fixtureId, force = true) {
    if (!isAdmin() || state.providerAuditLoading) return;
    const id = Number(fixtureId || $('providerAuditFixtureId')?.value || 0);
    if (!id) { toast('Укажите номер матча'); return; }
    if ($('providerAuditFixtureId')) $('providerAuditFixtureId').value = String(id);
    state.providerAuditLoading = true;
    renderProviderAudit();
    try {
      const data = await api(`/api/provider/coverage-audit?fixtureId=${id}${force ? '&refresh=1' : ''}`, {
        retry: false,
        dedupe: false,
        timeoutMs: 30000,
      });
      state.providerAudit = data;
      state.provider = data.provider || state.provider;
      state.providerTransition = data.transition || state.providerTransition;
      try {
        const budgetData = await api('/api/provider/budget', { retry: false });
        state.providerBudget = budgetData.budget || state.providerBudget;
      } catch {}
      toast(data.blocked ? 'Защита не дала потратить лишнюю квоту' : 'Проверка покрытия завершена');
    } catch (e) {
      toast(e.message);
    } finally {
      state.providerAuditLoading = false;
      renderProvider();
    }
  }
  
  

  return { renderProviderAudit, renderExpandedDataReleaseGate, runProviderE2E, renderProvider, loadProvider, probeProvider, runProviderCoverageAudit };
}
