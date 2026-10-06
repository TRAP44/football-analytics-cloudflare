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

  async function apiMatchCenter(request, cfg) {
    const url = new URL(request.url);
    const fixtureId = positiveSafeInteger(url.searchParams.get('fixtureId'));
    if (fixtureId === null) return json({ error: 'Укажите корректный положительный целый номер матча.' }, 400);
  
    // Shared across all users. LIVE cache follows the provider refresh cadence
    // with a hard minimum of 10 seconds.
    const baseCacheKey = `match-center:${fixtureId}:v16-availability-quality-rc144`;
    const cachedCandidate = await getCache(baseCacheKey, cfg);
    const cached = matchCenterCachePayload(cachedCandidate, fixtureId);
    if (cachedCandidate && !cached) {
      await recordOpsEvent(cfg, {
        severity:'warning',
        source:'cache',
        eventType:'match_center_cache_rejected',
        code:'MATCH_CENTER_CACHE_INVALID',
        message:'Match Center ignored a cache entry whose fixture identity or mode was invalid.',
        meta:{ fixtureId },
      }).catch(() => null);
    }
    if (cached) {
      const cachedMode = String(cached.mode);
      const cachedMeta = {
        ...(cached.dataFreshness || {}),
        match: cached.dataFreshness?.match || {
          feature:'match', provider:'api-football', source:'cache', state:'available',
          available:true, usable:true, observed:true, fetchedAt:cached.generatedAt || null,
        },
      };
      const cachedAiTimeline = cached.aiTimeline || await loadFixtureAiTimeline({
        fixtureId,
        match: cached.match || { fixtureId },
        events: Array.isArray(cached.events) ? cached.events : [],
        cfg,
      }).catch(() => null);
      return json({ ...cached, aiTimeline:cachedAiTimeline, dataFreshness:applyFeatureFreshnessMap(cachedMeta, { mode:cachedMode }), cached: true });
    }
  
    let fixture;
    try {
      fixture = await loadProviderFixture(fixtureId,cfg);
    } catch (error) {
      const staleCandidate = await getStaleCache(baseCacheKey, cfg);
      const stale = matchCenterCachePayload(staleCandidate, fixtureId);
      const transientProviderFailure = isFootballRateLimitError(error) || isRetryableFootballTransportError(error);
      if (staleCandidate && !stale) {
        await recordOpsEvent(cfg, {
          severity:'warning',
          source:'cache',
          eventType:'match_center_stale_cache_rejected',
          code:'MATCH_CENTER_STALE_CACHE_INVALID',
          message:'Match Center ignored an invalid stale cache entry.',
          meta:{ fixtureId },
        }).catch(() => null);
      }
      if (stale && transientProviderFailure) {
        const staleMode = String(stale.mode);
        const staleMeta = {
          ...(stale.dataFreshness || {}),
          match: stale.dataFreshness?.match || {
            feature:'match', provider:'api-football', source:'stale-cache', state:'available',
            available:true, usable:true, observed:true, fetchedAt:stale.generatedAt || null,
          },
        };
        const staleFreshness = applyFeatureFreshnessMap(staleMeta, { mode:staleMode, forceStale:true });
        const suppressLiveSignals = staleMode === 'live';
        return json({
          ...stale,
          dataFreshness:staleFreshness,
          ...(suppressLiveSignals ? {
            livePressure:null, smartInsights:null, liveAiCoach:null, liveOdds:null, oddsMovement:null,
            liveOddsQuality:stale.liveOddsQuality ? {
              ...stale.liveOddsQuality,
              state:'source_untrusted',
              label:'Рынок не используется',
              reason:'stale_match_center_cache',
              sourceTrusted:false,
              confidenceBearing:false,
            } : stale.liveOddsQuality,
            availabilityQuality:stale.availabilityQuality ? {
              ...stale.availabilityQuality,
              state:'source_untrusted',
              label:'Потери не используются',
              reason:'stale_match_center_cache',
              sourceTrusted:false,
              confidenceBearing:false,
            } : stale.availabilityQuality,
            availability:{ ...(stale.availability || {}), events:false, statistics:false, players:false, injuries:false, liveOdds:false, lineupsConfirmed:false, lineupsTrusted:false },
          } : {}),
          cached:true,
          stale:true,
          warning:'Данные матча показаны из последнего сохранённого снимка. Устаревшие live-сигналы исключены из аналитики.',
          retryAfter:boundedRetryAfter(error?.retryAfter, 60),
        });
      }
      throw error;
    }
    if (!fixture) return json({ error: 'Матч не найден.' }, 404);
    const centerIntegrity = validateFixtureIntegrity(fixture, '', null);
    if (centerIntegrity.quarantine) {
      await recordOpsEvent(cfg, { severity: 'warning', source: 'integrity', eventType: 'single_fixture_guard', code: 'MATCH_CENTER_REJECTED', message: 'Центр матча отклонил структурно некорректные данные матча.', meta: { fixtureId, issues: centerIntegrity.issues.filter(x => x.severity === 'error').map(x => x.code) } }).catch(() => {});
      return json({ error: 'Данные этого матча не прошли проверку целостности. Попробуйте позже.', code: 'MATCH_DATA_INVALID', integrity: centerIntegrity }, 409);
    }
  
    const status = fixture.fixture?.status?.short || '';
    const elapsed = nonNegativeSafeInteger(fixture.fixture?.status?.elapsed);
    const live = isLiveStatus(status);
    const finished = isFinishedStatus(status);
    const homeId = fixture.teams?.home?.id;
    const awayId = fixture.teams?.away?.id;
    const embedded = embeddedLiveData(fixture) || {};
    const leagueName = fixture.league?.name || '';
    const homeName = fixture.teams?.home?.name || '';
    const awayName = fixture.teams?.away?.name || '';
    const limitedCoverage = isYouthReserveMatch(leagueName, homeName, awayName);
    const centerMode = live ? 'live' : finished ? 'finished' : 'upcoming';
    const fixtureFetchedAt = new Date().toISOString();
    const featureMeta = {
      match: applyFeatureFreshness({
        feature:'match', provider:'api-football', source:'network', fetchedAt:fixtureFetchedAt, ageSeconds:0,
        ...providerDataState([fixture], { attempted:true }),
      }, { feature:'match', mode:centerMode }),
    };
  
    // v4.9: every expensive enrichment feature gets its own cache + quota policy.
    // Do not burn extra /events + /statistics calls when coverage is predictably low.
    // For senior competitions, targeted fallbacks are still allowed when embedded
    // fixture data does not contain details.
    let events = rowsOrEmpty(embedded.events);
    let statistics = rowsOrEmpty(embedded.statistics);
    let playerRows = rowsOrEmpty(embedded.players);
    let lineupRows = rowsOrEmpty(embedded.lineups);
    let injuryRows = [];
  
    if (events.length) {
      featureMeta.events = { feature:'events', provider:'api-football', source:'embedded', fetchedAt:fixtureFetchedAt, ageSeconds:0, fallback:false, policy:providerFeaturePolicy('events', { mode:centerMode, limitedCoverage }), ...providerDataState(events, { attempted:true }) };
    } else if (live || finished) {
      const eventContext={
        mode:centerMode,
        limitedCoverage,
        preserveAiBudget: !providerBudgetProfile().paid,
      };
      const result = await providerFeatureFetch({
        feature: 'events', path: '/fixtures/events', params: { fixture: fixtureId },
        fixtureId, cfg, context: eventContext,
      });
      events = rowsOrEmpty(result.data);
      featureMeta.events = result.meta;
      // FREE intentionally skips the API-Football events call and tries the
      // secondary source instead. Paid plans also retain the secondary fallback
      // when the primary endpoint is empty or degraded.
      if (!events.length && !limitedCoverage) {
        const secondaryEvents=await secondaryOpenLigaEvents(fixture, cfg, eventContext);
        if (secondaryEvents.available) {
          events=rowsOrEmpty(secondaryEvents.events);
          featureMeta.events=secondaryEvents.meta;
        } else {
          featureMeta.events={ ...result.meta, fallbackProvider:'openligadb', fallbackReason:String(secondaryEvents.reason || '') };
        }
      }
    }
  
    if (statistics.length) {
      featureMeta.statistics = { feature:'statistics', provider:'api-football', source:'embedded', fetchedAt:fixtureFetchedAt, ageSeconds:0, fallback:false, policy:providerFeaturePolicy('statistics', { mode:centerMode, limitedCoverage }), ...providerDataState(statistics, { attempted:true }) };
    } else if (live || finished) {
      const result = await providerFeatureFetch({
        feature: 'statistics', path: '/fixtures/statistics', params: { fixture: fixtureId },
        fixtureId, cfg, context: { mode: centerMode, limitedCoverage },
      });
      statistics = rowsOrEmpty(result.data);
      featureMeta.statistics = result.meta;
    }
  
    if (playerRows.length) {
      featureMeta.players = { feature:'players', provider:'api-football', source:'embedded', fetchedAt:fixtureFetchedAt, ageSeconds:0, fallback:false, policy:providerFeaturePolicy('players', { mode:centerMode, limitedCoverage }), ...providerDataState(playerRows, { attempted:true }) };
    } else if (live || finished) {
      const result = await providerFeatureFetch({
        feature: 'players', path: '/fixtures/players', params: { fixture: fixtureId },
        fixtureId, cfg, context: { mode: centerMode, limitedCoverage },
      });
      playerRows = rowsOrEmpty(result.data);
      featureMeta.players = result.meta;
    }
  
    const kickoffMsCenter = fixture.fixture?.date ? Date.parse(fixture.fixture.date) : NaN;
    const minutesToKickoffCenter = Number.isFinite(kickoffMsCenter)
      ? Math.round((kickoffMsCenter - Date.now()) / 60000)
      : null;
    const lineupsWindow = live || finished || (
      minutesToKickoffCenter !== null && minutesToKickoffCenter <= 120 && minutesToKickoffCenter >= -300
    );
  
    if (lineupRows.length) {
      featureMeta.lineups = { feature:'lineups', provider:'api-football', source:'embedded', fetchedAt:fixtureFetchedAt, ageSeconds:0, fallback:false, policy:providerFeaturePolicy('lineups', { mode:centerMode, limitedCoverage }), ...providerDataState(lineupRows, { attempted:true }) };
    } else if (lineupsWindow) {
      const result = await providerFeatureFetch({
        feature: 'lineups', path: '/fixtures/lineups', params: { fixture: fixtureId },
        fixtureId, cfg, context: { mode: centerMode, limitedCoverage },
      });
      lineupRows = rowsOrEmpty(result.data);
      featureMeta.lineups = result.meta;
    }
  
    if (!finished) {
      const result = await providerFeatureFetch({
        feature: 'injuries', path: '/injuries', params: { fixture: fixtureId },
        fixtureId, cfg, context: { mode: centerMode, limitedCoverage },
      });
      injuryRows = rowsOrEmpty(result.data);
      featureMeta.injuries = result.meta;
    }
  
    let liveOdds = null;
    let liveOddsQuality = assessOddsMarketQuality(null, { mode:centerMode });
    let oddsMovement = null;
    if (live && cfg.liveOddsEnabled) {
      const result = await providerFeatureFetch({
        feature: 'liveOdds', path: '/odds/live', params: { fixture: fixtureId },
        fixtureId, cfg, context: { mode: centerMode, limitedCoverage },
      });
      const primaryLiveOdds = extractLiveMarket(rowsOrEmpty(result.data));
      const primaryLiveMeta = usableOddsFeatureMeta(result.meta, primaryLiveOdds);
      const primaryLiveShape = assessOddsMarketQuality(primaryLiveOdds, { oddsMeta:primaryLiveMeta, mode:'live' });
      liveOdds = primaryLiveOdds;
      if (!primaryLiveOdds || !primaryLiveShape.marketValid) {
        const secondaryOdds = await secondaryOddsMarket(fixture, cfg, { mode:'live' });
        if (secondaryOdds?.available) {
          liveOdds = secondaryOdds.market;
          featureMeta.liveOdds = usableOddsFeatureMeta(secondaryOdds.meta, liveOdds);
        } else {
          featureMeta.liveOdds = usableOddsFeatureMeta(result.meta, primaryLiveOdds, secondaryOdds?.reason || '');
        }
      } else {
        featureMeta.liveOdds = primaryLiveMeta;
      }
    }
  
    for (const feature of ['events','statistics','players','lineups','injuries','liveOdds']) {
      if (featureMeta[feature]) featureMeta[feature] = applyFeatureFreshness(featureMeta[feature], { feature, mode:centerMode });
    }
    if (liveOdds || featureMeta.liveOdds) {
      liveOddsQuality = assessOddsMarketQuality(liveOdds, { oddsMeta:featureMeta.liveOdds || {}, mode:centerMode });
      featureMeta.liveOdds = annotateOddsReliability(featureMeta.liveOdds || { feature:'liveOdds' }, liveOddsQuality);
      liveOdds = oddsMarketForTrustedAnalytics(liveOdds, liveOddsQuality);
    }
    if (liveOdds) {
      await saveOddsSnapshot(fixtureId, liveOdds, cfg);
      const snapshots = await getOddsSnapshots(fixtureId, cfg, 12);
      oddsMovement = buildOddsMovement(snapshots, liveOdds);
    }
  
    const finalBudget = providerBudgetProfile();
    const runtimeControls = runtimeControlsSnapshot();
    const configuredRefreshSeconds = Number(finalBudget?.liveRefreshSeconds);
    const refreshSeconds = live && runtimeControls?.liveEnabled !== false && Number.isFinite(configuredRefreshSeconds)
      ? Math.max(0, Math.trunc(configuredRefreshSeconds))
      : 0;
    const rawFormattedStatistics = formatLiveStatistics(statistics, homeId, awayId);
    const statisticsQuality = assessMatchStatisticsQuality(rawFormattedStatistics, { statisticsMeta:featureMeta.statistics || {}, mode:centerMode });
    const xgQuality = assessExpectedGoalsQuality(rawFormattedStatistics, { statisticsMeta:featureMeta.statistics || {}, mode:centerMode });
    if (featureMeta.statistics || statisticsQuality.observed) {
      featureMeta.statistics = annotateStatisticsReliability(
        featureMeta.statistics || { feature:'statistics', provider:'api-football', source:'embedded', ageSeconds:0 },
        statisticsQuality,
      );
    }
    const rawFormattedEvents = formatLiveEvents(events, homeId, awayId);
    const eventQuality = assessMatchEventQuality(rawFormattedEvents, { eventsMeta:featureMeta.events || {}, mode:centerMode, elapsed });
    if (featureMeta.events || eventQuality.observed) {
      featureMeta.events = annotateEventReliability(
        featureMeta.events || { feature:'events', provider:'api-football', source:'embedded', ageSeconds:0 },
        eventQuality,
      );
    }
    const availabilityQuality = assessFixtureAvailabilityQuality(injuryRows, {
      homeId, awayId, injuriesMeta:featureMeta.injuries || {}, mode:centerMode,
    });
    if (featureMeta.injuries || availabilityQuality.observed) {
      featureMeta.injuries = annotateAvailabilityReliability(
        featureMeta.injuries || { feature:'injuries', provider:'api-football', source:'embedded', ageSeconds:0 },
        availabilityQuality,
      );
    }
    const trustedPlayerRows = featureMeta.players?.confidenceBearing === false ? [] : playerRows;
    const trustedInjuryRows = sanitizeAvailabilityRows(injuryRows, availabilityQuality);
    const statisticsForDisplay = sanitizeStatisticsForDisplay(rawFormattedStatistics, statisticsQuality);
    const publicStatistics = sanitizeExpectedGoalsForDisplay(statisticsForDisplay, xgQuality);
    const comparativeStatistics = statisticsForTrustedAnalytics(publicStatistics, statisticsQuality);
    const analyticalStatistics = statisticsForTrustedExpectedGoals(comparativeStatistics, xgQuality);
    const playerLeaders = formatPlayerLeaders(trustedPlayerRows, homeId, awayId);
    const lineups = formatLineups(lineupRows, homeId, awayId);
    const lineupQuality=assessMatchLineups(lineups);
    if (featureMeta.lineups || lineupQuality.anyPublished) {
      featureMeta.lineups = annotateLineupReliability(
        featureMeta.lineups || { feature:'lineups', provider:'api-football', source:'embedded', ageSeconds:0 },
        lineupQuality,
      );
    }
    const lineupSourceTrusted = featureMeta.lineups?.stale !== true && featureMeta.lineups?.provenanceState !== 'unknown';
    const absences = formatAbsences(trustedInjuryRows, homeId, awayId, lineupSourceTrusted ? lineups : null);
    const pressure = (live || finished) ? livePressure(analyticalStatistics) : null;
    const formattedEvents = sanitizeEventsForDisplay(rawFormattedEvents, eventQuality);
    const analyticalEvents = eventsForTrustedAnalytics(rawFormattedEvents, eventQuality);
    if (finished) await settlePredictionsFromFixtures([fixture], cfg).catch(() => null);
    const postMatchPrediction = finished
      ? await loadModelPredictionForFixture(fixtureId, cfg).catch(() => null)
      : null;
    const postMatchReview = finished
      ? buildPostMatchReview({prediction:postMatchPrediction,fixture,statistics:analyticalStatistics,events:analyticalEvents,homeName,awayName})
      : null;
    if (finished && fixture.fixture?.referee) await saveRefereeMatchHistory({ fixtureId, referee:fixture.fixture.referee, kickoffAt:fixture.fixture?.date || null, leagueId:Number(fixture.league?.id || 0), events:analyticalEvents, statistics:analyticalStatistics }, cfg).catch(() => false);
    const smartInsights = (live || finished) ? buildSmartMatchInsights({
      statistics: analyticalStatistics,
      events: analyticalEvents,
      pressure,
      score: scoreSnapshot(fixture),
      elapsed,
      status,
      homeName,
      awayName,
      playerLeaders,
      absences,
    }) : null;
  
    const prematchAnalysis = live ? await getStaleCache(`fixture:${fixtureId}:v15-availability-quality-rc144`, cfg).catch(() => null) : null;
    const aiTimeline = await loadFixtureAiTimeline({
      fixtureId,
      match: { fixtureId, date: fixture.fixture?.date || '', status, elapsed },
      events: formattedEvents,
      cfg,
    }).catch(() => buildAiTimeline({ match: { fixtureId, date: fixture.fixture?.date || '', status, elapsed }, events: formattedEvents }));
  
    const liveAiCoach = live ? buildLiveAiCoach({
      statistics: analyticalStatistics,
      events: analyticalEvents,
      pressure,
      score: scoreSnapshot(fixture),
      elapsed,
      homeName,
      awayName,
      smartInsights,
      prematch: prematchAnalysis,
      oddsMovement,
      xgQuality,
    }) : null;
  
    const dataCapabilities = publicDataCapabilities();
    const payload = {
      generatedAt: new Date().toISOString(),
      mode: centerMode,
      match: {
        fixtureId,
        date: fixture.fixture?.date || '',
        status,
        statusLong: fixture.fixture?.status?.long || '',
        statusLabel: statusLabel(status, elapsed),
        elapsed,
        venue: fixture.fixture?.venue?.name || '',
        city: fixture.fixture?.venue?.city || '',
        referee: fixture.fixture?.referee || '',
        timezone: fixture.fixture?.timezone || '',
        league: leagueName,
        leagueId: Number(fixture.league?.id || 0),
        leagueLogo: fixture.league?.logo || '',
        country: fixture.league?.country || '',
        round: fixture.league?.round || '',
        score: scoreSnapshot(fixture),
        integrity: { state: centerIntegrity.state, score: centerIntegrity.qualityScore, warnings: centerIntegrity.warnings, issues: centerIntegrity.issues.filter(x => x.severity !== 'info').slice(0, 3) },
        home: { id: homeId, name: homeName, logo: fixture.teams?.home?.logo || '' },
        away: { id: awayId, name: awayName, logo: fixture.teams?.away?.logo || '' },
      },
      events: formattedEvents,
      eventQuality,
      statistics: publicStatistics,
      statisticsQuality,
      xgQuality,
      livePressure: pressure,
      smartInsights,
      liveAiCoach,
      aiTimeline,
      postMatchReview,
      playerLeaders,
      lineups,
      lineupQuality,
      availabilityQuality,
      absences,
      dataFreshness: featureMeta,
      quotaMode: providerPublicBudgetMode(),
      availability: {
        events: Boolean(eventQuality?.confidenceBearing && formattedEvents.length > 0),
        statistics: Boolean(statisticsQuality?.confidenceBearing),
        xg: Boolean(xgQuality?.confidenceBearing),
        lineups: lineupQuality.anyPublished,
        lineupsTrusted: Boolean(featureMeta.lineups?.confidenceBearing),
        lineupsConfirmed: lineupQuality.bothConfirmed,
        lineupsPartial: lineupQuality.partialSides > 0,
        players: Boolean(featureMeta.players?.confidenceBearing && (playerLeaders.home.length > 0 || playerLeaders.away.length > 0)),
        injuries: Boolean(availabilityQuality?.confidenceBearing && trustedInjuryRows.length > 0),
        liveOdds: Boolean(liveOddsQuality?.confidenceBearing && liveOdds),
        limitedCoverage,
      },
      dataCapabilities,
      liveOddsQuality,
      liveOdds,
      oddsMovement,
      provider: dataCapabilities,
      refreshSeconds,
      note: limitedCoverage
        ? 'Молодёжный или резервный турнир: дополнительные запросы данных ограничены для экономии квоты.'
        : finalBudget.mode === 'emergency'
          ? 'Квота источника данных в защитном резерве: часть расширенных данных временно берётся из сохранённых данных или пропускается.'
          : finalBudget.mode === 'conserve'
            ? 'Включён сберегающий режим: тяжёлые дополнительные запросы обновляются реже.'
            : (!events.length && !statistics.length)
              ? 'Для этого турнира или матча источник данных не отдаёт детальные события/статистику.'
              : '',
    };
  
    await setCache(baseCacheKey, fixtureId, payload, cfg, live ? Math.max(1/6, refreshSeconds / 60) : finished ? 720 : 5);
    return json({ ...payload, cached: false });
  }

  return { apiMatchCenter };
}
