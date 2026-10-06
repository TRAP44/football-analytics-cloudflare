export function createPredictionMathRuntime(deps = {}) {
  const {
    clamp,
    normalizeThree
  } = deps;

  function predictionOutcomeKey(probabilities) {
    if (!probabilities) return '';
    const rows = [
      ['home', Number(probabilities.home)],
      ['draw', Number(probabilities.draw)],
      ['away', Number(probabilities.away)],
    ].filter(([, value]) => Number.isFinite(value));
    if (rows.length !== 3) return '';
    rows.sort((a, b) => b[1] - a[1]);
    return rows[0]?.[0] || '';
  }
  
  function predictionOutcomeLabel(key, homeName = 'Хозяева', awayName = 'Гости') {
    if (key === 'home') return homeName;
    if (key === 'away') return awayName;
    if (key === 'draw') return 'Ничья';
    return '—';
  }
  
  function topProbabilityValue(row) {
    return Math.max(Number(row?.home_prob || 0), Number(row?.draw_prob || 0), Number(row?.away_prob || 0));
  }
  
  function actualOutcomeFromGoals(homeGoals, awayGoals) {
    const h = Number(homeGoals), a = Number(awayGoals);
    if (!Number.isFinite(h) || !Number.isFinite(a)) return '';
    if (h > a) return 'home';
    if (a > h) return 'away';
    return 'draw';
  }
  
  function regulationScore(fixture) {
    const full = fixture?.score?.fulltime || fixture?.score?.fullTime || null;
    let home = Number(full?.home), away = Number(full?.away);
    if (!Number.isFinite(home) || !Number.isFinite(away)) {
      home = Number(fixture?.goals?.home ?? fixture?.score?.home);
      away = Number(fixture?.goals?.away ?? fixture?.score?.away);
    }
    return Number.isFinite(home) && Number.isFinite(away) ? { home, away } : null;
  }
  
  function fixtureIdentity(fixture) {
    return Number(fixture?.fixture?.id || fixture?.fixtureId || fixture?.id || 0);
  }
  
  function fixtureStatusShort(fixture) {
    return String(fixture?.fixture?.status?.short || fixture?.status || '');
  }
  
  function scoreBrier(row, actualOutcome) {
    const probs = {
      home: Math.max(0, Math.min(1, Number(row.home_prob || 0) / 100)),
      draw: Math.max(0, Math.min(1, Number(row.draw_prob || 0) / 100)),
      away: Math.max(0, Math.min(1, Number(row.away_prob || 0) / 100)),
    };
    const sum = ['home','draw','away'].reduce((acc, key) => acc + Math.pow(probs[key] - (actualOutcome === key ? 1 : 0), 2), 0);
    return Math.round((sum / 3) * 10000) / 10000;
  }
  
  function validThreeProbabilities(probabilities) {
    return Boolean(probabilities && ['home','draw','away'].every(key => {
      const value = probabilities[key];
      return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
    }));
  }
  
  function rowFinalProbabilities(row) {
    const raw = [row?.home_prob, row?.draw_prob, row?.away_prob];
    if (raw.some(value => value === null || value === undefined || value === '')) return null;
    const p = { home: Number(raw[0]), draw: Number(raw[1]), away: Number(raw[2]) };
    if (!validThreeProbabilities(p)) return null;
    return normalizeThree(p.home, p.draw, p.away);
  }
  
  function rowRawProbabilities(row) {
    const raw = [row?.raw_home_prob, row?.raw_draw_prob, row?.raw_away_prob];
    if (raw.some(value => value === null || value === undefined || value === '')) return rowFinalProbabilities(row);
    const p = { home: Number(raw[0]), draw: Number(raw[1]), away: Number(raw[2]) };
    if (!validThreeProbabilities(p)) return rowFinalProbabilities(row);
    return normalizeThree(p.home, p.draw, p.away) || rowFinalProbabilities(row);
  }
  
  function brierFromProbabilities(probabilities, actualOutcome) {
    if (!validThreeProbabilities(probabilities) || !['home','draw','away'].includes(String(actualOutcome || ''))) return null;
    const probs = {
      home: Math.max(0, Math.min(1, Number(probabilities.home) / 100)),
      draw: Math.max(0, Math.min(1, Number(probabilities.draw) / 100)),
      away: Math.max(0, Math.min(1, Number(probabilities.away) / 100)),
    };
    const sum = ['home','draw','away'].reduce((acc, key) => acc + Math.pow(probs[key] - (actualOutcome === key ? 1 : 0), 2), 0);
    return Math.round((sum / 3) * 10000) / 10000;
  }
  
  function logLossFromProbabilities(probabilities, actualOutcome) {
    if (!validThreeProbabilities(probabilities) || !['home','draw','away'].includes(String(actualOutcome || ''))) return null;
    const p = Math.max(0.01, Math.min(0.99, Number(probabilities[actualOutcome]) / 100));
    return -Math.log(p);
  }
  
  function temperatureScaleProbabilities(probabilities, temperature = 1) {
    if (!validThreeProbabilities(probabilities)) return probabilities || null;
    const t = clamp(Number(temperature) || 1, 0.8, 1.35);
    if (Math.abs(t - 1) < 0.001) return normalizeThree(probabilities.home, probabilities.draw, probabilities.away);
    const exponent = 1 / t;
    const h = Math.pow(Math.max(0.0001, Number(probabilities.home) / 100), exponent);
    const d = Math.pow(Math.max(0.0001, Number(probabilities.draw) / 100), exponent);
    const a = Math.pow(Math.max(0.0001, Number(probabilities.away) / 100), exponent);
    return normalizeThree(h, d, a);
  }
  
  function parseJsonObject(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  
  function signalProbabilitySnapshot(signals) {
    const out = {};
    for (const signal of signals || []) {
      if (!signal?.name || !validThreeProbabilities(signal.probabilities)) continue;
      out[String(signal.name)] = normalizeThree(signal.probabilities.home, signal.probabilities.draw, signal.probabilities.away);
    }
    return out;
  }
  
  function predictedOutcomeForProbabilities(probabilities) {
    return predictionOutcomeKey(probabilities);
  }
  
  function averageMetric(rows, fn) {
    const values = (rows || []).map(fn).map(Number).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  return {
    predictionOutcomeKey,
    predictionOutcomeLabel,
    topProbabilityValue,
    actualOutcomeFromGoals,
    regulationScore,
    fixtureIdentity,
    fixtureStatusShort,
    scoreBrier,
    validThreeProbabilities,
    rowFinalProbabilities,
    rowRawProbabilities,
    brierFromProbabilities,
    logLossFromProbabilities,
    temperatureScaleProbabilities,
    parseJsonObject,
    signalProbabilitySnapshot,
    predictedOutcomeForProbabilities,
    averageMetric
  };
}
