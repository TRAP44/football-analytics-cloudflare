// Team intelligence, squad and notification snapshots extracted from worker.js.
// Provider, freshness and quality primitives are injected by the composition root.
export function createTeamIntelligenceRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Team intelligence runtime dependencies are required.');
  }
  const {
    annotateEventReliability,
    annotateLineupReliability,
    apiFootball,
    applyFeatureFreshness,
    assessMatchEventQuality,
    assessMatchLineups,
    compactProviderError,
    formatLiveEvents,
    freeQuotaHealthy,
    getCache,
    getStaleCache,
    json,
    normalizeTeamSeasonStatistics,
    providerFeatureFetch,
    publicDataCapabilities,
    resolveTeamSeasonPlayers,
    runtimeControlsSnapshot,
    setCache,
    sourceMeta,
  } = deps;

  async function apiTeamIntelligence(request, cfg) {
    const url = new URL(request.url);
    const teamId = Number(url.searchParams.get('teamId'));
    const leagueId = Number(url.searchParams.get('leagueId'));
    const season = Number(url.searchParams.get('season'));
    if (!teamId || !leagueId || !season) return json({ error: 'Номер команды, номер турнира и сезон обязательны.' }, 400);
    const cacheKey = `team:intelligence:${teamId}:${leagueId}:${season}:v2`;
    const cached = await getCache(cacheKey, cfg);
    if (cached) return json({ ...cached, cached: true, stale: false, provider: publicDataCapabilities() });
    if (!freeQuotaHealthy(15, 2)) {
      const stale = await getStaleCache(cacheKey, cfg);
      if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Сезонная статистика показана из сохранённых данных: бережём лимит API-Football.', provider: publicDataCapabilities() });
      return json({ available: false, quotaGuard: true, reason: 'Сезонная статистика временно не запрашивается: сохраняем остаток квоты API-Football.', provider: publicDataCapabilities() });
    }
    try {
      const teamName=url.searchParams.get('teamName') || '';
      const leagueName=url.searchParams.get('leagueName') || '';
      const row = await apiFootball('/teams/statistics', { team: teamId, league: leagueId, season }, cfg, { responseType: 'any' });
      const stats = normalizeTeamSeasonStatistics(row, {
        teamId, leagueId, season,
        teamName, teamLogo: url.searchParams.get('teamLogo') || '',
        leagueName, country: url.searchParams.get('country') || '', leagueLogo: url.searchParams.get('leagueLogo') || '',
      });
  
      let playerStats={
        available:false,complete:false,partial:false,players:[],
        summary:{count:0,complete:false,pagesLoaded:0,pagesTotal:0,sourceScope:'team-season'},
        reason:'quota_guard',
        sourceMeta:sourceMeta({provider:'none',label:'Не запрашивалось',freshness:'unavailable'}),
      };
      if (freeQuotaHealthy(10,1)) {
        try {
          playerStats=await resolveTeamSeasonPlayers(teamId, teamName || stats.team?.name || '', leagueId, leagueName || stats.league?.name || '', season, cfg);
        } catch (playerError) {
          const compact=compactProviderError(playerError);
          playerStats={
            ...playerStats,
            reason:compact.code,
            sourceMeta:sourceMeta({provider:'none',label:'Нет доступного источника',freshness:'unavailable',attempts:[{provider:'api-football',state:'error',reason:compact.code,status:compact.status}]}),
          };
        }
      }
  
      const payload = {
        available: stats.available,
        stats,
        playerStats,
        refreshedAt: new Date().toISOString(),
        reason: stats.available ? '' : 'Источник данных не вернул сезонную статистику для этой команды.',
      };
      await setCache(cacheKey, teamId, payload, cfg, 360);
      return json({ ...payload, cached: false, stale: false, provider: publicDataCapabilities() });
    } catch (error) {
      const stale = await getStaleCache(cacheKey, cfg);
      if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Не удалось обновить сезонную статистику — показана сохранённая версия.', provider: publicDataCapabilities() });
      return json({ available: false, reason: `Сезонная статистика сейчас недоступна: ${String(error?.message || error).slice(0, 180)}`, provider: publicDataCapabilities() });
    }
  }
  
  function normalizeSquadPosition(position) {
    const p = String(position || '').toLowerCase();
    if (p.includes('goal')) return { key: 'goalkeeper', label: 'Вратари', order: 1 };
    if (p.includes('def')) return { key: 'defender', label: 'Защитники', order: 2 };
    if (p.includes('mid')) return { key: 'midfielder', label: 'Полузащитники', order: 3 };
    if (p.includes('att')) return { key: 'attacker', label: 'Нападающие', order: 4 };
    return { key: 'other', label: 'Другие', order: 5 };
  }
  
  function normalizeTeamSquad(rows, teamId) {
    const row = (Array.isArray(rows) ? rows : []).find(x => Number(x?.team?.id) === Number(teamId)) || rows?.[0] || null;
    if (!row) return { available: false, team: { id: Number(teamId) }, players: [], groups: [], summary: { total: 0, averageAge: null } };
    const players = (Array.isArray(row.players) ? row.players : []).map(p => {
      const pos = normalizeSquadPosition(p.position);
      return {
        id: Number(p.id || 0), name: String(p.name || ''), age: Number(p.age || 0) || null,
        number: Number(p.number || 0) || null, position: String(p.position || ''), positionKey: pos.key, positionLabel: pos.label,
        photo: String(p.photo || ''), order: pos.order,
      };
    }).filter(p => p.id || p.name).sort((a,b) => a.order - b.order || (a.number || 999) - (b.number || 999) || a.name.localeCompare(b.name));
    const ages = players.map(p => p.age).filter(Boolean);
    const groupMap = new Map();
    for (const p of players) {
      if (!groupMap.has(p.positionKey)) groupMap.set(p.positionKey, { key: p.positionKey, label: p.positionLabel, order: p.order, players: [] });
      groupMap.get(p.positionKey).players.push(p);
    }
    const groups = [...groupMap.values()].sort((a,b) => a.order - b.order);
    return {
      available: players.length > 0,
      team: { id: Number(row.team?.id || teamId), name: String(row.team?.name || ''), logo: String(row.team?.logo || '') },
      players, groups,
      summary: {
        total: players.length,
        averageAge: ages.length ? Math.round((ages.reduce((a,b)=>a+b,0) / ages.length) * 10) / 10 : null,
        goalkeepers: players.filter(p => p.positionKey === 'goalkeeper').length,
        defenders: players.filter(p => p.positionKey === 'defender').length,
        midfielders: players.filter(p => p.positionKey === 'midfielder').length,
        attackers: players.filter(p => p.positionKey === 'attacker').length,
      },
    };
  }
  
  async function apiTeamSquad(request, cfg) {
    const url = new URL(request.url);
    const teamId = Number(url.searchParams.get('teamId'));
    if (!teamId) return json({ error: 'Номер команды обязателен.' }, 400);
    const cacheKey = `team:squad:${teamId}:v1`;
    const cached = await getCache(cacheKey, cfg);
    if (cached) return json({ ...cached, cached: true, stale: false, provider: publicDataCapabilities() });
    if (!freeQuotaHealthy(10, 2)) {
      const stale = await getStaleCache(cacheKey, cfg);
      if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Состав показан из сохранённых данных: бережём лимит API-Football.', provider: publicDataCapabilities() });
      return json({ available: false, quotaGuard: true, reason: 'Состав временно не запрашивается: сохраняем остаток квоты API-Football.', provider: publicDataCapabilities() });
    }
    try {
      const rows = await apiFootball('/players/squads', { team: teamId }, cfg);
      const squad = normalizeTeamSquad(rows, teamId);
      const payload = { ...squad, refreshedAt: new Date().toISOString(), reason: squad.available ? '' : 'Источник данных не вернул текущий состав команды.' };
      await setCache(cacheKey, teamId, payload, cfg, 720);
      return json({ ...payload, cached: false, stale: false, provider: publicDataCapabilities() });
    } catch (error) {
      const stale = await getStaleCache(cacheKey, cfg);
      if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Не удалось обновить состав — показана сохранённая версия.', provider: publicDataCapabilities() });
      return json({ available: false, reason: `Состав сейчас недоступен: ${String(error?.message || error).slice(0, 180)}`, provider: publicDataCapabilities() });
    }
  }
  
  function normalizeLineupNotificationRow(row = {}) {
    return {
      teamId: Number(row?.team?.id || 0),
      teamName: String(row?.team?.name || ''),
      formation: String(row?.formation || ''),
      coach: String(row?.coach?.name || ''),
      startXI: (Array.isArray(row?.startXI) ? row.startXI : []).map(normalizeLineupPlayer).filter(Boolean),
      substitutes: (Array.isArray(row?.substitutes) ? row.substitutes : []).map(normalizeLineupPlayer).filter(Boolean),
    };
  }
  
  async function loadLineupNotificationSnapshot(fixtureId, cfg) {
    const id = Number(fixtureId || 0);
    if (!id) return { confirmed:false, reason:'invalid_fixture' };
    if (!freeQuotaHealthy(10, 1)) return { confirmed:false, reason:'quota_guard' };
  
    const result = await providerFeatureFetch({
      feature:'lineups',
      path:'/fixtures/lineups',
      params:{ fixture:id },
      fixtureId:id,
      cfg,
      context:{ mode:'upcoming', limitedCoverage:false },
    });
  
    const distinct = new Map();
    for (const row of Array.isArray(result?.data) ? result.data : []) {
      const teamId = Number(row?.team?.id || 0);
      if (!teamId || distinct.has(teamId)) continue;
      distinct.set(teamId, normalizeLineupNotificationRow(row));
    }
    const teams = [...distinct.values()];
    if (teams.length < 2) return { confirmed:false, reason:'both_teams_not_published', teamCount:teams.length };
  
    const lineups = { home:teams[0], away:teams[1] };
    const quality = assessMatchLineups(lineups);
    let meta = applyFeatureFreshness(
      result?.meta || { feature:'lineups', provider:'api-football', source:'network', state:'available', available:true, usable:true, observed:true },
      { feature:'lineups', mode:'upcoming' },
    );
    meta = annotateLineupReliability(meta, quality);
  
    return {
      confirmed:Boolean(quality.bothConfirmed && meta?.confirmed === true && meta?.confidenceBearing === true),
      reason: quality.bothConfirmed ? String(meta?.reason || '') : 'lineup_incomplete',
      lineupQuality:quality,
      sourceMeta:meta,
      teams,
    };
  }
  
  async function loadSmartNotificationEventSnapshot(fixtureId, cfg) {
    const id = Number(fixtureId || 0);
    if (!id) return { trusted:false, stale:false, reason:'invalid_fixture', events:[] };
    if (runtimeControlsSnapshot().liveEnabled === false) return { trusted:false, stale:false, reason:'live_disabled', events:[] };
  
    const result = await providerFeatureFetch({
      feature:'events',
      path:'/fixtures/events',
      params:{ fixture:id },
      fixtureId:id,
      cfg,
      context:{ mode:'live', limitedCoverage:false },
    });
    const rawRows = Array.isArray(result?.data) ? result.data : [];
    const formatted = formatLiveEvents(rawRows, 0, 0);
    let meta = applyFeatureFreshness(
      result?.meta || { feature:'events', provider:'api-football', source:'network', state:'available', available:true, usable:true, observed:true },
      { feature:'events', mode:'live' },
    );
    const quality = assessMatchEventQuality(formatted, {
      eventsMeta:meta,
      mode:'live',
    });
    meta = annotateEventReliability(meta, quality);
    const events = formatted.map(event => {
      const index = Number(String(event.id || '').split('-').at(-1));
      const raw = Number.isInteger(index) && index >= 0 ? rawRows[index] : null;
      const playerId = Number(raw?.player?.id || 0);
      const assistPlayerId = Number(raw?.assist?.id || 0);
      const eventKey = [
        Number.isFinite(Number(event.minute)) ? Number(event.minute) : 'na',
        Number(event.extra || 0),
        String(event.type || '').toLowerCase(),
        String(event.detail || '').toLowerCase(),
        Number(event.teamId || 0),
        playerId,
        assistPlayerId,
      ].join(':');
      return {
        ...event,
        playerId,
        assistPlayerId,
        playerName:String(event.player || ''),
        assistPlayerName:String(event.assist || ''),
        eventKey,
      };
    });
    return {
      trusted:Boolean(quality?.confidenceBearing && meta?.stale !== true),
      stale:Boolean(meta?.stale === true || meta?.source === 'stale' || meta?.source === 'stale-cache'),
      reason:String(meta?.reason || ''),
      sourceMeta:meta,
      eventQuality:quality,
      events,
    };
  }
  
  
  return {
    apiTeamIntelligence,
    normalizeSquadPosition,
    normalizeTeamSquad,
    apiTeamSquad,
    normalizeLineupNotificationRow,
    loadLineupNotificationSnapshot,
    loadSmartNotificationEventSnapshot,
  };
}
