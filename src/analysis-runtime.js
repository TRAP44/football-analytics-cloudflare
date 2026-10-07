// AI analysis orchestration extracted from worker.js.
// Provider, entitlement, cache, settlement and model capabilities are injected by the composition root.
export function createAnalysisRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Analysis runtime dependencies are required.');
  }
  const {
    CALIBRATION_PROFILE_VERSION,
    MODEL_BASE_WEIGHTS,
    analysisFreshness,
    analysisProviderFetch,
    apiFootball,
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
    fetchWithTimeout,
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
    normalizeTeamSeasonStatistics,
    isFinishedStatus,
    isFootballRateLimitError,
    isRetryableFootballTransportError,
    isLiveStatus,
    isYouthReserveMatch,
    json,
    loadProviderFixture,
    loadRefereeHistoryProfile,
    memory,
    newsImpactDeltaStatus,
    newsImpactFailureCode,
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
    seasonStrengthProbabilities,
    selectNewsImpactRecoveryStrategy,
    setCache,
    settlePredictionsFromFixtures,
    temperatureScaleProbabilities,
    usableOddsFeatureMeta,
    userHasAnalyzedFixture,
    validateFixtureIntegrity,
    waitForSharedAnalysis,
  } = deps;

  function objectValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function safeText(value, max = 240) {
    if (!['string','number','bigint'].includes(typeof value)) return '';
    return String(value)
      .normalize('NFKC')
      .replace(/[\u0000-\u001F\u007F]/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .slice(0,max);
  }

  function finiteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const raw=value.trim();
    if (!/^-?(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function positiveSafeInteger(value) {
    const number=finiteNumber(value);
    return number !== null && Number.isSafeInteger(number) && number>0 ? number : null;
  }

  function nonNegativeSafeInteger(value, max = Number.MAX_SAFE_INTEGER) {
    const number=finiteNumber(value);
    return number !== null
      && Number.isSafeInteger(number)
      && number>=0
      && number<=max
      ? number
      : null;
  }

  function safeSeason(value) {
    const season=positiveSafeInteger(value);
    return season !== null && season>=1900 && season<=2200 ? season : null;
  }

  function probabilityVector(value) {
    const source=objectValue(value);
    if (!source) return null;
    const home=finiteNumber(source.home);
    const draw=finiteNumber(source.draw);
    const away=finiteNumber(source.away);
    if (
      home === null || draw === null || away === null
      || home<0 || home>100
      || draw<0 || draw>100
      || away<0 || away>100
    ) return null;
    const total=home+draw+away;
    if (!Number.isFinite(total) || Math.abs(total-100)>2.5) return null;
    return {home,draw,away};
  }

  async function optionalAsync(fn, ...args) {
    try {
      return typeof fn === 'function' ? await fn(...args) : null;
    } catch {
      return null;
    }
  }

  function seasonStatsCacheValue(value, teamId, leagueId, season) {
    const source=objectValue(value);
    const id=positiveSafeInteger(teamId);
    const competitionId=positiveSafeInteger(leagueId);
    const year=safeSeason(season);
    if (!source || source.available !== true || !id || !competitionId || !year) {
      return null;
    }
    if (positiveSafeInteger(source?.team?.id)!==id) return null;
    if (positiveSafeInteger(source?.league?.id)!==competitionId) return null;
    if (safeSeason(source?.league?.season)!==year) return null;
    return objectValue(source.derived) ? source : null;
  }

  async function loadSeasonStatsForAnalysis({
    teamId,
    teamName,
    teamLogo,
    leagueId,
    leagueName,
    leagueLogo,
    country,
    season,
    cfg,
    allowNetwork=false,
  }={}) {
    const id=positiveSafeInteger(teamId);
    const competitionId=positiveSafeInteger(leagueId);
    const year=safeSeason(season);
    if (!id || !competitionId || !year) return null;

    const cacheKey=`analysis:team-season:${id}:${competitionId}:${year}:v1`;
    const cached=seasonStatsCacheValue(
      await optionalAsync(getCache,cacheKey,cfg),
      id,
      competitionId,
      year,
    );
    if (cached) return cached;

    const stale=seasonStatsCacheValue(
      await optionalAsync(getStaleCache,cacheKey,cfg),
      id,
      competitionId,
      year,
    );
    if (allowNetwork !== true || typeof apiFootball !== 'function') {
      return stale;
    }

    let providerRow=null;
    try {
      providerRow=objectValue(await apiFootball(
        '/teams/statistics',
        {team:id,league:competitionId,season:year},
        cfg,
        {responseType:'any'},
      ));
    } catch {
      return stale;
    }
    if (
      positiveSafeInteger(providerRow?.team?.id)!==id
      || positiveSafeInteger(providerRow?.league?.id)!==competitionId
      || safeSeason(providerRow?.league?.season)!==year
    ) {
      return stale;
    }

    let normalized=null;
    try {
      normalized=objectValue(normalizeTeamSeasonStatistics(providerRow,{
        teamId:id,
        teamName:safeText(teamName,180),
        teamLogo:safeText(teamLogo,500),
        leagueId:competitionId,
        leagueName:safeText(leagueName,180),
        leagueLogo:safeText(leagueLogo,500),
        country:safeText(country,120),
        season:year,
      }));
    } catch {
      normalized=null;
    }
    const valid=seasonStatsCacheValue(normalized,id,competitionId,year);
    if (!valid) return stale;
    await optionalAsync(setCache,cacheKey,id,valid,cfg,360);
    return valid;
  }

  function safeAnalysisResponsePayload(payload, extra = {}) {
    const source=objectValue(payload) || {};
    const additions=objectValue(extra) || {};
    try {
      return objectValue(analysisResponsePayload(source,additions))
        || {...source,...additions};
    } catch {
      return {...source,...additions};
    }
  }

  function safeNewsImpactDeltaStatus(previous,next,delta,options) {
    try {
      return newsImpactDeltaStatus(previous,next,delta,options);
    } catch {
      return null;
    }
  }

  function normalizedModelBaseWeights() {
    const base=objectValue(MODEL_BASE_WEIGHTS) || {};
    const normalized={};
    for (const [key,value] of Object.entries(base)) {
      const name=safeText(key,40);
      const weight=finiteNumber(value);
      if (!name || weight === null || weight<0 || weight>1) continue;
      normalized[name]=weight;
    }
    return normalized;
  }

  function calibrationProfileValue(value) {
    let fallback={};
    try { fallback=objectValue(baselineCalibrationProfile()) || {}; } catch {}

    const source=objectValue(value) || fallback;
    const baseWeights=normalizedModelBaseWeights();
    const candidateWeights=objectValue(source.signalWeights);
    let signalWeights={...baseWeights};
    let weightsValid=false;

    if (candidateWeights) {
      const keys=Object.keys(baseWeights);
      const candidate={};
      let valid=keys.length>0;
      let total=0;
      for (const key of keys) {
        const weight=finiteNumber(candidateWeights[key]);
        if (weight === null || weight<0 || weight>1) {
          valid=false;
          break;
        }
        candidate[key]=weight;
        total+=weight;
      }
      if (valid && Math.abs(total-1)<=0.02) {
        signalWeights=candidate;
        weightsValid=true;
      }
    }

    const temperature=finiteNumber(source.temperature);
    const safeTemperature=temperature !== null && temperature>=0.5 && temperature<=2
      ? temperature
      : 1;
    const requestedMode=safeText(source.mode,24);
    const mode=['active','shadow','baseline'].includes(requestedMode)
      ? requestedMode
      : 'baseline';
    const temperatureActive=source.temperatureActive === true
      && mode==='active'
      && safeTemperature!==1;
    const weightsActive=source.weightsActive === true
      && mode==='active'
      && weightsValid;

    return {
      ...fallback,
      ...source,
      version:safeText(source.version || CALIBRATION_PROFILE_VERSION,80)
        || safeText(CALIBRATION_PROFILE_VERSION,80),
      fingerprint:safeText(source.fingerprint,120),
      mode:temperatureActive || weightsActive ? 'active' : mode==='shadow' ? 'shadow' : 'baseline',
      sample:nonNegativeSafeInteger(source.sample,1_000_000) ?? 0,
      temperature:safeTemperature,
      temperatureActive,
      weightsActive,
      signalWeights,
      temperatureValidation:objectValue(source.temperatureValidation),
      weightsValidation:objectValue(source.weightsValidation),
      promotionGate:objectValue(source.promotionGate),
      lifecycle:objectValue(source.lifecycle),
      note:safeText(source.note,1000),
    };
  }

  function strictBoolean(value) {
    return value === true;
  }

  function safePredicate(fn, ...args) {
    try { return typeof fn === 'function' && fn(...args) === true; }
    catch { return false; }
  }

  function quotaHealthy(reserve, cost) {
    return safePredicate(freeQuotaHealthy,reserve,cost);
  }

  function rowsOrEmpty(value, limit = 1000) {
    return Array.isArray(value) ? value.slice(0,limit) : [];
  }

  function boundedRetryAfter(value, fallback = 60) {
    const number=positiveSafeInteger(value);
    return number !== null && number<=3600 ? number : fallback;
  }

  function safeHttpUrl(value, max = 1000) {
    const raw=safeText(value,max);
    if (!raw) return '';
    try {
      const parsed=new URL(raw);
      return ['http:','https:'].includes(parsed.protocol)
        ? parsed.toString().slice(0,max)
        : '';
    } catch {
      return '';
    }
  }

  function unavailableFeatureMeta(feature, reason = 'provider_unavailable') {
    return {
      feature:safeText(feature,40) || 'unknown',
      provider:'api-football',
      source:'network',
      state:'unavailable',
      available:false,
      usable:false,
      observed:false,
      attempted:true,
      confidenceBearing:false,
      stale:false,
      reason:safeText(reason,120) || 'provider_unavailable',
    };
  }

  function providerEnvelope(value, feature, reason = 'invalid_provider_response') {
    const envelope=objectValue(value);
    return {
      data:rowsOrEmpty(envelope?.data,1000),
      meta:objectValue(envelope?.meta) || unavailableFeatureMeta(feature,reason),
    };
  }

  async function safeAnalysisProviderFetch(input) {
    const request=objectValue(input) || {};
    const feature=safeText(request.feature,40) || 'unknown';
    try {
      return providerEnvelope(
        await analysisProviderFetch(request),
        feature,
      );
    } catch (error) {
      return providerEnvelope(
        null,
        feature,
        safeText(error?.code,120) || 'provider_error',
      );
    }
  }

  function analysisCachePayload(value, fixtureId) {
    const cached=objectValue(value);
    if (!cached) return null;
    if (positiveSafeInteger(cached?.match?.fixtureId)!==fixtureId) return null;
    return cached;
  }

  function quotaSnapshot(value, fallback = null) {
    const quota=objectValue(value);
    if (!quota) return fallback;

    const used=nonNegativeSafeInteger(quota.used);
    const limit=nonNegativeSafeInteger(quota.limit);
    const left=nonNegativeSafeInteger(quota.left);
    if (used === null || limit === null || left === null || limit <= 0) return fallback;

    const expectedLeft=Math.max(0,limit-used);
    if (left !== expectedLeft) return fallback;

    return {
      ...quota,
      plan:safeText(quota.plan || fallback?.plan || 'FREE',40) || 'FREE',
      used,
      limit,
      left,
    };
  }

  function reservationQuotaSnapshot(reservation, fallback = null) {
    const value=objectValue(reservation);
    if (!value || value.allowed !== true) return fallback;
    return quotaSnapshot(value,fallback);
  }

  async function quotaSnapshotForResponse(userId, cfg, fallback = null) {
    try {
      return quotaSnapshot(await getQuota(userId,cfg),fallback);
    } catch {
      return fallback;
    }
  }

  function normalizeNewsPublishedAt(value, now = Date.now()) {
    const raw=safeText(value,80);
    if (!raw) return '';
    const parsed=Date.parse(raw);
    if (!Number.isFinite(parsed)) return '';

    const nowMs=finiteNumber(now);
    const anchor=nowMs !== null && nowMs>=0 ? nowMs : Date.now();
    // Client clocks can drift slightly, but future-dated news must not create a
    // synthetic "after news" recheck window.
    if (parsed>anchor+5*60_000) return '';
    if (parsed<anchor-7*86400_000) return '';
    return new Date(parsed).toISOString();
  }

  async function tavilySearch(query, cfg) {
    const normalized=safeText(query,500);
    const token=safeText(cfg?.tavilyKey,1000);
    if (!normalized || !token || typeof fetchWithTimeout !== 'function') {
      return {available:false,answer:'',results:[],reason:'not_configured'};
    }

    try {
      const response=await fetchWithTimeout('https://api.tavily.com/search',{
        method:'POST',
        headers:{
          authorization:`Bearer ${token}`,
          'content-type':'application/json',
        },
        body:JSON.stringify({
          query:normalized,
          search_depth:'basic',
          topic:'news',
          include_answer:true,
          include_published_date:true,
          safe_search:true,
          max_results:5,
        }),
      },7000,'Tavily search');

      if (!response?.ok) {
        return {
          available:false,
          answer:'',
          results:[],
          reason:`http_${nonNegativeSafeInteger(response?.status,999) ?? 0}`,
        };
      }

      const data=objectValue(await response.json().catch(()=>null)) || {};
      const results=rowsOrEmpty(data.results,5).map(item=>{
        const row=objectValue(item) || {};
        return {
          title:safeText(row.title,200),
          url:safeHttpUrl(row.url,1000),
          content:safeText(row.content,1200),
          publishedAt:safeText(row.published_date,80),
          score:finiteNumber(row.score),
        };
      }).filter(item=>item.title || item.url || item.content);

      const answer=safeText(data.answer,2400);
      return {
        available:Boolean(answer || results.length),
        answer,
        results,
        reason:'',
      };
    } catch (error) {
      return {
        available:false,
        answer:'',
        results:[],
        reason:safeText(error?.code,60) || 'search_error',
      };
    }
  }

  async function apiAnalyze(request, cfg, user) {
    let body={};
    try {
      body=objectValue(await request?.json?.()) || {};
    } catch {}

    const fixtureId=positiveSafeInteger(body.fixtureId);
    const userId=positiveSafeInteger(user?.id);
    const requestedOrigin=safeText(body.origin,30);
    const analysisOrigin=requestedOrigin==='telegram_quick' ? 'telegram_quick' : 'miniapp';
    const recheckRequested=strictBoolean(body.recheck);
    const newsImpactRecheck=strictBoolean(body.newsImpactRecheck);
    const newsPublishedAt=normalizeNewsPublishedAt(body.newsPublishedAt);

    let newsImpactDecision='';
    let newsImpactAction='';
    let newsImpactRecoveryCode='';
    let newsImpactRecoveryFrom='';
    try { newsImpactDecision=safeText(cleanNewsImpactDecisionCode(body.newsImpactDecision),80); } catch {}
    try { newsImpactAction=safeText(cleanNewsImpactActionCode(body.newsImpactAction),80); } catch {}
    try { newsImpactRecoveryCode=safeText(cleanNewsImpactRecoveryCode(body.newsImpactRecoveryCode),80); } catch {}
    try { newsImpactRecoveryFrom=safeText(cleanNewsImpactActionCode(body.newsImpactRecoveryFrom),80); } catch {}

    const trackFullAi=analysisOrigin!=='telegram_quick';
    if (fixtureId === null) return json({error:'Некорректный номер матча.'},400);
    if (userId === null) return json({error:'Пользователь не авторизован.'},401);

    const fireAndForget=(fn,...args)=>{
      try {
        const pending=fn(...args);
        if (pending && typeof pending.catch==='function') void pending.catch(()=>null);
      } catch {}
    };
    const safeRecordHistory=async payload=>{
      try { await recordHistory(userId,payload,cfg); } catch {}
    };
    const recordTrackedFullAiOutcome=async (delivery='analysis')=>{
      if (!(trackFullAi && newsImpactDecision && newsImpactAction==='full_ai')) return;
      try {
        await recordNewsImpactOutcome(cfg,{
          userId,
          fixtureId,
          decision:newsImpactDecision,
          action:'full_ai',
          channel:'miniapp',
          delivery:safeText(delivery,40) || 'analysis',
        });
      } catch {}
    };

    if (trackFullAi && newsImpactDecision && newsImpactAction==='full_ai') {
      if (newsImpactRecoveryCode) {
        try {
          await recordNewsImpactRecoveryAttempt(cfg,{
            userId,
            fixtureId,
            decision:newsImpactDecision,
            action:'full_ai',
            recovery:newsImpactRecoveryCode,
            sourceAction:newsImpactRecoveryFrom,
            channel:'miniapp',
          });
        } catch {}
      }
      fireAndForget(recordGrowthEvent,cfg,{
        userId,
        eventName:'news_impact_action',
        channel:'miniapp',
        fixtureId,
        metadata:{
          decision:newsImpactDecision,
          action:'full_ai',
          ...(newsImpactRecoveryCode ? {recovery:newsImpactRecoveryCode} : {}),
        },
      });
    }

    const recordTrackedFullAiFailure=async (reason='server_error',status=0)=>{
      if (!(trackFullAi && newsImpactDecision && newsImpactAction==='full_ai')) return null;
      try {
        const recovery=objectValue(
          await selectNewsImpactRecoveryStrategy(cfg,safeText(reason,120) || 'server_error','full_ai'),
        );
        if (!recovery) return null;
        await recordNewsImpactFailure(cfg,{
          userId,
          fixtureId,
          decision:newsImpactDecision,
          action:'full_ai',
          channel:'miniapp',
          reason:safeText(reason,120) || 'server_error',
          recovery:safeText(recovery.code,120),
          strategy:safeText(recovery.strategy,120),
          strategyReason:safeText(recovery.guardReason,240),
          status:nonNegativeSafeInteger(status,999) ?? 0,
        }).catch(()=>null);
        return recovery;
      } catch {
        return null;
      }
    };
    const trackedFullAiFailureResponse=async (payload,status,reason,headers={})=>{
      const recovery=await recordTrackedFullAiFailure(reason,status);
      return json({
        ...(objectValue(payload) || {}),
        ...(recovery ? {newsImpactRecovery:recovery} : {}),
      },status,objectValue(headers) || {});
    };

    try {
    const cacheKey=`fixture:${fixtureId}:v16-season-strength-rc145`;
    const cachedCandidate=await optionalAsync(getCache,cacheKey,cfg);
    const cached=analysisCachePayload(cachedCandidate,fixtureId);
    const staleCandidate=cached || await optionalAsync(getStaleCache,cacheKey,cfg);
    const staleBefore=analysisCachePayload(staleCandidate,fixtureId);
    if ((cachedCandidate && !cached) || (staleCandidate && !staleBefore)) {
      await recordOpsEvent(cfg,{
        severity:'warning',
        source:'cache',
        eventType:'analysis_cache_rejected',
        code:'ANALYSIS_CACHE_INVALID',
        message:'AI analysis ignored a cache entry whose fixture identity was invalid.',
        meta:{fixtureId},
      }).catch(()=>null);
    }
    let previousFreshness=null;
    if (staleBefore) {
      try { previousFreshness=objectValue(analysisFreshness(staleBefore)); } catch {}
    }
    const previousGeneratedMs=Date.parse(safeText(staleBefore?.generatedAt,80));
    const newsPublishedMs=Date.parse(newsPublishedAt);
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
    // Only freshness derived from the stored server-side snapshot can waive
    // quota. News-impact flags/timestamps arrive from the client and may request
    // a comparison, but must never mint free provider work on their own.
    if (needsFreshnessRecheck) {
      try { freeRecheck=await userHasAnalyzedFixture(userId,fixtureId,cfg) === true; }
      catch { freeRecheck=false; }
    }
    if (cached && !needsFreshnessRecheck) {
      if (!newsImpactEligible) {
        await safeRecordHistory(cached);
        if (trackFullAi) fireAndForget(recordGrowthEvent,cfg,{userId,eventName:'full_ai',channel:'miniapp',fixtureId,metadata:{cached:true,freshness:safeText(previousFreshness?.state,40) || 'fresh'}});
        const newsImpact=safeNewsImpactDeltaStatus(
          staleBefore,
          cached,
          null,
          {
            requested:newsImpactRecheck,
            eligible:newsImpactEligible,
            performed:false,
            publishedAt:newsPublishedAt,
          },
        );
        await recordTrackedFullAiOutcome('cached');
        return json(safeAnalysisResponsePayload(cached,{cached:true,stale:false,recheck:{requested:recheckRequested,performed:false,free:false,reasonCode:recheckReasonCode},newsImpact,quota:await quotaSnapshotForResponse(userId,cfg,null)}));
      }
    }
  
    const entitlementBefore=objectValue(
      await optionalAsync(resolveUserEntitlements,userId,fixtureId,cfg),
    ) || {source:'free',access:{},passes:{}};
    const activePass=objectValue(objectValue(entitlementBefore.passes)?.active);
    const passCandidate=entitlementBefore.source==='pass'
      && objectValue(entitlementBefore.access)?.expandedAi === true
      && Boolean(activePass);
    let quotaBefore;
    try {
      quotaBefore=quotaSnapshot(await getQuota(userId,cfg),null);
    } catch {
      quotaBefore=null;
    }
    if (!quotaBefore) {
      return await trackedFullAiFailureResponse({
        error:'Не удалось безопасно проверить лимит AI-анализов. Повторите позже.',
        code:'ANALYSIS_QUOTA_UNAVAILABLE',
      },503,'quota_unavailable',{'retry-after':'30'});
    }
    if (!freeRecheck && !passCandidate && quotaBefore.left<=0) {
      return await trackedFullAiFailureResponse({
        error:`Лимит исчерпан: ${quotaBefore.used}/${quotaBefore.limit} анализов сегодня.`,
        code:'ANALYSIS_QUOTA_EXHAUSTED',
        quota:quotaBefore,
      },429,'quota_exhausted');
    }
  
    const analysisLock=objectValue(
      await optionalAsync(claimDistributedAnalysisLock,fixtureId,cfg),
    ) || {claimed:false,unavailable:true};
    if (!analysisLock.claimed && analysisLock.unavailable) {
      if (staleBefore) {
        await safeRecordHistory(staleBefore);
        return json(safeAnalysisResponsePayload(staleBefore,{cached:true,stale:true,warning:'Координация нового AI-расчёта временно недоступна. Показан последний сохранённый анализ.',retryAfter:5,quota:quotaBefore}));
      }
      return await trackedFullAiFailureResponse({error:'Координация AI-расчёта временно недоступна. Повторите через несколько секунд.',code:'ANALYSIS_COORDINATION_DEGRADED',retryAfter:5,quota:quotaBefore},503,'analysis_coordination_degraded',{'retry-after':'5'});
    }
    if (!analysisLock.claimed) {
      const joinedCandidate=await optionalAsync(waitForSharedAnalysis,cacheKey,cfg);
      const joined=analysisCachePayload(joinedCandidate,fixtureId);
      if (joinedCandidate && !joined) {
        await recordOpsEvent(cfg,{
          severity:'warning',
          source:'cache',
          eventType:'analysis_shared_cache_rejected',
          code:'ANALYSIS_SHARED_CACHE_INVALID',
          message:'Shared AI analysis result was rejected because fixture identity did not match.',
          meta:{fixtureId},
        }).catch(()=>null);
      }
      if (joined) {
        await safeRecordHistory(joined);
        if (trackFullAi) {
          fireAndForget(recordGrowthEvent,cfg,{
            userId,
            eventName:'full_ai',
            channel:'miniapp',
            fixtureId,
            metadata:{cached:true,sharedJoin:true},
          });
        }
        await recordTrackedFullAiOutcome('shared');
        return json(safeAnalysisResponsePayload(joined,{cached:true,stale:false,sharedJoin:true,recheck:{requested:recheckRequested,performed:shouldPerformRecheck,free:freeRecheck,reasonCode:newsImpactEligible ? 'news_impact_shared' : (previousFreshness?.reasonCode || 'shared_compute')},quota:await quotaSnapshotForResponse(userId,cfg,quotaBefore)}));
      }
      if (staleBefore) {
        await safeRecordHistory(staleBefore);
        await recordTrackedFullAiOutcome('stale_pending');
        return json(safeAnalysisResponsePayload(staleBefore,{cached:true,stale:true,sharedJoinPending:true,warning:'Свежий расчёт этого матча уже выполняется. Пока показан последний сохранённый анализ.',retryAfter:5,recheck:{requested:recheckRequested,performed:false,free:freeRecheck,reasonCode:'shared_compute_pending'},quota:quotaBefore}));
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
        passUsageReservation=objectValue(await reserveEntitlementUsage(
          userId,
          activePass,
          fixtureId,
          cfg,
          {
            durable:safePredicate(hasSupabase,cfg),
            operationId:passOperationId,
          },
        ));
      } catch (error) {
        await recordOpsEvent(cfg,{
          severity:'error',
          source:'quota',
          eventType:'analysis_usage_reservation',
          code:'ANALYSIS_PASS_RESERVATION_OUTCOME_UNKNOWN',
          message:'Limited Pass reservation response was not confirmed. A durable database reservation, if created, will be reconciled automatically.',
          meta:{
            operationId:passOperationId,
            fixtureId,
            error:safeText(error?.message || error,180) || 'unknown_error',
          },
        }).catch(()=>null);
        throw error;
      }
      passAccess=passUsageReservation?.allowed === true;
    }
    if (!freeRecheck && !passAccess) {
      usageReservation=objectValue(await reserveAnalysisQuota(userId,cfg));
      if (!usageReservation) {
        return await trackedFullAiFailureResponse({
          error:'Не удалось безопасно зарезервировать лимит AI-анализа. Повторите позже.',
          code:'ANALYSIS_QUOTA_RESERVATION_INVALID',
          quota:quotaBefore,
        },503,'quota_reservation_invalid',{'retry-after':'30'});
      }
      if (usageReservation.allowed !== true) {
        const rejectedQuota=quotaSnapshot(usageReservation,quotaBefore) || quotaBefore;
        return await trackedFullAiFailureResponse({
          error:`Лимит исчерпан: ${rejectedQuota.used}/${rejectedQuota.limit} анализов сегодня.`,
          code:'ANALYSIS_QUOTA_EXHAUSTED',
          quota:rejectedQuota,
        },429,'quota_exhausted');
      }
    }
    let fixture;
    try {
      fixture=objectValue(await loadProviderFixture(fixtureId,cfg));
    } catch (error) {
      const providerLimited=safePredicate(isFootballRateLimitError,error);
      const transientProviderFailure=providerLimited
        || safePredicate(isRetryableFootballTransportError,error);
      if (staleBefore && transientProviderFailure) {
        await safeRecordHistory(staleBefore);
        if (trackFullAi) {
          fireAndForget(recordGrowthEvent,cfg,{
            userId,
            eventName:'full_ai',
            channel:'miniapp',
            fixtureId,
            metadata:{cached:true,stale:true},
          });
        }
        await recordTrackedFullAiOutcome('stale');
        return json(safeAnalysisResponsePayload(staleBefore,{
          cached:true,
          stale:true,
          warning:providerLimited
            ? 'Показан последний сохранённый анализ: источник футбольных данных временно ограничил запросы.'
            : 'Показан последний сохранённый анализ: источник футбольных данных временно недоступен.',
          retryAfter:boundedRetryAfter(error?.retryAfter,60),
          recheck:{
            requested:recheckRequested,
            performed:false,
            free:freeRecheck,
            reasonCode:newsImpactEligible
              ? 'news_impact_provider_unavailable'
              : (safeText(previousFreshness?.reasonCode,80) || 'provider_unavailable'),
          },
          quota:quotaBefore,
        }));
      }
      throw error;
    }

    if (!fixture) return json({error:'Матч не найден.'},404);

    const loadedFixtureId=positiveSafeInteger(fixture?.fixture?.id);
    if (loadedFixtureId!==fixtureId) {
      await recordOpsEvent(cfg,{
        severity:'warning',
        source:'integrity',
        eventType:'single_fixture_guard',
        code:'ANALYSIS_FIXTURE_ID_MISMATCH',
        message:'Analysis provider returned a fixture outside the requested identity.',
        meta:{fixtureId,loadedFixtureId},
      }).catch(()=>null);
      return await trackedFullAiFailureResponse({
        error:'Источник вернул данные другого матча, поэтому анализ заблокирован.',
        code:'MATCH_IDENTITY_MISMATCH',
        quota:quotaBefore,
      },409,'data_invalid');
    }

    let analysisIntegrity;
    try {
      analysisIntegrity=objectValue(validateFixtureIntegrity(fixture,'',null));
    } catch {
      analysisIntegrity=null;
    }
    if (!analysisIntegrity) {
      analysisIntegrity={
        state:'invalid',
        qualityScore:0,
        quarantine:true,
        warnings:[],
        issues:[{severity:'error',code:'integrity_check_unavailable'}],
      };
    }

    const integrityIssues=rowsOrEmpty(analysisIntegrity.issues,50);
    const integrityWarnings=rowsOrEmpty(analysisIntegrity.warnings,50);
    if (analysisIntegrity.quarantine === true) {
      await recordOpsEvent(cfg,{
        severity:'warning',
        source:'integrity',
        eventType:'single_fixture_guard',
        code:'ANALYSIS_REJECTED',
        message:'Анализ отклонён: данные матча не прошли структурную проверку.',
        meta:{
          fixtureId,
          issues:integrityIssues
            .filter(issue=>issue?.severity==='error')
            .map(issue=>safeText(issue?.code,80))
            .filter(Boolean)
            .slice(0,12),
        },
      }).catch(()=>null);
      return await trackedFullAiFailureResponse({
        error:'Данные матча выглядят противоречиво, поэтому анализ временно заблокирован.',
        code:'MATCH_DATA_INVALID',
        integrity:{...analysisIntegrity,issues:integrityIssues,warnings:integrityWarnings},
        quota:quotaBefore,
      },409,'data_invalid');
    }

    const status=safeText(fixture?.fixture?.status?.short,24);
    // If this fixture has already finished, settle any earlier immutable pre-match snapshot without another football API call.
    if (safePredicate(isFinishedStatus,status)) {
      await optionalAsync(settlePredictionsFromFixtures,[fixture],cfg);
    }

    const homeId=positiveSafeInteger(fixture?.teams?.home?.id);
    const awayId=positiveSafeInteger(fixture?.teams?.away?.id);
    if (!homeId || !awayId || homeId===awayId) {
      return await trackedFullAiFailureResponse({
        error:'Команды матча не прошли проверку идентификаторов.',
        code:'MATCH_TEAM_IDENTITY_INVALID',
        quota:quotaBefore,
      },409,'data_invalid');
    }

    const homeName=safeText(fixture?.teams?.home?.name,180);
    const awayName=safeText(fixture?.teams?.away?.name,180);
    const leagueName=safeText(fixture?.league?.name,180);

    const kickoffRaw=safeText(fixture?.fixture?.date,80);
    const kickoffMs=kickoffRaw ? Date.parse(kickoffRaw) : NaN;
    const minutesToKickoff=Number.isFinite(kickoffMs)
      ? Math.round((kickoffMs-Date.now())/60000)
      : null;

    let detailedCoverage=false;
    try {
      detailedCoverage=isYouthReserveMatch(leagueName,homeName,awayName)!==true;
    } catch {
      detailedCoverage=false;
    }

    const providerPlan=safeText(memory?.provider?.plan,40).toUpperCase() || 'UNKNOWN';
    const paid=['PRO','ULTRA','MEGA'].includes(providerPlan);
    const healthyFree=quotaHealthy(30,6);
    // FREE keeps only the two highest-value uncached AI provider calls (predictions + odds).
    // Optional signals reuse shared cache when present but do not fan out into
    // injuries/H2H/lineups/team-form network calls in the same minute.
    const canFetchLineups = detailedCoverage && paid && (
      safePredicate(isLiveStatus,status) || (minutesToKickoff !== null && minutesToKickoff <= 90 && minutesToKickoff >= -240)
    );
    const canFetchFreshForm = detailedCoverage && paid && healthyFree;
    const canFetchH2H = detailedCoverage && paid;
    const canFetchInjuries=detailedCoverage && paid;
  
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
      : minutesToKickoff === null || (!safePredicate(isLiveStatus,status) && (minutesToKickoff > 90 || minutesToKickoff < -240))
        ? 'publication_window'
        : canFetchLineups ? '' : 'quota_reserve';
  
    const [injuryResult,predictionResult,oddsResult,h2hResult]=await Promise.all([
      safeAnalysisProviderFetch({
        feature:'injuries',
        path:'/injuries',
        params:{fixture:fixtureId},
        fixtureId,
        cfg,
        allowed:canFetchInjuries,
        skipReason:injurySkipReason,
      }),
      safeAnalysisProviderFetch({
        feature:'predictions',
        path:'/predictions',
        params:{fixture:fixtureId},
        fixtureId,
        cfg,
      }),
      safeAnalysisProviderFetch({
        feature:'odds',
        path:'/odds',
        params:{fixture:fixtureId},
        fixtureId,
        cfg,
      }),
      safeAnalysisProviderFetch({
        feature:'h2h',
        path:'/fixtures/headtohead',
        params:{h2h:`${homeId}-${awayId}`,last:5},
        fixtureId,
        cfg,
        allowed:canFetchH2H,
        skipReason:h2hSkipReason,
      }),
    ]);
    const lineupResult=await safeAnalysisProviderFetch({
      feature:'lineups',
      path:'/fixtures/lineups',
      params:{fixture:fixtureId},
      fixtureId,
      cfg,
      allowed:canFetchLineups,
      skipReason:lineupSkipReason,
    });

    const injuries=rowsOrEmpty(injuryResult.data,500);
    const predictions=rowsOrEmpty(predictionResult.data,50);
    const odds=rowsOrEmpty(oddsResult.data,100);
    const h2hRows=rowsOrEmpty(h2hResult.data,20);
    const lineupsRows=rowsOrEmpty(lineupResult.data,20);

    let lineups={};
    try { lineups=objectValue(formatLineups(lineupsRows,homeId,awayId)) || {}; }
    catch { lineups={}; }

    let lineupQuality;
    try { lineupQuality=objectValue(assessMatchLineups(lineups)); } catch {}
    if (!lineupQuality) {
      lineupQuality={
        home:{confirmed:false},
        away:{confirmed:false},
        bothConfirmed:false,
        bothPublished:false,
        anyPublished:false,
        confirmedSides:0,
        partialSides:0,
      };
    }

    let lineupMeta=lineupResult.meta;
    try {
      lineupMeta=objectValue(
        annotateLineupReliability(lineupResult.meta,lineupQuality),
      ) || lineupResult.meta;
    } catch {}

    let primaryMarket=null;
    try { primaryMarket=objectValue(extractMarket(odds)); } catch {}

    let primaryMarketMeta=objectValue(oddsResult.meta) || unavailableFeatureMeta('odds');
    try {
      primaryMarketMeta=objectValue(
        usableOddsFeatureMeta(primaryMarketMeta,primaryMarket),
      ) || primaryMarketMeta;
    } catch {}

    let primaryMarketShape={marketValid:false};
    try {
      primaryMarketShape=objectValue(assessOddsMarketQuality(primaryMarket,{
        oddsMeta:primaryMarketMeta,
        mode:'upcoming',
      })) || primaryMarketShape;
    } catch {}

    let secondaryOdds=null;
    if (!(primaryMarket && primaryMarketShape.marketValid === true)) {
      try {
        secondaryOdds=objectValue(
          await secondaryOddsMarket(fixture,cfg,{mode:'prematch'}),
        );
      } catch {
        secondaryOdds=null;
      }
    }

    const secondaryMarket=secondaryOdds?.available === true
      ? objectValue(secondaryOdds.market)
      : null;
    const market=secondaryMarket || primaryMarket;

    let resolvedOddsMeta;
    try {
      resolvedOddsMeta=objectValue(
        secondaryMarket
          ? usableOddsFeatureMeta(secondaryOdds?.meta,market)
          : usableOddsFeatureMeta(
              oddsResult.meta,
              primaryMarket,
              safeText(secondaryOdds?.reason,120),
            ),
      );
    } catch {}
    resolvedOddsMeta=resolvedOddsMeta
      || objectValue(oddsResult.meta)
      || unavailableFeatureMeta('odds');

    let analysisFeatureMeta;
    try {
      analysisFeatureMeta=objectValue(applyFeatureFreshnessMap({
        injuries:injuryResult.meta,
        predictions:predictionResult.meta,
        odds:resolvedOddsMeta,
        h2h:h2hResult.meta,
        lineups:lineupMeta,
      },{mode:'upcoming'}));
    } catch {}
    analysisFeatureMeta=analysisFeatureMeta || {
      injuries:injuryResult.meta,
      predictions:predictionResult.meta,
      odds:resolvedOddsMeta,
      h2h:h2hResult.meta,
      lineups:lineupMeta,
    };

    let oddsQuality={marketValid:false,confidenceBearing:false};
    try {
      oddsQuality=objectValue(assessOddsMarketQuality(market,{
        oddsMeta:objectValue(analysisFeatureMeta.odds) || {},
        mode:'upcoming',
      })) || oddsQuality;
    } catch {}

    try {
      analysisFeatureMeta.odds=objectValue(annotateOddsReliability(
        objectValue(analysisFeatureMeta.odds) || {feature:'odds'},
        oddsQuality,
      )) || objectValue(analysisFeatureMeta.odds) || unavailableFeatureMeta('odds');
    } catch {
      analysisFeatureMeta.odds=objectValue(analysisFeatureMeta.odds)
        || unavailableFeatureMeta('odds');
    }

    let analysisMarket=null;
    try { analysisMarket=objectValue(oddsMarketForTrustedAnalytics(market,oddsQuality)); }
    catch { analysisMarket=null; }

    let availabilityQuality;
    try {
      availabilityQuality=objectValue(assessFixtureAvailabilityQuality(injuries,{
        homeId,
        awayId,
        injuriesMeta:objectValue(analysisFeatureMeta.injuries) || {},
        mode:'upcoming',
      }));
    } catch {}
    availabilityQuality=availabilityQuality || {
      state:'invalid',
      acceptedCount:0,
      rejectedCount:injuries.length,
      confidenceBearing:false,
      issues:[{code:'availability_quality_unavailable'}],
    };

    try {
      analysisFeatureMeta.injuries=objectValue(annotateAvailabilityReliability(
        objectValue(analysisFeatureMeta.injuries)
          || {feature:'injuries',provider:'api-football',source:'network'},
        availabilityQuality,
      )) || unavailableFeatureMeta('injuries','availability_quality_unavailable');
    } catch {
      analysisFeatureMeta.injuries=unavailableFeatureMeta(
        'injuries',
        'availability_quality_unavailable',
      );
    }

    let trustedInjuries=[];
    try {
      trustedInjuries=rowsOrEmpty(
        sanitizeAvailabilityRows(injuries,availabilityQuality),
        500,
      );
    } catch {
      trustedInjuries=[];
    }

    let providerReliability;
    try {
      providerReliability=objectValue(providerDataReliabilitySummary(
        analysisFeatureMeta,
        {minutesToKickoff,mode:'upcoming'},
      ));
    } catch {}
    providerReliability=providerReliability || {
      state:'degraded',
      trustCap:0,
      available:0,
      checked:0,
      features:analysisFeatureMeta,
      warnings:['Надёжность части входных данных не удалось подтвердить.'],
    };
    providerReliability.features=objectValue(providerReliability.features)
      || analysisFeatureMeta;
    providerReliability.warnings=rowsOrEmpty(providerReliability.warnings,30)
      .map(value=>safeText(value,360))
      .filter(Boolean);
    skipped.push(...providerReliability.warnings);

    const webPromise=tavilySearch(
      `${homeName} ${awayName} injuries team news probable lineups latest`,
      cfg,
    );
    const homeFormPromise=detailedCoverage
      ? optionalAsync(
          getRecentTeamForm,
          homeId,
          'home',
          kickoffRaw,
          fixtureId,
          cfg,
          {allowNetwork:canFetchFreshForm},
        )
      : Promise.resolve(null);
    const awayFormPromise=detailedCoverage
      ? optionalAsync(
          getRecentTeamForm,
          awayId,
          'away',
          kickoffRaw,
          fixtureId,
          cfg,
          {allowNetwork:canFetchFreshForm},
        )
      : Promise.resolve(null);
    const refereeHistoryPromise=optionalAsync(
      loadRefereeHistoryProfile,
      safeText(fixture?.fixture?.referee,180),
      cfg,
    );
    const [webRaw,homeFormRaw,awayFormRaw,refereeHistoryRaw]=await Promise.all([
      webPromise,
      homeFormPromise,
      awayFormPromise,
      refereeHistoryPromise,
    ]);
    const web=objectValue(webRaw) || {
      available:false,
      answer:'',
      results:[],
      reason:'unavailable',
    };
    const homeForm=objectValue(homeFormRaw);
    const awayForm=objectValue(awayFormRaw);
    const refereeHistory=objectValue(refereeHistoryRaw) || {
      available:false,
      sample:0,
    };

    // Match Comparison only reuses already cached deep team data.
    const leagueId=positiveSafeInteger(fixture?.league?.id) || 0;
    const season=safeSeason(fixture?.league?.season);
    const comparisonCompetition={leagueId,season};
    const [
      homeStandingRaw,
      awayStandingRaw,
      homeTeamIntelligenceRaw,
      awayTeamIntelligenceRaw,
    ]=await Promise.all([
      leagueId && season
        ? optionalAsync(cachedTeamStanding,homeId,comparisonCompetition,cfg)
        : Promise.resolve(null),
      leagueId && season
        ? optionalAsync(cachedTeamStanding,awayId,comparisonCompetition,cfg)
        : Promise.resolve(null),
      leagueId && season
        ? optionalAsync(cachedTeamIntelligenceForAnalysis,homeId,leagueId,season,cfg)
        : Promise.resolve(null),
      leagueId && season
        ? optionalAsync(cachedTeamIntelligenceForAnalysis,awayId,leagueId,season,cfg)
        : Promise.resolve(null),
    ]);
    const homeStanding=objectValue(homeStandingRaw);
    const awayStanding=objectValue(awayStandingRaw);
    const homeTeamIntelligence=objectValue(homeTeamIntelligenceRaw) || {};
    const awayTeamIntelligence=objectValue(awayTeamIntelligenceRaw) || {};
    const cachedHomeSeasonStats=objectValue(homeTeamIntelligence.stats);
    const cachedAwaySeasonStats=objectValue(awayTeamIntelligence.stats);
    const canFetchSeasonStrength=Boolean(
      detailedCoverage
      && paid
      && healthyFree
      && leagueId
      && season,
    );
    const [homeSeasonFreshRaw,awaySeasonFreshRaw]=await Promise.all([
      cachedHomeSeasonStats
        ? Promise.resolve(null)
        : optionalAsync(loadSeasonStatsForAnalysis,{
            teamId:homeId,
            teamName:homeName,
            teamLogo:safeText(fixture?.teams?.home?.logo,500),
            leagueId,
            leagueName,
            leagueLogo:safeText(fixture?.league?.logo,500),
            country:safeText(fixture?.league?.country,120),
            season,
            cfg,
            allowNetwork:canFetchSeasonStrength,
          }),
      cachedAwaySeasonStats
        ? Promise.resolve(null)
        : optionalAsync(loadSeasonStatsForAnalysis,{
            teamId:awayId,
            teamName:awayName,
            teamLogo:safeText(fixture?.teams?.away?.logo,500),
            leagueId,
            leagueName,
            leagueLogo:safeText(fixture?.league?.logo,500),
            country:safeText(fixture?.league?.country,120),
            season,
            cfg,
            allowNetwork:canFetchSeasonStrength,
          }),
    ]);
    const homeSeasonStats=cachedHomeSeasonStats
      || objectValue(homeSeasonFreshRaw);
    const awaySeasonStats=cachedAwaySeasonStats
      || objectValue(awaySeasonFreshRaw);
    if (paid && detailedCoverage && (!homeSeasonStats || !awaySeasonStats)) {
      skipped.push('Сезонная сила команд рассчитана частично: статистика сезона одной из команд пока недоступна.');
    }
    const cachedHomePlayerStats=objectValue(homeTeamIntelligence.playerStats);
    const cachedAwayPlayerStats=objectValue(awayTeamIntelligence.playerStats);

    const previousMarketSnapshots=analysisMarket
      ? rowsOrEmpty(await optionalAsync(getOddsSnapshots,fixtureId,cfg,8),20)
      : [];
    let marketMovement=null;
    try {
      marketMovement=objectValue(buildOddsMovement(previousMarketSnapshots,analysisMarket));
    } catch {}
    if (analysisMarket) {
      try { await saveOddsSnapshot(fixtureId,analysisMarket,cfg); } catch {}
    }

    const featureTrusted=feature=>{
      const meta=objectValue(analysisFeatureMeta?.[feature]);
      return meta?.confidenceBearing === true && meta?.stale !== true;
    };

    let apiPrediction=null;
    try { apiPrediction=objectValue(extractPrediction(predictions)); } catch {}
    const trustedApiPrediction=featureTrusted('predictions') ? apiPrediction : null;

    let h2h=null;
    try { h2h=objectValue(formatH2H(h2hRows,homeId,awayId)); } catch {}
    const trustedH2h=featureTrusted('h2h') ? h2h : null;
    const trustedLineups=featureTrusted('lineups') ? lineups : {};

    let normalizedAbsences=null;
    try {
      normalizedAbsences=objectValue(
        formatAbsences(trustedInjuries,homeId,awayId,trustedLineups),
      );
    } catch {}

    const baseAbsences=normalizedAbsences
      && Array.isArray(normalizedAbsences.home)
      && Array.isArray(normalizedAbsences.away)
      ? {
          ...normalizedAbsences,
          home:normalizedAbsences.home.slice(0,200),
          away:normalizedAbsences.away.slice(0,200),
        }
      : {
          home:[],
          away:[],
          summary:{home:{total:0},away:{total:0},resolvedByLineup:0},
          resolvedByLineup:{home:[],away:[]},
          source:'unavailable',
          methodology:'Данные о потерях недоступны; анализ продолжен без этого сигнала.',
        };

    const roleHydrationMaxPages=paid ? 2 : 1;
    const [homeRoleRaw,awayRoleRaw]=await Promise.all([
      optionalAsync(hydratePlayerRolesForAnalysis,{
        teamId:homeId,
        teamName:homeName,
        leagueId,
        leagueName,
        season,
        cachedPlayerStats:cachedHomePlayerStats,
        needed:baseAbsences.home.length>0,
        cfg,
        maxPages:roleHydrationMaxPages,
      }),
      optionalAsync(hydratePlayerRolesForAnalysis,{
        teamId:awayId,
        teamName:awayName,
        leagueId,
        leagueName,
        season,
        cachedPlayerStats:cachedAwayPlayerStats,
        needed:baseAbsences.away.length>0,
        cfg,
        maxPages:roleHydrationMaxPages,
      }),
    ]);
    const homeRoleHydration=objectValue(homeRoleRaw) || {
      playerStats:null,
      source:'unavailable',
      network:false,
      stale:false,
      reason:'hydration_unavailable',
    };
    const awayRoleHydration=objectValue(awayRoleRaw) || {
      playerStats:null,
      source:'unavailable',
      network:false,
      stale:false,
      reason:'hydration_unavailable',
    };
    const homePlayerStats=objectValue(homeRoleHydration.playerStats);
    const awayPlayerStats=objectValue(awayRoleHydration.playerStats);
    if (baseAbsences.home.length && homePlayerStats?.available !== true) {
      skipped.push('Роль отсутствующих игроков хозяев не уточнена: сезонная статистика недоступна или сохранена квота.');
    }
    if (baseAbsences.away.length && awayPlayerStats?.available !== true) {
      skipped.push('Роль отсутствующих игроков гостей не уточнена: сезонная статистика недоступна или сохранена квота.');
    }

    let absences=baseAbsences;
    try {
      const enriched=objectValue(enrichFixtureAbsencesWithSeasonRole(
        baseAbsences,
        {homePlayerStats,awayPlayerStats},
      ));
      if (enriched && Array.isArray(enriched.home) && Array.isArray(enriched.away)) {
        absences=enriched;
      }
    } catch {}

    let lineupImpact={
      homeConfirmed:false,
      awayConfirmed:false,
      note:'Подтверждение стартовых составов недоступно.',
    };
    try {
      lineupImpact=objectValue(buildLineupImpact({
        absences,
        lineups,
        homeName,
        awayName,
        reliability:providerReliability,
      })) || lineupImpact;
    } catch {}

    let recentFormProb=null;
    try { recentFormProb=objectValue(formProbabilities(homeForm,awayForm)); } catch {}
    let h2hProb=null;
    if (trustedH2h) {
      try { h2hProb=objectValue(h2hProbabilities(trustedH2h)); } catch {}
    }
    let seasonStrengthProb=null;
    try {
      seasonStrengthProb=objectValue(seasonStrengthProbabilities(
        homeStanding,
        awayStanding,
        homeSeasonStats,
        awaySeasonStats,
      ));
    } catch {}

    const calibrationProfile=calibrationProfileValue(
      await optionalAsync(getCalibrationProfile,cfg),
    );

    let baselineBlend;
    try {
      baselineBlend=objectValue(blendProbabilitySignals({
        market:analysisMarket,
        model:trustedApiPrediction,
        form:recentFormProb,
        seasonStrength:seasonStrengthProb,
        h2h:h2hProb,
        weightOverrides:normalizedModelBaseWeights(),
      }));
    } catch {}
    const baselineProbabilities=probabilityVector(baselineBlend?.probabilities);
    if (!baselineBlend || !baselineProbabilities) {
      return await trackedFullAiFailureResponse({
        error:'Модель не смогла построить корректные вероятности для этого матча.',
        code:'ANALYSIS_MODEL_INVALID',
        quota:quotaBefore,
      },503,'model_invalid');
    }
    baselineBlend={...baselineBlend,probabilities:baselineProbabilities};

    let blended=baselineBlend;
    if (calibrationProfile.weightsActive) {
      try {
        const candidate=objectValue(blendProbabilitySignals({
          market:analysisMarket,
          model:trustedApiPrediction,
          form:recentFormProb,
          seasonStrength:seasonStrengthProb,
          h2h:h2hProb,
          weightOverrides:calibrationProfile.signalWeights,
        }));
        const candidateProbabilities=probabilityVector(candidate?.probabilities);
        if (candidate && candidateProbabilities) {
          blended={...candidate,probabilities:candidateProbabilities};
        } else {
          calibrationProfile.weightsActive=false;
        }
      } catch {
        calibrationProfile.weightsActive=false;
      }
    }

    let rawProbabilities;
    try {
      rawProbabilities=probabilityVector(
        applyAbsenceAdjustment(baselineBlend.probabilities,absences),
      );
    } catch {}
    if (!rawProbabilities) {
      return await trackedFullAiFailureResponse({
        error:'Корректировка вероятностей по составу вернула некорректный результат.',
        code:'ANALYSIS_ABSENCE_MODEL_INVALID',
        quota:quotaBefore,
      },503,'model_invalid');
    }

    let weightedProbabilities;
    try {
      weightedProbabilities=probabilityVector(
        applyAbsenceAdjustment(blended.probabilities,absences),
      );
    } catch {}
    if (!weightedProbabilities) weightedProbabilities=rawProbabilities;

    let probabilities=weightedProbabilities;
    if (calibrationProfile.temperatureActive) {
      try {
        const calibrated=probabilityVector(temperatureScaleProbabilities(
          weightedProbabilities,
          calibrationProfile.temperature,
        ));
        if (calibrated) probabilities=calibrated;
        else calibrationProfile.temperatureActive=false;
      } catch {
        calibrationProfile.temperatureActive=false;
      }
    }

    if (
      calibrationProfile.mode==='active'
      && !calibrationProfile.weightsActive
      && !calibrationProfile.temperatureActive
    ) {
      calibrationProfile.mode='baseline';
    }

    let goalModel=null;
    try { goalModel=objectValue(poissonGoalModel(homeForm,awayForm)); } catch {}

    let comparison={
      metrics:[],
      advantages:{home:[],away:[]},
      score:{home:0,away:0,even:0},
      balanceLabel:'Недостаточно данных для сравнения',
      dataReuse:{separateApiRequests:0,sources:[]},
    };
    try {
      comparison=objectValue(buildMatchComparison({
        homeName,
        awayName,
        homeForm,
        awayForm,
        homeStanding,
        awayStanding,
        homeSeasonStats,
        awaySeasonStats,
        goalModel,
        h2h:trustedH2h,
        absences,
        hasInjuryData:featureTrusted('injuries'),
      })) || comparison;
    } catch {}

    let confidence={
      score:0,
      signalCount:0,
      disagreement:100,
      agreement:0,
    };
    try {
      confidence=objectValue(confidenceModel(
        rowsOrEmpty(blended.signals,20),
        probabilities,
        homeForm,
        awayForm,
      )) || confidence;
    } catch {}

    let notes={factors:[],risks:[]};
    try {
      notes=objectValue(buildAnalysisNotes({
        probabilities,
        market:analysisMarket,
        model:trustedApiPrediction,
        homeForm,
        awayForm,
        h2h:trustedH2h,
        absences,
        lineups,
        news:web,
        homeName,
        awayName,
        minutesToKickoff,
        confidence,
      })) || notes;
    } catch {}
    notes.factors=rowsOrEmpty(notes.factors,20)
      .map(value=>safeText(value,500))
      .filter(Boolean);
    notes.risks=rowsOrEmpty(notes.risks,20)
      .map(value=>safeText(value,500))
      .filter(Boolean);
    notes.risks.push(...providerReliability.warnings);
    notes.risks=[...new Set(notes.risks)].slice(0,7);

    if (calibrationProfile.mode==='active') {
      notes.factors.unshift(
        `Калибратор вероятностей активен (${safeText(calibrationProfile.fingerprint,8) || 'базовый'}) на базе ${calibrationProfile.sample} доверенных прогнозов.`,
      );
    } else if (calibrationProfile.mode==='shadow') {
      notes.risks.push(
        'Калибратор пока работает в теневом режиме: выборка собирается, но итоговые вероятности ещё не корректируются автоматически.',
      );
    }
    notes.factors=[...new Set(notes.factors)].slice(0,7);
    notes.risks=[...new Set(notes.risks)].slice(0,7);

    const availableSignals=[
      analysisMarket && 'market',
      trustedApiPrediction && 'apiPrediction',
      homeForm?.overall && awayForm?.overall && 'recentForm',
      seasonStrengthProb && 'seasonStrength',
      trustedH2h && 'h2h',
      trustedInjuries.length && featureTrusted('injuries') && 'injuries',
      lineupQuality.bothConfirmed === true && featureTrusted('lineups') && 'lineups',
      safeText(web.answer,1) && 'web',
    ].filter(Boolean);

    const completenessPreview={
      score:[
        fixture,
        analysisMarket,
        trustedApiPrediction,
        trustedInjuries.length>0 && featureTrusted('injuries'),
        trustedH2h,
        lineupQuality.bothConfirmed === true && featureTrusted('lineups'),
        Boolean(safeText(web.answer,1)),
        homeForm?.overall,
        awayForm?.overall,
        goalModel,
      ].filter(Boolean).length,
      max:10,
      providerReliability:{
        state:safeText(providerReliability.state,40) || 'degraded',
        trustCap:finiteNumber(providerReliability.trustCap) ?? 0,
        available:nonNegativeSafeInteger(providerReliability.available,1000) ?? 0,
        checked:nonNegativeSafeInteger(providerReliability.checked,1000) ?? 0,
      },
    };

    let preMatchIntelligence=null;
    try {
      preMatchIntelligence=objectValue(buildPreMatchIntelligence({
        probabilities,
        rawProbabilities,
        market:analysisMarket,
        apiPrediction:trustedApiPrediction,
        homeForm,
        awayForm,
        h2h:trustedH2h,
        absences,
        lineups,
        goalModel,
        comparison,
        confidence,
        modelBreakdown:{
          weights:objectValue(blended.weights) || {},
          signals:rowsOrEmpty(blended.signals,20),
        },
        homeName,
        awayName,
        minutesToKickoff,
        news:web,
        completeness:completenessPreview,
      }));
    } catch {}

    let dataCapabilities={};
    try { dataCapabilities=objectValue(publicDataCapabilities()) || {}; } catch {}

    let likelyOutcome='Недостаточно данных';
    try {
      likelyOutcome=safeText(outcomeName(probabilities,homeName,awayName),240)
        || 'Недостаточно данных';
    } catch {}

    let refereeData=null;
    try {
      refereeData=objectValue(refereeProfile(safeText(fixture?.fixture?.referee,180)));
    } catch {}

    const safeSkipped=[...new Set(
      rowsOrEmpty(skipped,50).map(value=>safeText(value,500)).filter(Boolean),
    )].slice(0,20);
    const safeFeatureEntries=Object.entries(objectValue(analysisFeatureMeta) || {})
      .slice(0,30)
      .map(([feature,metaValue])=>{
        const meta=objectValue(metaValue) || {};
        const ageSeconds=nonNegativeSafeInteger(meta.ageSeconds,31_536_000);
        const freshnessLimitSeconds=nonNegativeSafeInteger(
          meta.freshnessLimitSeconds,
          31_536_000,
        );
        return [
          safeText(feature,40) || 'unknown',
          {
            provider:safeText(meta.provider,80) || 'api-football',
            source:safeText(meta.source,80) || 'network',
            state:safeText(meta.state,80) || 'unknown',
            fetchedAt:safeText(meta.fetchedAt,80) || null,
            ageSeconds,
            sourceUpdatedAt:safeText(meta.sourceUpdatedAt,80) || null,
            freshnessState:safeText(meta.freshnessState,80) || 'unknown',
            provenanceState:safeText(meta.provenanceState,80) || 'unknown',
            freshnessLimitSeconds,
            confidenceBearing:meta.confidenceBearing === true,
            stale:meta.stale === true,
          },
        ];
      });

    let aiInstructor={
      role:'football-ai-instructor',
      confidenceScore:0,
      confidenceLabel:'Низкая',
      riskLabel:'Высокий',
      betSignal:{
        code:'skip',
        label:'Пропустить ставку',
        strength:0,
        reason:'AI-инструктор не смог подтвердить рабочий сигнал.',
      },
      verdict:{
        outcome:'Нет данных',
        total:'Нет данных',
        btts:'Нет данных',
      },
      qualityGate:{
        state:'blocked',
        allowSignal:false,
        reasons:[{
          code:'instructor_unavailable',
          level:'block',
          text:'AI-инструктор временно недоступен.',
        }],
      },
      matchPlan:{
        checks:[],
        cancel:'Рабочего сигнала нет: дождитесь обновления данных.',
        liveWatch:'',
      },
    };
    try {
      aiInstructor=objectValue(buildAiInstructor({
        probabilities,
        goalModel,
        confidence,
        completeness:completenessPreview,
        factors:notes.factors,
        risks:[...notes.risks,...safeSkipped],
        referee:safeText(fixture?.fixture?.referee,180),
        refereeData,
        refereeHistory,
        lineupImpact,
        marketMovement,
        providerReliability,
        minutesToKickoff,
      })) || aiInstructor;
    } catch {}

    const generatedAt=new Date().toISOString();
    const payload={
      generatedAt,
      analysisVersion:'4.16.0-season-strength',
      match:{
        fixtureId,
        date:kickoffRaw,
        status,
        venue:safeText(fixture?.fixture?.venue?.name,180),
        city:safeText(fixture?.fixture?.venue?.city,180),
        referee:safeText(fixture?.fixture?.referee,180),
        leagueId,
        season,
        league:leagueName,
        country:safeText(fixture?.league?.country,120),
        home:{
          id:homeId,
          name:homeName,
          logo:safeHttpUrl(fixture?.teams?.home?.logo,500),
        },
        away:{
          id:awayId,
          name:awayName,
          logo:safeHttpUrl(fixture?.teams?.away?.logo,500),
        },
        integrity:{
          state:safeText(analysisIntegrity.state,40) || 'unknown',
          score:finiteNumber(analysisIntegrity.qualityScore),
          warnings:integrityWarnings
            .map(value=>safeText(value?.message ?? value,240))
            .filter(Boolean)
            .slice(0,6),
          issues:integrityIssues
            .filter(issue=>issue?.severity!=='info')
            .map(issue=>({
              severity:safeText(issue?.severity,40),
              code:safeText(issue?.code,80),
              message:safeText(issue?.message,240),
            }))
            .slice(0,3),
        },
      },
      probabilities,
      rawProbabilities,
      modelCalibration:{
        version:calibrationProfile.version,
        fingerprint:calibrationProfile.fingerprint,
        mode:calibrationProfile.mode,
        sample:calibrationProfile.sample,
        temperature:calibrationProfile.temperature,
        temperatureActive:calibrationProfile.temperatureActive === true,
        weightsActive:calibrationProfile.weightsActive === true,
        signalWeights:objectValue(calibrationProfile.signalWeights)
          || normalizedModelBaseWeights(),
        validation:objectValue(calibrationProfile.temperatureValidation),
        weightsValidation:objectValue(calibrationProfile.weightsValidation),
        promotionGate:objectValue(calibrationProfile.promotionGate),
        lifecycle:objectValue(calibrationProfile.lifecycle),
        note:safeText(calibrationProfile.note,1000),
      },
      confidence,
      likelyOutcome,
      modelBreakdown:{
        weights:objectValue(blended.weights) || {},
        signals:rowsOrEmpty(blended.signals,20),
        method:'Рынок, прогноз источника данных, недавняя форма, сила сезона и очные встречи объединяются динамически. Сила сезона использует атаку, оборону, сухие матчи и, когда доступно, положение в таблице. Активный профиль применяется только после двух окон отложенной выборки и атомарного сравнения кандидата с активной моделью. Потери состава корректируют итог ограниченно: роль игрока сначала берётся из Team Intelligence cache, а при реальной потере может точечно гидратироваться из сезонной статистики с отдельным кешем и quota guard; сомнительный статус даёт половинный вклад.',
      },
      dataPolicy:{
        dataMode:paid ? 'expanded' : 'standard',
        mode:paid ? 'full' : healthyFree ? 'balanced-free' : 'quota-saver',
        availableSignals,
        skipped:safeSkipped,
        featureReliability:analysisFeatureMeta,
        reliability:providerReliability,
      },
      dataCapabilities,
      dataProvenance:{
        primaryProvider:'api-football',
        generatedAt,
        features:Object.fromEntries(safeFeatureEntries),
        playerRoleHydration:{
          home:{
            source:safeText(homeRoleHydration.source,80) || 'unavailable',
            network:homeRoleHydration.network === true,
            stale:homeRoleHydration.stale === true,
            reason:safeText(homeRoleHydration.reason,160),
          },
          away:{
            source:safeText(awayRoleHydration.source,80) || 'unavailable',
            network:awayRoleHydration.network === true,
            stale:awayRoleHydration.stale === true,
            reason:safeText(awayRoleHydration.reason,160),
          },
        },
        news:{
          provider:'tavily',
          source:safeText(web.answer,1) || rowsOrEmpty(web.results,5).length
            ? 'network-or-cache'
            : 'unavailable',
          state:safeText(web.answer,1) || rowsOrEmpty(web.results,5).length
            ? 'available'
            : 'unavailable',
        },
      },
      market:analysisMarket,
      marketMovement,
      oddsQuality,
      availabilityQuality,
      apiPrediction:trustedApiPrediction,
      recentForm:{home:homeForm,away:awayForm},
      seasonStrength:{
        probabilities:seasonStrengthProb,
        homeSeasonAvailable:Boolean(homeSeasonStats),
        awaySeasonAvailable:Boolean(awaySeasonStats),
        networkFetchEnabled:canFetchSeasonStrength,
      },
      goalModel,
      comparison,
      absences,
      lineups,
      lineupQuality,
      lineupImpact,
      h2h:trustedH2h,
      preMatchIntelligence,
      aiInstructor,
      insights:notes.factors,
      risks:[...new Set([...notes.risks,...safeSkipped])].slice(0,12),
      news:web,
      completeness:completenessPreview,
      providerReliability,
      provider:dataCapabilities,
      disclaimer:'Расчёт основан на доступных статистических сигналах и не гарантирует исход матча. Это не финансовая рекомендация.',
    };

    const configuredTtl=finiteNumber(cfg?.cacheMinutes);
    let ttl=configuredTtl !== null && configuredTtl>=1 && configuredTtl<=1440
      ? configuredTtl
      : 45;
    if (safePredicate(isFinishedStatus,status)) ttl=720;
    else if (minutesToKickoff !== null && minutesToKickoff<=15) ttl=3;
    else if (minutesToKickoff !== null && minutesToKickoff<=45) ttl=5;
    else if (minutesToKickoff !== null && minutesToKickoff<=120) ttl=10;
    else if (minutesToKickoff !== null && minutesToKickoff<=360) ttl=20;
    else if (minutesToKickoff !== null && minutesToKickoff>360) ttl=45;

    let recheckDelta=null;
    if (needsFreshnessRecheck) {
      try { recheckDelta=objectValue(analysisRecheckDelta(staleBefore,payload)); } catch {}
    }
    let newsImpactRecheckDelta=null;
    if (!needsFreshnessRecheck && newsImpactEligible) {
      try {
        newsImpactRecheckDelta=objectValue(
          analysisRecheckDelta(staleBefore,payload),
        );
      } catch {}
    }
    const effectiveRecheckDelta=recheckDelta || newsImpactRecheckDelta;

    let newsImpact=null;
    try {
      newsImpact=safeNewsImpactDeltaStatus(
        staleBefore,
        payload,
        effectiveRecheckDelta,
        {
          requested:newsImpactRecheck,
          eligible:newsImpactEligible,
          performed:shouldPerformRecheck,
          publishedAt:newsPublishedAt,
        },
      );
    } catch {}

    let cacheStored=true;
    try {
      const result=await setCache(cacheKey,fixtureId,payload,cfg,ttl);
      if (result === false) cacheStored=false;
    } catch {
      cacheStored=false;
    }
    if (!cacheStored) {
      await recordOpsEvent(cfg,{
        severity:'warning',
        source:'cache',
        eventType:'analysis_cache_write',
        code:'ANALYSIS_CACHE_WRITE_FAILED',
        message:'AI analysis completed but could not be persisted in the shared cache.',
        meta:{fixtureId,ttl},
      }).catch(()=>null);
    }

    await optionalAsync(
      captureAnalysisTimelineSnapshot,
      payload,
      cfg,
      {delta:effectiveRecheckDelta},
    );
    await optionalAsync(captureModelPrediction,payload,cfg);
    await safeRecordHistory(payload);

    const deltaMetadata=delta=>({
      material:delta?.material === true,
      stable:delta?.stable === true,
      changeCount:Math.min(6,rowsOrEmpty(delta?.items,6).length),
      codes:rowsOrEmpty(delta?.codes,6)
        .map(code=>safeText(code,40))
        .filter(Boolean),
    });
    if (newsImpactEligible && !needsFreshnessRecheck) {
      fireAndForget(recordGrowthEvent,cfg,{
        userId,
        eventName:'analysis_recheck',
        channel:analysisOrigin==='telegram_quick' ? 'telegram' : 'miniapp',
        fixtureId,
        metadata:{
          free:freeRecheck,
          reason:'news_impact',
          ...deltaMetadata(effectiveRecheckDelta),
        },
      });
    }
    if (needsFreshnessRecheck) {
      fireAndForget(recordGrowthEvent,cfg,{
        userId,
        eventName:'analysis_recheck',
        channel:analysisOrigin==='telegram_quick' ? 'telegram' : 'miniapp',
        fixtureId,
        metadata:{
          free:freeRecheck,
          reason:safeText(previousFreshness?.reasonCode,80) || 'age_window',
          ...deltaMetadata(recheckDelta),
        },
      });
    }
    if (trackFullAi) {
      fireAndForget(recordGrowthEvent,cfg,{
        userId,
        eventName:'full_ai',
        channel:'miniapp',
        fixtureId,
        metadata:{cached:false,recheck:shouldPerformRecheck},
      });
    }

    await recordTrackedFullAiOutcome('fresh');
    const responseQuotaFallback=reservationQuotaSnapshot(
      usageReservation,
      quotaBefore,
    );
    const responseQuota=await quotaSnapshotForResponse(
      userId,
      cfg,
      responseQuotaFallback,
    );
    usageCommitted=true;
    return json(safeAnalysisResponsePayload(payload,{
      cached:false,
      stale:false,
      persistence:{cacheStored},
      recheck:{
        requested:recheckRequested,
        performed:shouldPerformRecheck,
        free:freeRecheck,
        reasonCode:recheckReasonCode,
        delta:recheckDelta,
      },
      newsImpact,
      quota:responseQuota,
    }));
    } finally {
      const disposition=usageCommitted ? 'commit' : 'refund';

      const logFinalizationFailure=async (code,error,meta={})=>{
        try { bumpTelemetry('analysisUsageCompensationFailures'); } catch {}
        await recordOpsEvent(cfg,{
          severity:'error',
          source:'quota',
          eventType:'analysis_usage_compensation',
          code,
          message:'Analysis usage finalization did not complete synchronously; durable reconciliation may be required.',
          meta:{
            ...objectValue(meta),
            error:safeText(error?.message || error,180) || 'unknown_error',
          },
        }).catch(()=>null);
      };

      if (usageReservation?.reserved) {
        if (usageReservation.durable) {
          try {
            const finalization=objectValue(await finalizeAnalysisUsageReservation({
              reservation:usageReservation,
              disposition,
              cfg,
              userId,
            }));
            if (finalization?.ok !== true && finalization?.pending !== true) {
              await logFinalizationFailure(
                'ANALYSIS_QUOTA_FINALIZATION_REJECTED',
                safeText(finalization?.reason,180) || 'finalization_not_confirmed',
                {operationId:safeText(usageReservation.operationId,80)},
              );
            }
          } catch (error) {
            await logFinalizationFailure(
              'ANALYSIS_QUOTA_FINALIZATION_FAILED',
              error,
              {operationId:safeText(usageReservation.operationId,80)},
            );
          }
        } else if (!usageCommitted) {
          try {
            await refundAnalysisQuota(userId,usageReservation,cfg);
          } catch (error) {
            try { bumpTelemetry('quotaRefundFailures'); } catch {}
            await recordOpsEvent(cfg,{
              severity:'error',
              source:'quota',
              eventType:'analysis_usage_compensation',
              code:'LEGACY_QUOTA_REFUND_FAILED',
              message:'Legacy analysis quota refund failed before durable lifecycle confirmation.',
              meta:{
                usageDate:safeText(usageReservation.date,40) || null,
                error:safeText(error?.message || error,180) || 'unknown_error',
              },
            }).catch(()=>null);
          }
        }
      }

      if (passUsageReservation?.reserved) {
        if (passUsageReservation.durable) {
          try {
            const finalization=objectValue(await finalizeAnalysisUsageReservation({
              reservation:passUsageReservation,
              disposition,
              cfg,
              userId,
            }));
            if (finalization?.ok !== true && finalization?.pending !== true) {
              await logFinalizationFailure(
                'ANALYSIS_PASS_FINALIZATION_REJECTED',
                safeText(finalization?.reason,180) || 'finalization_not_confirmed',
                {
                  operationId:safeText(passUsageReservation.operationId,80),
                  entitlementId:positiveSafeInteger(passUsageReservation.entitlementId),
                },
              );
            }
          } catch (error) {
            await logFinalizationFailure(
              'ANALYSIS_PASS_FINALIZATION_FAILED',
              error,
              {
                operationId:safeText(passUsageReservation.operationId,80),
                entitlementId:positiveSafeInteger(passUsageReservation.entitlementId),
              },
            );
          }
        } else if (!usageCommitted) {
          try {
            const result=objectValue(await refundEntitlementUsage(
              userId,
              passUsageReservation.entitlementId,
              cfg,
            ));
            if (result?.updated !== true) {
              throw new Error(
                safeText(result?.reason,120) || 'legacy_pass_refund_not_confirmed',
              );
            }
            try { bumpTelemetry('passUsageRefunds'); } catch {}
          } catch (error) {
            try { bumpTelemetry('passUsageRefundFailures'); } catch {}
            await recordOpsEvent(cfg,{
              severity:'error',
              source:'quota',
              eventType:'analysis_usage_compensation',
              code:'LEGACY_PASS_REFUND_FAILED',
              message:'Legacy limited Pass refund failed before durable lifecycle confirmation.',
              meta:{
                entitlementId:positiveSafeInteger(passUsageReservation.entitlementId),
                error:safeText(error?.message || error,180) || 'unknown_error',
              },
            }).catch(()=>null);
          }
        }
      }

      try {
        await releaseDistributedAnalysisLock(analysisLock,cfg);
      } catch (error) {
        await recordOpsEvent(cfg,{
          severity:'warning',
          source:'coordination',
          eventType:'analysis_lock_release',
          code:'ANALYSIS_LOCK_RELEASE_FAILED',
          message:'Distributed analysis lock release failed; lease expiry will recover it.',
          meta:{
            fixtureId,
            error:safeText(error?.message || error,180) || 'unknown_error',
          },
        }).catch(()=>null);
      }
    }
    } catch (error) {
      let reason='server_error';
      try {
        reason=safeText(newsImpactFailureCode(error,'server_error'),120)
          || 'server_error';
      } catch {}
      const recovery=await recordTrackedFullAiFailure(
        reason,
        nonNegativeSafeInteger(error?.status,999) ?? 0,
      );
      if (recovery && error && typeof error === 'object') {
        try { error.newsImpactRecovery=recovery; } catch {}
      }
      throw error;
    }
  }

  return Object.freeze({apiAnalyze});
}
