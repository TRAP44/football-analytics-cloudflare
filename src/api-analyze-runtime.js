export function createApiAnalyzeRuntime(deps = {}) {
  const {
    CALIBRATION_PROFILE_VERSION,
    MODEL_BASE_WEIGHTS,
    analysisFreshness,
    analysisProviderFetch,
    analysisRecheckDelta,
    analysisResponsePayload,
    annotateAvailabilityReliability,
    annotateLineupReliability,
    annotateOddsReliability,
    applyAbsenceAdjustment,
    applyFeatureFreshnessMap,
    assessFixtureAvailabilityQuality,
    assessMatchLineups,
    assessOddsMarketQuality,
    baselineCalibrationProfile,
    blendProbabilitySignals,
    buildAiInstructor,
    buildAnalysisNotes,
    buildLineupImpact,
    buildMatchComparison,
    buildOddsMovement,
    buildPreMatchIntelligence,
    bumpTelemetry,
    cachedTeamIntelligenceForAnalysis,
    cachedTeamStanding,
    captureAnalysisTimelineSnapshot,
    captureModelPrediction,
    claimDistributedAnalysisLock,
    cleanNewsImpactActionCode,
    cleanNewsImpactDecisionCode,
    cleanNewsImpactRecoveryCode,
    confidenceModel,
    enrichFixtureAbsencesWithSeasonRole,
    extractMarket,
    extractPrediction,
    finalizeAnalysisUsageReservation,
    formProbabilities,
    formatAbsences,
    formatH2H,
    formatLineups,
    freeQuotaHealthy,
    getCache,
    getCalibrationProfile,
    getOddsSnapshots,
    getQuota,
    getRecentTeamForm,
    getStaleCache,
    h2hProbabilities,
    hasSupabase,
    hydratePlayerRolesForAnalysis,
    isFinishedStatus,
    isFootballRateLimitError,
    isLiveStatus,
    isYouthReserveMatch,
    json,
    loadProviderFixture,
    loadRefereeHistoryProfile,
    memory,
    newsImpactDeltaStatus,
    newsImpactFailureCode,
    newsPublishedMs,
    oddsMarketForTrustedAnalytics,
    outcomeName,
    poissonGoalModel,
    providerDataReliabilitySummary,
    publicDataCapabilities,
    recordGrowthEvent,
    recordHistory,
    recordNewsImpactFailure,
    recordNewsImpactOutcome,
    recordNewsImpactRecoveryAttempt,
    recordOpsEvent,
    redactOpsString,
    refereeProfile,
    refundAnalysisQuota,
    refundEntitlementUsage,
    releaseDistributedAnalysisLock,
    reserveAnalysisQuota,
    reserveEntitlementUsage,
    resolveUserEntitlements,
    sanitizeAvailabilityRows,
    saveOddsSnapshot,
    secondaryOddsMarket,
    selectNewsImpactRecoveryStrategy,
    setCache,
    settlePredictionsFromFixtures,
    tavilySearch,
    temperatureScaleProbabilities,
    usableOddsFeatureMeta,
    userHasAnalyzedFixture,
    validateFixtureIntegrity,
    waitForSharedAnalysis,
  } = deps;

  return async function apiAnalyze(request, cfg, user) {
  let body = {};
  try { body = await request.json(); } catch {}
  const fixtureId = Number(body?.fixtureId);
  const analysisOrigin=String(body?.origin || 'miniapp').slice(0,30);
  const recheckRequested=Boolean(body?.recheck);
  const newsImpactRecheck=Boolean(body?.newsImpactRecheck);
  const newsPublishedAt=Number.isFinite(Date.parse(String(body?.newsPublishedAt || ''))) ? new Date(Date.parse(String(body.newsPublishedAt))).toISOString() : '';
  const newsImpactDecision=cleanNewsImpactDecisionCode(body?.newsImpactDecision);
  const newsImpactAction=cleanNewsImpactActionCode(body?.newsImpactAction);
  const newsImpactRecoveryCode=cleanNewsImpactRecoveryCode(body?.newsImpactRecoveryCode);
  const newsImpactRecoveryFrom=cleanNewsImpactActionCode(body?.newsImpactRecoveryFrom);
  const trackFullAi=analysisOrigin !== 'telegram_quick';
  const recordTrackedFullAiOutcome=async (delivery='analysis')=>{
    if (trackFullAi && newsImpactDecision && newsImpactAction==='full_ai') {
      await recordNewsImpactOutcome(cfg,{userId:user.id,fixtureId,decision:newsImpactDecision,action:'full_ai',channel:'miniapp',delivery});
    }
  };
  if (trackFullAi && newsImpactDecision && newsImpactAction==='full_ai') {
    if (newsImpactRecoveryCode) {
      await recordNewsImpactRecoveryAttempt(cfg,{userId:user.id,fixtureId,decision:newsImpactDecision,action:'full_ai',recovery:newsImpactRecoveryCode,sourceAction:newsImpactRecoveryFrom,channel:'miniapp'});
    }
    void recordGrowthEvent(cfg,{userId:user.id,eventName:'news_impact_action',channel:'miniapp',fixtureId,metadata:{decision:newsImpactDecision,action:'full_ai',...(newsImpactRecoveryCode ? {recovery:newsImpactRecoveryCode} : {})}});
  }
  const recordTrackedFullAiFailure=async (reason='server_error',status=0)=>{
    if (!(trackFullAi && newsImpactDecision && newsImpactAction==='full_ai')) return null;
    const recovery=await selectNewsImpactRecoveryStrategy(cfg,reason,'full_ai');
    await recordNewsImpactFailure(cfg,{userId:user.id,fixtureId,decision:newsImpactDecision,action:'full_ai',channel:'miniapp',reason,recovery:recovery.code,strategy:recovery.strategy,strategyReason:recovery.guardReason,status});
    return recovery;
  };
  const trackedFullAiFailureResponse=async (payload,status,reason,headers={})=>{
    const recovery=await recordTrackedFullAiFailure(reason,status);
    return json({...payload,...(recovery ? {newsImpactRecovery:recovery} : {})},status,headers);
  };
  try {
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) return await trackedFullAiFailureResponse({ error: 'Некорректный номер матча.' },400,'invalid_fixture');

  const cacheKey = `fixture:${fixtureId}:v15-availability-quality-rc144`;
  const cached = await getCache(cacheKey, cfg);
  const staleBefore = cached || await getStaleCache(cacheKey, cfg);
  const previousFreshness = staleBefore ? analysisFreshness(staleBefore) : null;
  const previousGeneratedMs=Date.parse(String(staleBefore?.generatedAt || ''));
  const newsPublishedMs=Date.parse(String(newsPublishedAt || ''));
  const newsImpactEligible=Boolean(
    recheckRequested
    && newsImpactRecheck
    && staleBefore
    && Number.isFinite(previousGeneratedMs)
    && Number.isFinite(newsPublishedMs)
    && previousGeneratedMs < newsPublishedMs
  );
  const needsFreshnessRecheck=Boolean(recheckRequested && staleBefore && previousFreshness?.needsRecheck);
  const shouldPerformRecheck=Boolean(needsFreshnessRecheck || newsImpactEligible);
  const recheckReasonCode=newsImpactEligible ? 'news_impact' : (previousFreshness?.reasonCode || 'fresh');
  let freeRecheck=false;
  if (needsFreshnessRecheck) freeRecheck=await userHasAnalyzedFixture(user.id,fixtureId,cfg);
  else if (newsImpactEligible) freeRecheck=await userHasAnalyzedFixture(user.id,fixtureId,cfg);
  if (cached && !needsFreshnessRecheck) {
    if (!newsImpactEligible) {
      await recordHistory(user.id, cached, cfg);
      if (trackFullAi) void recordGrowthEvent(cfg,{userId:user.id,eventName:'full_ai',channel:'miniapp',fixtureId,metadata:{cached:true,freshness:previousFreshness?.state || 'fresh'}});
      const newsImpact=newsImpactDeltaStatus(staleBefore,cached,null,{requested:newsImpactRecheck,eligible:newsImpactEligible,performed:false,publishedAt:newsPublishedAt});
      await recordTrackedFullAiOutcome('cached');
      return json(analysisResponsePayload(cached,{cached:true,stale:false,recheck:{requested:recheckRequested,performed:false,free:false,reasonCode:recheckReasonCode},newsImpact,quota:await getQuota(user.id,cfg)}));
    }
  }

  const entitlementBefore = await resolveUserEntitlements(user.id, fixtureId, cfg);
  const passCandidate = entitlementBefore.source === 'pass' && entitlementBefore.access.expandedAi === true;
  const quotaBefore = await getQuota(user.id, cfg);
  if (!freeRecheck && !passCandidate && quotaBefore.left <= 0) return await trackedFullAiFailureResponse({ error: `Лимит исчерпан: ${quotaBefore.used}/${quotaBefore.limit} анализов сегодня.`, quota: quotaBefore },429,'quota_exhausted');

  const analysisLock=await claimDistributedAnalysisLock(fixtureId,cfg);
  if (!analysisLock.claimed && analysisLock.unavailable) {
    if (staleBefore) {
      await recordHistory(user.id,staleBefore,cfg);
      return json(analysisResponsePayload(staleBefore,{cached:true,stale:true,warning:'Координация нового AI-расчёта временно недоступна. Показан последний сохранённый анализ.',retryAfter:5,quota:quotaBefore}));
    }
    return await trackedFullAiFailureResponse({error:'Координация AI-расчёта временно недоступна. Повторите через несколько секунд.',code:'ANALYSIS_COORDINATION_DEGRADED',retryAfter:5,quota:quotaBefore},503,'analysis_coordination_degraded',{'retry-after':'5'});
  }
  if (!analysisLock.claimed) {
    const joined=await waitForSharedAnalysis(cacheKey,cfg);
    if (joined) {
      await recordHistory(user.id,joined,cfg);
      if (trackFullAi) void recordGrowthEvent(cfg,{userId:user.id,eventName:'full_ai',channel:'miniapp',fixtureId,metadata:{cached:true,sharedJoin:true}});
      await recordTrackedFullAiOutcome('shared');
      return json(analysisResponsePayload(joined,{cached:true,stale:false,sharedJoin:true,recheck:{requested:recheckRequested,performed:shouldPerformRecheck,free:freeRecheck,reasonCode:newsImpactEligible ? 'news_impact_shared' : (previousFreshness?.reasonCode || 'shared_compute')},quota:await getQuota(user.id,cfg)}));
    }
    if (staleBefore) {
      await recordHistory(user.id,staleBefore,cfg);
      await recordTrackedFullAiOutcome('stale_pending');
      return json(analysisResponsePayload(staleBefore,{cached:true,stale:true,sharedJoinPending:true,warning:'Свежий расчёт этого матча уже выполняется. Пока показан последний сохранённый анализ.',retryAfter:5,recheck:{requested:recheckRequested,performed:false,free:freeRecheck,reasonCode:'shared_compute_pending'},quota:quotaBefore}));
    }
    return await trackedFullAiFailureResponse({error:'AI-разбор этого матча уже рассчитывается для других пользователей. Повторите через несколько секунд.',code:'ANALYSIS_WARMING',retryAfter:5,quota:quotaBefore},429,'analysis_warming',{'retry-after':'5'});
  }

  let usageReservation=null;
  let passUsageReservation=null;
  let usageCommitted=false;
  try {
  let passAccess=false;
  if (!freeRecheck && passCandidate) {
    const passOperationId=crypto.randomUUID();
    try {
      passUsageReservation=await reserveEntitlementUsage(user.id,entitlementBefore.passes.active,fixtureId,cfg,{
        durable:hasSupabase(cfg),
        operationId:passOperationId,
      });
    } catch (error) {
      await recordOpsEvent(cfg,{
        severity:'error',
        source:'quota',
        eventType:'analysis_usage_reservation',
        code:'ANALYSIS_PASS_RESERVATION_OUTCOME_UNKNOWN',
        message:'Limited Pass reservation response was not confirmed. A durable database reservation, if created, will be reconciled automatically.',
        meta:{
          operationId:passOperationId,
          fixtureId:Number(fixtureId),
          error:redactOpsString(error?.message || error,180),
        },
      }).catch(()=>null);
      throw error;
    }
    passAccess=Boolean(passUsageReservation?.allowed);
  }
  if (!freeRecheck && !passAccess) {
    usageReservation=await reserveAnalysisQuota(user.id,cfg);
    if (!usageReservation.allowed) {
      return await trackedFullAiFailureResponse({error:`Лимит исчерпан: ${usageReservation.used}/${usageReservation.limit} анализов сегодня.`,quota:{plan:usageReservation.plan,used:usageReservation.used,limit:usageReservation.limit,left:usageReservation.left}},429,'quota_exhausted');
    }
  }
  let fixture;
  try {
    fixture = await loadProviderFixture(fixtureId,cfg);
  } catch (error) {
    if (staleBefore && isFootballRateLimitError(error)) {
      await recordHistory(user.id, staleBefore, cfg);
      if (trackFullAi) void recordGrowthEvent(cfg,{userId:user.id,eventName:'full_ai',channel:'miniapp',fixtureId,metadata:{cached:true,stale:true}});
      await recordTrackedFullAiOutcome('stale');
      return json(analysisResponsePayload(staleBefore,{cached:true,stale:true,warning:'Показан последний сохранённый анализ: источник футбольных данных временно ограничил запросы.',retryAfter:Number(error?.retryAfter || 60),recheck:{requested:recheckRequested,performed:false,free:freeRecheck,reasonCode:newsImpactEligible ? 'news_impact_provider_limit' : (previousFreshness?.reasonCode || 'provider_limit')},quota:quotaBefore}));
    }
    throw error;
  }
  if (!fixture) return json({ error: 'Матч не найден.' }, 404);
  const analysisIntegrity = validateFixtureIntegrity(fixture, '', null);
  if (analysisIntegrity.quarantine) {
    await recordOpsEvent(cfg, { severity: 'warning', source: 'integrity', eventType: 'single_fixture_guard', code: 'ANALYSIS_REJECTED', message: 'Анализ отклонён: данные матча не прошли структурную проверку.', meta: { fixtureId, issues: analysisIntegrity.issues.filter(x => x.severity === 'error').map(x => x.code) } }).catch(() => {});
    return await trackedFullAiFailureResponse({ error: 'Данные матча выглядят противоречиво, поэтому анализ временно заблокирован.', code: 'MATCH_DATA_INVALID', integrity: analysisIntegrity, quota: quotaBefore },409,'data_invalid');
  }
  // If this fixture has already finished, settle any earlier immutable pre-match snapshot without another football API call.
  if (isFinishedStatus(fixture.fixture?.status?.short)) await settlePredictionsFromFixtures([fixture], cfg).catch(() => null);

  const homeId = fixture.teams?.home?.id, awayId = fixture.teams?.away?.id;
  const homeName = fixture.teams?.home?.name || '', awayName = fixture.teams?.away?.name || '';
  const leagueName = fixture.league?.name || '';

  const kickoffMs = fixture.fixture?.date ? Date.parse(fixture.fixture.date) : NaN;
  const minutesToKickoff = Number.isFinite(kickoffMs) ? Math.round((kickoffMs - Date.now()) / 60000) : null;
  const status = fixture.fixture?.status?.short || '';
  const detailedCoverage = !isYouthReserveMatch(leagueName, homeName, awayName);
  const providerPlan = memory.provider?.plan || 'UNKNOWN';
  const paid = ['PRO','ULTRA','MEGA'].includes(providerPlan);
  const healthyFree = freeQuotaHealthy(30, 6);
  // FREE keeps only the two highest-value uncached AI provider calls (predictions + odds).
  // Optional signals reuse shared cache when present but do not fan out into
  // injuries/H2H/lineups/team-form network calls in the same minute.
  const canFetchLineups = detailedCoverage && paid && (
    isLiveStatus(status) || (minutesToKickoff !== null && minutesToKickoff <= 90 && minutesToKickoff >= -240)
  );
  const canFetchFreshForm = detailedCoverage && paid && healthyFree;
  const canFetchH2H = detailedCoverage && paid;
  const canFetchInjuries = paid;

  const skipped = [];
  if (!canFetchFreshForm && detailedCoverage) skipped.push('Свежая форма команд: бережём лимит источника данных и используем сохранённые данные, если они есть.');
  if (!canFetchLineups && detailedCoverage && minutesToKickoff !== null && minutesToKickoff <= 120) skipped.push('Составы: запрос отложен из-за лимита или до публикации стартовых составов.');
  if (!canFetchH2H && detailedCoverage) skipped.push('Очные встречи временно пропущены: осталось мало запросов в минутном окне.');
  if (!canFetchInjuries) skipped.push('Травмы временно пропущены: осталось критически мало запросов в минутном окне.');
  if (!detailedCoverage) skipped.push('Молодёжный/резервный турнир: расширенные запросы ограничены из-за слабого покрытия.');

  const injurySkipReason = !detailedCoverage ? 'limited_coverage' : canFetchInjuries ? '' : 'quota_reserve';
  const h2hSkipReason = !detailedCoverage ? 'limited_coverage' : canFetchH2H ? '' : 'quota_reserve';
  const lineupSkipReason = !detailedCoverage
    ? 'limited_coverage'
    : minutesToKickoff === null || (!isLiveStatus(status) && (minutesToKickoff > 90 || minutesToKickoff < -240))
      ? 'publication_window'
      : canFetchLineups ? '' : 'quota_reserve';

  const [injuryResult, predictionResult, oddsResult, h2hResult] = await Promise.all([
    analysisProviderFetch({ feature:'injuries', path:'/injuries', params:{ fixture:fixtureId }, fixtureId, cfg, allowed:canFetchInjuries, skipReason:injurySkipReason }),
    analysisProviderFetch({ feature:'predictions', path:'/predictions', params:{ fixture:fixtureId }, fixtureId, cfg }),
    analysisProviderFetch({ feature:'odds', path:'/odds', params:{ fixture:fixtureId }, fixtureId, cfg }),
    analysisProviderFetch({ feature:'h2h', path:'/fixtures/headtohead', params:{ h2h:`${homeId}-${awayId}`, last:5 }, fixtureId, cfg, allowed:canFetchH2H, skipReason:h2hSkipReason }),
  ]);
  const lineupResult = await analysisProviderFetch({
    feature:'lineups', path:'/fixtures/lineups', params:{ fixture:fixtureId }, fixtureId, cfg,
    allowed:canFetchLineups, skipReason:lineupSkipReason,
  });

  const injuries = injuryResult.data;
  const predictions = predictionResult.data;
  const odds = oddsResult.data;
  const h2hRows = h2hResult.data;
  const lineupsRows = lineupResult.data;
  const lineups = formatLineups(lineupsRows, homeId, awayId);
  const lineupQuality=assessMatchLineups(lineups);
  const lineupMeta=annotateLineupReliability(lineupResult.meta, lineupQuality);
  const primaryMarket = extractMarket(odds);
  const primaryMarketMeta = usableOddsFeatureMeta(oddsResult.meta, primaryMarket);
  const primaryMarketShape = assessOddsMarketQuality(primaryMarket, { oddsMeta:primaryMarketMeta, mode:'upcoming' });
  const secondaryOdds = primaryMarket && primaryMarketShape.marketValid
    ? null
    : await secondaryOddsMarket(fixture, cfg, { mode:'prematch' });
  const market = secondaryOdds?.available ? secondaryOdds.market : primaryMarket || null;
  const resolvedOddsMeta = secondaryOdds?.available
    ? usableOddsFeatureMeta(secondaryOdds.meta, market)
    : usableOddsFeatureMeta(oddsResult.meta, primaryMarket, secondaryOdds?.reason || '');
  const analysisFeatureMeta = applyFeatureFreshnessMap({
    injuries: injuryResult.meta,
    predictions: predictionResult.meta,
    odds: resolvedOddsMeta,
    h2h: h2hResult.meta,
    lineups: lineupMeta,
  }, { mode:'upcoming' });
  const oddsQuality = assessOddsMarketQuality(market, { oddsMeta:analysisFeatureMeta.odds || {}, mode:'upcoming' });
  analysisFeatureMeta.odds = annotateOddsReliability(analysisFeatureMeta.odds || { feature:'odds' }, oddsQuality);
  const analysisMarket = oddsMarketForTrustedAnalytics(market, oddsQuality);
  const availabilityQuality = assessFixtureAvailabilityQuality(injuries, {
    homeId, awayId, injuriesMeta:analysisFeatureMeta.injuries || {}, mode:'upcoming',
  });
  analysisFeatureMeta.injuries = annotateAvailabilityReliability(
    analysisFeatureMeta.injuries || { feature:'injuries', provider:'api-football', source:'network' },
    availabilityQuality,
  );
  const trustedInjuries = sanitizeAvailabilityRows(injuries, availabilityQuality);
  const providerReliability = providerDataReliabilitySummary(analysisFeatureMeta, { minutesToKickoff, mode:'upcoming' });
  skipped.push(...providerReliability.warnings);

  const webPromise = tavilySearch(`${homeName} ${awayName} injuries team news probable lineups latest`, cfg);
  const homeFormPromise = detailedCoverage
    ? getRecentTeamForm(homeId, 'home', fixture.fixture?.date, fixtureId, cfg, { allowNetwork: canFetchFreshForm }).catch(() => null)
    : Promise.resolve(null);
  const awayFormPromise = detailedCoverage
    ? getRecentTeamForm(awayId, 'away', fixture.fixture?.date, fixtureId, cfg, { allowNetwork: canFetchFreshForm }).catch(() => null)
    : Promise.resolve(null);
  const refereeHistoryPromise = loadRefereeHistoryProfile(fixture.fixture?.referee || '', cfg).catch(() => ({ available:false, sample:0 }));
  const [web, homeForm, awayForm, refereeHistory] = await Promise.all([webPromise, homeFormPromise, awayFormPromise, refereeHistoryPromise]);

  // v3.5 Match Comparison: reuse only already cached deep team data.
  // This adds Supabase cache reads but deliberately makes zero extra API-Football calls.
  const leagueId = Number(fixture.league?.id || 0);
  const season = Number(fixture.league?.season || 0) || null;
  const comparisonCompetition = { leagueId, season };
  const [homeStanding, awayStanding, homeTeamIntelligence, awayTeamIntelligence] = await Promise.all([
    cachedTeamStanding(homeId, comparisonCompetition, cfg).catch(() => null),
    cachedTeamStanding(awayId, comparisonCompetition, cfg).catch(() => null),
    cachedTeamIntelligenceForAnalysis(homeId, leagueId, season, cfg).catch(() => ({ stats:null, playerStats:null })),
    cachedTeamIntelligenceForAnalysis(awayId, leagueId, season, cfg).catch(() => ({ stats:null, playerStats:null })),
  ]);
  const homeSeasonStats = homeTeamIntelligence?.stats || null;
  const awaySeasonStats = awayTeamIntelligence?.stats || null;
  const cachedHomePlayerStats = homeTeamIntelligence?.playerStats || null;
  const cachedAwayPlayerStats = awayTeamIntelligence?.playerStats || null;

  const previousMarketSnapshots = analysisMarket ? await getOddsSnapshots(fixtureId, cfg, 8).catch(() => []) : [];
  const marketMovement = buildOddsMovement(previousMarketSnapshots, analysisMarket);
  if (analysisMarket) await saveOddsSnapshot(fixtureId, analysisMarket, cfg).catch(() => false);
  const apiPrediction = extractPrediction(predictions);
  const h2h = formatH2H(h2hRows, homeId, awayId);
  const baseAbsences = formatAbsences(trustedInjuries, homeId, awayId, lineups);
  const roleHydrationMaxPages = paid ? 2 : 1;
  const [homeRoleHydration, awayRoleHydration] = await Promise.all([
    hydratePlayerRolesForAnalysis({ teamId:homeId, teamName:homeName, leagueId, leagueName, season, cachedPlayerStats:cachedHomePlayerStats, needed:baseAbsences.home.length>0, cfg, maxPages:roleHydrationMaxPages }),
    hydratePlayerRolesForAnalysis({ teamId:awayId, teamName:awayName, leagueId, leagueName, season, cachedPlayerStats:cachedAwayPlayerStats, needed:baseAbsences.away.length>0, cfg, maxPages:roleHydrationMaxPages }),
  ]);
  const homePlayerStats = homeRoleHydration.playerStats;
  const awayPlayerStats = awayRoleHydration.playerStats;
  if (baseAbsences.home.length && !homePlayerStats?.available) skipped.push('Роль отсутствующих игроков хозяев не уточнена: сезонная статистика недоступна или сохранена квота.');
  if (baseAbsences.away.length && !awayPlayerStats?.available) skipped.push('Роль отсутствующих игроков гостей не уточнена: сезонная статистика недоступна или сохранена квота.');
  const absences = enrichFixtureAbsencesWithSeasonRole(baseAbsences, { homePlayerStats, awayPlayerStats });
  const lineupImpact = buildLineupImpact({ absences, lineups, homeName, awayName, reliability:providerReliability });
  const recentFormProb = formProbabilities(homeForm, awayForm);
  const h2hProb = h2hProbabilities(h2h);
  const calibrationProfile = await getCalibrationProfile(cfg).catch(() => baselineCalibrationProfile());
  const baselineBlend = blendProbabilitySignals({ market:analysisMarket, model: apiPrediction, form: recentFormProb, h2h: h2hProb, weightOverrides: MODEL_BASE_WEIGHTS });
  const blended = calibrationProfile.weightsActive
    ? blendProbabilitySignals({ market:analysisMarket, model: apiPrediction, form: recentFormProb, h2h: h2hProb, weightOverrides: calibrationProfile.signalWeights })
    : baselineBlend;
  const rawProbabilities = applyAbsenceAdjustment(baselineBlend.probabilities, absences);
  const weightedProbabilities = applyAbsenceAdjustment(blended.probabilities, absences);
  const probabilities = calibrationProfile.temperatureActive
    ? temperatureScaleProbabilities(weightedProbabilities, calibrationProfile.temperature)
    : weightedProbabilities;
  const goalModel = poissonGoalModel(homeForm, awayForm);
  const comparison = buildMatchComparison({
    homeName, awayName, homeForm, awayForm, homeStanding, awayStanding, homeSeasonStats, awaySeasonStats,
    goalModel, h2h, absences, hasInjuryData: Boolean(providerReliability.features?.injuries?.available),
  });
  const confidence = confidenceModel(blended.signals, probabilities, homeForm, awayForm);
  const notes = buildAnalysisNotes({
    probabilities, market:analysisMarket, model: apiPrediction, homeForm, awayForm, h2h, absences, lineups, news: web,
    homeName, awayName, minutesToKickoff, confidence,
  });
  notes.risks.push(...providerReliability.warnings);
  notes.risks = [...new Set(notes.risks)].slice(0, 7);
  if (calibrationProfile.mode === 'active') {
    notes.factors.unshift(`Калибратор вероятностей активен (${String(calibrationProfile.fingerprint || '').slice(0, 8) || 'базовый'}) на базе ${Number(calibrationProfile.sample || 0)} доверенных прогнозов.`);
  } else if (calibrationProfile.mode === 'shadow') {
    notes.risks.push('Калибратор пока работает в теневом режиме: выборка собирается, но итоговые вероятности ещё не корректируются автоматически.');
  }

  const availableSignals = [
    analysisMarket && 'market',
    apiPrediction && 'apiPrediction',
    homeForm?.overall && awayForm?.overall && 'recentForm',
    h2hRows.length && 'h2h',
    trustedInjuries.length && 'injuries',
    lineupQuality.bothConfirmed && 'lineups',
    web.answer && 'web',
  ].filter(Boolean);

  const completenessPreview = {
    score: [fixture, analysisMarket, apiPrediction, trustedInjuries.length, h2hRows.length, lineupQuality.bothConfirmed, web.answer, homeForm?.overall, awayForm?.overall, goalModel].filter(Boolean).length,
    max: 10,
    providerReliability: {
      state: providerReliability.state,
      trustCap: providerReliability.trustCap,
      available: providerReliability.available,
      checked: providerReliability.checked,
    },
  };
  const preMatchIntelligence = buildPreMatchIntelligence({
    probabilities,
    rawProbabilities,
    market:analysisMarket,
    apiPrediction,
    homeForm,
    awayForm,
    h2h,
    absences,
    lineups,
    goalModel,
    comparison,
    confidence,
    modelBreakdown: { weights: blended.weights, signals: blended.signals },
    homeName,
    awayName,
    minutesToKickoff,
    news: web,
    completeness: completenessPreview,
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    analysisVersion: '4.15.0-availability-quality',
    match: {
      fixtureId, date: fixture.fixture?.date || '', status: fixture.fixture?.status?.short || '',
      venue: fixture.fixture?.venue?.name || '', city: fixture.fixture?.venue?.city || '',
      referee: fixture.fixture?.referee || '',
      leagueId, season, league: leagueName, country: fixture.league?.country || '',
      home: { id: homeId, name: homeName, logo: fixture.teams?.home?.logo || '' },
      away: { id: awayId, name: awayName, logo: fixture.teams?.away?.logo || '' },
      integrity: { state: analysisIntegrity.state, score: analysisIntegrity.qualityScore, warnings: analysisIntegrity.warnings, issues: analysisIntegrity.issues.filter(x => x.severity !== 'info').slice(0, 3) },
    },
    probabilities,
    rawProbabilities,
    modelCalibration: {
      version: calibrationProfile.version || CALIBRATION_PROFILE_VERSION,
      fingerprint: calibrationProfile.fingerprint || '',
      mode: calibrationProfile.mode || 'baseline',
      sample: Number(calibrationProfile.sample || 0),
      temperature: Number(calibrationProfile.temperature || 1),
      temperatureActive: Boolean(calibrationProfile.temperatureActive),
      weightsActive: Boolean(calibrationProfile.weightsActive),
      signalWeights: calibrationProfile.signalWeights || { ...MODEL_BASE_WEIGHTS },
      validation: calibrationProfile.temperatureValidation || null,
      weightsValidation: calibrationProfile.weightsValidation || null,
      promotionGate: calibrationProfile.promotionGate || null,
      lifecycle: calibrationProfile.lifecycle || null,
      note: calibrationProfile.note || '',
    },
    confidence,
    likelyOutcome: outcomeName(probabilities, homeName, awayName),
    modelBreakdown: {
      weights: blended.weights,
      signals: blended.signals,
      method: 'Рынок, прогноз источника данных, форма и очные встречи объединяются динамически. Активный профиль применяется только после двух окон отложенной выборки и атомарного сравнения кандидата с активной моделью. Потери состава корректируют итог ограниченно: роль игрока сначала берётся из Team Intelligence cache, а при реальной потере может точечно гидратироваться из сезонной статистики с отдельным кешем и quota guard; сомнительный статус даёт половинный вклад.',
    },
    dataPolicy: {
      dataMode: paid ? 'expanded' : 'standard',
      mode: paid ? 'full' : healthyFree ? 'balanced-free' : 'quota-saver',
      availableSignals,
      skipped: [...new Set(skipped)],
      featureReliability: analysisFeatureMeta,
      reliability: providerReliability,
    },
    dataCapabilities: publicDataCapabilities(),
    dataProvenance: {
      primaryProvider:'api-football',
      generatedAt:new Date().toISOString(),
      features:Object.fromEntries(Object.entries(analysisFeatureMeta).map(([feature, meta]) => [feature, {
        provider:String(meta?.provider || 'api-football'),
        source:String(meta?.source || 'network'),
        state:String(meta?.state || 'unknown'),
        fetchedAt:meta?.fetchedAt || null,
        ageSeconds:Number.isFinite(Number(meta?.ageSeconds)) ? Number(meta.ageSeconds) : null,
        sourceUpdatedAt:meta?.sourceUpdatedAt || null,
        freshnessState:String(meta?.freshnessState || 'unknown'),
        provenanceState:String(meta?.provenanceState || 'unknown'),
        freshnessLimitSeconds:Number.isFinite(Number(meta?.freshnessLimitSeconds)) ? Number(meta.freshnessLimitSeconds) : null,
        confidenceBearing:Boolean(meta?.confidenceBearing),
        stale:Boolean(meta?.stale),
      }])),
      playerRoleHydration:{
        home:{source:homeRoleHydration.source,network:Boolean(homeRoleHydration.network),stale:Boolean(homeRoleHydration.stale),reason:String(homeRoleHydration.reason || '')},
        away:{source:awayRoleHydration.source,network:Boolean(awayRoleHydration.network),stale:Boolean(awayRoleHydration.stale),reason:String(awayRoleHydration.reason || '')},
      },
      news:{
        provider:'tavily',
        source:web?.answer || web?.results?.length ? 'network-or-cache' : 'unavailable',
        state:web?.answer || web?.results?.length ? 'available' : 'unavailable',
      },
    },
    market:analysisMarket, marketMovement, oddsQuality, availabilityQuality, apiPrediction, recentForm: { home: homeForm, away: awayForm }, goalModel, comparison, absences, lineups, lineupQuality, lineupImpact, h2h,
    preMatchIntelligence,
    aiInstructor: buildAiInstructor({ probabilities, goalModel, confidence, completeness: completenessPreview, factors: notes.factors, risks: [...(notes.risks || []), ...skipped], referee: fixture.fixture?.referee || '', refereeData: refereeProfile(fixture.fixture?.referee || ''), refereeHistory, lineupImpact, marketMovement, providerReliability, minutesToKickoff }),
    insights: notes.factors, risks: [...(notes.risks || []), ...skipped], news: web,
    completeness: completenessPreview,
    providerReliability,
    provider: publicDataCapabilities(),
    disclaimer: 'Расчёт основан на доступных статистических сигналах и не гарантирует исход матча. Это не финансовая рекомендация.',
  };

  let ttl = cfg.cacheMinutes;
  if (isFinishedStatus(status)) ttl = 720;
  else if (minutesToKickoff !== null && minutesToKickoff <= 15) ttl = 3;
  else if (minutesToKickoff !== null && minutesToKickoff <= 45) ttl = 5;
  else if (minutesToKickoff !== null && minutesToKickoff <= 120) ttl = 10;
  else if (minutesToKickoff !== null && minutesToKickoff <= 360) ttl = 20;
  else if (minutesToKickoff !== null && minutesToKickoff > 360) ttl = 45;
  const recheckDelta=needsFreshnessRecheck ? analysisRecheckDelta(staleBefore,payload) : null;
  const newsImpactRecheckDelta=!needsFreshnessRecheck && newsImpactEligible ? analysisRecheckDelta(staleBefore,payload) : null;
  const effectiveRecheckDelta=recheckDelta || newsImpactRecheckDelta;
  const newsImpact=newsImpactDeltaStatus(staleBefore,payload,effectiveRecheckDelta,{requested:newsImpactRecheck,eligible:newsImpactEligible,performed:shouldPerformRecheck,publishedAt:newsPublishedAt});
  await setCache(cacheKey, fixtureId, payload, cfg, ttl);
  await captureAnalysisTimelineSnapshot(payload, cfg, { delta: effectiveRecheckDelta });
  await captureModelPrediction(payload, cfg);
  await recordHistory(user.id, payload, cfg);
  if (newsImpactEligible && !needsFreshnessRecheck) {
    void recordGrowthEvent(cfg,{userId:user.id,eventName:'analysis_recheck',channel:analysisOrigin==='telegram_quick'?'telegram':'miniapp',fixtureId,metadata:{free:freeRecheck,reason:'news_impact',material:Boolean(effectiveRecheckDelta?.material),stable:Boolean(effectiveRecheckDelta?.stable),changeCount:Number(effectiveRecheckDelta?.items?.length || 0),codes:(effectiveRecheckDelta?.codes || []).slice(0,6)}});
  }
  if (needsFreshnessRecheck) void recordGrowthEvent(cfg,{userId:user.id,eventName:'analysis_recheck',channel:analysisOrigin==='telegram_quick'?'telegram':'miniapp',fixtureId,metadata:{free:freeRecheck,reason:previousFreshness?.reasonCode || 'age_window',material:Boolean(recheckDelta?.material),stable:Boolean(recheckDelta?.stable),changeCount:Number(recheckDelta?.items?.length || 0),codes:(recheckDelta?.codes || []).slice(0,6)}});
  if (trackFullAi) void recordGrowthEvent(cfg,{userId:user.id,eventName:'full_ai',channel:'miniapp',fixtureId,metadata:{cached:false,recheck:shouldPerformRecheck}});
  await recordTrackedFullAiOutcome('fresh');
  const responseQuota=await getQuota(user.id,cfg);
  usageCommitted=true;
  return json(analysisResponsePayload(payload,{cached:false,stale:false,recheck:{requested:recheckRequested,performed:shouldPerformRecheck,free:freeRecheck,reasonCode:recheckReasonCode,delta:recheckDelta},newsImpact,quota:responseQuota}));
  } finally {
    try {
      const disposition=usageCommitted ? 'commit' : 'refund';

      if (usageReservation?.reserved) {
        if (usageReservation.durable) {
          await finalizeAnalysisUsageReservation({
            reservation:usageReservation,
            disposition,
            cfg,
            userId:user.id,
          });
        } else if (!usageCommitted) {
          try {
            await refundAnalysisQuota(user.id,usageReservation,cfg);
          } catch (error) {
            bumpTelemetry('quotaRefundFailures');
            await recordOpsEvent(cfg,{
              severity:'error',
              source:'quota',
              eventType:'analysis_usage_compensation',
              code:'LEGACY_QUOTA_REFUND_FAILED',
              message:'Legacy analysis quota refund failed before durable lifecycle confirmation.',
              meta:{
                usageDate:usageReservation.date || null,
                error:redactOpsString(error?.message || error,180),
              },
            }).catch(()=>null);
          }
        }
      }

      if (passUsageReservation?.reserved) {
        if (passUsageReservation.durable) {
          await finalizeAnalysisUsageReservation({
            reservation:passUsageReservation,
            disposition,
            cfg,
            userId:user.id,
          });
        } else if (!usageCommitted) {
          try {
            const result=await refundEntitlementUsage(user.id,passUsageReservation.entitlementId,cfg);
            if (result?.updated !== true) throw new Error(String(result?.reason || 'legacy_pass_refund_not_confirmed'));
            bumpTelemetry('passUsageRefunds');
          } catch (error) {
            bumpTelemetry('passUsageRefundFailures');
            await recordOpsEvent(cfg,{
              severity:'error',
              source:'quota',
              eventType:'analysis_usage_compensation',
              code:'LEGACY_PASS_REFUND_FAILED',
              message:'Legacy limited Pass refund failed before durable lifecycle confirmation.',
              meta:{
                entitlementId:Number(passUsageReservation.entitlementId || 0) || null,
                error:redactOpsString(error?.message || error,180),
              },
            }).catch(()=>null);
          }
        }
      }
    } finally {
      await releaseDistributedAnalysisLock(analysisLock,cfg);
    }
  }
  } catch (error) {
    const reason=newsImpactFailureCode(error,'server_error');
    const recovery=await recordTrackedFullAiFailure(reason,Number(error?.status || 0));
    if (recovery) error.newsImpactRecovery=recovery;
    throw error;
  }
};
}
