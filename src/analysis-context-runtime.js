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
    if (!teamId || !leagueId || !season) return { stats: null, playerStats: null };
    const cached = await getStaleCache(`team:intelligence:${Number(teamId)}:${Number(leagueId)}:${Number(season)}:v2`, cfg);
    return {
      stats: cached?.stats?.available ? cached.stats : null,
      playerStats: cached?.playerStats?.available ? cached.playerStats : null,
    };
  }
  
  async function hydratePlayerRolesForAnalysis({
    teamId, teamName, leagueId, leagueName, season, cachedPlayerStats, needed, cfg, maxPages = 1,
  } = {}) {
    if (cachedPlayerStats?.available) return { playerStats:cachedPlayerStats, source:'team-intelligence-cache', network:false, stale:false, reason:'' };
    if (!needed || !teamId || !leagueId || !season) return { playerStats:null, source:'not-needed', network:false, stale:false, reason:'not_needed' };
    const cacheKey=`analysis:player-role:${Number(teamId)}:${Number(leagueId)}:${Number(season)}:v1`;
    const cached=await getCache(cacheKey,cfg).catch(()=>null);
    if (cached?.playerStats?.available) return { playerStats:cached.playerStats, source:'analysis-cache', network:false, stale:false, reason:'' };
    const stale=await getStaleCache(cacheKey,cfg).catch(()=>null);
    if (!freeQuotaHealthy(12,1)) return stale?.playerStats?.available
      ? { playerStats:stale.playerStats, source:'analysis-stale-cache', network:false, stale:true, reason:'quota_guard' }
      : { playerStats:null, source:'unavailable', network:false, stale:false, reason:'quota_guard' };
    try {
      const playerStats=await resolveTeamSeasonPlayers(teamId,teamName,leagueId,leagueName,season,cfg,{ maxPages:Math.max(1,Math.min(2,Number(maxPages || 1))) });
      if (playerStats?.available) {
        await setCache(cacheKey,teamId,{playerStats,refreshedAt:new Date().toISOString()},cfg,360).catch(()=>false);
        return { playerStats, source:'analysis-hydration', network:true, stale:false, reason:String(playerStats.reason || '') };
      }
      if (stale?.playerStats?.available) return { playerStats:stale.playerStats, source:'analysis-stale-cache', network:true, stale:true, reason:String(playerStats?.reason || 'provider_unavailable') };
      return { playerStats:null, source:'unavailable', network:true, stale:false, reason:String(playerStats?.reason || 'provider_unavailable') };
    } catch (error) {
      if (stale?.playerStats?.available) return { playerStats:stale.playerStats, source:'analysis-stale-cache', network:true, stale:true, reason:String(error?.code || 'provider_error') };
      return { playerStats:null, source:'unavailable', network:true, stale:false, reason:String(error?.code || 'provider_error') };
    }
  }
  
  function comparisonNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  
  function comparisonMetric({ key, label, homeValue, awayValue, format = 'number', better = 'higher', minGap = 0, note = '' }) {
    const home = comparisonNumber(homeValue);
    const away = comparisonNumber(awayValue);
    if (home === null || away === null) return null;
    const gap = Math.abs(home - away);
    let edge = 'even';
    if (gap > Number(minGap || 0)) {
      const homeBetter = better === 'lower' ? home < away : home > away;
      edge = homeBetter ? 'home' : 'away';
    }
    return { key, label, homeValue: home, awayValue: away, format, better, edge, note };
  }
  
  function buildMatchComparison({ homeName, awayName, homeForm, awayForm, homeStanding, awayStanding, homeSeasonStats, awaySeasonStats, goalModel, h2h, absences, hasInjuryData }) {
    const hOverall = homeForm?.overall || null;
    const aOverall = awayForm?.overall || null;
    const hVenue = homeForm?.venue || null;
    const aVenue = awayForm?.venue || null;
    const hSeason = homeSeasonStats?.derived || null;
    const aSeason = awaySeasonStats?.derived || null;
  
    const metrics = [
      comparisonMetric({ key:'form_ppg', label:'Форма · очки/матч', homeValue:hOverall?.ppg, awayValue:aOverall?.ppg, format:'decimal', minGap:.14, note:'Последние 5 завершённых матчей.' }),
      comparisonMetric({ key:'venue_ppg', label:'Дома / в гостях', homeValue:hVenue?.ppg, awayValue:aVenue?.ppg, format:'decimal', minGap:.14, note:'Хозяева дома против гостей на выезде.' }),
      comparisonMetric({ key:'attack', label:'Атака · гол/матч', homeValue:(hSeason && aSeason) ? hSeason.goalsForPerMatch : hOverall?.gfAvg, awayValue:(hSeason && aSeason) ? aSeason.goalsForPerMatch : aOverall?.gfAvg, format:'decimal', minGap:.14, note:(hSeason && aSeason) ? 'Сезонная статистика из уже загруженных сохранённых данных.' : 'Недавняя результативность.' }),
      comparisonMetric({ key:'defense', label:'Оборона · пропущено', homeValue:(hSeason && aSeason) ? hSeason.goalsAgainstPerMatch : hOverall?.gaAvg, awayValue:(hSeason && aSeason) ? aSeason.goalsAgainstPerMatch : aOverall?.gaAvg, format:'decimal', better:'lower', minGap:.14, note:'Меньше — лучше.' }),
      comparisonMetric({ key:'clean_sheets', label:'Сухие матчи', homeValue:(hSeason && aSeason) ? hSeason.cleanSheetRate : hOverall?.cleanSheetPct, awayValue:(hSeason && aSeason) ? aSeason.cleanSheetRate : aOverall?.cleanSheetPct, format:'percent', minGap:8, note:(hSeason && aSeason) ? 'Доля матчей сезона без пропущенных.' : 'Доля в последних матчах.' }),
      comparisonMetric({ key:'expected_goals', label:'Голевая оценка модели', homeValue:goalModel?.homeExpected, awayValue:goalModel?.awayExpected, format:'decimal', minGap:.14, note:'Модель Пуассона по доступной форме.' }),
      comparisonMetric({ key:'table_rank', label:'Место в таблице', homeValue:homeStanding?.rank, awayValue:awayStanding?.rank, format:'rank', better:'lower', minGap:0, note:'Показывается только если таблица турнира уже была загружена.' }),
      ((Number(h2h?.homeWins||0)+Number(h2h?.awayWins||0)+Number(h2h?.draws||0)) > 0) ? comparisonMetric({ key:'h2h', label:'Победы в очных встречах', homeValue:h2h?.homeWins, awayValue:h2h?.awayWins, format:'integer', minGap:0, note:'Последние доступные очные встречи.' }) : null,
      hasInjuryData ? comparisonMetric({ key:'absences', label:'Отмеченные потери', homeValue:absences?.home?.length || 0, awayValue:absences?.away?.length || 0, format:'integer', better:'lower', minGap:0, note:'Актуальные отметки источника после дедупликации и сверки с опубликованным составом.' }) : null,
    ].filter(Boolean);
  
    const descriptions = {
      form_ppg: 'лучше текущая форма', venue_ppg: 'сильнее профиль дома/в гостях', attack: 'выше результативность',
      defense: 'меньше пропускает', clean_sheets: 'чаще сохраняет ворота сухими', expected_goals: 'выше голевая оценка модели',
      table_rank: 'выше позиция в таблице', h2h: 'больше побед в очных матчах', absences: 'меньше отмеченных потерь состава',
    };
    const advantages = { home: [], away: [] };
    let homeEdges = 0, awayEdges = 0, even = 0;
    for (const metric of metrics) {
      if (metric.edge === 'home') { homeEdges += 1; if (advantages.home.length < 4) advantages.home.push(descriptions[metric.key] || metric.label); }
      else if (metric.edge === 'away') { awayEdges += 1; if (advantages.away.length < 4) advantages.away.push(descriptions[metric.key] || metric.label); }
      else even += 1;
    }
  
    let balanceLabel = 'Баланс доступных метрик близкий';
    if (homeEdges >= awayEdges + 2) balanceLabel = `${homeName} впереди по большему числу доступных метрик`;
    else if (awayEdges >= homeEdges + 2) balanceLabel = `${awayName} впереди по большему числу доступных метрик`;
  
    const sources = ['последние матчи', 'дом/выезд'];
    if (homeSeasonStats && awaySeasonStats) sources.push('сохранённая сезонная статистика');
    if (homeStanding && awayStanding) sources.push('сохранённая таблица');
    if ((Number(h2h?.homeWins||0)+Number(h2h?.awayWins||0)+Number(h2h?.draws||0)) > 0) sources.push('очные встречи');
    if (hasInjuryData) sources.push('потери состава');
  
    return {
      metrics,
      advantages,
      score: { home: homeEdges, away: awayEdges, even },
      balanceLabel,
      dataReuse: {
        separateApiRequests: 0,
        seasonStatsCached: Boolean(homeSeasonStats && awaySeasonStats),
        standingsCached: Boolean(homeStanding && awayStanding),
        sources,
        note: 'Вкладка сравнения сама не делает дополнительных запросов к API-Football: она собирается из данных текущего анализа и уже сохранённых данных.',
      },
    };
  }
  
  
  function buildAiInstructor({ probabilities, goalModel, confidence, completeness, factors = [], risks = [], referee = '', refereeData = null, refereeHistory = null, lineupImpact = null, marketMovement = null, providerReliability = null, minutesToKickoff = null } = {}) {
    const p = { home: Number(probabilities?.home || 0), draw: Number(probabilities?.draw || 0), away: Number(probabilities?.away || 0) };
    const confidenceScore = Math.max(0, Math.min(100, Number(confidence?.score || 0)));
    const completenessScore = Number(completeness?.score || 0);
    const candidates = [];
    const homeDouble = p.home + p.draw;
    const awayDouble = p.away + p.draw;
    if (homeDouble >= 74 && p.home >= p.away + 7) candidates.push({ code:'double_home', label:'1X · хозяева не проиграют', strength:homeDouble, reason:'Суммарная модельная вероятность П1 или ничьей около ' + Math.round(homeDouble) + '%.' });
    if (awayDouble >= 74 && p.away >= p.home + 7) candidates.push({ code:'double_away', label:'X2 · гости не проиграют', strength:awayDouble, reason:'Суммарная модельная вероятность ничьей или П2 около ' + Math.round(awayDouble) + '%.' });
    if (Number(goalModel?.qualityScore || 0) >= 65 && Number(goalModel?.over25 || 0) >= 64) candidates.push({ code:'over25', label:'ТБ 2.5', strength:Number(goalModel.over25), reason:'Голевая модель даёт около ' + Math.round(Number(goalModel.over25)) + '% на тотал больше 2.5.' });
    if (Number(goalModel?.qualityScore || 0) >= 65 && Number(goalModel?.btts || 0) >= 64) candidates.push({ code:'btts', label:'Обе забьют · да', strength:Number(goalModel.btts), reason:'Голевая модель даёт около ' + Math.round(Number(goalModel.btts)) + '% на голы обеих команд.' });
    if (p.home >= 58 && p.home >= p.away + 14) candidates.push({ code:'home', label:'П1', strength:p.home, reason:'Победа хозяев имеет наибольшую модельную вероятность — около ' + Math.round(p.home) + '%.' });
    if (p.away >= 58 && p.away >= p.home + 14) candidates.push({ code:'away', label:'П2', strength:p.away, reason:'Победа гостей имеет наибольшую модельную вероятность — около ' + Math.round(p.away) + '%.' });
    candidates.sort((a,b) => b.strength - a.strength);
    let betSignal = candidates[0] || { code:'skip', label:'Пропустить ставку', strength:0, reason:'Нет достаточно выраженного перевеса по доступным сигналам.' };
    if (confidenceScore < 56 || completenessScore < 6) betSignal = { code:'skip', label:'Пропустить ставку', strength:0, reason: confidenceScore < 56 ? 'Уверенность модели ниже рабочего порога.' : 'Для уверенного сигнала недостаточно данных по матчу.' };
    const riskLabel = confidenceScore >= 74 && completenessScore >= 8 ? 'Умеренный' : confidenceScore >= 60 && completenessScore >= 6 ? 'Повышенный' : 'Высокий';
    const confidenceLabel = confidenceScore >= 74 ? 'Высокая' : confidenceScore >= 60 ? 'Средняя' : 'Низкая';
    const completenessMax = Math.max(1, Number(completeness?.max || 10));
    const baseDataTrustScore = Math.max(0, Math.min(100, Math.round((completenessScore / completenessMax) * 100)));
    const reliabilityCap = Math.max(0, Math.min(100, Number(providerReliability?.trustCap ?? 100)));
    const dataTrustScore = Math.min(baseDataTrustScore, reliabilityCap);
    if (dataTrustScore < 60 && betSignal.code !== 'skip') {
      betSignal = { code:'skip', label:'Пропустить ставку', strength:0, reason:'Надёжность входных данных ниже рабочего порога.' };
    }
    const dataTrust = {
      score:dataTrustScore,
      baseScore:baseDataTrustScore,
      reliabilityCap,
      label:dataTrustScore >= 80 ? 'Высокая полнота' : dataTrustScore >= 60 ? 'Рабочая полнота' : 'Ограниченные данные',
      note:providerReliability?.state === 'degraded'
        ? 'Часть данных источника недоступна или ограничена тарифом; неизвестные значения не подменяются нулями.'
        : dataTrustScore >= 80 ? 'Большинство ключевых блоков доступны.' : dataTrustScore >= 60 ? 'Для рабочего вывода хватает данных, но есть пробелы.' : 'Не хватает части ключевых данных — вывод нужно трактовать осторожно.',
    };
    const qualityGate = analysisQualityGate({
      probabilities,
      confidence,
      dataTrustScore,
      providerReliability,
      lineupImpact,
      minutesToKickoff,
    });
    if (!qualityGate.allowSignal && betSignal.code !== 'skip') {
      const primaryReason = qualityGate.reasons.find(x => x.level === 'block' || x.level === 'hold');
      betSignal = {
        code:'skip',
        label:'Пропустить ставку',
        strength:0,
        reason:primaryReason?.text || 'Качество входных данных не прошло рабочий gate.',
      };
    }
    const maxOutcome = [['П1',p.home],['Н',p.draw],['П2',p.away]].sort((a,b)=>b[1]-a[1])[0];
    const over25 = Number(goalModel?.over25 || 0);
    const btts = Number(goalModel?.btts || 0);
    const verdict = {
      outcome: maxOutcome ? `${maxOutcome[0]} · ${Math.round(maxOutcome[1])}%` : '—',
      total: !goalModel ? 'Нет данных' : over25 >= 55 ? `ТБ 2.5 · ${Math.round(over25)}%` : over25 <= 45 ? `ТМ 2.5 · ${Math.round(100-over25)}%` : 'Без перевеса',
      btts: !goalModel ? 'Нет данных' : btts >= 55 ? `Да · ${Math.round(btts)}%` : btts <= 45 ? `Нет · ${Math.round(100-btts)}%` : 'Без перевеса',
    };
    const planChecks = [
      lineupImpact?.note ? String(lineupImpact.note) : 'Проверить стартовые составы и ключевые потери ближе к началу матча.',
      marketMovementNote(marketMovement || {}) || 'Сверить движение коэффициентов и убедиться, что рынок не ушёл резко против сценария.',
      refereeHistory?.available ? `Учесть судью: ${refereeHistory.styleLabel}, среднее ${refereeHistory.avgYellow} жёлтых карточки за матч.` : referee ? 'Судья назначен; проверить, появились ли дополнительные данные по его стилю.' : 'Проверить назначение судьи ближе к стартовому свистку.',
    ].filter(Boolean).slice(0,3);
    const firstRisk = String((risks || []).find(Boolean) || '').trim();
    const matchPlan = {
      checks:planChecks,
      cancel:betSignal.code === 'skip'
        ? 'Рабочего сигнала нет: не форсировать решение до появления новых данных.'
        : firstRisk || 'Если составы, рынок или доступность ключевых игроков меняют исходный баланс — пересчитать матч.',
      liveWatch:betSignal.code === 'over25' || betSignal.code === 'btts'
        ? 'В первые 15–20 минут смотреть на темп, удары из опасных зон и реальное давление обеих команд.'
        : 'После старта сверять территорию, опасные атаки и качество моментов с предматчевым сценарием.',
    };
    return {
      role:'football-ai-instructor', confidenceScore:Math.round(confidenceScore), confidenceLabel, riskLabel, betSignal, verdict, dataTrust, qualityGate, matchPlan,
      riskNote: betSignal.code === 'skip' ? 'Сильного сигнала нет — не форсируйте решение.' : 'Проверяйте составы и изменения коэффициентов ближе к старту.',
      referee:String(referee || ''), refereeProfile:refereeData || refereeProfile(referee), refereeHistory:refereeHistory || null,
      refereeNote: referee ? 'Арбитр назначен; имя учитывается как контекст матча.' : 'Назначение судьи ещё не опубликовано источником данных.',
      lineupImpact:lineupImpact || null,
      marketNote:marketMovementNote(marketMovement || {}),
      factors:(factors || []).slice(0,4), risks:(risks || []).slice(0,3),
    };
  }

  return {
    cachedTeamIntelligenceForAnalysis,
    hydratePlayerRolesForAnalysis,
    comparisonNumber,
    comparisonMetric,
    buildMatchComparison,
    buildAiInstructor,
  };
}
