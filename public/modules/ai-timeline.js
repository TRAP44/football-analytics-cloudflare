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
    ${chartFromModel(model,match)}
    ${triggerHtml(point)}
    ${qualityHtml(point)}
  </section>`;
}


function chartFromModel(model, match = {}) {
  // Render only real, non-stale snapshots with coherent 1X2 probability totals.
  // The renderer never interpolates or invents stored model measurements.
  const snapshots=model.points.filter(point=>{
    if (point.stale) return false;
    const values=['home','draw','away'].map(key=>finiteNumber(point.probabilities?.[key]));
    return values.every(value=>value!==null && value>=0 && value<=100)
      && Math.abs(values.reduce((sum,value)=>sum+value,0)-100)<=1.2;
  });
  if (snapshots.length<2) {
    return '<p class="ai-prob-chart-unavailable">Для графика нужны минимум два сохранённых прогноза без устаревших данных.</p>';
  }
  const from=Date.parse(snapshots[0].capturedAt);
  const to=Date.parse(snapshots.at(-1).capturedAt);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to<=from) {
    return '<p class="ai-prob-chart-unavailable">История прогнозов пока недостаточна для графика.</p>';
  }
  const keys=[
    {key:'home',css:'home',label:String(match?.home?.name || 'П1')},
    {key:'draw',css:'draw',label:'Ничья'},
    {key:'away',css:'away',label:String(match?.away?.name || 'П2')},
  ];
  const x=point=>38+(Date.parse(point.capturedAt)-from)/(to-from)*587;
  const y=value=>148-value/100*132;
  const coordinate=value=>Number(value).toFixed(2);
  const grid=[0,50,100].map(value=>'<line class="ai-prob-grid" x1="38" y1="'
    +coordinate(y(value))+'" x2="625" y2="'+coordinate(y(value))+'"/>'
    +'<text class="ai-prob-axis" x="31" y="'+coordinate(y(value)+3)
    +'" text-anchor="end">'+value+'</text>').join('');
  const paths=keys.map(item=>{
    const path=snapshots.map((point,index)=>
      (index===0?'M':'L')+coordinate(x(point))+' '+coordinate(y(point.probabilities[item.key]))
    ).join(' ');
    const last=snapshots.at(-1);
    return '<path class="ai-prob-line '+item.css+'" d="'+path+'" />'
      +'<circle class="ai-prob-dot '+item.css+'" cx="'+coordinate(x(last))
      +'" cy="'+coordinate(y(last.probabilities[item.key]))+'" r="3.5" />';
  }).join('');
  const latest=snapshots.at(-1).probabilities;
  const legend=keys.map(item=>'<div class="ai-prob-legend-item '+item.css+'">'
    +'<i aria-hidden="true"></i><span>'+escapeHtml(item.label)
    +'</span><strong>'+Number(latest[item.key]).toFixed(1)+'%</strong></div>').join('');
  const accessible='Реальная история AI-прогнозов: '+snapshots.length
    +' сохранённых оценок. Последняя: '
    +keys.map(item=>item.label+' '+Number(latest[item.key]).toFixed(1)+'%').join(', ')+'.';
  return '<figure class="ai-prob-chart">'
    +'<div class="ai-prob-chart-heading"><strong>Вероятности П1 / Н / П2</strong>'
    +'<small>'+snapshots.length+' сохранённых снимков</small></div>'
    +'<svg viewBox="0 0 640 176" class="ai-prob-chart-svg" role="img" aria-label="'
    +escapeHtml(accessible)+'">'
    +grid+paths
    +'<text class="ai-prob-axis" x="38" y="170" text-anchor="start">'
    +escapeHtml(pointTime(snapshots[0],match))+'</text>'
    +'<text class="ai-prob-axis" x="625" y="170" text-anchor="end">'
    +escapeHtml(pointTime(snapshots.at(-1),match))+'</text>'
    +'</svg>'
    +'<div class="ai-prob-legend" aria-label="Последние сохранённые вероятности">'+legend+'</div>'
    +'<figcaption>Показаны только фактически сохранённые оценки модели. Линии соединяют снимки; '
    +'между ними измерений нет. Это не вероятность, рассчитанная для каждой минуты.</figcaption>'
    +'</figure>';
}

export function renderAiProbabilityChart(timeline = {}, match = {}) {
  return chartFromModel(normalizeAiTimeline(timeline,match),match);
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
