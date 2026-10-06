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
    normalizeLineupPlayer,
    normalizeTeamSeasonStatistics,
    providerFeatureFetch,
    publicDataCapabilities,
    resolveTeamSeasonPlayers,
    runtimeControlsSnapshot,
    setCache,
    sourceMeta,
  } = deps;

  const requiredFunctions = {
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
    normalizeLineupPlayer,
    normalizeTeamSeasonStatistics,
    providerFeatureFetch,
    publicDataCapabilities,
    resolveTeamSeasonPlayers,
    runtimeControlsSnapshot,
    setCache,
    sourceMeta,
  };
  for (const [name, fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

  function rows(value) {
    return Array.isArray(value) ? value : [];
  }

  function positiveSafeInteger(value, max = Number.MAX_SAFE_INTEGER) {
    const number = typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : NaN;
    return Number.isSafeInteger(number) && number > 0 && number <= max ? number : null;
  }

  function nonNegativeSafeInteger(value, max = Number.MAX_SAFE_INTEGER) {
    const number = typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : NaN;
    return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null;
  }

  function safeSeason(value) {
    const number=positiveSafeInteger(value,2100);
    return number && number>=1900 ? number : null;
  }

  function safeText(value, max = 240) {
    if (!['string','number','bigint'].includes(typeof value)) return '';
    return String(value).trim().slice(0,max);
  }

  function objectValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function quotaHealthy(reserve, cost) {
    try { return freeQuotaHealthy(reserve,cost) === true; }
    catch { return false; }
  }

  function capabilities() {
    try { return objectValue(publicDataCapabilities()) || {}; }
    catch { return {}; }
  }

  function compactError(error) {
    try {
      const compact=compactProviderError(error);
      if (objectValue(compact)) {
        return {
          code:safeText(compact.code,120) || safeText(error?.code,120) || 'provider_error',
          status:positiveSafeInteger(compact.status,599),
        };
      }
    } catch {}
    return {
      code:safeText(error?.code,120) || 'provider_error',
      status:positiveSafeInteger(error?.status,599),
    };
  }

  function emptyPlayerStats(reason = 'quota_guard', sourceLabel = 'Не запрашивалось') {
    return {
      available:false,
      complete:false,
      partial:false,
      players:[],
      summary:{count:0,complete:false,pagesLoaded:0,pagesTotal:0,sourceScope:'team-season'},
      reason:safeText(reason,160) || 'unavailable',
      sourceMeta:sourceMeta({
        provider:'none',
        label:safeText(sourceLabel,120) || 'Недоступно',
        freshness:'unavailable',
      }),
    };
  }

  async function apiTeamIntelligence(request, cfg) {
    const url=new URL(request.url);
    const teamId=positiveSafeInteger(url.searchParams.get('teamId'));
    const leagueId=positiveSafeInteger(url.searchParams.get('leagueId'));
    const season=safeSeason(url.searchParams.get('season'));
    if (!teamId || !leagueId || !season) {
      return json({error:'Номер команды, номер турнира и сезон обязательны.'},400);
    }

    const cacheKey=`team:intelligence:${teamId}:${leagueId}:${season}:v2`;
    const cached=objectValue(await getCache(cacheKey,cfg).catch(()=>null));
    if (cached) {
      return json({...cached,cached:true,stale:false,provider:capabilities()});
    }

    if (!quotaHealthy(15,2)) {
      const stale=objectValue(await getStaleCache(cacheKey,cfg).catch(()=>null));
      if (stale) {
        return json({
          ...stale,
          cached:true,
          stale:true,
          warning:'Сезонная статистика показана из сохранённых данных: бережём лимит API-Football.',
          provider:capabilities(),
        });
      }
      return json({
        available:false,
        quotaGuard:true,
        reason:'Сезонная статистика временно не запрашивается: сохраняем остаток квоты API-Football.',
        provider:capabilities(),
      });
    }

    try {
      const teamName=safeText(url.searchParams.get('teamName'),180);
      const leagueName=safeText(url.searchParams.get('leagueName'),180);
      const row=await apiFootball(
        '/teams/statistics',
        {team:teamId,league:leagueId,season},
        cfg,
        {responseType:'any'},
      );

      const normalizedStats=normalizeTeamSeasonStatistics(row,{
        teamId,
        leagueId,
        season,
        teamName,
        teamLogo:safeText(url.searchParams.get('teamLogo'),500),
        leagueName,
        country:safeText(url.searchParams.get('country'),120),
        leagueLogo:safeText(url.searchParams.get('leagueLogo'),500),
      });
      const stats=objectValue(normalizedStats) || {
        available:false,
        team:{id:teamId,name:teamName,logo:''},
        league:{id:leagueId,name:leagueName,season},
      };

      let playerStats=emptyPlayerStats();
      if (quotaHealthy(10,1)) {
        try {
          const resolved=objectValue(await resolveTeamSeasonPlayers(
            teamId,
            teamName || safeText(stats?.team?.name,180),
            leagueId,
            leagueName || safeText(stats?.league?.name,180),
            season,
            cfg,
          ));
          if (resolved) {
            const fallbackSummary=emptyPlayerStats('invalid_player_stats','Нет доступного источника').summary;
            playerStats={
              ...resolved,
              available:resolved.available === true,
              complete:resolved.complete === true,
              partial:resolved.partial === true,
              players:rows(resolved.players),
              summary:objectValue(resolved.summary) || fallbackSummary,
              reason:safeText(resolved.reason,160),
              sourceMeta:objectValue(resolved.sourceMeta) || sourceMeta({
                provider:'none',
                label:'Нет доступного источника',
                freshness:'unavailable',
              }),
            };
          } else {
            playerStats=emptyPlayerStats('invalid_player_stats','Нет доступного источника');
          }
        } catch (playerError) {
          const compact=compactError(playerError);
          playerStats={
            ...emptyPlayerStats(compact.code,'Нет доступного источника'),
            sourceMeta:sourceMeta({
              provider:'none',
              label:'Нет доступного источника',
              freshness:'unavailable',
              attempts:[{
                provider:'api-football',
                state:'error',
                reason:compact.code,
                status:compact.status,
              }],
            }),
          };
        }
      }

      const payload={
        available:stats?.available === true,
        stats,
        playerStats,
        refreshedAt:new Date().toISOString(),
        reason:stats?.available === true
          ? ''
          : 'Источник данных не вернул сезонную статистику для этой команды.',
      };
      await setCache(cacheKey,teamId,payload,cfg,360).catch(()=>null);
      return json({...payload,cached:false,stale:false,provider:capabilities()});
    } catch {
      const stale=objectValue(await getStaleCache(cacheKey,cfg).catch(()=>null));
      if (stale) {
        return json({
          ...stale,
          cached:true,
          stale:true,
          warning:'Не удалось обновить сезонную статистику — показана сохранённая версия.',
          provider:capabilities(),
        });
      }
      return json({
        available:false,
        reason:'Сезонная статистика сейчас недоступна.',
        provider:capabilities(),
      });
    }
  }

  function normalizeSquadPosition(position) {
    const value=safeText(position,80).toLowerCase();
    if (value.includes('goal')) return {key:'goalkeeper',label:'Вратари',order:1};
    if (value.includes('def')) return {key:'defender',label:'Защитники',order:2};
    if (value.includes('mid')) return {key:'midfielder',label:'Полузащитники',order:3};
    if (value.includes('att') || value.includes('forward')) {
      return {key:'attacker',label:'Нападающие',order:4};
    }
    return {key:'other',label:'Другие',order:5};
  }

  function emptySquad(teamId) {
    return {
      available:false,
      team:{id:positiveSafeInteger(teamId) || 0,name:'',logo:''},
      players:[],
      groups:[],
      summary:{
        total:0,
        averageAge:null,
        goalkeepers:0,
        defenders:0,
        midfielders:0,
        attackers:0,
      },
    };
  }

  function normalizeTeamSquad(providerRows, teamId) {
    const normalizedTeamId=positiveSafeInteger(teamId);
    if (!normalizedTeamId) return emptySquad(teamId);

    const row=rows(providerRows).find(
      item=>positiveSafeInteger(item?.team?.id)===normalizedTeamId,
    );
    if (!row) return emptySquad(normalizedTeamId);

    const seen=new Set();
    const players=rows(row?.players).map(player=>{
      const id=positiveSafeInteger(player?.id);
      const name=safeText(player?.name,180);
      if (!id && !name) return null;

      const position=safeText(player?.position,80);
      const normalizedPosition=normalizeSquadPosition(position);
      return {
        id:id || 0,
        name,
        age:positiveSafeInteger(player?.age,100),
        number:positiveSafeInteger(player?.number,999),
        position,
        positionKey:normalizedPosition.key,
        positionLabel:normalizedPosition.label,
        photo:safeText(player?.photo,500),
        order:normalizedPosition.order,
      };
    }).filter(player=>{
      if (!player) return false;
      const key=player.id
        ? `id:${player.id}`
        : `name:${player.name.toLocaleLowerCase('ru')}:${player.positionKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0,100).sort((a,b)=>
      a.order-b.order
      || (a.number || 999)-(b.number || 999)
      || a.name.localeCompare(b.name,'ru')
    );

    const ages=players.map(player=>player.age).filter(age=>age !== null);
    const groupMap=new Map();
    for (const player of players) {
      if (!groupMap.has(player.positionKey)) {
        groupMap.set(player.positionKey,{
          key:player.positionKey,
          label:player.positionLabel,
          order:player.order,
          players:[],
        });
      }
      groupMap.get(player.positionKey).players.push(player);
    }
    const groups=[...groupMap.values()].sort((a,b)=>a.order-b.order);

    return {
      available:players.length>0,
      team:{
        id:normalizedTeamId,
        name:safeText(row?.team?.name,180),
        logo:safeText(row?.team?.logo,500),
      },
      players,
      groups,
      summary:{
        total:players.length,
        averageAge:ages.length
          ? Math.round((ages.reduce((sum,age)=>sum+age,0)/ages.length)*10)/10
          : null,
        goalkeepers:players.filter(player=>player.positionKey==='goalkeeper').length,
        defenders:players.filter(player=>player.positionKey==='defender').length,
        midfielders:players.filter(player=>player.positionKey==='midfielder').length,
        attackers:players.filter(player=>player.positionKey==='attacker').length,
      },
    };
  }

  async function apiTeamSquad(request, cfg) {
    const url=new URL(request.url);
    const teamId=positiveSafeInteger(url.searchParams.get('teamId'));
    if (!teamId) return json({error:'Номер команды обязателен.'},400);

    const cacheKey=`team:squad:${teamId}:v1`;
    const cached=objectValue(await getCache(cacheKey,cfg).catch(()=>null));
    if (cached) {
      return json({...cached,cached:true,stale:false,provider:capabilities()});
    }

    if (!quotaHealthy(10,2)) {
      const stale=objectValue(await getStaleCache(cacheKey,cfg).catch(()=>null));
      if (stale) {
        return json({
          ...stale,
          cached:true,
          stale:true,
          warning:'Состав показан из сохранённых данных: бережём лимит API-Football.',
          provider:capabilities(),
        });
      }
      return json({
        available:false,
        quotaGuard:true,
        reason:'Состав временно не запрашивается: сохраняем остаток квоты API-Football.',
        provider:capabilities(),
      });
    }

    try {
      const providerRows=await apiFootball('/players/squads',{team:teamId},cfg);
      const squad=normalizeTeamSquad(providerRows,teamId);
      const payload={
        ...squad,
        refreshedAt:new Date().toISOString(),
        reason:squad.available
          ? ''
          : 'Источник данных не вернул текущий состав команды.',
      };
      await setCache(cacheKey,teamId,payload,cfg,720).catch(()=>null);
      return json({...payload,cached:false,stale:false,provider:capabilities()});
    } catch {
      const stale=objectValue(await getStaleCache(cacheKey,cfg).catch(()=>null));
      if (stale) {
        return json({
          ...stale,
          cached:true,
          stale:true,
          warning:'Не удалось обновить состав — показана сохранённая версия.',
          provider:capabilities(),
        });
      }
      return json({
        available:false,
        reason:'Состав сейчас недоступен.',
        provider:capabilities(),
      });
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
