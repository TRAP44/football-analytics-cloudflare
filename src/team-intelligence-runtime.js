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

  function teamIntelligenceCacheValue(value, teamId, leagueId, season) {
    const cached=objectValue(value);
    const stats=objectValue(cached?.stats);
    if (!cached || !stats) return null;
    if (positiveSafeInteger(stats?.team?.id)!==teamId) return null;
    if (positiveSafeInteger(stats?.league?.id)!==leagueId) return null;
    if (safeSeason(stats?.league?.season)!==season) return null;
    return cached;
  }

  function squadCacheValue(value, teamId) {
    const cached=objectValue(value);
    if (!cached) return null;
    return positiveSafeInteger(cached?.team?.id)===teamId ? cached : null;
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
    const cached=teamIntelligenceCacheValue(
      await getCache(cacheKey,cfg).catch(()=>null),
      teamId,
      leagueId,
      season,
    );
    if (cached) {
      return json({...cached,cached:true,stale:false,provider:capabilities()});
    }

    if (!quotaHealthy(15,2)) {
      const stale=teamIntelligenceCacheValue(
        await getStaleCache(cacheKey,cfg).catch(()=>null),
        teamId,
        leagueId,
        season,
      );
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
      const providerStats=objectValue(row);
      const statsScopeValid=Boolean(
        providerStats
        && positiveSafeInteger(providerStats?.team?.id)===teamId
        && positiveSafeInteger(providerStats?.league?.id)===leagueId
        && safeSeason(providerStats?.league?.season)===season
      );
      const stats=statsScopeValid && objectValue(normalizedStats)
        ? {...normalizedStats,available:normalizedStats.available === true}
        : {
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
      if (statsScopeValid) {
        const ttlMinutes=stats?.available === true ? 360 : 30;
        await setCache(cacheKey,teamId,payload,cfg,ttlMinutes).catch(()=>null);
      }
      return json({...payload,cached:false,stale:false,provider:capabilities()});
    } catch {
      const stale=teamIntelligenceCacheValue(
        await getStaleCache(cacheKey,cfg).catch(()=>null),
        teamId,
        leagueId,
        season,
      );
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
    const cached=squadCacheValue(
      await getCache(cacheKey,cfg).catch(()=>null),
      teamId,
    );
    if (cached) {
      return json({...cached,cached:true,stale:false,provider:capabilities()});
    }

    if (!quotaHealthy(10,2)) {
      const stale=squadCacheValue(
        await getStaleCache(cacheKey,cfg).catch(()=>null),
        teamId,
      );
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
      if (!Array.isArray(providerRows)) throw new Error('invalid squad payload');
      const hasRequestedTeam=providerRows.some(
        row=>positiveSafeInteger(row?.team?.id)===teamId,
      );
      if (providerRows.length && !hasRequestedTeam) {
        throw new Error('squad scope mismatch');
      }

      const squad=normalizeTeamSquad(providerRows,teamId);
      const payload={
        ...squad,
        refreshedAt:new Date().toISOString(),
        reason:squad.available
          ? ''
          : 'Источник данных не вернул текущий состав команды.',
      };
      const ttlMinutes=squad.available ? 720 : 30;
      await setCache(cacheKey,teamId,payload,cfg,ttlMinutes).catch(()=>null);
      return json({...payload,cached:false,stale:false,provider:capabilities()});
    } catch {
      const stale=squadCacheValue(
        await getStaleCache(cacheKey,cfg).catch(()=>null),
        teamId,
      );
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

  function normalizeLineupPlayers(entries, limit) {
    const normalized=[];

    for (const entry of rows(entries)) {
      let value;
      try {
        value=objectValue(normalizeLineupPlayer(entry));
      } catch {
        value=null;
      }
      if (!value) continue;

      const name=safeText(value.name,120);
      if (!name) continue;
      normalized.push({
        id:positiveSafeInteger(value.id),
        name,
        number:positiveSafeInteger(value.number,999),
        pos:safeText(value.pos,24),
        grid:safeText(value.grid,32),
        photo:safeText(value.photo,500),
      });
      if (normalized.length>=limit) break;
    }

    return normalized;
  }

  function normalizeLineupNotificationRow(row = {}) {
    const source=objectValue(row) || {};
    return {
      teamId:positiveSafeInteger(source?.team?.id) || 0,
      teamName:safeText(source?.team?.name,180),
      formation:safeText(source?.formation,32),
      coach:safeText(source?.coach?.name,120),
      startXI:normalizeLineupPlayers(source?.startXI,30),
      substitutes:normalizeLineupPlayers(source?.substitutes,40),
    };
  }

  async function loadLineupNotificationSnapshot(fixtureId, cfg) {
    const id=positiveSafeInteger(fixtureId);
    if (!id) return {confirmed:false,reason:'invalid_fixture'};
    if (!quotaHealthy(10,1)) return {confirmed:false,reason:'quota_guard'};

    const result=objectValue(await providerFeatureFetch({
      feature:'lineups',
      path:'/fixtures/lineups',
      params:{fixture:id},
      fixtureId:id,
      cfg,
      context:{mode:'upcoming',limitedCoverage:false},
    })) || {};

    const lineupScore=lineup=>{
      const starters=rows(lineup?.startXI);
      const identities=new Set(starters.map(player=>{
        const id=positiveSafeInteger(player?.id);
        return id
          ? `id:${id}`
          : safeText(player?.name,120).toLocaleLowerCase('ru');
      }).filter(Boolean));
      const exactBonus=starters.length===11 ? 100000 : 0;
      const distancePenalty=Math.abs(11-starters.length)*1000;
      return exactBonus-distancePenalty+identities.size*100+rows(lineup?.substitutes).length;
    };

    const distinct=new Map();
    for (const providerRow of rows(result?.data).slice(0,20)) {
      const teamId=positiveSafeInteger(providerRow?.team?.id);
      if (!teamId) continue;

      const candidate=normalizeLineupNotificationRow(providerRow);
      const current=distinct.get(teamId);
      if (!current || lineupScore(candidate)>lineupScore(current)) {
        distinct.set(teamId,candidate);
      }
    }

    const teams=[...distinct.values()];
    if (teams.length!==2) {
      return {
        confirmed:false,
        reason:teams.length<2 ? 'both_teams_not_published' : 'unexpected_team_count',
        teamCount:teams.length,
        teams,
      };
    }

    const lineups={home:teams[0],away:teams[1]};
    const assessed=assessMatchLineups(lineups);
    const quality=objectValue(assessed) || {
      anyPublished:false,
      bothPublished:false,
      bothConfirmed:false,
      confirmedSides:0,
      partialSides:0,
    };

    const fallbackMeta={
      feature:'lineups',
      provider:'api-football',
      source:'network',
      state:'available',
      available:true,
      usable:true,
      observed:true,
    };
    const freshMeta=objectValue(applyFeatureFreshness(
      objectValue(result?.meta) || fallbackMeta,
      {feature:'lineups',mode:'upcoming'},
    )) || fallbackMeta;
    const annotated=objectValue(annotateLineupReliability(freshMeta,quality));
    const meta=annotated || {
      ...freshMeta,
      confirmed:false,
      confidenceBearing:false,
      reason:'lineup_reliability_unavailable',
    };

    return {
      confirmed:Boolean(
        quality?.bothConfirmed === true
        && meta?.confirmed === true
        && meta?.confidenceBearing === true
      ),
      reason:quality?.bothConfirmed === true
        ? safeText(meta?.reason,160)
        : 'lineup_incomplete',
      lineupQuality:quality,
      sourceMeta:meta,
      teamCount:teams.length,
      teams,
    };
  }

  async function loadSmartNotificationEventSnapshot(fixtureId, cfg) {
    const id=positiveSafeInteger(fixtureId);
    if (!id) return {trusted:false,stale:false,reason:'invalid_fixture',events:[]};

    const controls=objectValue(runtimeControlsSnapshot()) || {};
    if (controls.liveEnabled === false) {
      return {trusted:false,stale:false,reason:'live_disabled',events:[]};
    }

    const result=objectValue(await providerFeatureFetch({
      feature:'events',
      path:'/fixtures/events',
      params:{fixture:id},
      fixtureId:id,
      cfg,
      context:{mode:'live',limitedCoverage:false},
    })) || {};

    const rawRows=rows(result?.data).slice(0,500);
    const formatted=rows(formatLiveEvents(rawRows,0,0));
    const fallbackMeta={
      feature:'events',
      provider:'api-football',
      source:'network',
      state:'available',
      available:true,
      usable:true,
      observed:true,
    };
    const freshMeta=objectValue(applyFeatureFreshness(
      objectValue(result?.meta) || fallbackMeta,
      {feature:'events',mode:'live'},
    )) || fallbackMeta;

    const assessed=assessMatchEventQuality(formatted,{
      eventsMeta:freshMeta,
      mode:'live',
    });
    const quality=objectValue(assessed) || {
      observed:false,
      sourceTrusted:false,
      displayCount:0,
      analyticalCount:0,
      confidenceBearing:false,
      displayEventIndices:[],
    };
    const annotated=objectValue(annotateEventReliability(freshMeta,quality));
    const meta=annotated || {
      ...freshMeta,
      stale:true,
      confidenceBearing:false,
      reason:'event_reliability_unavailable',
    };

    const maxRawIndex=Math.max(0,rawRows.length-1);
    const events=formatted.map(formattedEvent=>{
      const event=objectValue(formattedEvent) || {};
      const idTail=safeText(event?.id,120).split('-').at(-1);
      const index=nonNegativeSafeInteger(idTail,maxRawIndex);
      const raw=index !== null && index<rawRows.length
        ? objectValue(rawRows[index])
        : null;
      const playerId=positiveSafeInteger(raw?.player?.id) || 0;
      const assistPlayerId=positiveSafeInteger(raw?.assist?.id) || 0;
      const minute=nonNegativeSafeInteger(event?.minute,180);
      const extra=nonNegativeSafeInteger(event?.extra,30) || 0;
      const teamId=positiveSafeInteger(event?.teamId) || 0;
      const type=safeText(event?.type,80);
      const detail=safeText(event?.detail,160);

      return {
        ...event,
        playerId,
        assistPlayerId,
        playerName:safeText(event?.player,120),
        assistPlayerName:safeText(event?.assist,120),
        eventKey:[
          minute ?? 'na',
          extra,
          type.toLowerCase(),
          detail.toLowerCase(),
          teamId,
          playerId,
          assistPlayerId,
        ].join(':'),
      };
    });

    const stale=Boolean(
      meta?.stale === true
      || meta?.source === 'stale'
      || meta?.source === 'stale-cache'
    );

    return {
      trusted:Boolean(quality?.confidenceBearing === true && !stale),
      stale,
      reason:safeText(meta?.reason,160),
      sourceMeta:meta,
      eventQuality:quality,
      events,
    };
  }


  return Object.freeze({
    apiTeamIntelligence,
    normalizeSquadPosition,
    normalizeTeamSquad,
    apiTeamSquad,
    normalizeLineupNotificationRow,
    loadLineupNotificationSnapshot,
    loadSmartNotificationEventSnapshot,
  });
}
