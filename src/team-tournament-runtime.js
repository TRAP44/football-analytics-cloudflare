// Team, tournament and secondary-provider orchestration extracted from worker.js.
// Provider, cache and domain primitives are injected by the composition root.
export function createTeamTournamentRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Team tournament runtime dependencies are required.');
  }
  const {
    apiFootball,
    compactProviderError,
    footballDataScorersUrl,
    footballDataStandingsUrl,
    freeQuotaHealthy,
    getCache,
    getCacheEntry,
    getStaleCache,
    hasSupabase,
    isFinishedStatus,
    isFootballRateLimitError,
    isLiveStatus,
    json,
    loadProviderTeamDiscoveryFixtures,
    markCachedSourceMeta,
    normalizeCompetition,
    normalizeCountryName,
    normalizeFootballDataStandings,
    normalizeFootballDataTeamScorers,
    normalizeOpenLigaMatchEvents,
    normalizeOpenLigaStandings,
    normalizeRoundLabel,
    normalizeTheOddsApiMarket,
    openLigaCompetition,
    openLigaMatchDataUrls,
    openLigaTableUrls,
    providerDataState,
    providerFeaturePolicy,
    providerMinuteRemaining,
    publicDataCapabilities,
    recordOpsEvent,
    resolveProviderChain,
    scoreSnapshot,
    secondaryProviderJson,
    setCache,
    sourceMeta,
    splitTeamDiscoveryMatches,
    statusLabel,
    summarizeFormRows,
    supaRpc,
    teamDiscoveryFutureDays,
    teamDiscoveryPastDays,
    teamDiscoveryWindow,
    teamResult,
    theOddsApiUrl,
  } = deps;

  const requiredFunctions = {
    apiFootball,
    compactProviderError,
    footballDataScorersUrl,
    footballDataStandingsUrl,
    freeQuotaHealthy,
    getCache,
    getCacheEntry,
    getStaleCache,
    hasSupabase,
    isFinishedStatus,
    isFootballRateLimitError,
    isLiveStatus,
    json,
    loadProviderTeamDiscoveryFixtures,
    markCachedSourceMeta,
    normalizeCompetition,
    normalizeCountryName,
    normalizeFootballDataStandings,
    normalizeFootballDataTeamScorers,
    normalizeOpenLigaMatchEvents,
    normalizeOpenLigaStandings,
    normalizeRoundLabel,
    normalizeTheOddsApiMarket,
    openLigaCompetition,
    openLigaMatchDataUrls,
    openLigaTableUrls,
    providerDataState,
    providerFeaturePolicy,
    providerMinuteRemaining,
    publicDataCapabilities,
    recordOpsEvent,
    resolveProviderChain,
    scoreSnapshot,
    secondaryProviderJson,
    setCache,
    sourceMeta,
    splitTeamDiscoveryMatches,
    statusLabel,
    summarizeFormRows,
    supaRpc,
    teamDiscoveryWindow,
    teamResult,
    theOddsApiUrl,
  };
  for (const [name, fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

  const normalizedPastDays = Number(teamDiscoveryPastDays);
  const normalizedFutureDays = Number(teamDiscoveryFutureDays);
  if (!Number.isSafeInteger(normalizedPastDays) || normalizedPastDays < 0) {
    throw new TypeError('teamDiscoveryPastDays is required');
  }
  if (!Number.isSafeInteger(normalizedFutureDays) || normalizedFutureDays < 0) {
    throw new TypeError('teamDiscoveryFutureDays is required');
  }

  function rows(value) {
    return Array.isArray(value) ? value : [];
  }

  function finiteNumber(value, fallback = 0) {
    try {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    } catch {
      return fallback;
    }
  }

  function integer(value, fallback = 0) {
    return Math.trunc(finiteNumber(value, fallback));
  }

  function nonNegativeInteger(value, fallback = 0) {
    return Math.max(0, integer(value, fallback));
  }

  function positiveSafeInteger(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = finiteNumber(value, NaN);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function safeText(value, max = 240) {
    if (!['string', 'number', 'bigint'].includes(typeof value)) return '';
    return String(value).trim().slice(0, max);
  }

  function capabilities() {
    try {
      const value = publicDataCapabilities();
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function providerMinuteBudget() {
    try {
      return finiteNumber(providerMinuteRemaining(), NaN);
    } catch {
      return NaN;
    }
  }

  function normalizeStandingRow(row = {}) {
    const all = row?.all && typeof row.all === 'object' ? row.all : {};
    const goals = all?.goals && typeof all.goals === 'object' ? all.goals : {};
    return {
      rank: nonNegativeInteger(row?.rank),
      team: {
        id: positiveSafeInteger(row?.team?.id) || 0,
        providerId: null,
        name: safeText(row?.team?.name, 180),
        logo: safeText(row?.team?.logo, 500),
      },
      points: nonNegativeInteger(row?.points),
      goalsDiff: integer(row?.goalsDiff),
      played: nonNegativeInteger(all?.played),
      win: nonNegativeInteger(all?.win),
      draw: nonNegativeInteger(all?.draw),
      lose: nonNegativeInteger(all?.lose),
      goalsFor: nonNegativeInteger(goals?.for),
      goalsAgainst: nonNegativeInteger(goals?.against),
      form: safeText(row?.form, 12).slice(-6),
      description: safeText(row?.description, 500),
    };
  }

  function normalizeApiFootballStandings(response = [], leagueId, season) {
    const leagueKey = positiveSafeInteger(leagueId) || 0;
    const seasonKey = nonNegativeInteger(season);
    const first = rows(response)[0];
    const league = first?.league && typeof first.league === 'object' ? first.league : {};
    const groups = rows(league?.standings);
    const normalizedGroups = groups.map((groupRows, index) => ({
      name: groups.length > 1 ? `Группа ${index + 1}` : '',
      rows: rows(groupRows).map(normalizeStandingRow).filter(item => item.team.id),
    })).filter(group => group.rows.length);
    const standings = normalizedGroups.flatMap(group => group.rows);
    return {
      leagueId: leagueKey,
      season: seasonKey,
      available: standings.length > 0,
      league: {
        id: positiveSafeInteger(league?.id) || leagueKey,
        name: safeText(league?.name, 180),
        country: normalizeCountryName(league?.country || ''),
        logo: safeText(league?.logo, 500),
        flag: safeText(league?.flag, 500),
        season: nonNegativeInteger(league?.season, seasonKey),
      },
      groups: normalizedGroups,
      standings,
      reason: standings.length ? '' : 'API-Football не вернул таблицу для этого турнира и сезона.',
      sourceMeta: sourceMeta({ provider:'api-football', label:'API-Football' }),
    };
  }

  async function claimSecondaryProviderBudget(cfg, provider, limit) {
    if (!hasSupabase(cfg)) return { allowed:false, reason:'shared_rate_guard_unavailable' };
    const normalizedProvider = safeText(provider, 80) || 'unknown';
    const requestLimit = Math.max(1, Math.min(10000, nonNegativeInteger(limit, 1) || 1));
    try {
      const result = await supaRpc(cfg, 'claim_provider_request', {
        p_bucket_key: `secondary:${normalizedProvider}:minute`,
        p_limit: requestLimit,
        p_window_seconds: 60,
      });
      return {
        allowed: result?.allowed === true,
        reason: safeText(result?.reason, 160),
        retryAfter: positiveSafeInteger(result?.retryAfter),
      };
    } catch (error) {
      await recordOpsEvent(cfg, {
        severity:'warning', source:'provider', eventType:'secondary_rate_guard',
        code:'SECONDARY_RATE_GUARD_UNAVAILABLE', message:error?.message || error,
        meta:{ provider:normalizedProvider },
      }).catch(() => null);
      return { allowed:false, reason:'shared_rate_guard_unavailable' };
    }
  }

  async function openLigaStandingsProvider(leagueId, season, cfg) {
    const competition = openLigaCompetition(leagueId, season);
    if (!competition) return { available:false, reason:'competition_not_supported' };
    const budget = await claimSecondaryProviderBudget(cfg, 'openligadb', 50);
    if (!budget.allowed) return { available:false, reason:budget.reason || 'secondary_rate_limit' };

    for (const candidate of rows(openLigaTableUrls(leagueId, season))) {
      const candidateUrl=safeText(candidate?.url, 2000);
      if (!candidateUrl) continue;
      try {
        const payload = await secondaryProviderJson(candidateUrl, cfg, {
          provider:'OpenLigaDB',
          operation:'standings',
          timeoutMs:6500,
        });
        const normalized = normalizeOpenLigaStandings(payload, {
          leagueId,
          season,
          label:safeText(competition?.label, 180),
        });
        if (normalized?.available) return normalized;
      } catch (error) {
        await recordOpsEvent(cfg, {
          severity:'info', source:'provider', eventType:'fallback_provider_failure',
          code:'OPENLIGADB_STANDINGS', message:error?.message || error,
          meta:{ leagueId:integer(leagueId), season:integer(season), shortcut:safeText(candidate?.shortcut, 80) },
        }).catch(() => null);
      }
    }
    return { available:false, reason:'openligadb_empty' };
  }

  function openLigaEventFeatureMeta(events, providerSourceMeta = {}, { source = 'network', fetchedAt = null, expiresAt = null, context = {} } = {}) {
    const parsedFetchedAt=Date.parse(String(fetchedAt || ''));
    return {
      feature:'events',
      provider:'openligadb',
      source:safeText(source, 40) || 'network',
      fetchedAt,
      ageSeconds:Number.isFinite(parsedFetchedAt)
        ? Math.max(0, Math.floor((Date.now() - parsedFetchedAt) / 1000))
        : null,
      expiresAt,
      policy:providerFeaturePolicy('events', context),
      fallback:true,
      attribution:safeText(providerSourceMeta?.attribution, 240) || 'OpenLigaDB · ODbL',
      ...providerDataState(rows(events), { attempted:true }),
    };
  }

  async function secondaryOpenLigaEvents(fixture, cfg, context = {}) {
    const fixtureId=positiveSafeInteger(fixture?.fixture?.id);
    const leagueId=positiveSafeInteger(fixture?.league?.id);
    const season=nonNegativeInteger(fixture?.league?.season);
    const homeName=safeText(fixture?.teams?.home?.name, 180);
    const awayName=safeText(fixture?.teams?.away?.name, 180);
    const urls=rows(openLigaMatchDataUrls(leagueId || 0, season, homeName));
    if (!fixtureId || !urls.length) {
      return { available:false, reason:'competition_not_supported', events:[], meta:null };
    }

    const cacheKey=`secondary-events:${fixtureId}:openligadb:v1`;
    const fresh=await getCacheEntry(cacheKey, cfg, false).catch(() => null);
    if (rows(fresh?.payload?.events).length) {
      return {
        available:true,
        events:rows(fresh.payload.events),
        meta:openLigaEventFeatureMeta(fresh.payload.events, fresh.payload.sourceMeta || {}, {
          source:'cache',
          fetchedAt:fresh.payload.fetchedAt || null,
          expiresAt:fresh.expiresAt || null,
          context,
        }),
      };
    }

    const budget=await claimSecondaryProviderBudget(cfg, 'openligadb', 50);
    if (!budget.allowed) return { available:false, reason:budget.reason || 'secondary_rate_limit', events:[], meta:null };

    for (const candidate of urls) {
      const candidateUrl=safeText(candidate?.url, 2000);
      if (!candidateUrl) continue;
      try {
        const payload=await secondaryProviderJson(candidateUrl, cfg, {
          provider:'OpenLigaDB',
          operation:'match_events',
          timeoutMs:6500,
        });
        const normalized=normalizeOpenLigaMatchEvents(payload, {
          homeId:positiveSafeInteger(fixture?.teams?.home?.id) || 0,
          awayId:positiveSafeInteger(fixture?.teams?.away?.id) || 0,
          homeName,
          awayName,
          kickoffAt:safeText(fixture?.fixture?.date, 80),
        });
        if (!normalized?.available || !rows(normalized?.events).length) continue;

        const parsedUpdatedAt=Date.parse(String(normalized?.updatedAt || ''));
        const fetchedAt=Number.isFinite(parsedUpdatedAt)
          ? new Date(parsedUpdatedAt).toISOString()
          : new Date().toISOString();
        const policy=providerFeaturePolicy('events', context) || {};
        const ttlSeconds=Math.max(45, Math.min(3600, nonNegativeInteger(policy?.ttlSeconds, 60) || 60));
        await setCache(cacheKey, fixtureId, {
          events:rows(normalized.events),
          sourceMeta:normalized.sourceMeta,
          fetchedAt,
        }, cfg, ttlSeconds / 60).catch(() => null);

        return {
          available:true,
          events:rows(normalized.events),
          meta:openLigaEventFeatureMeta(normalized.events, normalized.sourceMeta, {
            source:'network',
            fetchedAt,
            expiresAt:new Date(Date.now() + ttlSeconds * 1000).toISOString(),
            context,
          }),
        };
      } catch (error) {
        await recordOpsEvent(cfg, {
          severity:'info', source:'provider', eventType:'fallback_provider_failure',
          code:'OPENLIGADB_EVENTS', message:error?.message || error,
          meta:{ fixtureId, leagueId:leagueId || 0, season, shortcut:safeText(candidate?.shortcut, 80) },
        }).catch(() => null);
      }
    }
    return { available:false, reason:'openligadb_events_unavailable', events:[], meta:null };
  }

  async function footballDataStandingsProvider(leagueId, season, cfg) {
    const token=safeText(cfg?.footballDataToken, 500);
    if (!token) return { available:false, reason:'token_not_configured' };
    const url=footballDataStandingsUrl(leagueId, season);
    if (!url) return { available:false, reason:'competition_not_supported' };
    const budget=await claimSecondaryProviderBudget(cfg, 'football-data', 9);
    if (!budget.allowed) return { available:false, reason:budget.reason || 'secondary_rate_limit' };

    const payload=await secondaryProviderJson(url, cfg, {
      provider:'football-data.org',
      operation:'standings',
      timeoutMs:6500,
      headers:{ 'x-auth-token':token },
    });
    return normalizeFootballDataStandings(payload, { leagueId, season });
  }

  function oddsFallbackMeta(feature, market, { source = 'network', fetchedAt = null, expiresAt = null } = {}) {
    const sourceUpdatedAt = Number.isFinite(Date.parse(String(market?.updatedAt || ''))) ? String(market.updatedAt) : null;
    const ageAnchor = sourceUpdatedAt || fetchedAt;
    return {
      feature,
      provider: 'the-odds-api',
      source,
      fetchedAt,
      sourceUpdatedAt,
      ageSeconds: ageAnchor && Number.isFinite(Date.parse(String(ageAnchor)))
        ? Math.max(0, Math.floor((Date.now() - Date.parse(String(ageAnchor))) / 1000))
        : null,
      expiresAt,
      fallback: true,
      ...providerDataState(market ? [market] : [], { attempted:true }),
    };
  }
  
  function usableOddsFeatureMeta(meta = {}, market = null, fallbackReason = '') {
    if (market) {
      const sourceUpdatedAt=Number.isFinite(Date.parse(String(market?.updatedAt || '')))
        ? String(market.updatedAt)
        : (meta?.sourceUpdatedAt || null);
      return {
        ...meta,
        provider:safeText(market?.provider || meta?.provider, 80) || 'api-football',
        sourceUpdatedAt,
        state:'available',
        available:true,
        observed:true,
        usable:true,
        degraded:false,
        reason:'',
        count:Math.max(1, nonNegativeInteger(market?.sources ?? market?.bookmakers, 1)),
      };
    }
    if (meta?.degraded) return { ...meta, usable:false, fallbackReason:safeText(fallbackReason, 240) };
    return {
      ...meta,
      state:'empty_response',
      available:false,
      observed:Boolean(meta?.observed ?? true),
      usable:false,
      degraded:false,
      reason:safeText(meta?.reason, 160) || '1x2_market_missing',
      count:0,
      fallbackReason:safeText(fallbackReason, 240),
    };
  }

  async function secondaryOddsMarket(fixture, cfg, { mode = 'prematch' } = {}) {
    const fixtureId=positiveSafeInteger(fixture?.fixture?.id);
    const leagueId=positiveSafeInteger(fixture?.league?.id);
    const feature=mode === 'live' ? 'liveOdds' : 'odds';
    if (!fixtureId) return { available:false, reason:'invalid_fixture', market:null, meta:null };

    const apiKey=safeText(cfg?.theOddsApiKey, 500);
    if (!apiKey) return { available:false, reason:'token_not_configured', market:null, meta:null };

    const baseUrl=theOddsApiUrl(leagueId || 0);
    if (!baseUrl) return { available:false, reason:'competition_not_supported', market:null, meta:null };

    const cacheKey=`secondary-odds:${fixtureId}:the-odds-api:${feature}:v2`;
    const fresh=await getCacheEntry(cacheKey, cfg, false).catch(() => null);
    if (fresh?.payload?.market) {
      return {
        available:true,
        market:fresh.payload.market,
        meta:oddsFallbackMeta(feature, fresh.payload.market, {
          source:'cache',
          fetchedAt:fresh.payload.fetchedAt || null,
          expiresAt:fresh.expiresAt || null,
        }),
      };
    }

    const budget=await claimSecondaryProviderBudget(cfg, 'the-odds-api', 8);
    if (!budget.allowed) return { available:false, reason:budget.reason || 'secondary_rate_limit', market:null, meta:null };

    try {
      const url=new URL(baseUrl);
      url.searchParams.set('apiKey', apiKey);
      const payload=await secondaryProviderJson(url.toString(), cfg, {
        provider:'The Odds API',
        operation:'odds',
        timeoutMs:6500,
      });
      const market=normalizeTheOddsApiMarket(payload, {
        homeName:safeText(fixture?.teams?.home?.name, 180),
        awayName:safeText(fixture?.teams?.away?.name, 180),
        kickoffAt:safeText(fixture?.fixture?.date, 80),
      });
      if (!market) return { available:false, reason:'fixture_not_matched', market:null, meta:null };

      const fetchedAt=new Date().toISOString();
      const kickoffMs=Date.parse(String(fixture?.fixture?.date || ''));
      const minutesToKickoff=Number.isFinite(kickoffMs) ? Math.round((kickoffMs-Date.now())/60000) : null;
      const ttlMinutes=mode === 'live' ? 1 : minutesToKickoff !== null && minutesToKickoff<=120 ? 3 : 5;
      const expiresAt=new Date(Date.now()+ttlMinutes*60000).toISOString();
      const cachePayload={
        market,
        provider:'the-odds-api',
        fetchedAt,
        sourceMeta:sourceMeta({
          provider:'the-odds-api',
          label:'The Odds API',
          fetchedAt,
          freshness:'fresh',
          fallback:true,
        }),
      };
      await setCache(cacheKey, fixtureId, cachePayload, cfg, ttlMinutes).catch(() => null);
      await recordOpsEvent(cfg, {
        severity:'info', source:'provider', eventType:'provider_fallback',
        code:'ODDS_FALLBACK_USED',
        message:'Для рынка 1X2 использован разрешённый резервный источник.',
        meta:{ fixtureId, leagueId:leagueId || 0, mode, provider:'the-odds-api' },
      }).catch(() => null);

      return {
        available:true,
        market,
        meta:oddsFallbackMeta(feature, market, { source:'network', fetchedAt, expiresAt }),
      };
    } catch (error) {
      await recordOpsEvent(cfg, {
        severity:'info', source:'provider', eventType:'fallback_provider_failure',
        code:'THE_ODDS_API_ODDS',
        message:error?.message || error,
        meta:{ fixtureId, leagueId:leagueId || 0, mode },
      }).catch(() => null);
      return { available:false, reason:safeText(error?.code, 120) || 'provider_error', market:null, meta:null };
    }
  }

  async function resolveTournamentStandings(leagueId, season, cfg, { skipPrimary = false } = {}) {
    const rawResult=await resolveProviderChain({
      feature:'standings',
      providers:[
        {
          id:'api-football', label:'API-Football',
          enabled:!skipPrimary,
          skipReason:skipPrimary ? 'quota_reserve' : '',
          run:async () => normalizeApiFootballStandings(
            await apiFootball('/standings', { league:leagueId, season }, cfg),
            leagueId,
            season,
          ),
        },
        {
          id:'openligadb', label:'OpenLigaDB',
          enabled:Boolean(openLigaCompetition(leagueId, season)),
          skipReason:'competition_not_supported',
          run:async () => openLigaStandingsProvider(leagueId, season, cfg),
        },
        {
          id:'football-data', label:'football-data.org',
          enabled:Boolean(cfg?.footballDataToken && footballDataStandingsUrl(leagueId, season)),
          skipReason:cfg?.footballDataToken ? 'competition_not_supported' : 'token_not_configured',
          run:async () => footballDataStandingsProvider(leagueId, season, cfg),
        },
      ],
      accept:value => Boolean(value?.available && rows(value?.standings).length),
    });

    const result=rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
      ? rawResult
      : {
          available:false,
          standings:[],
          groups:[],
          reason:'provider_chain_invalid_response',
          sourceMeta:sourceMeta({provider:'none',label:'Нет доступного источника',freshness:'unavailable'}),
        };

    if (result.available && result.sourceMeta?.fallback) {
      await recordOpsEvent(cfg, {
        severity:'info', source:'provider', eventType:'provider_fallback',
        code:'STANDINGS_FALLBACK_USED',
        message:'Для турнирной таблицы использован разрешённый резервный источник.',
        meta:{
          leagueId:integer(leagueId),
          season:integer(season),
          provider:safeText(result.sourceMeta?.provider, 80),
        },
      }).catch(() => null);
    }
    return result;
  }

  async function apiTournament(request, cfg) {
    const url=new URL(request.url);
    const leagueId=positiveSafeInteger(url.searchParams.get('leagueId'));
    const season=positiveSafeInteger(url.searchParams.get('season'));
    if (!leagueId) return json({ error:'Номер турнира обязателен.' },400);
    if (!season || season<2000 || season>2100) return json({ error:'Сезон обязателен.' },400);

    const cacheKey=`tournament:${leagueId}:${season}:standings:v1`;
    const cached=await getCache(cacheKey,cfg).catch(()=>null);
    if (cached && typeof cached === 'object' && !Array.isArray(cached)) return json({
      ...cached,
      sourceMeta:markCachedSourceMeta(cached.sourceMeta || sourceMeta({provider:'api-football',label:'API-Football'})),
      cached:true,
      stale:false,
      provider:capabilities(),
    });

    const remaining=providerMinuteBudget();
    const skipPrimary=Number.isFinite(remaining) && remaining<=1;
    const resolved=await resolveTournamentStandings(leagueId,season,cfg,{skipPrimary});

    if (resolved?.available) {
      const payload={...resolved,refreshedAt:new Date().toISOString()};
      const ttlMinutes=resolved.sourceMeta?.provider === 'api-football' ? 360 : 30;
      await setCache(cacheKey,0,payload,cfg,ttlMinutes).catch(()=>null);
      return json({...payload,cached:false,stale:false,provider:capabilities()});
    }

    const stale=await getStaleCache(cacheKey,cfg).catch(()=>null);
    if (stale && typeof stale === 'object' && !Array.isArray(stale)) return json({
      ...stale,
      sourceMeta:markCachedSourceMeta(
        stale.sourceMeta || sourceMeta({provider:'api-football',label:'API-Football'}),
        {stale:true},
      ),
      cached:true,
      stale:true,
      warning:skipPrimary
        ? 'Показана последняя сохранённая таблица: основной источник находится в защитном резерве квоты.'
        : 'Не удалось обновить таблицу ни из основного, ни из разрешённых резервных источников.',
      provider:capabilities(),
    });

    return json({
      leagueId,
      season,
      standings:[],
      groups:[],
      available:false,
      reason:skipPrimary
        ? 'Основной источник находится в защитном резерве квоты, а подходящий резервный источник не вернул таблицу.'
        : 'Таблица временно недоступна во всех настроенных источниках.',
      sourceMeta:resolved?.sourceMeta || null,
      provider:capabilities(),
    });
  }


  function normalizeTeamHubMatch(fixture, teamId) {
    const f=fixture && typeof fixture === 'object' && !Array.isArray(fixture) ? fixture : {};
    const normalizedTeamId=positiveSafeInteger(teamId);
    const homeId=positiveSafeInteger(f?.teams?.home?.id) || 0;
    const awayId=positiveSafeInteger(f?.teams?.away?.id) || 0;
    const belongsToTeam=!normalizedTeamId || homeId===normalizedTeamId || awayId===normalizedTeamId;
    if (!belongsToTeam) return { fixtureId:0 };
    const isHome=Boolean(normalizedTeamId && homeId===normalizedTeamId);
    const opponent=isHome ? f?.teams?.away : f?.teams?.home;
    const status=safeText(f?.fixture?.status?.short,20).toUpperCase();
    const elapsedValue=nonNegativeInteger(f?.fixture?.status?.elapsed);
    const elapsed=elapsedValue || null;
    const competition=normalizeCompetition(
      positiveSafeInteger(f?.league?.id) || 0,
      safeText(f?.league?.name,180),
      safeText(f?.league?.country,120),
      safeText(f?.teams?.home?.name,180),
      safeText(f?.teams?.away?.name,180),
    );
    const result=normalizedTeamId && isFinishedStatus(status) ? teamResult(f,normalizedTeamId) : null;

    return {
      fixtureId:positiveSafeInteger(f?.fixture?.id) || 0,
      date:safeText(f?.fixture?.date,80),
      status,
      statusLong:safeText(f?.fixture?.status?.long,120),
      statusLabel:statusLabel(status,elapsed),
      elapsed,
      live:isLiveStatus(status),
      finished:isFinishedStatus(status),
      score:scoreSnapshot(f),
      venue:isHome ? 'home' : 'away',
      result:safeText(result?.result,20),
      goalsFor:result?.gf ?? null,
      goalsAgainst:result?.ga ?? null,
      opponent:{
        id:positiveSafeInteger(opponent?.id) || 0,
        name:safeText(opponent?.name,180),
        logo:safeText(opponent?.logo,500),
      },
      home:{
        id:homeId,
        name:safeText(f?.teams?.home?.name,180),
        logo:safeText(f?.teams?.home?.logo,500),
      },
      away:{
        id:awayId,
        name:safeText(f?.teams?.away?.name,180),
        logo:safeText(f?.teams?.away?.logo,500),
      },
      leagueId:positiveSafeInteger(f?.league?.id) || 0,
      season:positiveSafeInteger(f?.league?.season),
      league:safeText(competition?.name,180),
      leagueShort:safeText(competition?.shortName,120),
      leagueLogo:safeText(f?.league?.logo,500),
      country:safeText(competition?.country,120),
      round:safeText(f?.league?.round,120),
      roundLabel:normalizeRoundLabel(f?.league?.round || ''),
      competition,
    };
  }

  function choosePrimaryTeamCompetition(matches = []) {
    const byLeague=new Map();
    for (const match of rows(matches)) {
      const id=positiveSafeInteger(match?.leagueId);
      if (!id || match?.competition?.youth || match?.competition?.friendly) continue;
      const priority=nonNegativeInteger(match?.competition?.priority);
      const current=byLeague.get(id) || {count:0,item:match,priority};
      current.count+=1;
      if (priority>current.priority) {
        current.priority=priority;
        current.item=match;
      }
      byLeague.set(id,current);
    }

    const best=[...byLeague.values()].sort(
      (a,b)=>(b.count*10+b.priority)-(a.count*10+a.priority),
    )[0];
    if (!best?.item) return null;

    const match=best.item;
    return {
      leagueId:positiveSafeInteger(match?.leagueId) || 0,
      season:positiveSafeInteger(match?.season) || new Date().getUTCFullYear(),
      name:safeText(match?.league,180) || 'Турнир',
      shortName:safeText(match?.leagueShort || match?.league,120) || 'Турнир',
      logo:safeText(match?.leagueLogo,500),
      country:safeText(match?.country,120),
      category:safeText(match?.competition?.category,80),
      tier:safeText(match?.competition?.tier,80) || 'standard',
      priority:nonNegativeInteger(match?.competition?.priority),
    };
  }

  async function cachedTeamStanding(teamId, competition, cfg) {
    const normalizedTeamId=positiveSafeInteger(teamId);
    const leagueId=positiveSafeInteger(competition?.leagueId);
    const season=positiveSafeInteger(competition?.season);
    if (!normalizedTeamId || !leagueId || !season) return null;

    const cached=await getCache(`tournament:${leagueId}:${season}:standings:v1`,cfg).catch(()=>null);
    const row=rows(cached?.standings).find(
      item=>positiveSafeInteger(item?.team?.id)===normalizedTeamId,
    );
    if (!row) return null;

    return {
      rank:nonNegativeInteger(row?.rank),
      points:nonNegativeInteger(row?.points),
      played:nonNegativeInteger(row?.played),
      win:nonNegativeInteger(row?.win),
      draw:nonNegativeInteger(row?.draw),
      lose:nonNegativeInteger(row?.lose),
      goalsFor:nonNegativeInteger(row?.goalsFor),
      goalsAgainst:nonNegativeInteger(row?.goalsAgainst),
      goalsDiff:integer(row?.goalsDiff),
      form:safeText(row?.form,12),
    };
  }

  async function apiTeam(request, cfg) {
    const url=new URL(request.url);
    const teamId=positiveSafeInteger(url.searchParams.get('teamId'));
    if (!teamId) return json({error:'Номер команды обязателен.'},400);

    const window=teamDiscoveryWindow() || {};
    const from=safeText(window?.from,20);
    const to=safeText(window?.to,20);
    const cacheKey=`teamhub:${teamId}:${from}:${to}:v2`;
    const cached=await getCache(cacheKey,cfg).catch(()=>null);

    if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
      return json({
        ...cached,
        standing:await cachedTeamStanding(teamId,cached.primaryCompetition,cfg),
        sourceMeta:markCachedSourceMeta(
          cached.sourceMeta || sourceMeta({provider:'api-football',label:'API-Football'}),
        ),
        cached:true,
        stale:false,
        provider:capabilities(),
      });
    }

    let fixtures;
    try {
      fixtures=await loadProviderTeamDiscoveryFixtures(teamId,cfg);
    } catch (error) {
      const stale=await getStaleCache(cacheKey,cfg).catch(()=>null);
      if (
        stale
        && typeof stale === 'object'
        && !Array.isArray(stale)
        && isFootballRateLimitError(error)
      ) {
        return json({
          ...stale,
          standing:await cachedTeamStanding(teamId,stale.primaryCompetition,cfg),
          sourceMeta:markCachedSourceMeta(
            stale.sourceMeta || sourceMeta({provider:'api-football',label:'API-Football'}),
            {stale:true},
          ),
          cached:true,
          stale:true,
          warning:'Страница команды показана из последних сохранённых данных из-за лимита источника данных.',
          provider:capabilities(),
        });
      }
      throw error;
    }

    const usable=rows(fixtures).filter(fixture=>
      !['CANC','PST','ABD','AWD','WO'].includes(
        safeText(fixture?.fixture?.status?.short,20).toUpperCase(),
      ),
    );
    const normalized=usable
      .map(fixture=>normalizeTeamHubMatch(fixture,teamId))
      .filter(match=>match.fixtureId);
    const discovery=splitTeamDiscoveryMatches(normalized,'',{upcomingLimit:8,recentLimit:8}) || {};
    const recent=rows(discovery?.recent);
    const upcoming=rows(discovery?.upcoming);

    let rawTeam=null;
    for (const fixture of usable) {
      if (positiveSafeInteger(fixture?.teams?.home?.id)===teamId) {
        rawTeam=fixture?.teams?.home;
        break;
      }
      if (positiveSafeInteger(fixture?.teams?.away?.id)===teamId) {
        rawTeam=fixture?.teams?.away;
        break;
      }
    }

    const team={
      id:teamId,
      name:safeText(rawTeam?.name || url.searchParams.get('name'),180) || `Команда ${teamId}`,
      logo:safeText(rawTeam?.logo || url.searchParams.get('logo'),500),
    };
    const completedRaw=usable.filter(fixture=>isFinishedStatus(fixture?.fixture?.status?.short));
    const form=summarizeFormRows(completedRaw,teamId,'home')?.overall || null;
    const primaryCompetition=choosePrimaryTeamCompetition(normalized);
    const standing=await cachedTeamStanding(teamId,primaryCompetition,cfg);
    const primaryFixtureId=positiveSafeInteger(discovery?.primary?.fixtureId);

    const payload={
      team,
      primaryCompetition,
      standing,
      form,
      recent,
      upcoming,
      primaryFixtureId,
      discovery:{
        mode:safeText(discovery?.mode,40) || (upcoming.length ? 'upcoming' : recent.length ? 'recent' : 'empty'),
        primaryFixtureId,
        primaryReason:safeText(discovery?.primary?.selection?.reason,240),
        windowPastDays:normalizedPastDays,
        windowFutureDays:normalizedFutureDays,
      },
      liveNow:upcoming.find(match=>match?.live===true) || null,
      nextMatch:upcoming.find(match=>match?.live!==true) || upcoming[0] || null,
      refreshedAt:new Date().toISOString(),
      sourceMeta:sourceMeta({provider:'api-football',label:'API-Football'}),
    };

    await setCache(cacheKey,teamId,payload,cfg,120).catch(()=>null);
    return json({...payload,cached:false,stale:false,provider:capabilities()});
  }


  function teamStatsNum(value) {
    return finiteNumber(value, 0);
  }
  
  function teamStatsAvg(value) {
    const normalized=safeText(value,40).replace(',', '.');
    if (!normalized) return null;
    const number=finiteNumber(normalized,NaN);
    return Number.isFinite(number) ? Math.round(number*100)/100 : null;
  }

  function teamStatsRate(part, total) {
    const p = teamStatsNum(part), t = teamStatsNum(total);
    return t > 0 ? Math.round((p / t) * 1000) / 10 : null;
  }
  
  function normalizeTeamSeasonStatistics(row, fallback = {}) {
    const source=row && typeof row === 'object' && !Array.isArray(row) ? row : {};
    const fixtures=source?.fixtures && typeof source.fixtures === 'object' ? source.fixtures : {};
    const played=fixtures?.played && typeof fixtures.played === 'object' ? fixtures.played : {};
    const wins=fixtures?.wins && typeof fixtures.wins === 'object' ? fixtures.wins : {};
    const draws=fixtures?.draws && typeof fixtures.draws === 'object' ? fixtures.draws : {};
    const loses=fixtures?.loses && typeof fixtures.loses === 'object' ? fixtures.loses : {};
    const goalsFor=source?.goals?.for && typeof source.goals.for === 'object' ? source.goals.for : {};
    const goalsAgainst=source?.goals?.against && typeof source.goals.against === 'object' ? source.goals.against : {};

    const totalPlayed=nonNegativeInteger(played?.total);
    const homePlayed=nonNegativeInteger(played?.home);
    const awayPlayed=nonNegativeInteger(played?.away);
    const totalWins=nonNegativeInteger(wins?.total);
    const totalDraws=nonNegativeInteger(draws?.total);
    const points=totalWins*3+totalDraws;
    const homePoints=nonNegativeInteger(wins?.home)*3+nonNegativeInteger(draws?.home);
    const awayPoints=nonNegativeInteger(wins?.away)*3+nonNegativeInteger(draws?.away);
    const gf=nonNegativeInteger(goalsFor?.total?.total);
    const ga=nonNegativeInteger(goalsAgainst?.total?.total);

    const clean=source?.clean_sheet && typeof source.clean_sheet === 'object' ? source.clean_sheet : {};
    const failed=source?.failed_to_score && typeof source.failed_to_score === 'object' ? source.failed_to_score : {};
    const biggest=source?.biggest && typeof source.biggest === 'object' ? source.biggest : {};
    const penalties=source?.penalty && typeof source.penalty === 'object' ? source.penalty : {};
    const lineups=rows(source?.lineups);
    const mostUsedLineup=[...lineups].sort(
      (a,b)=>nonNegativeInteger(b?.played)-nonNegativeInteger(a?.played),
    )[0] || null;

    const teamId=positiveSafeInteger(source?.team?.id) || positiveSafeInteger(fallback?.teamId) || 0;
    const leagueId=positiveSafeInteger(source?.league?.id) || positiveSafeInteger(fallback?.leagueId) || 0;
    const leagueSeason=positiveSafeInteger(source?.league?.season) || positiveSafeInteger(fallback?.season);

    return {
      available:Boolean(teamId),
      team:{
        id:teamId,
        name:safeText(source?.team?.name || fallback?.teamName,180),
        logo:safeText(source?.team?.logo || fallback?.teamLogo,500),
      },
      league:{
        id:leagueId,
        name:safeText(source?.league?.name || fallback?.leagueName,180),
        country:normalizeCountryName(source?.league?.country || fallback?.country || ''),
        logo:safeText(source?.league?.logo || fallback?.leagueLogo,500),
        season:leagueSeason || 0,
      },
      form:safeText(source?.form,80),
      fixtures:{
        played:{home:homePlayed,away:awayPlayed,total:totalPlayed},
        wins:{
          home:nonNegativeInteger(wins?.home),
          away:nonNegativeInteger(wins?.away),
          total:totalWins,
        },
        draws:{
          home:nonNegativeInteger(draws?.home),
          away:nonNegativeInteger(draws?.away),
          total:totalDraws,
        },
        losses:{
          home:nonNegativeInteger(loses?.home),
          away:nonNegativeInteger(loses?.away),
          total:nonNegativeInteger(loses?.total),
        },
      },
      goals:{
        for:{
          home:nonNegativeInteger(goalsFor?.total?.home),
          away:nonNegativeInteger(goalsFor?.total?.away),
          total:gf,
          average:teamStatsAvg(goalsFor?.average?.total),
        },
        against:{
          home:nonNegativeInteger(goalsAgainst?.total?.home),
          away:nonNegativeInteger(goalsAgainst?.total?.away),
          total:ga,
          average:teamStatsAvg(goalsAgainst?.average?.total),
        },
        difference:gf-ga,
      },
      cleanSheets:{
        home:nonNegativeInteger(clean?.home),
        away:nonNegativeInteger(clean?.away),
        total:nonNegativeInteger(clean?.total),
      },
      failedToScore:{
        home:nonNegativeInteger(failed?.home),
        away:nonNegativeInteger(failed?.away),
        total:nonNegativeInteger(failed?.total),
      },
      biggest:{
        winHome:safeText(biggest?.wins?.home,40),
        winAway:safeText(biggest?.wins?.away,40),
        lossHome:safeText(biggest?.loses?.home,40),
        lossAway:safeText(biggest?.loses?.away,40),
        goalsForHome:nonNegativeInteger(biggest?.goals?.for?.home),
        goalsForAway:nonNegativeInteger(biggest?.goals?.for?.away),
        goalsAgainstHome:nonNegativeInteger(biggest?.goals?.against?.home),
        goalsAgainstAway:nonNegativeInteger(biggest?.goals?.against?.away),
      },
      penalties:{
        scored:nonNegativeInteger(penalties?.scored?.total),
        missed:nonNegativeInteger(penalties?.missed?.total),
        total:nonNegativeInteger(penalties?.total),
      },
      mostUsedLineup:mostUsedLineup ? {
        formation:safeText(mostUsedLineup?.formation,40),
        played:nonNegativeInteger(mostUsedLineup?.played),
      } : null,
      derived:{
        points,
        ppg:totalPlayed ? Math.round((points/totalPlayed)*100)/100 : null,
        homePpg:homePlayed ? Math.round((homePoints/homePlayed)*100)/100 : null,
        awayPpg:awayPlayed ? Math.round((awayPoints/awayPlayed)*100)/100 : null,
        winRate:teamStatsRate(totalWins,totalPlayed),
        cleanSheetRate:teamStatsRate(clean?.total,totalPlayed),
        failedToScoreRate:teamStatsRate(failed?.total,totalPlayed),
        goalsForPerMatch:totalPlayed ? Math.round((gf/totalPlayed)*100)/100 : null,
        goalsAgainstPerMatch:totalPlayed ? Math.round((ga/totalPlayed)*100)/100 : null,
      },
    };
  }

  function playerStatNumber(value) {
    return finiteNumber(value, 0);
  }
  
  function playerStatNullable(value) {
    const cleaned=safeText(value,40).replaceAll('%','').trim();
    if (!cleaned) return null;
    const number=finiteNumber(cleaned,NaN);
    return Number.isFinite(number) ? Math.round(number*100)/100 : null;
  }

  function normalizeApiFootballTeamPlayers(providerRows = [], context = {}) {
    const teamId=positiveSafeInteger(context?.teamId);
    const leagueId=positiveSafeInteger(context?.leagueId);
    const season=positiveSafeInteger(context?.season);
    const seen=new Set();

    const players=rows(providerRows).map(row=>{
      const statistics=rows(row?.statistics);
      const scoped=Boolean(teamId || leagueId || season);
      const stats=statistics.find(stat=>
        (!teamId || positiveSafeInteger(stat?.team?.id)===teamId)
        && (!leagueId || positiveSafeInteger(stat?.league?.id)===leagueId)
        && (!season || positiveSafeInteger(stat?.league?.season)===season)
      ) || (!scoped ? statistics[0] : null);
      if (!stats) return null;

      const player=row?.player && typeof row.player === 'object' ? row.player : {};
      const providerId=positiveSafeInteger(player?.id);
      const name=safeText(
        player?.name || [player?.firstname,player?.lastname].filter(Boolean).join(' '),
        180,
      );
      if (!name) return null;

      return {
        id:providerId || 0,
        providerId,
        name,
        age:positiveSafeInteger(player?.age),
        nationality:safeText(player?.nationality,120),
        photo:safeText(player?.photo,500),
        injured:player?.injured === true,
        team:{
          id:positiveSafeInteger(stats?.team?.id) || teamId || 0,
          providerId:positiveSafeInteger(stats?.team?.id),
          name:safeText(stats?.team?.name || context?.teamName,180),
        },
        league:{
          id:positiveSafeInteger(stats?.league?.id) || leagueId || 0,
          name:safeText(stats?.league?.name || context?.leagueName,180),
          season:positiveSafeInteger(stats?.league?.season) || season,
        },
        games:{
          appearances:nonNegativeInteger(stats?.games?.appearences),
          lineups:nonNegativeInteger(stats?.games?.lineups),
          minutes:nonNegativeInteger(stats?.games?.minutes),
          rating:playerStatNullable(stats?.games?.rating),
          position:safeText(stats?.games?.position,80),
        },
        goals:{
          total:nonNegativeInteger(stats?.goals?.total),
          assists:nonNegativeInteger(stats?.goals?.assists),
          conceded:nonNegativeInteger(stats?.goals?.conceded),
          saves:nonNegativeInteger(stats?.goals?.saves),
          penalties:nonNegativeInteger(stats?.penalty?.scored),
        },
        shots:{
          total:nonNegativeInteger(stats?.shots?.total),
          on:nonNegativeInteger(stats?.shots?.on),
        },
        passes:{
          total:nonNegativeInteger(stats?.passes?.total),
          key:nonNegativeInteger(stats?.passes?.key),
          accuracy:playerStatNullable(stats?.passes?.accuracy),
        },
        tackles:{
          total:nonNegativeInteger(stats?.tackles?.total),
          blocks:nonNegativeInteger(stats?.tackles?.blocks),
          interceptions:nonNegativeInteger(stats?.tackles?.interceptions),
        },
        duels:{
          total:nonNegativeInteger(stats?.duels?.total),
          won:nonNegativeInteger(stats?.duels?.won),
        },
        dribbles:{
          attempts:nonNegativeInteger(stats?.dribbles?.attempts),
          success:nonNegativeInteger(stats?.dribbles?.success),
        },
        fouls:{
          drawn:nonNegativeInteger(stats?.fouls?.drawn),
          committed:nonNegativeInteger(stats?.fouls?.committed),
        },
        cards:{
          yellow:nonNegativeInteger(stats?.cards?.yellow),
          yellowRed:nonNegativeInteger(stats?.cards?.yellowred),
          red:nonNegativeInteger(stats?.cards?.red),
        },
        source:'api-football',
      };
    }).filter(player=>{
      if (!player?.name) return false;
      const key=player.providerId ? `id:${player.providerId}` : `name:${player.name.toLocaleLowerCase('ru')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    players.sort((a,b)=>
      b.goals.total-a.goals.total
      || b.goals.assists-a.goals.assists
      || b.games.appearances-a.games.appearances
      || b.games.minutes-a.games.minutes
      || a.name.localeCompare(b.name,'ru')
    );

    return players;
  }

  async function apiFootballTeamSeasonPlayers(teamId, leagueId, season, cfg, context = {}) {
    const normalizedTeamId=positiveSafeInteger(teamId);
    const normalizedLeagueId=positiveSafeInteger(leagueId);
    const normalizedSeason=positiveSafeInteger(season);
    if (!normalizedTeamId || !normalizedLeagueId || !normalizedSeason) {
      return {
        available:false,
        complete:false,
        partial:false,
        scope:'team-season',
        players:[],
        summary:{count:0,complete:false,pagesLoaded:0,pagesTotal:0,sourceScope:'team-season'},
        reason:'invalid_team_season_scope',
        sourceMeta:sourceMeta({
          provider:'api-football',
          label:'API-Football',
          freshness:'unavailable',
          fallback:false,
        }),
      };
    }

    const collected=[];
    let totalPages=1;
    let currentPage=0;
    let stopReason='';
    const maxPages=Math.min(3,positiveSafeInteger(context?.maxPages) || 3);

    for (let page=1;page<=maxPages;page+=1) {
      if (page>1) {
        let quotaOk=false;
        try { quotaOk=freeQuotaHealthy(8,1)===true; } catch { quotaOk=false; }
        if (!quotaOk) {
          stopReason='quota_guard';
          break;
        }
      }

      const envelope=await apiFootball('/players',{
        team:normalizedTeamId,
        league:normalizedLeagueId,
        season:normalizedSeason,
        page,
      },cfg,{responseType:'envelope'});
      const pageRows=rows(envelope?.response);
      collected.push(...pageRows);

      currentPage=Math.max(page,positiveSafeInteger(envelope?.paging?.current) || page);
      totalPages=Math.max(currentPage,positiveSafeInteger(envelope?.paging?.total) || currentPage);
      if (currentPage>=totalPages || !pageRows.length) break;
    }

    const players=normalizeApiFootballTeamPlayers(collected,{
      teamId:normalizedTeamId,
      leagueId:normalizedLeagueId,
      season:normalizedSeason,
      ...context,
    });
    const complete=currentPage>=totalPages;
    if (!complete && !stopReason && totalPages>maxPages) stopReason='page_cap';

    return {
      available:players.length>0,
      complete,
      partial:players.length>0 && !complete,
      scope:'team-season',
      players,
      summary:{
        count:players.length,
        complete,
        pagesLoaded:currentPage,
        pagesTotal:totalPages,
        sourceScope:'team-season',
      },
      reason:players.length ? (complete ? '' : stopReason || 'partial_pagination') : 'api_football_players_empty',
      sourceMeta:sourceMeta({
        provider:'api-football',
        label:'API-Football',
        freshness:'fresh',
        fallback:false,
      }),
    };
  }

  async function footballDataTeamScorersProvider(teamId, teamName, leagueId, leagueName, season, cfg) {
    const token=safeText(cfg?.footballDataToken,500);
    if (!token) return {available:false,reason:'token_not_configured',players:[],sourceMeta:null};

    const url=footballDataScorersUrl(leagueId,season,{limit:50});
    if (!url) return {available:false,reason:'competition_not_supported',players:[],sourceMeta:null};

    const budget=await claimSecondaryProviderBudget(cfg,'football-data',9);
    if (!budget.allowed) return {
      available:false,
      reason:budget.reason || 'secondary_rate_limit',
      players:[],
      sourceMeta:null,
    };

    try {
      const payload=await secondaryProviderJson(url,cfg,{
        provider:'football-data.org',
        operation:'scorers',
        timeoutMs:6500,
        headers:{'x-auth-token':token},
      });
      const normalized=normalizeFootballDataTeamScorers(
        payload,
        {teamId,teamName,leagueId,leagueName,season},
      ) || {};
      return {
        ...normalized,
        players:rows(normalized?.players),
        available:normalized?.available === true && rows(normalized?.players).length>0,
        sourceMeta:sourceMeta({
          ...(normalized?.sourceMeta || {}),
          provider:'football-data',
          label:'football-data.org',
          freshness:'fresh',
          fallback:true,
        }),
      };
    } catch (error) {
      await recordOpsEvent(cfg,{
        severity:'info',
        source:'provider',
        eventType:'fallback_provider_failure',
        code:'FOOTBALL_DATA_SCORERS',
        message:error?.message || error,
        meta:{
          teamId:integer(teamId),
          leagueId:integer(leagueId),
          season:integer(season),
        },
      }).catch(()=>null);
      return {
        available:false,
        reason:safeText(error?.code,120) || 'provider_error',
        players:[],
        sourceMeta:null,
      };
    }
  }

  async function resolveTeamSeasonPlayers(teamId, teamName, leagueId, leagueName, season, cfg, options = {}) {
    const attempts=[];
    try {
      const primary=await apiFootballTeamSeasonPlayers(
        teamId,
        leagueId,
        season,
        cfg,
        {...options,teamName,leagueName},
      );
      attempts.push({
        provider:'api-football',
        state:primary?.available ? 'available' : 'unavailable',
        reason:safeText(primary?.reason,160),
      });
      if (primary?.available) {
        primary.sourceMeta={...(primary.sourceMeta || {}),attempts};
        return primary;
      }
    } catch (error) {
      const compact=compactProviderError(error) || {};
      attempts.push({
        provider:'api-football',
        state:'error',
        reason:safeText(compact?.code || error?.code,120) || 'provider_error',
        status:positiveSafeInteger(compact?.status || error?.status),
      });
    }

    const fallback=await footballDataTeamScorersProvider(
      teamId,
      teamName,
      leagueId,
      leagueName,
      season,
      cfg,
    );
    attempts.push({
      provider:'football-data',
      state:fallback?.available ? 'available' : 'unavailable',
      reason:safeText(fallback?.reason,160),
    });
    if (fallback?.available) {
      fallback.sourceMeta={...(fallback.sourceMeta || {}),attempts};
      return fallback;
    }

    return {
      available:false,
      complete:false,
      partial:false,
      scope:'team-season',
      players:[],
      summary:{count:0,complete:false,pagesLoaded:0,pagesTotal:0,sourceScope:'team-season'},
      reason:'all_player_sources_unavailable',
      sourceMeta:sourceMeta({
        provider:'none',
        label:'Нет доступного источника',
        freshness:'unavailable',
        attempts,
      }),
    };
  }


  return Object.freeze({
    normalizeStandingRow,
    normalizeApiFootballStandings,
    claimSecondaryProviderBudget,
    openLigaStandingsProvider,
    openLigaEventFeatureMeta,
    secondaryOpenLigaEvents,
    footballDataStandingsProvider,
    oddsFallbackMeta,
    usableOddsFeatureMeta,
    secondaryOddsMarket,
    resolveTournamentStandings,
    apiTournament,
    normalizeTeamHubMatch,
    choosePrimaryTeamCompetition,
    cachedTeamStanding,
    apiTeam,
    teamStatsNum,
    teamStatsAvg,
    teamStatsRate,
    normalizeTeamSeasonStatistics,
    playerStatNumber,
    playerStatNullable,
    normalizeApiFootballTeamPlayers,
    apiFootballTeamSeasonPlayers,
    footballDataTeamScorersProvider,
    resolveTeamSeasonPlayers,
  });
}
