export function createAdminBetaDashboardModule({
  state,
  elementById,
  isAdmin,
  escapeHtml,
  humanizeTechnicalText,
  relativeAge,
  api,
}) {
  if (!state || typeof elementById !== 'function' || typeof isAdmin !== 'function') {
    throw new TypeError('Admin Beta Dashboard requires state, elementById and isAdmin.');
  }

  const $ = elementById;

  function betaTimingLabel(key = '') {
    return ({search:'Поиск',match:'Открытие матча',ai:'AI-анализ',live:'LIVE'})[key] || key;
  }
  
  function betaMs(value) {
    const ms=Number(value);
    if (!Number.isFinite(ms)) return '—';
    return ms>=1000 ? `${(ms/1000).toFixed(ms>=10000?1:2)} с` : `${Math.round(ms)} мс`;
  }
  
  function renderBetaDashboard() {
    if (!isAdmin()) return;
    const data=state.betaDashboard;
    const healthRoot=$('betaHealthSummary');
    const metricsRoot=$('betaMetrics');
    const timingsRoot=$('betaTimings');
    const errorsRoot=$('betaErrorCategories');
    const issuesRoot=$('betaIssueList');
    const meta=$('betaDashboardMeta');
    const badge=$('betaHealthBadge');
    if (!healthRoot || !metricsRoot || !timingsRoot || !errorsRoot || !issuesRoot || !badge) return;
  
    if (state.betaDashboardLoading) {
      badge.textContent='ПРОВЕРКА';
      badge.className='beta-health-badge watch';
      healthRoot.innerHTML='<div class="beta-empty">Собираю агрегированные Phase 5 production-сигналы…</div>';
      metricsRoot.innerHTML='';
      timingsRoot.innerHTML='';
      errorsRoot.innerHTML='';
      issuesRoot.innerHTML='';
      if (meta) meta.textContent='';
      return;
    }
  
    if (!data?.available) {
      badge.textContent='НЕТ ДАННЫХ';
      badge.className='beta-health-badge';
      healthRoot.innerHTML=`<div class="beta-empty">${escapeHtml(data?.reason || 'Phase 5 telemetry ещё не загружена.')}</div>`;
      metricsRoot.innerHTML='';
      timingsRoot.innerHTML='';
      errorsRoot.innerHTML='';
      issuesRoot.innerHTML='';
      return;
    }
  
    const users=data.users || {};
    const product=data.product || {};
    const provider=data.provider || {};
    const coverage=data.coverage || {};
    const gate=data.evidenceGate || {};
    const runtime=data.runtime || {};
    const quota=provider.quotaState || {};
    const requirements=gate.requirements || {};
    const status=String(data.status || 'COLLECT MORE EVIDENCE');
    const statusMap={
      'PUBLIC VALIDATION HEALTHY':['HEALTHY','healthy'],
      'COLLECT MORE EVIDENCE':['СБОР ДАННЫХ','watch'],
      'PROVIDER CAPACITY HOLD':['CAPACITY HOLD','incident'],
      'DATA COVERAGE REVIEW REQUIRED':['COVERAGE REVIEW','watch'],
      'PRODUCT BLOCKER HOLD':['PRODUCT HOLD','incident'],
    };
    const [statusLabel,statusClass]=statusMap[status] || [status,'watch'];
    badge.textContent=statusLabel;
    badge.className=`beta-health-badge ${statusClass}`;
  
    const threshold=(key,fallback=0)=>{
      const item=requirements[key] || {};
      return `${Number(item.actual ?? fallback)}/${Number(item.required || 0)}`;
    };
    const quotaLabel=quota.confirmed
      ? `${quota.plan || 'OK'} · day ${Number(quota.dailyRemaining || 0)}/${Number(quota.dailyLimit || 0)} · min ${Number(quota.minuteRemaining || 0)}/${Number(quota.minuteLimit || 0)}`
      : 'Не подтверждена';
    const cacheRate=provider.cacheHitRatePct===null || provider.cacheHitRatePct===undefined ? '—' : `${Number(provider.cacheHitRatePct)}%`;
    const requestsPerSession=provider.requestsPerSession===null || provider.requestsPerSession===undefined ? '—' : String(Number(provider.requestsPerSession));
    const liveStatus=String(gate.liveStatus || coverage.live?.status || 'INSUFFICIENT_LIVE_SAMPLE');
  
    healthRoot.innerHTML=[
      ['Verified normal users',threshold('verifiedNormalUsers',users.verifiedNormalUsers)],
      ['Sessions',threshold('sessions',users.sessions)],
      ['Full journeys',threshold('fullJourneys',users.completedJourneys)],
      ['Reopen / return',`${Number(users.reopenUsers || 0)} · ${Number(users.returnRatePct || 0)}%`],
      ['Search samples',threshold('searchSamples',product.searchSamples)],
      ['Match Center samples',threshold('matchCenterSamples',product.matchCenterSamples)],
      ['AI samples',threshold('aiSamples',product.aiSamples)],
      ['Coverage observations',threshold('coverageObservations',coverage.observations)],
      ['LIVE',liveStatus],
      ['Provider requests/session',requestsPerSession],
      ['Cache-hit rate',cacheRate],
      ['Stale-cache',String(Number(provider.staleCacheHits || 0))],
      ['Shared cooldown',String(Number(provider.sharedCooldowns || 0))],
      ['Quota blocks',String(Number(provider.quotaBlocks || 0))],
      ['API-Football quota',quotaLabel],
      ['Capacity decision',String(provider.capacityDecision || 'COLLECT MORE EVIDENCE')],
      ['Coverage decision',String(coverage.decision || 'COLLECT MORE EVIDENCE')],
      ['Phase 5 status',status],
    ].map(([label,value])=>`<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  
    const metricRows=[
      ['Поиск',Number(product.searchSamples || 0)],
      ['Match Center',Number(product.matchCenterSamples || 0)],
      ['AI',Number(product.aiSamples || 0)],
      ['LIVE',Number(product.liveSamples || 0)],
      ['Provider network',Number(provider.networkRequests || 0)],
      ['Cache hits',Number(provider.cacheHits || 0)],
      ['Stale cache',Number(provider.staleCacheHits || 0)],
      ['Provider usage rows',Number(data.sample?.providerUsageRows || 0)],
    ];
    metricsRoot.innerHTML=metricRows.map(([label,value])=>`
      <div class="beta-metric"><span>${escapeHtml(label)}</span><strong>${Number(value || 0)}</strong><small>агрегированно</small></div>
    `).join('');
  
    timingsRoot.innerHTML=Object.entries(data.performance || {}).map(([key,value])=>{
      const p50=value?.medianMs===null || value?.medianMs===undefined ? 'мало данных' : betaMs(value.medianMs);
      const p90=value?.p90Ms===null || value?.p90Ms===undefined ? 'мало данных' : betaMs(value.p90Ms);
      return `<div class="beta-timing"><span>${escapeHtml(betaTimingLabel(key))}</span><strong>P50 · ${escapeHtml(p50)}</strong><small>P90 · ${escapeHtml(p90)} · n=${Number(value?.samples || 0)}</small></div>`;
    }).join('');
  
    const runtimeRows=[
      ['provider rate-limit',runtime.providerRateLimit],
      ['provider errors',runtime.providerErrors],
      ['timeout',runtime.timeouts],
      ['client errors',runtime.clientErrors],
    ].filter(([,value])=>Number(value || 0)>0);
    errorsRoot.innerHTML=runtimeRows.length
      ? runtimeRows.map(([key,count])=>`<span class="beta-error-chip"><b>${escapeHtml(humanizeTechnicalText(key))}</b> ${Number(count || 0)}</span>`).join('')
      : '<span class="tiny">Ошибок Phase 5 cohort за период не зафиксировано.</span>';
  
    const abandonment=product.abandonmentStage || {};
    const abandonmentLabels={home:'Home → поиск',search:'Поиск → матч',matchCenter:'Матч → AI',ai:'AI → Мои команды',favoriteTeam:'Мои команды → история',history:'История → reopen'};
    const dropRows=Object.entries(abandonment).filter(([,count])=>Number(count || 0)>0);
    issuesRoot.innerHTML=dropRows.length
      ? dropRows.map(([stage,count])=>`<article class="beta-issue unconfirmed"><div><strong>${escapeHtml(abandonmentLabels[stage] || stage)}</strong><small>abandonment: ${Number(count || 0)}</small></div><p>Наблюдение агрегировано; изменение UX требует повторяющегося pattern или явного blocker.</p></article>`).join('')
      : '<div class="beta-empty">Abandonment pattern пока не подтверждён.</div>';
  
    if ($('betaJourneySummary')) $('betaJourneySummary').textContent=
      `${Number(users.completedJourneys || 0)} full journeys · ${Number(users.verifiedNormalUsers || 0)} verified normal users · ${Number(users.sessions || 0)} sessions. ${status}.`;
    if (meta) meta.textContent=`${Number(data.periodDays || 7)} дн. · cohort ${escapeHtml(data.cohort || 'phase5_public_v2')} · обновлено ${relativeAge(data.generatedAt)}`;
  }
  
  async function loadBetaDashboard(force = false) {
    if (!isAdmin() || state.betaDashboardLoading) return;
    if (!force && state.betaDashboard) { renderBetaDashboard(); return; }
    state.betaDashboardLoading=true;
    renderBetaDashboard();
    try {
      state.betaDashboard=await api(`/api/phase5-dashboard?days=${Number(state.betaDashboardDays || 7)}`,{timeoutMs:10000,retry:false,dedupe:false});
    } catch (error) {
      state.betaDashboard={available:false,reason:error.message || 'Не удалось загрузить Phase 5 Dashboard.'};
    } finally {
      state.betaDashboardLoading=false;
      renderBetaDashboard();
    }
  }

  return Object.freeze({
    renderBetaDashboard,
    loadBetaDashboard,
  });
}
