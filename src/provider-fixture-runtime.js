// Provider fixture/feed orchestration extracted from worker.js.
// Provider transport, cache, integrity and settlement capabilities are injected by the composition root.
export function createProviderFixtureRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Provider fixture runtime dependencies are required.');
  }
  const {
    apiFootball,
    bumpTelemetry,
    catalogRank,
    getCache,
    getStaleCache,
    isFinishedStatus,
    isFootballRateLimitError,
    isLiveStatus,
    isTopLeague,
    json,
    liveRefreshSeconds,
    markCachedSourceMeta,
    matchInterestScore,
    matchStatusRank,
    normalizeCompetition,
    normalizeRoundLabel,
    persistIntegrityRun,
    providerBudgetProfile,
    publicDataCapabilities,
    runMatchIntegrityGuard,
    scoreSnapshot,
    setCache,
    settlePredictionsFromFixtures,
    sourceMeta,
    statusLabel,
    todayUtc,
  } = deps;

  function providerFixtureDateCacheKey(date) {
    return `provider-fixtures:${String(date || '')}:v1`;
  }
  
  async function loadProviderFixturesForDate(date, cfg, { allowNetwork = true, forceRefresh = false } = {}) {
    const normalized=String(date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return [];
    const cacheKey=providerFixtureDateCacheKey(normalized);
    if (!forceRefresh) {
      const cached=await getCache(cacheKey,cfg).catch(()=>null);
      if (Array.isArray(cached?.fixtures)) {
        bumpTelemetry('providerFixtureDateReuses');
        return cached.fixtures;
      }
    }
    if (!allowNetwork) return [];
    const fixtures=await apiFootball('/fixtures',{date:normalized},cfg);
    const fetchedAt=new Date().toISOString();
    await setCache(cacheKey,0,{fixtures,fetchedAt},cfg,providerFeedDateTtl(normalized,cfg)).catch(()=>null);
    return fixtures;
  }
  
  function providerTeamDiscoveryCacheKey(teamId) {
    return `provider-team-discovery:${Number(teamId || 0)}:v1`;
  }
  
  async function loadProviderTeamDiscoveryFixtures(teamId, cfg, { allowNetwork = true, forceRefresh = false } = {}) {
    const id=Number(teamId || 0);
    if (!id) return [];
    const cacheKey=providerTeamDiscoveryCacheKey(id);
    if (!forceRefresh) {
      const cached=await getCache(cacheKey,cfg).catch(()=>null);
      if (Array.isArray(cached?.fixtures)) {
        bumpTelemetry('providerTeamFixtureReuses');
        return cached.fixtures;
      }
    }
    if (!allowNetwork) return [];
  
    const [upcomingRows,recentRows]=await Promise.all([
      apiFootball('/fixtures',{team:id,next:12},cfg),
      apiFootball('/fixtures',{team:id,last:8},cfg),
    ]);
    const seenFixtures=new Set();
    const fixtures=[...(upcomingRows || []),...(recentRows || [])].filter(fixture=>{
      const fixtureId=Number(fixture?.fixture?.id || 0);
      return fixtureId && !seenFixtures.has(fixtureId) && seenFixtures.add(fixtureId);
    });
    const hasLive=fixtures.some(fixture=>isLiveStatus(fixture?.fixture?.status?.short));
    const ttlMinutes=hasLive ? Math.max(1,Math.ceil(liveRefreshSeconds()/60)) : 120;
    await setCache(cacheKey,id,{fixtures,fetchedAt:new Date().toISOString()},cfg,ttlMinutes).catch(()=>null);
    return fixtures;
  }
  
  function providerFixtureDirectCacheKey(fixtureId) {
    return `provider-fixture:${Number(fixtureId || 0)}:v1`;
  }
  
  async function cachedProviderFixture(fixtureId,cfg) {
    const id=Number(fixtureId || 0);
    if (!id) return null;
    const direct=await getCache(providerFixtureDirectCacheKey(id),cfg).catch(()=>null);
    if (direct?.fixture && Number(direct.fixture?.fixture?.id || 0)===id) return direct.fixture;
  
    for (const offset of [-1,0,1]) {
      const date=new Date(Date.now()+offset*86400_000).toISOString().slice(0,10);
      const batch=await getCache(providerFixtureDateCacheKey(date),cfg).catch(()=>null);
      const fixture=(Array.isArray(batch?.fixtures) ? batch.fixtures : []).find(row=>Number(row?.fixture?.id || 0)===id);
      if (fixture) return fixture;
    }
    return null;
  }
  
  async function loadProviderFixture(fixtureId,cfg) {
    const id=Number(fixtureId || 0);
    if (!id) return null;
    const cached=await cachedProviderFixture(id,cfg);
    if (cached) return cached;
    const fixture=(await apiFootball('/fixtures',{id},cfg))[0] || null;
    if (!fixture) return null;
    const status=String(fixture.fixture?.status?.short || '');
    const ttlMinutes=isFinishedStatus(status) ? 720 : isLiveStatus(status) ? Math.max(1,liveRefreshSeconds()/60) : 5;
    await setCache(providerFixtureDirectCacheKey(id),id,{fixture,fetchedAt:new Date().toISOString()},cfg,ttlMinutes).catch(()=>null);
    return fixture;
  }
  
  function utcDateShift(date, offsetDays = 0) {
    const parsed = new Date(`${String(date || '')}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime())) return '';
    parsed.setUTCDate(parsed.getUTCDate() + Number(offsetDays || 0));
    return parsed.toISOString().slice(0, 10);
  }
  
  function providerFeedDateTtl(date, cfg) {
    const today = todayUtc();
    const yesterday = utcDateShift(today, -1);
    if (date === today) return 2;
    if (date === yesterday) return 720;
    return cfg.cacheMinutes;
  }
  
  async function apiMatches(request, cfg) {
    const url = new URL(request.url);
    const requested = url.searchParams.get('date') || '';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayUtc();
    const isToday = date === todayUtc();
    const yesterday = new Date(); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const isYesterday = date === yesterday.toISOString().slice(0, 10);
    const cacheKey = `matches:${date}:v6-integrity`;
  
    const cached = await getCache(cacheKey, cfg);
    if (cached?.matches) return json({ ...cached, sourceMeta: markCachedSourceMeta(cached.sourceMeta || sourceMeta({ provider:'api-football', label:'API-Football' })), cached: true, stale: false });
    const previousPayload = await getStaleCache(cacheKey, cfg).catch(() => null);
  
    let fixtures;
    const providerBatchKey=providerFixtureDateCacheKey(date);
    const providerBatch=await getCache(providerBatchKey,cfg).catch(()=>null);
    const staleProviderBatch=Array.isArray(providerBatch?.fixtures)
      ? null
      : await getStaleCache(providerBatchKey,cfg).catch(()=>null);
    let providerFallback=null;
    try {
      if (Array.isArray(providerBatch?.fixtures)) {
        fixtures=providerBatch.fixtures;
      } else {
        // API-Football accepts an all-competitions fixtures request by exact date.
        // Bare from/to ranges require an additional league/team constraint, so the
        // public feed goes through the shared exact-date loader and its cache.
        fixtures=await loadProviderFixturesForDate(date,cfg,{forceRefresh:true});
      }
    } catch (error) {
      const rateLimited=isFootballRateLimitError(error);
      const stale = previousPayload || await getStaleCache(cacheKey, cfg);
      if (stale?.matches && rateLimited) {
        return json({
          ...stale, cached: true, stale: true,
          warning: 'Показаны последние сохранённые данные: источник матчей временно ограничил обновления.',
          sourceMeta: markCachedSourceMeta(stale.sourceMeta || sourceMeta({ provider:'api-football', label:'API-Football' }), { stale:true }),
          retryAfter: Number(error?.retryAfter || 60),
        });
      }
      if (rateLimited && Array.isArray(staleProviderBatch?.fixtures)) {
        fixtures=staleProviderBatch.fixtures;
        providerFallback={
          retryAfter:Number(error?.retryAfter || 60),
          warning:'Показаны последние сохранённые данные: источник матчей временно ограничил обновления.',
        };
      } else {
        throw error;
      }
    }
  
    const integrityRun = runMatchIntegrityGuard(fixtures, date, previousPayload);
    await persistIntegrityRun(cfg, integrityRun.report, integrityRun.issues).catch(() => null);
    const verifiedFixtures = integrityRun.accepted;
  
    // Reuse the verified fixtures request we already made to settle tracked predictions at zero additional provider cost.
    await settlePredictionsFromFixtures(verifiedFixtures.map(x => x.fixture), cfg).catch(() => null);
  
    const matches = verifiedFixtures
      .filter(entry => !['CANC', 'PST', 'ABD', 'AWD', 'WO'].includes(entry.fixture?.fixture?.status?.short || ''))
      .map(entry => {
        const f = entry.fixture;
        const integrity = entry.integrity;
        const status = f.fixture?.status?.short || '';
        const elapsed = Number(f.fixture?.status?.elapsed ?? 0) || null;
        const leagueId = Number(f.league?.id || 0);
        const leagueName = f.league?.name || '';
        const country = f.league?.country || '';
        const homeName = f.teams?.home?.name || '';
        const awayName = f.teams?.away?.name || '';
        const competition = normalizeCompetition(leagueId, leagueName, country, homeName, awayName);
        const top = competition.featured || isTopLeague(leagueId, leagueName);
        const live = isLiveStatus(status);
        const finished = isFinishedStatus(status);
        const round = f.league?.round || '';
        const roundLabel = normalizeRoundLabel(round);
        return {
          fixtureId: f.fixture?.id,
          date: f.fixture?.date,
          status,
          statusLong: f.fixture?.status?.long || '',
          statusLabel: statusLabel(status, elapsed),
          elapsed,
          finished,
          live,
          score: scoreSnapshot(f),
          leagueId,
          season: Number(f.league?.season || 0) || null,
          league: competition.name,
          leagueOriginal: leagueName,
          leagueShort: competition.shortName,
          round,
          roundLabel,
          country: competition.country,
          countryRaw: country,
          leagueLogo: f.league?.logo || '',
          isTop: top,
          featured: Boolean(competition.featured),
          group: competition.group,
          category: competition.category,
          competition,
          youthReserve: competition.youth,
          lowPriority: competition.youth || competition.friendly || competition.lower,
          coverageTier: competition.youth || competition.lower ? 'basic' : competition.tier === 'elite' ? 'enhanced' : 'standard',
          interestScore: matchInterestScore({ competition, leagueId, leagueName, country, homeName, awayName, status, date: f.fixture?.date }),
          integrity,
          home: { id: f.teams?.home?.id, name: homeName, logo: f.teams?.home?.logo || '' },
          away: { id: f.teams?.away?.id, name: awayName, logo: f.teams?.away?.logo || '' },
        };
      })
      .sort((a, b) =>
        // Rank the capped provider feed by product relevance first. Status is only
        // a tiebreaker so arbitrary low-tier LIVE matches cannot consume the cap.
        catalogRank(a) - catalogRank(b) ||
        Number(b.competition?.priority || 0) - Number(a.competition?.priority || 0) ||
        Number(b.interestScore || 0) - Number(a.interestScore || 0) ||
        matchStatusRank(a.status) - matchStatusRank(b.status) ||
        String(a.date || '').localeCompare(String(b.date || ''))
      )
      .slice(0, 120);
  
    const catalog = {
      featured: matches.filter(x => x.featured).length,
      live: matches.filter(x => x.live).length,
      major: matches.filter(x => ['elite','major'].includes(x.competition?.tier)).length,
      cups: matches.filter(x => x.category === 'cup').length,
      international: matches.filter(x => ['continental','national','international'].includes(x.category)).length,
      hiddenLowPriority: matches.filter(x => x.lowPriority).length,
    };
    const refreshedAt=providerFallback
      ? (staleProviderBatch?.fetchedAt || previousPayload?.refreshedAt || new Date().toISOString())
      : new Date().toISOString();
    const primarySourceMeta=sourceMeta({ provider:'api-football', label:'API-Football' });
    const payload = {
      date,
      matches,
      catalog,
      integrity: integrityRun.report,
      refreshedAt,
      sourceMeta: providerFallback ? markCachedSourceMeta(primarySourceMeta, { stale:true }) : primarySourceMeta,
      provider: publicDataCapabilities(),
    };
    if (providerFallback) {
      return json({
        ...payload,
        cached:true,
        stale:true,
        warning:providerFallback.warning,
        retryAfter:providerFallback.retryAfter,
      });
    }
    const ttl = isToday ? (providerBudgetProfile().paid ? 1 : 3) : isYesterday ? 720 : cfg.cacheMinutes;
    await setCache(cacheKey, 0, payload, cfg, ttl);
    return json({ ...payload, cached: false, stale: false });
  }
  
  
  
  return {
    providerFixtureDateCacheKey,
    loadProviderFixturesForDate,
    providerTeamDiscoveryCacheKey,
    loadProviderTeamDiscoveryFixtures,
    providerFixtureDirectCacheKey,
    cachedProviderFixture,
    loadProviderFixture,
    utcDateShift,
    providerFeedDateTtl,
    apiMatches,
  };
}
