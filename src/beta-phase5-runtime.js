export const PHASE5_VALIDATION_COHORT = 'phase5_public_v2';

// Closed-beta and Phase 5 analytics, evidence gates and expansion dashboards extracted from worker.js.
// Diagnostics, telemetry and provider primitives are injected by the composition root.
export function createBetaPhase5Runtime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Beta/Phase 5 runtime dependencies are required.');
  }
  const {
    APP_VERSION,
    CLOSED_BETA_COHORT,
    PHASE5_VALIDATION_COHORT,
    RC_NAME,
    RELEASE_CHANNEL,
    billingWebhookStatus,
    collectDiagnostics,
    hasSupabase,
    isClosedBetaUser,
    json,
    providerSnapshot,
    readOpsEventsRange,
    recordOpsEvent,
    redactOpsString,
  } = deps;

  const BETA_FEEDBACK_CATEGORIES = new Set(['search','matches','ai','live','ux','data_sources','performance']);
  const BETA_FEEDBACK_SEVERITIES = new Set(['BLOCKER','MAJOR','MINOR']);

  function finiteEvidenceNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.length > 48) return null;
    const raw=value.trim();
    if (!raw || !/^-?(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function evidenceCount(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  function normalizedProviderQuota(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const plan = String(source.plan || 'UNKNOWN').trim().toUpperCase();
    const dailyLimit = finiteEvidenceNumber(source.dailyLimit);
    const dailyRemaining = finiteEvidenceNumber(source.dailyRemaining);
    const minuteLimit = finiteEvidenceNumber(source.minuteLimit);
    const minuteRemaining = finiteEvidenceNumber(source.minuteRemaining);
    const complete = ['FREE','PRO','ULTRA','MEGA'].includes(plan)
      && dailyLimit !== null && dailyLimit > 0
      && dailyRemaining !== null && dailyRemaining >= 0 && dailyRemaining <= dailyLimit
      && minuteLimit !== null && minuteLimit > 0
      && minuteRemaining !== null && minuteRemaining >= 0 && minuteRemaining <= minuteLimit;
    return {
      complete,
      plan: complete ? plan : '',
      dailyLimit: complete ? dailyLimit : null,
      dailyRemaining: complete ? dailyRemaining : null,
      minuteLimit: complete ? minuteLimit : null,
      minuteRemaining: complete ? minuteRemaining : null,
    };
  }

  function trustedEventTime(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const raw=value.trim();
    const calendar=/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(raw);
    if (!calendar) return null;
    const year=Number(calendar[1]);
    const month=Number(calendar[2]);
    const day=Number(calendar[3]);
    if (!Number.isSafeInteger(year) || month<1 || month>12 || day<1) return null;
    const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
    if (day>maxDay) return null;
    const parsed=Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function observationRowsInRange(rows = [], fromMs, toMs) {
    if (!Array.isArray(rows) || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) return [];
    return rows.filter(row=>{
      const at=trustedEventTime(row?.created_at);
      return at !== null && at >= fromMs && at <= toMs;
    });
  }
  
  function betaPercentileMs(values = [], percentile = 0.5) {
    const sorted = (Array.isArray(values) ? values : [])
      .map(finiteEvidenceNumber)
      .filter(value=>value !== null)
      .sort((a,b)=>a-b);
    if (!sorted.length) return null;
    const percentileNumber=finiteEvidenceNumber(percentile);
    const boundedPercentile=percentileNumber === null ? 0.5 : Math.max(0, Math.min(1, percentileNumber));
    const pos = (sorted.length - 1) * boundedPercentile;
    const lower = Math.floor(pos);
    const upper = Math.ceil(pos);
    if (lower === upper) return Math.round(sorted[lower]);
    const value = sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower);
    return Math.round(value);
  }
  
  function betaIssueMeta(category = '') {
    const map = {
      search: {
        label:'Поиск',
        impact:'Пользователь не находит нужный матч или не может продолжить основной путь.',
        fix:'Проверить воспроизводимость поиска, ответ источника и состояние пустой выдачи; исправлять только подтверждённую причину.',
      },
      matches: {
        label:'Матчи',
        impact:'Карточка или центр матча открывается нестабильно либо не открывается.',
        fix:'Сопоставить ошибки открытия с логами match-center, доступностью данных и повторным воспроизведением.',
      },
      ai: {
        label:'AI',
        impact:'AI-анализ не запускается либо не завершается после явного действия пользователя.',
        fix:'Сверить ai_start/ai_complete, категорию ошибки и серверные события; не менять модель ради улучшения процента.',
      },
      live: {
        label:'LIVE',
        impact:'LIVE-экран или его обновление работает нестабильно.',
        fix:'Проверить refresh-путь, timeout/rate-limit и доступность live-данных; сохранить fail-soft поведение.',
      },
      ux: {
        label:'UX',
        impact:'Интерфейс непонятен или мешает пройти основной сценарий без технического сбоя.',
        fix:'Подтвердить повторяемость жалобы и путь пользователя; менять интерфейс после нескольких согласованных сигналов.',
      },
      data_sources: {
        label:'Источники данных',
        impact:'Нужные футбольные данные отсутствуют или источник ограничивает запросы.',
        fix:'Сопоставить provider/rate-limit с частотой отсутствующих данных; платный или новый provider рассматривать только при устойчивом подтверждённом дефиците.',
      },
      performance: {
        label:'Производительность',
        impact:'Основные операции отвечают слишком долго или завершаются timeout.',
        fix:'Сопоставить P50/P90 с timeout-событиями и серверной диагностикой; оптимизировать подтверждённое узкое место.',
      },
    };
    return map[category] || map.ux;
  }
  
  async function apiBetaFeedback(request, cfg, user) {
    if (request.method !== 'POST') return json({error:'Метод не поддерживается.'},405);
    if (!isClosedBetaUser(user,cfg)) {
      return json({error:'Обратная связь закрытой beta доступна только приглашённым тестировщикам.',code:'BETA_MEMBERSHIP_REQUIRED'},403);
    }
    let body={};
    try { body=await request.json(); } catch {}
    const category=String(body?.category || '').trim().toLowerCase();
    const betaSeverity=String(body?.severity || '').trim().toUpperCase();
    const note=redactOpsString(String(body?.note || '').trim(),600);
    if (!BETA_FEEDBACK_CATEGORIES.has(category)) return json({error:'Выберите раздел проблемы.'},400);
    if (!BETA_FEEDBACK_SEVERITIES.has(betaSeverity)) return json({error:'Выберите важность проблемы.'},400);
    if (note.length < 5) return json({error:'Кратко опишите, что произошло.'},400);
    const severity=betaSeverity==='BLOCKER' ? 'critical' : betaSeverity==='MAJOR' ? 'warning' : 'info';
    await recordOpsEvent(cfg,{
      severity,
      source:'beta',
      eventType:'beta_feedback',
      code:'BETA_FEEDBACK',
      message:`Beta feedback: ${note}`,
      endpoint:'/api/beta-feedback',
      meta:{category,betaSeverity,explicitUserFeedback:true,betaCohort:CLOSED_BETA_COHORT,betaMembershipVerified:true},
    });
    return json({ok:true});
  }
  
  function betaClientEventRows(rows = [], eventName = '') {
    const target=String(eventName || '');
    return (rows || []).filter(row=>{
      if (row?.source!=='client' || row?.event_type!=='client_telemetry') return false;
      const code=String(row?.code || '');
      if (target==='miniapp_open') return code==='BOOT_OK';
      if (target==='miniapp_error') return code==='ACTION_ERROR';
      if (!target.startsWith('miniapp_')) return false;
      return code==='PRODUCT_ACTION' && String(row?.metadata?.reason || '')===target.slice('miniapp_'.length);
    });
  }
  
  function betaMetricSummary(rows = [], eventName = '') {
    const matched=betaClientEventRows(rows,eventName);
    const users=new Set(matched
      .map(row=>String(row?.metadata?.betaSubject || ''))
      .filter(subject=>/^[0-9a-f]{32}$/.test(subject)));
    return {events:matched.length,users:users.size};
  }
  
  function betaTimingSummary(opsRows = [], operation = '') {
    const values=(Array.isArray(opsRows) ? opsRows : [])
      .filter(row=>row?.source==='client' && row?.event_type==='client_telemetry' && row?.code==='OPERATION_TIMING'
        && String(row?.metadata?.reason || '')===operation)
      .map(row=>finiteEvidenceNumber(row?.duration_ms))
      .filter(value=>value !== null && value>=0 && value<=120000);
    return {
      samples:values.length,
      medianMs:values.length>=3 ? betaPercentileMs(values,0.5) : null,
      p90Ms:values.length>=10 ? betaPercentileMs(values,0.9) : null,
      percentileRule:'median>=3 samples; p90>=10 samples',
    };
  }
  
  function betaFeedbackCounts(feedbackRows = [], category = '') {
    const rows=(Array.isArray(feedbackRows) ? feedbackRows : [])
      .filter(row=>String(row?.metadata?.category || '')===category);
    const severity={BLOCKER:0,MAJOR:0,MINOR:0};
    for (const row of rows) {
      const key=String(row?.metadata?.betaSeverity || '').toUpperCase();
      if (key in severity) severity[key]+=1;
    }
    return {total:rows.length,severity};
  }
  
  function betaErrorCountByAction(errorRows = [], action = '') {
    return errorRows.filter(row=>String(row?.metadata?.action || row?.metadata?.reason || '')===action).length;
  }
  
  function betaErrorCountByKind(errorRows = [], kinds = []) {
    const allowed=new Set(kinds);
    return errorRows.filter(row=>allowed.has(String(row?.metadata?.errorKind || ''))).length;
  }
  
  function betaCoverageSummary(rows = []) {
    const coverageRows=(Array.isArray(rows) ? rows : [])
      .filter(row=>row?.source==='client' && row?.event_type==='client_telemetry' && row?.code==='DATA_COVERAGE');
    const keys=['lineups','injuries','statistics','xg','odds'];
    const summarizeMissing=(sampleRows=[])=>{
      const missing={};
      for (const key of keys) {
        const field=`${key}Available`;
        const observed=(sampleRows || []).filter(row=>typeof row?.metadata?.[field] === 'boolean');
        const missingCount=observed.filter(row=>row.metadata[field]===false).length;
        missing[key]={
          samples:observed.length,
          missing:missingCount,
          missingPct:observed.length ? Math.round((missingCount/observed.length)*1000)/10 : 0,
        };
      }
      return missing;
    };
    const byMode={};
    for (const row of coverageRows) {
      const mode=String(row?.metadata?.matchMode || 'unknown');
      byMode[mode]=Number(byMode[mode] || 0)+1;
    }
    const liveRows=coverageRows.filter(row=>String(row?.metadata?.matchMode || '')==='live');
    return {
      samples:coverageRows.length,
      missing:summarizeMissing(coverageRows),
      byMode,
      live:{
        samples:liveRows.length,
        missing:summarizeMissing(liveRows),
      },
    };
  }
  
  function betaExpansionDecision(input = {}) {
    const source=input && typeof input==='object' && !Array.isArray(input) ? input : {};
    const metrics=source.metrics && typeof source.metrics==='object' && !Array.isArray(source.metrics) ? source.metrics : {};
    const journey=source.journey && typeof source.journey==='object' && !Array.isArray(source.journey) ? source.journey : {};
    const timings=source.timings && typeof source.timings==='object' && !Array.isArray(source.timings) ? source.timings : {};
    const coverage=source.coverage && typeof source.coverage==='object' && !Array.isArray(source.coverage) ? source.coverage : {};
    const issues=Array.isArray(source.issues) ? source.issues : [];
    const invalidIssues=source.issues!==undefined && !Array.isArray(source.issues);
    const launchBlockers=Array.isArray(source.launchBlockers)
      ? source.launchBlockers.filter(Boolean).map(value=>String(value))
      : source.launchBlockers===undefined
        ? []
        : ['invalid_launch_blockers'];
    const opsSampleLimited=source.opsSampleLimited===true;
    const invalidOpsSampleFlag=source.opsSampleLimited!==undefined && typeof source.opsSampleLimited!=='boolean';
    const rawProviderEvidence=source.providerEvidence===undefined ? 'insufficient_evidence' : String(source.providerEvidence);
    const providerEvidenceValid=['insufficient_evidence','review_provider_options'].includes(rawProviderEvidence);
    const providerEvidence=providerEvidenceValid ? rawProviderEvidence : 'insufficient_evidence';
    const betaUsers=evidenceCount(journey.betaUsers);
    const sessionStarts=evidenceCount(metrics.miniAppLaunch?.events);
    const fullJourneys=evidenceCount(journey.fullCompleted);
    const blockerCount=issues.filter(issue=>issue?.classification==='BLOCKER').length;
    const majorCount=issues.filter(issue=>issue?.classification==='MAJOR').length;
    const needsMoreEvidence=issues.filter(issue=>issue?.classification==='NEEDS_MORE_EVIDENCE').length;
    const coreTimingSamples={
      search:evidenceCount(timings?.search?.samples),
      match:evidenceCount(timings?.match?.samples),
      ai:evidenceCount(timings?.ai?.samples),
    };
    const coverageSamples=evidenceCount(coverage?.samples);
    const requirements={
      verifiedUsers:{required:2,actual:betaUsers,pass:betaUsers>=2},
      verifiedSessionStarts:{required:7,actual:sessionStarts,pass:sessionStarts>=7},
      fullJourneys:{required:2,actual:fullJourneys,pass:fullJourneys>=2},
      searchTimingSamples:{required:3,actual:coreTimingSamples.search,pass:coreTimingSamples.search>=3},
      matchTimingSamples:{required:3,actual:coreTimingSamples.match,pass:coreTimingSamples.match>=3},
      aiTimingSamples:{required:3,actual:coreTimingSamples.ai,pass:coreTimingSamples.ai>=3},
      coverageSamples:{required:10,actual:coverageSamples,pass:coverageSamples>=10},
    };
    const evidenceComplete=Object.values(requirements).every(item=>item.pass);
    const hardBlockers=[
      ...launchBlockers,
      ...(invalidIssues ? ['invalid_issue_evidence'] : []),
      ...(invalidOpsSampleFlag ? ['invalid_ops_sample_flag'] : []),
      ...(!providerEvidenceValid ? ['invalid_provider_evidence'] : []),
      ...(opsSampleLimited ? ['beta_ops_sample_truncated'] : []),
      ...(blockerCount>0 ? ['confirmed_blocker'] : []),
      ...(majorCount>0 ? ['confirmed_major'] : []),
    ];
    const dataCoverageDecision=coverageSamples<10
      ? 'collect_more_coverage'
      : providerEvidence==='review_provider_options'
        ? 'review_new_or_paid_provider'
        : 'keep_current_provider';
    let status='collecting_verified_beta';
    if (hardBlockers.length) status='hold';
    else if (evidenceComplete && dataCoverageDecision==='review_new_or_paid_provider') status='expand_with_data_limitations';
    else if (evidenceComplete) status='ready_to_expand';
    const expansionAllowed=['ready_to_expand','expand_with_data_limitations'].includes(status);
    return {
      status,
      expansionAllowed,
      closedBetaLaunchStageComplete:expansionAllowed,
      requirements,
      hardBlockers,
      blockerCount,
      majorCount,
      needsMoreEvidence,
      dataCoverageDecision,
      providerEvidence,
      decisionRule:'Expansion requires real verified beta users/sessions, repeated full journeys, core latency evidence, coverage evidence, zero BLOCKER/MAJOR and no launch/runtime blocker.',
      sessionDefinition:'One verified beta session start equals an accepted server-side closed_beta_v1 BOOT_OK event after telemetry dedupe.',
    };
  }
  
  function quotaRemainingPct(limit,remaining) {
    const l=finiteEvidenceNumber(limit);
    const r=finiteEvidenceNumber(remaining);
    if (l === null || l <= 0 || r === null || r < 0 || r > l) return null;
    return Math.round((r/l)*1000)/10;
  }
  
  function betaProductionMonitorSummary(rows = [], nowMs = Date.now()) {
    const now=finiteEvidenceNumber(nowMs);
    if (now === null || now < 0) {
      return {state:'unknown',latestCode:'',lastSeen:null,samples:0,incidentCount:0,watchCount:0};
    }
    const recent=(Array.isArray(rows) ? rows : [])
      .map(row=>({row,at:trustedEventTime(row?.created_at)}))
      .filter(item=>
        item.row?.source==='monitor'
        && item.row?.event_type==='production_monitor'
        && item.at !== null
        && item.at <= now + 60_000
        && now-item.at <= 6*60*60_000
      )
      .sort((a,b)=>b.at-a.at)
      .map(item=>item.row);
    const latest=recent[0] || null;
    const latestCode=String(latest?.code || '');
    const state=!latest ? 'unknown'
      : latestCode==='PRODUCTION_MONITOR_INCIDENT' ? 'incident'
        : latestCode==='PRODUCTION_MONITOR_WATCH' ? 'watch'
          : ['PRODUCTION_MONITOR_HEALTHY','PRODUCTION_MONITOR_RECOVERED'].includes(latestCode) ? 'healthy'
            : 'unknown';
    return {
      state,
      latestCode,
      lastSeen:latest?.created_at || null,
      samples:recent.length,
      incidentCount:recent.filter(row=>String(row?.code || '')==='PRODUCTION_MONITOR_INCIDENT').length,
      watchCount:recent.filter(row=>String(row?.code || '')==='PRODUCTION_MONITOR_WATCH').length,
    };
  }
  
  function controlledBetaExpansionDecision(input = {}) {
    const root=input && typeof input==='object' && !Array.isArray(input) ? input : {};
    const expansionDecision=root.expansionDecision && typeof root.expansionDecision==='object' && !Array.isArray(root.expansionDecision)
      ? root.expansionDecision
      : {};
    const journey=root.journey && typeof root.journey==='object' && !Array.isArray(root.journey) ? root.journey : {};
    const metrics=root.metrics && typeof root.metrics==='object' && !Array.isArray(root.metrics) ? root.metrics : {};
    const timings=root.timings && typeof root.timings==='object' && !Array.isArray(root.timings) ? root.timings : {};
    const coverage=root.coverage && typeof root.coverage==='object' && !Array.isArray(root.coverage) ? root.coverage : {};
    const issues=Array.isArray(root.issues) ? root.issues : [];
    const errorRows=Array.isArray(root.errorRows) ? root.errorRows : [];
    const clientErrorRows=Array.isArray(root.clientErrorRows) ? root.clientErrorRows : [];
    const productionMonitor=root.productionMonitor && typeof root.productionMonitor==='object' && !Array.isArray(root.productionMonitor)
      ? root.productionMonitor
      : {};
    const providerQuota=root.providerQuota && typeof root.providerQuota==='object' && !Array.isArray(root.providerQuota)
      ? root.providerQuota
      : {};

    const verifiedUsers=evidenceCount(journey.betaUsers);
    const assignedUsers=evidenceCount(root.assignedBetaUsers);
    const fullJourneys=evidenceCount(journey.fullCompleted);
    const blockerCount=issues.filter(issue=>issue?.classification==='BLOCKER').length;
    const majorCount=issues.filter(issue=>issue?.classification==='MAJOR').length;
    const searchTimeouts=errorRows.filter(row=>String(row?.metadata?.action || '')==='search' && String(row?.metadata?.errorKind || '')==='timeout').length;
    const providerRateLimit=errorRows.filter(row=>String(row?.metadata?.errorKind || '')==='rate_limit').length;
    const providerErrors=errorRows.filter(row=>String(row?.metadata?.errorKind || '')==='provider').length;
    const actionErrors=errorRows.length;

    const normalizedQuota=normalizedProviderQuota(providerQuota);
    const providerQuotaConfirmed=providerQuota.confirmed===true && normalizedQuota.complete;
    const dailyRemainingPct=providerQuotaConfirmed
      ? quotaRemainingPct(normalizedQuota.dailyLimit,normalizedQuota.dailyRemaining)
      : null;
    const minuteRemainingPct=providerQuotaConfirmed
      ? quotaRemainingPct(normalizedQuota.minuteLimit,normalizedQuota.minuteRemaining)
      : null;
    const quotaPressure=providerQuotaConfirmed && (
      (dailyRemainingPct!==null && dailyRemainingPct<=10)
      || (minuteRemainingPct!==null && minuteRemainingPct<=10)
    );

    const liveMissing=coverage?.live?.missing && typeof coverage.live.missing==='object' && !Array.isArray(coverage.live.missing)
      ? coverage.live.missing
      : {};
    const liveMissingCategories=Object.values(liveMissing).filter(item=>{
      const samples=evidenceCount(item?.samples);
      const missingPct=finiteEvidenceNumber(item?.missingPct);
      return samples>=5 && missingPct!==null && missingPct>=70 && missingPct<=100;
    }).length;
    const liveCoverageSamples=evidenceCount(coverage?.live?.samples);
    const liveCoverageDeficit=liveCoverageSamples>=5 && liveMissingCategories>=2;
    const providerReviewSignal=expansionDecision.dataCoverageDecision==='review_new_or_paid_provider'
      || providerRateLimit>=3
      || quotaPressure
      || liveCoverageDeficit;

    const wave1Observed=verifiedUsers>=4;
    const wave2Observed=verifiedUsers>=6;
    const coreLatencyEnough=['search','match','ai'].every(key=>evidenceCount(timings?.[key]?.samples)>=5);
    const liveLatencyEnough=evidenceCount(timings?.live?.samples)>=3;
    const coverageSamples=evidenceCount(coverage?.samples);
    const expandedEvidenceEnough=wave2Observed
      && fullJourneys>=4
      && coverageSamples>=20
      && coreLatencyEnough
      && liveLatencyEnough;

    const supabaseOk=root.supabaseOk===true;
    const telegramConfirmed=root.telegramConfirmed===true;
    const productionMonitorHealthy=productionMonitor.state==='healthy';
    const expansionAllowed=expansionDecision.expansionAllowed===true;
    const assignmentWaveValid=[2,4,6].includes(assignedUsers);
    const runtimePrerequisitesHealthy=Boolean(
      supabaseOk
      && telegramConfirmed
      && productionMonitorHealthy
      && providerQuotaConfirmed
      && blockerCount===0
      && majorCount===0
    );
    const runtimeHealthy=runtimePrerequisitesHealthy && !quotaPressure;

    const providerValidationDecision=!wave1Observed
      ? 'collecting_expanded_beta'
      : providerReviewSignal
        ? 'review_new_or_paid_provider'
        : 'keep_current_provider';

    let finalDecision='BETA HOLD';
    if (expansionAllowed && assignmentWaveValid) {
      if (!runtimePrerequisitesHealthy) {
        finalDecision='BETA HOLD';
      } else if (wave1Observed && providerValidationDecision==='review_new_or_paid_provider') {
        finalDecision='DATA PROVIDER UPGRADE REQUIRED';
      } else if (expandedEvidenceEnough && runtimeHealthy && providerValidationDecision==='keep_current_provider') {
        finalDecision='BETA READY FOR PUBLIC PRE-LAUNCH';
      } else {
        finalDecision='BETA CONTINUE';
      }
    }

    const nextWaveTarget=!expansionAllowed || !assignmentWaveValid ? null
      : verifiedUsers<4 ? 4
        : verifiedUsers<6 ? 6
          : null;
    const currentAssignmentsObserved=assignmentWaveValid && verifiedUsers>=assignedUsers;
    const canAddNextWave=Boolean(
      finalDecision==='BETA CONTINUE'
      && runtimeHealthy
      && nextWaveTarget
      && assignedUsers<nextWaveTarget
      && currentAssignmentsObserved
      && nextWaveTarget-assignedUsers===2
      && providerValidationDecision!=='review_new_or_paid_provider'
    );

    const requirements=expansionDecision.requirements && typeof expansionDecision.requirements==='object' && !Array.isArray(expansionDecision.requirements)
      ? expansionDecision.requirements
      : {};
    const initialGateGaps=Object.entries(requirements)
      .filter(([,value])=>value?.pass!==true)
      .map(([key])=>key);
    const launchBlockers=Array.isArray(expansionDecision.hardBlockers)
      ? [...new Set(expansionDecision.hardBlockers.map(String).filter(Boolean))]
      : expansionDecision.hardBlockers===undefined
        ? []
        : ['invalid_expansion_hard_blockers'];
    const launchBlockerSet=new Set(launchBlockers);
    const fieldBlockers=[];
    if (assignedUsers<2) fieldBlockers.push('beta_users_not_assigned');
    if (assignedUsers>=2 && !assignmentWaveValid) fieldBlockers.push('beta_assignment_wave_mismatch');
    if (verifiedUsers===0) fieldBlockers.push('verified_beta_telemetry_missing');
    if (!expansionAllowed) fieldBlockers.push('initial_expansion_gate_closed');
    for (const code of launchBlockers) if (!fieldBlockers.includes(code)) fieldBlockers.push(code);
    if (blockerCount>0 || majorCount>0) fieldBlockers.push('beta_product_issue');
    if (!supabaseOk || !telegramConfirmed || !productionMonitorHealthy) fieldBlockers.push('runtime_unhealthy');
    if (!providerQuotaConfirmed) fieldBlockers.push('provider_quota_unconfirmed');
    if (quotaPressure) fieldBlockers.push('provider_quota_pressure');
    if (wave1Observed && providerValidationDecision==='review_new_or_paid_provider') fieldBlockers.push('provider_review_required');

    const nextRequiredAction=assignedUsers<2
      ? 'assign_real_beta_users'
      : !assignmentWaveValid
        ? 'reconcile_beta_assignments'
        : launchBlockerSet.has('beta_admin_overlap')
        ? 'remove_beta_admin_overlap'
        : launchBlockerSet.has('strict_beta_access_disabled')
          ? 'enable_strict_beta_access'
          : launchBlockerSet.has('telegram_webhook_unconfirmed')
            ? 'confirm_telegram_webhook'
            : launchBlockerSet.has('provider_quota_unconfirmed') || !providerQuotaConfirmed
              ? 'confirm_provider_quota'
              : verifiedUsers<Math.min(assignedUsers,2)
                ? 'collect_verified_beta_usage'
                : !expansionAllowed
                  ? 'close_initial_expansion_requirements'
                  : !runtimeHealthy
                    ? 'restore_runtime_health'
                    : wave1Observed && providerValidationDecision==='review_new_or_paid_provider'
                      ? 'run_provider_evaluation'
                      : verifiedUsers<4
                        ? 'observe_wave_1'
                        : verifiedUsers<6
                          ? 'observe_wave_2'
                          : !expandedEvidenceEnough
                            ? 'collect_expanded_beta_evidence'
                            : 'none';

    return {
      finalDecision,
      expansionAllowed,
      automaticExpansion:false,
      waveSize:2,
      assignedUsers,
      verifiedUsers,
      waves:{
        baseline:{target:2,observed:verifiedUsers>=2},
        wave1:{target:4,observed:wave1Observed},
        wave2:{target:6,observed:wave2Observed},
      },
      nextWave:nextWaveTarget ? {
        targetAssigned:nextWaveTarget,
        add:Math.max(0,Math.min(2,nextWaveTarget-assignedUsers)),
        allowed:canAddNextWave,
      } : null,
      fieldBlockers:[...new Set(fieldBlockers)],
      launchBlockers,
      initialGateGaps,
      nextRequiredAction,
      evidenceTargets:{
        verifiedUsers:6,
        fullJourneys:4,
        coverageSamples:20,
        coreLatencySamplesPerOperation:5,
        liveLatencySamples:3,
      },
      providerValidationDecision,
      providerReviewSignal,
      providerSignals:{
        rateLimit:providerRateLimit,
        providerErrors,
        quotaConfirmed:providerQuotaConfirmed,
        quotaPressure,
        dailyRemainingPct,
        minuteRemainingPct,
        liveCoverageDeficit,
        liveMissingCategories,
      },
      checks:{
        miniAppLaunch:evidenceCount(metrics?.miniAppLaunch?.events),
        search:{
          used:evidenceCount(metrics?.searchUsed?.events),
          success:evidenceCount(metrics?.searchFound?.events),
          empty:evidenceCount(metrics?.searchEmpty?.events),
          timeout:searchTimeouts,
        },
        matchOpen:evidenceCount(metrics?.matchOpen?.events),
        ai:{
          start:evidenceCount(metrics?.aiStart?.events),
          complete:evidenceCount(metrics?.aiComplete?.events),
        },
        fullJourneys,
        reentries:evidenceCount(journey?.stages?.reentry),
        latency:timings,
        actionErrors,
        clientErrors:clientErrorRows.length,
        blockerCount,
        majorCount,
        supabaseOk,
        telegramConfirmed,
        productionMonitor,
        live:{
          opens:evidenceCount(metrics?.liveOpen?.events),
          timingSamples:evidenceCount(timings?.live?.samples),
          coverageSamples:liveCoverageSamples,
        },
      },
      readinessRule:'Two manual expansion waves of +2 users are observed before public pre-launch. Every wave remains fail-closed on BLOCKER/MAJOR, runtime health, confirmed provider quota pressure and provider-review evidence.',
    };
  }

  function buildBetaIssueGroups({metrics,errorRows,feedbackRows,timings,clientErrorRows=[]}) {
    const configs=[
      {category:'search',errors:betaErrorCountByAction(errorRows,'search'),attempts:Number(metrics.searchUsed?.events || 0)},
      {category:'matches',errors:betaErrorCountByAction(errorRows,'match'),attempts:Number(metrics.matchOpen?.events || 0)+betaErrorCountByAction(errorRows,'match')},
      {category:'ai',errors:betaErrorCountByAction(errorRows,'ai'),attempts:Number(metrics.aiStart?.events || 0)},
      {category:'live',errors:betaErrorCountByAction(errorRows,'live_refresh'),attempts:Number(metrics.liveOpen?.events || 0)+betaErrorCountByAction(errorRows,'live_refresh')},
      {category:'ux',errors:betaErrorCountByAction(errorRows,'history')+betaErrorCountByAction(errorRows,'profile')+betaErrorCountByAction(errorRows,'profile_modules')+betaErrorCountByAction(errorRows,'billing_ui')+Number(clientErrorRows.length || 0),attempts:Number(metrics.miniAppLaunch?.events || 0)+Number(metrics.historyOpen?.events || 0)+Number(metrics.profileOpen?.events || 0)},
      {category:'data_sources',errors:betaErrorCountByKind(errorRows,['provider','rate_limit']),attempts:0},
      {category:'performance',errors:betaErrorCountByKind(errorRows,['timeout']),attempts:0},
    ];
    return configs.map(item=>{
      const feedback=betaFeedbackCounts(feedbackRows,item.category);
      const frequency=Number(item.errors || 0)+Number(feedback.total || 0);
      const failureRatePct=item.attempts>0 ? Math.round((Number(item.errors || 0)/Math.max(1,item.attempts))*1000)/10 : null;
      const correlated=Number(item.errors || 0)>0 && Number(feedback.total || 0)>0;
      let classification=null;
      if ((item.attempts>=4 && Number(failureRatePct || 0)>=50) || feedback.severity.BLOCKER>=2) classification='BLOCKER';
      else if (Number(item.errors || 0)>=2 || feedback.severity.MAJOR>=2 || correlated) classification='MAJOR';
      else if (feedback.severity.MINOR>=2) classification='MINOR';
      else if (frequency>0) classification='NEEDS_MORE_EVIDENCE';
      const meta=betaIssueMeta(item.category);
      const timing=timings?.[item.category==='matches'?'match':item.category] || null;
      return {
        category:item.category,
        label:meta.label,
        classification,
        active:['BLOCKER','MAJOR','MINOR'].includes(classification),
        frequency,
        telemetryErrors:Number(item.errors || 0),
        feedback:Number(feedback.total || 0),
        failureRatePct,
        timing,
        evidence:correlated ? 'feedback+telemetry' : Number(item.errors || 0)>=2 ? 'repeated_telemetry' : Number(feedback.total || 0)>=2 ? 'repeated_feedback' : frequency ? 'needs_more_evidence' : 'no_signal',
        userImpact:meta.impact,
        recommendedFix:meta.fix,
      };
    });
  }
  
  function betaJourneyEventName(row = {}) {
    if (row?.source!=='client' || row?.event_type!=='client_telemetry') return '';
    const code=String(row?.code || '');
    if (code==='BOOT_OK') return 'miniapp_open';
    if (code!=='PRODUCT_ACTION') return '';
    const reason=String(row?.metadata?.reason || '');
    return reason ? `miniapp_${reason}` : '';
  }
  
  function betaJourneySummary(rows = []) {
    const stages=[
      'miniapp_open',
      'miniapp_search_used',
      'miniapp_search_found',
      'miniapp_match_open',
      'miniapp_ai_start',
      'miniapp_ai_complete',
      'miniapp_history_open',
      'miniapp_open',
    ];
    const subjects=new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const subject=String(row?.metadata?.betaSubject || '');
      if (!/^[0-9a-f]{32}$/.test(subject) || trustedEventTime(row?.created_at) === null) continue;
      if (!subjects.has(subject)) subjects.set(subject,[]);
      subjects.get(subject).push(row);
    }
    const reached=Array(stages.length).fill(0);
    let fullCompleted=0;
    let analysisCompleted=0;
    for (const subjectRows of subjects.values()) {
      const ordered=subjectRows
        .map(row=>({row,at:trustedEventTime(row?.created_at)}))
        .filter(item=>item.at !== null)
        .sort((a,b)=>a.at-b.at)
        .map(item=>item.row);
      let index=0;
      for (const row of ordered) {
        const eventName=betaJourneyEventName(row);
        if (eventName && eventName===stages[index]) {
          reached[index]+=1;
          index+=1;
          if (index>=stages.length) break;
        }
      }
      if (index>=6) analysisCompleted+=1;
      if (index>=stages.length) fullCompleted+=1;
    }
    const labels=['launch','searchUsed','searchFound','matchOpen','aiStart','aiComplete','historyOpen','reentry'];
    return {
      betaUsers:subjects.size,
      analysisCompleted,
      analysisCompletionPct:subjects.size ? Math.round((analysisCompleted/subjects.size)*1000)/10 : 0,
      fullCompleted,
      fullCompletionPct:subjects.size ? Math.round((fullCompleted/subjects.size)*1000)/10 : 0,
      stages:Object.fromEntries(labels.map((label,index)=>[label,reached[index]])),
      definition:'open -> search_used -> search_found -> match_open -> ai_start -> ai_complete -> history_open -> reopen',
    };
  }
  
  function latestConfirmedProviderQuota(rows = [], nowMs = Date.now()) {
    const now = finiteEvidenceNumber(nowMs);
    if (now === null || now < 0) return {confirmed:false,source:'none',confirmedAt:null};
    const candidates=(Array.isArray(rows) ? rows : [])
      .map(row=>({row,at:trustedEventTime(row?.created_at)}))
      .filter(item=>
        item.row?.source==='provider'
        && item.row?.event_type==='quota_probe'
        && item.row?.code==='PROVIDER_QUOTA_CONFIRMED'
        && item.at !== null
        && item.at <= now + 60_000
        && now-item.at <= 24*60*60_000
      )
      .sort((a,b)=>b.at-a.at);
    for (const item of candidates) {
      const normalized=normalizedProviderQuota(item.row?.metadata);
      if (!normalized.complete) continue;
      return {
        confirmed:true,
        source:'provider_monitor',
        confirmedAt:item.row.created_at,
        plan:normalized.plan,
        dailyLimit:normalized.dailyLimit,
        dailyRemaining:normalized.dailyRemaining,
        minuteLimit:normalized.minuteLimit,
        minuteRemaining:normalized.minuteRemaining,
      };
    }
    return {confirmed:false,source:'none',confirmedAt:null};
  }
  
  
  function phase5MetricSummary(rows = [], eventName = '') {
    const matched=betaClientEventRows(rows,eventName);
    const users=new Set();
    const sessions=new Set();
    for (const row of matched) {
      const subject=String(row?.metadata?.validationSubject || '');
      const session=String(row?.metadata?.validationSession || '');
      if (/^[0-9a-f]{32}$/.test(subject)) users.add(subject);
      if (/^[0-9a-f]{32}$/.test(session)) sessions.add(session);
    }
    return {events:matched.length,users:users.size,sessions:sessions.size};
  }
  
  function phase5JourneySummary(rows = []) {
    const valid=(Array.isArray(rows) ? rows : []).filter(row=>
      row?.source==='client'
      && row?.event_type==='client_telemetry'
      && trustedEventTime(row?.created_at) !== null
      && /^[0-9a-f]{32}$/.test(String(row?.metadata?.validationSubject || ''))
      && /^[0-9a-f]{32}$/.test(String(row?.metadata?.validationSession || ''))
    );
    const bootRows=valid.filter(row=>String(row?.code || '')==='BOOT_OK');
    const users=new Set(bootRows.map(row=>String(row.metadata.validationSubject)));
    const sessions=new Set(bootRows.map(row=>String(row.metadata.validationSession)));
    const bySubject=new Map();
    for (const row of valid) {
      const subject=String(row.metadata.validationSubject);
      if (!bySubject.has(subject)) bySubject.set(subject,[]);
      bySubject.get(subject).push(row);
    }
    const stages={home:0,search:0,matchCenter:0,ai:0,favoriteTeam:0,history:0,reopen:0};
    let fullCompleted=0;
    let reopenUsers=0;
    for (const subject of users) {
      const ordered=(bySubject.get(subject) || []).slice().sort((a,b)=>Date.parse(a?.created_at || 0)-Date.parse(b?.created_at || 0));
      const bootSessions=[...new Set(ordered.filter(row=>String(row?.code || '')==='BOOT_OK').map(row=>String(row?.metadata?.validationSession || '')))];
      if (bootSessions.length>=2) reopenUsers+=1;
      stages.home+=1;
      let stage=0;
      let historyAt=0;
      const firstSession=bootSessions[0] || '';
      for (const row of ordered) {
        const code=String(row?.code || '');
        const reason=String(row?.metadata?.reason || '');
        const view=String(row?.metadata?.view || '');
        const event=code==='PRODUCT_ACTION' ? reason : '';
        if (stage===0 && event==='search_used') { stage=1; stages.search+=1; continue; }
        if (stage===1 && event==='match_open') { stage=2; stages.matchCenter+=1; continue; }
        if (stage===2 && event==='ai_complete') { stage=3; stages.ai+=1; continue; }
        if (stage===3 && event==='matches_open' && view==='myTeamsView') { stage=4; stages.favoriteTeam+=1; continue; }
        if (stage===4 && event==='history_open') { stage=5; stages.history+=1; historyAt=Date.parse(row?.created_at || 0); }
      }
      if (stage>=5) {
        const reopened=ordered.some(row=>
          String(row?.code || '')==='BOOT_OK'
          && String(row?.metadata?.validationSession || '')!==firstSession
          && Date.parse(row?.created_at || 0)>historyAt
        );
        if (reopened) { stages.reopen+=1; fullCompleted+=1; }
      }
    }
    return {
      verifiedNormalUsers:users.size,
      sessions:sessions.size,
      fullCompleted,
      reopenUsers,
      returnRatePct:users.size ? Math.round((reopenUsers/users.size)*1000)/10 : 0,
      stages,
      abandonment:{
        home:Math.max(0,stages.home-stages.search),
        search:Math.max(0,stages.search-stages.matchCenter),
        matchCenter:Math.max(0,stages.matchCenter-stages.ai),
        ai:Math.max(0,stages.ai-stages.favoriteTeam),
        favoriteTeam:Math.max(0,stages.favoriteTeam-stages.history),
        history:Math.max(0,stages.history-stages.reopen),
      },
      definition:'verified Telegram BOOT_OK -> search_used -> match_open -> ai_complete -> My Teams -> history_open -> BOOT_OK in a later session',
    };
  }
  
  function phase5ProviderSummary(rows = [], {sessions=0,users=0,fullJourneys=0} = {}) {
    const allowedKinds=new Set(['search','matches_feed','match_center','ai','live_refresh']);
    const usageRows=(Array.isArray(rows) ? rows : []).filter(row=>
      row?.source==='phase5'
      && row?.event_type==='provider_usage'
      && row?.code==='PHASE5_PROVIDER_USAGE'
      && row?.metadata?.validationCohort===PHASE5_VALIDATION_COHORT
      && row?.metadata?.validationVerified===true
      && /^[0-9a-f]{32}$/.test(String(row?.metadata?.validationSubject || ''))
      && /^[0-9a-f]{32}$/.test(String(row?.metadata?.validationSession || ''))
      && allowedKinds.has(String(row?.metadata?.requestKind || ''))
    );
    const totals={networkRequests:0,cacheHits:0,staleCacheHits:0,quotaBlocks:0,sharedCooldowns:0};
    const byFeature={};
    const blockedSessions=new Set();
    const liveUsers=new Set();
    for (const row of usageRows) {
      const m=row.metadata || {};
      const kind=String(m.requestKind || '');
      const bucket=byFeature[kind] ||= {requests:0,networkRequests:0,cacheHits:0,staleCacheHits:0,quotaBlocks:0,sharedCooldowns:0};
      bucket.requests+=1;
      for (const key of Object.keys(totals)) {
        const value=evidenceCount(m[key]);
        totals[key]+=value;
        bucket[key]+=value;
      }
      if (evidenceCount(m.quotaBlocks)>0 || evidenceCount(m.sharedCooldowns)>0) blockedSessions.add(String(m.validationSession || ''));
      if (kind==='live_refresh') liveUsers.add(String(m.validationSubject || ''));
    }
    const safeSessions=evidenceCount(sessions);
    const safeUsers=evidenceCount(users);
    const safeFullJourneys=evidenceCount(fullJourneys);
    const round=value=>Number.isFinite(value) ? Math.round(value*100)/100 : null;
    const requestsPerSession=safeSessions ? round(totals.networkRequests/safeSessions) : null;
    const requestsPerCompletedJourney=safeFullJourneys ? round(totals.networkRequests/safeFullJourneys) : null;
    const cacheDenominator=totals.cacheHits+totals.networkRequests;
    const cacheHitRatePct=cacheDenominator ? Math.round((totals.cacheHits/cacheDenominator)*1000)/10 : null;
    const aiRequestsPerUser=safeUsers ? round(Number(byFeature.ai?.networkRequests || 0)/safeUsers) : null;
    const liveRequestsPerActiveUser=liveUsers.size ? round(Number(byFeature.live_refresh?.networkRequests || 0)/liveUsers.size) : null;
    const sessionsPerUser=safeUsers ? safeSessions/safeUsers : null;
    return {
      ...totals,
      requestsPerSession,
      requestsPerCompletedJourney,
      cacheHitRatePct,
      aiRequestsPerUser,
      liveRequestsPerActiveUser,
      activeLiveUsers:liveUsers.size,
      blockedSessions:[...blockedSessions].filter(value=>/^[0-9a-f]{32}$/.test(value)).length,
      byFeature,
      capacity:{
        evidenceSufficient:safeSessions>=10 && requestsPerSession!==null,
        concurrent10:requestsPerCompletedJourney===null ? null : round(requestsPerCompletedJourney*10),
        concurrent25:requestsPerCompletedJourney===null ? null : round(requestsPerCompletedJourney*25),
        concurrent50:requestsPerCompletedJourney===null ? null : round(requestsPerCompletedJourney*50),
        dailyActive100:requestsPerSession===null || sessionsPerUser===null ? null : round(requestsPerSession*sessionsPerUser*100),
        dailyActive500:requestsPerSession===null || sessionsPerUser===null ? null : round(requestsPerSession*sessionsPerUser*500),
        note:'Projection uses observed production requests/session and observed sessions/user; it is not inferred from provider documentation.',
      },
    };
  }
  
  function phase5EvidenceGate({journey={},timings={},coverage={},opsSampleLimited=false}={}) {
    const requirements={
      verifiedNormalUsers:{required:5,actual:evidenceCount(journey?.verifiedNormalUsers)},
      sessions:{required:10,actual:evidenceCount(journey?.sessions)},
      fullJourneys:{required:5,actual:evidenceCount(journey?.fullCompleted)},
      searchSamples:{required:10,actual:evidenceCount(timings?.search?.samples)},
      matchCenterSamples:{required:10,actual:evidenceCount(timings?.match?.samples)},
      aiSamples:{required:10,actual:evidenceCount(timings?.ai?.samples)},
      coverageObservations:{required:20,actual:evidenceCount(coverage?.samples)},
    };
    for (const value of Object.values(requirements)) value.pass=value.actual>=value.required;
    const sampleLimited=opsSampleLimited === true;
    const thresholdsMet=Object.values(requirements).every(value=>value.pass) && !sampleLimited;
    const liveSamples=Math.max(evidenceCount(timings?.live?.samples),evidenceCount(coverage?.live?.samples));
    return {
      status:thresholdsMet ? 'EVIDENCE THRESHOLDS MET' : 'COLLECT MORE EVIDENCE',
      thresholdsMet,
      requirements,
      liveStatus:liveSamples>0 ? 'OBSERVED' : 'INSUFFICIENT_LIVE_SAMPLE',
      opsSampleLimited:sampleLimited,
    };
  }
  
  async function apiPhase5Dashboard(request,cfg) {
    const url=new URL(request.url);
    const requestedDays=finiteEvidenceNumber(url.searchParams.get('days'));
    const days=requestedDays === null ? 7 : Math.max(1,Math.min(30,Math.floor(requestedDays)));
    if (!hasSupabase(cfg)) return json({available:false,reason:'Для Phase 5 validation нужен Supabase.',days});
    const now=Date.now();
    const since=new Date(now-days*86400_000).toISOString();
    const end=new Date(now+1000).toISOString();
    const [opsResult,diagnostics]=await Promise.all([
      readOpsEventsRange(cfg,since,end,1000),
      collectDiagnostics(cfg).catch(()=>({})),
    ]);
    const allOpsRows=observationRowsInRange(
      opsResult?.items,
      Date.parse(since),
      Date.parse(end),
    );
    const phase5Rows=allOpsRows.filter(row=>
      row?.metadata?.validationCohort===PHASE5_VALIDATION_COHORT
      && row?.metadata?.validationVerified===true
      && /^[0-9a-f]{32}$/.test(String(row?.metadata?.validationSubject || ''))
      && /^[0-9a-f]{32}$/.test(String(row?.metadata?.validationSession || ''))
    );
    const clientRows=phase5Rows.filter(row=>row?.source==='client' && row?.event_type==='client_telemetry');
    const metrics={};
    for (const [key,eventName] of Object.entries({
      miniAppLaunch:'miniapp_open',searchUsed:'miniapp_search_used',searchFound:'miniapp_search_found',
      searchEmpty:'miniapp_search_empty',matchOpen:'miniapp_match_open',aiStart:'miniapp_ai_start',
      aiComplete:'miniapp_ai_complete',liveOpen:'miniapp_live_open',historyOpen:'miniapp_history_open',
      profileOpen:'miniapp_profile_open',
    })) metrics[key]=phase5MetricSummary(clientRows,eventName);
    const journey=phase5JourneySummary(clientRows);
    const timings={
      search:betaTimingSummary(clientRows,'search'),
      match:betaTimingSummary(clientRows,'match'),
      ai:betaTimingSummary(clientRows,'ai'),
      live:betaTimingSummary(clientRows,'live'),
    };
    const coverage=betaCoverageSummary(clientRows);
    const evidenceGate=phase5EvidenceGate({
      journey,
      timings,
      coverage,
      opsSampleLimited:Boolean(opsResult?.truncated) || allOpsRows.length>=1000,
    });
    const provider=phase5ProviderSummary(phase5Rows,{sessions:journey.sessions,users:journey.verifiedNormalUsers,fullJourneys:journey.fullCompleted});
    const persistedQuota=latestConfirmedProviderQuota(allOpsRows,now);
    let providerNow={};
    try { providerNow=providerSnapshot() || {}; } catch { providerNow={}; }
    const providerNowAt=trustedEventTime(providerNow.updatedAt);
    const providerNowFresh=providerNowAt !== null
      && providerNowAt <= now + 60_000
      && now-providerNowAt <= 10*60_000;
    const normalizedProviderNow=normalizedProviderQuota(providerNow);
    const providerNowComplete=providerNowFresh && normalizedProviderNow.complete;
    const quotaState=providerNowComplete ? {
      confirmed:true,source:'provider_runtime',confirmedAt:providerNow.updatedAt,plan:normalizedProviderNow.plan,
      dailyLimit:normalizedProviderNow.dailyLimit,dailyRemaining:normalizedProviderNow.dailyRemaining,
      minuteLimit:normalizedProviderNow.minuteLimit,minuteRemaining:normalizedProviderNow.minuteRemaining,
    } : persistedQuota;
    const errorRows=betaClientEventRows(clientRows,'miniapp_error');
    const errorKinds={};
    for (const row of errorRows) {
      const key=String(row?.metadata?.errorKind || 'unknown');
      errorKinds[key]=Number(errorKinds[key] || 0)+1;
    }
    const issues=buildBetaIssueGroups({metrics,errorRows,feedbackRows:[],timings,clientErrorRows:clientRows.filter(row=>String(row?.code || '')==='CLIENT_ERROR')});
    const repeatedProductBlocker=issues.some(issue=>issue?.classification==='BLOCKER');
    const systematicMissing=Object.entries(coverage.missing || {}).filter(([,item])=>Number(item?.samples || 0)>=10 && Number(item?.missingPct || 0)>=70).map(([key])=>key);
    const coverageDecision=coverage.samples<20
      ? 'COLLECT MORE EVIDENCE'
      : systematicMissing.length>=2 ? 'DATA COVERAGE REVIEW REQUIRED' : 'KEEP CURRENT PROVIDER';
    const requestsPerSession=Number(provider.requestsPerSession);
    const providerBehaviorObserved=Number.isFinite(requestsPerSession)
      && (Number(provider.networkRequests || 0)>0 || Number(provider.cacheHits || 0)>0 || Number(provider.staleCacheHits || 0)>0);
    const cacheBehaviorObserved=provider.cacheHitRatePct!==null
      || Number(provider.staleCacheHits || 0)>0
      || Number(provider.networkRequests || 0)>0;
    const dailyHeadroomSessions=quotaState.confirmed && requestsPerSession>0
      ? Math.floor(Math.max(0,Number(quotaState.dailyRemaining || 0))/requestsPerSession)
      : null;
    const typicalSessionExceedsMinuteLimit=Boolean(
      quotaState.confirmed
      && requestsPerSession>0
      && Number(quotaState.minuteLimit || 0)>0
      && requestsPerSession>Number(quotaState.minuteLimit)
    );
    const repeatedCapacityPressure=Number(provider.quotaBlocks || 0)>=2 || Number(provider.sharedCooldowns || 0)>=2;
    const constrainedDailyHeadroom=dailyHeadroomSessions!==null && dailyHeadroomSessions<10;
    const capacityEvidenceReady=Boolean(
      evidenceGate.requirements.sessions.pass
      && quotaState.confirmed
      && providerBehaviorObserved
      && cacheBehaviorObserved
    );
    const capacityDecision=!capacityEvidenceReady
      ? 'COLLECT MORE EVIDENCE'
      : repeatedCapacityPressure && (typicalSessionExceedsMinuteLimit || constrainedDailyHeadroom)
        ? 'CAPACITY REVIEW REQUIRED'
        : 'KEEP CURRENT PROVIDER';
    let status='COLLECT MORE EVIDENCE';
    if (evidenceGate.thresholdsMet) {
      if (repeatedProductBlocker) status='PRODUCT BLOCKER HOLD';
      else if (capacityDecision==='CAPACITY REVIEW REQUIRED') status='PROVIDER CAPACITY REVIEW REQUIRED';
      else if (coverageDecision==='DATA COVERAGE REVIEW REQUIRED') status='DATA COVERAGE REVIEW REQUIRED';
      else status='PUBLIC VALIDATION HEALTHY';
    }
    return json({
      available:true,
      generatedAt:new Date().toISOString(),
      periodDays:days,
      cohort:PHASE5_VALIDATION_COHORT,
      status,
      privacy:{
        aggregatedOnly:true,telegramIdsReturned:false,telegramIdsStoredInValidationTelemetry:false,
        rawSessionTokensStored:false,hmacSubjectsOnly:true,adminExcluded:true,unsignedExcluded:true,
        syntheticDevIdentityExcluded:true,smokeAndHealthExcluded:true,duplicateClientEventsDeduped:true,
      },
      accessMode:{
        publicByDefault:!cfg.betaAccessEnabled,
        strictBetaAccess:Boolean(cfg.betaAccessEnabled),
        note:'BETA_ACCESS_ENABLED controls access only; BETA_TELEGRAM_IDS is not a Phase 5 evidence membership requirement.',
      },
      users:{
        verifiedNormalUsers:journey.verifiedNormalUsers,sessions:journey.sessions,
        completedJourneys:journey.fullCompleted,reopenUsers:journey.reopenUsers,returnRatePct:journey.returnRatePct,
      },
      product:{
        searchSamples:Number(timings.search.samples || 0),matchCenterSamples:Number(timings.match.samples || 0),
        aiSamples:Number(timings.ai.samples || 0),
        liveSamples:Math.max(Number(timings.live.samples || 0),Number(coverage.live?.samples || 0)),
        metrics,abandonmentStage:journey.abandonment,journeyStages:journey.stages,
      },
      performance:timings,
      provider:{...provider,quotaState,capacityDecision,capacityInputs:{requestsPerSession:Number.isFinite(requestsPerSession)?requestsPerSession:null,cacheHitRatePct:provider.cacheHitRatePct,staleCacheHits:Number(provider.staleCacheHits || 0),dailyHeadroomSessions,typicalSessionExceedsMinuteLimit,repeatedCapacityPressure},upgradeAutomatic:false,decisionRule:'Capacity is evaluated from real verified sessions, observed network requests/session, cache behavior and confirmed quota. A review signal does not automatically upgrade the provider.'},
      coverage:{
        observations:Number(coverage.samples || 0),
        lineups:coverage.missing?.lineups || {samples:0,missing:0,missingPct:0},
        injuries:coverage.missing?.injuries || {samples:0,missing:0,missingPct:0},
        statistics:coverage.missing?.statistics || {samples:0,missing:0,missingPct:0},
        xg:coverage.missing?.xg || {samples:0,missing:0,missingPct:0},
        odds:coverage.missing?.odds || {samples:0,missing:0,missingPct:0},
        live:{status:evidenceGate.liveStatus,samples:Number(coverage.live?.samples || 0),missing:coverage.live?.missing || {}},
        decision:coverageDecision,systematicMissing,
      },
      evidenceGate,
      runtime:{
        supabase:Boolean(diagnostics?.supabase?.ok) ? 'ok' : String(diagnostics?.supabase?.status || 'problem'),
        telegram:String(diagnostics?.telegramWebhook?.state || (cfg.botToken ? 'configured' : 'not_configured')),
        providerRateLimit:Number(errorKinds.rate_limit || 0),providerErrors:Number(errorKinds.provider || 0),
        timeouts:Number(errorKinds.timeout || 0),
        clientErrors:clientRows.filter(row=>String(row?.code || '')==='CLIENT_ERROR').length,
        productBlockerPattern:repeatedProductBlocker,issues,
      },
      sample:{
        clientEvents:clientRows.length,
        providerUsageRows:phase5Rows.filter(row=>row?.source==='phase5' && row?.event_type==='provider_usage').length,
        opsPersistent:Boolean(opsResult?.persistent),opsSampleLimited:Boolean(opsResult?.truncated) || allOpsRows.length>=1000,
        evidenceStartsWithTaggedPhase5ProductionEvents:true,legacyClosedBetaRowsExcluded:true,
      },
    });
  }
  
  async function apiBetaDashboard(request,cfg) {
    const url=new URL(request.url);
    const requestedDays=finiteEvidenceNumber(url.searchParams.get('days'));
    const days=requestedDays === null ? 7 : Math.max(1,Math.min(30,Math.floor(requestedDays)));
    if (!hasSupabase(cfg)) return json({available:false,reason:'Для наблюдения closed beta нужен Supabase.',days});
    const now=Date.now();
    const since=new Date(now-days*86400_000).toISOString();
    const end=new Date(now+1000).toISOString();
    const [opsResult,diagnostics,telegramWebhookProbe]=await Promise.all([
      readOpsEventsRange(cfg,since,end,1000),
      collectDiagnostics(cfg).catch(()=>({})),
      billingWebhookStatus(request,cfg).catch(()=>({ready:false,reason:'webhook_check_failed'})),
    ]);
    const allOpsRows=observationRowsInRange(
      opsResult?.items,
      Date.parse(since),
      Date.parse(end),
    );
    const opsRows=allOpsRows.filter(row=>String(row?.metadata?.betaCohort || '')===CLOSED_BETA_COHORT && row?.metadata?.betaMembershipVerified===true);
    const betaClientRows=opsRows.filter(row=>row?.source==='client' && row?.event_type==='client_telemetry'
      && /^[0-9a-f]{32}$/.test(String(row?.metadata?.betaSubject || '')));
  
    const metricDefs={
      miniAppLaunch:'miniapp_open',
      searchUsed:'miniapp_search_used',
      searchFound:'miniapp_search_found',
      searchEmpty:'miniapp_search_empty',
      matchOpen:'miniapp_match_open',
      aiStart:'miniapp_ai_start',
      aiComplete:'miniapp_ai_complete',
      liveOpen:'miniapp_live_open',
      historyOpen:'miniapp_history_open',
      profileOpen:'miniapp_profile_open',
    };
    const metrics={};
    for (const [key,eventName] of Object.entries(metricDefs)) metrics[key]=betaMetricSummary(betaClientRows,eventName);
  
    const journey=betaJourneySummary(betaClientRows);
    const entrySize=Number(journey.betaUsers || 0);
  
    const errorRows=betaClientEventRows(betaClientRows,'miniapp_error');
    const clientErrorRows=betaClientRows.filter(row=>String(row?.code || '')==='CLIENT_ERROR');
    const errorKinds={};
    const errorActions={};
    for (const row of errorRows) {
      const kind=String(row?.metadata?.errorKind || 'unknown');
      const action=String(row?.metadata?.action || row?.metadata?.reason || 'unknown');
      errorKinds[kind]=Number(errorKinds[kind] || 0)+1;
      errorActions[action]=Number(errorActions[action] || 0)+1;
    }
  
    const timings={
      search:betaTimingSummary(betaClientRows,'search'),
      match:betaTimingSummary(betaClientRows,'match'),
      ai:betaTimingSummary(betaClientRows,'ai'),
      live:betaTimingSummary(betaClientRows,'live'),
    };
    const feedbackRows=opsRows.filter(row=>row?.source==='beta' && row?.event_type==='beta_feedback' && row?.code==='BETA_FEEDBACK');
    const coverage=betaCoverageSummary(betaClientRows);
    const productionMonitor=betaProductionMonitorSummary(allOpsRows,now);
    const issues=buildBetaIssueGroups({metrics,errorRows,feedbackRows,timings,clientErrorRows});
    const activeIssues=issues.filter(issue=>issue.active);
    const evidencePending=issues.filter(issue=>issue.classification==='NEEDS_MORE_EVIDENCE');
    const topBreak=Object.entries(errorActions).sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))[0] || null;
    const providerRateLimit=Number(errorKinds.rate_limit || 0);
    const providerErrors=Number(errorKinds.provider || 0);
    const timeouts=Number(errorKinds.timeout || 0);
    const supabaseOk=Boolean(diagnostics?.supabase?.ok);
    const telegramState=String(diagnostics?.telegramWebhook?.state || (cfg.botToken ? 'configured' : 'not_configured'));
    const blockerCount=activeIssues.filter(issue=>issue.classification==='BLOCKER').length;
    const majorCount=activeIssues.filter(issue=>issue.classification==='MAJOR').length;
    const telegramProblem=['incident','critical','failed','not_configured'].includes(telegramState);
    const healthState=blockerCount>0 || !supabaseOk || telegramProblem
      ? 'incident'
      : activeIssues.length>0 || providerRateLimit>0 || timeouts>0 || clientErrorRows.length>0
        ? 'watch'
        : 'healthy';
  
    const usedFeatures=Object.entries(metrics)
      .map(([key,value])=>({key,events:Number(value.events || 0),users:Number(value.users || 0)}))
      .sort((a,b)=>b.events-a.events || a.key.localeCompare(b.key));
    const lowUsageFeatures=usedFeatures.filter(item=>item.events===0 || (entrySize>=5 && item.users<=Math.max(1,Math.floor(entrySize*0.1))));
    const dataSourceFeedback=Number(issues.find(issue=>issue.category==='data_sources')?.feedback || 0);
    const providerSignals=providerRateLimit+providerErrors+dataSourceFeedback;
    const systematicMissingCategories=Object.values(coverage.missing || {})
      .filter(item=>Number(item.samples || 0)>=10 && Number(item.missingPct || 0)>=70).length;
    const providerEvidence=entrySize>=5 && (
      providerSignals>=5
      || (coverage.samples>=10 && systematicMissingCategories>=2 && dataSourceFeedback>=2)
    ) ? 'review_provider_options' : 'insufficient_evidence';
    const adminIds=new Set((cfg.adminTelegramIds || []).map(Number));
    const betaIds=[...new Set((cfg.betaTelegramIds || []).map(Number).filter(id=>Number.isSafeInteger(id)&&id>0))];
    const betaAdminOverlap=betaIds.filter(id=>adminIds.has(id)).length;
    const assignedBetaUsers=betaIds.filter(id=>!adminIds.has(id)).length;
    const persistedQuota=latestConfirmedProviderQuota(allOpsRows,now);
    let providerNow={};
    try { providerNow=providerSnapshot() || {}; } catch { providerNow={}; }
    const providerNowAt=trustedEventTime(providerNow.updatedAt);
    const providerNowFresh=providerNowAt !== null
      && providerNowAt <= now + 60_000
      && now-providerNowAt <= 10*60_000;
    const normalizedProviderNow=normalizedProviderQuota(providerNow);
    const providerNowComplete=providerNowFresh && normalizedProviderNow.complete;
    const providerQuota=providerNowComplete ? {
      confirmed:true,
      source:'provider_runtime',
      confirmedAt:providerNow.updatedAt,
      plan:normalizedProviderNow.plan,
      dailyLimit:normalizedProviderNow.dailyLimit,
      dailyRemaining:normalizedProviderNow.dailyRemaining,
      minuteLimit:normalizedProviderNow.minuteLimit,
      minuteRemaining:normalizedProviderNow.minuteRemaining,
    } : persistedQuota;
    const launchBlockers=[];
    if (assignedBetaUsers<2) launchBlockers.push('beta_accounts_not_assigned');
    if (betaAdminOverlap>0) launchBlockers.push('beta_admin_overlap');
    if (!cfg.betaAccessEnabled) launchBlockers.push('strict_beta_access_disabled');
    if (!telegramWebhookProbe?.ready) launchBlockers.push('telegram_webhook_unconfirmed');
    if (!providerQuota.confirmed) launchBlockers.push('provider_quota_unconfirmed');
  
    const expansionDecision=betaExpansionDecision({
      launchBlockers,
      metrics,
      journey,
      timings,
      coverage,
      issues,
      opsSampleLimited:Boolean(opsResult?.truncated) || opsRows.length>=1000,
      providerEvidence,
    });
    const controlledExpansion=controlledBetaExpansionDecision({
      expansionDecision,
      assignedBetaUsers,
      journey,
      metrics,
      timings,
      coverage,
      issues,
      errorRows,
      clientErrorRows,
      providerQuota,
      productionMonitor,
      supabaseOk,
      telegramConfirmed:Boolean(telegramWebhookProbe?.ready),
    });
  
    return json({
      available:true,
      generatedAt:new Date().toISOString(),
      periodDays:days,
      cohort:CLOSED_BETA_COHORT,
      membershipBoundary:'server_allowlist_verified',
      privacy:{
        aggregatedOnly:true,
        telegramIdsStoredInBetaTelemetry:false,
        pseudonymousSubjectOnly:true,
        telegramIdsReturned:false,
        searchQueriesReturned:false,
        errorTextsReturned:false,
        feedbackTextsReturned:false,
      },
      launchReadiness:{
        status:launchBlockers.length ? 'blocked' : 'runtime_prerequisites_confirmed',
        blockers:launchBlockers,
        betaAssignments:{required:2,assigned:assignedBetaUsers,adminOverlap:betaAdminOverlap,idsReturned:false},
        strictBetaAccess:Boolean(cfg.betaAccessEnabled),
        telegramWebhook:{
          confirmed:Boolean(telegramWebhookProbe?.ready),
          pendingUpdates:Number(telegramWebhookProbe?.pendingUpdates || 0),
          reason:String(telegramWebhookProbe?.reason || ''),
        },
        providerQuota,
        note:'LIVE field validation and CI/release evidence remain separate evidence gates and are not inferred from this runtime snapshot.',
      },
      metrics,
      journey,
      expansionDecision,
      controlledExpansion,
      actionErrors:{total:errorRows.length,byCategory:errorKinds,byAction:errorActions,clientErrors:clientErrorRows.length},
      dataCoverage:coverage,
      timings,
      health:{
        state:healthState,
        label:healthState==='healthy' ? 'Ошибок нет' : healthState==='incident' ? 'Есть проблемы' : 'Нужно наблюдение',
        topBreak:{action:topBreak?.[0] || '',count:Number(topBreak?.[1] || 0)},
        providerRateLimit,
        timeout:timeouts,
        clientErrors:clientErrorRows.length,
        supabase:supabaseOk ? 'ok' : String(diagnostics?.supabase?.status || 'problem'),
        telegram:telegramState,
        productionMonitor:productionMonitor.state,
        currentRelease:{version:APP_VERSION,candidate:RC_NAME,channel:RELEASE_CHANNEL},
        activeProblems:activeIssues.length,
        needsMoreEvidence:evidencePending.length,
        blockerCount,
        majorCount,
      },
      issues,
      report:{
        betaUsers:entrySize,
        fullJourneyCompleted:Number(journey.fullCompleted || 0),
        fullJourneyCompletionPct:Number(journey.fullCompletionPct || 0),
        analysisJourneyCompleted:Number(journey.analysisCompleted || 0),
        mainDropoff:topBreak ? {action:topBreak[0],count:Number(topBreak[1] || 0)} : null,
        usedFeatures,
        lowUsageFeatures,
        missingDataSignals:{
          searchEmpty:Number(metrics.searchEmpty?.events || 0),
          providerErrors,
          providerRateLimit,
          lineups:coverage.missing?.lineups || {samples:0,missing:0,missingPct:0},
          injuries:coverage.missing?.injuries || {samples:0,missing:0,missingPct:0},
          statistics:coverage.missing?.statistics || {samples:0,missing:0,missingPct:0},
          xg:coverage.missing?.xg || {samples:0,missing:0,missingPct:0},
          odds:coverage.missing?.odds || {samples:0,missing:0,missingPct:0},
        },
        providerExpansionEvidence:{status:providerEvidence,signals:providerSignals,betaUsers:entrySize,systematicMissingCategories},
        betaExpansionReadiness:{
          status:expansionDecision.status,
          expansionAllowed:expansionDecision.expansionAllowed,
          closedBetaLaunchStageComplete:expansionDecision.closedBetaLaunchStageComplete,
          blockers:blockerCount,
          majors:majorCount,
          needsMoreEvidence:evidencePending.length,
          dataCoverageDecision:expansionDecision.dataCoverageDecision,
          requirements:expansionDecision.requirements,
          hardBlockers:expansionDecision.hardBlockers,
        },
        controlledBetaExpansion:{
          finalDecision:controlledExpansion.finalDecision,
          providerValidationDecision:controlledExpansion.providerValidationDecision,
          nextWave:controlledExpansion.nextWave,
          waves:controlledExpansion.waves,
          providerSignals:controlledExpansion.providerSignals,
        },
      },
      sample:{
        clientEvents:betaClientRows.length,
        opsEvents:opsRows.length,
        identityMode:'hmac_pseudonym',
        opsPersistent:Boolean(opsResult?.persistent),
        opsSampleLimited:Boolean(opsResult?.truncated) || opsRows.length>=1000,
      },
    });
  }

  return {
    betaPercentileMs,
    betaIssueMeta,
    apiBetaFeedback,
    betaClientEventRows,
    betaMetricSummary,
    betaTimingSummary,
    betaFeedbackCounts,
    betaErrorCountByAction,
    betaErrorCountByKind,
    betaCoverageSummary,
    betaExpansionDecision,
    quotaRemainingPct,
    betaProductionMonitorSummary,
    controlledBetaExpansionDecision,
    buildBetaIssueGroups,
    betaJourneyEventName,
    betaJourneySummary,
    latestConfirmedProviderQuota,
    phase5MetricSummary,
    phase5JourneySummary,
    phase5ProviderSummary,
    phase5EvidenceGate,
    apiPhase5Dashboard,
    apiBetaDashboard,
  };
}
