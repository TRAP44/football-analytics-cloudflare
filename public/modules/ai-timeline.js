function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function safeIso(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function outcomeLabel(key = '', match = {}) {
  if (key === 'home') return match?.home?.name || 'П1';
  if (key === 'draw') return 'Ничья';
  if (key === 'away') return match?.away?.name || 'П2';
  return '—';
}

function relationLabel(relation = '') {
  return relation === 'confirmed'
    ? 'Подтверждено данными'
    : relation === 'correlated'
      ? 'Совпало по времени'
      : 'Обновление модели';
}

function relationClass(relation = '') {
  return ['confirmed','correlated','model_driven'].includes(relation) ? relation : 'model_driven';
}

function normalizeProbabilities(value = {}) {
  const result = {};
  for (const key of ['home','draw','away']) {
    const number = finiteNumber(value?.[key]);
    if (number === null) return null;
    result[key] = Math.round(number * 10) / 10;
  }
  return result;
}

function leaderFor(probabilities = {}) {
  return ['home','draw','away']
    .map(key => ({ key, probability: finiteNumber(probabilities?.[key]) }))
    .filter(row => row.probability !== null)
    .sort((a,b) => b.probability - a.probability)[0] || { key:'', probability:null };
}

function sameProbabilities(a = {}, b = {}) {
  return ['home','draw','away'].every(key => Math.abs(Number(a?.[key]) - Number(b?.[key])) < 0.05);
}

function pointTime(point = {}, match = {}) {
  if (finiteNumber(point.minute) !== null) return `${Math.max(0, Math.round(Number(point.minute)))}′`;
  const capturedMs = Date.parse(point.capturedAt || '');
  const kickoffMs = Date.parse(match?.date || '');
  if (Number.isFinite(capturedMs) && Number.isFinite(kickoffMs) && capturedMs < kickoffMs) {
    const minutes = Math.max(1, Math.round((kickoffMs - capturedMs) / 60000));
    if (minutes >= 120) return `за ${Math.round(minutes / 60)} ч`;
    return `за ${minutes} мин`;
  }
  if (!Number.isFinite(capturedMs)) return '—';
  return new Date(capturedMs).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
}

function deltaView(point = {}, previous = null) {
  const leader = leaderFor(point.probabilities);
  const current = leader.probability;
  const backendDelta = finiteNumber(point?.delta?.value);
  const backendBase = finiteNumber(point?.delta?.previousProbability);
  let previousProbability = backendBase;
  let value = backendDelta;
  if (previous && (previousProbability === null || value === null)) {
    previousProbability = finiteNumber(previous?.probabilities?.[leader.key]);
    value = previousProbability === null || current === null ? null : Math.round((current - previousProbability) * 10) / 10;
  }
  if (value !== null) value = Math.round(value * 10) / 10;
  return {
    key: leader.key,
    current,
    previousProbability,
    value,
    direction: value === null || Math.abs(value) < .05 ? 'flat' : value > 0 ? 'up' : 'down',
  };
}

export function normalizeAiTimeline(timeline = {}, match = {}) {
  const sourcePoints = Array.isArray(timeline?.points) ? timeline.points : [];
  const exact = new Map();
  for (const raw of sourcePoints) {
    const capturedAt = safeIso(raw?.capturedAt ?? raw?.captured_at);
    const probabilities = normalizeProbabilities(raw?.probabilities || {
      home:raw?.home_prob,draw:raw?.draw_prob,away:raw?.away_prob,
    });
    if (!capturedAt || !probabilities) continue;
    const point = {
      ...raw,
      capturedAt,
      probabilities,
      minute: finiteNumber(raw?.minute ?? raw?.match_minute),
      confidence: finiteNumber(raw?.confidence ?? raw?.confidence_score),
      completeness: {
        score: finiteNumber(raw?.completeness?.score ?? raw?.completeness_score),
        max: finiteNumber(raw?.completeness?.max ?? raw?.completeness_max),
        percent: finiteNumber(raw?.completeness?.percent),
      },
      trigger: {
        category: String(raw?.trigger?.category ?? raw?.trigger_category ?? 'model_update'),
        relation: String(raw?.trigger?.relation ?? raw?.causal_relation ?? 'model_driven'),
        label: String(raw?.trigger?.label || ''),
        explanation: String(raw?.trigger?.explanation ?? raw?.explanation ?? ''),
      },
      stale: Boolean(raw?.stale || raw?.provenance?.stale),
      source: String(raw?.source || ''),
    };
    const key = capturedAt;
    const existing = exact.get(key);
    if (!existing || (existing.source === 'model_predictions' && point.source !== 'model_predictions')) exact.set(key,point);
  }

  const sorted = [...exact.values()].sort((a,b) => Date.parse(a.capturedAt)-Date.parse(b.capturedAt));
  const points = [];
  for (const point of sorted) {
    const previous = points.at(-1);
    if (
      previous
      && sameProbabilities(previous.probabilities, point.probabilities)
      && Math.abs(Date.parse(point.capturedAt)-Date.parse(previous.capturedAt)) <= 120000
      && (previous.source === 'model_predictions' || point.source === 'model_predictions')
    ) {
      if (previous.source === 'model_predictions' && point.source !== 'model_predictions') points[points.length-1]=point;
      continue;
    }
    points.push(point);
  }

  for (let index=0; index<points.length; index+=1) {
    const point=points[index];
    point.deltaView=deltaView(point,index ? points[index-1] : null);
    const score=point.completeness.score, max=point.completeness.max;
    if (point.completeness.percent === null && score !== null && max !== null && max>0) {
      point.completeness.percent=Math.max(0,Math.min(100,Math.round(score/max*100)));
    }
  }

  const marketContext=(Array.isArray(timeline?.marketContext)?timeline.marketContext:[])
    .filter(row=>safeIso(row?.capturedAt))
    .sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt));

  return {
    available: points.length>0,
    points,
    marketContext,
    note:String(timeline?.note || ''),
    match,
  };
}

