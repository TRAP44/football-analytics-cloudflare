// Match Center runtime extracted from worker.js.
// Provider, cache, quality and settlement capabilities are injected by the composition root.
export function createMatchCenterRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Match Center runtime dependencies are required.');
  }
  const {
    annotateAvailabilityReliability,
    annotateEventReliability,
    annotateLineupReliability,
    annotateOddsReliability,
    annotateStatisticsReliability,
    applyFeatureFreshness,
    applyFeatureFreshnessMap,
    assessExpectedGoalsQuality,
    assessFixtureAvailabilityQuality,
    assessMatchEventQuality,
    assessMatchLineups,
    assessMatchStatisticsQuality,
    synchronizeLineupQuality,
    assessOddsMarketQuality,
    buildAiTimeline,
    buildLiveAiCoach,
    buildOddsMovement,
    buildPostMatchReview,
    buildSmartMatchInsights,
    embeddedLiveData,
    eventsForTrustedAnalytics,
    extractLiveMarket,
    formatAbsences,
    formatLineups,
    formatLiveEvents,
    formatLiveStatistics,
    formatPlayerLeaders,
    getCache,
    getOddsSnapshots,
    getStaleCache,
    isFinishedStatus,
    isFootballRateLimitError,
    isRetryableFootballTransportError,
    isLiveStatus,
    isYouthReserveMatch,
    json,
    livePressure,
    loadFixtureAiTimeline,
    loadModelPredictionForFixture,
    loadProviderFixture,
    oddsMarketForTrustedAnalytics,
    providerBudgetProfile,
    providerDataState,
    providerFeatureFetch,
    providerFeaturePolicy,
    providerPublicBudgetMode,
    publicDataCapabilities,
    recordOpsEvent,
    runtimeControlsSnapshot,
    sanitizeAvailabilityRows,
    sanitizeEventsForDisplay,
    sanitizeExpectedGoalsForDisplay,
    sanitizeStatisticsForDisplay,
    saveOddsSnapshot,
    saveRefereeMatchHistory,
    scoreSnapshot,
    secondaryOddsMarket,
    secondaryOpenLigaEvents,
    setCache,
    settlePredictionsFromFixtures,
    statisticsForTrustedAnalytics,
    statisticsForTrustedExpectedGoals,
    statusLabel,
    usableOddsFeatureMeta,
    validateFixtureIntegrity,
  } = deps;

  const requiredFunctions={
    annotateAvailabilityReliability,
    annotateEventReliability,
    annotateLineupReliability,
    annotateOddsReliability,
    annotateStatisticsReliability,
    applyFeatureFreshness,
    applyFeatureFreshnessMap,
    assessExpectedGoalsQuality,
    assessFixtureAvailabilityQuality,
    assessMatchEventQuality,
    assessMatchLineups,
    assessMatchStatisticsQuality,
    synchronizeLineupQuality,
    assessOddsMarketQuality,
    buildAiTimeline,
    buildLiveAiCoach,
    buildOddsMovement,
    buildPostMatchReview,
    buildSmartMatchInsights,
    embeddedLiveData,
    eventsForTrustedAnalytics,
    extractLiveMarket,
    formatAbsences,
    formatLineups,
    formatLiveEvents,
    formatLiveStatistics,
    formatPlayerLeaders,
    getCache,
    getOddsSnapshots,
    getStaleCache,
    isFinishedStatus,
    isFootballRateLimitError,
    isRetryableFootballTransportError,
    isLiveStatus,
    isYouthReserveMatch,
    json,
    livePressure,
    loadFixtureAiTimeline,
    loadModelPredictionForFixture,
    loadProviderFixture,
    oddsMarketForTrustedAnalytics,
    providerBudgetProfile,
    providerDataState,
    providerFeatureFetch,
    providerFeaturePolicy,
    providerPublicBudgetMode,
    publicDataCapabilities,
    recordOpsEvent,
    runtimeControlsSnapshot,
    sanitizeAvailabilityRows,
    sanitizeEventsForDisplay,
    sanitizeExpectedGoalsForDisplay,
    sanitizeStatisticsForDisplay,
    saveOddsSnapshot,
    saveRefereeMatchHistory,
    scoreSnapshot,
    secondaryOddsMarket,
    secondaryOpenLigaEvents,
    setCache,
    settlePredictionsFromFixtures,
    statisticsForTrustedAnalytics,
    statisticsForTrustedExpectedGoals,
    statusLabel,
    usableOddsFeatureMeta,
    validateFixtureIntegrity,
  };
  for (const [name,fn] of Object.entries(requiredFunctions)) {
    if (typeof fn!=='function') throw new TypeError(`${name} is required`);
  }

  function objectValue(value) {
    return value && typeof value==='object' && !Array.isArray(value)
      ? value
      : null;
  }

  function safeText(value,max=240) {
    if (!['string','number','bigint'].includes(typeof value)) return '';
    try {
      return String(value)
        .normalize('NFKC')
        .replace(/[\u0000-\u001F\u007F]/g,' ')
        .replace(/\s+/g,' ')
        .trim()
        .slice(0,max);
    } catch {
      return '';
    }
  }

  function finiteNumber(value) {
    if (typeof value==='number') return Number.isFinite(value) ? value : null;
    if (typeof value!=='string') return null;
    const raw=value.trim();
    if (!/^-?(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function positiveSafeInteger(value) {
    const number=finiteNumber(value);
    return number !== null && Number.isSafeInteger(number) && number>0
      ? number
      : null;
  }

  function nonNegativeSafeInteger(value,max=Number.MAX_SAFE_INTEGER) {
    const number=finiteNumber(value);
    return number !== null
      && Number.isSafeInteger(number)
      && number>=0
      && number<=max
      ? number
      : null;
  }

  function boundedRetryAfter(value,fallback=60) {
    const number=positiveSafeInteger(value);
    return number !== null && number<=3600 ? number : fallback;
  }

  function rowsOrEmpty(value,limit=1000) {
    return Array.isArray(value) ? value.slice(0,limit) : [];
  }

  function safePredicate(fn,...args) {
    try { return fn(...args)===true; }
    catch { return false; }
  }

  async function optionalAsync(fn,...args) {
    try { return await fn(...args); }
    catch { return null; }
  }

  async function safeRecordOps(cfg,event) {
    try { await recordOpsEvent(cfg,event); } catch {}
  }

  function safeHttpUrl(value,max=500) {
    const raw=safeText(value,max);
    if (!raw) return '';
    try {
      const parsed=new URL(raw);
      return ['http:','https:'].includes(parsed.protocol)
        && !parsed.username
        && !parsed.password
        ? parsed.toString().slice(0,max)
        : '';
    } catch {
      return '';
    }
  }

  function requestFixtureId(request) {
    const raw=safeText(request?.url,2000);
    if (!raw) return null;
    try {
      const url=new URL(raw);
      return positiveSafeInteger(url.searchParams.get('fixtureId'));
    } catch {
      return null;
    }
  }

  function matchCenterCachePayload(value,fixtureId) {
    const payload=objectValue(value);
    if (!payload) return null;
    if (positiveSafeInteger(payload?.match?.fixtureId)!==fixtureId) return null;
    const mode=safeText(payload.mode,24);
    if (!['live','finished','upcoming'].includes(mode)) return null;
    return payload;
  }

  function prematchAnalysisPayload(value,fixtureId) {
    const payload=objectValue(value);
    if (!payload) return null;
    return positiveSafeInteger(payload?.match?.fixtureId)===fixtureId
      ? payload
      : null;
  }

  function unavailableFeatureMeta(feature,reason='provider_unavailable') {
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

  function safeProviderDataState(rows,options={}) {
    try {
      return objectValue(providerDataState(rows,options))
        || unavailableFeatureMeta(options?.feature || 'unknown','invalid_provider_state');
    } catch {
      return unavailableFeatureMeta(options?.feature || 'unknown','provider_state_error');
    }
  }

  function safeFeaturePolicy(feature,context) {
    try { return objectValue(providerFeaturePolicy(feature,context)) || {}; }
    catch { return {}; }
  }

  function safeFeatureFreshness(meta,options) {
    try {
      return objectValue(applyFeatureFreshness(objectValue(meta) || {},options))
        || unavailableFeatureMeta(options?.feature || meta?.feature,'freshness_invalid');
    } catch {
      return unavailableFeatureMeta(options?.feature || meta?.feature,'freshness_error');
    }
  }

  function safeFeatureFreshnessMap(meta,options) {
    try { return objectValue(applyFeatureFreshnessMap(objectValue(meta) || {},options)) || {}; }
    catch { return {}; }
  }

  async function safeProviderFeatureFetch(input) {
    const request=objectValue(input) || {};
    const feature=safeText(request.feature,40) || 'unknown';
    try {
      const result=objectValue(await providerFeatureFetch(request));
      return {
        data:rowsOrEmpty(result?.data,1000),
        meta:objectValue(result?.meta) || unavailableFeatureMeta(feature,'invalid_provider_response'),
      };
    } catch (error) {
      return {
        data:[],
        meta:unavailableFeatureMeta(
          feature,
          safeText(error?.code,120) || 'provider_error',
        ),
      };
    }
  }

  function trustedFeature(meta) {
    const value=objectValue(meta);
    return value?.confidenceBearing===true
      && value?.stale!==true
      && value?.provenanceState==='verified';
  }

  function semanticLineupView(lineupsInput,qualityInput,metaInput) {
    const sourceQuality=objectValue(qualityInput) || {};
    const quality={
      ...sourceQuality,
      home:{...(objectValue(sourceQuality.home) || {})},
      away:{...(objectValue(sourceQuality.away) || {})},
    };
    let meta=objectValue(metaInput)
      || unavailableFeatureMeta('lineups','lineup_meta_invalid');
    try {
      meta=objectValue(annotateLineupReliability(meta,quality)) || meta;
    } catch {}
    let lineups=objectValue(lineupsInput) || {};
    try {
      lineups=objectValue(synchronizeLineupQuality(lineups,quality)) || lineups;
    } catch {}
    return {lineups,quality,meta};
  }

  async function apiMatchCenter(request,cfg) {
    const fixtureId=requestFixtureId(request);
    if (fixtureId===null) {
      return json({
        error:'Укажите корректный положительный целый номер матча.',
      },400);
    }

    // Shared across all users. LIVE cache follows the provider refresh cadence
    // with a hard minimum of 10 seconds.
    const baseCacheKey=`match-center:${fixtureId}:v17-event-evidence-rc144`;
    const cachedCandidate=await optionalAsync(getCache,baseCacheKey,cfg);
    const cached=matchCenterCachePayload(cachedCandidate,fixtureId);
    if (cachedCandidate && !cached) {
      await safeRecordOps(cfg,{
        severity:'warning',
        source:'cache',
        eventType:'match_center_cache_rejected',
        code:'MATCH_CENTER_CACHE_INVALID',
        message:'Match Center ignored a cache entry whose fixture identity or mode was invalid.',
        meta:{fixtureId},
      });
    }

    if (cached) {
      const cachedMode=safeText(cached.mode,24);
      const cachedFreshness=objectValue(cached.dataFreshness) || {};
      const cachedMeta={
        ...cachedFreshness,
        match:objectValue(cachedFreshness.match) || {
          feature:'match',
          provider:'api-football',
          source:'cache',
          state:'available',
          available:true,
          usable:true,
          observed:true,
          fetchedAt:safeText(cached.generatedAt,80) || null,
        },
      };
      const cachedAiTimeline=objectValue(cached.aiTimeline)
        || objectValue(await optionalAsync(loadFixtureAiTimeline,{
          fixtureId,
          match:objectValue(cached.match) || {fixtureId},
          events:rowsOrEmpty(cached.events,500),
          cfg,
        }));
      const refreshedFreshness=safeFeatureFreshnessMap(
        cachedMeta,
        {mode:cachedMode},
      );
      const cachedAvailability=objectValue(cached.availability) || {};
      const liveCache=cachedMode==='live';
      const eventsTrusted=trustedFeature(refreshedFreshness.events);
      const statisticsTrusted=trustedFeature(refreshedFreshness.statistics);
      const playersTrusted=trustedFeature(refreshedFreshness.players);
      const injuriesTrusted=trustedFeature(refreshedFreshness.injuries);
      const cachedLineupView=semanticLineupView(
        cached.lineups,
        cached.lineupQuality,
        refreshedFreshness.lineups,
      );
      refreshedFreshness.lineups=cachedLineupView.meta;
      const lineupsTrusted=trustedFeature(cachedLineupView.meta);
      const oddsTrusted=trustedFeature(refreshedFreshness.liveOdds);
      const liveCoreTrusted=eventsTrusted && statisticsTrusted;

      return json({
        ...cached,
        lineups:cachedLineupView.lineups,
        lineupQuality:cachedLineupView.quality,
        ...(liveCache && !statisticsTrusted
          ? {livePressure:null}
          : {}),
        ...(liveCache && !liveCoreTrusted
          ? {smartInsights:null,liveAiCoach:null}
          : {}),
        ...(liveCache && !oddsTrusted
          ? {liveOdds:null,oddsMovement:null}
          : {}),
        aiTimeline:cachedAiTimeline,
        dataFreshness:refreshedFreshness,
        availability:{
          ...cachedAvailability,
          ...(liveCache ? {
            events:eventsTrusted && rowsOrEmpty(cached.events,1000).length>0,
            statistics:statisticsTrusted,
            xg:statisticsTrusted
              && objectValue(cached.xgQuality)?.confidenceBearing===true,
            players:playersTrusted
              && (
                rowsOrEmpty(cached?.playerLeaders?.home,100).length>0
                || rowsOrEmpty(cached?.playerLeaders?.away,100).length>0
              ),
            injuries:injuriesTrusted
              && objectValue(cached.availabilityQuality)?.confidenceBearing===true
              && (
                rowsOrEmpty(cached?.absences?.home,200).length>0
                || rowsOrEmpty(cached?.absences?.away,200).length>0
              ),
            liveOdds:oddsTrusted
              && objectValue(cached.liveOddsQuality)?.confidenceBearing===true
              && Boolean(cached.liveOdds),
            lineupsTrusted,
            lineupsConfirmed:lineupsTrusted
              && cachedLineupView.quality?.bothConfirmed===true,
          } : {}),
        },
        cached:true,
      });
    }

    let fixture;
    try {
      fixture=objectValue(await loadProviderFixture(fixtureId,cfg));
    } catch (error) {
      const staleCandidate=await optionalAsync(getStaleCache,baseCacheKey,cfg);
      const stale=matchCenterCachePayload(staleCandidate,fixtureId);
      const providerLimited=safePredicate(isFootballRateLimitError,error);
      const transientProviderFailure=providerLimited
        || safePredicate(isRetryableFootballTransportError,error);

      if (staleCandidate && !stale) {
        await safeRecordOps(cfg,{
          severity:'warning',
          source:'cache',
          eventType:'match_center_stale_cache_rejected',
          code:'MATCH_CENTER_STALE_CACHE_INVALID',
          message:'Match Center ignored an invalid stale cache entry.',
          meta:{fixtureId},
        });
      }

      if (stale && transientProviderFailure) {
        const staleMode=safeText(stale.mode,24);
        const staleFreshnessMeta=objectValue(stale.dataFreshness) || {};
        const staleMeta={
          ...staleFreshnessMeta,
          match:objectValue(staleFreshnessMeta.match) || {
            feature:'match',
            provider:'api-football',
            source:'stale-cache',
            state:'available',
            available:true,
            usable:true,
            observed:true,
            fetchedAt:safeText(stale.generatedAt,80) || null,
          },
        };
        const staleFreshness=safeFeatureFreshnessMap(staleMeta,{
          mode:staleMode,
          forceStale:true,
        });
        const staleLineupView=semanticLineupView(
          stale.lineups,
          stale.lineupQuality,
          staleFreshness.lineups,
        );
        staleFreshness.lineups=staleLineupView.meta;
        const suppressLiveSignals=staleMode==='live';
        return json({
          ...stale,
          lineups:staleLineupView.lineups,
          lineupQuality:staleLineupView.quality,
          dataFreshness:staleFreshness,
          ...(suppressLiveSignals ? {
            livePressure:null,
            smartInsights:null,
            liveAiCoach:null,
            liveOdds:null,
            oddsMovement:null,
            liveOddsQuality:objectValue(stale.liveOddsQuality)
              ? {
                  ...stale.liveOddsQuality,
                  state:'source_untrusted',
                  label:'Рынок не используется',
                  reason:'stale_match_center_cache',
                  sourceTrusted:false,
                  confidenceBearing:false,
                }
              : null,
            availabilityQuality:objectValue(stale.availabilityQuality)
              ? {
                  ...stale.availabilityQuality,
                  state:'source_untrusted',
                  label:'Потери не используются',
                  reason:'stale_match_center_cache',
                  sourceTrusted:false,
                  confidenceBearing:false,
                }
              : null,
            availability:{
              ...objectValue(stale.availability),
              events:false,
              statistics:false,
              xg:false,
              players:false,
              injuries:false,
              liveOdds:false,
              lineupsConfirmed:false,
              lineupsTrusted:false,
            },
          } : {}),
          cached:true,
          stale:true,
          warning:'Данные матча показаны из последнего сохранённого снимка. Устаревшие live-сигналы исключены из аналитики.',
          retryAfter:boundedRetryAfter(error?.retryAfter,60),
        });
      }
      throw error;
    }

    if (!fixture) return json({error:'Матч не найден.'},404);

    const loadedFixtureId=positiveSafeInteger(fixture?.fixture?.id);
    if (loadedFixtureId!==fixtureId) {
      await safeRecordOps(cfg,{
        severity:'warning',
        source:'integrity',
        eventType:'single_fixture_guard',
        code:'MATCH_CENTER_FIXTURE_ID_MISMATCH',
        message:'Match Center provider returned a fixture outside the requested identity.',
        meta:{fixtureId,loadedFixtureId},
      });
      return json({
        error:'Источник вернул данные другого матча, поэтому центр матча временно заблокирован.',
        code:'MATCH_IDENTITY_MISMATCH',
      },409);
    }

    let centerIntegrity;
    try {
      centerIntegrity=objectValue(validateFixtureIntegrity(fixture,'',null));
    } catch {}
    if (!centerIntegrity) {
      centerIntegrity={
        state:'invalid',
        qualityScore:0,
        quarantine:true,
        warnings:[],
        issues:[{severity:'error',code:'integrity_check_unavailable'}],
      };
    }
    const integrityIssues=rowsOrEmpty(centerIntegrity.issues,50);
    const integrityWarnings=rowsOrEmpty(centerIntegrity.warnings,50);
    if (centerIntegrity.quarantine===true) {
      await safeRecordOps(cfg,{
        severity:'warning',
        source:'integrity',
        eventType:'single_fixture_guard',
        code:'MATCH_CENTER_REJECTED',
        message:'Центр матча отклонил структурно некорректные данные матча.',
        meta:{
          fixtureId,
          issues:integrityIssues
            .filter(issue=>issue?.severity==='error')
            .map(issue=>safeText(issue?.code,80))
            .filter(Boolean)
            .slice(0,12),
        },
      });
      return json({
        error:'Данные этого матча не прошли проверку целостности. Попробуйте позже.',
        code:'MATCH_DATA_INVALID',
        integrity:{
          ...centerIntegrity,
          warnings:integrityWarnings,
          issues:integrityIssues,
        },
      },409);
    }

    const status=safeText(fixture?.fixture?.status?.short,24);
    const elapsed=nonNegativeSafeInteger(
      fixture?.fixture?.status?.elapsed,
      300,
    );
    const live=safePredicate(isLiveStatus,status);
    const finished=safePredicate(isFinishedStatus,status);

    const homeId=positiveSafeInteger(fixture?.teams?.home?.id);
    const awayId=positiveSafeInteger(fixture?.teams?.away?.id);
    if (!homeId || !awayId || homeId===awayId) {
      return json({
        error:'Команды матча не прошли проверку идентификаторов.',
        code:'MATCH_TEAM_IDENTITY_INVALID',
      },409);
    }

    let embedded={};
    try { embedded=objectValue(embeddedLiveData(fixture)) || {}; } catch {}

    const leagueName=safeText(fixture?.league?.name,180);
    const homeName=safeText(fixture?.teams?.home?.name,180);
    const awayName=safeText(fixture?.teams?.away?.name,180);
    const limitedCoverage=safePredicate(
      isYouthReserveMatch,
      leagueName,
      homeName,
      awayName,
    );
    const centerMode=live ? 'live' : finished ? 'finished' : 'upcoming';
    const fixtureFetchedAt=new Date().toISOString();

    const matchState=safeProviderDataState([fixture],{
      attempted:true,
      feature:'match',
    });
    const featureMeta={
      match:safeFeatureFreshness({
        feature:'match',
        provider:'api-football',
        source:'network',
        fetchedAt:fixtureFetchedAt,
        ageSeconds:0,
        ...matchState,
      },{
        feature:'match',
        mode:centerMode,
      }),
    };

    // v4.9: every expensive enrichment feature gets its own cache + quota policy.
    // Do not burn extra /events + /statistics calls when coverage is predictably low.
    // For senior competitions, targeted fallbacks are still allowed when embedded
    // fixture data does not contain details.
    let events=rowsOrEmpty(embedded.events,1000);
    let statistics=rowsOrEmpty(embedded.statistics,200);
    let playerRows=rowsOrEmpty(embedded.players,1000);
    let lineupRows=rowsOrEmpty(embedded.lineups,50);
    let injuryRows=[];

    let budgetProfile={paid:false,mode:'unknown',liveRefreshSeconds:0};
    try {
      budgetProfile=objectValue(providerBudgetProfile()) || budgetProfile;
    } catch {}

    const embeddedMeta=(feature,rows)=>({
      feature,
      provider:'api-football',
      source:'embedded',
      fetchedAt:fixtureFetchedAt,
      ageSeconds:0,
      fallback:false,
      policy:safeFeaturePolicy(feature,{mode:centerMode,limitedCoverage}),
      ...safeProviderDataState(rows,{attempted:true,feature}),
    });

    if (events.length) {
      featureMeta.events=embeddedMeta('events',events);
    } else if (live || finished) {
      const eventContext={
        mode:centerMode,
        limitedCoverage,
        preserveAiBudget:budgetProfile.paid!==true,
      };
      const result=await safeProviderFeatureFetch({
        feature:'events',
        path:'/fixtures/events',
        params:{fixture:fixtureId},
        fixtureId,
        cfg,
        context:eventContext,
      });
      events=rowsOrEmpty(result.data,1000);
      featureMeta.events=result.meta;

      // FREE intentionally skips the API-Football events call and tries the
      // secondary source instead. Paid plans also retain the secondary fallback
      // when the primary endpoint is empty or degraded.
      if (!events.length && !limitedCoverage) {
        const secondaryEvents=objectValue(
          await optionalAsync(secondaryOpenLigaEvents,fixture,cfg,eventContext),
        );
        if (secondaryEvents?.available===true) {
          events=rowsOrEmpty(secondaryEvents.events,1000);
          featureMeta.events=objectValue(secondaryEvents.meta)
            || unavailableFeatureMeta('events','secondary_meta_invalid');
        } else {
          featureMeta.events={
            ...objectValue(result.meta),
            fallbackProvider:'openligadb',
            fallbackReason:safeText(secondaryEvents?.reason,120),
          };
        }
      }
    }

    if (statistics.length) {
      featureMeta.statistics=embeddedMeta('statistics',statistics);
    } else if (live || finished) {
      const result=await safeProviderFeatureFetch({
        feature:'statistics',
        path:'/fixtures/statistics',
        params:{fixture:fixtureId},
        fixtureId,
        cfg,
        context:{mode:centerMode,limitedCoverage},
      });
      statistics=rowsOrEmpty(result.data,200);
      featureMeta.statistics=result.meta;
    }

    if (playerRows.length) {
      featureMeta.players=embeddedMeta('players',playerRows);
    } else if (live || finished) {
      const result=await safeProviderFeatureFetch({
        feature:'players',
        path:'/fixtures/players',
        params:{fixture:fixtureId},
        fixtureId,
        cfg,
        context:{mode:centerMode,limitedCoverage},
      });
      playerRows=rowsOrEmpty(result.data,1000);
      featureMeta.players=result.meta;
    }

    const kickoffRaw=safeText(fixture?.fixture?.date,80);
    const kickoffMsCenter=kickoffRaw ? Date.parse(kickoffRaw) : NaN;
    const minutesToKickoffCenter=Number.isFinite(kickoffMsCenter)
      ? Math.round((kickoffMsCenter-Date.now())/60000)
      : null;
    const lineupsWindow=live || finished || (
      minutesToKickoffCenter!==null
      && minutesToKickoffCenter<=120
      && minutesToKickoffCenter>=-300
    );

    if (lineupRows.length) {
      featureMeta.lineups=embeddedMeta('lineups',lineupRows);
    } else if (lineupsWindow) {
      const result=await safeProviderFeatureFetch({
        feature:'lineups',
        path:'/fixtures/lineups',
        params:{fixture:fixtureId},
        fixtureId,
        cfg,
        context:{mode:centerMode,limitedCoverage},
      });
      lineupRows=rowsOrEmpty(result.data,50);
      featureMeta.lineups=result.meta;
    }

    if (!finished) {
      const result=await safeProviderFeatureFetch({
        feature:'injuries',
        path:'/injuries',
        params:{fixture:fixtureId},
        fixtureId,
        cfg,
        context:{mode:centerMode,limitedCoverage},
      });
      injuryRows=rowsOrEmpty(result.data,500);
      featureMeta.injuries=result.meta;
    }

    let liveOdds=null;
    let liveOddsQuality={
      state:'unavailable',
      marketValid:false,
      confidenceBearing:false,
    };
    try {
      liveOddsQuality=objectValue(assessOddsMarketQuality(null,{mode:centerMode}))
        || liveOddsQuality;
    } catch {}

    let oddsMovement=null;
    if (live && cfg?.liveOddsEnabled===true) {
      const result=await safeProviderFeatureFetch({
        feature:'liveOdds',
        path:'/odds/live',
        params:{fixture:fixtureId},
        fixtureId,
        cfg,
        context:{mode:centerMode,limitedCoverage},
      });

      let primaryLiveOdds=null;
      try {
        primaryLiveOdds=objectValue(extractLiveMarket(rowsOrEmpty(result.data,100)));
      } catch {}

      let primaryLiveMeta=objectValue(result.meta)
        || unavailableFeatureMeta('liveOdds');
      try {
        primaryLiveMeta=objectValue(
          usableOddsFeatureMeta(primaryLiveMeta,primaryLiveOdds),
        ) || primaryLiveMeta;
      } catch {}

      let primaryLiveShape={marketValid:false,confidenceBearing:false};
      try {
        primaryLiveShape=objectValue(assessOddsMarketQuality(
          primaryLiveOdds,
          {oddsMeta:primaryLiveMeta,mode:'live'},
        )) || primaryLiveShape;
      } catch {}

      liveOdds=primaryLiveOdds;
      if (!primaryLiveOdds || primaryLiveShape.marketValid!==true) {
        const secondaryOdds=objectValue(
          await optionalAsync(secondaryOddsMarket,fixture,cfg,{mode:'live'}),
        );
        if (secondaryOdds?.available===true) {
          liveOdds=objectValue(secondaryOdds.market);
          try {
            featureMeta.liveOdds=objectValue(
              usableOddsFeatureMeta(secondaryOdds.meta,liveOdds),
            ) || unavailableFeatureMeta('liveOdds','secondary_meta_invalid');
          } catch {
            featureMeta.liveOdds=unavailableFeatureMeta(
              'liveOdds',
              'secondary_meta_invalid',
            );
          }
        } else {
          try {
            featureMeta.liveOdds=objectValue(usableOddsFeatureMeta(
              result.meta,
              primaryLiveOdds,
              safeText(secondaryOdds?.reason,120),
            )) || primaryLiveMeta;
          } catch {
            featureMeta.liveOdds=primaryLiveMeta;
          }
        }
      } else {
        featureMeta.liveOdds=primaryLiveMeta;
      }
    }

    for (const feature of [
      'events',
      'statistics',
      'players',
      'lineups',
      'injuries',
      'liveOdds',
    ]) {
      if (featureMeta[feature]) {
        featureMeta[feature]=safeFeatureFreshness(
          featureMeta[feature],
          {feature,mode:centerMode},
        );
      }
    }

    if (liveOdds || featureMeta.liveOdds) {
      try {
        liveOddsQuality=objectValue(assessOddsMarketQuality(liveOdds,{
          oddsMeta:objectValue(featureMeta.liveOdds) || {},
          mode:centerMode,
        })) || liveOddsQuality;
      } catch {}

      try {
        featureMeta.liveOdds=objectValue(annotateOddsReliability(
          objectValue(featureMeta.liveOdds) || {feature:'liveOdds'},
          liveOddsQuality,
        )) || unavailableFeatureMeta('liveOdds','odds_quality_invalid');
      } catch {
        featureMeta.liveOdds=unavailableFeatureMeta(
          'liveOdds',
          'odds_quality_error',
        );
      }

      try {
        liveOdds=objectValue(
          oddsMarketForTrustedAnalytics(liveOdds,liveOddsQuality),
        );
      } catch {
        liveOdds=null;
      }
    }

    if (liveOdds) {
      await optionalAsync(saveOddsSnapshot,fixtureId,liveOdds,cfg);
      const snapshots=rowsOrEmpty(
        await optionalAsync(getOddsSnapshots,fixtureId,cfg,12),
        20,
      );
      try {
        oddsMovement=objectValue(buildOddsMovement(snapshots,liveOdds));
      } catch {}
    }

    let finalBudget=budgetProfile;
    try {
      finalBudget=objectValue(providerBudgetProfile()) || budgetProfile;
    } catch {}

    let runtimeControls={};
    try { runtimeControls=objectValue(runtimeControlsSnapshot()) || {}; } catch {}
    const configuredRefreshSeconds=positiveSafeInteger(
      finalBudget?.liveRefreshSeconds,
    );
    const refreshSeconds=live
      && runtimeControls.liveEnabled!==false
      && configuredRefreshSeconds!==null
        ? Math.max(10,Math.min(300,configuredRefreshSeconds))
        : 0;

    let rawFormattedStatistics={items:[],home:{values:{}},away:{values:{}}};
    try {
      rawFormattedStatistics=objectValue(
        formatLiveStatistics(statistics,homeId,awayId),
      ) || rawFormattedStatistics;
    } catch {}

    let statisticsQuality={
      state:'invalid',
      observed:false,
      confidenceBearing:false,
    };
    try {
      statisticsQuality=objectValue(assessMatchStatisticsQuality(
        rawFormattedStatistics,
        {
          statisticsMeta:objectValue(featureMeta.statistics) || {},
          mode:centerMode,
        },
      )) || statisticsQuality;
    } catch {}

    let xgQuality={
      state:'invalid',
      observed:false,
      confidenceBearing:false,
    };
    try {
      xgQuality=objectValue(assessExpectedGoalsQuality(
        rawFormattedStatistics,
        {
          statisticsMeta:objectValue(featureMeta.statistics) || {},
          mode:centerMode,
        },
      )) || xgQuality;
    } catch {}

    if (featureMeta.statistics || statisticsQuality.observed===true) {
      try {
        featureMeta.statistics=objectValue(annotateStatisticsReliability(
          objectValue(featureMeta.statistics) || {
            feature:'statistics',
            provider:'api-football',
            source:'embedded',
            ageSeconds:0,
          },
          statisticsQuality,
        )) || unavailableFeatureMeta('statistics','statistics_quality_invalid');
      } catch {
        featureMeta.statistics=unavailableFeatureMeta(
          'statistics',
          'statistics_quality_error',
        );
      }
    }

    let rawFormattedEvents=[];
    try {
      rawFormattedEvents=rowsOrEmpty(
        formatLiveEvents(events,homeId,awayId),
        1000,
      );
    } catch {}

    let eventQuality={
      state:'invalid',
      observed:false,
      confidenceBearing:false,
    };
    try {
      eventQuality=objectValue(assessMatchEventQuality(
        rawFormattedEvents,
        {
          eventsMeta:objectValue(featureMeta.events) || {},
          mode:centerMode,
          elapsed,
        },
      )) || eventQuality;
    } catch {}

    if (featureMeta.events || eventQuality.observed===true) {
      try {
        featureMeta.events=objectValue(annotateEventReliability(
          objectValue(featureMeta.events) || {
            feature:'events',
            provider:'api-football',
            source:'embedded',
            ageSeconds:0,
          },
          eventQuality,
        )) || unavailableFeatureMeta('events','event_quality_invalid');
      } catch {
        featureMeta.events=unavailableFeatureMeta(
          'events',
          'event_quality_error',
        );
      }
    }

    let availabilityQuality={
      state:'invalid',
      observed:false,
      acceptedCount:0,
      rejectedCount:injuryRows.length,
      confidenceBearing:false,
    };
    try {
      availabilityQuality=objectValue(assessFixtureAvailabilityQuality(
        injuryRows,
        {
          homeId,
          awayId,
          injuriesMeta:objectValue(featureMeta.injuries) || {},
          mode:centerMode,
        },
      )) || availabilityQuality;
    } catch {}

    if (featureMeta.injuries || availabilityQuality.observed===true) {
      try {
        featureMeta.injuries=objectValue(annotateAvailabilityReliability(
          objectValue(featureMeta.injuries) || {
            feature:'injuries',
            provider:'api-football',
            source:'embedded',
            ageSeconds:0,
          },
          availabilityQuality,
        )) || unavailableFeatureMeta('injuries','availability_quality_invalid');
      } catch {
        featureMeta.injuries=unavailableFeatureMeta(
          'injuries',
          'availability_quality_error',
        );
      }
    }

    const trustedPlayerRows=trustedFeature(featureMeta.players)
      ? playerRows
      : [];

    let trustedInjuryRows=[];
    try {
      trustedInjuryRows=rowsOrEmpty(
        sanitizeAvailabilityRows(injuryRows,availabilityQuality),
        500,
      );
    } catch {}

    let statisticsForDisplay={items:[],home:{values:{}},away:{values:{}}};
    try {
      statisticsForDisplay=objectValue(sanitizeStatisticsForDisplay(
        rawFormattedStatistics,
        statisticsQuality,
      )) || statisticsForDisplay;
    } catch {}

    let publicStatistics=statisticsForDisplay;
    try {
      publicStatistics=objectValue(sanitizeExpectedGoalsForDisplay(
        statisticsForDisplay,
        xgQuality,
      )) || statisticsForDisplay;
    } catch {}

    let comparativeStatistics={items:[],home:{values:{}},away:{values:{}}};
    try {
      comparativeStatistics=objectValue(statisticsForTrustedAnalytics(
        publicStatistics,
        statisticsQuality,
      )) || comparativeStatistics;
    } catch {}

    let analyticalStatistics=comparativeStatistics;
    try {
      analyticalStatistics=objectValue(statisticsForTrustedExpectedGoals(
        comparativeStatistics,
        xgQuality,
      )) || comparativeStatistics;
    } catch {}

    let playerLeaders={home:[],away:[]};
    try {
      const formatted=objectValue(
        formatPlayerLeaders(trustedPlayerRows,homeId,awayId),
      );
      if (formatted) {
        playerLeaders={
          ...formatted,
          home:rowsOrEmpty(formatted.home,100),
          away:rowsOrEmpty(formatted.away,100),
        };
      }
    } catch {}

    let lineups={};
    try { lineups=objectValue(formatLineups(lineupRows,homeId,awayId)) || {}; }
    catch {}

    let lineupQuality={
      home:{confirmed:false},
      away:{confirmed:false},
      bothConfirmed:false,
      bothPublished:false,
      anyPublished:false,
      confirmedSides:0,
      partialSides:0,
    };
    try {
      lineupQuality=objectValue(assessMatchLineups(lineups)) || lineupQuality;
    } catch {}

    if (featureMeta.lineups || lineupQuality.anyPublished===true) {
      try {
        featureMeta.lineups=objectValue(annotateLineupReliability(
          objectValue(featureMeta.lineups) || {
            feature:'lineups',
            provider:'api-football',
            source:'embedded',
            ageSeconds:0,
          },
          lineupQuality,
        )) || unavailableFeatureMeta('lineups','lineup_quality_invalid');
      } catch {
        featureMeta.lineups=unavailableFeatureMeta(
          'lineups',
          'lineup_quality_error',
        );
      }
    }
    try {
      lineups=objectValue(synchronizeLineupQuality(lineups,lineupQuality))
        || lineups;
    } catch {}

    const lineupSourceTrusted=trustedFeature(featureMeta.lineups);
    let absences={
      home:[],
      away:[],
      summary:{home:{total:0},away:{total:0},resolvedByLineup:0},
      resolvedByLineup:{home:[],away:[]},
    };
    try {
      const formatted=objectValue(formatAbsences(
        trustedInjuryRows,
        homeId,
        awayId,
        lineupSourceTrusted ? lineups : null,
      ));
      if (
        formatted
        && Array.isArray(formatted.home)
        && Array.isArray(formatted.away)
      ) {
        absences={
          ...formatted,
          home:formatted.home.slice(0,200),
          away:formatted.away.slice(0,200),
        };
      }
    } catch {}

    let pressure=null;
    if (live || finished) {
      try { pressure=objectValue(livePressure(analyticalStatistics)); }
      catch {}
    }

    let formattedEvents=[];
    try {
      formattedEvents=rowsOrEmpty(
        sanitizeEventsForDisplay(rawFormattedEvents,eventQuality),
        1000,
      );
    } catch {}

    let analyticalEvents=[];
    try {
      analyticalEvents=rowsOrEmpty(
        eventsForTrustedAnalytics(rawFormattedEvents,eventQuality),
        1000,
      );
    } catch {}

    if (finished) {
      await optionalAsync(settlePredictionsFromFixtures,[fixture],cfg);
    }

    const postMatchPredictionCandidate=finished
      ? objectValue(await optionalAsync(
          loadModelPredictionForFixture,
          fixtureId,
          cfg,
        ))
      : null;
    const postMatchPrediction=postMatchPredictionCandidate
      && positiveSafeInteger(postMatchPredictionCandidate.fixture_id)===fixtureId
        ? postMatchPredictionCandidate
        : null;
    if (postMatchPredictionCandidate && !postMatchPrediction) {
      await safeRecordOps(cfg,{
        severity:'warning',
        source:'model',
        eventType:'post_match_prediction_rejected',
        code:'POST_MATCH_PREDICTION_IDENTITY_MISMATCH',
        message:'Match Center ignored a model prediction from another fixture identity.',
        meta:{fixtureId},
      });
    }

    let postMatchReview=null;
    if (finished) {
      try {
        postMatchReview=objectValue(buildPostMatchReview({
          prediction:postMatchPrediction,
          fixture,
          statistics:analyticalStatistics,
          events:analyticalEvents,
          homeName,
          awayName,
        }));
      } catch {}
    }

    const referee=safeText(fixture?.fixture?.referee,180);
    const leagueId=positiveSafeInteger(fixture?.league?.id);
    if (finished && referee) {
      await optionalAsync(saveRefereeMatchHistory,{
        fixtureId,
        referee,
        kickoffAt:kickoffRaw || null,
        leagueId,
        events:analyticalEvents,
        statistics:analyticalStatistics,
      },cfg);
    }

    let currentScore=null;
    try { currentScore=objectValue(scoreSnapshot(fixture)); } catch {}

    let smartInsights=null;
    if (live || finished) {
      try {
        smartInsights=objectValue(buildSmartMatchInsights({
          statistics:analyticalStatistics,
          events:analyticalEvents,
          pressure,
          score:currentScore,
          elapsed,
          status,
          homeName,
          awayName,
          playerLeaders,
          absences,
        }));
      } catch {}
    }

    const prematchCandidate=live
      ? await optionalAsync(
          getStaleCache,
          `fixture:${fixtureId}:v15-availability-quality-rc144`,
          cfg,
        )
      : null;
    const prematchAnalysis=live
      ? prematchAnalysisPayload(prematchCandidate,fixtureId)
      : null;
    if (prematchCandidate && !prematchAnalysis) {
      await safeRecordOps(cfg,{
        severity:'warning',
        source:'cache',
        eventType:'match_center_prematch_cache_rejected',
        code:'MATCH_CENTER_PREMATCH_CACHE_INVALID',
        message:'Match Center ignored a prematch AI snapshot with mismatched fixture identity.',
        meta:{fixtureId},
      });
    }

    const timelineMatch={
      fixtureId,
      date:kickoffRaw,
      status,
      elapsed,
    };
    let aiTimeline=objectValue(await optionalAsync(loadFixtureAiTimeline,{
      fixtureId,
      match:timelineMatch,
      events:formattedEvents,
      cfg,
    }));
    if (!aiTimeline) {
      try {
        aiTimeline=objectValue(buildAiTimeline({
          match:timelineMatch,
          events:formattedEvents,
        }));
      } catch {}
    }

    let liveAiCoach=null;
    if (live) {
      try {
        liveAiCoach=objectValue(buildLiveAiCoach({
          statistics:analyticalStatistics,
          events:analyticalEvents,
          pressure,
          score:currentScore,
          elapsed,
          homeName,
          awayName,
          smartInsights,
          prematch:prematchAnalysis,
          oddsMovement,
          xgQuality,
        }));
      } catch {}
    }

    let dataCapabilities={};
    try { dataCapabilities=objectValue(publicDataCapabilities()) || {}; }
    catch {}

    let quotaMode='unknown';
    try { quotaMode=safeText(providerPublicBudgetMode(),40) || 'unknown'; }
    catch {}

    let publicStatusLabel=status;
    try {
      publicStatusLabel=safeText(statusLabel(status,elapsed),120) || status;
    } catch {}

    const integrityScore=finiteNumber(centerIntegrity.qualityScore);
    const publicIntegrityWarnings=integrityWarnings
      .map(value=>safeText(value?.message ?? value,240))
      .filter(Boolean)
      .slice(0,6);
    const publicIntegrityIssues=integrityIssues
      .filter(issue=>issue?.severity!=='info')
      .map(issue=>({
        severity:safeText(issue?.severity,40),
        code:safeText(issue?.code,80),
        message:safeText(issue?.message,240),
      }))
      .slice(0,3);

    const lineupTrusted=trustedFeature(featureMeta.lineups);
    const injuriesTrusted=trustedFeature(featureMeta.injuries);
    const playersTrusted=trustedFeature(featureMeta.players);
    const liveOddsTrusted=trustedFeature(featureMeta.liveOdds)
      && liveOddsQuality?.confidenceBearing===true
      && Boolean(liveOdds);

    const finalBudgetMode=safeText(finalBudget?.mode,40);
    const note=limitedCoverage
      ? 'Молодёжный или резервный турнир: дополнительные запросы данных ограничены для экономии квоты.'
      : finalBudgetMode==='emergency'
        ? 'Квота источника данных в защитном резерве: часть расширенных данных временно берётся из сохранённых данных или пропускается.'
        : finalBudgetMode==='conserve'
          ? 'Включён сберегающий режим: тяжёлые дополнительные запросы обновляются реже.'
          : (!events.length && !statistics.length)
            ? 'Для этого турнира или матча источник данных не отдаёт детальные события/статистику.'
            : '';

    const payload={
      generatedAt:new Date().toISOString(),
      mode:centerMode,
      match:{
        fixtureId,
        date:kickoffRaw,
        status,
        statusLong:safeText(fixture?.fixture?.status?.long,120),
        statusLabel:publicStatusLabel,
        elapsed,
        venue:safeText(fixture?.fixture?.venue?.name,180),
        city:safeText(fixture?.fixture?.venue?.city,180),
        referee,
        timezone:safeText(fixture?.fixture?.timezone,80),
        league:leagueName,
        leagueId:leagueId || 0,
        leagueLogo:safeHttpUrl(fixture?.league?.logo,500),
        country:safeText(fixture?.league?.country,120),
        round:safeText(fixture?.league?.round,120),
        score:currentScore,
        integrity:{
          state:safeText(centerIntegrity.state,40) || 'unknown',
          score:integrityScore,
          warnings:publicIntegrityWarnings,
          issues:publicIntegrityIssues,
        },
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
      },
      events:formattedEvents,
      eventQuality,
      statistics:publicStatistics,
      statisticsQuality,
      xgQuality,
      livePressure:pressure,
      smartInsights,
      liveAiCoach,
      aiTimeline,
      postMatchReview,
      playerLeaders,
      lineups,
      lineupQuality,
      availabilityQuality,
      absences,
      dataFreshness:featureMeta,
      quotaMode,
      availability:{
        events:eventQuality?.confidenceBearing===true
          && formattedEvents.length>0,
        statistics:statisticsQuality?.confidenceBearing===true,
        xg:xgQuality?.confidenceBearing===true,
        lineups:lineupQuality.anyPublished===true,
        lineupsTrusted:lineupTrusted,
        lineupsConfirmed:lineupTrusted
          && lineupQuality.bothConfirmed===true,
        lineupsPartial:lineupQuality.partialSides>0,
        players:playersTrusted
          && (
            rowsOrEmpty(playerLeaders.home,100).length>0
            || rowsOrEmpty(playerLeaders.away,100).length>0
          ),
        injuries:injuriesTrusted
          && availabilityQuality?.confidenceBearing===true
          && trustedInjuryRows.length>0,
        liveOdds:liveOddsTrusted,
        limitedCoverage,
      },
      dataCapabilities,
      liveOddsQuality,
      liveOdds,
      oddsMovement,
      provider:dataCapabilities,
      refreshSeconds,
      note,
    };

    const ttlMinutes=live
      ? Math.max(1/6,refreshSeconds/60)
      : finished
        ? 720
        : 5;
    let cacheStored=true;
    try {
      const result=await setCache(
        baseCacheKey,
        fixtureId,
        payload,
        cfg,
        ttlMinutes,
      );
      if (result===false) cacheStored=false;
    } catch {
      cacheStored=false;
    }
    if (!cacheStored) {
      await safeRecordOps(cfg,{
        severity:'warning',
        source:'cache',
        eventType:'match_center_cache_write',
        code:'MATCH_CENTER_CACHE_WRITE_FAILED',
        message:'Match Center completed but the shared cache write failed.',
        meta:{fixtureId,mode:centerMode},
      });
    }

    return json({
      ...payload,
      cached:false,
      persistence:{cacheStored},
    });
  }


  return Object.freeze({apiMatchCenter});
}
