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
    isRetryableFootballTransportError,
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

  const requiredFunctions={
    apiFootball,
    bumpTelemetry,
    catalogRank,
    getCache,
    getStaleCache,
    isFinishedStatus,
    isFootballRateLimitError,
    isRetryableFootballTransportError,
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
  };
  for (const [name,fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

  function integerCandidate(value) {
    if (typeof value==='number') {
      return Number.isSafeInteger(value) ? value : null;
    }
    if (typeof value!=='string') return null;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  }

  function positiveSafeInteger(value) {
    const number=integerCandidate(value);
    return number!==null && number>0 ? number : null;
  }

  function nonNegativeSafeInteger(value) {
    const number=integerCandidate(value);
    return number!==null && number>=0 ? number : null;
  }

  function strictUtcDate(value) {
    if (typeof value !== 'string') return '';
    const raw=value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
    const timestamp=Date.parse(`${raw}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp)) return '';
    try {
      return new Date(timestamp).toISOString().slice(0,10) === raw ? raw : '';
    } catch {
      return '';
    }
  }

  function providerRows(value, label = 'fixtures') {
    if (Array.isArray(value)) return value;
    const error=new Error(`API-Football returned an invalid ${label} payload.`);
    error.code='FOOTBALL_INVALID_RESPONSE';
    throw error;
  }

  function recoverableProviderError(error) {
    return isFootballRateLimitError(error)
      || isRetryableFootballTransportError(error)
      || String(error?.code || '') === 'FOOTBALL_INVALID_RESPONSE';
  }

  function boundedRetryAfter(value, fallback = 60) {
    const number=Number(value);
    const safeFallback=Number.isFinite(Number(fallback)) && Number(fallback)>0
      ? Math.min(86400,Math.max(1,Math.ceil(Number(fallback))))
      : 60;
    return Number.isFinite(number) && number>0
      ? Math.min(86400,Math.max(1,Math.ceil(number)))
      : safeFallback;
  }

  function cacheMinutes(value, fallback = 10) {
    const number=Number(value);
    const safeFallback=Number.isFinite(Number(fallback)) && Number(fallback)>0
      ? Math.min(1440,Math.max(1/6,Number(fallback)))
      : 10;
    return Number.isFinite(number) && number>0
      ? Math.min(1440,Math.max(1/6,number))
      : safeFallback;
  }

  function fixtureDateCachePayload(value, date) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.date && String(value.date) !== date) return null;
    if (!Array.isArray(value.fixtures)) return null;
    return value;
  }

  function teamDiscoveryCachePayload(value, teamId) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (positiveSafeInteger(value.teamId)!==teamId) return null;
    if (!Array.isArray(value.fixtures)) return null;
    const seen=new Set();
    const fixtures=value.fixtures.filter(row=>{
      const fixtureId=positiveSafeInteger(row?.fixture?.id);
      const homeId=positiveSafeInteger(row?.teams?.home?.id);
      const awayId=positiveSafeInteger(row?.teams?.away?.id);
      if (!fixtureId || (homeId!==teamId && awayId!==teamId) || seen.has(fixtureId)) return false;
      seen.add(fixtureId);
      return true;
    });
    return {...value,fixtures};
  }

  function directFixtureCachePayload(value, fixtureId) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.fixtureId !== undefined && value.fixtureId !== null && positiveSafeInteger(value.fixtureId) !== fixtureId) return null;
    if (positiveSafeInteger(value.fixture?.fixture?.id) !== fixtureId) return null;
    return value;
  }

  function matchFeedCachePayload(value, date) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (String(value.date || '') !== date || !Array.isArray(value.matches)) return null;
    return value;
  }

  function providerFixtureDateCacheKey(date) {
    const normalized=strictUtcDate(date);
    return normalized ? `provider-fixtures:${normalized}:v1` : '';
  }
  
  async function loadProviderFixturesForDate(date, cfg, { allowNetwork = true, forceRefresh = false } = {}) {
    const normalized=strictUtcDate(date);
    if (!normalized) return [];
    const cacheKey=providerFixtureDateCacheKey(normalized);
    if (!forceRefresh) {
      const cached=fixtureDateCachePayload(await getCache(cacheKey,cfg).catch(()=>null),normalized);
      if (cached) {
        bumpTelemetry('providerFixtureDateReuses');
        return cached.fixtures;
      }
    }
    if (!allowNetwork) return [];
    const fixtures=providerRows(await apiFootball('/fixtures',{date:normalized},cfg),'fixtures-by-date');
    const fetchedAt=new Date().toISOString();
    await setCache(
      cacheKey,
      0,
      {date:normalized,fixtures,fetchedAt},
      cfg,
      providerFeedDateTtl(normalized,cfg),
    ).catch(()=>null);
    return fixtures;
  }
  
  function providerTeamDiscoveryCacheKey(teamId) {
    const id=positiveSafeInteger(teamId);
    return id ? `provider-team-discovery:${id}:v1` : '';
  }
  
  async function loadProviderTeamDiscoveryFixtures(teamId, cfg, { allowNetwork = true, forceRefresh = false } = {}) {
    const id=positiveSafeInteger(teamId);
    if (!id) return [];
    const cacheKey=providerTeamDiscoveryCacheKey(id);
    if (!forceRefresh) {
      const cached=teamDiscoveryCachePayload(await getCache(cacheKey,cfg).catch(()=>null),id);
      if (cached) {
        bumpTelemetry('providerTeamFixtureReuses');
        return cached.fixtures;
      }
    }
    if (!allowNetwork) return [];
  
    const results=await Promise.allSettled([
      apiFootball('/fixtures',{team:id,next:12},cfg),
      apiFootball('/fixtures',{team:id,last:8},cfg),
    ]);
    const errors=[];
    const rows=results.map((result,index)=>{
      if (result.status === 'rejected') {
        errors.push(result.reason);
        return [];
      }
      try {
        return providerRows(result.value,index===0 ? 'team-upcoming-fixtures' : 'team-recent-fixtures');
      } catch (error) {
        errors.push(error);
        return [];
      }
    });
    if (errors.length===2) throw errors[0];
    const [upcomingRows,recentRows]=rows;
    const seenFixtures=new Set();
    const fixtures=[...upcomingRows,...recentRows].filter(fixture=>{
      const fixtureId=positiveSafeInteger(fixture?.fixture?.id);
      const homeId=positiveSafeInteger(fixture?.teams?.home?.id);
      const awayId=positiveSafeInteger(fixture?.teams?.away?.id);
      if (
        !fixtureId
        || (homeId!==id && awayId!==id)
        || seenFixtures.has(fixtureId)
      ) return false;
      seenFixtures.add(fixtureId);
      return true;
    });
    const partial=errors.length>0;
    if (partial) bumpTelemetry('providerTeamFixturePartial');
    const hasLive=fixtures.some(fixture=>isLiveStatus(fixture?.fixture?.status?.short));
    const liveTtl=cacheMinutes(Math.ceil(Number(liveRefreshSeconds())/60),1);
    const ttlMinutes=partial ? 5 : hasLive ? liveTtl : 120;
    await setCache(
      cacheKey,
      id,
      {teamId:id,fixtures,fetchedAt:new Date().toISOString(),partial},
      cfg,
      ttlMinutes,
    ).catch(()=>null);
    return fixtures;
  }
  
  function providerFixtureDirectCacheKey(fixtureId) {
    const id=positiveSafeInteger(fixtureId);
    return id ? `provider-fixture:${id}:v1` : '';
  }
  
  async function cachedProviderFixture(fixtureId,cfg) {
    const id=positiveSafeInteger(fixtureId);
    if (!id) return null;
    const direct=directFixtureCachePayload(
      await getCache(providerFixtureDirectCacheKey(id),cfg).catch(()=>null),
      id,
    );
    if (direct) return direct.fixture;
  
    for (const offset of [-1,0,1]) {
      const date=new Date(Date.now()+offset*86400_000).toISOString().slice(0,10);
      const batch=fixtureDateCachePayload(
        await getCache(providerFixtureDateCacheKey(date),cfg).catch(()=>null),
        date,
      );
      const fixture=(batch?.fixtures || []).find(row=>positiveSafeInteger(row?.fixture?.id)===id);
      if (fixture) return fixture;
    }
    return null;
  }
  
  async function loadProviderFixture(fixtureId,cfg) {
    const id=positiveSafeInteger(fixtureId);
    if (!id) return null;
    const cached=await cachedProviderFixture(id,cfg);
    if (cached) return cached;
    const rows=providerRows(await apiFootball('/fixtures',{id},cfg),'fixture-by-id');
    const fixture=rows.find(row=>positiveSafeInteger(row?.fixture?.id)===id) || null;
    if (!fixture) return null;
    const status=String(fixture.fixture?.status?.short || '');
    const liveTtl=cacheMinutes(Number(liveRefreshSeconds())/60,1);
    const ttlMinutes=isFinishedStatus(status) ? 720 : isLiveStatus(status) ? liveTtl : 5;
    await setCache(
      providerFixtureDirectCacheKey(id),
      id,
      {fixtureId:id,fixture,fetchedAt:new Date().toISOString()},
      cfg,
      ttlMinutes,
    ).catch(()=>null);
    return fixture;
  }
  
  function utcDateShift(date, offsetDays = 0) {
    const normalized=strictUtcDate(date);
    const offset=Number(offsetDays);
    if (!normalized || !Number.isSafeInteger(offset) || Math.abs(offset)>3660) return '';
    const parsed=new Date(`${normalized}T00:00:00.000Z`);
    parsed.setUTCDate(parsed.getUTCDate()+offset);
    return parsed.toISOString().slice(0,10);
  }
  
  function providerFeedDateTtl(date, cfg) {
    const normalized=strictUtcDate(date);
    const today=strictUtcDate(todayUtc());
    const yesterday=utcDateShift(today,-1);
    if (normalized && (normalized===today || normalized===utcDateShift(today,1))) {
      // FREE quota is shared (100/day): retain one validated date response
      // across clients instead of re-fetching on every app opening.
      return providerBudgetProfile()?.paid === true ? 2 : 20;
    }
    if (normalized && normalized===yesterday) return 720;
    return cacheMinutes(cfg?.cacheMinutes,10);
  }
  
  async function apiMatches(request, cfg) {
    const url = new URL(request.url);
    const requested=url.searchParams.get('date') || '';
    const today=strictUtcDate(todayUtc()) || new Date().toISOString().slice(0,10);
    const requestedDate=strictUtcDate(requested);
    const date=requestedDate || today;
    const isToday=date===today;
    const yesterday=utcDateShift(today,-1);
    const isYesterday=date===yesterday;
    const cacheKey=`matches:${date}:v6-integrity`;
  
    const cached=matchFeedCachePayload(await getCache(cacheKey,cfg).catch(()=>null),date);
    if (cached) return json({ ...cached, sourceMeta: markCachedSourceMeta(cached.sourceMeta || sourceMeta({ provider:'api-football', label:'API-Football' })), cached: true, stale: false });
    const previousPayload=matchFeedCachePayload(await getStaleCache(cacheKey,cfg).catch(()=>null),date);

    // API-Football FREE exposes a short date window (UTC yesterday/today/tomorrow).
    // Avoid spending quota on requests known to return a provider date-access error.
    // Paid plans retain their actual provider date range.
    const planProfile=providerBudgetProfile();
    const outsideFreeWindow=date<utcDateShift(today,-1) || date>utcDateShift(today,1);
    if (outsideFreeWindow && planProfile?.paid !== true) {
      if (previousPayload) {
        return json({
          ...previousPayload,
          cached:true,
          stale:true,
          warning:'Показаны последние сохранённые данные: дата вне доступного диапазона API-Football FREE.',
          sourceMeta:markCachedSourceMeta(
            previousPayload.sourceMeta || sourceMeta({provider:'api-football',label:'API-Football'}),
            {stale:true},
          ),
        });
      }
      return json({
        date,
        matches:[],
        catalog:{featured:0,live:0,major:0,cups:0,international:0,hiddenLowPriority:0},
        restrictedDate:true,
        cached:false,
        stale:false,
        warning:'Дата вне доступного диапазона API-Football FREE. Выберите сегодня или ближайший день.',
        sourceMeta:sourceMeta({provider:'api-football',label:'API-Football'}),
      });
    }
  
    let fixtures;
    const providerBatchKey=providerFixtureDateCacheKey(date);
    const providerBatch=fixtureDateCachePayload(
      await getCache(providerBatchKey,cfg).catch(()=>null),
      date,
    );
    const staleProviderBatch=providerBatch
      ? null
      : fixtureDateCachePayload(await getStaleCache(providerBatchKey,cfg).catch(()=>null),date);
    let providerFallback=null;
    try {
      if (providerBatch) {
        fixtures=providerBatch.fixtures;
      } else {
        // API-Football accepts an all-competitions fixtures request by exact date.
        // Bare from/to ranges require an additional league/team constraint, so the
        // public feed goes through the shared exact-date loader and its cache.
        fixtures=await loadProviderFixturesForDate(date,cfg,{forceRefresh:true});
      }
    } catch (error) {
      const rateLimited=isFootballRateLimitError(error);
      const recoverable=recoverableProviderError(error);
      const stale=previousPayload || matchFeedCachePayload(
        await getStaleCache(cacheKey,cfg).catch(()=>null),
        date,
      );
      const warning=rateLimited
        ? 'Показаны последние сохранённые данные: источник матчей временно ограничил обновления.'
        : 'Показаны последние сохранённые данные: источник матчей временно недоступен.';
      if (stale && recoverable) {
        return json({
          ...stale,
          cached:true,
          stale:true,
          warning,
          sourceMeta:markCachedSourceMeta(
            stale.sourceMeta || sourceMeta({provider:'api-football',label:'API-Football'}),
            {stale:true},
          ),
          retryAfter:boundedRetryAfter(error?.retryAfter,rateLimited ? 60 : 15),
        });
      }
      if (recoverable && staleProviderBatch) {
        fixtures=staleProviderBatch.fixtures;
        providerFallback={
          retryAfter:boundedRetryAfter(error?.retryAfter,rateLimited ? 60 : 15),
          warning,
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
        const elapsed=nonNegativeSafeInteger(f.fixture?.status?.elapsed);
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
          fixtureId: positiveSafeInteger(f.fixture?.id),
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
          home: { id: positiveSafeInteger(f.teams?.home?.id), name: homeName, logo: f.teams?.home?.logo || '' },
          away: { id: positiveSafeInteger(f.teams?.away?.id), name: awayName, logo: f.teams?.away?.logo || '' },
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
    let paid=false;
    try { paid=providerBudgetProfile()?.paid === true; } catch {}
    const nearCurrentDate=isToday || date===utcDateShift(today,1);
    const ttl=nearCurrentDate ? (paid ? 1 : 20) : isYesterday ? 720 : cacheMinutes(cfg?.cacheMinutes,10);
    await setCache(cacheKey,0,payload,cfg,ttl).catch(()=>null);
    return json({ ...payload, cached:false, stale:false });
  }
  
  
  
  return Object.freeze({
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
  });
}
