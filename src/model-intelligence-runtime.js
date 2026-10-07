// Football model and pre-match intelligence helpers extracted from worker.js.
// Provider/cache primitives remain injected by the composition root.
export function createModelIntelligenceRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Model intelligence runtime dependencies are required.');
  }
  const {
    MODEL_BASE_WEIGHTS,
    apiFootball,
    getCache,
    isFinishedStatus,
    normalizeThree,
    parsePercent,
    round1,
    setCache,
    todayUtc,
  } = deps;

  const requiredFunctions={
    apiFootball,
    getCache,
    isFinishedStatus,
    normalizeThree,
    parsePercent,
    round1,
    setCache,
    todayUtc,
  };
  for (const [name,fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

  const MODEL_SIGNAL_NAMES=Object.freeze(['market','apiPrediction','recentForm','seasonStrength','h2h']);
  const LEGACY_REQUIRED_SIGNAL_NAMES=Object.freeze(['market','apiPrediction','recentForm','h2h']);
  if (!MODEL_BASE_WEIGHTS || typeof MODEL_BASE_WEIGHTS !== 'object' || Array.isArray(MODEL_BASE_WEIGHTS)) {
    throw new TypeError('MODEL_BASE_WEIGHTS is required');
  }
  const baseWeightValues={};
  let baseWeightTotal=0;
  for (const name of MODEL_SIGNAL_NAMES) {
    const raw=MODEL_BASE_WEIGHTS[name];
    if (name==='seasonStrength' && (raw===undefined || raw===null || raw==='')) {
      baseWeightValues[name]=0;
      continue;
    }
    const weight=Number(raw);
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new TypeError(`MODEL_BASE_WEIGHTS.${name} must be positive`);
    }
    baseWeightValues[name]=weight;
    baseWeightTotal+=weight;
  }
  for (const name of LEGACY_REQUIRED_SIGNAL_NAMES) {
    if (!(baseWeightValues[name]>0)) {
      throw new TypeError(`MODEL_BASE_WEIGHTS.${name} must be positive`);
    }
  }
  const baseWeights=Object.freeze(Object.fromEntries(
    MODEL_SIGNAL_NAMES.map(name=>[name,baseWeightTotal>0 ? baseWeightValues[name]/baseWeightTotal : 0]),
  ));

  function positiveSafeInteger(value) {
    if (value === null || value === undefined || value === '') return null;
    const number=Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function nonNegativeSafeInteger(value) {
    if (value === null || value === undefined || value === '') return null;
    const number=Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number=Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function finiteRange(value,min,max) {
    const number=finiteNumber(value);
    return number !== null && number >= min && number <= max ? number : null;
  }

  function strictUtcDate(value) {
    const raw=String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
    const timestamp=Date.parse(`${raw}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp)) return '';
    try {
      return new Date(timestamp).toISOString().slice(0,10) === raw ? raw : '';
    } catch {
      return '';
    }
  }

  function probabilityObject(value,{requirePercentTotal=true}={}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const home=finiteRange(value.home,0,100);
    const draw=finiteRange(value.draw,0,100);
    const away=finiteRange(value.away,0,100);
    if (home === null || draw === null || away === null) return null;
    const total=home+draw+away;
    if (!(total > 0)) return null;
    if (requirePercentTotal && (total < 95 || total > 105)) return null;
    const normalized=normalizeThree(home,draw,away);
    if (!normalized || typeof normalized !== 'object') return null;
    const result={
      home:finiteRange(normalized.home,0,100),
      draw:finiteRange(normalized.draw,0,100),
      away:finiteRange(normalized.away,0,100),
    };
    return Object.values(result).every(x=>x !== null) ? result : null;
  }

  function percentValue(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const parsed=parsePercent(value);
    return finiteRange(parsed,0,100);
  }

  function providerRows(value,label='fixtures') {
    if (Array.isArray(value)) return value;
    const error=new Error(`API-Football returned an invalid ${label} payload.`);
    error.code='FOOTBALL_INVALID_RESPONSE';
    throw error;
  }

  function formSample(value) {
    const sample=positiveSafeInteger(value?.sample);
    const ppg=finiteRange(value?.ppg,0,3);
    const gfAvg=finiteRange(value?.gfAvg,0,20);
    const gaAvg=finiteRange(value?.gaAvg,0,20);
    const gdAvg=finiteRange(value?.gdAvg,-20,20);
    if (!sample || ppg === null || gfAvg === null || gaAvg === null || gdAvg === null) return null;
    return {sample,ppg,gfAvg,gaAvg,gdAvg};
  }

  function cachedFormSummary(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.overall !== null && value.overall !== undefined && !formSample(value.overall)) return null;
    if (value.venue !== null && value.venue !== undefined && !formSample(value.venue)) return null;
    const preferredVenue=['home','away'].includes(value.preferredVenue) ? value.preferredVenue : '';
    return {...value,preferredVenue};
  }

  function extractPrediction(rows) {
    if (!Array.isArray(rows)) return null;
    const p=rows[0]?.predictions;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const home=percentValue(p.percent?.home);
    const draw=percentValue(p.percent?.draw);
    const away=percentValue(p.percent?.away);
    const probabilities=home !== null && draw !== null && away !== null
      ? probabilityObject({home,draw,away})
      : null;
    return {
      probabilities,
      winner:String(p.winner?.name || '').slice(0,160),
      winnerComment:String(p.winner?.comment || '').slice(0,500),
      advice:String(p.advice || '').slice(0,500),
      underOver:String(p.under_over || '').slice(0,80),
      goals:p.goals && typeof p.goals === 'object' && !Array.isArray(p.goals) ? p.goals : null,
    };
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value)));
  }
  
  function ymd(value) {
    const d=new Date(value);
    if (Number.isFinite(d.getTime())) return d.toISOString().slice(0,10);
    return strictUtcDate(todayUtc()) || new Date().toISOString().slice(0,10);
  }
  
  function teamResult(fixture, teamId) {
    const id=positiveSafeInteger(teamId);
    const homeId=positiveSafeInteger(fixture?.teams?.home?.id);
    const awayId=positiveSafeInteger(fixture?.teams?.away?.id);
    if (!id || !homeId || !awayId) return null;
    const isHome=homeId===id;
    const isAway=awayId===id;
    if (!isHome && !isAway) return null;
    const hg=finiteRange(fixture?.goals?.home,0,30);
    const ag=finiteRange(fixture?.goals?.away,0,30);
    const date=String(fixture?.fixture?.date || '');
    if (hg === null || ag === null || !Number.isFinite(Date.parse(date))) return null;
    const gf=isHome ? hg : ag;
    const ga=isHome ? ag : hg;
    return {
      date,
      venue:isHome ? 'home' : 'away',
      opponent:String(isHome ? fixture?.teams?.away?.name || '' : fixture?.teams?.home?.name || '').slice(0,160),
      opponentLogo:String(isHome ? fixture?.teams?.away?.logo || '' : fixture?.teams?.home?.logo || '').slice(0,1000),
      league:String(fixture?.league?.name || '').slice(0,160),
      gf,
      ga,
      result:gf > ga ? 'W' : gf < ga ? 'L' : 'D',
    };
  }
  
  function summarizeFormRows(rows, teamId, preferredVenue) {
    const id=positiveSafeInteger(teamId);
    const venueKey=['home','away'].includes(preferredVenue) ? preferredVenue : '';
    const all = (Array.isArray(rows) ? rows : [])
      .map(x => teamResult(x, id))
      .filter(Boolean)
      .sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0));
    const last = all.slice(0, 5);
    const venue = venueKey ? all.filter(x => x.venue === venueKey).slice(0,3) : [];
    const summarize = list => {
      if (!list.length) return null;
      const wins = list.filter(x => x.result === 'W').length;
      const draws = list.filter(x => x.result === 'D').length;
      const losses = list.filter(x => x.result === 'L').length;
      const gf = list.reduce((s, x) => s + x.gf, 0);
      const ga = list.reduce((s, x) => s + x.ga, 0);
      return {
        sample: list.length,
        wins, draws, losses,
        ppg: round1((wins * 3 + draws) / list.length),
        gfAvg: round1(gf / list.length),
        gaAvg: round1(ga / list.length),
        gdAvg: round1((gf - ga) / list.length),
        bttsPct: round1(list.filter(x => x.gf > 0 && x.ga > 0).length / list.length * 100),
        over25Pct: round1(list.filter(x => x.gf + x.ga >= 3).length / list.length * 100),
        cleanSheetPct: round1(list.filter(x => x.ga === 0).length / list.length * 100),
        form: list.map(x => x.result).join(''),
        matches: list,
      };
    };
    return { overall:summarize(last), venue:summarize(venue), preferredVenue:venueKey };
  }
  
  async function getRecentTeamForm(teamId, preferredVenue, fixtureDate, fixtureId, cfg, { allowNetwork = true } = {}) {
    const id=positiveSafeInteger(teamId);
    if (!id) return null;
    const fixtureIdentity=positiveSafeInteger(fixtureId);
    const venueKey=['home','away'].includes(preferredVenue) ? preferredVenue : '';
    const parsedTarget=Date.parse(String(fixtureDate || ''));
    const targetMs=Number.isFinite(parsedTarget) ? parsedTarget : Date.now();
    const to=ymd(new Date(targetMs-60_000));
    const cacheKey=`teamform:${id}:${venueKey || 'all'}:${to}:v2`;
    const cached=cachedFormSummary(await getCache(cacheKey,cfg).catch(()=>null));
    if (cached) return cached;
    if (allowNetwork === false) return null;
    const rows=providerRows(await apiFootball('/fixtures',{team:id,last:20},cfg),'recent-team-form');
    const usable=rows.filter(x=>{
      const rowId=positiveSafeInteger(x?.fixture?.id);
      const dateMs=Date.parse(x?.fixture?.date || '');
      return rowId
        && (!fixtureIdentity || rowId !== fixtureIdentity)
        && isFinishedStatus(x?.fixture?.status?.short)
        && Number.isFinite(dateMs)
        && dateMs < targetMs;
    });
    const summary=summarizeFormRows(usable,id,venueKey);
    await setCache(cacheKey,fixtureIdentity || id,summary,cfg,120).catch(()=>null);
    return summary;
  }
  
  function formProbabilities(homeForm, awayForm) {
    const h=formSample(homeForm?.overall);
    const a=formSample(awayForm?.overall);
    if (!h || !a) return null;
    const hvSample=formSample(homeForm?.venue);
    const avSample=formSample(awayForm?.venue);
    const hv=hvSample?.sample >= 2 ? hvSample.ppg : h.ppg;
    const av=avSample?.sample >= 2 ? avSample.ppg : a.ppg;
    let edge=4;
    edge+=clamp((h.ppg-a.ppg)*8,-18,18);
    edge+=clamp((h.gdAvg-a.gdAvg)*2.6,-10,10);
    edge+=clamp((hv-av)*3.5,-8,8);
    if (!Number.isFinite(edge)) return null;
    edge=clamp(edge,-24,24);
    const draw=clamp(28.5-Math.abs(edge)*0.24,20,29);
    const remaining=100-draw;
    const homeShare=1/(1+Math.exp(-edge/8.5));
    return probabilityObject(normalizeThree(remaining*homeShare,draw,remaining*(1-homeShare)));
  }
  
  function h2hCounts(h2h) {
    const values=[h2h?.homeWins,h2h?.draws,h2h?.awayWins].map(value=>
      value === null || value === undefined || value === '' ? 0 : nonNegativeSafeInteger(value)
    );
    if (values.some(value=>value === null)) return null;
    const [homeWins,draws,awayWins]=values;
    return {homeWins,draws,awayWins,total:homeWins+draws+awayWins};
  }

  function h2hProbabilities(h2h) {
    const counts=h2hCounts(h2h);
    if (!counts || counts.total <= 0) return null;
    return probabilityObject(normalizeThree(
      counts.homeWins+1,
      counts.draws+1,
      counts.awayWins+1,
    ));
  }

  function seasonStrengthProbabilities(
    homeStanding,
    awayStanding,
    homeSeasonStats,
    awaySeasonStats,
  ) {
    const h=homeSeasonStats?.derived;
    const a=awaySeasonStats?.derived;
    const components=[];
    const add=(value,weight)=>{
      if (!Number.isFinite(value) || !Number.isFinite(weight) || weight<=0) return;
      components.push({value,weight});
    };

    const homeVenuePpg=finiteRange(h?.homePpg,0,3);
    const awayVenuePpg=finiteRange(a?.awayPpg,0,3);
    if (homeVenuePpg !== null && awayVenuePpg !== null) {
      add(clamp((homeVenuePpg-awayVenuePpg)*4.5,-9,9),1);
    }

    const homeAttack=finiteRange(h?.goalsForPerMatch,0,10);
    const awayAttack=finiteRange(a?.goalsForPerMatch,0,10);
    if (homeAttack !== null && awayAttack !== null) {
      add(clamp((homeAttack-awayAttack)*7,-10,10),1);
    }

    const homeDefense=finiteRange(h?.goalsAgainstPerMatch,0,10);
    const awayDefense=finiteRange(a?.goalsAgainstPerMatch,0,10);
    if (homeDefense !== null && awayDefense !== null) {
      add(clamp((awayDefense-homeDefense)*6.5,-10,10),1);
    }

    const homeClean=finiteRange(h?.cleanSheetRate,0,100);
    const awayClean=finiteRange(a?.cleanSheetRate,0,100);
    if (homeClean !== null && awayClean !== null) {
      add(clamp((homeClean-awayClean)*0.14,-8,8),0.6);
    }

    const homeRank=positiveSafeInteger(homeStanding?.rank);
    const awayRank=positiveSafeInteger(awayStanding?.rank);
    if (homeRank && awayRank && homeRank<=1000 && awayRank<=1000) {
      add(clamp((awayRank-homeRank)*0.55,-12,12),0.8);
    }

    if (components.length<2) return null;
    const weightSum=components.reduce((sum,row)=>sum+row.weight,0);
    if (!(weightSum>0)) return null;
    const structuralEdge=components.reduce(
      (sum,row)=>sum+row.value*row.weight,
      0,
    )/weightSum;
    const edge=clamp(1.8+structuralEdge*1.15,-18,18);
    const draw=clamp(28.5-Math.abs(edge)*0.24,21.5,29);
    const remaining=100-draw;
    const homeShare=1/(1+Math.exp(-edge/7.8));
    return probabilityObject(normalizeThree(
      remaining*homeShare,
      draw,
      remaining*(1-homeShare),
    ));
  }
  
  function blendProbabilitySignals({ market, model, form, seasonStrength, h2h, weightOverrides = null } = {}) {
    const configured=weightOverrides && typeof weightOverrides === 'object' && !Array.isArray(weightOverrides)
      ? weightOverrides
      : {};
    const signalRows=[
      ['market',market?.probabilities],
      ['apiPrediction',model?.probabilities],
      ['recentForm',form],
      ['seasonStrength',seasonStrength],
      ['h2h',h2h],
    ];
    const candidates=[];
    for (const [name,input] of signalRows) {
      const probabilities=probabilityObject(input);
      if (!probabilities) continue;
      const hasOverride=Object.prototype.hasOwnProperty.call(configured,name);
      const override=hasOverride ? finiteRange(configured[name],0,1) : null;
      const rawWeight=hasOverride && override !== null ? override : baseWeights[name];
      if (!(rawWeight > 0)) continue;
      candidates.push([name,probabilities,rawWeight]);
    }
    if (!candidates.length) return {probabilities:null,weights:{},signals:[]};
    const weightSum=candidates.reduce((sum,row)=>sum+row[2],0);
    if (!(weightSum > 0) || !Number.isFinite(weightSum)) return {probabilities:null,weights:{},signals:[]};
    const weights={};
    let home=0,draw=0,away=0;
    const signals=[];
    for (const [name,p,rawWeight] of candidates) {
      const weight=rawWeight/weightSum;
      const percentWeight=round1(weight*100);
      weights[name]=percentWeight;
      home+=p.home*weight;
      draw+=p.draw*weight;
      away+=p.away*weight;
      signals.push({name,probabilities:p,weight:percentWeight});
    }
    return {probabilities:probabilityObject(normalizeThree(home,draw,away)),weights,signals};
  }
  
  function absenceAdjustmentUnits(rows = []) {
    return (Array.isArray(rows) ? rows : []).reduce((sum, row) => {
      const roleWeightRaw = Number(row?.seasonRole?.weight);
      const roleWeight = Number.isFinite(roleWeightRaw) ? clamp(roleWeightRaw, 0.85, 1.60) : 1;
      const statusWeight = row?.status === 'doubtful' ? 0.5 : 1;
      return sum + roleWeight * statusWeight;
    }, 0);
  }
  
  function applyAbsenceAdjustment(probabilities, absences) {
    const input=probabilityObject(probabilities);
    if (!input) return null;
    const homeCount=Math.min(6,absenceAdjustmentUnits(absences?.home));
    const awayCount=Math.min(6,absenceAdjustmentUnits(absences?.away));
    const shift=clamp((awayCount-homeCount)*0.55,-3.3,3.3);
    return probabilityObject(normalizeThree(
      Math.max(0,input.home+shift),
      input.draw,
      Math.max(0,input.away-shift),
    ));
  }
  
  function playerNameKey(value) {
    const raw=typeof value==='string' ? value : '';
    if (!raw) return '';
    return raw
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g,'')
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/giu,' ')
      .replace(/\s+/g,' ')
      .trim()
      .slice(0,160);
  }

  function playerSeasonStrength(player = {}) {
    const appearances=finiteRange(player?.games?.appearances,0,100) ?? 0;
    const starts=finiteRange(player?.games?.lineups,0,100) ?? 0;
    const minutes=finiteRange(player?.games?.minutes,0,10000) ?? 0;
    const rating=finiteRange(player?.games?.rating,0,10);
    const goals=finiteRange(player?.goals?.total,0,100) ?? 0;
    const assists=finiteRange(player?.goals?.assists,0,100) ?? 0;
    if (!(appearances>0 || starts>0 || minutes>0 || rating !== null || goals>0 || assists>0)) {
      return null;
    }

    const starterRate=appearances>0 ? clamp(starts/appearances,0,1) : 0;
    const minutesPerAppearance=appearances>0 ? clamp(minutes/appearances,0,90) : 0;
    const minutesRate=minutesPerAppearance/90;
    const sampleStrength=clamp(appearances/12,0,1);
    const ratingImpact=rating === null
      ? 0
      : clamp((rating-6.5)*0.16,-0.16,0.24);

    const position=String(player?.games?.position || '').trim().toLowerCase();
    const attackMultiplier=/goalkeeper|keeper|\bgk\b/.test(position)
      ? 0.10
      : /defender|\bdef\b/.test(position)
        ? 0.35
        : /midfielder|\bmid\b/.test(position)
          ? 0.72
          : 1;
    const contributionRate=appearances>0
      ? clamp((goals+assists*0.7)/appearances,0,0.9)
      : 0;

    const defensiveActions=(
      (finiteRange(player?.tackles?.total,0,2000) ?? 0)
      +(finiteRange(player?.tackles?.blocks,0,1000) ?? 0)
      +(finiteRange(player?.tackles?.interceptions,0,1000) ?? 0)
    );
    const defensiveRate=appearances>0
      ? clamp(defensiveActions/appearances,0,8)/8
      : 0;
    const saves=finiteRange(player?.goals?.saves,0,2000) ?? 0;
    const saveRate=appearances>0 ? clamp(saves/appearances,0,6)/6 : 0;

    const raw=
      0.84
      +starterRate*0.18
      +minutesRate*0.16
      +ratingImpact
      +contributionRate*attackMultiplier*0.22
      +(/defender|midfielder|\bdef\b|\bmid\b/.test(position) ? defensiveRate*0.06 : 0)
      +(/goalkeeper|keeper|\bgk\b/.test(position) ? saveRate*0.08 : 0);
    return round1(clamp(
      1+(raw-1)*(0.45+sampleStrength*0.55),
      0.78,
      1.48,
    ));
  }

  function lineupPlayerStatsIndex(playerStats = null) {
    const stats=playerStats && typeof playerStats==='object' && !Array.isArray(playerStats)
      ? playerStats
      : null;
    const players=Array.isArray(stats?.players) ? stats.players : [];
    if (stats?.available !== true || stats?.scope !== 'team-season' || players.length<11) {
      return null;
    }

    const ids=new Map();
    const names=new Map();
    const nameCounts=new Map();
    for (const player of players) {
      const id=positiveSafeInteger(player?.providerId) || positiveSafeInteger(player?.id);
      if (id) ids.set(id,player);
      const name=playerNameKey(player?.name);
      if (!name) continue;
      nameCounts.set(name,(nameCounts.get(name) || 0)+1);
      if (!names.has(name)) names.set(name,player);
    }
    for (const [name,count] of nameCounts) {
      if (count>1) names.delete(name);
    }
    return {stats,players,ids,names};
  }

  function expectedLineupPoolScore(players = []) {
    const ranked=(Array.isArray(players) ? players : [])
      .map(player=>{
        const strength=playerSeasonStrength(player);
        const appearances=finiteRange(player?.games?.appearances,0,100) ?? 0;
        const starts=finiteRange(player?.games?.lineups,0,100) ?? 0;
        const minutes=finiteRange(player?.games?.minutes,0,10000) ?? 0;
        if (strength === null) return null;
        const starterRate=appearances>0 ? clamp(starts/appearances,0,1) : 0;
        const minutesRate=appearances>0 ? clamp(minutes/appearances,0,90)/90 : 0;
        const rolePriority=starterRate*0.52+minutesRate*0.33+strength*0.15;
        return {strength,rolePriority};
      })
      .filter(Boolean)
      .sort((a,b)=>b.rolePriority-a.rolePriority)
      .slice(0,11);
    if (ranked.length<11) return null;
    return ranked.reduce((sum,row)=>sum+row.strength,0)/ranked.length;
  }

  function lineupSideStrength(lineup = null, playerStats = null) {
    const starters=Array.isArray(lineup?.startXI) ? lineup.startXI.slice(0,11) : [];
    if (lineup?.quality?.confirmed !== true || starters.length!==11) return null;
    const index=lineupPlayerStatsIndex(playerStats);
    if (!index) return null;
    const expected=expectedLineupPoolScore(index.players);
    if (!Number.isFinite(expected) || expected<=0) return null;

    const matched=[];
    for (const starter of starters) {
      const id=positiveSafeInteger(starter?.id);
      const name=playerNameKey(starter?.name);
      const player=(id && index.ids.get(id)) || (name && index.names.get(name)) || null;
      const strength=player ? playerSeasonStrength(player) : null;
      if (strength !== null) matched.push({strength,player});
    }
    const coverage=matched.length/11;
    if (matched.length<9) return {
      available:false,
      matched:matched.length,
      total:11,
      coverage:round1(coverage*100),
      reason:'starter_stats_coverage',
    };

    const actual=matched.reduce((sum,row)=>sum+row.strength,0)/matched.length;
    const rotationPenaltyPct=clamp((1-actual/expected)*100,0,18);
    const poolSize=index.players.length;
    const sourceConfidence=playerStats?.complete === true
      ? 1
      : poolSize>=20
        ? 0.78
        : poolSize>=16
          ? 0.62
          : 0.5;
    const confidence=clamp(coverage*sourceConfidence,0,1);
    return {
      available:true,
      matched:matched.length,
      total:11,
      coverage:round1(coverage*100),
      actualScore:round1(actual*100),
      expectedScore:round1(expected*100),
      rotationPenaltyPct:round1(rotationPenaltyPct),
      poolSize,
      complete:playerStats?.complete === true,
      confidence:round1(confidence*100),
      source:String(playerStats?.sourceMeta?.provider || 'unknown').slice(0,80),
    };
  }

  function buildStartingXiStrength({lineups,homePlayerStats,awayPlayerStats}={}) {
    const home=lineupSideStrength(lineups?.home,homePlayerStats);
    const away=lineupSideStrength(lineups?.away,awayPlayerStats);
    if (!home?.available || !away?.available) {
      return {
        available:false,
        trusted:false,
        home:home || null,
        away:away || null,
        probabilityShift:0,
        reason:'lineup_or_player_stats_incomplete',
      };
    }
    const confidence=Math.min(
      finiteRange(home.confidence,0,100) ?? 0,
      finiteRange(away.confidence,0,100) ?? 0,
    );
    const trusted=confidence>=68;
    const penaltyEdge=clamp(
      Number(away.rotationPenaltyPct || 0)-Number(home.rotationPenaltyPct || 0),
      -18,
      18,
    );
    const shift=trusted
      ? clamp(penaltyEdge*0.18*(confidence/100),-2.8,2.8)
      : 0;
    return {
      available:true,
      trusted,
      home,
      away,
      confidence:round1(confidence),
      penaltyEdge:round1(penaltyEdge),
      probabilityShift:round1(shift),
      reason:trusted ? '' : 'player_stats_confidence',
    };
  }

  function applyLineupStrengthAdjustment(probabilities, lineupStrength = null) {
    const input=probabilityObject(probabilities);
    if (!input) return null;
    const shift=lineupStrength?.trusted === true
      ? finiteRange(lineupStrength?.probabilityShift,-2.8,2.8)
      : 0;
    if (shift === null || Math.abs(shift)<0.05) return input;
    return probabilityObject(normalizeThree(
      Math.max(0,input.home+shift),
      input.draw,
      Math.max(0,input.away-shift),
    ));
  }

  function poissonGoalModel(homeForm, awayForm) {
    const h=formSample(homeForm?.overall);
    const a=formSample(awayForm?.overall);
    if (!h || !a || h.sample < 3 || a.sample < 3) return null;
    const homeVenue=formSample(homeForm?.venue);
    const awayVenue=formSample(awayForm?.venue);
    const hv=homeVenue?.sample >= 2 ? homeVenue : h;
    const av=awayVenue?.sample >= 2 ? awayVenue : a;
    const homeLambda=clamp(((h.gfAvg+a.gaAvg+hv.gfAvg+av.gaAvg)/4)+0.12,0.35,3.4);
    const awayLambda=clamp(((a.gfAvg+h.gaAvg+av.gfAvg+hv.gaAvg)/4)-0.03,0.25,3.2);
    if (!Number.isFinite(homeLambda) || !Number.isFinite(awayLambda)) return null;
    const total=homeLambda+awayLambda;
    const underOrEqual2=Math.exp(-total)*(1+total+(total*total)/2);
    const over25=clamp((1-underOrEqual2)*100,0,100);
    const btts=clamp((1-Math.exp(-homeLambda))*(1-Math.exp(-awayLambda))*100,0,100);
    const overallSample=Math.min(h.sample,a.sample);
    const venueSample=Math.min(homeVenue?.sample || 0,awayVenue?.sample || 0);
    const qualityScore=Math.round(clamp(
      Math.min(1,overallSample/5)*70+Math.min(1,venueSample/3)*30,
      0,100,
    ));
    return {
      homeExpected:round1(homeLambda),
      awayExpected:round1(awayLambda),
      totalExpected:round1(total),
      over25:round1(over25),
      btts:round1(btts),
      qualityScore,
      qualityLabel:qualityScore >= 80 ? 'Высокая выборка' : qualityScore >= 65 ? 'Рабочая выборка' : 'Ограниченная выборка',
      sample:{overall:overallSample,venue:venueSample},
    };
  }
  
  function outcomeName(probabilities, homeName, awayName) {
    const rows=probabilityRanking(probabilities,homeName,awayName);
    if (rows.length !== 3) return 'Недостаточно данных';
    if (rows[0].value-rows[1].value < 1) return 'Нет явного фаворита';
    return rows[0].label;
  }
  
  function signalDisagreement(signals, finalP) {
    const final=probabilityObject(finalP);
    if (!final || !Array.isArray(signals) || !signals.length) return null;
    const values=[];
    for (const signal of signals) {
      const p=probabilityObject(signal?.probabilities);
      if (!p) continue;
      values.push((
        Math.abs(p.home-final.home)
        + Math.abs(p.draw-final.draw)
        + Math.abs(p.away-final.away)
      )/3);
    }
    return values.length ? round1(values.reduce((sum,value)=>sum+value,0)/values.length) : null;
  }
  
  function signalCanonicalCoverage(signals = []) {
    const rows=Array.isArray(signals) ? signals : [];
    const names=new Set(rows
      .filter(signal=>probabilityObject(signal?.probabilities))
      .map(signal=>String(signal?.name || '')));
    return clamp(MODEL_SIGNAL_NAMES.reduce(
      (sum,name)=>sum+(names.has(name) ? baseWeights[name] : 0),
      0,
    ),0,1);
  }
  
  function signalLeaderAgreement(signals = [], finalP = null) {
    if (!Array.isArray(signals) || !signals.length) return 0;
    const finalLeader=probabilityRanking(finalP,'home','away')[0]?.key || '';
    if (!finalLeader) return 0;
    let agree=0,total=0;
    for (const signal of signals) {
      const ranking=probabilityRanking(signal?.probabilities,'home','away');
      if (!ranking.length) continue;
      const weight=finiteRange(signal?.weight,0,100);
      if (weight === null || weight <= 0) continue;
      total+=weight;
      if (ranking[0].key===finalLeader) agree+=weight;
    }
    return total>0 ? round1(clamp(agree/total*100,0,100)) : 0;
  }
  
  function probabilityLeaderMargin(probabilities = null) {
    const rows = probabilityRanking(probabilities, 'home', 'away');
    if (rows.length < 2) return 0;
    return round1(Math.max(0, Number(rows[0].value || 0) - Number(rows[1].value || 0)));
  }
  
  function confidenceModel(signals, finalP, homeForm, awayForm, lineupStrength = null) {
    const validSignals=(Array.isArray(signals) ? signals : []).filter(signal=>probabilityObject(signal?.probabilities));
    const coverage=signalCanonicalCoverage(validSignals);
    const signalCount=validSignals.length;
    const homeSample=positiveSafeInteger(homeForm?.overall?.sample) || 0;
    const awaySample=positiveSafeInteger(awayForm?.overall?.sample) || 0;
    const formSample=Math.min(1,Math.min(homeSample,awaySample)/5);
    const disagreement=signalDisagreement(validSignals,finalP) ?? 18;
    const agreement=signalLeaderAgreement(validSignals,finalP);
    const margin=probabilityLeaderMargin(finalP);
    const marginFactor=Math.min(1,margin/15);
    const score = Math.round(clamp(
      28
        + coverage * 32
        + formSample * 10
        + (agreement / 100) * 10
        + marginFactor * 10
        + (lineupStrength?.trusted === true
          ? 2 + Math.min(3,(finiteRange(lineupStrength?.confidence,0,100) ?? 0)/100*3)
          : 0)
        - disagreement * 0.75,
      25, 92,
    ));
    return {
      score,
      label: score >= 72 ? 'Высокая' : score >= 55 ? 'Средняя' : 'Низкая',
      disagreement,
      coverage: round1(coverage * 100),
      signalCount,
      agreement,
      margin,
      diagnostics: {
        weightedCoveragePct: round1(coverage * 100),
        formSamplePct: round1(formSample * 100),
        leaderAgreementPct: agreement,
        leaderMarginPctPoints: margin,
        startingXiConfirmed: lineupStrength?.trusted === true,
        startingXiConfidencePct: finiteRange(lineupStrength?.confidence,0,100) ?? 0,
      },
    };
  }
  
  function buildAnalysisNotes({ probabilities, market, model, homeForm, awayForm, h2h, absences, lineups, lineupStrength, news, homeName, awayName, minutesToKickoff, confidence }) {
    const factors=[];
    const risks=[];
    const finalProbabilities=probabilityObject(probabilities);
    const marketProbabilities=probabilityObject(market?.probabilities);
    const counts=h2hCounts(h2h);
    const hp=homeForm?.overall?.ppg, ap=awayForm?.overall?.ppg;
    if (Number.isFinite(hp) && Number.isFinite(ap) && Math.abs(hp - ap) >= 0.35) {
      factors.push(`${hp > ap ? homeName : awayName} лучше по форме последних матчей: ${Math.max(hp, ap).toFixed(1)} против ${Math.min(hp, ap).toFixed(1)} очка за игру.`);
    }
    if (marketProbabilities) {
      const leader=outcomeName(marketProbabilities,homeName,awayName);
      factors.push(`Коэффициенты П1 / Н / П2 сильнее всего оценивают вариант «${leader}».`);
    }
    if (model?.winner) factors.push(`Прогноз API-Football указывает: ${model.winner}.`);
    const homeAbs = absences?.home?.length || 0, awayAbs = absences?.away?.length || 0;
    const homeSuspensions = Number(absences?.summary?.home?.suspension || 0);
    const awaySuspensions = Number(absences?.summary?.away?.suspension || 0);
    if (Math.abs(homeAbs - awayAbs) >= 2) factors.push(`${homeAbs > awayAbs ? homeName : awayName} имеет больше актуальных отметок о потерях состава (${Math.max(homeAbs, awayAbs)} против ${Math.min(homeAbs, awayAbs)}).`);
    if (homeSuspensions || awaySuspensions) factors.push(`Дисквалификации по данным источника: ${homeName} — ${homeSuspensions}, ${awayName} — ${awaySuspensions}.`);
    if (counts?.total >= 3 && Math.abs(counts.homeWins-counts.awayWins) >= 2) {
      factors.push(`В последних очных матчах преимущество по победам у ${counts.homeWins > counts.awayWins ? homeName : awayName}.`);
    }
    if (lineupStrength?.trusted === true) {
      const edge=Number(lineupStrength?.penaltyEdge || 0);
      const shift=Number(lineupStrength?.probabilityShift || 0);
      if (Math.abs(edge)>=1.2 && Math.abs(shift)>=0.2) {
        factors.push(
          edge>0
            ? `Подтверждённый стартовый состав ${awayName} выглядит более ротированным относительно сезонного ядра; поправка к П1 около +${Math.abs(shift).toFixed(1)} п.п.`
            : `Подтверждённый стартовый состав ${homeName} выглядит более ротированным относительно сезонного ядра; поправка к П2 около +${Math.abs(shift).toFixed(1)} п.п.`,
        );
      } else {
        factors.push('Оба подтверждённых стартовых состава близки к сезонному ядру команд; сильной поправки по XI не требуется.');
      }
    }
    if (!marketProbabilities) risks.push('Нет доступной линии 1X2 — итог сильнее зависит от статистических источников.');
    if (!model?.probabilities) risks.push('API-Football не вернул процентный прогноз для этого матча.');
    if ((homeForm?.overall?.sample || 0) < 4 || (awayForm?.overall?.sample || 0) < 4) risks.push('Небольшая выборка недавних матчей одной из команд.');
    if (confidence?.disagreement >= 10) risks.push('Источники заметно расходятся между собой — уверенность модели снижена.');
    if (minutesToKickoff !== null && minutesToKickoff <= 120 && !lineups?.home && !lineups?.away) risks.push('Подтверждённые стартовые составы ещё не доступны.');
    if (!news?.answer) risks.push('Не удалось получить свежий новостной контекст из веб-поиска.');
    if (!factors.length && finalProbabilities) {
      factors.push(`Наибольшая расчётная вероятность сейчас у варианта «${outcomeName(finalProbabilities,homeName,awayName)}».`);
    }
    return { factors: factors.slice(0, 5), risks: risks.slice(0, 5) };
  }
  
  
  function probabilityRanking(probabilities, homeName, awayName) {
    const p=probabilityObject(probabilities);
    if (!p) return [];
    return [
      {key:'home',label:homeName || 'П1',value:p.home},
      {key:'draw',label:'Ничья',value:p.draw},
      {key:'away',label:awayName || 'П2',value:p.away},
    ].sort((a,b)=>b.value-a.value);
  }
  
  function preMatchDriver({ type, icon, side = 'neutral', title, text, strength = 'medium', source = '', weight = null, values = null }) {
    return { type, icon, side, title, text, strength, source, weight, values };
  }
  
  function signalDisplayName(name) {
    return ({
      market: 'Коэффициенты П1 / Н / П2',
      apiPrediction: 'API Prediction',
      recentForm: 'Недавняя форма',
      seasonStrength: 'Сила сезона',
      h2h: 'Очные встречи',
    })[name] || name || 'Источник';
  }
  
  function signalIcon(name) {
    return ({
      market: '💹',
      apiPrediction: '🧠',
      recentForm: '📈',
      seasonStrength: '📊',
      h2h: '🤝',
    })[name] || '•';
  }
  
  function buildPreMatchIntelligence({
    probabilities, rawProbabilities, market, apiPrediction, homeForm, awayForm,
    h2h, absences, lineups, lineupStrength, goalModel, comparison, confidence, modelBreakdown,
    homeName, awayName, minutesToKickoff, news, completeness,
  }) {
    probabilities=probabilityObject(probabilities);
    const marketProbabilities=probabilityObject(market?.probabilities);
    const h2hSummary=h2hCounts(h2h);
    const modelSignals=(Array.isArray(modelBreakdown?.signals) ? modelBreakdown.signals : [])
      .map(signal=>{
        const signalProbabilities=probabilityObject(signal?.probabilities);
        const weight=finiteRange(signal?.weight,0,100);
        if (!signalProbabilities || weight === null) return null;
        return {...signal,probabilities:signalProbabilities,weight};
      })
      .filter(Boolean);
    const ranking=probabilityRanking(probabilities,homeName,awayName);
    const top = ranking[0] || { key: '', label: 'Недостаточно данных', value: 0 };
    const second = ranking[1] || { value: 0 };
    const gap = round1(Math.max(0, Number(top.value || 0) - Number(second.value || 0)));
    const closeMatch = gap < 7;
    const clearEdge = gap >= 12;
    const confidenceScore=finiteRange(confidence?.score,0,100) ?? 0;
    const disagreement=finiteRange(confidence?.disagreement,0,100) ?? 0;
  
    let headline = 'Матч выглядит близким по доступным данным';
    if (probabilities && clearEdge) headline = `Модель выделяет вариант «${top.label}»`;
    else if (probabilities && !closeMatch) headline = `Небольшой перевес у варианта «${top.label}»`;
  
    let summary = 'Доступные источники дают близкие оценки, поэтому небольшие новости по составам или движение рынка могут заметно изменить итоговые проценты.';
    if (probabilities && clearEdge) {
      summary = `Расчётная вероятность лидирующего варианта — ${round1(top.value)}%, отрыв от второго сценария — ${gap} п.п. Это преимущество модели, а не гарантия результата.`;
    } else if (probabilities && !closeMatch) {
      summary = `Лидирующий вариант имеет ${round1(top.value)}%, но отрыв от второго сценария составляет только ${gap} п.п., поэтому матч нельзя считать односторонним.`;
    }
  
    const drivers = [];
    const finalLeaderKey = top.key;
  
    for (const signal of modelSignals.slice().sort((a,b)=>b.weight-a.weight)) {
      const sr = probabilityRanking(signal.probabilities, homeName, awayName);
      const sTop = sr[0];
      if (!sTop) continue;
      const agrees = sTop.key === finalLeaderKey;
      const text = agrees
        ? `${signalDisplayName(signal.name)} поддерживает общий лидер модели: «${sTop.label}» — ${round1(sTop.value)}%.`
        : `${signalDisplayName(signal.name)} расходится с итогом: здесь первым идёт «${sTop.label}» — ${round1(sTop.value)}%.`;
      drivers.push(preMatchDriver({
        type: `signal_${signal.name}`,
        icon: signalIcon(signal.name),
        side: sTop.key === 'home' ? 'home' : sTop.key === 'away' ? 'away' : 'neutral',
        title: signalDisplayName(signal.name),
        text,
        strength: Number(signal.weight || 0) >= 35 ? 'high' : Number(signal.weight || 0) >= 20 ? 'medium' : 'low',
        source: 'model',
        weight: round1(Number(signal.weight || 0)),
        values: signal.probabilities,
      }));
    }
  
    const hOverall = homeForm?.overall;
    const aOverall = awayForm?.overall;
    const hVenue = homeForm?.venue?.sample >= 2 ? homeForm.venue : hOverall;
    const aVenue = awayForm?.venue?.sample >= 2 ? awayForm.venue : aOverall;
    if (hVenue?.sample && aVenue?.sample && Number.isFinite(Number(hVenue.ppg)) && Number.isFinite(Number(aVenue.ppg))) {
      const diff = Number(hVenue.ppg) - Number(aVenue.ppg);
      if (Math.abs(diff) >= 0.35) {
        const side = diff > 0 ? 'home' : 'away';
        drivers.push(preMatchDriver({
          type: 'venue_form',
          icon: side === 'home' ? '🏠' : '✈️',
          side,
          title: 'Форма дома / в гостях',
          text: `${side === 'home' ? homeName : awayName} лучше по релевантной форме: ${Math.max(Number(hVenue.ppg), Number(aVenue.ppg)).toFixed(1)} против ${Math.min(Number(hVenue.ppg), Number(aVenue.ppg)).toFixed(1)} очка за матч.`,
          strength: Math.abs(diff) >= 0.8 ? 'high' : 'medium',
          source: 'form',
          values: { home: Number(hVenue.ppg), away: Number(aVenue.ppg) },
        }));
      }
    }
  
    const homeAbs = absences?.home?.length || 0;
    const awayAbs = absences?.away?.length || 0;
    if (homeAbs || awayAbs) {
      const diff = homeAbs - awayAbs;
      if (Math.abs(diff) >= 2) {
        const burdened = diff > 0 ? 'home' : 'away';
        drivers.push(preMatchDriver({
          type: 'absences',
          icon: '🩺',
          side: burdened,
          title: 'Потери состава',
          text: `${burdened === 'home' ? homeName : awayName} имеет больше подтверждённых потерь: ${homeAbs}:${awayAbs}. Модель делает только ограниченную числовую поправку и не оценивает качество каждого отсутствующего игрока.`,
          strength: Math.abs(diff) >= 4 ? 'high' : 'medium',
          source: 'injuries',
          values: { home: homeAbs, away: awayAbs },
        }));
      }
    }
  
    if (h2hSummary?.total >= 3 && Math.abs(h2hSummary.homeWins-h2hSummary.awayWins) >= 2) {
      const side=h2hSummary.homeWins > h2hSummary.awayWins ? 'home' : 'away';
      drivers.push(preMatchDriver({
        type:'h2h_context',
        icon:'🤝',
        side,
        title:'Контекст очных встреч',
        text:`${side === 'home' ? homeName : awayName} выиграл больше из последних ${h2hSummary.total} очных матчей (${h2hSummary.homeWins}:${h2hSummary.awayWins} по победам). Очные встречи имеют небольшой вес и не считаются главным сигналом.`,
        strength:'low',
        source:'h2h',
      }));
    }
  
    if (lineupStrength?.trusted === true) {
      const shift=Number(lineupStrength?.probabilityShift || 0);
      const edge=Number(lineupStrength?.penaltyEdge || 0);
      const side=shift>0.15 ? 'home' : shift<-0.15 ? 'away' : 'neutral';
      drivers.unshift(preMatchDriver({
        type:'starting_xi_strength',
        icon:'👥',
        side,
        title:'Сила стартовых составов',
        text:Math.abs(shift)>=0.2
          ? `Подтверждённые XI дают ограниченную поправку ${shift>0?homeName:awayName}: ${Math.abs(shift).toFixed(1)} п.п. Разница ротационной нагрузки — ${Math.abs(edge).toFixed(1)}%.`
          : 'Оба подтверждённых XI близки к основному сезонному ядру; составы повышают уверенность, но почти не меняют проценты.',
        strength:Math.abs(shift)>=1.4 ? 'high' : Math.abs(shift)>=0.5 ? 'medium' : 'low',
        source:'lineups',
        values:{
          homeRotationPenalty:Number(lineupStrength?.home?.rotationPenaltyPct || 0),
          awayRotationPenalty:Number(lineupStrength?.away?.rotationPenaltyPct || 0),
          probabilityShift:shift,
        },
      }));
    }

    if (marketProbabilities && probabilities) {
      const marketRanking=probabilityRanking(marketProbabilities,homeName,awayName);
      const marketTop = marketRanking[0];
      const finalTop = ranking[0];
      if (marketTop && finalTop && marketTop.key !== finalTop.key) {
        drivers.unshift(preMatchDriver({
          type: 'market_divergence',
          icon: '↔️',
          side: 'neutral',
          title: 'Рынок и модель расходятся',
          text: `Рынок первым ставит «${marketTop.label}» (${round1(marketTop.value)}%), а объединённая модель — «${finalTop.label}» (${round1(finalTop.value)}%). Это повышает неопределённость.`,
          strength: 'high',
          source: 'market',
        }));
      } else if (marketTop && finalTop && Math.abs(Number(marketTop.value) - Number(finalTop.value)) >= 7) {
        drivers.push(preMatchDriver({
          type: 'market_strength_gap',
          icon: '💹',
          side: finalTop.key === 'home' ? 'home' : finalTop.key === 'away' ? 'away' : 'neutral',
          title: 'Сила сигнала отличается от рынка',
          text: `Направление рынка и модели совпадает, но уверенность различается: рынок ${round1(marketTop.value)}%, модель ${round1(finalTop.value)}%.`,
          strength: 'medium',
          source: 'market',
        }));
      }
    }
  
    const scenarios = [];
    if (probabilities) {
      if (closeMatch) {
        scenarios.push({
          key: 'balanced',
          icon: '⚖️',
          tone: 'balanced',
          title: 'Базовый сценарий: близкий матч',
          text: `Разрыв между двумя наиболее вероятными исходами — всего ${gap} п.п. Небольшой игровой эпизод, состав или изменение рынка может перевернуть порядок вероятностей.`,
          relevance: 'Основной',
        });
      } else {
        const side = top.key === 'home' ? 'home' : top.key === 'away' ? 'away' : 'neutral';
        scenarios.push({
          key: 'leader',
          icon: top.key === 'draw' ? '⚖️' : '🎯',
          tone: side,
          title: `Базовый сценарий: ${top.label}`,
          text: top.key === 'draw'
            ? `Ничья имеет наибольшую оценку (${round1(top.value)}%), что обычно означает отсутствие сильного перевеса одной стороны в доступных сигналах.`
            : `${top.label} получает наибольшую вероятность (${round1(top.value)}%). Ключевой вопрос — реализуется ли статистический перевес в реальных моментах.`,
          relevance: 'Основной',
        });
      }
    }
  
    if (goalModel) {
      const total = Number(goalModel.totalExpected || 0);
      if (total >= 2.8 || Number(goalModel.over25 || 0) >= 60) {
        scenarios.push({
          key: 'goals_high',
          icon: '🔥',
          tone: 'open',
          title: 'Голевой сценарий: более открытая игра',
          text: `Модель Пуассона даёт ${goalModel.totalExpected} ожидаемых гола суммарно и ${round1(goalModel.over25)}% на ТБ 2.5. Это вспомогательная модель по недавней результативности.`,
          relevance: 'Дополнительный',
        });
      } else if (total > 0 && total <= 2.2) {
        scenarios.push({
          key: 'goals_low',
          icon: '🧱',
          tone: 'closed',
          title: 'Голевой сценарий: осторожная игра',
          text: `Суммарная голевая оценка — ${goalModel.totalExpected}. При таком профиле один гол может сильнее изменить структуру матча.`,
          relevance: 'Дополнительный',
        });
      }
      if (Number(goalModel.btts || 0) >= 62) {
        scenarios.push({
          key: 'btts',
          icon: '⚽',
          tone: 'open',
          title: 'Обе команды способны забить',
          text: `Эвристическая вероятность «обе забьют» — ${round1(goalModel.btts)}%. Это не букмекерская рекомендация, а производная от недавних голов команд.`,
          relevance: 'Дополнительный',
        });
      }
    }
  
    if (ranking[1] && Number(ranking[1].value) >= 28) {
      scenarios.push({
        key: 'alternative',
        icon: '🔄',
        tone: ranking[1].key === 'home' ? 'home' : ranking[1].key === 'away' ? 'away' : 'balanced',
        title: `Альтернативный сценарий: ${ranking[1].label}`,
        text: `Второй вариант сохраняет заметную вероятность — ${round1(ranking[1].value)}%. Поэтому основной исход не стоит читать как однозначный.`,
        relevance: 'Альтернатива',
      });
    }
  
    const watch = [];
    if (minutesToKickoff !== null && minutesToKickoff <= 180 && minutesToKickoff >= 0 && !lineups?.home && !lineups?.away) {
      watch.push('Подтверждённые стартовые составы: они ещё не опубликованы, а перед стартом могут изменить оценку.');
    }
    if (Math.abs(homeAbs - awayAbs) >= 2) {
      watch.push('Статус травмированных/дисквалифицированных: разница по потерям сейчас заметная.');
    }
    if (!marketProbabilities) {
      watch.push('Линия 1X2 отсутствует: пока нет рыночного якоря для сравнения с моделью.');
    } else if (drivers.some(x => x.type === 'market_divergence')) {
      watch.push('Движение рынка: рынок и итоговая модель сейчас выбирают разные основные сценарии.');
    }
    if ((homeForm?.overall?.sample || 0) < 4 || (awayForm?.overall?.sample || 0) < 4) {
      watch.push('Размер выборки формы: у одной из команд меньше четырёх недавних матчей в расчёте.');
    }
    if (disagreement >= 10) {
      watch.push('Согласованность источников: расхождение сигналов повышено, поэтому итог чувствителен к новым данным.');
    }
    if (!news?.answer) {
      watch.push('Свежий внешний контекст ограничен: новостная сводка не была доступна.');
    }
  
    let uncertaintyScore = Math.round(clamp(
      (100 - confidenceScore) * 0.72 +
      Math.min(30, disagreement * 1.2) +
      (closeMatch ? 10 : 0) +
      (!marketProbabilities ? 8 : 0) +
      ((!lineups?.home && !lineups?.away && minutesToKickoff !== null && minutesToKickoff <= 120) ? 6 : 0),
      10, 90
    ));
    const uncertainty = uncertaintyScore >= 62
      ? { level: 'high', label: 'Высокая неопределённость' }
      : uncertaintyScore >= 40
        ? { level: 'medium', label: 'Средняя неопределённость' }
        : { level: 'low', label: 'Умеренная неопределённость' };
  
    const completenessScore=finiteNumber(completeness?.score) ?? 0;
    const completenessMax=Math.max(1,finiteNumber(completeness?.max) ?? 10);
    const dataScore=Math.round(clamp(completenessScore/completenessMax*100,0,100));
  
    const sourceRows=modelSignals.map(signal => {
      const sr = probabilityRanking(signal.probabilities, homeName, awayName);
      const lead = sr[0] || {};
      return {
        key: signal.name,
        label: signalDisplayName(signal.name),
        icon: signalIcon(signal.name),
        weight: round1(Number(signal.weight || 0)),
        leader: lead.label || '—',
        leaderKey: lead.key || '',
        leaderProbability: round1(Number(lead.value || 0)),
        probabilities: signal.probabilities || null,
        agreesWithFinal: Boolean(lead.key && finalLeaderKey && lead.key === finalLeaderKey),
      };
    }).sort((a, b) => b.weight - a.weight);
  
    return {
      version: '4.6',
      headline,
      summary,
      leader: {
        key: top.key || '',
        label: top.label || '',
        probability: round1(Number(top.value || 0)),
        secondLabel: second.label || '',
        secondProbability: round1(Number(second.value || 0)),
        gap,
        closeMatch,
      },
      uncertainty: {
        score: uncertaintyScore,
        level: uncertainty.level,
        label: uncertainty.label,
        disagreement: round1(disagreement || 0),
      },
      dataScore,
      drivers: drivers.slice(0, 7),
      scenarios: scenarios.slice(0, 4),
      watch: watch.slice(0, 6),
      sourceRows,
      comparisonSummary: comparison?.balanceLabel || '',
      lineupStatus: {
        home: Boolean(lineups?.home?.quality?.published),
        away: Boolean(lineups?.away?.quality?.published),
        confirmed: Boolean(lineups?.home?.quality?.confirmed && lineups?.away?.quality?.confirmed),
        homeState: String(lineups?.home?.quality?.state || 'unavailable'),
        awayState: String(lineups?.away?.quality?.state || 'unavailable'),
      },
      absences: { home: homeAbs, away: awayAbs },
      methodology: 'Бриф объясняет уже рассчитанные вероятности через веса источников, недавнюю форму, силу сезона, очные встречи, потери и голевую эвристику. Подтверждённый Starting XI применяется отдельной ограниченной поправкой после базового объединения и повышает уверенность только при достаточном покрытии сезонной статистикой игроков. Он не является рекомендацией для ставок.',
    };
  }
  
  return Object.freeze({
    extractPrediction,
    clamp,
    ymd,
    teamResult,
    summarizeFormRows,
    getRecentTeamForm,
    formProbabilities,
    h2hProbabilities,
    seasonStrengthProbabilities,
    blendProbabilitySignals,
    absenceAdjustmentUnits,
    applyAbsenceAdjustment,
    playerSeasonStrength,
    lineupSideStrength,
    buildStartingXiStrength,
    applyLineupStrengthAdjustment,
    poissonGoalModel,
    outcomeName,
    signalDisagreement,
    signalCanonicalCoverage,
    signalLeaderAgreement,
    probabilityLeaderMargin,
    confidenceModel,
    buildAnalysisNotes,
    probabilityRanking,
    preMatchDriver,
    signalDisplayName,
    signalIcon,
    buildPreMatchIntelligence,
  });
}