function probabilityLine(point, previous, match) {
  const view=point.deltaView || deltaView(point,previous);
  const label=outcomeLabel(view.key,match);
  const current=view.current===null?'—':`${Number(view.current).toFixed(1)}%`;
  if (view.previousProbability===null || view.value===null) return `${escapeHtml(label)} · ${current}`;
  const arrow=view.direction==='up'?'↑':view.direction==='down'?'↓':'→';
  const sign=view.value>0?'+':'';
  return `${escapeHtml(label)} · ${Number(view.previousProbability).toFixed(1)}% → ${current} <b class="ai-timeline-delta ${view.direction}">${arrow} ${sign}${Number(view.value).toFixed(1)} п.п.</b>`;
}

function qualityHtml(point={}) {
  const bits=[];
  if (point.confidence!==null) bits.push(`Уверенность ${Math.round(Number(point.confidence))}%`);
  if (point.completeness?.percent!==null) bits.push(`Данные ${Math.round(Number(point.completeness.percent))}%`);
  if (point.stale) bits.push('Есть устаревший источник');
  return bits.length ? `<small class="ai-timeline-quality">${bits.map(escapeHtml).join(' · ')}</small>` : '';
}

function triggerHtml(point={}) {
  const relation=relationClass(point.trigger?.relation);
  const label=point.trigger?.label || relationLabel(relation);
  const explanation=point.trigger?.explanation || (relation==='model_driven'?'Модель переоценила матч после обновления входных данных.':'');
  return `<div class="ai-timeline-reason"><span class="${relation}">${escapeHtml(relationLabel(relation))}</span><strong>${escapeHtml(label)}</strong>${explanation?`<p>${escapeHtml(explanation)}</p>`:''}</div>`;
}

export function renderAiTimelineCompact(timeline = {}, match = {}) {
  const model=normalizeAiTimeline(timeline,match);
  if (!model.available) return '';
  const point=model.points.at(-1);
  const previous=model.points.length>1?model.points.at(-2):null;
  return `<section class="panel ai-timeline-compact" aria-label="AI Timeline: история сохранённых оценок">
    <div class="ai-timeline-head">
      <div><span>🧠 AI TIMELINE</span><h2>Как менялась оценка</h2></div>
      <b>${model.points.length} ${model.points.length===1?'точка':'точки'}</b>
    </div>
    <div class="ai-timeline-current">
      <span>${escapeHtml(pointTime(point,match))}</span>
      <strong>${probabilityLine(point,previous,match)}</strong>
    </div>
    ${triggerHtml(point)}
    ${qualityHtml(point)}
  </section>`;
}

function pointHtml(point,index,points,match) {
  const previous=index?points[index-1]:null;
  const source=point.source==='model_predictions'?'Первый предматчевый снимок':'Сохранённый AI-снимок';
  return `<article class="ai-timeline-point ${point.stale?'is-stale':''}">
    <div class="ai-timeline-rail"><i></i><b></b></div>
    <div class="ai-timeline-point-body">
      <div class="ai-timeline-point-top"><span>${escapeHtml(pointTime(point,match))}</span><small>${escapeHtml(source)}</small></div>
      <strong class="ai-timeline-probability">${probabilityLine(point,previous,match)}</strong>
      ${triggerHtml(point)}
      ${qualityHtml(point)}
    </div>
  </article>`;
}

function marketContextHtml(rows=[],match={}) {
  if (!rows.length) return '';
  const recent=rows.slice(-4);
  return `<div class="ai-timeline-market-context">
    <strong>Рыночный контекст</strong>
    <p>Это сохранённые рыночные вероятности, а не точки AI-модели.</p>
    <div>${recent.map(row=>{
      const probs=normalizeProbabilities(row?.probabilities || {});
      if (!probs) return '';
      const leader=leaderFor(probs);
      return `<span><b>${escapeHtml(pointTime({capturedAt:row.capturedAt},match))}</b> ${escapeHtml(outcomeLabel(leader.key,match))} ${Number(leader.probability).toFixed(1)}%</span>`;
    }).join('')}</div>
  </div>`;
}

export function renderAiTimelineDetails(timeline = {}, match = {}) {
  const model=normalizeAiTimeline(timeline,match);
  if (!model.available) return '';
  return `<details class="panel ai-timeline-details">
    <summary><span>История AI</span><b>${model.points.length} сохранённых точек</b></summary>
    <div class="ai-timeline-details-body">
      <p class="ai-timeline-method">Показываются только реально сохранённые состояния модели. «Совпало по времени» не означает, что событие вызвало изменение вероятности.</p>
      <div class="ai-timeline-list">${model.points.map((point,index)=>pointHtml(point,index,model.points,match)).join('')}</div>
      ${marketContextHtml(model.marketContext,match)}
      ${model.note?`<p class="tiny warning">${escapeHtml(model.note)}</p>`:''}
    </div>
  </details>`;
}
