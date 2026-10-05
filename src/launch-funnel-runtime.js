export function createLaunchFunnelRuntime(deps = {}) {
  const {
    NEWS_IMPACT_ACTION_WINDOW_MINUTES,
    NEWS_IMPACT_FAILURE_CODES,
    NEWS_IMPACT_FUNNEL_MIN_USERS,
    NEWS_IMPACT_FUNNEL_STABLE_USERS,
    NEWS_IMPACT_OUTCOME_WINDOW_MINUTES,
    NEWS_IMPACT_RECOVERY_DRIFT_DROP_PCT_POINTS,
    NEWS_IMPACT_RECOVERY_DRIFT_PRIOR_MIN_ATTEMPTS,
    NEWS_IMPACT_RECOVERY_DRIFT_RECENT_MIN_ATTEMPTS,
    NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
    NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
    NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
    NEWS_IMPACT_RECOVERY_SOURCE_WINDOW_MINUTES,
    NEWS_IMPACT_RECOVERY_STABILITY_MIN_ATTEMPTS,
    NEWS_IMPACT_RECOVERY_STABILITY_WINDOW_DAYS,
    NEWS_IMPACT_RECOVERY_STRATEGY_LOOKBACK_DAYS,
    NEWS_IMPACT_RECOVERY_STRATEGY_MIN_ATTEMPTS,
    NEWS_IMPACT_RECOVERY_STRATEGY_MIN_LIFT_PCT_POINTS,
    NEWS_IMPACT_RECOVERY_WINDOW_MINUTES,
    buildMediaCampaignPerformance,
    buildNewsImpactActionFunnel,
    buildNewsImpactActionOutcomeQuality,
    buildNewsImpactActionTrend,
    buildNewsImpactFailureDiagnostics,
    buildNewsImpactRecoveryAdminAlerts,
    buildNewsImpactRecoveryDriftMatrix,
    buildNewsImpactRecoveryEffectiveness,
    buildNewsImpactRecoveryIncidentCenter,
    buildNewsImpactRecoveryIncidentSloBreachFeed,
    buildNewsImpactRecoveryIncidentSloBreachImpactRanking,
    buildNewsImpactRecoveryIncidentSloBreachImpactTrend,
    buildNewsImpactRecoveryIncidentSloBreachTriage,
    buildNewsImpactRecoveryIncidentSloBreachTriageTrend,
    buildNewsImpactRecoveryIncidentSloBreachWatchlist,
    buildNewsImpactRecoveryIncidentSloDashboard,
    buildNewsImpactRecoveryIncidentSloImpactConcentration,
    buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend,
    buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary,
    buildNewsImpactRecoveryIncidentSloImpactFocusQueue,
    buildNewsImpactRecoveryStrategyMatrix,
    cleanLaunchPart,
    hasSupabase,
    json,
    loadNewsImpactRecoveryStrategyEvidence,
    newsImpactActionFunnelBottleneck,
    newsImpactOutcomeBottleneck,
    newsImpactRecoveryBest,
    redactOpsString,
    summarizeNewsImpactRecoveryAlerts,
    summarizeNewsImpactRecoveryIncidents,
    summarizeNewsImpactRecoveryTransitions,
    supaSelectPaged,
  } = deps;

  return async function apiLaunchFunnel(request,cfg) {
  const url=new URL(request.url);
  const days=Math.max(1,Math.min(30,Number(url.searchParams.get('days') || 7)));
  if (!hasSupabase(cfg)) return json({available:false,reason:'Supabase не настроен.',days});
  const analyticsNowMs=Date.now();
  const since=new Date(analyticsNowMs-days*86400_000).toISOString();
  const previousSince=new Date(analyticsNowMs-days*2*86400_000).toISOString();
  let rows=[];
  let comparisonRows=[];
  let previousWindowRows=[];
  let truncated=false;
  let trendTruncated=false;
  let trendAvailable=true;
  try {
    const page=await supaSelectPaged(cfg,'growth_events',{created_at:`gte.${since}`},{pageSize:1000,maxRows:10000,order:'created_at.asc'});
    rows=page.rows;
    truncated=Boolean(page.truncated);
  } catch (error) {
    return json({available:false,reason:'Нужна миграция v6.15 или временно недоступна база.',days,error:redactOpsString(error?.message || error,120)});
  }
  try {
    const comparisonPage=await supaSelectPaged(cfg,'growth_events',{created_at:`gte.${previousSince}`},{pageSize:1000,maxRows:10000,order:'created_at.asc'});
    comparisonRows=comparisonPage.rows || [];
    previousWindowRows=comparisonRows.filter(row=>{
      const createdAt=Date.parse(String(row?.created_at || ''));
      return Number.isFinite(createdAt) && createdAt<Date.parse(since);
    });
    trendTruncated=Boolean(comparisonPage.truncated);
  } catch {
    trendAvailable=false;
    comparisonRows=[];
    previousWindowRows=[];
  }
  const setFor=(names)=>new Set(rows.filter(x=>names.includes(String(x.event_name || ''))).map(x=>Number(x.telegram_id || 0)).filter(Boolean));
  const entry=new Set([...setFor(['bot_start']),...setFor(['miniapp_open'])]);
  const stages=[
    ['entry','Вход',entry],
    ['search','Поиск',setFor(['search'])],
    ['match_open','Карточка матча',setFor(['match_open'])],
    ['quick_ai','AI в Telegram',setFor(['quick_ai'])],
    ['full_ai','Полный AI-разбор',setFor(['full_ai'])],
  ];
  const base=Math.max(1,entry.size);
  const funnel=stages.map(([key,label,set],index)=>({
    key,label,users:set.size,
    fromEntryPct:entry.size ? Math.round((set.size/base)*1000)/10 : 0,
    fromPreviousPct:index===0 ? 100 : stages[index-1][2].size ? Math.round((set.size/stages[index-1][2].size)*1000)/10 : 0,
  }));
  const campaignMap=new Map();
  for (const row of rows) {
    const source=cleanLaunchPart(row.source || 'telegram',32) || 'telegram';
    const campaign=cleanLaunchPart(row.campaign || 'direct',40) || 'direct';
    const key=`${source}|${campaign}`;
    const bucket=campaignMap.get(key) || {source,campaign,users:new Set(),entry:new Set(),fullAi:new Set(),events:0};
    const uid=Number(row.telegram_id || 0);
    if (uid) bucket.users.add(uid);
    if (uid && ['bot_start','miniapp_open'].includes(String(row.event_name || ''))) bucket.entry.add(uid);
    if (uid && row.event_name==='full_ai') bucket.fullAi.add(uid);
    bucket.events+=1;
    campaignMap.set(key,bucket);
  }
  const recheckRows=rows.filter(x=>String(x.event_name || '')==='analysis_recheck');
  const recheckFree=recheckRows.filter(x=>Boolean(x?.metadata && typeof x.metadata==='object' ? x.metadata.free : false)).length;
  const recheckMaterial=recheckRows.filter(x=>Boolean(x?.metadata && typeof x.metadata==='object' ? x.metadata.material : false)).length;
  const recheckStable=recheckRows.filter(x=>Boolean(x?.metadata && typeof x.metadata==='object' ? x.metadata.stable : false)).length;
  const handoffUsers=setFor(['ai_handoff']);
  const fullAiUsers=setFor(['full_ai']);
  const handoffToFull=new Set([...handoffUsers].filter(uid=>fullAiUsers.has(uid)));
  const newsOpen=setFor(['news_open']);
  const newsAiIntent=setFor(['news_ai_intent']);
  const smartNewsAiRows=rows.filter(x=>String(x.event_name || '')==='news_ai_intent' && String(x?.metadata && typeof x.metadata==='object' ? x.metadata.linking || '' : '')==='smart_fixture');
  const smartNewsAiUsers=new Set(smartNewsAiRows.map(x=>Number(x.telegram_id || 0)).filter(Boolean));
  const newsReturn=setFor(['news_return']);
  const newsImpactRows=rows.filter(x=>String(x.event_name || '')==='news_impact_delta');
  const newsImpactCompared=new Set(newsImpactRows.filter(x=>Boolean(x?.metadata && typeof x.metadata==='object' ? x.metadata.compared : false)).map(x=>Number(x.telegram_id || 0)).filter(Boolean));
  const newsImpactMaterial=new Set(newsImpactRows.filter(x=>Boolean(x?.metadata && typeof x.metadata==='object' ? x.metadata.material : false)).map(x=>Number(x.telegram_id || 0)).filter(Boolean));
  const newsImpactDecision=(row)=>String(row?.metadata && typeof row.metadata==='object' ? row.metadata.decision || '' : '');
  const newsImpactDecisionSummary={
    total:newsImpactRows.length,
    material:newsImpactRows.filter(x=>newsImpactDecision(x)==='material').length,
    detail:newsImpactRows.filter(x=>newsImpactDecision(x)==='detail').length,
    stable:newsImpactRows.filter(x=>newsImpactDecision(x)==='stable').length,
    guarded:newsImpactRows.filter(x=>['guarded','baseline_missing'].includes(newsImpactDecision(x))).length,
    unavailable:newsImpactRows.filter(x=>newsImpactDecision(x)==='unavailable').length,
  };
  const newsImpactActionRows=rows.filter(x=>String(x.event_name || '')==='news_impact_action');
  const newsImpactAction=(row)=>String(row?.metadata && typeof row.metadata==='object' ? row.metadata.action || '' : '');
  const newsImpactActionSummary={
    total:newsImpactActionRows.length,
    users:new Set(newsImpactActionRows.map(x=>Number(x.telegram_id || 0)).filter(Boolean)).size,
    fullAi:newsImpactActionRows.filter(x=>newsImpactAction(x)==='full_ai').length,
    squads:newsImpactActionRows.filter(x=>newsImpactAction(x)==='squads').length,
    market:newsImpactActionRows.filter(x=>newsImpactAction(x)==='market').length,
    recheck:newsImpactActionRows.filter(x=>newsImpactAction(x)==='recheck').length,
    news:newsImpactActionRows.filter(x=>newsImpactAction(x)==='news').length,
    share:newsImpactActionRows.filter(x=>newsImpactAction(x)==='share').length,
  };
  const newsImpactOutcomeRows=rows.filter(x=>String(x.event_name || '')==='news_impact_outcome');
  const newsImpactActionOutcomeQuality=buildNewsImpactActionOutcomeQuality(newsImpactActionRows,newsImpactOutcomeRows,{asOfMs:analyticsNowMs});
  const newsImpactOutcomeBottleneck=newsImpactOutcomeBottleneck(newsImpactActionOutcomeQuality);
  const newsImpactOutcomeSummary=newsImpactActionOutcomeQuality.reduce((acc,row)=>{
    acc.observed+=Number(row.observed || 0);
    acc.attempts+=Number(row.attempts || 0);
    acc.pending+=Number(row.pending || 0);
    acc.confirmed+=Number(row.confirmed || 0);
    return acc;
  },{observed:0,attempts:0,pending:0,confirmed:0,completionPct:0});
  newsImpactOutcomeSummary.completionPct=newsImpactOutcomeSummary.attempts
    ? Math.round((newsImpactOutcomeSummary.confirmed/newsImpactOutcomeSummary.attempts)*1000)/10
    : 0;
  const newsImpactOutcomeGuard={outcomeWindowMinutes:NEWS_IMPACT_OUTCOME_WINDOW_MINUTES,minimumSample:NEWS_IMPACT_FUNNEL_MIN_USERS,meaning:'confirmed_delivery_not_satisfaction'};
  const newsImpactFailureRows=rows.filter(x=>String(x.event_name || '')==='news_impact_outcome_failure');
  const newsImpactFailureDiagnostics=buildNewsImpactFailureDiagnostics(newsImpactFailureRows);
  const newsImpactFailureSummary={
    total:newsImpactFailureRows.length,
    users:new Set(newsImpactFailureRows.map(x=>Number(x.telegram_id || 0)).filter(Boolean)).size,
    topReason:newsImpactFailureDiagnostics[0] || null,
  };
  const newsImpactFailureGuard={rawErrorsStored:false,meaning:'delivery_failure_not_user_dissatisfaction',taxonomy:[...NEWS_IMPACT_FAILURE_CODES]};
  const newsImpactRecoveryAttemptRows=rows.filter(x=>String(x.event_name || '')==='news_impact_recovery_attempt');
  const newsImpactRecoveryEffectiveness=buildNewsImpactRecoveryEffectiveness(newsImpactRecoveryAttemptRows,newsImpactOutcomeRows,newsImpactFailureRows,{asOfMs:analyticsNowMs});
  const newsImpactRecoveryBestStrategy=newsImpactRecoveryBest(newsImpactRecoveryEffectiveness);
  const newsImpactRecoverySummary=newsImpactRecoveryEffectiveness.reduce((acc,row)=>{
    acc.observed+=Number(row.observed || 0);
    acc.attempts+=Number(row.attempts || 0);
    acc.pending+=Number(row.pending || 0);
    acc.recovered+=Number(row.recovered || 0);
    acc.failed+=Number(row.failed || 0);
    return acc;
  },{observed:0,attempts:0,pending:0,recovered:0,failed:0,successPct:0});
  newsImpactRecoverySummary.successPct=newsImpactRecoverySummary.attempts
    ? Math.round((newsImpactRecoverySummary.recovered/newsImpactRecoverySummary.attempts)*1000)/10
    : 0;
  const newsImpactRecoveryGuard={windowMinutes:NEWS_IMPACT_RECOVERY_WINDOW_MINUTES,minimumSample:NEWS_IMPACT_FUNNEL_MIN_USERS,latestAttemptPerJourney:true,meaning:'confirmed_delivery_after_real_recovery_attempt'};
  const newsImpactRecoveryStrategyLoaded=await loadNewsImpactRecoveryStrategyEvidence(cfg);
  const newsImpactRecoveryStrategyEvidence=newsImpactRecoveryStrategyLoaded.available ? newsImpactRecoveryStrategyLoaded.evidence : [];
  const newsImpactRecoveryStrategyRecentEvidence=newsImpactRecoveryStrategyLoaded.available ? newsImpactRecoveryStrategyLoaded.recentEvidence : [];
  const newsImpactRecoveryStrategyPriorEvidence=newsImpactRecoveryStrategyLoaded.available ? newsImpactRecoveryStrategyLoaded.priorEvidence : [];
  const newsImpactRecoveryStrategyBaseMatrix=newsImpactRecoveryStrategyLoaded.available
    ? buildNewsImpactRecoveryStrategyMatrix(newsImpactRecoveryStrategyEvidence,newsImpactRecoveryStrategyRecentEvidence)
    : [];
  const newsImpactRecoveryStrategyMatrix=buildNewsImpactRecoveryDriftMatrix(newsImpactRecoveryStrategyBaseMatrix,newsImpactRecoveryStrategyPriorEvidence,newsImpactRecoveryStrategyRecentEvidence);
  const newsImpactRecoveryTransitionHistory=newsImpactRecoveryStrategyLoaded.available
    ? (newsImpactRecoveryStrategyLoaded.transitionHistory || [])
    : [];
  const newsImpactRecoveryTransitionSummary=summarizeNewsImpactRecoveryTransitions(newsImpactRecoveryTransitionHistory);
  const newsImpactRecoveryIncidentEvents=newsImpactRecoveryStrategyLoaded.available
    ? (newsImpactRecoveryStrategyLoaded.incidentEvents || [])
    : [];
  const newsImpactRecoveryIncidentAcknowledgements=newsImpactRecoveryStrategyLoaded.available
    ? (newsImpactRecoveryStrategyLoaded.incidentAcknowledgements || [])
    : [];
  const newsImpactRecoveryIncidents=buildNewsImpactRecoveryIncidentCenter(
    newsImpactRecoveryStrategyMatrix,
    newsImpactRecoveryIncidentEvents,
    newsImpactRecoveryIncidentAcknowledgements,
    newsImpactRecoveryStrategyLoaded.reason,
    {asOfMs:analyticsNowMs},
  );
  const newsImpactRecoveryIncidentSummary=summarizeNewsImpactRecoveryIncidents(newsImpactRecoveryIncidents);
  const newsImpactRecoveryIncidentSloDashboard=newsImpactRecoveryStrategyLoaded.available
    ? buildNewsImpactRecoveryIncidentSloDashboard(
        newsImpactRecoveryStrategyLoaded.incidentEpisodeHistory || [],
        {asOfMs:analyticsNowMs,weeks:4},
      )
    : {
        available:false,
        reason:String(newsImpactRecoveryStrategyLoaded.reason || 'evidence_unavailable'),
        windowDays:28,
        weeks:4,
        generatedAt:new Date(analyticsNowMs).toISOString(),
        summary:{episodes:0,recurringPairs:0,ackSloPct:null,recoverySloPct:null},
        weekly:[],
        repeated:[],
        privacy:{telegramIdsExposed:false,rawErrorsExposed:false},
      };
  const newsImpactRecoveryIncidentSloBreachFeed=newsImpactRecoveryStrategyLoaded.available
    ? buildNewsImpactRecoveryIncidentSloBreachFeed(
        newsImpactRecoveryStrategyLoaded.incidentEpisodeHistory || [],
        {asOfMs:analyticsNowMs,limit:20},
      )
    : {
        available:false,
        reason:String(newsImpactRecoveryStrategyLoaded.reason || 'evidence_unavailable'),
        generatedAt:new Date(analyticsNowMs).toISOString(),
        summary:{breachEpisodes:0,activeBreaches:0,critical:0,ackBreaches:0,recoveryBreaches:0,repeatedPairs:0},
        items:[],
        repeated:[],
        privacy:{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false},
        routingChanged:false,
      };
  const newsImpactRecoveryIncidentSloBreachWatchlist=buildNewsImpactRecoveryIncidentSloBreachWatchlist(
    newsImpactRecoveryIncidentSloBreachFeed,
    {limit:10},
  );
  const newsImpactRecoveryIncidentSloBreachTriage=buildNewsImpactRecoveryIncidentSloBreachTriage(
    newsImpactRecoveryIncidentSloBreachWatchlist,
    {limit:10},
  );
  const newsImpactRecoveryIncidentSloBreachTriageTrend=newsImpactRecoveryStrategyLoaded.available
    ? buildNewsImpactRecoveryIncidentSloBreachTriageTrend(
        newsImpactRecoveryStrategyLoaded.incidentEpisodeHistory || [],
        {asOfMs:analyticsNowMs,weeks:4},
      )
    : {
        available:false,
        reason:String(newsImpactRecoveryStrategyLoaded.reason || 'evidence_unavailable'),
        weeks:4,
        generatedAt:new Date(analyticsNowMs).toISOString(),
        summary:{currentTotal:0,totalDelta:0,recoveryOverdueDelta:0,ackCriticalDelta:0,ackOverdueDelta:0,stuckPairs:0},
        weekly:[],
        stuck:[],
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
  const newsImpactRecoveryIncidentSloBreachImpactRanking=newsImpactRecoveryStrategyLoaded.available
    ? buildNewsImpactRecoveryIncidentSloBreachImpactRanking(
        newsImpactRecoveryStrategyLoaded.incidentEpisodeHistory || [],
        {asOfMs:analyticsNowMs,limit:10},
      )
    : {
        available:false,
        reason:String(newsImpactRecoveryStrategyLoaded.reason || 'evidence_unavailable'),
        generatedAt:new Date(analyticsNowMs).toISOString(),
        summary:{pairs:0,activePairs:0,breachEpisodes:0,totalOverdueMinutes:0,ackOverdueMinutes:0,recoveryOverdueMinutes:0,topContributionPct:0},
        ranking:[],
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
  const newsImpactRecoveryIncidentSloBreachImpactTrend=newsImpactRecoveryStrategyLoaded.available
    ? buildNewsImpactRecoveryIncidentSloBreachImpactTrend(
        newsImpactRecoveryStrategyLoaded.incidentEpisodeHistory || [],
        {asOfMs:analyticsNowMs,weeks:4,limit:10},
      )
    : {
        available:false,
        reason:String(newsImpactRecoveryStrategyLoaded.reason || 'evidence_unavailable'),
        weeks:4,
        generatedAt:new Date(analyticsNowMs).toISOString(),
        summary:{currentOverdueMinutes:0,previousOverdueMinutes:0,deltaMinutes:0,increasedPairs:0,decreasedPairs:0,unchangedPairs:0},
        weekly:[],
        pairs:[],
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
  const newsImpactRecoveryIncidentSloImpactConcentration=buildNewsImpactRecoveryIncidentSloImpactConcentration(
    newsImpactRecoveryIncidentSloBreachImpactRanking,
  );
  const newsImpactRecoveryIncidentSloImpactConcentrationTrend=newsImpactRecoveryStrategyLoaded.available
    ? buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend(
        newsImpactRecoveryStrategyLoaded.incidentEpisodeHistory || [],
        {asOfMs:analyticsNowMs,weeks:4},
      )
    : {
        available:false,
        reason:String(newsImpactRecoveryStrategyLoaded.reason || 'evidence_unavailable'),
        weeks:4,
        generatedAt:new Date(analyticsNowMs).toISOString(),
        summary:{
          currentPairs:0,previousPairs:0,pairDelta:0,currentOverdueMinutes:0,previousOverdueMinutes:0,
          top1ContributionPct:0,top3ContributionPct:0,top5ContributionPct:0,
          top1DeltaPctPoints:0,top3DeltaPctPoints:0,top5DeltaPctPoints:0,
          top1Direction:'unchanged',top3Direction:'unchanged',top5Direction:'unchanged',
        },
        weekly:[],
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
  const newsImpactRecoveryIncidentSloImpactExecutiveSummary=buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary(
    newsImpactRecoveryIncidentSloBreachImpactRanking,
    newsImpactRecoveryIncidentSloBreachImpactTrend,
    newsImpactRecoveryIncidentSloImpactConcentration,
    newsImpactRecoveryIncidentSloImpactConcentrationTrend,
  );
  const newsImpactRecoveryIncidentSloImpactFocusQueue=buildNewsImpactRecoveryIncidentSloImpactFocusQueue(
    newsImpactRecoveryIncidentSloBreachImpactRanking,
    newsImpactRecoveryIncidentSloBreachImpactTrend,
    newsImpactRecoveryIncidentSloImpactExecutiveSummary,
    {limit:5},
  );
  const newsImpactRecoveryIncidentSloGuard={
    ackTargetMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES,
    ackCriticalMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES,
    recoveryTargetMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES,
    escalation:'derived_from_incident_age_and_ack_state',
    persistence:'none',
  };
  const newsImpactRecoveryStrategyAlerts=buildNewsImpactRecoveryAdminAlerts(
    newsImpactRecoveryStrategyMatrix,
    newsImpactRecoveryStrategyLoaded.reason,
    newsImpactRecoveryIncidents,
  );
  const newsImpactRecoveryAlertSummary=summarizeNewsImpactRecoveryAlerts(newsImpactRecoveryStrategyAlerts);
  const newsImpactRecoveryStrategySummary={
    available:Boolean(newsImpactRecoveryStrategyLoaded.available),
    evidenceReason:String(newsImpactRecoveryStrategyLoaded.reason || 'unknown'),
    rules:newsImpactRecoveryStrategyMatrix.length,
    adaptive:newsImpactRecoveryStrategyMatrix.filter(x=>x.strategy==='adaptive').length,
    fixed:newsImpactRecoveryStrategyMatrix.filter(x=>x.strategy==='fixed').length,
    stabilityBlocked:newsImpactRecoveryStrategyMatrix.filter(x=>['stability_sample','recent_regression'].includes(x.guardReason)).length,
    driftBlocked:newsImpactRecoveryStrategyMatrix.filter(x=>x.guardReason==='performance_drift').length,
    adaptiveUsed:newsImpactFailureRows.filter(x=>String(x?.metadata?.strategy || '')==='adaptive').length,
    fixedUsed:newsImpactFailureRows.filter(x=>String(x?.metadata?.strategy || 'fixed')!=='adaptive').length,
  };
  const newsImpactRecoveryStrategyGuard={
    minAttempts:NEWS_IMPACT_RECOVERY_STRATEGY_MIN_ATTEMPTS,
    minLiftPctPoints:NEWS_IMPACT_RECOVERY_STRATEGY_MIN_LIFT_PCT_POINTS,
    lookbackDays:NEWS_IMPACT_RECOVERY_STRATEGY_LOOKBACK_DAYS,
    stabilityWindowDays:NEWS_IMPACT_RECOVERY_STABILITY_WINDOW_DAYS,
    stabilityMinAttempts:NEWS_IMPACT_RECOVERY_STABILITY_MIN_ATTEMPTS,
    sourceWindowMinutes:NEWS_IMPACT_RECOVERY_SOURCE_WINDOW_MINUTES,
    interval:'non_overlapping_wilson_95',
    recentRule:'candidate_not_worse',
    driftPriorMinAttempts:NEWS_IMPACT_RECOVERY_DRIFT_PRIOR_MIN_ATTEMPTS,
    driftRecentMinAttempts:NEWS_IMPACT_RECOVERY_DRIFT_RECENT_MIN_ATTEMPTS,
    driftDropPctPoints:NEWS_IMPACT_RECOVERY_DRIFT_DROP_PCT_POINTS,
    driftRule:'recent_upper_below_prior_lower_wilson_95',
    evidenceSource:'shared_runtime_loader',
    fallback:'fixed',
  };
  const newsImpactActionFunnel=buildNewsImpactActionFunnel(newsImpactRows,newsImpactActionRows,{asOfMs:analyticsNowMs});
  const newsImpactActionBottleneck=newsImpactActionFunnelBottleneck(newsImpactActionFunnel);
  const newsImpactActionConfidenceGuard={minUsers:NEWS_IMPACT_FUNNEL_MIN_USERS,stableUsers:NEWS_IMPACT_FUNNEL_STABLE_USERS,interval:'wilson_95'};
  const newsImpactActionAttributionGuard={actionWindowMinutes:NEWS_IMPACT_ACTION_WINDOW_MINUTES,maturationMinutes:NEWS_IMPACT_ACTION_WINDOW_MINUTES,requiresActionAfterDecision:true,allowsBoundaryFollowup:true};
  const previousNewsImpactRows=previousWindowRows.filter(x=>String(x.event_name || '')==='news_impact_delta');
  const previousNewsImpactActionRows=comparisonRows.filter(x=>String(x.event_name || '')==='news_impact_action');
  const previousNewsImpactActionFunnel=buildNewsImpactActionFunnel(previousNewsImpactRows,previousNewsImpactActionRows,{asOfMs:analyticsNowMs});
  const newsImpactActionTrend=trendAvailable ? buildNewsImpactActionTrend(newsImpactActionFunnel,previousNewsImpactActionFunnel) : [];
  const newsImpactActionTrendGuard={comparisonDays:days,requiresBothPeriods:true,signalRule:'non_overlapping_wilson_95'};
  const shareRows=rows.filter(x=>['share_created','share_link_created','share_card_created'].includes(String(x.event_name || '')));
  const deepLinkRows=rows.filter(x=>String(x.event_name || '')==='fixture_deep_link_open');
  const deepLinkUsers=new Set(deepLinkRows.map(x=>Number(x.telegram_id || 0)).filter(Boolean));
  const deepLinkAiRows=rows.filter(x=>String(x.event_name || '')==='quick_ai' && String(x?.metadata && typeof x.metadata==='object' ? x.metadata.source || '' : '')==='deep_link');
  const deepLinkAiUsers=new Set(deepLinkAiRows.map(x=>Number(x.telegram_id || 0)).filter(Boolean));
  const shareUsers=new Set(shareRows.map(x=>Number(x.telegram_id || 0)).filter(Boolean));
  const searchResultRows=rows.filter(x=>String(x.event_name || '')==='search_result');
  const searchOutcome=(row)=>String(row?.metadata && typeof row.metadata==='object' ? row.metadata.outcome || '' : '');
  const searchMatches=searchResultRows.filter(x=>searchOutcome(x)==='match').length;
  const searchRecognizedNoMatch=searchResultRows.filter(x=>searchOutcome(x)==='recognized_no_match').length;
  const searchNotFound=searchResultRows.filter(x=>searchOutcome(x)==='not_found').length;
  const searchRecoveredRecent=searchResultRows.filter(x=>searchOutcome(x)==='match' && String(x?.metadata && typeof x.metadata==='object' ? x.metadata.recovery || '' : '')==='recent').length;
  const transitions=funnel.slice(1).map((stage,index)=>({
    from:funnel[index]?.key || '',to:stage.key,label:`${funnel[index]?.label || ''} → ${stage.label || ''}`,
    fromUsers:Number(funnel[index]?.users || 0),toUsers:Number(stage.users || 0),conversionPct:Number(stage.fromPreviousPct || 0),
    dropPct:Math.max(0,Math.round((100-Number(stage.fromPreviousPct || 0))*10)/10),
  }));
  const bottleneck=[...transitions].filter(x=>x.fromUsers>0).sort((a,b)=>b.dropPct-a.dropPct)[0] || null;
  const campaigns=[...campaignMap.values()].map(x=>({
    source:x.source,campaign:x.campaign,users:x.users.size,entries:x.entry.size,fullAi:x.fullAi.size,events:x.events,
    conversionPct:x.entry.size ? Math.round((x.fullAi.size/x.entry.size)*1000)/10 : 0,
  })).sort((a,b)=>b.entries-a.entries || b.fullAi-a.fullAi).slice(0,20);
  const mediaCampaigns=buildMediaCampaignPerformance(rows);
  const mediaSummary=mediaCampaigns.reduce((acc,x)=>{
    acc.linksCreated+=Number(x.linksCreated || 0);
    acc.entries+=Number(x.entries || 0);
    acc.deepLinkOpens+=Number(x.deepLinkOpens || 0);
    acc.quickAi+=Number(x.quickAi || 0);
    acc.fullAi+=Number(x.fullAi || 0);
    return acc;
  },{materials:mediaCampaigns.length,linksCreated:0,entries:0,deepLinkOpens:0,quickAi:0,fullAi:0,conversionPct:0});
  mediaSummary.conversionPct=mediaSummary.entries ? Math.round((mediaSummary.fullAi/mediaSummary.entries)*1000)/10 : 0;
  return json({
    available:true,
    days,
    generatedAt:new Date().toISOString(),
    retentionDays:Number(cfg.growthRetentionDays || 90),
    events:rows.length,
    truncated,
    uniqueUsers:new Set(rows.map(x=>Number(x.telegram_id || 0)).filter(Boolean)).size,
    funnel,
    bottleneck,
    handoff:{users:handoffUsers.size,fullAiUsers:handoffToFull.size,conversionPct:handoffUsers.size?Math.round((handoffToFull.size/handoffUsers.size)*1000)/10:0},
    rechecks:{total:recheckRows.length,free:recheckFree,charged:Math.max(0,recheckRows.length-recheckFree),material:recheckMaterial,stable:recheckStable},
    returnLoop:{newsOpen:newsOpen.size,newsReturn:newsReturn.size,aiIntent:newsAiIntent.size,smartFixtureIntent:smartNewsAiUsers.size,impactChecks:newsImpactRows.length,impactCompared:newsImpactCompared.size,impactMaterial:newsImpactMaterial.size,intentPct:newsOpen.size?Math.round((newsAiIntent.size/newsOpen.size)*1000)/10:0,conversionPct:newsOpen.size?Math.round((newsReturn.size/newsOpen.size)*1000)/10:0},
    newsImpactDecisionSummary,
    newsImpactActionSummary,
    newsImpactOutcomeSummary,
    newsImpactActionOutcomeQuality,
    newsImpactOutcomeBottleneck,
    newsImpactOutcomeGuard,
    newsImpactFailureSummary,
    newsImpactFailureDiagnostics,
    newsImpactFailureGuard,
    newsImpactRecoverySummary,
    newsImpactRecoveryEffectiveness,
    newsImpactRecoveryBestStrategy,
    newsImpactRecoveryGuard,
    newsImpactRecoveryStrategySummary,
    newsImpactRecoveryStrategyMatrix,
    newsImpactRecoveryStrategyGuard,
    newsImpactRecoveryTransitionHistory,
    newsImpactRecoveryTransitionSummary,
    newsImpactRecoveryStrategyAlerts,
    newsImpactRecoveryAlertSummary,
    newsImpactRecoveryIncidents,
    newsImpactRecoveryIncidentSummary,
    newsImpactRecoveryIncidentSloGuard,
    newsImpactRecoveryIncidentSloDashboard,
    newsImpactRecoveryIncidentSloBreachFeed,
    newsImpactRecoveryIncidentSloBreachWatchlist,
    newsImpactRecoveryIncidentSloBreachTriage,
    newsImpactRecoveryIncidentSloBreachTriageTrend,
    newsImpactRecoveryIncidentSloBreachImpactRanking,
    newsImpactRecoveryIncidentSloBreachImpactTrend,
    newsImpactRecoveryIncidentSloImpactConcentration,
    newsImpactRecoveryIncidentSloImpactConcentrationTrend,
    newsImpactRecoveryIncidentSloImpactExecutiveSummary,
    newsImpactRecoveryIncidentSloImpactFocusQueue,
    newsImpactActionFunnel,
    newsImpactActionBottleneck,
    newsImpactActionConfidenceGuard,
    newsImpactActionAttributionGuard,
    newsImpactActionTrend,
    newsImpactActionTrendGuard,
    trendAvailable,
    trendTruncated,
    mediaLoop:{shareEvents:shareRows.length,shareUsers:shareUsers.size,deepLinkOpens:deepLinkRows.length,deepLinkUsers:deepLinkUsers.size,aiUsers:deepLinkAiUsers.size,conversionPct:deepLinkUsers.size?Math.round((deepLinkAiUsers.size/deepLinkUsers.size)*1000)/10:0},
    searchQuality:{attempts:searchResultRows.length,match:searchMatches,recognizedNoMatch:searchRecognizedNoMatch,notFound:searchNotFound,recoveredRecent:searchRecoveredRecent,matchPct:searchResultRows.length?Math.round((searchMatches/searchResultRows.length)*1000)/10:0},
    campaigns,
    mediaCampaigns,
    mediaSummary,
    privacy:'Ответ содержит только агрегаты; Telegram ID и текст поисковых запросов пользователей не возвращаются.',
  });
};
}
