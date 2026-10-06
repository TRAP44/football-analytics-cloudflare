// Team, tournament and secondary-provider orchestration extracted from worker.js.
// Provider, cache and domain primitives are injected by the composition root.
export function createTeamTournamentRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Team tournament runtime dependencies are required.');
  }
  const {
    apiFootball,
    compactProviderError,
    createProviderRequestBoundary,
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
    providerFeaturePolicy,
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
  } = deps;

  function normalizeStandingRow(row = {}) {
    const all = row?.all || {};
    const goals = all?.goals || {};
    return {
      rank: Number(row?.rank || 0),
      team: {
        id: Number(row?.team?.id || 0),
        providerId: null,
        name: String(row?.team?.name || ''),
        logo: String(row?.team?.logo || ''),
      },
      points: Number(row?.points || 0),
      goalsDiff: Number(row?.goalsDiff || 0),
      played: Number(all?.played || 0),
      win: Number(all?.win || 0),
      draw: Number(all?.draw || 0),
      lose: Number(all?.lose || 0),
      goalsFor: Number(goals?.for || 0),
      goalsAgainst: Number(goals?.against || 0),
      form: String(row?.form || '').slice(-6),
      description: String(row?.description || ''),
    };
  }
  
  function normalizeApiFootballStandings(response = [], leagueId, season) {
    const league = response?.[0]?.league || {};
    const groups = Array.isArray(league?.standings) ? league.standings : [];
    const normalizedGroups = groups.map((rows, index) => ({
      name: groups.length > 1 ? `Группа ${index + 1}` : '',
      rows: (Array.isArray(rows) ? rows : []).map(normalizeStandingRow).filter(x => x.team.id),
    })).filter(group => group.rows.length);
    const standings = normalizedGroups.flatMap(group => group.rows);
    return {
      leagueId: Number(leagueId),
      season: Number(season),
      available: standings.length > 0,
      league: {
        id: Number(league?.id || leagueId),
        name: String(league?.name || ''),
        country: normalizeCountryName(league?.country || ''),
        logo: String(league?.logo || ''),
        flag: String(league?.flag || ''),
        season: Number(league?.season || season),
      },
      groups: normalizedGroups,
      standings,
      reason: standings.length ? '' : 'API-Football не вернул таблицу для этого турнира и сезона.',
      sourceMeta: sourceMeta({ provider:'api-football', label:'API-Football' }),
    };
  }
  
  async function claimSecondaryProviderBudget(cfg, provider, limit) {
    if (!hasSupabase(cfg)) return { allowed:false, reason:'shared_rate_guard_unavailable' };
    try {
      const result = await supaRpc(cfg, 'claim_provider_request', {
        p_bucket_key: `secondary:${String(provider || 'unknown')}:minute`,
        p_limit: Math.max(1, Number(limit || 1)),
        p_window_seconds: 60,
      });
      return {
        allowed: Boolean(result?.allowed),
        reason: String(result?.reason || ''),
        retryAfter: Number(result?.retryAfter || 0) || null,
      };
    } catch (error) {
      await recordOpsEvent(cfg, {
        severity:'warning', source:'provider', eventType:'secondary_rate_guard',
        code:'SECONDARY_RATE_GUARD_UNAVAILABLE', message:error?.message || error,
        meta:{ provider:String(provider || 'unknown') },
      }).catch(() => null);
      return { allowed:false, reason:'shared_rate_guard_unavailable' };
    }
  }
  
  const { providerRequestJson: secondaryProviderJson } = createProviderRequestBoundary({
    fetchWithTimeout,
    withSingleFlight,
    sleepMs,
    recordOpsEvent,
    bumpTelemetry,
    observeProviderRequest,
  });
  
  async function openLigaStandingsProvider(leagueId, season, cfg) {
    const competition = openLigaCompetition(leagueId, season);
    if (!competition) return { available:false, reason:'competition_not_supported' };
    const budget = await claimSecondaryProviderBudget(cfg, 'openligadb', 50);
    if (!budget.allowed) return { available:false, reason:budget.reason || 'secondary_rate_limit' };
  
    for (const candidate of openLigaTableUrls(leagueId, season)) {
      try {
        const rows = await secondaryProviderJson(candidate.url, cfg, { provider:'OpenLigaDB', operation:'standings', timeoutMs:6500 });
        const normalized = normalizeOpenLigaStandings(rows, {
          leagueId, season, label:competition.label,
        });
        if (normalized.available) return normalized;
      } catch (error) {
        await recordOpsEvent(cfg, {
          severity:'info', source:'provider', eventType:'fallback_provider_failure',
          code:'OPENLIGADB_STANDINGS', message:error?.message || error,
          meta:{ leagueId:Number(leagueId), season:Number(season), shortcut:candidate.shortcut },
        }).catch(() => null);
      }
    }
    return { available:false, reason:'openligadb_empty' };
  }
  
  function openLigaEventFeatureMeta(events, sourceMeta = {}, { source = 'network', fetchedAt = null, expiresAt = null, context = {} } = {}) {
    return {
      feature:'events',
      provider:'openligadb',
      source,
      fetchedAt,
      ageSeconds:fetchedAt && Number.isFinite(Date.parse(String(fetchedAt)))
        ? Math.max(0, Math.floor((Date.now() - Date.parse(String(fetchedAt))) / 1000))
        : null,
      expiresAt,
      policy:providerFeaturePolicy('events', context),
      fallback:true,
      attribution:String(sourceMeta?.attribution || 'OpenLigaDB · ODbL'),
      ...providerDataState(events, { attempted:true }),
    };
  }
  
  async function secondaryOpenLigaEvents(fixture, cfg, context = {}) {
    const fixtureId=Number(fixture?.fixture?.id || 0);
    const leagueId=Number(fixture?.league?.id || 0);
    const season=Number(fixture?.league?.season || 0);
    const homeName=String(fixture?.teams?.home?.name || '');
    const awayName=String(fixture?.teams?.away?.name || '');
    const urls=openLigaMatchDataUrls(leagueId, season, homeName);
    if (!fixtureId || !urls.length) return { available:false, reason:'competition_not_supported', events:[], meta:null };
  
    const cacheKey=`secondary-events:${fixtureId}:openligadb:v1`;
    const fresh=await getCacheEntry(cacheKey, cfg, false).catch(() => null);
    if (fresh?.payload?.events?.length) {
      return {
        available:true,
        events:fresh.payload.events,
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
      try {
        const rows=await secondaryProviderJson(candidate.url, cfg, { provider:'OpenLigaDB', operation:'match_events', timeoutMs:6500 });
        const normalized=normalizeOpenLigaMatchEvents(rows, {
          homeId:Number(fixture?.teams?.home?.id || 0),
          awayId:Number(fixture?.teams?.away?.id || 0),
          homeName,
          awayName,
          kickoffAt:fixture?.fixture?.date || '',
        });
        if (!normalized.available) continue;
        const fetchedAt=normalized.updatedAt && Number.isFinite(Date.parse(String(normalized.updatedAt)))
          ? String(normalized.updatedAt)
          : new Date().toISOString();
        const policy=providerFeaturePolicy('events', context);
        const ttlSeconds=Math.max(45, Number(policy.ttlSeconds || 60));
        await setCache(cacheKey, fixtureId, {
          events:normalized.events,
          sourceMeta:normalized.sourceMeta,
          fetchedAt,
        }, cfg, ttlSeconds / 60).catch(() => null);
        return {
          available:true,
          events:normalized.events,
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
          meta:{ fixtureId, leagueId, season, shortcut:candidate.shortcut },
        }).catch(() => null);
      }
    }
    return { available:false, reason:'openligadb_events_unavailable', events:[], meta:null };
  }
  
  async function footballDataStandingsProvider(leagueId, season, cfg) {
    const url = footballDataStandingsUrl(leagueId, season);
    if (!cfg.footballDataToken) return { available:false, reason:'token_not_configured' };
    if (!url) return { available:false, reason:'competition_not_supported' };
    const budget = await claimSecondaryProviderBudget(cfg, 'football-data', 9);
    if (!budget.allowed) return { available:false, reason:budget.reason || 'secondary_rate_limit' };
  
    const payload = await secondaryProviderJson(url, cfg, {
      provider:'football-data.org',
      operation:'standings',
      timeoutMs:6500,
      headers:{ 'x-auth-token':cfg.footballDataToken },
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
      const sourceUpdatedAt = Number.isFinite(Date.parse(String(market?.updatedAt || ''))) ? String(market.updatedAt) : (meta?.sourceUpdatedAt || null);
      return {
        ...meta,
        provider: String(market.provider || meta?.provider || 'api-football'),
        sourceUpdatedAt,
        state: 'available',
        available: true,
        observed: true,
        usable: true,
        degraded: false,
        reason: '',
        count: Number(market.sources || market.bookmakers || 1),
      };
    }
    if (meta?.degraded) return { ...meta, usable:false, fallbackReason:String(fallbackReason || '') };
    return {
      ...meta,
      state: 'empty_response',
      available: false,
      observed: Boolean(meta?.observed ?? true),
      usable: false,
      degraded: false,
      reason: String(meta?.reason || '1x2_market_missing'),
      count: 0,
      fallbackReason: String(fallbackReason || ''),
    };
  }
  
  async function secondaryOddsMarket(fixture, cfg, { mode = 'prematch' } = {}) {
    const fixtureId = Number(fixture?.fixture?.id || 0);
    const leagueId = Number(fixture?.league?.id || 0);
    const feature = mode === 'live' ? 'liveOdds' : 'odds';
    if (!cfg.theOddsApiKey) return { available:false, reason:'token_not_configured', market:null, meta:null };
  
    const baseUrl = theOddsApiUrl(leagueId);
    if (!baseUrl) return { available:false, reason:'competition_not_supported', market:null, meta:null };
  
    const cacheKey = `secondary-odds:${fixtureId}:the-odds-api:v1`;
    const fresh = await getCacheEntry(cacheKey, cfg, false).catch(() => null);
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
  
    const budget = await claimSecondaryProviderBudget(cfg, 'the-odds-api', 8);
    if (!budget.allowed) {
      return { available:false, reason:budget.reason || 'secondary_rate_limit', market:null, meta:null };
    }
  
    try {
      const url = new URL(baseUrl);
      url.searchParams.set('apiKey', cfg.theOddsApiKey);
      const rows = await secondaryProviderJson(url.toString(), cfg, {
        provider:'The Odds API',
        operation:'odds',
        timeoutMs:6500,
      });
      const market = normalizeTheOddsApiMarket(rows, {
        homeName:fixture?.teams?.home?.name || '',
        awayName:fixture?.teams?.away?.name || '',
        kickoffAt:fixture?.fixture?.date || '',
      });
      if (!market) return { available:false, reason:'fixture_not_matched', market:null, meta:null };
  
      const fetchedAt = new Date().toISOString();
      const kickoffMs = Date.parse(String(fixture?.fixture?.date || ''));
      const minutesToKickoff = Number.isFinite(kickoffMs) ? Math.round((kickoffMs - Date.now()) / 60000) : null;
      const ttlMinutes = mode === 'live' ? 1 : minutesToKickoff !== null && minutesToKickoff <= 120 ? 3 : 5;
      const expiresAt = new Date(Date.now() + ttlMinutes * 60000).toISOString();
      const payload = {
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
      await setCache(cacheKey, fixtureId, payload, cfg, ttlMinutes).catch(() => null);
      await recordOpsEvent(cfg, {
        severity:'info', source:'provider', eventType:'provider_fallback',
        code:'ODDS_FALLBACK_USED',
        message:'Для рынка 1X2 использован разрешённый резервный источник.',
        meta:{ fixtureId, leagueId, mode, provider:'the-odds-api' },
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
        meta:{ fixtureId, leagueId, mode },
      }).catch(() => null);
      return { available:false, reason:String(error?.code || 'provider_error'), market:null, meta:null };
    }
  }
  
  async function resolveTournamentStandings(leagueId, season, cfg, { skipPrimary = false } = {}) {
    const result = await resolveProviderChain({
      feature:'standings',
      providers:[
        {
          id:'api-football', label:'API-Football',
          enabled:!skipPrimary,
          skipReason:skipPrimary ? 'quota_reserve' : '',
          run:async () => normalizeApiFootballStandings(
            await apiFootball('/standings', { league:leagueId, season }, cfg),
            leagueId, season,
          ),
        },
        {
          id:'openligadb', label:'OpenLigaDB',
          enabled:Boolean(openLigaCompetition(leagueId, season)),
          skipReason:'competition_not_supported',
          run:async () => await openLigaStandingsProvider(leagueId, season, cfg),
        },
        {
          id:'football-data', label:'football-data.org',
          enabled:Boolean(cfg.footballDataToken && footballDataStandingsUrl(leagueId, season)),
          skipReason:cfg.footballDataToken ? 'competition_not_supported' : 'token_not_configured',
          run:async () => await footballDataStandingsProvider(leagueId, season, cfg),
        },
      ],
      accept:value => Boolean(value?.available && value?.standings?.length),
    });
  
    if (result.available && result.sourceMeta?.fallback) {
      await recordOpsEvent(cfg, {
        severity:'info', source:'provider', eventType:'provider_fallback',
        code:'STANDINGS_FALLBACK_USED', message:'Для турнирной таблицы использован разрешённый резервный источник.',
        meta:{ leagueId:Number(leagueId), season:Number(season), provider:result.sourceMeta.provider },
      }).catch(() => null);
    }
    return result;
  }
  
  async function apiTournament(request, cfg) {
    const url = new URL(request.url);
    const leagueId = Number(url.searchParams.get('leagueId'));
    const season = Number(url.searchParams.get('season'));
    if (!Number.isFinite(leagueId) || leagueId <= 0) return json({ error: 'Номер турнира обязателен.' }, 400);
    if (!Number.isFinite(season) || season < 2000 || season > 2100) return json({ error: 'Сезон обязателен.' }, 400);
  
    const cacheKey = `tournament:${leagueId}:${season}:standings:v1`;
    const cached = await getCache(cacheKey, cfg);
    if (cached) return json({
      ...cached,
      sourceMeta:markCachedSourceMeta(cached.sourceMeta || sourceMeta({provider:'api-football',label:'API-Football'})),
      cached:true, stale:false, provider:publicDataCapabilities(),
    });
  
    const minuteRemaining = Number(memory.provider?.minuteRemaining);
    const skipPrimary = Number.isFinite(minuteRemaining) && minuteRemaining <= 1;
    const resolved = await resolveTournamentStandings(leagueId, season, cfg, { skipPrimary });
  
    if (resolved.available) {
      const payload = {
        ...resolved,
        refreshedAt:new Date().toISOString(),
      };
      const ttlMinutes = resolved.sourceMeta?.provider === 'api-football' ? 360 : 30;
      await setCache(cacheKey, 0, payload, cfg, ttlMinutes);
      return json({ ...payload, cached:false, stale:false, provider:publicDataCapabilities() });
    }
  
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale) return json({
      ...stale,
      sourceMeta:markCachedSourceMeta(stale.sourceMeta || sourceMeta({provider:'api-football',label:'API-Football'}),{stale:true}),
      cached:true,
      stale:true,
      warning:skipPrimary
        ? 'Показана последняя сохранённая таблица: основной источник находится в защитном резерве квоты.'
        : 'Не удалось обновить таблицу ни из основного, ни из разрешённых резервных источников.',
      provider:publicDataCapabilities(),
    });
  
    return json({
      leagueId, season, standings:[], groups:[], available:false,
      reason:skipPrimary
        ? 'Основной источник находится в защитном резерве квоты, а подходящий резервный источник не вернул таблицу.'
        : 'Таблица временно недоступна во всех настроенных источниках.',
      sourceMeta:resolved.sourceMeta,
      provider:publicDataCapabilities(),
    });
  }
  
  
  function normalizeTeamHubMatch(f, teamId) {
    const homeId = Number(f.teams?.home?.id || 0);
    const awayId = Number(f.teams?.away?.id || 0);
    const isHome = homeId === Number(teamId);
    const opponent = isHome ? f.teams?.away : f.teams?.home;
    const status = String(f.fixture?.status?.short || '');
    const elapsed = Number(f.fixture?.status?.elapsed ?? 0) || null;
    const competition = normalizeCompetition(Number(f.league?.id || 0), f.league?.name || '', f.league?.country || '', f.teams?.home?.name || '', f.teams?.away?.name || '');
    const result = isFinishedStatus(status) ? teamResult(f, teamId) : null;
    return {
      fixtureId: Number(f.fixture?.id || 0), date: f.fixture?.date || '', status,
      statusLong: f.fixture?.status?.long || '', statusLabel: statusLabel(status, elapsed), elapsed,
      live: isLiveStatus(status), finished: isFinishedStatus(status), score: scoreSnapshot(f),
      venue: isHome ? 'home' : 'away', result: result?.result || '', goalsFor: result?.gf ?? null, goalsAgainst: result?.ga ?? null,
      opponent: { id: Number(opponent?.id || 0), name: String(opponent?.name || ''), logo: String(opponent?.logo || '') },
      home: { id: homeId, name: f.teams?.home?.name || '', logo: f.teams?.home?.logo || '' },
      away: { id: awayId, name: f.teams?.away?.name || '', logo: f.teams?.away?.logo || '' },
      leagueId: Number(f.league?.id || 0), season: Number(f.league?.season || 0) || null,
      league: competition.name, leagueShort: competition.shortName, leagueLogo: f.league?.logo || '', country: competition.country,
      round: f.league?.round || '', roundLabel: normalizeRoundLabel(f.league?.round || ''), competition,
    };
  }
  
  function choosePrimaryTeamCompetition(matches = []) {
    const byLeague = new Map();
    for (const m of matches) {
      const id = Number(m.leagueId || 0);
      if (!id || m.competition?.youth || m.competition?.friendly) continue;
      const cur = byLeague.get(id) || { count: 0, item: m, priority: Number(m.competition?.priority || 0) };
      cur.count += 1;
      if (Number(m.competition?.priority || 0) > cur.priority) { cur.priority = Number(m.competition?.priority || 0); cur.item = m; }
      byLeague.set(id, cur);
    }
    const best = [...byLeague.values()].sort((a,b) => (b.count*10+b.priority) - (a.count*10+a.priority))[0];
    if (!best?.item) return null;
    const m = best.item;
    return { leagueId:Number(m.leagueId), season:Number(m.season || new Date().getFullYear()), name:m.league||'Турнир', shortName:m.leagueShort||m.league||'Турнир', logo:m.leagueLogo||'', country:m.country||'', category:m.competition?.category||'', tier:m.competition?.tier||'standard', priority:Number(m.competition?.priority||0) };
  }
  
  async function cachedTeamStanding(teamId, competition, cfg) {
    if (!competition?.leagueId || !competition?.season) return null;
    const cached = await getCache(`tournament:${Number(competition.leagueId)}:${Number(competition.season)}:standings:v1`, cfg);
    const row = cached?.standings?.find?.(x => Number(x.team?.id) === Number(teamId));
    if (!row) return null;
    return { rank:Number(row.rank||0), points:Number(row.points||0), played:Number(row.played||0), win:Number(row.win||0), draw:Number(row.draw||0), lose:Number(row.lose||0), goalsFor:Number(row.goalsFor||0), goalsAgainst:Number(row.goalsAgainst||0), goalsDiff:Number(row.goalsDiff||0), form:String(row.form||'') };
  }
  
  async function apiTeam(request, cfg) {
    const url = new URL(request.url);
    const teamId = Number(url.searchParams.get('teamId'));
    if (!Number.isFinite(teamId) || teamId <= 0) return json({ error: 'Номер команды обязателен.' }, 400);
    const {from,to}=teamDiscoveryWindow();
    const cacheKey = `teamhub:${teamId}:${from}:${to}:v2`;
    const cached = await getCache(cacheKey, cfg);
    if (cached) return json({ ...cached, standing: await cachedTeamStanding(teamId, cached.primaryCompetition, cfg), sourceMeta: markCachedSourceMeta(cached.sourceMeta || sourceMeta({ provider:'api-football', label:'API-Football' })), cached:true, stale:false, provider:publicDataCapabilities() });
    let fixtures;
    try {
      fixtures=await loadProviderTeamDiscoveryFixtures(teamId,cfg);
    }
    catch (error) {
      const stale = await getStaleCache(cacheKey, cfg);
      if (stale && isFootballRateLimitError(error)) return json({ ...stale, standing:await cachedTeamStanding(teamId, stale.primaryCompetition, cfg), sourceMeta:markCachedSourceMeta(stale.sourceMeta || sourceMeta({ provider:'api-football', label:'API-Football' }),{stale:true}), cached:true, stale:true, warning:'Страница команды показана из последних сохранённых данных из-за лимита источника данных.', provider:publicDataCapabilities() });
      throw error;
    }
    const usable = (fixtures||[]).filter(f => !['CANC','PST','ABD','AWD','WO'].includes(String(f.fixture?.status?.short||'')));
    const normalized = usable.map(f => normalizeTeamHubMatch(f, teamId)).filter(x => x.fixtureId);
    const discovery=splitTeamDiscoveryMatches(normalized,'',{upcomingLimit:8,recentLimit:8});
    const recent=discovery.recent;
    const upcoming=discovery.upcoming;
    let rawTeam = null;
    for (const f of usable) {
      if (Number(f.teams?.home?.id)===teamId) { rawTeam=f.teams.home; break; }
      if (Number(f.teams?.away?.id)===teamId) { rawTeam=f.teams.away; break; }
    }
    const team = { id:teamId, name:String(rawTeam?.name || url.searchParams.get('name') || `Команда ${teamId}`), logo:String(rawTeam?.logo || url.searchParams.get('logo') || '') };
    const completedRaw = usable.filter(f => isFinishedStatus(f.fixture?.status?.short));
    const form = summarizeFormRows(completedRaw, teamId, 'home')?.overall || null;
    const primaryCompetition = choosePrimaryTeamCompetition(normalized);
    const standing = await cachedTeamStanding(teamId, primaryCompetition, cfg);
    const payload = { team, primaryCompetition, standing, form, recent, upcoming, primaryFixtureId:Number(discovery.primary?.fixtureId || 0) || null, discovery:{mode:discovery.mode,primaryFixtureId:Number(discovery.primary?.fixtureId || 0) || null,primaryReason:String(discovery.primary?.selection?.reason || ''),windowPastDays:TEAM_DISCOVERY_PAST_DAYS,windowFutureDays:TEAM_DISCOVERY_FUTURE_DAYS}, liveNow:upcoming.find(x=>x.live)||null, nextMatch:upcoming.find(x=>!x.live)||upcoming[0]||null, refreshedAt:new Date().toISOString(), sourceMeta:sourceMeta({provider:'api-football',label:'API-Football'}) };
    await setCache(cacheKey, teamId, payload, cfg, 120);
    return json({ ...payload, cached:false, stale:false, provider:publicDataCapabilities() });
  }
  
  
  function teamStatsNum(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  
  function teamStatsAvg(value) {
    const n = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  
  function teamStatsRate(part, total) {
    const p = teamStatsNum(part), t = teamStatsNum(total);
    return t > 0 ? Math.round((p / t) * 1000) / 10 : null;
  }
  
  function normalizeTeamSeasonStatistics(row, fallback = {}) {
    const fixtures = row?.fixtures || {};
    const played = fixtures.played || {};
    const wins = fixtures.wins || {};
    const draws = fixtures.draws || {};
    const loses = fixtures.loses || {};
    const goalsFor = row?.goals?.for || {};
    const goalsAgainst = row?.goals?.against || {};
    const totalPlayed = teamStatsNum(played.total);
    const points = teamStatsNum(wins.total) * 3 + teamStatsNum(draws.total);
    const homePlayed = teamStatsNum(played.home), awayPlayed = teamStatsNum(played.away);
    const homePoints = teamStatsNum(wins.home) * 3 + teamStatsNum(draws.home);
    const awayPoints = teamStatsNum(wins.away) * 3 + teamStatsNum(draws.away);
    const gf = teamStatsNum(goalsFor?.total?.total), ga = teamStatsNum(goalsAgainst?.total?.total);
    const clean = row?.clean_sheet || {}, failed = row?.failed_to_score || {};
    const biggest = row?.biggest || {};
    const penalties = row?.penalty || {};
    const lineups = Array.isArray(row?.lineups) ? row.lineups : [];
    const mostUsedLineup = [...lineups].sort((a,b) => teamStatsNum(b?.played) - teamStatsNum(a?.played))[0] || null;
    return {
      available: Boolean(row && (row.team?.id || fallback.teamId)),
      team: {
        id: Number(row?.team?.id || fallback.teamId || 0),
        name: String(row?.team?.name || fallback.teamName || ''),
        logo: String(row?.team?.logo || fallback.teamLogo || ''),
      },
      league: {
        id: Number(row?.league?.id || fallback.leagueId || 0),
        name: String(row?.league?.name || fallback.leagueName || ''),
        country: normalizeCountryName(row?.league?.country || fallback.country || ''),
        logo: String(row?.league?.logo || fallback.leagueLogo || ''),
        season: Number(row?.league?.season || fallback.season || 0),
      },
      form: String(row?.form || ''),
      fixtures: {
        played: { home: homePlayed, away: awayPlayed, total: totalPlayed },
        wins: { home: teamStatsNum(wins.home), away: teamStatsNum(wins.away), total: teamStatsNum(wins.total) },
        draws: { home: teamStatsNum(draws.home), away: teamStatsNum(draws.away), total: teamStatsNum(draws.total) },
        losses: { home: teamStatsNum(loses.home), away: teamStatsNum(loses.away), total: teamStatsNum(loses.total) },
      },
      goals: {
        for: { home: teamStatsNum(goalsFor?.total?.home), away: teamStatsNum(goalsFor?.total?.away), total: gf, average: teamStatsAvg(goalsFor?.average?.total) },
        against: { home: teamStatsNum(goalsAgainst?.total?.home), away: teamStatsNum(goalsAgainst?.total?.away), total: ga, average: teamStatsAvg(goalsAgainst?.average?.total) },
        difference: gf - ga,
      },
      cleanSheets: { home: teamStatsNum(clean.home), away: teamStatsNum(clean.away), total: teamStatsNum(clean.total) },
      failedToScore: { home: teamStatsNum(failed.home), away: teamStatsNum(failed.away), total: teamStatsNum(failed.total) },
      biggest: {
        winHome: String(biggest?.wins?.home || ''), winAway: String(biggest?.wins?.away || ''),
        lossHome: String(biggest?.loses?.home || ''), lossAway: String(biggest?.loses?.away || ''),
        goalsForHome: teamStatsNum(biggest?.goals?.for?.home), goalsForAway: teamStatsNum(biggest?.goals?.for?.away),
        goalsAgainstHome: teamStatsNum(biggest?.goals?.against?.home), goalsAgainstAway: teamStatsNum(biggest?.goals?.against?.away),
      },
      penalties: {
        scored: teamStatsNum(penalties?.scored?.total), missed: teamStatsNum(penalties?.missed?.total), total: teamStatsNum(penalties?.total),
      },
      mostUsedLineup: mostUsedLineup ? { formation: String(mostUsedLineup.formation || ''), played: teamStatsNum(mostUsedLineup.played) } : null,
      derived: {
        points,
        ppg: totalPlayed ? Math.round((points / totalPlayed) * 100) / 100 : null,
        homePpg: homePlayed ? Math.round((homePoints / homePlayed) * 100) / 100 : null,
        awayPpg: awayPlayed ? Math.round((awayPoints / awayPlayed) * 100) / 100 : null,
        winRate: teamStatsRate(wins.total, totalPlayed),
        cleanSheetRate: teamStatsRate(clean.total, totalPlayed),
        failedToScoreRate: teamStatsRate(failed.total, totalPlayed),
        goalsForPerMatch: totalPlayed ? Math.round((gf / totalPlayed) * 100) / 100 : null,
        goalsAgainstPerMatch: totalPlayed ? Math.round((ga / totalPlayed) * 100) / 100 : null,
      },
    };
  }
  
  function playerStatNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  
  function playerStatNullable(value) {
    const cleaned = String(value ?? '').replaceAll('%', '').trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  
  function normalizeApiFootballTeamPlayers(rows = [], context = {}) {
    const teamId=Number(context.teamId || 0);
    const leagueId=Number(context.leagueId || 0);
    const season=Number(context.season || 0);
    const players=(Array.isArray(rows) ? rows : []).map(row => {
      const stats=(Array.isArray(row?.statistics) ? row.statistics : []).find(s =>
        (!teamId || Number(s?.team?.id || 0)===teamId)
        && (!leagueId || Number(s?.league?.id || 0)===leagueId)
      ) || (Array.isArray(row?.statistics) ? row.statistics[0] : null);
      if (!stats) return null;
      const p=row?.player || {};
      return {
        id:Number(p.id || 0),
        providerId:Number(p.id || 0) || null,
        name:String(p.name || [p.firstname,p.lastname].filter(Boolean).join(' ') || ''),
        age:Number(p.age || 0) || null,
        nationality:String(p.nationality || ''),
        photo:String(p.photo || ''),
        injured:Boolean(p.injured),
        team:{
          id:Number(stats?.team?.id || teamId || 0),
          providerId:Number(stats?.team?.id || 0) || null,
          name:String(stats?.team?.name || context.teamName || ''),
        },
        league:{
          id:Number(stats?.league?.id || leagueId || 0),
          name:String(stats?.league?.name || context.leagueName || ''),
          season:Number(stats?.league?.season || season || 0) || null,
        },
        games:{
          appearances:playerStatNumber(stats?.games?.appearences),
          lineups:playerStatNumber(stats?.games?.lineups),
          minutes:playerStatNumber(stats?.games?.minutes),
          rating:playerStatNullable(stats?.games?.rating),
          position:String(stats?.games?.position || ''),
        },
        goals:{
          total:playerStatNumber(stats?.goals?.total),
          assists:playerStatNumber(stats?.goals?.assists),
          conceded:playerStatNumber(stats?.goals?.conceded),
          saves:playerStatNumber(stats?.goals?.saves),
          penalties:playerStatNumber(stats?.penalty?.scored),
        },
        shots:{
          total:playerStatNumber(stats?.shots?.total),
          on:playerStatNumber(stats?.shots?.on),
        },
        passes:{
          total:playerStatNumber(stats?.passes?.total),
          key:playerStatNumber(stats?.passes?.key),
          accuracy:playerStatNullable(stats?.passes?.accuracy),
        },
        tackles:{
          total:playerStatNumber(stats?.tackles?.total),
          blocks:playerStatNumber(stats?.tackles?.blocks),
          interceptions:playerStatNumber(stats?.tackles?.interceptions),
        },
        duels:{
          total:playerStatNumber(stats?.duels?.total),
          won:playerStatNumber(stats?.duels?.won),
        },
        dribbles:{
          attempts:playerStatNumber(stats?.dribbles?.attempts),
          success:playerStatNumber(stats?.dribbles?.success),
        },
        fouls:{
          drawn:playerStatNumber(stats?.fouls?.drawn),
          committed:playerStatNumber(stats?.fouls?.committed),
        },
        cards:{
          yellow:playerStatNumber(stats?.cards?.yellow),
          yellowRed:playerStatNumber(stats?.cards?.yellowred),
          red:playerStatNumber(stats?.cards?.red),
        },
        source:'api-football',
      };
    }).filter(row => row?.name);
  
    players.sort((a,b) =>
      Number(b.goals.total || 0) - Number(a.goals.total || 0)
      || Number(b.goals.assists || 0) - Number(a.goals.assists || 0)
      || Number(b.games.appearances || 0) - Number(a.games.appearances || 0)
      || Number(b.games.minutes || 0) - Number(a.games.minutes || 0)
      || a.name.localeCompare(b.name)
    );
  
    return players;
  }
  
  async function apiFootballTeamSeasonPlayers(teamId, leagueId, season, cfg, context = {}) {
    const rows=[];
    let totalPages=1;
    let currentPage=0;
    let stopReason='';
    const maxPages=Math.max(1,Math.min(3,Number(context.maxPages || 3)));
  
    for (let page=1; page<=maxPages; page+=1) {
      if (page>1 && !freeQuotaHealthy(8,1)) {
        stopReason='quota_guard';
        break;
      }
      const envelope=await apiFootball('/players', { team:teamId, league:leagueId, season, page }, cfg, { responseType:'envelope' });
      const pageRows=Array.isArray(envelope?.response) ? envelope.response : [];
      rows.push(...pageRows);
      currentPage=Math.max(page, Number(envelope?.paging?.current || page));
      totalPages=Math.max(currentPage, Number(envelope?.paging?.total || currentPage));
      if (currentPage>=totalPages || !pageRows.length) break;
    }
  
    const players=normalizeApiFootballTeamPlayers(rows, { teamId, leagueId, season, ...context });
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
    if (!cfg.footballDataToken) return { available:false, reason:'token_not_configured', players:[], sourceMeta:null };
    const url=footballDataScorersUrl(leagueId, season, { limit:50 });
    if (!url) return { available:false, reason:'competition_not_supported', players:[], sourceMeta:null };
    const budget=await claimSecondaryProviderBudget(cfg, 'football-data', 9);
    if (!budget.allowed) return { available:false, reason:budget.reason || 'secondary_rate_limit', players:[], sourceMeta:null };
    try {
      const payload=await secondaryProviderJson(url, cfg, {
        provider:'football-data.org',
        operation:'scorers',
        timeoutMs:6500,
        headers:{ 'x-auth-token':cfg.footballDataToken },
      });
      const normalized=normalizeFootballDataTeamScorers(payload, { teamId, teamName, leagueId, leagueName, season });
      return {
        ...normalized,
        sourceMeta:sourceMeta({
          ...(normalized.sourceMeta || {}),
          provider:'football-data',
          label:'football-data.org',
          freshness:'fresh',
          fallback:true,
        }),
      };
    } catch (error) {
      await recordOpsEvent(cfg, {
        severity:'info', source:'provider', eventType:'fallback_provider_failure',
        code:'FOOTBALL_DATA_SCORERS', message:error?.message || error,
        meta:{ teamId:Number(teamId), leagueId:Number(leagueId), season:Number(season) },
      }).catch(() => null);
      return { available:false, reason:String(error?.code || 'provider_error'), players:[], sourceMeta:null };
    }
  }
  
  async function resolveTeamSeasonPlayers(teamId, teamName, leagueId, leagueName, season, cfg, options = {}) {
    const attempts=[];
    try {
      const primary=await apiFootballTeamSeasonPlayers(teamId, leagueId, season, cfg, { ...options, teamName, leagueName });
      attempts.push({provider:'api-football',state:primary.available?'available':'unavailable',reason:String(primary.reason || '')});
      if (primary.available) {
        primary.sourceMeta={...(primary.sourceMeta || {}),attempts};
        return primary;
      }
    } catch (error) {
      const compact=compactProviderError(error);
      attempts.push({provider:'api-football',state:'error',reason:compact.code,status:compact.status});
    }
  
    const fallback=await footballDataTeamScorersProvider(teamId, teamName, leagueId, leagueName, season, cfg);
    attempts.push({provider:'football-data',state:fallback.available?'available':'unavailable',reason:String(fallback.reason || '')});
    if (fallback.available) {
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
  
  
  return {
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
  };
}
