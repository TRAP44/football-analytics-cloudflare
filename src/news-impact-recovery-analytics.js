// @ts-check

export function createNewsImpactRecoveryAnalytics(deps = {}) {
  const {
    cleanNewsImpactActionCode,
    cleanNewsImpactRecoveryCode,
    newsImpactConversionConfidence,
    newsImpactEventTime,
    newsImpactJourneyKey,
    newsImpactRecoveryForFailure,
    newsImpactRowAction,
    NEWS_IMPACT_ACTION_LABELS,
    NEWS_IMPACT_FAILURE_CODES,
    NEWS_IMPACT_FAILURE_LABELS,
    NEWS_IMPACT_RECOVERY_CODES,
    NEWS_IMPACT_RECOVERY_DRIFT_DROP_PCT_POINTS,
    NEWS_IMPACT_RECOVERY_DRIFT_PRIOR_MIN_ATTEMPTS,
    NEWS_IMPACT_RECOVERY_DRIFT_RECENT_MIN_ATTEMPTS,
    NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
    NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
    NEWS_IMPACT_RECOVERY_INCIDENT_CODES,
    NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
    NEWS_IMPACT_RECOVERY_LABELS,
    NEWS_IMPACT_RECOVERY_SOURCE_WINDOW_MINUTES,
    NEWS_IMPACT_RECOVERY_STABILITY_MIN_ATTEMPTS,
    NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES,
    NEWS_IMPACT_RECOVERY_STRATEGY_MIN_ATTEMPTS,
    NEWS_IMPACT_RECOVERY_STRATEGY_MIN_LIFT_PCT_POINTS,
    NEWS_IMPACT_RECOVERY_WINDOW_MINUTES
  } = deps;

  function newsImpactRecoveryJourneyKey(row = {}) {
    const base=newsImpactJourneyKey(row);
    const recovery=cleanNewsImpactRecoveryCode(row?.metadata && typeof row.metadata==='object' ? row.metadata.recovery : '');
    return base && recovery ? `${base}|${recovery}` : '';
  }
  
  function buildNewsImpactRecoveryEffectiveness(attemptRows = [], outcomeRows = [], failureRows = [], options = {}) {
    const asOfMs=Number.isFinite(Number(options?.asOfMs)) ? Number(options.asOfMs) : Date.now();
    const windowMinutes=Math.max(1,Math.min(30,Number(options?.windowMinutes || NEWS_IMPACT_RECOVERY_WINDOW_MINUTES)));
    const windowMs=windowMinutes*60_000;
    const latestAttempts=new Map();
    for (const row of attemptRows || []) {
      const key=newsImpactRecoveryJourneyKey(row);
      const attemptAt=newsImpactEventTime(row);
      if (!key || !Number.isFinite(attemptAt)) continue;
      const previous=latestAttempts.get(key);
      if (!previous || attemptAt>previous.attemptAt) latestAttempts.set(key,{row,attemptAt});
    }
    const outcomesByJourney=new Map();
    for (const row of outcomeRows || []) {
      const key=newsImpactJourneyKey(row);
      const at=newsImpactEventTime(row);
      if (!key || !Number.isFinite(at)) continue;
      const list=outcomesByJourney.get(key) || [];
      list.push({row,at});
      outcomesByJourney.set(key,list);
    }
    const failuresByJourney=new Map();
    for (const row of failureRows || []) {
      const key=newsImpactJourneyKey(row);
      const at=newsImpactEventTime(row);
      if (!key || !Number.isFinite(at)) continue;
      const list=failuresByJourney.get(key) || [];
      list.push({row,at});
      failuresByJourney.set(key,list);
    }
    const states=[...latestAttempts.values()].map(item=>{
      const journey=newsImpactJourneyKey(item.row);
      const recovery=cleanNewsImpactRecoveryCode(item.row?.metadata?.recovery);
      const after=(list)=>[...(list || [])]
        .filter(event=>event.at>=item.attemptAt && event.at<=item.attemptAt+windowMs)
        .sort((a,b)=>a.at-b.at)[0] || null;
      const outcome=after(outcomesByJourney.get(journey));
      const failure=after(failuresByJourney.get(journey));
      let state='pending';
      let terminalAt=null;
      if (outcome && (!failure || outcome.at<=failure.at)) { state='recovered'; terminalAt=outcome.at; }
      else if (failure) { state='failed'; terminalAt=failure.at; }
      else if (item.attemptAt<=asOfMs-windowMs) state='failed';
      return {row:item.row,recovery,state,attemptAt:item.attemptAt,terminalAt};
    });
    return [...NEWS_IMPACT_RECOVERY_CODES].map(recovery=>{
      const observed=states.filter(x=>x.recovery===recovery);
      const matured=observed.filter(x=>x.state!=='pending');
      const recovered=matured.filter(x=>x.state==='recovered').length;
      const failed=matured.filter(x=>x.state==='failed').length;
      const attempts=matured.length;
      const pending=observed.length-attempts;
      const successPct=attempts ? Math.round((recovered/attempts)*1000)/10 : 0;
      const confidence=newsImpactConversionConfidence(recovered,attempts);
      const actionCounts={};
      for (const item of observed) {
        const action=newsImpactRowAction(item.row);
        if (action) actionCounts[action]=(actionCounts[action] || 0)+1;
      }
      return {
        recovery,
        label:NEWS_IMPACT_RECOVERY_LABELS[recovery] || recovery,
        observed:observed.length,
        attempts,
        pending,
        recovered,
        failed,
        successPct,
        confidence,
        actions:Object.entries(actionCounts).map(([action,count])=>({action,label:NEWS_IMPACT_ACTION_LABELS[action] || action,count})).sort((a,b)=>b.count-a.count || a.action.localeCompare(b.action)),
      };
    });
  }
  
  function newsImpactRecoveryBest(rows = []) {
    const eligible=(rows || []).filter(x=>Boolean(x?.confidence?.eligibleForBottleneck));
    if (!eligible.length) return null;
    return [...eligible].sort((a,b)=>Number(b.successPct || 0)-Number(a.successPct || 0) || Number(b.attempts || 0)-Number(a.attempts || 0))[0] || null;
  }
  
  function newsImpactRecoveryEffectivenessDrill() {
    const asOfMs=Date.parse('2026-09-23T12:00:00Z');
    const attempts=[
      ...Array.from({length:10},(_,i)=>({telegram_id:i+1,fixture_id:200+i,created_at:'2026-09-23T10:00:00Z',metadata:{decision:'material',action:'full_ai',recovery:'retry'}})),
      ...Array.from({length:5},(_,i)=>({telegram_id:30+i,fixture_id:300+i,created_at:'2026-09-23T11:58:00Z',metadata:{decision:'detail',action:'full_ai',recovery:'open_full_ai'}})),
    ];
    const outcomes=[
      ...Array.from({length:7},(_,i)=>({telegram_id:i+1,fixture_id:200+i,created_at:'2026-09-23T10:02:00Z',metadata:{decision:'material',action:'full_ai',outcome:'analysis_delivered'}})),
      ...Array.from({length:2},(_,i)=>({telegram_id:30+i,fixture_id:300+i,created_at:'2026-09-23T11:59:00Z',metadata:{decision:'detail',action:'full_ai',outcome:'analysis_delivered'}})),
    ];
    const failures=[
      {telegram_id:8,fixture_id:207,created_at:'2026-09-23T10:03:00Z',metadata:{decision:'material',action:'full_ai',reason:'provider_rate_limit',recovery:'retry_later'}},
      {telegram_id:9,fixture_id:208,created_at:'2026-09-23T10:03:00Z',metadata:{decision:'material',action:'full_ai',reason:'server_error',recovery:'retry'}},
    ];
    const rows=buildNewsImpactRecoveryEffectiveness(attempts,outcomes,failures,{asOfMs});
    const retry=rows.find(x=>x.recovery==='retry');
    const fullAi=rows.find(x=>x.recovery==='open_full_ai');
    return {
      pass:retry?.attempts===10
        && retry?.recovered===7
        && retry?.failed===3
        && retry?.successPct===70
        && retry?.confidence?.status==='early'
        && fullAi?.recovered===2
        && fullAi?.pending===3
        && newsImpactRecoveryBest(rows)?.recovery==='retry',
      cases:8,
    };
  }
  
  function newsImpactRecoveryPresentation(reason = 'server_error', action = '', recovery = '') {
    const safeReason=NEWS_IMPACT_FAILURE_CODES.has(String(reason || '')) ? String(reason) : 'server_error';
    const safeAction=cleanNewsImpactActionCode(action);
    const fixed=newsImpactRecoveryForFailure(safeReason,safeAction);
    const code=cleanNewsImpactRecoveryCode(recovery) || fixed.code;
    if (code===fixed.code) return {...fixed};
    if (code==='retry') return {code,action:'retry',message:'Повторите действие — по накопленной статистике это сейчас наиболее надёжный вариант.'};
    if (code==='retry_soon') return {code,action:'retry',message:'Повторите действие через несколько секунд.'};
    if (code==='retry_later') return {code,action:'retry',message:'Попробуйте это действие позже.'};
    if (code==='wait_quota_reset') return {code,action:'wait',message:'Дождитесь обновления лимита и повторите действие.'};
    if (code==='open_search') return {code,action:'search',message:'Вернитесь к поиску и выберите актуальный матч.'};
    if (code==='open_full_ai') return {code,action:'open_full_ai',message:'Откройте полный AI-разбор — по накопленной статистике этот fallback доставляет результат надёжнее.'};
    return {...fixed};
  }
  
  function buildNewsImpactRecoveryStrategyEvidence(attemptRows = [], outcomeRows = [], failureRows = [], options = {}) {
    const asOfMs=Number.isFinite(Number(options?.asOfMs)) ? Number(options.asOfMs) : Date.now();
    const recoveryWindowMs=Math.max(1,Math.min(30,Number(options?.recoveryWindowMinutes || NEWS_IMPACT_RECOVERY_WINDOW_MINUTES)))*60_000;
    const sourceWindowMs=Math.max(5,Math.min(180,Number(options?.sourceWindowMinutes || NEWS_IMPACT_RECOVERY_SOURCE_WINDOW_MINUTES)))*60_000;
    const latestAttempts=new Map();
    for (const row of attemptRows || []) {
      const key=newsImpactRecoveryJourneyKey(row);
      const at=newsImpactEventTime(row);
      if (!key || !Number.isFinite(at)) continue;
      const previous=latestAttempts.get(key);
      if (!previous || at>previous.at) latestAttempts.set(key,{row,at});
    }
    const failuresByJourney=new Map();
    for (const row of failureRows || []) {
      const key=newsImpactJourneyKey(row);
      const at=newsImpactEventTime(row);
      if (!key || !Number.isFinite(at)) continue;
      const list=failuresByJourney.get(key) || [];
      list.push({row,at});
      failuresByJourney.set(key,list);
    }
    for (const list of failuresByJourney.values()) list.sort((a,b)=>a.at-b.at);
    const outcomesByJourney=new Map();
    for (const row of outcomeRows || []) {
      const key=newsImpactJourneyKey(row);
      const at=newsImpactEventTime(row);
      if (!key || !Number.isFinite(at)) continue;
      const list=outcomesByJourney.get(key) || [];
      list.push({row,at});
      outcomesByJourney.set(key,list);
    }
    for (const list of outcomesByJourney.values()) list.sort((a,b)=>a.at-b.at);
  
    const samples=[];
    for (const {row,at:attemptAt} of latestAttempts.values()) {
      const journey=newsImpactJourneyKey(row);
      const recovery=cleanNewsImpactRecoveryCode(row?.metadata?.recovery);
      const action=newsImpactRowAction(row);
      if (!journey || !recovery || !action) continue;
      const priorFailures=(failuresByJourney.get(journey) || []).filter(x=>x.at<=attemptAt && x.at>=attemptAt-sourceWindowMs);
      const sourceFailure=priorFailures[priorFailures.length-1] || null;
      const reason=String(sourceFailure?.row?.metadata?.reason || '');
      if (!NEWS_IMPACT_FAILURE_CODES.has(reason)) continue;
      const nextOutcome=(outcomesByJourney.get(journey) || []).find(x=>x.at>=attemptAt && x.at<=attemptAt+recoveryWindowMs) || null;
      const nextFailure=(failuresByJourney.get(journey) || []).find(x=>x.at>=attemptAt && x.at<=attemptAt+recoveryWindowMs) || null;
      let state='pending';
      if (nextOutcome && (!nextFailure || nextOutcome.at<=nextFailure.at)) state='recovered';
      else if (nextFailure) state='failed';
      else if (attemptAt<=asOfMs-recoveryWindowMs) state='failed';
      samples.push({reason,action,recovery,state});
    }
  
    const groups=new Map();
    for (const sample of samples) {
      const key=`${sample.reason}|${sample.action}|${sample.recovery}`;
      const bucket=groups.get(key) || {
        reason:sample.reason,
        reasonLabel:NEWS_IMPACT_FAILURE_LABELS[sample.reason] || sample.reason,
        action:sample.action,
        actionLabel:NEWS_IMPACT_ACTION_LABELS[sample.action] || sample.action,
        recovery:sample.recovery,
        recoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[sample.recovery] || sample.recovery,
        observed:0,attempts:0,pending:0,recovered:0,failed:0,
      };
      bucket.observed+=1;
      if (sample.state==='pending') bucket.pending+=1;
      else {
        bucket.attempts+=1;
        if (sample.state==='recovered') bucket.recovered+=1;
        else bucket.failed+=1;
      }
      groups.set(key,bucket);
    }
    return [...groups.values()].map(x=>{
      const successPct=x.attempts ? Math.round((x.recovered/x.attempts)*1000)/10 : 0;
      return {...x,successPct,confidence:newsImpactConversionConfidence(x.recovered,x.attempts)};
    }).sort((a,b)=>a.reason.localeCompare(b.reason) || a.action.localeCompare(b.action) || b.attempts-a.attempts || a.recovery.localeCompare(b.recovery));
  }
  
  function newsImpactRecoveryStrategyDecision(reason = 'server_error', action = '', evidenceRows = [], recentEvidenceRows = null) {
    const safeReason=NEWS_IMPACT_FAILURE_CODES.has(String(reason || '')) ? String(reason) : 'server_error';
    const safeAction=cleanNewsImpactActionCode(action);
    const fixed=newsImpactRecoveryForFailure(safeReason,safeAction);
    const relevant=(evidenceRows || []).filter(x=>x.reason===safeReason && x.action===safeAction);
    const baseline=relevant.find(x=>x.recovery===fixed.code) || null;
    const stable=(row)=>Boolean(row)
      && Number(row.attempts || 0)>=NEWS_IMPACT_RECOVERY_STRATEGY_MIN_ATTEMPTS
      && row?.confidence?.status==='stable';
    const baseResult={
      reason:safeReason,
      reasonLabel:NEWS_IMPACT_FAILURE_LABELS[safeReason] || safeReason,
      action:safeAction,
      actionLabel:NEWS_IMPACT_ACTION_LABELS[safeAction] || safeAction,
      fixedRecovery:fixed.code,
      fixedRecoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[fixed.code] || fixed.code,
      selectedRecovery:fixed.code,
      selectedRecoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[fixed.code] || fixed.code,
      proposedRecovery:'',
      proposedRecoveryLabel:'',
      strategy:'fixed',
      guardReason:'fixed_default',
      stability:'fixed',
      fixedAttempts:Number(baseline?.attempts || 0),
      fixedSuccessPct:Number(baseline?.successPct || 0),
      fixedConfidence:baseline?.confidence || newsImpactConversionConfidence(0,0),
      selectedAttempts:Number(baseline?.attempts || 0),
      selectedSuccessPct:Number(baseline?.successPct || 0),
      selectedConfidence:baseline?.confidence || newsImpactConversionConfidence(0,0),
      liftPctPoints:0,
      recentFixedAttempts:0,
      recentFixedSuccessPct:0,
      recentSelectedAttempts:0,
      recentSelectedSuccessPct:0,
      recentLiftPctPoints:0,
    };
    if (!stable(baseline)) return {...baseResult,guardReason:'baseline_sample'};
    const candidates=relevant
      .filter(x=>x.recovery!==fixed.code && stable(x))
      .map(x=>({...x,liftPctPoints:Math.round((Number(x.successPct || 0)-Number(baseline.successPct || 0))*10)/10}))
      .filter(x=>Number(x.liftPctPoints || 0)>=NEWS_IMPACT_RECOVERY_STRATEGY_MIN_LIFT_PCT_POINTS)
      .filter(x=>Number(x?.confidence?.lowerPct || 0)>Number(baseline?.confidence?.upperPct || 100))
      .sort((a,b)=>Number(b?.confidence?.lowerPct || 0)-Number(a?.confidence?.lowerPct || 0)
        || Number(b.successPct || 0)-Number(a.successPct || 0)
        || Number(b.attempts || 0)-Number(a.attempts || 0));
    const candidate=candidates[0] || null;
    if (!candidate) return {...baseResult,guardReason:'no_significant_better'};
    const adaptiveResult={
      ...baseResult,
      selectedRecovery:candidate.recovery,
      selectedRecoveryLabel:candidate.recoveryLabel || NEWS_IMPACT_RECOVERY_LABELS[candidate.recovery] || candidate.recovery,
      proposedRecovery:candidate.recovery,
      proposedRecoveryLabel:candidate.recoveryLabel || NEWS_IMPACT_RECOVERY_LABELS[candidate.recovery] || candidate.recovery,
      strategy:'adaptive',
      guardReason:'significant_better',
      stability:'legacy_confirmed',
      selectedAttempts:Number(candidate.attempts || 0),
      selectedSuccessPct:Number(candidate.successPct || 0),
      selectedConfidence:candidate.confidence,
      liftPctPoints:Number(candidate.liftPctPoints || 0),
    };
    if (!Array.isArray(recentEvidenceRows)) return adaptiveResult;
  
    const recentRelevant=recentEvidenceRows.filter(x=>x.reason===safeReason && x.action===safeAction);
    const recentBaseline=recentRelevant.find(x=>x.recovery===fixed.code) || null;
    const recentCandidate=recentRelevant.find(x=>x.recovery===candidate.recovery) || null;
    const recentReady=(row)=>Boolean(row) && Number(row.attempts || 0)>=NEWS_IMPACT_RECOVERY_STABILITY_MIN_ATTEMPTS;
    const proposed={
      ...baseResult,
      proposedRecovery:candidate.recovery,
      proposedRecoveryLabel:candidate.recoveryLabel || NEWS_IMPACT_RECOVERY_LABELS[candidate.recovery] || candidate.recovery,
      liftPctPoints:Number(candidate.liftPctPoints || 0),
      recentFixedAttempts:Number(recentBaseline?.attempts || 0),
      recentFixedSuccessPct:Number(recentBaseline?.successPct || 0),
      recentSelectedAttempts:Number(recentCandidate?.attempts || 0),
      recentSelectedSuccessPct:Number(recentCandidate?.successPct || 0),
    };
    if (!recentReady(recentBaseline) || !recentReady(recentCandidate)) {
      return {...proposed,guardReason:'stability_sample',stability:'insufficient'};
    }
    const recentLiftPctPoints=Math.round((Number(recentCandidate.successPct || 0)-Number(recentBaseline.successPct || 0))*10)/10;
    const recentConfidenceOk=Number(recentCandidate?.confidence?.lowerPct || 0)>=Number(recentBaseline?.confidence?.lowerPct || 0);
    if (recentLiftPctPoints<0 || !recentConfidenceOk) {
      return {...proposed,guardReason:'recent_regression',stability:'regressed',recentLiftPctPoints};
    }
    return {
      ...adaptiveResult,
      guardReason:'stable_significant_better',
      stability:'confirmed',
      recentFixedAttempts:Number(recentBaseline.attempts || 0),
      recentFixedSuccessPct:Number(recentBaseline.successPct || 0),
      recentSelectedAttempts:Number(recentCandidate.attempts || 0),
      recentSelectedSuccessPct:Number(recentCandidate.successPct || 0),
      recentLiftPctPoints,
    };
  }
  function buildNewsImpactRecoveryStrategyMatrix(evidenceRows = [], recentEvidenceRows = null) {
    const keys=new Set((evidenceRows || []).map(x=>`${x.reason}|${x.action}`));
    return [...keys].map(key=>{
      const [reason,action]=key.split('|');
      return newsImpactRecoveryStrategyDecision(reason,action,evidenceRows,recentEvidenceRows);
    }).sort((a,b)=>(a.strategy==='adaptive'?0:1)-(b.strategy==='adaptive'?0:1)
      || b.liftPctPoints-a.liftPctPoints
      || a.reason.localeCompare(b.reason)
      || a.action.localeCompare(b.action));
  }
  
  function newsImpactRecoveryDriftDecision(decision = null, priorEvidenceRows = [], recentEvidenceRows = []) {
    if (!decision || typeof decision!=='object') return decision;
    const base={
      ...decision,
      driftStatus:'not_applicable',
      driftDetected:false,
      driftDropPctPoints:0,
      priorSelectedAttempts:0,
      priorSelectedSuccessPct:0,
      recentDriftAttempts:0,
      recentDriftSuccessPct:0,
    };
    if (decision.strategy!=='adaptive' || !decision.selectedRecovery) return base;
    const prior=(priorEvidenceRows || []).find(x=>x.reason===decision.reason && x.action===decision.action && x.recovery===decision.selectedRecovery) || null;
    const recent=(recentEvidenceRows || []).find(x=>x.reason===decision.reason && x.action===decision.action && x.recovery===decision.selectedRecovery) || null;
    const priorAttempts=Number(prior?.attempts || 0);
    const recentAttempts=Number(recent?.attempts || 0);
    const snapshot={
      ...base,
      driftStatus:'insufficient',
      priorSelectedAttempts:priorAttempts,
      priorSelectedSuccessPct:Number(prior?.successPct || 0),
      recentDriftAttempts:recentAttempts,
      recentDriftSuccessPct:Number(recent?.successPct || 0),
    };
    if (priorAttempts<NEWS_IMPACT_RECOVERY_DRIFT_PRIOR_MIN_ATTEMPTS || recentAttempts<NEWS_IMPACT_RECOVERY_DRIFT_RECENT_MIN_ATTEMPTS) {
      return snapshot;
    }
    const dropPctPoints=Math.round((Number(prior.successPct || 0)-Number(recent.successPct || 0))*10)/10;
    const confidenceSeparated=Number(recent?.confidence?.upperPct || 100)<Number(prior?.confidence?.lowerPct || 0);
    if (dropPctPoints>=NEWS_IMPACT_RECOVERY_DRIFT_DROP_PCT_POINTS && confidenceSeparated) {
      return {
        ...snapshot,
        selectedRecovery:decision.fixedRecovery,
        selectedRecoveryLabel:decision.fixedRecoveryLabel,
        strategy:'fixed',
        guardReason:'performance_drift',
        stability:'drift_blocked',
        driftStatus:'blocked',
        driftDetected:true,
        driftDropPctPoints:dropPctPoints,
        selectedAttempts:Number(decision.fixedAttempts || 0),
        selectedSuccessPct:Number(decision.fixedSuccessPct || 0),
        selectedConfidence:decision.fixedConfidence,
      };
    }
    return {...snapshot,driftStatus:'stable',driftDropPctPoints:Math.max(0,dropPctPoints)};
  }
  
  function buildNewsImpactRecoveryDriftMatrix(strategyRows = [], priorEvidenceRows = [], recentEvidenceRows = []) {
    return (strategyRows || []).map(row=>newsImpactRecoveryDriftDecision(row,priorEvidenceRows,recentEvidenceRows))
      .sort((a,b)=>(a.strategy==='adaptive'?0:1)-(b.strategy==='adaptive'?0:1)
        || (a.driftDetected?0:1)-(b.driftDetected?0:1)
        || Number(b.liftPctPoints || 0)-Number(a.liftPctPoints || 0)
        || String(a.reason || '').localeCompare(String(b.reason || ''))
        || String(a.action || '').localeCompare(String(b.action || '')));
  }
  
  
  function buildNewsImpactRecoveryTransitionHistory(failureRows = [], {limit = 20} = {}) {
    const ordered=[...(failureRows || [])]
      .map(row=>({row,at:newsImpactEventTime(row)}))
      .filter(x=>Number.isFinite(x.at))
      .sort((a,b)=>a.at-b.at);
    const state=new Map();
    const transitions=[];
    for (const item of ordered) {
      const row=item.row;
      const meta=row?.metadata && typeof row.metadata==='object' ? row.metadata : {};
      const reason=NEWS_IMPACT_FAILURE_CODES.has(String(meta.reason || '')) ? String(meta.reason) : 'server_error';
      const action=cleanNewsImpactActionCode(meta.action);
      if (!action) continue;
      const fixed=newsImpactRecoveryForFailure(reason,action);
      const recovery=NEWS_IMPACT_RECOVERY_CODES.has(String(meta.recovery || '')) ? String(meta.recovery) : fixed.code;
      const strategy=String(meta.strategy || '')==='adaptive' ? 'adaptive' : 'fixed';
      const guardReason=NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES.has(String(meta.strategy_guard || ''))
        ? String(meta.strategy_guard)
        : '';
      const key=`${reason}|${action}`;
      const current={strategy,recovery,guardReason,at:item.at};
      const previous=state.get(key) || null;
      if (previous && (previous.strategy!==strategy || previous.recovery!==recovery)) {
        transitions.push({
          at:new Date(item.at).toISOString(),
          reason,
          reasonLabel:NEWS_IMPACT_FAILURE_LABELS[reason] || reason,
          action,
          actionLabel:NEWS_IMPACT_ACTION_LABELS[action] || action,
          fromStrategy:previous.strategy,
          fromRecovery:previous.recovery,
          fromRecoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[previous.recovery] || previous.recovery,
          toStrategy:strategy,
          toRecovery:recovery,
          toRecoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[recovery] || recovery,
          guardReason,
        });
      }
      state.set(key,current);
    }
    return transitions
      .sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))
      .slice(0,Math.max(1,Math.min(50,Number(limit || 20))));
  }
  
  function summarizeNewsImpactRecoveryTransitions(rows = []) {
    const list=Array.isArray(rows) ? rows : [];
    return {
      total:list.length,
      fixedToAdaptive:list.filter(x=>x.fromStrategy==='fixed' && x.toStrategy==='adaptive').length,
      adaptiveToFixed:list.filter(x=>x.fromStrategy==='adaptive' && x.toStrategy==='fixed').length,
      recoveryChanged:list.filter(x=>x.fromRecovery!==x.toRecovery).length,
      last:list[0] || null,
    };
  }
  
  function buildNewsImpactRecoveryAdminAlerts(strategyRows = [], evidenceReason = 'ok', incidentRows = []) {
    const alerts=[];
    const suppressed=new Set((incidentRows || [])
      .filter(x=>x.status==='active' && x.acknowledged && x.alertSuppressed)
      .map(x=>newsImpactRecoveryIncidentKey(x.reason,x.action,x.code)));
    if (String(evidenceReason || 'ok')!=='ok') {
      alerts.push({
        severity:'warning',
        code:'strategy_evidence_unavailable',
        reason:'',
        action:'',
        reasonLabel:'Recovery Strategy',
        actionLabel:'',
        message:'Историческое evidence временно недоступно; runtime использует fixed fallback.',
      });
      return alerts;
    }
    for (const row of strategyRows || []) {
      if (NEWS_IMPACT_RECOVERY_INCIDENT_CODES.has(String(row.guardReason || ''))
        && suppressed.has(newsImpactRecoveryIncidentKey(row.reason,row.action,row.guardReason))) continue;
      if (row.guardReason==='performance_drift') {
        alerts.push({
          severity:'warning',
          code:'performance_drift',
          reason:row.reason,
          action:row.action,
          reasonLabel:row.reasonLabel || row.reason,
          actionLabel:row.actionLabel || row.action,
          message:`Adaptive recovery отключён после подтверждённого падения на ${Number(row.driftDropPctPoints || 0).toFixed(1)} п.п.; включён fixed fallback.`,
        });
      } else if (row.guardReason==='recent_regression') {
        alerts.push({
          severity:'warning',
          code:'recent_regression',
          reason:row.reason,
          action:row.action,
          reasonLabel:row.reasonLabel || row.reason,
          actionLabel:row.actionLabel || row.action,
          message:'Свежая выборка не подтверждает adaptive recovery; используется fixed fallback.',
        });
      } else if (row.guardReason==='stability_sample' && row.proposedRecovery) {
        alerts.push({
          severity:'info',
          code:'stability_sample',
          reason:row.reason,
          action:row.action,
          reasonLabel:row.reasonLabel || row.reason,
          actionLabel:row.actionLabel || row.action,
          message:'Есть adaptive-кандидат, но свежей выборки пока недостаточно для безопасного переключения.',
        });
      }
    }
    for (const incident of incidentRows || []) {
      if (incident.status!=='active' || !incident.escalated) continue;
      const recoveryBreach=incident?.slo?.recoveryStatus==='breached';
      const ackBreach=incident?.slo?.ackStatus==='breached' && !incident.acknowledged;
      if (!recoveryBreach && !ackBreach) continue;
      alerts.push({
        severity:incident.effectivePriority==='critical' ? 'critical' : 'warning',
        code:recoveryBreach ? 'incident_recovery_slo_breach' : 'incident_ack_slo_breach',
        reason:incident.reason,
        action:incident.action,
        reasonLabel:incident.reasonLabel || incident.reason,
        actionLabel:incident.actionLabel || incident.action,
        message:recoveryBreach
          ? `Recovery-инцидент не восстановлен в пределах ${NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES} минут; приоритет повышен.`
          : `Recovery-инцидент не просмотрен в пределах ${NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES} минут; приоритет повышен.`,
      });
    }
    return alerts.slice(0,12);
  }
  
  function summarizeNewsImpactRecoveryAlerts(rows = []) {
    const list=Array.isArray(rows) ? rows : [];
    return {
      total:list.length,
      warnings:list.filter(x=>x.severity==='warning').length,
      info:list.filter(x=>x.severity==='info').length,
      critical:list.filter(x=>x.severity==='critical').length,
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentEvents(failureRows = [], {limit = 100} = {}) {
    const normalized=(failureRows || []).map(row=>{
      const meta=row?.metadata && typeof row.metadata==='object' ? row.metadata : {};
      const guardReason=NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES.has(String(meta.strategy_guard || ''))
        ? String(meta.strategy_guard)
        : '';
      const at=newsImpactEventTime(row);
      const reason=NEWS_IMPACT_FAILURE_CODES.has(String(meta.reason || '')) ? String(meta.reason) : 'server_error';
      const action=cleanNewsImpactActionCode(meta.action);
      if (!Number.isFinite(at) || !action) return null;
      const recovery=NEWS_IMPACT_RECOVERY_CODES.has(String(meta.recovery || ''))
        ? String(meta.recovery)
        : newsImpactRecoveryForFailure(reason,action).code;
      return {
        at,
        reason,
        reasonLabel:NEWS_IMPACT_FAILURE_LABELS[reason] || reason,
        action,
        actionLabel:NEWS_IMPACT_ACTION_LABELS[action] || action,
        strategy:String(meta.strategy || '')==='adaptive' ? 'adaptive' : 'fixed',
        recovery,
        recoveryLabel:NEWS_IMPACT_RECOVERY_LABELS[recovery] || recovery,
        guardReason,
      };
    }).filter(Boolean).sort((a,b)=>a.at-b.at);
  
    const openByPair=new Map();
    const incidentEvents=[];
    for (const event of normalized) {
      const pairKey=`${event.reason}|${event.action}`;
      const adverse=NEWS_IMPACT_RECOVERY_INCIDENT_CODES.has(event.guardReason);
      let open=openByPair.get(pairKey) || null;
      if (!adverse) {
        if (open) {
          open.episode.recoveredAt=new Date(event.at).toISOString();
          openByPair.delete(pairKey);
        }
        continue;
      }
      if (!open || open.episode.guardReason!==event.guardReason) {
        if (open) open.episode.recoveredAt=new Date(event.at).toISOString();
        const episode={
          guardReason:event.guardReason,
          startedAt:new Date(event.at).toISOString(),
          lastSeenAt:new Date(event.at).toISOString(),
          recoveredAt:null,
          occurrences:0,
        };
        open={episode};
        openByPair.set(pairKey,open);
      }
      open.episode.lastSeenAt=new Date(event.at).toISOString();
      open.episode.occurrences+=1;
      incidentEvents.push({...event,episode:open.episode});
    }
  
    return incidentEvents.map(event=>({
      at:new Date(event.at).toISOString(),
      reason:event.reason,
      reasonLabel:event.reasonLabel,
      action:event.action,
      actionLabel:event.actionLabel,
      strategy:event.strategy,
      recovery:event.recovery,
      recoveryLabel:event.recoveryLabel,
      guardReason:event.guardReason,
      priority:event.guardReason==='performance_drift' ? 'high' : 'medium',
      episodeStartedAt:event.episode.startedAt,
      episodeLastSeenAt:event.episode.lastSeenAt,
      episodeRecoveredAt:event.episode.recoveredAt,
      episodeOccurrences:event.episode.occurrences,
    })).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))
      .slice(0,Math.max(1,Math.min(250,Number(limit || 100))));
  }
  
  function newsImpactRecoveryIncidentKey(reason = '', action = '', code = '') {
    return `${String(reason || '')}|${String(action || '')}|${String(code || '')}`;
  }
  
  function newsImpactRecoveryIncidentRunbook(code = '') {
    if (code==='performance_drift') return {
      title:'Performance drift',
      steps:[
        'Проверить prior → recent success rate и достаточность выборки.',
        'Проверить API-Football, Supabase и runtime controls на совпадающую деградацию.',
        'Не форсировать adaptive: circuit breaker уже держит fixed fallback.',
        'Снять инцидент только после новой устойчивой выборки и нормализации guard.',
      ],
      automaticSafety:'fixed fallback уже включён автоматически',
    };
    if (code==='recent_regression') return {
      title:'Recent regression',
      steps:[
        'Проверить свежую 7-дневную выборку baseline и adaptive-кандидата.',
        'Сверить падение с provider/rate-limit и delivery-событиями.',
        'Оставить fixed fallback до восстановления подтверждённой статистики.',
      ],
      automaticSafety:'adaptive не включается, пока свежая выборка не восстановится',
    };
    return {
      title:'Strategy evidence unavailable',
      steps:[
        'Проверить доступность Supabase и shared recovery loader.',
        'Проверить, не усечена ли 30-дневная выборка.',
        'Не менять routing вручную до восстановления evidence.',
      ],
      automaticSafety:'runtime остаётся на fixed fallback',
    };
  }
  
  function buildNewsImpactRecoveryIncidentAcknowledgements(rows = []) {
    const latest=new Map();
    for (const row of rows || []) {
      const meta=row?.metadata && typeof row.metadata==='object' ? row.metadata : {};
      const reason=NEWS_IMPACT_FAILURE_CODES.has(String(meta.reason || '')) ? String(meta.reason) : '';
      const action=cleanNewsImpactActionCode(meta.action);
      const code=NEWS_IMPACT_RECOVERY_INCIDENT_CODES.has(String(meta.incident_guard || '')) ? String(meta.incident_guard) : '';
      const acknowledgedAt=newsImpactEventTime(row);
      const seenAt=Date.parse(String(meta.incident_seen_at || ''));
      if (!reason || !action || !code || !Number.isFinite(acknowledgedAt) || !Number.isFinite(seenAt)) continue;
      const key=newsImpactRecoveryIncidentKey(reason,action,code);
      const value={
        reason,
        action,
        code,
        acknowledgedAt:new Date(acknowledgedAt).toISOString(),
        incidentSeenAt:new Date(seenAt).toISOString(),
      };
      const previous=latest.get(key);
      if (!previous || Date.parse(value.acknowledgedAt)>Date.parse(previous.acknowledgedAt)) latest.set(key,value);
    }
    return [...latest.values()];
  }
  
  
  function buildNewsImpactRecoveryIncidentAcknowledgementHistory(rows = []) {
    return (rows || []).map(row=>{
      const meta=row?.metadata && typeof row.metadata==='object' ? row.metadata : {};
      const reason=NEWS_IMPACT_FAILURE_CODES.has(String(meta.reason || '')) ? String(meta.reason) : '';
      const action=cleanNewsImpactActionCode(meta.action);
      const code=NEWS_IMPACT_RECOVERY_INCIDENT_CODES.has(String(meta.incident_guard || '')) ? String(meta.incident_guard) : '';
      const acknowledgedAt=newsImpactEventTime(row);
      const seenAt=Date.parse(String(meta.incident_seen_at || ''));
      if (!reason || !action || !code || !Number.isFinite(acknowledgedAt) || !Number.isFinite(seenAt)) return null;
      return {
        reason,
        action,
        code,
        acknowledgedAt:new Date(acknowledgedAt).toISOString(),
        incidentSeenAt:new Date(seenAt).toISOString(),
      };
    }).filter(Boolean).sort((a,b)=>Date.parse(a.acknowledgedAt)-Date.parse(b.acknowledgedAt));
  }
  
  function buildNewsImpactRecoveryIncidentEpisodeHistory(failureRows = [], acknowledgementRows = []) {
    const normalized=(failureRows || []).map(row=>{
      const meta=row?.metadata && typeof row.metadata==='object' ? row.metadata : {};
      const at=newsImpactEventTime(row);
      const reason=NEWS_IMPACT_FAILURE_CODES.has(String(meta.reason || '')) ? String(meta.reason) : 'server_error';
      const action=cleanNewsImpactActionCode(meta.action);
      const guardReason=NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES.has(String(meta.strategy_guard || ''))
        ? String(meta.strategy_guard)
        : '';
      if (!Number.isFinite(at) || !action) return null;
      return {
        at,
        reason,
        reasonLabel:NEWS_IMPACT_FAILURE_LABELS[reason] || reason,
        action,
        actionLabel:NEWS_IMPACT_ACTION_LABELS[action] || action,
        guardReason,
      };
    }).filter(Boolean).sort((a,b)=>a.at-b.at);
  
    const openByPair=new Map();
    const episodes=[];
    for (const event of normalized) {
      const key=`${event.reason}|${event.action}`;
      const adverse=NEWS_IMPACT_RECOVERY_INCIDENT_CODES.has(event.guardReason);
      let episode=openByPair.get(key) || null;
      if (!adverse) {
        if (episode) {
          episode.recoveredAt=new Date(event.at).toISOString();
          episode.closedByGuard=event.guardReason || 'safe';
          openByPair.delete(key);
        }
        continue;
      }
      if (!episode) {
        episode={
          reason:event.reason,
          reasonLabel:event.reasonLabel,
          action:event.action,
          actionLabel:event.actionLabel,
          startedAt:new Date(event.at).toISOString(),
          lastSeenAt:new Date(event.at).toISOString(),
          recoveredAt:null,
          closedByGuard:'',
          occurrences:0,
          guardCodes:[],
        };
        episodes.push(episode);
        openByPair.set(key,episode);
      }
      episode.lastSeenAt=new Date(event.at).toISOString();
      episode.occurrences+=1;
      if (!episode.guardCodes.includes(event.guardReason)) episode.guardCodes.push(event.guardReason);
    }
  
    const ackHistory=buildNewsImpactRecoveryIncidentAcknowledgementHistory(acknowledgementRows);
    return episodes.map(episode=>{
      const startMs=Date.parse(episode.startedAt);
      const lastSeenMs=Date.parse(episode.lastSeenAt);
      const recoveredMs=Date.parse(String(episode.recoveredAt || ''));
      const ack=ackHistory.find(item=>{
        if (item.reason!==episode.reason || item.action!==episode.action) return false;
        if (!episode.guardCodes.includes(item.code)) return false;
        const seenMs=Date.parse(item.incidentSeenAt);
        const ackMs=Date.parse(item.acknowledgedAt);
        return Number.isFinite(seenMs)
          && Number.isFinite(ackMs)
          && seenMs>=startMs
          && seenMs<=lastSeenMs
          && ackMs>=startMs
          && (!Number.isFinite(recoveredMs) || ackMs<=recoveredMs);
      }) || null;
      return {
        ...episode,
        firstAcknowledgedAt:ack?.acknowledgedAt || null,
        firstAcknowledgedGuard:ack?.code || '',
        active:!episode.recoveredAt,
      };
    }).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt));
  }
  
  function newsImpactRecoveryEpisodeSloState(episode = null, asOfMs = Date.now()) {
    if (!episode) return null;
    const startMs=Date.parse(String(episode.startedAt || ''));
    if (!Number.isFinite(startMs)) return null;
    const recoveredMs=Date.parse(String(episode.recoveredAt || ''));
    const ackMs=Date.parse(String(episode.firstAcknowledgedAt || ''));
    const terminalMs=Number.isFinite(recoveredMs) ? recoveredMs : asOfMs;
    const elapsedMinutes=Math.max(0,Math.round((terminalMs-startMs)/60000));
    const ackLatencyMinutes=Number.isFinite(ackMs) ? Math.max(0,Math.round((ackMs-startMs)/60000)) : null;
    const recoveryLatencyMinutes=Number.isFinite(recoveredMs) ? elapsedMinutes : null;
    const ackEligible=Number.isFinite(ackMs) || elapsedMinutes>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES;
    const ackMet=ackEligible && Number.isFinite(ackLatencyMinutes) && ackLatencyMinutes<=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES;
    const ackBreached=ackEligible && !ackMet;
    const recoveryEligible=Number.isFinite(recoveredMs) || elapsedMinutes>=NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES;
    const recoveryMet=recoveryEligible && Number.isFinite(recoveryLatencyMinutes) && recoveryLatencyMinutes<=NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES;
    const recoveryBreached=recoveryEligible && !recoveryMet;
    return {
      elapsedMinutes,
      ackLatencyMinutes,
      recoveryLatencyMinutes,
      ackEligible,
      ackMet,
      ackBreached,
      ackStatus:ackMet ? 'met' : ackBreached ? 'breached' : 'pending',
      recoveryEligible,
      recoveryMet,
      recoveryBreached,
      recoveryStatus:recoveryMet ? 'met' : recoveryBreached ? 'breached' : 'pending',
    };
  }
  
  function newsImpactRecoverySloPct(met = 0, eligible = 0) {
    return eligible>0 ? Math.round((Number(met || 0)/Number(eligible))*1000)/10 : null;
  }
  
  function buildNewsImpactRecoveryIncidentSloDashboard(episodeRows = [], {asOfMs = Date.now(), weeks = 4} = {}) {
    const safeWeeks=Math.max(2,Math.min(4,Number(weeks || 4)));
    const weekMs=7*86400_000;
    const earliestMs=asOfMs-safeWeeks*weekMs;
    const episodes=(episodeRows || []).map(episode=>({
      ...episode,
      slo:newsImpactRecoveryEpisodeSloState(episode,asOfMs),
    })).filter(x=>x.slo && Date.parse(x.startedAt)>=earliestMs && Date.parse(x.startedAt)<=asOfMs);
  
    const summarize=(rows=[])=>{
      const ackEligible=rows.filter(x=>x.slo.ackEligible).length;
      const ackMet=rows.filter(x=>x.slo.ackMet).length;
      const ackBreached=rows.filter(x=>x.slo.ackBreached).length;
      const recoveryEligible=rows.filter(x=>x.slo.recoveryEligible).length;
      const recoveryMet=rows.filter(x=>x.slo.recoveryMet).length;
      const recoveryBreached=rows.filter(x=>x.slo.recoveryBreached).length;
      const ackLatencies=rows.map(x=>x.slo.ackLatencyMinutes).filter(Number.isFinite);
      const recoveryLatencies=rows.map(x=>x.slo.recoveryLatencyMinutes).filter(Number.isFinite);
      return {
        episodes:rows.length,
        active:rows.filter(x=>x.active).length,
        recovered:rows.filter(x=>!x.active).length,
        ackEligible,
        ackMet,
        ackBreached,
        ackSloPct:newsImpactRecoverySloPct(ackMet,ackEligible),
        recoveryEligible,
        recoveryMet,
        recoveryBreached,
        recoverySloPct:newsImpactRecoverySloPct(recoveryMet,recoveryEligible),
        avgAckMinutes:ackLatencies.length ? Math.round((ackLatencies.reduce((a,b)=>a+b,0)/ackLatencies.length)*10)/10 : null,
        avgRecoveryMinutes:recoveryLatencies.length ? Math.round((recoveryLatencies.reduce((a,b)=>a+b,0)/recoveryLatencies.length)*10)/10 : null,
      };
    };
  
    const weekly=[];
    for (let offset=safeWeeks-1; offset>=0; offset-=1) {
      const startMs=asOfMs-(offset+1)*weekMs;
      const endMs=asOfMs-offset*weekMs;
      const rows=episodes.filter(x=>{
        const at=Date.parse(x.startedAt);
        return at>=startMs && at<endMs;
      });
      weekly.push({
        startAt:new Date(startMs).toISOString(),
        endAt:new Date(endMs).toISOString(),
        label:`${new Date(startMs).toISOString().slice(0,10)} → ${new Date(endMs).toISOString().slice(0,10)}`,
        ...summarize(rows),
      });
    }
  
    const recurrence=new Map();
    for (const episode of episodes) {
      const key=`${episode.reason}|${episode.action}`;
      const bucket=recurrence.get(key) || {
        reason:episode.reason,
        reasonLabel:episode.reasonLabel || episode.reason,
        action:episode.action,
        actionLabel:episode.actionLabel || episode.action,
        episodes:0,
        active:0,
        ackBreaches:0,
        recoveryBreaches:0,
        lastStartedAt:episode.startedAt,
        guards:new Set(),
      };
      bucket.episodes+=1;
      if (episode.active) bucket.active+=1;
      if (episode.slo.ackBreached) bucket.ackBreaches+=1;
      if (episode.slo.recoveryBreached) bucket.recoveryBreaches+=1;
      if (Date.parse(episode.startedAt)>Date.parse(bucket.lastStartedAt)) bucket.lastStartedAt=episode.startedAt;
      for (const code of episode.guardCodes || []) bucket.guards.add(code);
      recurrence.set(key,bucket);
    }
    const repeatedAll=[...recurrence.values()].map(x=>({
      reason:x.reason,
      reasonLabel:x.reasonLabel,
      action:x.action,
      actionLabel:x.actionLabel,
      episodes:x.episodes,
      active:x.active,
      ackBreaches:x.ackBreaches,
      recoveryBreaches:x.recoveryBreaches,
      lastStartedAt:x.lastStartedAt,
      guards:[...x.guards].sort(),
    })).filter(x=>x.episodes>=2)
      .sort((a,b)=>b.episodes-a.episodes || b.recoveryBreaches-a.recoveryBreaches || b.ackBreaches-a.ackBreaches || Date.parse(b.lastStartedAt)-Date.parse(a.lastStartedAt));
    const repeated=repeatedAll.slice(0,10);
  
    const summary=summarize(episodes);
    const current=weekly[weekly.length-1] || null;
    const previous=weekly[weekly.length-2] || null;
    const delta=(a,b)=>Number.isFinite(Number(a)) && Number.isFinite(Number(b))
      ? Math.round((Number(a)-Number(b))*10)/10
      : null;
    return {
      available:true,
      windowDays:safeWeeks*7,
      weeks:safeWeeks,
      generatedAt:new Date(asOfMs).toISOString(),
      summary:{
        ...summary,
        recurringPairs:repeatedAll.length,
        ackDeltaPctPoints:delta(current?.ackSloPct,previous?.ackSloPct),
        recoveryDeltaPctPoints:delta(current?.recoverySloPct,previous?.recoverySloPct),
      },
      weekly,
      repeated,
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false},
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentSloBreachFeed(episodeRows = [], {asOfMs = Date.now(), limit = 20} = {}) {
    const priorityRank={critical:0,high:1,medium:2};
    const safeLimit=Math.max(1,Math.min(50,Number(limit || 20)));
    const items=(episodeRows || []).map(episode=>{
      const slo=newsImpactRecoveryEpisodeSloState(episode,asOfMs);
      if (!slo || (!slo.ackBreached && !slo.recoveryBreached)) return null;
      const breachTypes=[];
      if (slo.ackBreached) breachTypes.push('ack');
      if (slo.recoveryBreached) breachTypes.push('recovery');
      let severity='medium';
      if (episode.active && slo.recoveryBreached) severity='critical';
      else if (episode.active && slo.ackBreached && Number(slo.elapsedMinutes || 0)>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES) severity='critical';
      else if (episode.active && slo.ackBreached) severity='high';
      else if (slo.recoveryBreached) severity='high';
      return {
        reason:String(episode.reason || ''),
        reasonLabel:String(episode.reasonLabel || episode.reason || ''),
        action:String(episode.action || ''),
        actionLabel:String(episode.actionLabel || episode.action || ''),
        startedAt:episode.startedAt || null,
        lastSeenAt:episode.lastSeenAt || null,
        recoveredAt:episode.recoveredAt || null,
        active:Boolean(episode.active),
        occurrences:Number(episode.occurrences || 0),
        guards:Array.isArray(episode.guardCodes) ? [...episode.guardCodes].sort() : [],
        breachTypes,
        severity,
        ackStatus:slo.ackStatus,
        recoveryStatus:slo.recoveryStatus,
        ageMinutes:slo.elapsedMinutes,
        ackLatencyMinutes:slo.ackLatencyMinutes,
        recoveryLatencyMinutes:slo.recoveryLatencyMinutes,
      };
    }).filter(Boolean).sort((a,b)=>
      (priorityRank[a.severity] ?? 9)-(priorityRank[b.severity] ?? 9)
      || Number(b.active)-Number(a.active)
      || Date.parse(String(b.startedAt || 0))-Date.parse(String(a.startedAt || 0))
    );
  
    const pairs=new Map();
    for (const item of items) {
      const key=String(item.reason || '')+'|'+String(item.action || '');
      const bucket=pairs.get(key) || {
        reason:item.reason,
        reasonLabel:item.reasonLabel,
        action:item.action,
        actionLabel:item.actionLabel,
        breachEpisodes:0,
        activeBreaches:0,
        ackBreaches:0,
        recoveryBreaches:0,
        lastStartedAt:item.startedAt,
      };
      bucket.breachEpisodes+=1;
      if (item.active) bucket.activeBreaches+=1;
      if (item.breachTypes.includes('ack')) bucket.ackBreaches+=1;
      if (item.breachTypes.includes('recovery')) bucket.recoveryBreaches+=1;
      if (Date.parse(String(item.startedAt || 0))>Date.parse(String(bucket.lastStartedAt || 0))) bucket.lastStartedAt=item.startedAt;
      pairs.set(key,bucket);
    }
    const repeated=[...pairs.values()]
      .filter(x=>x.breachEpisodes>=2)
      .sort((a,b)=>b.activeBreaches-a.activeBreaches || b.recoveryBreaches-a.recoveryBreaches || b.ackBreaches-a.ackBreaches || b.breachEpisodes-a.breachEpisodes)
      .slice(0,10);
  
    return {
      available:true,
      generatedAt:new Date(asOfMs).toISOString(),
      summary:{
        breachEpisodes:items.length,
        activeBreaches:items.filter(x=>x.active).length,
        critical:items.filter(x=>x.severity==='critical').length,
        ackBreaches:items.filter(x=>x.breachTypes.includes('ack')).length,
        recoveryBreaches:items.filter(x=>x.breachTypes.includes('recovery')).length,
        repeatedPairs:repeated.length,
      },
      items:items.slice(0,safeLimit),
      repeated,
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentSloBreachWatchlist(feed = {}, {limit = 10} = {}) {
    const safeLimit=Math.max(1,Math.min(25,Number(limit || 10)));
    const items=Array.isArray(feed?.items) ? feed.items : [];
    const repeated=Array.isArray(feed?.repeated) ? feed.repeated : [];
    const active=items.filter(x=>x?.active);
    const activeSorted=[...active].sort((a,b)=>
      Number(b?.severity==='critical')-Number(a?.severity==='critical')
      || Number(b?.ageMinutes || 0)-Number(a?.ageMinutes || 0)
      || Date.parse(String(a?.startedAt || 0))-Date.parse(String(b?.startedAt || 0))
    );
    const activeRepeatedPairs=repeated
      .filter(x=>Number(x?.activeBreaches || 0)>0)
      .sort((a,b)=>Number(b.activeBreaches || 0)-Number(a.activeBreaches || 0)
        || Number(b.breachEpisodes || 0)-Number(a.breachEpisodes || 0))
      .slice(0,10);
    return {
      available:feed?.available!==false,
      generatedAt:feed?.generatedAt || null,
      summary:{
        active:active.length,
        criticalActive:active.filter(x=>x?.severity==='critical').length,
        ackActive:active.filter(x=>Array.isArray(x?.breachTypes) && x.breachTypes.includes('ack')).length,
        recoveryActive:active.filter(x=>Array.isArray(x?.breachTypes) && x.breachTypes.includes('recovery')).length,
        oldestActiveMinutes:active.length ? Math.max(...active.map(x=>Number(x?.ageMinutes || 0))) : null,
        repeatedActivePairs:activeRepeatedPairs.length,
      },
      items:activeSorted.slice(0,safeLimit),
      repeated:activeRepeatedPairs,
      thresholds:{
        ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
        criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
        recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
        source:'rc87_existing_slo',
      },
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentSloBreachTriage(watchlist = {}, {limit = 10} = {}) {
    const safeLimit=Math.max(1,Math.min(25,Number(limit || 10)));
    const items=Array.isArray(watchlist?.items) ? watchlist.items : [];
    const thresholds=watchlist?.thresholds || {};
    const criticalAckMinutes=Number(thresholds.criticalAckMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES);
    const recoveryMinutes=Number(thresholds.recoveryMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES);
    const stageRank={recovery_overdue:0,ack_critical:1,ack_overdue:2};
    const triageItems=items.filter(x=>x?.active).map(item=>{
      const breachTypes=Array.isArray(item?.breachTypes) ? item.breachTypes : [];
      const ageMinutes=Number(item?.ageMinutes || 0);
      let triageStage='ack_overdue';
      let triageLabel='ACK просрочен';
      if (breachTypes.includes('recovery') || ageMinutes>=recoveryMinutes) {
        triageStage='recovery_overdue';
        triageLabel='Recovery просрочен';
      } else if (breachTypes.includes('ack') && ageMinutes>=criticalAckMinutes) {
        triageStage='ack_critical';
        triageLabel='ACK критически просрочен';
      }
      return {...item,triageStage,triageLabel};
    }).sort((a,b)=>
      (stageRank[a.triageStage] ?? 9)-(stageRank[b.triageStage] ?? 9)
      || Number(b.ageMinutes || 0)-Number(a.ageMinutes || 0)
      || Date.parse(String(a.startedAt || 0))-Date.parse(String(b.startedAt || 0))
    );
    return {
      available:watchlist?.available!==false,
      generatedAt:watchlist?.generatedAt || null,
      summary:{
        total:triageItems.length,
        recoveryOverdue:triageItems.filter(x=>x.triageStage==='recovery_overdue').length,
        ackCritical:triageItems.filter(x=>x.triageStage==='ack_critical').length,
        ackOverdue:triageItems.filter(x=>x.triageStage==='ack_overdue').length,
      },
      items:triageItems.slice(0,safeLimit),
      thresholds:{
        ackMinutes:Number(thresholds.ackMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES),
        criticalAckMinutes,
        recoveryMinutes,
        source:'rc87_existing_slo',
      },
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function newsImpactRecoveryIncidentTriageStageAt(episode = null, atMs = Date.now()) {
    if (!episode) return null;
    const startMs=Date.parse(String(episode.startedAt || ''));
    if (!Number.isFinite(startMs) || startMs>atMs) return null;
    const recoveredMs=Date.parse(String(episode.recoveredAt || ''));
    if (Number.isFinite(recoveredMs) && recoveredMs<=atMs) return null;
    const ageMinutes=Math.max(0,Math.floor((atMs-startMs)/60000));
    const ackMs=Date.parse(String(episode.firstAcknowledgedAt || ''));
    const ackLatencyMinutes=Number.isFinite(ackMs) ? Math.max(0,Math.round((ackMs-startMs)/60000)) : null;
    const ackBreached=Number.isFinite(ackMs) && ackMs<=atMs
      ? Number(ackLatencyMinutes || 0)>NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES
      : ageMinutes>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES;
    if (ageMinutes>=NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES) return 'recovery_overdue';
    if (ackBreached && ageMinutes>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES) return 'ack_critical';
    if (ackBreached) return 'ack_overdue';
    return null;
  }
  
  function buildNewsImpactRecoveryIncidentSloBreachTriageTrend(episodeRows = [], {asOfMs = Date.now(), weeks = 4} = {}) {
    const safeWeeks=Math.max(2,Math.min(4,Number(weeks || 4)));
    const weekMs=7*86400_000;
    const weekly=[];
    const pairSnapshots=new Map();
    for (let i=safeWeeks-1;i>=0;i-=1) {
      const snapshotAtMs=asOfMs-i*weekMs;
      const counts={total:0,recoveryOverdue:0,ackCritical:0,ackOverdue:0};
      const seenPairs=new Map();
      for (const episode of episodeRows || []) {
        const stage=newsImpactRecoveryIncidentTriageStageAt(episode,snapshotAtMs);
        if (!stage) continue;
        counts.total+=1;
        if (stage==='recovery_overdue') counts.recoveryOverdue+=1;
        else if (stage==='ack_critical') counts.ackCritical+=1;
        else counts.ackOverdue+=1;
        const key=String(episode.reason || '')+'|'+String(episode.action || '');
        const current=seenPairs.get(key) || {
          reason:String(episode.reason || ''),
          reasonLabel:String(episode.reasonLabel || episode.reason || ''),
          action:String(episode.action || ''),
          actionLabel:String(episode.actionLabel || episode.action || ''),
          stage,
        };
        if (stage==='recovery_overdue' || (stage==='ack_critical' && current.stage==='ack_overdue')) current.stage=stage;
        seenPairs.set(key,current);
      }
      for (const [key,pair] of seenPairs) {
        const bucket=pairSnapshots.get(key) || {
          reason:pair.reason,
          reasonLabel:pair.reasonLabel,
          action:pair.action,
          actionLabel:pair.actionLabel,
          weeksPresent:0,
          recoveryOverdueWeeks:0,
          ackCriticalWeeks:0,
          ackOverdueWeeks:0,
          latestStage:pair.stage,
        };
        bucket.weeksPresent+=1;
        if (pair.stage==='recovery_overdue') bucket.recoveryOverdueWeeks+=1;
        else if (pair.stage==='ack_critical') bucket.ackCriticalWeeks+=1;
        else bucket.ackOverdueWeeks+=1;
        bucket.latestStage=pair.stage;
        pairSnapshots.set(key,bucket);
      }
      weekly.push({
        snapshotAt:new Date(snapshotAtMs).toISOString(),
        ...counts,
      });
    }
    const current=weekly[weekly.length-1] || {total:0,recoveryOverdue:0,ackCritical:0,ackOverdue:0};
    const previous=weekly[weekly.length-2] || current;
    const stuck=[...pairSnapshots.values()]
      .filter(x=>x.weeksPresent>=2)
      .sort((a,b)=>b.recoveryOverdueWeeks-a.recoveryOverdueWeeks
        || b.ackCriticalWeeks-a.ackCriticalWeeks
        || b.weeksPresent-a.weeksPresent
        || String(a.reason).localeCompare(String(b.reason)))
      .slice(0,10);
    return {
      available:true,
      weeks:safeWeeks,
      generatedAt:new Date(asOfMs).toISOString(),
      summary:{
        currentTotal:Number(current.total || 0),
        totalDelta:Number(current.total || 0)-Number(previous.total || 0),
        recoveryOverdueDelta:Number(current.recoveryOverdue || 0)-Number(previous.recoveryOverdue || 0),
        ackCriticalDelta:Number(current.ackCritical || 0)-Number(previous.ackCritical || 0),
        ackOverdueDelta:Number(current.ackOverdue || 0)-Number(previous.ackOverdue || 0),
        stuckPairs:stuck.length,
      },
      weekly,
      stuck,
      thresholds:{
        ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
        criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
        recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
        source:'rc87_existing_slo',
      },
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function newsImpactRecoveryIncidentSloBurden(episode = null, asOfMs = Date.now()) {
    if (!episode) return null;
    const startMs=Date.parse(String(episode.startedAt || ''));
    if (!Number.isFinite(startMs) || startMs>asOfMs) return null;
    const recoveredMs=Date.parse(String(episode.recoveredAt || ''));
    const terminalMs=Number.isFinite(recoveredMs) && recoveredMs<=asOfMs ? recoveredMs : asOfMs;
    const elapsedMinutes=Math.max(0,Math.round((terminalMs-startMs)/60000));
    const ackMs=Date.parse(String(episode.firstAcknowledgedAt || ''));
    const ackTerminalMs=Number.isFinite(ackMs) && ackMs<=terminalMs ? ackMs : terminalMs;
    const ackElapsedMinutes=Math.max(0,Math.round((ackTerminalMs-startMs)/60000));
    const ackOverdueMinutes=Math.max(0,ackElapsedMinutes-NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES);
    const recoveryOverdueMinutes=Math.max(0,elapsedMinutes-NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES);
    return {
      active:!(Number.isFinite(recoveredMs) && recoveredMs<=asOfMs),
      elapsedMinutes,
      ackOverdueMinutes,
      recoveryOverdueMinutes,
      totalOverdueMinutes:ackOverdueMinutes+recoveryOverdueMinutes,
    };
  }
  
  function buildNewsImpactRecoveryIncidentSloBreachImpactRanking(episodeRows = [], {asOfMs = Date.now(), limit = 10} = {}) {
    const safeLimit=Math.max(1,Math.min(25,Number(limit || 10)));
    const groups=new Map();
    for (const episode of episodeRows || []) {
      const burden=newsImpactRecoveryIncidentSloBurden(episode,asOfMs);
      if (!burden || burden.totalOverdueMinutes<=0) continue;
      const key=String(episode.reason || '')+'|'+String(episode.action || '');
      const bucket=groups.get(key) || {
        reason:String(episode.reason || ''),
        reasonLabel:String(episode.reasonLabel || episode.reason || ''),
        action:String(episode.action || ''),
        actionLabel:String(episode.actionLabel || episode.action || ''),
        episodes:0,
        activeEpisodes:0,
        ackBreachEpisodes:0,
        recoveryBreachEpisodes:0,
        ackOverdueMinutes:0,
        recoveryOverdueMinutes:0,
        totalOverdueMinutes:0,
        oldestActiveMinutes:null,
        latestStage:null,
      };
      bucket.episodes+=1;
      if (burden.active) {
        bucket.activeEpisodes+=1;
        bucket.oldestActiveMinutes=bucket.oldestActiveMinutes==null
          ? burden.elapsedMinutes
          : Math.max(bucket.oldestActiveMinutes,burden.elapsedMinutes);
        const stage=newsImpactRecoveryIncidentTriageStageAt(episode,asOfMs);
        const stageRank={recovery_overdue:0,ack_critical:1,ack_overdue:2};
        if (stage && (bucket.latestStage==null || (stageRank[stage] ?? 9)<(stageRank[bucket.latestStage] ?? 9))) {
          bucket.latestStage=stage;
        }
      }
      if (burden.ackOverdueMinutes>0) bucket.ackBreachEpisodes+=1;
      if (burden.recoveryOverdueMinutes>0) bucket.recoveryBreachEpisodes+=1;
      bucket.ackOverdueMinutes+=burden.ackOverdueMinutes;
      bucket.recoveryOverdueMinutes+=burden.recoveryOverdueMinutes;
      bucket.totalOverdueMinutes+=burden.totalOverdueMinutes;
      groups.set(key,bucket);
    }
    const all=[...groups.values()].sort((a,b)=>
      b.totalOverdueMinutes-a.totalOverdueMinutes
      || b.recoveryOverdueMinutes-a.recoveryOverdueMinutes
      || b.ackOverdueMinutes-a.ackOverdueMinutes
      || b.episodes-a.episodes
      || String(a.reason).localeCompare(String(b.reason))
    );
    const totalOverdueMinutes=all.reduce((sum,row)=>sum+Number(row.totalOverdueMinutes || 0),0);
    const ranking=all.slice(0,safeLimit).map((row,index)=>({
      ...row,
      rank:index+1,
      contributionPct:totalOverdueMinutes>0
        ? Math.round((Number(row.totalOverdueMinutes || 0)/totalOverdueMinutes)*1000)/10
        : 0,
    }));
    return {
      available:true,
      generatedAt:new Date(asOfMs).toISOString(),
      summary:{
        pairs:all.length,
        activePairs:all.filter(x=>x.activeEpisodes>0).length,
        breachEpisodes:all.reduce((sum,row)=>sum+Number(row.episodes || 0),0),
        totalOverdueMinutes,
        ackOverdueMinutes:all.reduce((sum,row)=>sum+Number(row.ackOverdueMinutes || 0),0),
        recoveryOverdueMinutes:all.reduce((sum,row)=>sum+Number(row.recoveryOverdueMinutes || 0),0),
        topContributionPct:ranking[0]?.contributionPct || 0,
      },
      ranking,
      thresholds:{
        ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
        criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
        recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
        source:'rc87_existing_slo',
      },
      methodology:'sum_minutes_above_existing_ack_and_recovery_slo',
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function newsImpactRecoveryIncidentOverdueWithinWindow(episode = null, windowStartMs = 0, windowEndMs = Date.now()) {
    if (!episode || !Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs<=windowStartMs) return null;
    const startMs=Date.parse(String(episode.startedAt || ''));
    if (!Number.isFinite(startMs) || startMs>=windowEndMs) return null;
    const recoveredMs=Date.parse(String(episode.recoveredAt || ''));
    const terminalMs=Number.isFinite(recoveredMs) && recoveredMs<windowEndMs ? recoveredMs : windowEndMs;
    if (terminalMs<=windowStartMs) return null;
    const ackMs=Date.parse(String(episode.firstAcknowledgedAt || ''));
    const ackTerminalMs=Number.isFinite(ackMs) && ackMs<terminalMs ? ackMs : terminalMs;
    const overlapMinutes=(fromMs,toMs)=>{
      const from=Math.max(windowStartMs,fromMs);
      const to=Math.min(windowEndMs,toMs);
      return to>from ? Math.max(0,Math.round((to-from)/60000)) : 0;
    };
    const ackOverdueStartMs=startMs+NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES*60000;
    const recoveryOverdueStartMs=startMs+NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES*60000;
    const ackOverdueMinutes=overlapMinutes(ackOverdueStartMs,ackTerminalMs);
    const recoveryOverdueMinutes=overlapMinutes(recoveryOverdueStartMs,terminalMs);
    return {
      ackOverdueMinutes,
      recoveryOverdueMinutes,
      totalOverdueMinutes:ackOverdueMinutes+recoveryOverdueMinutes,
    };
  }
  
  function buildNewsImpactRecoveryIncidentSloBreachImpactTrend(episodeRows = [], {asOfMs = Date.now(), weeks = 4, limit = 10} = {}) {
    const safeWeeks=Math.max(2,Math.min(4,Number(weeks || 4)));
    const safeLimit=Math.max(1,Math.min(25,Number(limit || 10)));
    const weekMs=7*86400_000;
    const weekly=[];
    const pairSeries=new Map();
    for (let i=safeWeeks-1;i>=0;i-=1) {
      const windowEndMs=asOfMs-i*weekMs;
      const windowStartMs=windowEndMs-weekMs;
      const groups=new Map();
      for (const episode of episodeRows || []) {
        const burden=newsImpactRecoveryIncidentOverdueWithinWindow(episode,windowStartMs,windowEndMs);
        if (!burden || burden.totalOverdueMinutes<=0) continue;
        const key=String(episode.reason || '')+'|'+String(episode.action || '');
        const bucket=groups.get(key) || {
          reason:String(episode.reason || ''),
          reasonLabel:String(episode.reasonLabel || episode.reason || ''),
          action:String(episode.action || ''),
          actionLabel:String(episode.actionLabel || episode.action || ''),
          episodes:0,
          ackOverdueMinutes:0,
          recoveryOverdueMinutes:0,
          totalOverdueMinutes:0,
        };
        bucket.episodes+=1;
        bucket.ackOverdueMinutes+=burden.ackOverdueMinutes;
        bucket.recoveryOverdueMinutes+=burden.recoveryOverdueMinutes;
        bucket.totalOverdueMinutes+=burden.totalOverdueMinutes;
        groups.set(key,bucket);
      }
      const all=[...groups.values()].sort((a,b)=>
        b.totalOverdueMinutes-a.totalOverdueMinutes
        || b.recoveryOverdueMinutes-a.recoveryOverdueMinutes
        || b.ackOverdueMinutes-a.ackOverdueMinutes
        || String(a.reason).localeCompare(String(b.reason))
      );
      const totalOverdueMinutes=all.reduce((sum,row)=>sum+Number(row.totalOverdueMinutes || 0),0);
      const pairMap=new Map(all.map(row=>[String(row.reason)+'|'+String(row.action),row]));
      weekly.push({
        windowStart:new Date(windowStartMs).toISOString(),
        windowEnd:new Date(windowEndMs).toISOString(),
        totalOverdueMinutes,
        ackOverdueMinutes:all.reduce((sum,row)=>sum+Number(row.ackOverdueMinutes || 0),0),
        recoveryOverdueMinutes:all.reduce((sum,row)=>sum+Number(row.recoveryOverdueMinutes || 0),0),
        pairs:all.length,
        top:all[0] ? {
          reason:all[0].reason,
          reasonLabel:all[0].reasonLabel,
          action:all[0].action,
          actionLabel:all[0].actionLabel,
          totalOverdueMinutes:all[0].totalOverdueMinutes,
          contributionPct:totalOverdueMinutes>0 ? Math.round((all[0].totalOverdueMinutes/totalOverdueMinutes)*1000)/10 : 0,
        } : null,
      });
      for (const row of all) {
        const key=String(row.reason)+'|'+String(row.action);
        if (!pairSeries.has(key)) pairSeries.set(key,{
          reason:row.reason,
          reasonLabel:row.reasonLabel,
          action:row.action,
          actionLabel:row.actionLabel,
          values:new Array(safeWeeks).fill(null).map(()=>({ackOverdueMinutes:0,recoveryOverdueMinutes:0,totalOverdueMinutes:0,episodes:0})),
        });
      }
      const weekIndex=weekly.length-1;
      for (const [key,series] of pairSeries) {
        const row=pairMap.get(key);
        if (row) series.values[weekIndex]={
          ackOverdueMinutes:Number(row.ackOverdueMinutes || 0),
          recoveryOverdueMinutes:Number(row.recoveryOverdueMinutes || 0),
          totalOverdueMinutes:Number(row.totalOverdueMinutes || 0),
          episodes:Number(row.episodes || 0),
        };
      }
    }
    const currentWeek=weekly[weekly.length-1] || {totalOverdueMinutes:0};
    const previousWeek=weekly[weekly.length-2] || currentWeek;
    const pairTrends=[...pairSeries.values()].map(series=>{
      const current=series.values[series.values.length-1] || {totalOverdueMinutes:0};
      const previous=series.values[series.values.length-2] || {totalOverdueMinutes:0};
      const deltaMinutes=Number(current.totalOverdueMinutes || 0)-Number(previous.totalOverdueMinutes || 0);
      return {
        reason:series.reason,
        reasonLabel:series.reasonLabel,
        action:series.action,
        actionLabel:series.actionLabel,
        currentOverdueMinutes:Number(current.totalOverdueMinutes || 0),
        previousOverdueMinutes:Number(previous.totalOverdueMinutes || 0),
        deltaMinutes,
        direction:deltaMinutes>0 ? 'increased' : deltaMinutes<0 ? 'decreased' : 'unchanged',
        currentContributionPct:Number(currentWeek.totalOverdueMinutes || 0)>0
          ? Math.round((Number(current.totalOverdueMinutes || 0)/Number(currentWeek.totalOverdueMinutes || 0))*1000)/10
          : 0,
        weekly:series.values,
      };
    }).sort((a,b)=>
      Math.abs(b.deltaMinutes)-Math.abs(a.deltaMinutes)
      || b.currentOverdueMinutes-a.currentOverdueMinutes
      || String(a.reason).localeCompare(String(b.reason))
    );
    return {
      available:true,
      weeks:safeWeeks,
      generatedAt:new Date(asOfMs).toISOString(),
      summary:{
        currentOverdueMinutes:Number(currentWeek.totalOverdueMinutes || 0),
        previousOverdueMinutes:Number(previousWeek.totalOverdueMinutes || 0),
        deltaMinutes:Number(currentWeek.totalOverdueMinutes || 0)-Number(previousWeek.totalOverdueMinutes || 0),
        increasedPairs:pairTrends.filter(x=>x.direction==='increased').length,
        decreasedPairs:pairTrends.filter(x=>x.direction==='decreased').length,
        unchangedPairs:pairTrends.filter(x=>x.direction==='unchanged').length,
      },
      weekly,
      pairs:pairTrends.slice(0,safeLimit),
      thresholds:{
        ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
        criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
        recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
        source:'rc87_existing_slo',
      },
      methodology:'weekly_overlap_minutes_above_existing_ack_and_recovery_slo',
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentSloImpactConcentration(impactRanking = {}) {
    const ranking=Array.isArray(impactRanking?.ranking) ? impactRanking.ranking : [];
    const totalPairs=Math.max(0,Number(impactRanking?.summary?.pairs || ranking.length));
    const cumulativePct=(count)=>Math.round(ranking.slice(0,count).reduce((sum,row)=>sum+Number(row?.contributionPct || 0),0)*10)/10;
    const top1Pct=cumulativePct(1);
    const top3Pct=cumulativePct(3);
    const top5Pct=cumulativePct(5);
    const concentrationRows=ranking.slice(0,5).map((row,index)=>({
      rank:index+1,
      reason:String(row?.reason || ''),
      reasonLabel:String(row?.reasonLabel || row?.reason || ''),
      action:String(row?.action || ''),
      actionLabel:String(row?.actionLabel || row?.action || ''),
      contributionPct:Number(row?.contributionPct || 0),
      cumulativeContributionPct:cumulativePct(index+1),
      totalOverdueMinutes:Number(row?.totalOverdueMinutes || 0),
      activeEpisodes:Number(row?.activeEpisodes || 0),
    }));
    return {
      available:impactRanking?.available!==false,
      generatedAt:impactRanking?.generatedAt || null,
      summary:{
        pairs:totalPairs,
        totalOverdueMinutes:Number(impactRanking?.summary?.totalOverdueMinutes || 0),
        top1ContributionPct:top1Pct,
        top3ContributionPct:top3Pct,
        top5ContributionPct:top5Pct,
        residualAfterTop5Pct:Math.max(0,Math.round((100-top5Pct)*10)/10),
        coveredPairs:Math.min(5,totalPairs),
      },
      rows:concentrationRows,
      methodology:'cumulative_share_of_total_overdue_minutes',
      thresholds:{
        ackMinutes:Number(impactRanking?.thresholds?.ackMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES),
        criticalAckMinutes:Number(impactRanking?.thresholds?.criticalAckMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES),
        recoveryMinutes:Number(impactRanking?.thresholds?.recoveryMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES),
        source:'rc87_existing_slo',
      },
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend(episodeRows = [], {asOfMs = Date.now(), weeks = 4} = {}) {
    const safeWeeks=Math.max(2,Math.min(4,Number(weeks || 4)));
    const weekMs=7*86400_000;
    const weekly=[];
    const direction=(delta)=>delta>0 ? 'increased' : delta<0 ? 'decreased' : 'unchanged';
    for (let i=safeWeeks-1;i>=0;i-=1) {
      const windowEndMs=asOfMs-i*weekMs;
      const windowStartMs=windowEndMs-weekMs;
      const groups=new Map();
      for (const episode of episodeRows || []) {
        const burden=newsImpactRecoveryIncidentOverdueWithinWindow(episode,windowStartMs,windowEndMs);
        if (!burden || burden.totalOverdueMinutes<=0) continue;
        const key=String(episode.reason || '')+'|'+String(episode.action || '');
        const bucket=groups.get(key) || {
          reason:String(episode.reason || ''),
          reasonLabel:String(episode.reasonLabel || episode.reason || ''),
          action:String(episode.action || ''),
          actionLabel:String(episode.actionLabel || episode.action || ''),
          totalOverdueMinutes:0,
        };
        bucket.totalOverdueMinutes+=Number(burden.totalOverdueMinutes || 0);
        groups.set(key,bucket);
      }
      const all=[...groups.values()].sort((a,b)=>
        b.totalOverdueMinutes-a.totalOverdueMinutes
        || String(a.reason).localeCompare(String(b.reason))
        || String(a.action).localeCompare(String(b.action))
      );
      const totalOverdueMinutes=all.reduce((sum,row)=>sum+Number(row.totalOverdueMinutes || 0),0);
      const share=(count)=>totalOverdueMinutes>0
        ? Math.round((all.slice(0,count).reduce((sum,row)=>sum+Number(row.totalOverdueMinutes || 0),0)/totalOverdueMinutes)*1000)/10
        : 0;
      const top1ContributionPct=share(1);
      const top3ContributionPct=share(3);
      const top5ContributionPct=share(5);
      weekly.push({
        windowStart:new Date(windowStartMs).toISOString(),
        windowEnd:new Date(windowEndMs).toISOString(),
        pairs:all.length,
        totalOverdueMinutes,
        top1ContributionPct,
        top3ContributionPct,
        top5ContributionPct,
        residualAfterTop5Pct:Math.max(0,Math.round((100-top5ContributionPct)*10)/10),
        topPair:all[0] ? {
          reason:all[0].reason,
          reasonLabel:all[0].reasonLabel,
          action:all[0].action,
          actionLabel:all[0].actionLabel,
          totalOverdueMinutes:Number(all[0].totalOverdueMinutes || 0),
        } : null,
      });
    }
    const current=weekly[weekly.length-1] || {pairs:0,totalOverdueMinutes:0,top1ContributionPct:0,top3ContributionPct:0,top5ContributionPct:0};
    const previous=weekly[weekly.length-2] || current;
    const top1DeltaPctPoints=Math.round((Number(current.top1ContributionPct || 0)-Number(previous.top1ContributionPct || 0))*10)/10;
    const top3DeltaPctPoints=Math.round((Number(current.top3ContributionPct || 0)-Number(previous.top3ContributionPct || 0))*10)/10;
    const top5DeltaPctPoints=Math.round((Number(current.top5ContributionPct || 0)-Number(previous.top5ContributionPct || 0))*10)/10;
    return {
      available:true,
      weeks:safeWeeks,
      generatedAt:new Date(asOfMs).toISOString(),
      summary:{
        currentPairs:Number(current.pairs || 0),
        previousPairs:Number(previous.pairs || 0),
        pairDelta:Number(current.pairs || 0)-Number(previous.pairs || 0),
        currentOverdueMinutes:Number(current.totalOverdueMinutes || 0),
        previousOverdueMinutes:Number(previous.totalOverdueMinutes || 0),
        top1ContributionPct:Number(current.top1ContributionPct || 0),
        top3ContributionPct:Number(current.top3ContributionPct || 0),
        top5ContributionPct:Number(current.top5ContributionPct || 0),
        top1DeltaPctPoints,
        top3DeltaPctPoints,
        top5DeltaPctPoints,
        top1Direction:direction(top1DeltaPctPoints),
        top3Direction:direction(top3DeltaPctPoints),
        top5Direction:direction(top5DeltaPctPoints),
      },
      weekly,
      methodology:'weekly_cumulative_share_of_total_overdue_minutes',
      thresholds:{
        ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
        criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
        recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
        source:'rc87_existing_slo',
      },
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary(
    impactRanking = {},
    impactTrend = {},
    concentration = {},
    concentrationTrend = {},
  ) {
    const topPair=Array.isArray(impactRanking?.ranking) && impactRanking.ranking.length ? impactRanking.ranking[0] : null;
    const rankingSummary=impactRanking?.summary || {};
    const trendSummary=impactTrend?.summary || {};
    const concentrationSummary=concentration?.summary || {};
    const concentrationTrendSummary=concentrationTrend?.summary || {};
    const available=[impactRanking,impactTrend,concentration,concentrationTrend].every(x=>x?.available!==false);
    return {
      available,
      generatedAt:impactRanking?.generatedAt || impactTrend?.generatedAt || concentrationTrend?.generatedAt || concentration?.generatedAt || null,
      summary:{
        cumulativeOverdueMinutes:Number(rankingSummary.totalOverdueMinutes || 0),
        cumulativeAckOverdueMinutes:Number(rankingSummary.ackOverdueMinutes || 0),
        cumulativeRecoveryOverdueMinutes:Number(rankingSummary.recoveryOverdueMinutes || 0),
        breachPairs:Number(rankingSummary.pairs || 0),
        activePairs:Number(rankingSummary.activePairs || 0),
        breachEpisodes:Number(rankingSummary.breachEpisodes || 0),
        currentWeekOverdueMinutes:Number(trendSummary.currentOverdueMinutes || 0),
        previousWeekOverdueMinutes:Number(trendSummary.previousOverdueMinutes || 0),
        weekDeltaMinutes:Number(trendSummary.deltaMinutes || 0),
        weeklyIncreasedPairs:Number(trendSummary.increasedPairs || 0),
        weeklyDecreasedPairs:Number(trendSummary.decreasedPairs || 0),
        weeklyUnchangedPairs:Number(trendSummary.unchangedPairs || 0),
        top1ContributionPct:Number(concentrationSummary.top1ContributionPct || 0),
        top3ContributionPct:Number(concentrationSummary.top3ContributionPct || 0),
        top5ContributionPct:Number(concentrationSummary.top5ContributionPct || 0),
        top1WeeklyDeltaPctPoints:Number(concentrationTrendSummary.top1DeltaPctPoints || 0),
        top3WeeklyDeltaPctPoints:Number(concentrationTrendSummary.top3DeltaPctPoints || 0),
        top5WeeklyDeltaPctPoints:Number(concentrationTrendSummary.top5DeltaPctPoints || 0),
        top1WeeklyDirection:String(concentrationTrendSummary.top1Direction || 'unchanged'),
        top3WeeklyDirection:String(concentrationTrendSummary.top3Direction || 'unchanged'),
        top5WeeklyDirection:String(concentrationTrendSummary.top5Direction || 'unchanged'),
      },
      topPair:topPair ? {
        reason:String(topPair.reason || ''),
        reasonLabel:String(topPair.reasonLabel || topPair.reason || ''),
        action:String(topPair.action || ''),
        actionLabel:String(topPair.actionLabel || topPair.action || ''),
        totalOverdueMinutes:Number(topPair.totalOverdueMinutes || 0),
        contributionPct:Number(topPair.contributionPct || 0),
        activeEpisodes:Number(topPair.activeEpisodes || 0),
        ackOverdueMinutes:Number(topPair.ackOverdueMinutes || 0),
        recoveryOverdueMinutes:Number(topPair.recoveryOverdueMinutes || 0),
      } : null,
      sourceReleases:['RC93','RC94','RC95','RC96'],
      methodology:'summary_of_existing_slo_impact_views',
      thresholds:{
        ackMinutes:Number(impactRanking?.thresholds?.ackMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES),
        criticalAckMinutes:Number(impactRanking?.thresholds?.criticalAckMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES),
        recoveryMinutes:Number(impactRanking?.thresholds?.recoveryMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES),
        source:'rc87_existing_slo',
      },
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  
  function buildNewsImpactRecoveryIncidentSloImpactFocusQueue(
    impactRanking = {},
    impactTrend = {},
    executiveSummary = {},
    {limit = 5} = {},
  ) {
    const safeLimit=Math.max(1,Math.min(10,Number(limit || 5)));
    const ranking=Array.isArray(impactRanking?.ranking) ? impactRanking.ranking : [];
    const trendPairs=Array.isArray(impactTrend?.pairs) ? impactTrend.pairs : [];
    const trendByKey=new Map(trendPairs.map(row=>[
      String(row?.reason || '')+'|'+String(row?.action || ''),
      row,
    ]));
    const rows=ranking.map(row=>{
      const key=String(row?.reason || '')+'|'+String(row?.action || '');
      const trend=trendByKey.get(key) || {};
      return {
        reason:String(row?.reason || ''),
        reasonLabel:String(row?.reasonLabel || row?.reason || ''),
        action:String(row?.action || ''),
        actionLabel:String(row?.actionLabel || row?.action || ''),
        totalOverdueMinutes:Number(row?.totalOverdueMinutes || 0),
        contributionPct:Number(row?.contributionPct || 0),
        activeEpisodes:Number(row?.activeEpisodes || 0),
        ackOverdueMinutes:Number(row?.ackOverdueMinutes || 0),
        recoveryOverdueMinutes:Number(row?.recoveryOverdueMinutes || 0),
        currentWeekOverdueMinutes:Number(trend?.currentOverdueMinutes || 0),
        previousWeekOverdueMinutes:Number(trend?.previousOverdueMinutes || 0),
        weekDeltaMinutes:Number(trend?.deltaMinutes || 0),
        weekDirection:String(trend?.direction || 'unchanged'),
        currentContributionPct:Number(trend?.currentContributionPct || 0),
      };
    }).sort((a,b)=>
      b.currentWeekOverdueMinutes-a.currentWeekOverdueMinutes
      || b.weekDeltaMinutes-a.weekDeltaMinutes
      || b.totalOverdueMinutes-a.totalOverdueMinutes
      || String(a.reason).localeCompare(String(b.reason))
      || String(a.action).localeCompare(String(b.action))
    ).slice(0,safeLimit).map((row,index)=>({...row,queuePosition:index+1}));
  
    const summary=executiveSummary?.summary || {};
    return {
      available:[impactRanking,impactTrend,executiveSummary].every(x=>x?.available!==false),
      generatedAt:executiveSummary?.generatedAt || impactTrend?.generatedAt || impactRanking?.generatedAt || null,
      summary:{
        queuedPairs:rows.length,
        breachPairs:Number(summary.breachPairs || impactRanking?.summary?.pairs || 0),
        activePairs:Number(summary.activePairs || impactRanking?.summary?.activePairs || 0),
        currentWeekOverdueMinutes:Number(summary.currentWeekOverdueMinutes || impactTrend?.summary?.currentOverdueMinutes || 0),
        weekDeltaMinutes:Number(summary.weekDeltaMinutes || impactTrend?.summary?.deltaMinutes || 0),
        increasingQueuedPairs:rows.filter(x=>x.weekDirection==='increased').length,
        decreasingQueuedPairs:rows.filter(x=>x.weekDirection==='decreased').length,
        unchangedQueuedPairs:rows.filter(x=>x.weekDirection==='unchanged').length,
      },
      rows,
      ordering:'current_week_overdue_then_week_delta_then_cumulative_overdue',
      sourceReleases:['RC93','RC94','RC97'],
      thresholds:{
        ackMinutes:Number(impactRanking?.thresholds?.ackMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES),
        criticalAckMinutes:Number(impactRanking?.thresholds?.criticalAckMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES),
        recoveryMinutes:Number(impactRanking?.thresholds?.recoveryMinutes || NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES),
        source:'rc87_existing_slo',
      },
      privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
      routingChanged:false,
      persistence:'none',
    };
  }
  
  function buildNewsImpactRecoveryIncidentCenter(strategyRows = [], incidentEvents = [], acknowledgements = [], evidenceReason = 'ok', options = {}) {
    const priorityRank={critical:0,high:1,medium:2,low:3};
    const asOfMs=Number.isFinite(Number(options?.asOfMs)) ? Number(options.asOfMs) : Date.now();
    const current=new Map((strategyRows || []).map(row=>[`${row.reason}|${row.action}`,row]));
    const ackMap=new Map((acknowledgements || []).map(row=>[newsImpactRecoveryIncidentKey(row.reason,row.action,row.code),row]));
    const groups=new Map();
    for (const event of incidentEvents || []) {
      const key=newsImpactRecoveryIncidentKey(event.reason,event.action,event.guardReason);
      const bucket=groups.get(key) || {
        code:event.guardReason,
        priority:event.priority || (event.guardReason==='performance_drift' ? 'high' : 'medium'),
        reason:event.reason,
        reasonLabel:event.reasonLabel || event.reason,
        action:event.action,
        actionLabel:event.actionLabel || event.action,
        firstSeenAt:event.at,
        lastSeenAt:event.at,
        occurrences:0,
        lastStrategy:event.strategy || 'fixed',
        lastRecovery:event.recovery || '',
        lastRecoveryLabel:event.recoveryLabel || event.recovery || '',
        episodeStartedAt:event.episodeStartedAt || event.at,
        episodeLastSeenAt:event.episodeLastSeenAt || event.at,
        episodeRecoveredAt:event.episodeRecoveredAt || null,
        episodeOccurrences:Number(event.episodeOccurrences || 1),
      };
      bucket.occurrences+=1;
      if (Date.parse(event.at)<Date.parse(bucket.firstSeenAt)) bucket.firstSeenAt=event.at;
      if (Date.parse(event.at)>Date.parse(bucket.lastSeenAt)) {
        bucket.lastSeenAt=event.at;
        bucket.lastStrategy=event.strategy || bucket.lastStrategy;
        bucket.lastRecovery=event.recovery || bucket.lastRecovery;
        bucket.lastRecoveryLabel=event.recoveryLabel || bucket.lastRecoveryLabel;
        bucket.episodeStartedAt=event.episodeStartedAt || event.at;
        bucket.episodeLastSeenAt=event.episodeLastSeenAt || event.at;
        bucket.episodeRecoveredAt=event.episodeRecoveredAt || null;
        bucket.episodeOccurrences=Number(event.episodeOccurrences || 1);
      }
      groups.set(key,bucket);
    }
  
    const withAcknowledgement=(item,active,currentOnly=false)=>{
      const ack=ackMap.get(newsImpactRecoveryIncidentKey(item.reason,item.action,item.code)) || null;
      const acknowledged=Boolean(
        active
        && !currentOnly
        && item.lastSeenAt
        && ack
        && String(ack.incidentSeenAt || '')===String(item.lastSeenAt || '')
        && Date.parse(ack.acknowledgedAt)>=Date.parse(item.lastSeenAt),
      );
      const status=active ? 'active' : 'recovered';
      const startedAt=item.episodeStartedAt || item.firstSeenAt || null;
      const lastEpisodeSeenAt=item.episodeLastSeenAt || item.lastSeenAt || null;
      const recoveredAt=!active ? (item.episodeRecoveredAt || null) : null;
      const startedMs=Date.parse(String(startedAt || ''));
      const recoveredMs=Date.parse(String(recoveredAt || ''));
      const acknowledgedMs=Date.parse(String(acknowledged ? ack?.acknowledgedAt || '' : ''));
      const ageMinutes=active && Number.isFinite(startedMs)
        ? Math.max(0,Math.floor((asOfMs-startedMs)/60000))
        : null;
      const ackLatencyMinutes=acknowledged && Number.isFinite(startedMs) && Number.isFinite(acknowledgedMs)
        ? Math.max(0,Math.round((acknowledgedMs-startedMs)/60000))
        : null;
      const recoveryLatencyMinutes=!active && Number.isFinite(startedMs) && Number.isFinite(recoveredMs)
        ? Math.max(0,Math.round((recoveredMs-startedMs)/60000))
        : null;
      const ackStatus=currentOnly || !Number.isFinite(startedMs)
        ? 'unavailable'
        : acknowledged
          ? (Number(ackLatencyMinutes || 0)<=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES ? 'met' : 'breached')
          : active
            ? (Number(ageMinutes || 0)>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES ? 'breached' : 'pending')
            : 'unavailable';
      const recoveryStatus=currentOnly || !Number.isFinite(startedMs)
        ? 'unavailable'
        : active
          ? (Number(ageMinutes || 0)>=NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES ? 'breached' : 'pending')
          : Number.isFinite(recoveredMs)
            ? (Number(recoveryLatencyMinutes || 0)<=NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES ? 'met' : 'breached')
            : 'unavailable';
      let effectivePriority=item.priority || 'medium';
      let escalationReason='';
      if (active && recoveryStatus==='breached') {
        effectivePriority='critical';
        escalationReason='recovery_slo_breach';
      } else if (active && !acknowledged && Number(ageMinutes || 0)>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES) {
        effectivePriority='critical';
        escalationReason='ack_critical_overdue';
      } else if (active && !acknowledged && ackStatus==='breached') {
        effectivePriority=effectivePriority==='medium' ? 'high' : 'critical';
        escalationReason='ack_slo_breach';
      }
      return {
        ...item,
        status,
        acknowledged,
        acknowledgedAt:acknowledged ? ack.acknowledgedAt : null,
        alertSuppressed:acknowledged,
        canAcknowledge:Boolean(active && !currentOnly && item.lastSeenAt && NEWS_IMPACT_RECOVERY_INCIDENT_CODES.has(item.code)),
        runbook:newsImpactRecoveryIncidentRunbook(item.code),
        currentOnly:Boolean(currentOnly),
        effectivePriority,
        escalated:effectivePriority!==(item.priority || 'medium'),
        escalationReason,
        slo:{
          startedAt,
          lastSeenAt:lastEpisodeSeenAt,
          recoveredAt,
          ageMinutes,
          ackTargetMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
          ackCriticalMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
          recoveryTargetMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
          ackLatencyMinutes,
          recoveryLatencyMinutes,
          ackStatus,
          recoveryStatus,
        },
      };
    };
  
    const rows=[...groups.values()].map(item=>{
      const now=current.get(`${item.reason}|${item.action}`) || null;
      const active=Boolean(now && now.guardReason===item.code);
      return withAcknowledgement({
        ...item,
        currentStrategy:now?.strategy || '',
        currentRecovery:now?.selectedRecovery || '',
        currentRecoveryLabel:now?.selectedRecoveryLabel || now?.selectedRecovery || '',
        currentGuardReason:now?.guardReason || '',
      },active,false);
    });
  
    for (const now of strategyRows || []) {
      if (!NEWS_IMPACT_RECOVERY_INCIDENT_CODES.has(String(now.guardReason || ''))) continue;
      const exists=rows.some(x=>x.reason===now.reason && x.action===now.action && x.code===now.guardReason && x.status==='active');
      if (exists) continue;
      rows.push(withAcknowledgement({
        code:now.guardReason,
        priority:now.guardReason==='performance_drift' ? 'high' : 'medium',
        reason:now.reason,
        reasonLabel:now.reasonLabel || now.reason,
        action:now.action,
        actionLabel:now.actionLabel || now.action,
        firstSeenAt:null,
        lastSeenAt:null,
        occurrences:0,
        lastStrategy:now.strategy || 'fixed',
        lastRecovery:now.selectedRecovery || '',
        lastRecoveryLabel:now.selectedRecoveryLabel || now.selectedRecovery || '',
        currentStrategy:now.strategy || '',
        currentRecovery:now.selectedRecovery || '',
        currentRecoveryLabel:now.selectedRecoveryLabel || now.selectedRecovery || '',
        currentGuardReason:now.guardReason || '',
      },true,true));
    }
  
    if (String(evidenceReason || 'ok')!=='ok') {
      rows.unshift({
        code:'strategy_evidence_unavailable',
        priority:'medium',
        reason:'',
        reasonLabel:'Recovery Strategy',
        action:'',
        actionLabel:'',
        firstSeenAt:null,
        lastSeenAt:null,
        occurrences:0,
        lastStrategy:'fixed',
        lastRecovery:'',
        lastRecoveryLabel:'',
        status:'active',
        currentStrategy:'fixed',
        currentRecovery:'',
        currentRecoveryLabel:'',
        currentGuardReason:String(evidenceReason || 'evidence_unavailable'),
        currentOnly:true,
        acknowledged:false,
        acknowledgedAt:null,
        alertSuppressed:false,
        canAcknowledge:false,
        runbook:newsImpactRecoveryIncidentRunbook('strategy_evidence_unavailable'),
        effectivePriority:'medium',
        escalated:false,
        escalationReason:'',
        slo:{
          startedAt:null,lastSeenAt:null,recoveredAt:null,ageMinutes:null,
          ackTargetMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
          ackCriticalMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
          recoveryTargetMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
          ackLatencyMinutes:null,recoveryLatencyMinutes:null,ackStatus:'unavailable',recoveryStatus:'unavailable',
        },
      });
    }
  
    return rows.sort((a,b)=>(a.status==='active'?0:1)-(b.status==='active'?0:1)
      || (a.acknowledged?1:0)-(b.acknowledged?1:0)
      || (priorityRank[a.effectivePriority || a.priority] ?? 9)-(priorityRank[b.effectivePriority || b.priority] ?? 9)
      || (Date.parse(b.lastSeenAt || 0)-Date.parse(a.lastSeenAt || 0))
      || String(a.reason || '').localeCompare(String(b.reason || ''))
      || String(a.action || '').localeCompare(String(b.action || '')))
      .slice(0,30);
  }
  function summarizeNewsImpactRecoveryIncidents(rows = []) {
    const list=Array.isArray(rows) ? rows : [];
    const ackLatencies=list.map(x=>Number(x?.slo?.ackLatencyMinutes)).filter(Number.isFinite);
    const recoveryLatencies=list.map(x=>Number(x?.slo?.recoveryLatencyMinutes)).filter(Number.isFinite);
    return {
      total:list.length,
      active:list.filter(x=>x.status==='active').length,
      recovered:list.filter(x=>x.status==='recovered').length,
      highActive:list.filter(x=>x.status==='active' && x.priority==='high').length,
      mediumActive:list.filter(x=>x.status==='active' && x.priority==='medium').length,
      acknowledgedActive:list.filter(x=>x.status==='active' && x.acknowledged).length,
      unacknowledgedActive:list.filter(x=>x.status==='active' && !x.acknowledged).length,
      suppressedAlerts:list.filter(x=>x.status==='active' && x.alertSuppressed).length,
      escalatedActive:list.filter(x=>x.status==='active' && x.escalated).length,
      criticalActive:list.filter(x=>x.status==='active' && x.effectivePriority==='critical').length,
      ackSloBreached:list.filter(x=>x.status==='active' && x?.slo?.ackStatus==='breached').length,
      recoverySloBreached:list.filter(x=>x.status==='active' && x?.slo?.recoveryStatus==='breached').length,
      ackMeasured:ackLatencies.length,
      recoveryMeasured:recoveryLatencies.length,
      avgAckMinutes:ackLatencies.length ? Math.round((ackLatencies.reduce((a,b)=>a+b,0)/ackLatencies.length)*10)/10 : null,
      avgRecoveryMinutes:recoveryLatencies.length ? Math.round((recoveryLatencies.reduce((a,b)=>a+b,0)/recoveryLatencies.length)*10)/10 : null,
      latest:list.filter(x=>x.lastSeenAt).sort((a,b)=>Date.parse(b.lastSeenAt)-Date.parse(a.lastSeenAt))[0] || null,
    };
  }

  return Object.freeze({
    newsImpactRecoveryJourneyKey,
    buildNewsImpactRecoveryEffectiveness,
    newsImpactRecoveryBest,
    newsImpactRecoveryEffectivenessDrill,
    newsImpactRecoveryPresentation,
    buildNewsImpactRecoveryStrategyEvidence,
    newsImpactRecoveryStrategyDecision,
    buildNewsImpactRecoveryStrategyMatrix,
    newsImpactRecoveryDriftDecision,
    buildNewsImpactRecoveryDriftMatrix,
    buildNewsImpactRecoveryTransitionHistory,
    summarizeNewsImpactRecoveryTransitions,
    buildNewsImpactRecoveryAdminAlerts,
    summarizeNewsImpactRecoveryAlerts,
    buildNewsImpactRecoveryIncidentEvents,
    newsImpactRecoveryIncidentKey,
    newsImpactRecoveryIncidentRunbook,
    buildNewsImpactRecoveryIncidentAcknowledgements,
    buildNewsImpactRecoveryIncidentAcknowledgementHistory,
    buildNewsImpactRecoveryIncidentEpisodeHistory,
    newsImpactRecoveryEpisodeSloState,
    newsImpactRecoverySloPct,
    buildNewsImpactRecoveryIncidentSloDashboard,
    buildNewsImpactRecoveryIncidentSloBreachFeed,
    buildNewsImpactRecoveryIncidentSloBreachWatchlist,
    buildNewsImpactRecoveryIncidentSloBreachTriage,
    newsImpactRecoveryIncidentTriageStageAt,
    buildNewsImpactRecoveryIncidentSloBreachTriageTrend,
    newsImpactRecoveryIncidentSloBurden,
    buildNewsImpactRecoveryIncidentSloBreachImpactRanking,
    newsImpactRecoveryIncidentOverdueWithinWindow,
    buildNewsImpactRecoveryIncidentSloBreachImpactTrend,
    buildNewsImpactRecoveryIncidentSloImpactConcentration,
    buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend,
    buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary,
    buildNewsImpactRecoveryIncidentSloImpactFocusQueue,
    buildNewsImpactRecoveryIncidentCenter,
    summarizeNewsImpactRecoveryIncidents
  });
}
