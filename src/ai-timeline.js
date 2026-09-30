function finiteProbability(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number * 10) / 10 : null;
}

function finiteScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validIso(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function probabilitySet(value = {}) {
  const home = finiteProbability(value.home);
  const draw = finiteProbability(value.draw);
  const away = finiteProbability(value.away);
  if (home === null || draw === null || away === null) return null;
  return { home, draw, away };
}

function outcomeKey(probabilities = {}) {
  const rows = ['home', 'draw', 'away']
    .map(key => ({ key, value: finiteProbability(probabilities?.[key]) }))
    .filter(row => row.value !== null)
    .sort((a, b) => b.value - a.value);
  return rows[0]?.key || '';
}

function outcomeLabel(key = '') {
  return key === 'home' ? 'П1' : key === 'draw' ? 'Н' : key === 'away' ? 'П2' : '—';
}

function round1(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : null;
}

export function timelineTriggerFromDelta(delta = null) {
  const codes = new Set(Array.isArray(delta?.codes) ? delta.codes.map(String) : []);
  if (codes.has('lineups')) {
    return {
      category: 'lineup',
      relation: 'confirmed',
      label: 'Подтверждён состав',
      explanation: 'После подтверждения состава сохранена новая оценка модели. Это временная последовательность, а не утверждение о единственной причине изменения.',
    };
  }
  if (codes.has('absences')) {
    return {
      category: 'availability',
      relation: 'confirmed',
      label: 'Обновлены потери',
      explanation: 'После обновления подтверждённых потерь сохранена новая оценка модели. Другие входные данные могли измениться одновременно.',
    };
  }
  if (codes.has('market')) {
    return {
      category: 'odds_move',
      relation: 'correlated',
      label: 'Движение рынка',
      explanation: 'Изменение оценки по времени совпало с заметным движением рынка. Причинность не подтверждена.',
    };
  }
  if (codes.size) {
    return {
      category: 'model_update',
      relation: 'model_driven',
      label: 'Обновление модели',
      explanation: 'Модель переоценила матч после обновления входных данных.',
    };
  }
  return {
    category: 'model_update',
    relation: 'model_driven',
    label: 'Обновление модели',
    explanation: 'Сохранена оценка модели после обновления входных данных.',
  };
}

function compactProvenance(payload = {}) {
  const provenance = payload?.dataProvenance || {};
  const features = provenance?.features && typeof provenance.features === 'object' ? provenance.features : {};
  const summarized = {};
  const staleFeatures = [];
  for (const [feature, meta] of Object.entries(features)) {
    const item = {
      provider: String(meta?.provider || '').slice(0, 80),
      source: String(meta?.source || '').slice(0, 80),
      freshnessState: String(meta?.freshnessState || '').slice(0, 40),
      provenanceState: String(meta?.provenanceState || '').slice(0, 40),
      stale: Boolean(meta?.stale),
    };
    summarized[feature] = item;
    if (item.stale) staleFeatures.push(feature);
  }
  return {
    primaryProvider: String(provenance?.primaryProvider || '').slice(0, 80),
    generatedAt: validIso(provenance?.generatedAt) || validIso(payload?.generatedAt) || null,
    stale: staleFeatures.length > 0,
    staleFeatures: staleFeatures.slice(0, 20),
    features: summarized,
  };
}

function matchMinuteForSnapshot(payload = {}, capturedAt = '') {
  const explicit = finiteScore(payload?.match?.elapsed);
  if (explicit !== null && explicit >= 0) return Math.round(explicit);
  const status = String(payload?.match?.status || '').toUpperCase();
  if (!['1H','HT','2H','ET','BT','P','INT','LIVE'].includes(status)) return null;
  const kickoff = Date.parse(String(payload?.match?.date || ''));
  const captured = Date.parse(String(capturedAt || ''));
  if (!Number.isFinite(kickoff) || !Number.isFinite(captured) || captured < kickoff) return null;
  return Math.max(0, Math.min(180, Math.round((captured - kickoff) / 60000)));
}

export function analysisTimelineSnapshotRow(payload = {}, { delta = null } = {}) {
  const fixtureId = Number(payload?.match?.fixtureId || 0);
  const capturedAt = validIso(payload?.generatedAt);
  const probabilities = probabilitySet(payload?.probabilities);
  if (!fixtureId || !capturedAt || !probabilities) return null;

  const trigger = timelineTriggerFromDelta(delta);
  const confidence = finiteScore(payload?.aiInstructor?.confidenceScore ?? payload?.confidence?.score);
  const completenessScore = finiteScore(payload?.completeness?.score);
  const completenessMax = finiteScore(payload?.completeness?.max);
  const provenance = compactProvenance(payload);

  return {
    snapshot_key: `${fixtureId}:${capturedAt}`,
    fixture_id: fixtureId,
    captured_at: capturedAt,
    match_status: String(payload?.match?.status || '').slice(0, 24),
    match_minute: matchMinuteForSnapshot(payload, capturedAt),
    home_prob: probabilities.home,
    draw_prob: probabilities.draw,
    away_prob: probabilities.away,
    confidence_score: confidence,
    completeness_score: completenessScore,
    completeness_max: completenessMax,
    trigger_category: trigger.category,
    causal_relation: trigger.relation,
    explanation: trigger.explanation.slice(0, 600),
    provenance,
    analysis_version: String(payload?.analysisVersion || '').slice(0, 80),
  };
}

export function modelPredictionTimelineRow(row = {}) {
  const fixtureId = Number(row?.fixture_id || 0);
  const capturedAt = validIso(row?.captured_at);
  const probabilities = probabilitySet({
    home: row?.home_prob,
    draw: row?.draw_prob,
    away: row?.away_prob,
  });
  if (!fixtureId || !capturedAt || !probabilities) return null;
  return {
    snapshot_key: `model-prediction:${fixtureId}:${capturedAt}`,
    fixture_id: fixtureId,
    captured_at: capturedAt,
    match_status: 'NS',
    match_minute: null,
    home_prob: probabilities.home,
    draw_prob: probabilities.draw,
    away_prob: probabilities.away,
    confidence_score: finiteScore(row?.confidence_score),
    completeness_score: finiteScore(row?.completeness_score),
    completeness_max: finiteScore(row?.completeness_max),
    trigger_category: 'baseline',
    causal_relation: 'model_driven',
    explanation: 'Первый неизменяемый предматчевый снимок модели.',
    provenance: {
      source: 'model_predictions',
      stale: false,
      dataProvenance: row?.data_provenance || null,
    },
    analysis_version: String(row?.analysis_version || '').slice(0, 80),
    source: 'model_predictions',
  };
}

function normalizedSnapshot(row = {}, source = 'analysis_timeline_snapshots') {
  const capturedAt = validIso(row?.captured_at ?? row?.capturedAt);
  const fixtureId = Number(row?.fixture_id ?? row?.fixtureId ?? 0);
  const probabilities = probabilitySet({
    home: row?.home_prob ?? row?.probabilities?.home,
    draw: row?.draw_prob ?? row?.probabilities?.draw,
    away: row?.away_prob ?? row?.probabilities?.away,
  });
  if (!capturedAt || !fixtureId || !probabilities) return null;
  const minute = finiteScore(row?.match_minute ?? row?.minute);
  const completenessScore = finiteScore(row?.completeness_score ?? row?.completeness?.score);
  const completenessMax = finiteScore(row?.completeness_max ?? row?.completeness?.max);
  const completenessPercent = completenessScore !== null && completenessMax !== null && completenessMax > 0
    ? Math.max(0, Math.min(100, Math.round(completenessScore / completenessMax * 100)))
    : null;
  const provenance = row?.provenance && typeof row.provenance === 'object' ? row.provenance : {};
  return {
    id: String(row?.snapshot_key || `${source}:${fixtureId}:${capturedAt}`),
    fixtureId,
    capturedAt,
    minute: minute === null ? null : Math.max(0, Math.round(minute)),
    status: String(row?.match_status ?? row?.status ?? ''),
    probabilities,
    confidence: finiteScore(row?.confidence_score ?? row?.confidence),
    completeness: {
      score: completenessScore,
      max: completenessMax,
      percent: completenessPercent,
    },
    trigger: {
      category: String(row?.trigger_category ?? row?.trigger?.category ?? 'model_update'),
      relation: String(row?.causal_relation ?? row?.trigger?.relation ?? 'model_driven'),
      label: String(row?.trigger?.label || ''),
      explanation: String(row?.explanation ?? row?.trigger?.explanation ?? '').slice(0, 600),
    },
    provenance,
    stale: Boolean(provenance?.stale || (Array.isArray(provenance?.staleFeatures) && provenance.staleFeatures.length)),
    analysisVersion: String(row?.analysis_version ?? row?.analysisVersion ?? ''),
    source: String(row?.source || source),
  };
}

function sameProbabilities(a = {}, b = {}) {
  return ['home','draw','away'].every(key => Math.abs(Number(a?.[key]) - Number(b?.[key])) < 0.05);
}

function dedupeSnapshots(rows = []) {
  const exact = new Map();
  for (const row of rows) {
    const key = `${row.fixtureId}:${row.capturedAt}`;
    const existing = exact.get(key);
    if (!existing || (existing.source === 'model_predictions' && row.source !== 'model_predictions')) exact.set(key, row);
  }
  const sorted = [...exact.values()].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const result = [];
  for (const row of sorted) {
    const previous = result.at(-1);
    if (
      previous
      && sameProbabilities(previous.probabilities, row.probabilities)
      && Math.abs(Date.parse(row.capturedAt) - Date.parse(previous.capturedAt)) <= 120000
      && (previous.source === 'model_predictions' || row.source === 'model_predictions')
    ) {
      if (previous.source === 'model_predictions' && row.source !== 'model_predictions') result[result.length - 1] = row;
      continue;
    }
    result.push(row);
  }
  return result;
}

function eventType(event = {}) {
  const haystack = `${event?.type || ''} ${event?.detail || ''} ${event?.label || ''}`.toLowerCase();
  if (haystack.includes('red') || haystack.includes('красн') || haystack.includes('second yellow')) return 'red_card';
  if (haystack.includes('goal') || haystack.includes('гол')) return 'goal';
  return '';
}

function correlatedEvent(events = [], previousMinute = null, currentMinute = null) {
  if (currentMinute === null || currentMinute === undefined) return null;
  const from = previousMinute === null || previousMinute === undefined ? -1 : Number(previousMinute);
  const to = Number(currentMinute);
  const candidates = (Array.isArray(events) ? events : [])
    .map(event => ({
      event,
      minute: finiteScore(event?.minute ?? event?.time?.elapsed),
      kind: eventType(event),
    }))
    .filter(item => item.kind && item.minute !== null && item.minute > from && item.minute <= to)
    .sort((a, b) => {
      const priority = kind => kind === 'red_card' ? 0 : 1;
      return priority(a.kind) - priority(b.kind) || b.minute - a.minute;
    });
  return candidates[0] || null;
}

function eventDescription(item = null) {
  if (!item) return null;
  const event = item.event || {};
  const label = item.kind === 'red_card' ? 'красной карточкой' : 'голом';
  const team = String(event?.teamName || '').trim();
  return {
    category: 'event',
    relation: 'correlated',
    label: item.kind === 'red_card' ? 'Красная карточка' : 'Гол',
    explanation: `Изменение оценки по времени совпало с ${label}${team ? ` команды «${team}»` : ''} на ${Math.round(item.minute)}-й минуте. Причинность не подтверждена.`,
    eventMinute: Math.round(item.minute),
    eventKind: item.kind,
  };
}

function marketContextRows(rows = []) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .map(row => {
      const capturedAt = validIso(row?.at ?? row?.snapshot_time);
      const probabilities = probabilitySet({
        home: row?.homeProb ?? row?.home_prob,
        draw: row?.drawProb ?? row?.draw_prob,
        away: row?.awayProb ?? row?.away_prob,
      });
      if (!capturedAt || !probabilities) return null;
      const key = `${capturedAt}:${probabilities.home}:${probabilities.draw}:${probabilities.away}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        capturedAt,
        probabilities,
        sourceCount: Number(row?.sources ?? row?.source_count ?? 0) || 0,
        source: 'odds_snapshots',
      };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))
    .slice(-20);
}

export function buildAiTimeline({
  snapshotRows = [],
  modelPrediction = null,
  oddsSnapshots = [],
  events = [],
  match = {},
} = {}) {
  const normalized = (Array.isArray(snapshotRows) ? snapshotRows : [])
    .map(row => normalizedSnapshot(row))
    .filter(Boolean);
  const firstPrediction = modelPredictionTimelineRow(modelPrediction || {});
  if (firstPrediction) normalized.push(normalizedSnapshot(firstPrediction, 'model_predictions'));

  const points = dedupeSnapshots(normalized);
  const kickoffAt = validIso(match?.date ?? modelPrediction?.kickoff_at);
  const kickoffMs = Date.parse(kickoffAt || '');

  for (const [index, point] of points.entries()) {
    if (point.minute === null && Number.isFinite(kickoffMs)) {
      const capturedMs = Date.parse(point.capturedAt);
      if (capturedMs >= kickoffMs) point.minute = Math.max(0, Math.min(180, Math.round((capturedMs - kickoffMs) / 60000)));
    }

    const leaderKey = outcomeKey(point.probabilities);
    const currentProbability = leaderKey ? point.probabilities[leaderKey] : null;
    const previous = index > 0 ? points[index - 1] : null;
    const previousProbability = previous && leaderKey ? finiteProbability(previous.probabilities?.[leaderKey]) : null;
    const deltaValue = previousProbability === null || currentProbability === null ? null : round1(currentProbability - previousProbability);
    point.leader = {
      key: leaderKey,
      label: outcomeLabel(leaderKey),
      probability: currentProbability,
    };
    point.delta = {
      value: deltaValue,
      previousProbability,
      currentProbability,
      direction: deltaValue === null || Math.abs(deltaValue) < 0.05 ? 'flat' : deltaValue > 0 ? 'up' : 'down',
    };

    if (previous && point.trigger.relation === 'model_driven') {
      const correlation = correlatedEvent(events, previous.minute, point.minute);
      const correlated = eventDescription(correlation);
      if (correlated) point.trigger = correlated;
    }
  }

  const marketContext = marketContextRows(oddsSnapshots);
  return {
    available: points.length > 0,
    points,
    marketContext,
    generatedFrom: {
      timelineSnapshots: points.filter(point => point.source !== 'model_predictions').length,
      immutableModelPrediction: Boolean(firstPrediction),
      marketSnapshots: marketContext.length,
    },
    note: points.length
      ? 'AI Timeline использует только реально сохранённые снимки. События и движение рынка помечаются как совпадение во времени, если причинность не подтверждена.'
      : 'Сохранённых AI-снимков для этого матча пока нет.',
  };
}
