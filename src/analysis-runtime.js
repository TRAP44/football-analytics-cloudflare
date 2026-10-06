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
    if (used === null || limit === null || left === null) return fallback;

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
    const cacheKey=`fixture:${fixtureId}:v15-availability-quality-rc144`;
    const cachedCandidate=await getCache(cacheKey,cfg).catch(()=>null);
    const cached=analysisCachePayload(cachedCandidate,fixtureId);
    const staleCandidate=cached || await getStaleCache(cacheKey,cfg).catch(()=>null);
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
        const newsImpact=newsImpactDeltaStatus(staleBefore,cached,null,{requested:newsImpactRecheck,eligible:newsImpactEligible,performed:false,publishedAt:newsPublishedAt});
        await recordTrackedFullAiOutcome('cached');
        return json(analysisResponsePayload(cached,{cached:true,stale:false,recheck:{requested:recheckRequested,performed:false,free:false,reasonCode:recheckReasonCode},newsImpact,quota:await quotaSnapshotForResponse(userId,cfg,null)}));
      }
    }
  
    const entitlementBefore=objectValue(
      await resolveUserEntitlements(userId,fixtureId,cfg).catch(()=>null),
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
        quota:quotaBefore,
      },429,'quota_exhausted');
    }
  
    const analysisLock=objectValue(
      await claimDistributedAnalysisLock(fixtureId,cfg).catch(()=>null),
    ) || {claimed:false,unavailable:true};
    if (!analysisLock.claimed && analysisLock.unavailable) {
      if (staleBefore) {
        await safeRecordHistory(staleBefore);
        return json(analysisResponsePayload(staleBefore,{cached:true,stale:true,warning:'Координация нового AI-расчёта временно недоступна. Показан последний сохранённый анализ.',retryAfter:5,quota:quotaBefore}));
      }
      return await trackedFullAiFailureResponse({error:'Координация AI-расчёта временно недоступна. Повторите через несколько секунд.',code:'ANALYSIS_COORDINATION_DEGRADED',retryAfter:5,quota:quotaBefore},503,'analysis_coordination_degraded',{'retry-after':'5'});
    }
    if (!analysisLock.claimed) {
      const joinedCandidate=await waitForSharedAnalysis(cacheKey,cfg).catch(()=>null);
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
        if (trackFullAi) void recordGrowthEvent(cfg,{userId:userId,eventName:'full_ai',channel:'miniapp',fixtureId,metadata:{cached:true,sharedJoin:true}});
        await recordTrackedFullAiOutcome('shared');
        return json(analysisResponsePayload(joined,{cached:true,stale:false,sharedJoin:true,recheck:{requested:recheckRequested,performed:shouldPerformRecheck,free:freeRecheck,reasonCode:newsImpactEligible ? 'news_impact_shared' : (previousFreshness?.reasonCode || 'shared_compute')},quota:await quotaSnapshotForResponse(userId,cfg,quotaBefore)}));
      }
      if (staleBefore) {
        await safeRecordHistory(staleBefore);
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
            fixtureId:Number(fixtureId),
            error:redactOpsString(error?.message || error,180),
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
        return json(analysisResponsePayload(staleBefore,{
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
      await settlePredictionsFromFixtures([fixture],cfg).catch(()=>null);
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
    const normalizedAbsences = formatAbsences(trustedInjuries, homeId, awayId, lineups);
    // Production must fail soft when optional availability enrichment is absent or
    // malformed. Never let a null optional block turn the entire AI endpoint into 502.
    const baseAbsences = normalizedAbsences && Array.isArray(normalizedAbsences.home) && Array.isArray(normalizedAbsences.away)
      ? normalizedAbsences
      : {
        home: [],
        away: [],
        summary: { home:{ total:0 }, away:{ total:0 }, resolvedByLineup:0 },
        resolvedByLineup: { home:[], away:[] },
        source: 'unavailable',
        methodology: 'Данные о потерях недоступны; анализ продолжен без этого сигнала.',
      };
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
  
    const dataCapabilities = publicDataCapabilities();
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
      dataCapabilities,
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
      provider: dataCapabilities,
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
    await recordHistory(userId, payload, cfg);
    if (newsImpactEligible && !needsFreshnessRecheck) {
      void recordGrowthEvent(cfg,{userId:userId,eventName:'analysis_recheck',channel:analysisOrigin==='telegram_quick'?'telegram':'miniapp',fixtureId,metadata:{free:freeRecheck,reason:'news_impact',material:Boolean(effectiveRecheckDelta?.material),stable:Boolean(effectiveRecheckDelta?.stable),changeCount:Number(effectiveRecheckDelta?.items?.length || 0),codes:(effectiveRecheckDelta?.codes || []).slice(0,6)}});
    }
    if (needsFreshnessRecheck) void recordGrowthEvent(cfg,{userId:userId,eventName:'analysis_recheck',channel:analysisOrigin==='telegram_quick'?'telegram':'miniapp',fixtureId,metadata:{free:freeRecheck,reason:previousFreshness?.reasonCode || 'age_window',material:Boolean(recheckDelta?.material),stable:Boolean(recheckDelta?.stable),changeCount:Number(recheckDelta?.items?.length || 0),codes:(recheckDelta?.codes || []).slice(0,6)}});
    if (trackFullAi) void recordGrowthEvent(cfg,{userId:userId,eventName:'full_ai',channel:'miniapp',fixtureId,metadata:{cached:false,recheck:shouldPerformRecheck}});
    await recordTrackedFullAiOutcome('fresh');
    const responseQuotaFallback = reservationQuotaSnapshot(usageReservation, quotaBefore);
    const responseQuota = await quotaSnapshotForResponse(userId, cfg, responseQuotaFallback);
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
              userId:userId,
            });
          } else if (!usageCommitted) {
            try {
              await refundAnalysisQuota(userId,usageReservation,cfg);
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
              userId:userId,
            });
          } else if (!usageCommitted) {
            try {
              const result=await refundEntitlementUsage(userId,passUsageReservation.entitlementId,cfg);
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
  }

  return { apiAnalyze };
}
