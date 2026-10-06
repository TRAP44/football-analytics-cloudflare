// Football model and pre-match intelligence helpers extracted from worker.js.
// Provider/cache primitives remain injected by the composition root.
export function createModelIntelligenceRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Model intelligence runtime dependencies are required.');
  }
  const {
    apiFootball,
    getCache,
    isFinishedStatus,
    normalizeThree,
    parsePercent,
    round1,
    setCache,
    todayUtc,
  } = deps;

  function extractPrediction(rows) {
    const p = rows?.[0]?.predictions;
    if (!p) return null;
    const home = parsePercent(p.percent?.home), draw = parsePercent(p.percent?.draw), away = parsePercent(p.percent?.away);
    return {
      probabilities: home !== null && draw !== null && away !== null ? normalizeThree(home, draw, away) : null,
      winner: p.winner?.name || '',
      winnerComment: p.winner?.comment || '',
      advice: p.advice || '',
      underOver: p.under_over || '',
      goals: p.goals || null,
    };
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value)));
  }
  
  function ymd(value) {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : todayUtc();
  }
  
  function teamResult(fixture, teamId) {
    const homeId = Number(fixture.teams?.home?.id || 0);
    const awayId = Number(fixture.teams?.away?.id || 0);
    const isHome = homeId === Number(teamId);
    const isAway = awayId === Number(teamId);
    if (!isHome && !isAway) return null;
    const hg = Number(fixture.goals?.home ?? 0);
    const ag = Number(fixture.goals?.away ?? 0);
    const gf = isHome ? hg : ag;
    const ga = isHome ? ag : hg;
    return {
      date: fixture.fixture?.date || '',
      venue: isHome ? 'home' : 'away',
      opponent: isHome ? fixture.teams?.away?.name || '' : fixture.teams?.home?.name || '',
      opponentLogo: isHome ? fixture.teams?.away?.logo || '' : fixture.teams?.home?.logo || '',
      league: fixture.league?.name || '',
      gf,
      ga,
      result: gf > ga ? 'W' : gf < ga ? 'L' : 'D',
    };
  }
  
  function summarizeFormRows(rows, teamId, preferredVenue) {
    const all = (rows || [])
      .map(x => teamResult(x, teamId))
      .filter(Boolean)
      .sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0));
    const last = all.slice(0, 5);
    const venue = all.filter(x => x.venue === preferredVenue).slice(0, 3);
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
    return { overall: summarize(last), venue: summarize(venue), preferredVenue };
  }
  
  async function getRecentTeamForm(teamId, preferredVenue, fixtureDate, fixtureId, cfg, { allowNetwork = true } = {}) {
    if (!teamId) return null;
    const targetMs = Number.isFinite(Date.parse(fixtureDate || '')) ? Date.parse(fixtureDate) : Date.now();
    const to = ymd(new Date(targetMs - 60_000));
    const from = ymd(new Date(targetMs - 90 * 86400_000));
    const cacheKey = `teamform:${Number(teamId)}:${preferredVenue}:${to}:v2`;
    const cached = await getCache(cacheKey, cfg);
    if (cached) return cached;
    if (!allowNetwork) return null;
    const rows = await apiFootball('/fixtures', { team: Number(teamId), last: 20 }, cfg);
    const usable = rows.filter(x => {
      const id = Number(x.fixture?.id || 0);
      const dateMs = Date.parse(x.fixture?.date || '');
      return id !== Number(fixtureId) && isFinishedStatus(x.fixture?.status?.short) && Number.isFinite(dateMs) && dateMs < targetMs;
    });
    const summary = summarizeFormRows(usable, teamId, preferredVenue);
    await setCache(cacheKey, Number(fixtureId || teamId), summary, cfg, 120);
    return summary;
  }
  
  function formProbabilities(homeForm, awayForm) {
    const h = homeForm?.overall, a = awayForm?.overall;
    if (!h?.sample || !a?.sample) return null;
    const hv = homeForm?.venue?.sample >= 2 ? homeForm.venue.ppg : h.ppg;
    const av = awayForm?.venue?.sample >= 2 ? awayForm.venue.ppg : a.ppg;
    let edge = 4; // conservative home-field prior
    edge += clamp((h.ppg - a.ppg) * 8, -18, 18);
    edge += clamp((h.gdAvg - a.gdAvg) * 2.6, -10, 10);
    edge += clamp((hv - av) * 3.5, -8, 8);
    edge = clamp(edge, -24, 24);
    const draw = clamp(28.5 - Math.abs(edge) * 0.24, 20, 29);
    const remaining = 100 - draw;
    const homeShare = 1 / (1 + Math.exp(-edge / 8.5));
    return normalizeThree(remaining * homeShare, draw, remaining * (1 - homeShare));
  }
  
  function h2hProbabilities(h2h) {
    const total = Number(h2h?.homeWins || 0) + Number(h2h?.draws || 0) + Number(h2h?.awayWins || 0);
    if (!total) return null;
    return normalizeThree(Number(h2h.homeWins || 0) + 1, Number(h2h.draws || 0) + 1, Number(h2h.awayWins || 0) + 1);
  }
  
  function blendProbabilitySignals({ market, model, form, h2h, weightOverrides = null }) {
    const configured = weightOverrides && typeof weightOverrides === 'object' ? weightOverrides : MODEL_BASE_WEIGHTS;
    const candidates = [
      ['market', market?.probabilities, Number(configured.market ?? MODEL_BASE_WEIGHTS.market)],
      ['apiPrediction', model?.probabilities, Number(configured.apiPrediction ?? MODEL_BASE_WEIGHTS.apiPrediction)],
      ['recentForm', form, Number(configured.recentForm ?? MODEL_BASE_WEIGHTS.recentForm)],
      ['h2h', h2h, Number(configured.h2h ?? MODEL_BASE_WEIGHTS.h2h)],
    ].filter(([, p, w]) => p && [p.home, p.draw, p.away].every(x => Number.isFinite(Number(x))) && Number.isFinite(w) && w > 0);
    if (!candidates.length) return { probabilities: null, weights: {}, signals: [] };
    const weightSum = candidates.reduce((sum, x) => sum + x[2], 0);
    const weights = {};
    let home = 0, draw = 0, away = 0;
    const signals = [];
    for (const [name, p, rawWeight] of candidates) {
      const w = rawWeight / weightSum;
      weights[name] = round1(w * 100);
      home += Number(p.home) * w;
      draw += Number(p.draw) * w;
      away += Number(p.away) * w;
      signals.push({ name, probabilities: p, weight: round1(w * 100) });
    }
    return { probabilities: normalizeThree(home, draw, away), weights, signals };
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
    if (!probabilities) return null;
    const homeCount = Math.min(6, absenceAdjustmentUnits(absences?.home));
    const awayCount = Math.min(6, absenceAdjustmentUnits(absences?.away));
    const shift = clamp((awayCount - homeCount) * 0.55, -3.3, 3.3);
    return normalizeThree(probabilities.home + shift, probabilities.draw, probabilities.away - shift);
  }
  
  function poissonGoalModel(homeForm, awayForm) {
    const h = homeForm?.overall, a = awayForm?.overall;
    if (!h?.sample || !a?.sample || h.sample < 3 || a.sample < 3) return null;
    const homeVenueSample = Number(homeForm?.venue?.sample || 0);
    const awayVenueSample = Number(awayForm?.venue?.sample || 0);
    const hv = homeVenueSample >= 2 ? homeForm.venue : h;
    const av = awayVenueSample >= 2 ? awayForm.venue : a;
    const homeLambda = clamp(((h.gfAvg + a.gaAvg + hv.gfAvg + av.gaAvg) / 4) + 0.12, 0.35, 3.4);
    const awayLambda = clamp(((a.gfAvg + h.gaAvg + av.gfAvg + hv.gaAvg) / 4) - 0.03, 0.25, 3.2);
    const total = homeLambda + awayLambda;
    const underOrEqual2 = Math.exp(-total) * (1 + total + (total * total) / 2);
    const over25 = clamp((1 - underOrEqual2) * 100, 0, 100);
    const btts = clamp((1 - Math.exp(-homeLambda)) * (1 - Math.exp(-awayLambda)) * 100, 0, 100);
    const overallSample = Math.min(Number(h.sample || 0), Number(a.sample || 0));
    const venueSample = Math.min(homeVenueSample, awayVenueSample);
    const qualityScore = Math.round(clamp(
      Math.min(1, overallSample / 5) * 70 + Math.min(1, venueSample / 3) * 30,
      0, 100,
    ));
    return {
      homeExpected: round1(homeLambda),
      awayExpected: round1(awayLambda),
      totalExpected: round1(total),
      over25: round1(over25),
      btts: round1(btts),
      qualityScore,
      qualityLabel: qualityScore >= 80 ? 'Высокая выборка' : qualityScore >= 65 ? 'Рабочая выборка' : 'Ограниченная выборка',
      sample: { overall: overallSample, venue: venueSample },
    };
  }
  
  function outcomeName(probabilities, homeName, awayName) {
    if (!probabilities) return 'Недостаточно данных';
    const rows = [
      { key: 'home', label: homeName || 'П1', value: Number(probabilities.home) },
      { key: 'draw', label: 'Ничья', value: Number(probabilities.draw) },
      { key: 'away', label: awayName || 'П2', value: Number(probabilities.away) },
    ].filter(row => Number.isFinite(row.value)).sort((a, b) => b.value - a.value);
    if (rows.length !== 3) return 'Недостаточно данных';
    if (rows[0].value - rows[1].value < 1) return 'Нет явного фаворита';
    return rows[0].label;
  }
  
  function signalDisagreement(signals, finalP) {
    if (!finalP || !signals?.length) return null;
    const values = signals.map(s => (
      Math.abs(Number(s.probabilities.home) - Number(finalP.home)) +
      Math.abs(Number(s.probabilities.draw) - Number(finalP.draw)) +
      Math.abs(Number(s.probabilities.away) - Number(finalP.away))
    ) / 3);
    return round1(values.reduce((a, b) => a + b, 0) / values.length);
  }
  
  function signalCanonicalCoverage(signals = []) {
    const names = new Set((signals || []).map(x => String(x?.name || '')));
    return clamp(Object.entries(MODEL_BASE_WEIGHTS).reduce((sum,[name,weight]) => sum + (names.has(name) ? Number(weight || 0) : 0), 0), 0, 1);
  }
  
  function signalLeaderAgreement(signals = [], finalP = null) {
    if (!finalP || !signals.length) return 0;
    const finalLeader = probabilityRanking(finalP, 'home', 'away')[0]?.key || '';
    if (!finalLeader) return 0;
    let agree = 0, total = 0;
    for (const signal of signals) {
      const weight = Math.max(0, Number(signal?.weight || 0));
      const leader = probabilityRanking(signal?.probabilities, 'home', 'away')[0]?.key || '';
      total += weight;
      if (leader === finalLeader) agree += weight;
    }
    return total > 0 ? round1(clamp(agree / total * 100, 0, 100)) : 0;
  }
  
  function probabilityLeaderMargin(probabilities = null) {
    const rows = probabilityRanking(probabilities, 'home', 'away');
    if (rows.length < 2) return 0;
    return round1(Math.max(0, Number(rows[0].value || 0) - Number(rows[1].value || 0)));
  }
  
  function confidenceModel(signals, finalP, homeForm, awayForm) {
    const coverage = signalCanonicalCoverage(signals);
    const signalCount = Number(signals?.length || 0);
    const formSample = Math.min(1, Math.min(homeForm?.overall?.sample || 0, awayForm?.overall?.sample || 0) / 5);
    const disagreement = signalDisagreement(signals, finalP) ?? 18;
    const agreement = signalLeaderAgreement(signals || [], finalP);
    const margin = probabilityLeaderMargin(finalP);
    const marginFactor = Math.min(1, margin / 15);
    const score = Math.round(clamp(
      28
        + coverage * 32
        + formSample * 10
        + (agreement / 100) * 10
        + marginFactor * 10
        - disagreement * 0.75,
      25, 90,
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
      },
    };
  }
  
  function buildAnalysisNotes({ probabilities, market, model, homeForm, awayForm, h2h, absences, lineups, news, homeName, awayName, minutesToKickoff, confidence }) {
    const factors = [];
    const risks = [];
    const hp = homeForm?.overall?.ppg, ap = awayForm?.overall?.ppg;
    if (Number.isFinite(hp) && Number.isFinite(ap) && Math.abs(hp - ap) >= 0.35) {
      factors.push(`${hp > ap ? homeName : awayName} лучше по форме последних матчей: ${Math.max(hp, ap).toFixed(1)} против ${Math.min(hp, ap).toFixed(1)} очка за игру.`);
    }
    if (market?.probabilities) {
      const leader = outcomeName(market.probabilities, homeName, awayName);
      factors.push(`Коэффициенты П1 / Н / П2 сильнее всего оценивают вариант «${leader}».`);
    }
    if (model?.winner) factors.push(`Прогноз API-Football указывает: ${model.winner}.`);
    const homeAbs = absences?.home?.length || 0, awayAbs = absences?.away?.length || 0;
    const homeSuspensions = Number(absences?.summary?.home?.suspension || 0);
    const awaySuspensions = Number(absences?.summary?.away?.suspension || 0);
    if (Math.abs(homeAbs - awayAbs) >= 2) factors.push(`${homeAbs > awayAbs ? homeName : awayName} имеет больше актуальных отметок о потерях состава (${Math.max(homeAbs, awayAbs)} против ${Math.min(homeAbs, awayAbs)}).`);
    if (homeSuspensions || awaySuspensions) factors.push(`Дисквалификации по данным источника: ${homeName} — ${homeSuspensions}, ${awayName} — ${awaySuspensions}.`);
    const h2hTotal = (h2h?.homeWins || 0) + (h2h?.draws || 0) + (h2h?.awayWins || 0);
    if (h2hTotal >= 3 && Math.abs((h2h.homeWins || 0) - (h2h.awayWins || 0)) >= 2) factors.push(`В последних очных матчах преимущество по победам у ${h2h.homeWins > h2h.awayWins ? homeName : awayName}.`);
    if (!market) risks.push('Нет доступной линии 1X2 — итог сильнее зависит от статистических источников.');
    if (!model?.probabilities) risks.push('API-Football не вернул процентный прогноз для этого матча.');
    if ((homeForm?.overall?.sample || 0) < 4 || (awayForm?.overall?.sample || 0) < 4) risks.push('Небольшая выборка недавних матчей одной из команд.');
    if (confidence?.disagreement >= 10) risks.push('Источники заметно расходятся между собой — уверенность модели снижена.');
    if (minutesToKickoff !== null && minutesToKickoff <= 120 && !lineups?.home && !lineups?.away) risks.push('Подтверждённые стартовые составы ещё не доступны.');
    if (!news?.answer) risks.push('Не удалось получить свежий новостной контекст из веб-поиска.');
    if (!factors.length && probabilities) factors.push(`Наибольшая расчётная вероятность сейчас у варианта «${outcomeName(probabilities, homeName, awayName)}».`);
    return { factors: factors.slice(0, 5), risks: risks.slice(0, 5) };
  }
  
  
  function probabilityRanking(probabilities, homeName, awayName) {
    if (!probabilities) return [];
    return [
      { key: 'home', label: homeName || 'П1', value: Number(probabilities.home || 0) },
      { key: 'draw', label: 'Ничья', value: Number(probabilities.draw || 0) },
      { key: 'away', label: awayName || 'П2', value: Number(probabilities.away || 0) },
    ].sort((a, b) => b.value - a.value);
  }
  
  function preMatchDriver({ type, icon, side = 'neutral', title, text, strength = 'medium', source = '', weight = null, values = null }) {
    return { type, icon, side, title, text, strength, source, weight, values };
  }
  
  function signalDisplayName(name) {
    return ({
      market: 'Коэффициенты П1 / Н / П2',
      apiPrediction: 'API Prediction',
      recentForm: 'Недавняя форма',
      h2h: 'Очные встречи',
    })[name] || name || 'Источник';
  }
  
  function signalIcon(name) {
    return ({
      market: '💹',
      apiPrediction: '🧠',
      recentForm: '📈',
      h2h: '🤝',
    })[name] || '•';
  }
  
  function buildPreMatchIntelligence({
    probabilities, rawProbabilities, market, apiPrediction, homeForm, awayForm,
    h2h, absences, lineups, goalModel, comparison, confidence, modelBreakdown,
    homeName, awayName, minutesToKickoff, news, completeness,
  }) {
    const ranking = probabilityRanking(probabilities, homeName, awayName);
    const top = ranking[0] || { key: '', label: 'Недостаточно данных', value: 0 };
    const second = ranking[1] || { value: 0 };
    const gap = round1(Math.max(0, Number(top.value || 0) - Number(second.value || 0)));
    const closeMatch = gap < 7;
    const clearEdge = gap >= 12;
    const confidenceScore = Number(confidence?.score || 0);
    const disagreement = Number(confidence?.disagreement || 0);
  
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
  
    for (const signal of (modelBreakdown?.signals || []).slice().sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))) {
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
  
    const h2hTotal = Number(h2h?.homeWins || 0) + Number(h2h?.draws || 0) + Number(h2h?.awayWins || 0);
    if (h2hTotal >= 3) {
      const hw = Number(h2h?.homeWins || 0), aw = Number(h2h?.awayWins || 0);
      if (Math.abs(hw - aw) >= 2) {
        const side = hw > aw ? 'home' : 'away';
        drivers.push(preMatchDriver({
          type: 'h2h_context',
          icon: '🤝',
          side,
          title: 'Контекст очных встреч',
          text: `${side === 'home' ? homeName : awayName} выиграл больше из последних ${h2hTotal} очных матчей (${hw}:${aw} по победам). Очные встречи имеют небольшой вес и не считаются главным сигналом.`,
          strength: 'low',
          source: 'h2h',
        }));
      }
    }
  
    if (market?.probabilities && probabilities) {
      const marketRanking = probabilityRanking(market.probabilities, homeName, awayName);
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
    if (!market?.probabilities) {
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
      (!market?.probabilities ? 8 : 0) +
      ((!lineups?.home && !lineups?.away && minutesToKickoff !== null && minutesToKickoff <= 120) ? 6 : 0),
      10, 90
    ));
    const uncertainty = uncertaintyScore >= 62
      ? { level: 'high', label: 'Высокая неопределённость' }
      : uncertaintyScore >= 40
        ? { level: 'medium', label: 'Средняя неопределённость' }
        : { level: 'low', label: 'Умеренная неопределённость' };
  
    const completenessScore = Number(completeness?.score || 0);
    const completenessMax = Math.max(1, Number(completeness?.max || 10));
    const dataScore = Math.round(clamp(completenessScore / completenessMax * 100, 0, 100));
  
    const sourceRows = (modelBreakdown?.signals || []).map(signal => {
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
      methodology: 'Бриф объясняет уже рассчитанные вероятности через веса источников, форму, очные встречи, потери и голевую эвристику. Он не добавляет новый прогноз и не является рекомендацией для ставок.',
    };
  }
  
  return {
    extractPrediction,
    clamp,
    ymd,
    teamResult,
    summarizeFormRows,
    getRecentTeamForm,
    formProbabilities,
    h2hProbabilities,
    blendProbabilitySignals,
    absenceAdjustmentUnits,
    applyAbsenceAdjustment,
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
  };
}
