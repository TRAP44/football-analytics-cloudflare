// Cached team context, match comparison and AI instructor helpers extracted from worker.js.
// Cache, provider and analysis primitives are injected by the composition root.
export function createAnalysisContextRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Analysis context runtime dependencies are required.');
  }
  const {
    analysisQualityGate,
    freeQuotaHealthy,
    getCache,
    getStaleCache,
    marketMovementNote,
    refereeProfile,
    resolveTeamSeasonPlayers,
    setCache,
  } = deps;

  const requiredFunctions={
    analysisQualityGate,
    freeQuotaHealthy,
    getCache,
    getStaleCache,
    marketMovementNote,
    refereeProfile,
    resolveTeamSeasonPlayers,
    setCache,
  };
  for (const [name,fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

  function objectValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function rows(value, limit = 200) {
    return Array.isArray(value) ? value.slice(0,limit) : [];
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

  function finiteRange(value,min,max) {
    const number=finiteNumber(value);
    return number !== null && number>=min && number<=max ? number : null;
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

  function safeSeason(value) {
    const season=positiveSafeInteger(value);
    return season !== null && season>=1900 && season<=2200 ? season : null;
  }

  function quotaHealthy(reserve,cost) {
    try { return freeQuotaHealthy(reserve,cost) === true; }
    catch { return false; }
  }

  function playerStatsValue(value) {
    const stats=objectValue(value);
    if (!stats || stats.available !== true) return null;
    const players=rows(stats.players,500);
    if (!players.length) return null;
    return {...stats,players};
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

  function playerRoleCacheValue(value, teamId, leagueId, season) {
    const cached=objectValue(value);
    if (!cached) return null;
    if (positiveSafeInteger(cached.teamId)!==teamId) return null;
    if (positiveSafeInteger(cached.leagueId)!==leagueId) return null;
    if (safeSeason(cached.season)!==season) return null;
    const playerStats=playerStatsValue(cached.playerStats);
    return playerStats ? {...cached,playerStats} : null;
  }

  async function cachedTeamIntelligenceForAnalysis(teamId, leagueId, season, cfg) {
    const normalizedTeamId=positiveSafeInteger(teamId);
    const normalizedLeagueId=positiveSafeInteger(leagueId);
    const normalizedSeason=safeSeason(season);
    if (!normalizedTeamId || !normalizedLeagueId || !normalizedSeason) {
      return {stats:null,playerStats:null};
    }

    const cacheKey=`team:intelligence:${normalizedTeamId}:${normalizedLeagueId}:${normalizedSeason}:v2`;
    const raw=await getStaleCache(cacheKey,cfg).catch(()=>null);
    const cached=teamIntelligenceCacheValue(
      raw,
      normalizedTeamId,
      normalizedLeagueId,
      normalizedSeason,
    );
    if (!cached) return {stats:null,playerStats:null};

    const stats=objectValue(cached.stats);
    return {
      stats:stats?.available === true ? stats : null,
      playerStats:playerStatsValue(cached.playerStats),
    };
  }

  async function hydratePlayerRolesForAnalysis({
    teamId,
    teamName,
    leagueId,
    leagueName,
    season,
    cachedPlayerStats,
    needed,
    cfg,
    maxPages=1,
  } = {}) {
    const normalizedTeamId=positiveSafeInteger(teamId);
    const normalizedLeagueId=positiveSafeInteger(leagueId);
    const normalizedSeason=safeSeason(season);
    const suppliedPlayerStats=playerStatsValue(cachedPlayerStats);

    if (suppliedPlayerStats) {
      return {
        playerStats:suppliedPlayerStats,
        source:'team-intelligence-cache',
        network:false,
        stale:false,
        reason:'',
      };
    }
    if (
      needed !== true
      || !normalizedTeamId
      || !normalizedLeagueId
      || !normalizedSeason
    ) {
      return {
        playerStats:null,
        source:'not-needed',
        network:false,
        stale:false,
        reason:'not_needed',
      };
    }

    const requestedPages=positiveSafeInteger(maxPages);
    const pageLimit=requestedPages ? Math.min(2,requestedPages) : 1;
    const cacheKey=`analysis:player-role:${normalizedTeamId}:${normalizedLeagueId}:${normalizedSeason}:v1`;
    const cached=playerRoleCacheValue(
      await getCache(cacheKey,cfg).catch(()=>null),
      normalizedTeamId,
      normalizedLeagueId,
      normalizedSeason,
    );
    if (cached) {
      return {
        playerStats:cached.playerStats,
        source:'analysis-cache',
        network:false,
        stale:false,
        reason:'',
      };
    }

    const stale=playerRoleCacheValue(
      await getStaleCache(cacheKey,cfg).catch(()=>null),
      normalizedTeamId,
      normalizedLeagueId,
      normalizedSeason,
    );
    if (!quotaHealthy(12,1)) {
      return stale
        ? {
            playerStats:stale.playerStats,
            source:'analysis-stale-cache',
            network:false,
            stale:true,
            reason:'quota_guard',
          }
        : {
            playerStats:null,
            source:'unavailable',
            network:false,
            stale:false,
            reason:'quota_guard',
          };
    }

    try {
      const resolved=objectValue(await resolveTeamSeasonPlayers(
        normalizedTeamId,
        safeText(teamName,180),
        normalizedLeagueId,
        safeText(leagueName,180),
        normalizedSeason,
        cfg,
        {maxPages:pageLimit},
      ));
      const playerStats=playerStatsValue(resolved);
      if (playerStats) {
        await setCache(
          cacheKey,
          normalizedTeamId,
          {
            teamId:normalizedTeamId,
            leagueId:normalizedLeagueId,
            season:normalizedSeason,
            playerStats,
            refreshedAt:new Date().toISOString(),
          },
          cfg,
          360,
        ).catch(()=>false);
        return {
          playerStats,
          source:'analysis-hydration',
          network:true,
          stale:false,
          reason:safeText(resolved?.reason,160),
        };
      }

      const reason=safeText(resolved?.reason,160) || 'provider_unavailable';
      return stale
        ? {
            playerStats:stale.playerStats,
            source:'analysis-stale-cache',
            network:true,
            stale:true,
            reason,
          }
        : {
            playerStats:null,
            source:'unavailable',
            network:true,
            stale:false,
            reason,
          };
    } catch (error) {
      const reason=safeText(error?.code,120) || 'provider_error';
      return stale
        ? {
            playerStats:stale.playerStats,
            source:'analysis-stale-cache',
            network:true,
            stale:true,
            reason,
          }
        : {
            playerStats:null,
            source:'unavailable',
            network:true,
            stale:false,
            reason,
          };
    }
  }

  function comparisonNumber(value) {
    return finiteNumber(value);
  }

  function comparisonMetric({
    key,
    label,
    homeValue,
    awayValue,
    format='number',
    better='higher',
    minGap=0,
    note='',
  } = {}) {
    const home=comparisonNumber(homeValue);
    const away=comparisonNumber(awayValue);
    if (home === null || away === null) return null;

    const gapThreshold=finiteNumber(minGap);
    const safeGap=gapThreshold !== null && gapThreshold>=0 ? gapThreshold : 0;
    const direction=better === 'lower' ? 'lower' : 'higher';
    const gap=Math.abs(home-away);
    let edge='even';
    if (gap>safeGap) {
      const homeBetter=direction === 'lower' ? home<away : home>away;
      edge=homeBetter ? 'home' : 'away';
    }

    return {
      key:safeText(key,60),
      label:safeText(label,160),
      homeValue:home,
      awayValue:away,
      format:['number','decimal','percent','rank','integer'].includes(format)
        ? format
        : 'number',
      better:direction,
      edge,
      note:safeText(note,320),
    };
  }

  function buildMatchComparison({
    homeName,
    awayName,
    homeForm,
    awayForm,
    homeStanding,
    awayStanding,
    homeSeasonStats,
    awaySeasonStats,
    goalModel,
    h2h,
    absences,
    hasInjuryData,
  } = {}) {
    const homeLabel=safeText(homeName,120) || 'Хозяева';
    const awayLabel=safeText(awayName,120) || 'Гости';
    const hOverall=objectValue(objectValue(homeForm)?.overall);
    const aOverall=objectValue(objectValue(awayForm)?.overall);
    const hVenue=objectValue(objectValue(homeForm)?.venue);
    const aVenue=objectValue(objectValue(awayForm)?.venue);
    const hSeason=objectValue(objectValue(homeSeasonStats)?.derived);
    const aSeason=objectValue(objectValue(awaySeasonStats)?.derived);
    const model=objectValue(goalModel);
    const homeTable=objectValue(homeStanding);
    const awayTable=objectValue(awayStanding);

    const formHomePpg=finiteRange(hOverall?.ppg,0,3);
    const formAwayPpg=finiteRange(aOverall?.ppg,0,3);
    const venueHomePpg=finiteRange(hVenue?.ppg,0,3);
    const venueAwayPpg=finiteRange(aVenue?.ppg,0,3);

    const recentHomeAttack=finiteRange(hOverall?.gfAvg,0,20);
    const recentAwayAttack=finiteRange(aOverall?.gfAvg,0,20);
    const seasonHomeAttack=finiteRange(hSeason?.goalsForPerMatch,0,20);
    const seasonAwayAttack=finiteRange(aSeason?.goalsForPerMatch,0,20);
    const attackUsesSeason=seasonHomeAttack !== null && seasonAwayAttack !== null;

    const recentHomeDefense=finiteRange(hOverall?.gaAvg,0,20);
    const recentAwayDefense=finiteRange(aOverall?.gaAvg,0,20);
    const seasonHomeDefense=finiteRange(hSeason?.goalsAgainstPerMatch,0,20);
    const seasonAwayDefense=finiteRange(aSeason?.goalsAgainstPerMatch,0,20);
    const defenseUsesSeason=seasonHomeDefense !== null && seasonAwayDefense !== null;

    const recentHomeClean=finiteRange(hOverall?.cleanSheetPct,0,100);
    const recentAwayClean=finiteRange(aOverall?.cleanSheetPct,0,100);
    const seasonHomeClean=finiteRange(hSeason?.cleanSheetRate,0,100);
    const seasonAwayClean=finiteRange(aSeason?.cleanSheetRate,0,100);
    const cleanUsesSeason=seasonHomeClean !== null && seasonAwayClean !== null;

    const expectedHome=finiteRange(model?.homeExpected,0,15);
    const expectedAway=finiteRange(model?.awayExpected,0,15);
    const homeRank=positiveSafeInteger(homeTable?.rank);
    const awayRank=positiveSafeInteger(awayTable?.rank);
    const standingsUsable=Boolean(
      homeRank && awayRank && homeRank<=1000 && awayRank<=1000,
    );
    const seasonStatsUsable=attackUsesSeason || defenseUsesSeason || cleanUsesSeason;
    const recentFormUsable=(
      formHomePpg !== null && formAwayPpg !== null
    ) || (
      recentHomeAttack !== null && recentAwayAttack !== null
    ) || (
      recentHomeDefense !== null && recentAwayDefense !== null
    ) || (
      recentHomeClean !== null && recentAwayClean !== null
    );
    const venueFormUsable=venueHomePpg !== null && venueAwayPpg !== null;

    const h2hValue=objectValue(h2h);
    const h2hHome=nonNegativeSafeInteger(h2hValue?.homeWins,1000);
    const h2hAway=nonNegativeSafeInteger(h2hValue?.awayWins,1000);
    const h2hDraws=nonNegativeSafeInteger(h2hValue?.draws,1000);
    const h2hValid=h2hHome !== null
      && h2hAway !== null
      && h2hDraws !== null
      && h2hHome+h2hAway+h2hDraws>0;

    const absenceValue=objectValue(absences);
    const homeAbsences=Array.isArray(absenceValue?.home)
      ? Math.min(absenceValue.home.length,200)
      : null;
    const awayAbsences=Array.isArray(absenceValue?.away)
      ? Math.min(absenceValue.away.length,200)
      : null;
    const injuryDataUsable=hasInjuryData === true
      && homeAbsences !== null
      && awayAbsences !== null;

    const metrics=[
      comparisonMetric({
        key:'form_ppg',
        label:'Форма · очки/матч',
        homeValue:formHomePpg,
        awayValue:formAwayPpg,
        format:'decimal',
        minGap:.14,
        note:'Последние 5 завершённых матчей.',
      }),
      comparisonMetric({
        key:'venue_ppg',
        label:'Дома / в гостях',
        homeValue:venueHomePpg,
        awayValue:venueAwayPpg,
        format:'decimal',
        minGap:.14,
        note:'Хозяева дома против гостей на выезде.',
      }),
      comparisonMetric({
        key:'attack',
        label:'Атака · гол/матч',
        homeValue:attackUsesSeason ? seasonHomeAttack : recentHomeAttack,
        awayValue:attackUsesSeason ? seasonAwayAttack : recentAwayAttack,
        format:'decimal',
        minGap:.14,
        note:attackUsesSeason
          ? 'Сезонная статистика из уже загруженных сохранённых данных.'
          : 'Недавняя результативность.',
      }),
      comparisonMetric({
        key:'defense',
        label:'Оборона · пропущено',
        homeValue:defenseUsesSeason ? seasonHomeDefense : recentHomeDefense,
        awayValue:defenseUsesSeason ? seasonAwayDefense : recentAwayDefense,
        format:'decimal',
        better:'lower',
        minGap:.14,
        note:'Меньше — лучше.',
      }),
      comparisonMetric({
        key:'clean_sheets',
        label:'Сухие матчи',
        homeValue:cleanUsesSeason ? seasonHomeClean : recentHomeClean,
        awayValue:cleanUsesSeason ? seasonAwayClean : recentAwayClean,
        format:'percent',
        minGap:8,
        note:cleanUsesSeason
          ? 'Доля матчей сезона без пропущенных.'
          : 'Доля в последних матчах.',
      }),
      comparisonMetric({
        key:'expected_goals',
        label:'Голевая оценка модели',
        homeValue:expectedHome,
        awayValue:expectedAway,
        format:'decimal',
        minGap:.14,
        note:'Модель Пуассона по доступной форме.',
      }),
      comparisonMetric({
        key:'table_rank',
        label:'Место в таблице',
        homeValue:standingsUsable ? homeRank : null,
        awayValue:standingsUsable ? awayRank : null,
        format:'rank',
        better:'lower',
        minGap:0,
        note:'Показывается только если таблица турнира уже была загружена.',
      }),
      h2hValid ? comparisonMetric({
        key:'h2h',
        label:'Победы в очных встречах',
        homeValue:h2hHome,
        awayValue:h2hAway,
        format:'integer',
        minGap:0,
        note:'Последние доступные очные встречи.',
      }) : null,
      injuryDataUsable ? comparisonMetric({
        key:'absences',
        label:'Отмеченные потери',
        homeValue:homeAbsences,
        awayValue:awayAbsences,
        format:'integer',
        better:'lower',
        minGap:0,
        note:'Актуальные отметки источника после дедупликации и сверки с опубликованным составом.',
      }) : null,
    ].filter(Boolean);

    const descriptions={
      form_ppg:'лучше текущая форма',
      venue_ppg:'сильнее профиль дома/в гостях',
      attack:'выше результативность',
      defense:'меньше пропускает',
      clean_sheets:'чаще сохраняет ворота сухими',
      expected_goals:'выше голевая оценка модели',
      table_rank:'выше позиция в таблице',
      h2h:'больше побед в очных матчах',
      absences:'меньше отмеченных потерь состава',
    };
    const advantages={home:[],away:[]};
    let homeEdges=0;
    let awayEdges=0;
    let even=0;
    for (const metric of metrics) {
      if (metric.edge==='home') {
        homeEdges+=1;
        if (advantages.home.length<4) {
          advantages.home.push(descriptions[metric.key] || metric.label);
        }
      } else if (metric.edge==='away') {
        awayEdges+=1;
        if (advantages.away.length<4) {
          advantages.away.push(descriptions[metric.key] || metric.label);
        }
      } else {
        even+=1;
      }
    }

    let balanceLabel='Баланс доступных метрик близкий';
    if (homeEdges>=awayEdges+2) {
      balanceLabel=`${homeLabel} впереди по большему числу доступных метрик`;
    } else if (awayEdges>=homeEdges+2) {
      balanceLabel=`${awayLabel} впереди по большему числу доступных метрик`;
    }

    const sources=[];
    if (recentFormUsable) sources.push('последние матчи');
    if (venueFormUsable) sources.push('дом/выезд');
    if (seasonStatsUsable) sources.push('сохранённая сезонная статистика');
    if (standingsUsable) sources.push('сохранённая таблица');
    if (h2hValid) sources.push('очные встречи');
    if (injuryDataUsable) sources.push('потери состава');

    return {
      metrics,
      advantages,
      score:{home:homeEdges,away:awayEdges,even},
      balanceLabel,
      dataReuse:{
        separateApiRequests:0,
        seasonStatsCached:seasonStatsUsable,
        standingsCached:standingsUsable,
        sources,
        note:'Вкладка сравнения сама не делает дополнительных запросов к API-Football: она собирается из данных текущего анализа и уже сохранённых данных.',
      },
    };
  }


  function probabilityVector(value) {
    const source=objectValue(value);
    if (!source) return null;
    const home=finiteRange(source.home,0,100);
    const draw=finiteRange(source.draw,0,100);
    const away=finiteRange(source.away,0,100);
    if (home === null || draw === null || away === null) return null;
    const total=home+draw+away;
    if (!Number.isFinite(total) || Math.abs(total-100)>2.5) return null;
    return {home,draw,away};
  }

  function safeMarketMovementNote(value) {
    try {
      return safeText(marketMovementNote(objectValue(value) || {}),360);
    } catch {
      return '';
    }
  }

  function safeRefereeProfile(value) {
    try {
      return objectValue(refereeProfile(value));
    } catch {
      return null;
    }
  }

  function safeQualityGate(input) {
    try {
      const gate=objectValue(analysisQualityGate(input));
      if (!gate) throw new Error('invalid quality gate');
      const reasons=rows(gate.reasons,20).filter(reason=>objectValue(reason));
      const requestedState=safeText(gate.state,40).toLowerCase();
      const state=['ready','caution','hold','blocked'].includes(requestedState)
        ? requestedState
        : 'blocked';
      const hasBlockingReason=reasons.some(
        reason=>reason?.level==='block' || reason?.level==='hold',
      );
      const stateAllowsSignal=state==='ready' || state==='caution';
      const allowSignal=gate.allowSignal === true && stateAllowsSignal && !hasBlockingReason;
      return {
        ...gate,
        allowSignal,
        state,
        reasons,
      };
    } catch {
      return {
        state:'blocked',
        allowSignal:false,
        label:'Анализ заблокирован',
        reasons:[{
          code:'quality_gate_unavailable',
          level:'block',
          text:'Проверка качества анализа недоступна; рабочий сигнал заблокирован.',
        }],
        metrics:{},
      };
    }
  }

  function buildAiInstructor({
    probabilities,
    goalModel,
    confidence,
    completeness,
    factors=[],
    risks=[],
    referee='',
    refereeData=null,
    refereeHistory=null,
    lineupImpact=null,
    marketMovement=null,
    providerReliability=null,
    minutesToKickoff=null,
  } = {}) {
    const safeProbabilities=probabilityVector(probabilities);
    const p=safeProbabilities || {home:0,draw:0,away:0};
    const confidenceData=objectValue(confidence) || {};
    const confidenceScore=finiteRange(confidenceData.score,0,100) ?? 0;

    const completenessData=objectValue(completeness) || {};
    const rawCompletenessMax=finiteRange(completenessData.max,1,100);
    const completenessMax=rawCompletenessMax ?? 10;
    const completenessScore=finiteRange(completenessData.score,0,completenessMax) ?? 0;

    const model=objectValue(goalModel);
    const modelQuality=finiteRange(model?.qualityScore,0,100);
    const over25=finiteRange(model?.over25,0,100);
    const btts=finiteRange(model?.btts,0,100);

    const candidates=[];
    if (safeProbabilities) {
      const homeDouble=p.home+p.draw;
      const awayDouble=p.away+p.draw;
      if (homeDouble>=74 && p.home>=p.away+7) {
        candidates.push({
          code:'double_home',
          label:'1X · хозяева не проиграют',
          strength:homeDouble,
          reason:'Суммарная модельная вероятность П1 или ничьей около '+Math.round(homeDouble)+'%.',
        });
      }
      if (awayDouble>=74 && p.away>=p.home+7) {
        candidates.push({
          code:'double_away',
          label:'X2 · гости не проиграют',
          strength:awayDouble,
          reason:'Суммарная модельная вероятность ничьей или П2 около '+Math.round(awayDouble)+'%.',
        });
      }
      if (p.home>=58 && p.home>=p.away+14) {
        candidates.push({
          code:'home',
          label:'П1',
          strength:p.home,
          reason:'Победа хозяев имеет наибольшую модельную вероятность — около '+Math.round(p.home)+'%.',
        });
      }
      if (p.away>=58 && p.away>=p.home+14) {
        candidates.push({
          code:'away',
          label:'П2',
          strength:p.away,
          reason:'Победа гостей имеет наибольшую модельную вероятность — около '+Math.round(p.away)+'%.',
        });
      }
    }
    if (modelQuality !== null && modelQuality>=65 && over25 !== null && over25>=64) {
      candidates.push({
        code:'over25',
        label:'ТБ 2.5',
        strength:over25,
        reason:'Голевая модель даёт около '+Math.round(over25)+'% на тотал больше 2.5.',
      });
    }
    if (modelQuality !== null && modelQuality>=65 && btts !== null && btts>=64) {
      candidates.push({
        code:'btts',
        label:'Обе забьют · да',
        strength:btts,
        reason:'Голевая модель даёт около '+Math.round(btts)+'% на голы обеих команд.',
      });
    }
    candidates.sort((a,b)=>b.strength-a.strength);

    let betSignal=candidates[0] || {
      code:'skip',
      label:'Пропустить ставку',
      strength:0,
      reason:safeProbabilities
        ? 'Нет достаточно выраженного перевеса по доступным сигналам.'
        : 'Расчётные вероятности не прошли проверку качества.',
    };

    if (!safeProbabilities) {
      betSignal={
        code:'skip',
        label:'Пропустить ставку',
        strength:0,
        reason:'Расчётные вероятности не прошли проверку качества.',
      };
    } else if (confidenceScore<56 || completenessScore<6) {
      betSignal={
        code:'skip',
        label:'Пропустить ставку',
        strength:0,
        reason:confidenceScore<56
          ? 'Уверенность модели ниже рабочего порога.'
          : 'Для уверенного сигнала недостаточно данных по матчу.',
      };
    }

    const riskLabel=confidenceScore>=74 && completenessScore>=8
      ? 'Умеренный'
      : confidenceScore>=60 && completenessScore>=6
        ? 'Повышенный'
        : 'Высокий';
    const confidenceLabel=confidenceScore>=74
      ? 'Высокая'
      : confidenceScore>=60
        ? 'Средняя'
        : 'Низкая';

    const baseDataTrustScore=Math.max(
      0,
      Math.min(100,Math.round((completenessScore/completenessMax)*100)),
    );
    const reliability=objectValue(providerReliability);
    const reliabilityCap=reliability
      ? (finiteRange(reliability.trustCap,0,100) ?? 0)
      : 100;
    const dataTrustScore=Math.min(baseDataTrustScore,reliabilityCap);

    if (dataTrustScore<60 && betSignal.code!=='skip') {
      betSignal={
        code:'skip',
        label:'Пропустить ставку',
        strength:0,
        reason:'Надёжность входных данных ниже рабочего порога.',
      };
    }

    const dataTrust={
      score:dataTrustScore,
      baseScore:baseDataTrustScore,
      reliabilityCap,
      label:dataTrustScore>=80
        ? 'Высокая полнота'
        : dataTrustScore>=60
          ? 'Рабочая полнота'
          : 'Ограниченные данные',
      note:safeText(reliability?.state,40)==='degraded'
        ? 'Часть данных источника недоступна или ограничена тарифом; неизвестные значения не подменяются нулями.'
        : dataTrustScore>=80
          ? 'Большинство ключевых блоков доступны.'
          : dataTrustScore>=60
            ? 'Для рабочего вывода хватает данных, но есть пробелы.'
            : 'Не хватает части ключевых данных — вывод нужно трактовать осторожно.',
    };

    const qualityGate=safeQualityGate({
      probabilities:safeProbabilities || probabilities,
      confidence:confidenceData,
      dataTrustScore,
      providerReliability:reliability,
      lineupImpact:objectValue(lineupImpact),
      minutesToKickoff:finiteRange(minutesToKickoff,-1440,10080),
    });
    if (!qualityGate.allowSignal && betSignal.code!=='skip') {
      const primaryReason=qualityGate.reasons.find(
        reason=>reason?.level==='block' || reason?.level==='hold',
      );
      betSignal={
        code:'skip',
        label:'Пропустить ставку',
        strength:0,
        reason:safeText(primaryReason?.text,280)
          || 'Качество входных данных не прошло рабочий gate.',
      };
    }

    const maxOutcome=safeProbabilities
      ? [['П1',p.home],['Н',p.draw],['П2',p.away]].sort((a,b)=>b[1]-a[1])[0]
      : null;
    const verdict={
      outcome:maxOutcome ? `${maxOutcome[0]} · ${Math.round(maxOutcome[1])}%` : 'Нет данных',
      total:over25 === null
        ? 'Нет данных'
        : over25>=55
          ? `ТБ 2.5 · ${Math.round(over25)}%`
          : over25<=45
            ? `ТМ 2.5 · ${Math.round(100-over25)}%`
            : 'Без перевеса',
      btts:btts === null
        ? 'Нет данных'
        : btts>=55
          ? `Да · ${Math.round(btts)}%`
          : btts<=45
            ? `Нет · ${Math.round(100-btts)}%`
            : 'Без перевеса',
    };

    const lineup=objectValue(lineupImpact);
    const history=objectValue(refereeHistory);
    const refereeName=safeText(referee,180);
    const movementNote=safeMarketMovementNote(marketMovement);
    const historyStyle=safeText(history?.styleLabel,120);
    const historyYellow=finiteRange(history?.avgYellow,0,30);
    const refereeCheck=history?.available === true
      ? historyStyle
        ? historyYellow !== null
          ? `Учесть судью: ${historyStyle}, среднее ${historyYellow} жёлтых карточки за матч.`
          : `Учесть судью: ${historyStyle}.`
        : 'Учесть подтверждённую историю назначенного судьи.'
      : refereeName
        ? 'Судья назначен; проверить, появились ли дополнительные данные по его стилю.'
        : 'Проверить назначение судьи ближе к стартовому свистку.';

    const planChecks=[
      safeText(lineup?.note,360)
        || 'Проверить стартовые составы и ключевые потери ближе к началу матча.',
      movementNote
        || 'Сверить движение коэффициентов и убедиться, что рынок не ушёл резко против сценария.',
      refereeCheck,
    ].filter(Boolean).slice(0,3);

    const riskRows=rows(risks,20)
      .map(value=>safeText(value,360))
      .filter(Boolean);
    const factorRows=rows(factors,20)
      .map(value=>safeText(value,360))
      .filter(Boolean);
    const firstRisk=riskRows[0] || '';

    const matchPlan={
      checks:planChecks,
      cancel:betSignal.code==='skip'
        ? 'Рабочего сигнала нет: не форсировать решение до появления новых данных.'
        : firstRisk || 'Если составы, рынок или доступность ключевых игроков меняют исходный баланс — пересчитать матч.',
      liveWatch:betSignal.code==='over25' || betSignal.code==='btts'
        ? 'В первые 15–20 минут смотреть на темп, удары из опасных зон и реальное давление обеих команд.'
        : 'После старта сверять территорию, опасные атаки и качество моментов с предматчевым сценарием.',
    };

    const profile=objectValue(refereeData) || safeRefereeProfile(refereeName);
    return {
      role:'football-ai-instructor',
      confidenceScore:Math.round(confidenceScore),
      confidenceLabel,
      riskLabel,
      betSignal,
      verdict,
      dataTrust,
      qualityGate,
      matchPlan,
      riskNote:betSignal.code==='skip'
        ? 'Сильного сигнала нет — не форсируйте решение.'
        : 'Проверяйте составы и изменения коэффициентов ближе к старту.',
      referee:refereeName,
      refereeProfile:profile,
      refereeHistory:history,
      refereeNote:refereeName
        ? 'Арбитр назначен; имя учитывается как контекст матча.'
        : 'Назначение судьи ещё не опубликовано источником данных.',
      lineupImpact:lineup,
      marketNote:movementNote,
      factors:factorRows.slice(0,4),
      risks:riskRows.slice(0,3),
    };
  }

  return Object.freeze({
    cachedTeamIntelligenceForAnalysis,
    hydratePlayerRolesForAnalysis,
    comparisonNumber,
    comparisonMetric,
    buildMatchComparison,
    buildAiInstructor,
  });
}
