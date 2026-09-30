export function createAiTrackRecordRenderer({
  state,
  elementById,
  escapeHtml,
  dateTime,
  onRetry,
}) {
  if (!state || typeof elementById !== 'function') {
    throw new TypeError('AI Track Record renderer requires state and elementById.');
  }

  const $ = elementById;
  const retry = typeof onRetry === 'function' ? onRetry : () => {};

  function renderAiTrackRecord() {
    const el=$('aiTrackRecord');
    if (!el) return;
    if (state.aiTrackRecordLoading && !state.aiTrackRecordLoaded) {
      el.innerHTML='<div class="loader compact-loader">Проверяю подтверждённую историю AI…</div>';
      return;
    }
    if (state.aiTrackRecordError && !state.aiTrackRecordLoaded) {
      el.innerHTML=`<div class="ai-track-record-error"><strong>Протокол AI временно недоступен</strong><p>${escapeHtml(state.aiTrackRecordError)}</p><button id="aiTrackRetry" class="secondary-btn" type="button">Повторить</button></div>`;
      $('aiTrackRetry')?.addEventListener('click',()=>retry(true));
      return;
    }
    const r=state.aiTrackRecord;
    if (!r?.available) {
      el.innerHTML='<div class="ai-track-record-empty"><strong>Протокол AI формируется</strong><p>Подтверждённые результаты появятся здесь после проверки завершённых матчей.</p></div>';
      return;
    }
    const sample=r.sample || {};
    const quality=r.probabilityQuality || {};
    const recent=Array.isArray(r.recent)?r.recent:[];
    const brier=Number.isFinite(Number(quality.avgBrier))?Number(quality.avgBrier).toFixed(3):'—';
    const sampleClass=sample.state==='early'?'early':sample.state==='forming'?'forming':sample.state==='informative'?'informative':'empty';
    const notice=state.aiTrackRecordError
      ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.aiTrackRecordError)} Показана последняя загруженная версия.</div>`
      : '';
    el.innerHTML=`
      ${notice}
      <section class="panel ai-track-card">
        <div class="ai-track-head">
          <div><span>📈 ПРОТОКОЛ MatchRadar</span><h2>Проверенная история модели</h2></div>
          <b class="ai-track-sample ${sampleClass}">${escapeHtml(sample.label || '—')}</b>
        </div>
        <p class="ai-track-intro">Только неизменяемые предматчевые прогнозы с подтверждённым финальным результатом. Здесь нет рекламного «процента побед».</p>
        <div class="ai-track-kpis">
          <div><span>Проверено</span><strong>${Number(sample.verified || 0)}</strong><small>матчей</small></div>
          <div><span>Совпало</span><strong>${Number(sample.matched || 0)}</strong><small>основной исход</small></div>
          <div><span>Не совпало</span><strong>${Number(sample.missed || 0)}</strong><small>основной исход</small></div>
          <div><span>Брайер</span><strong>${brier}</strong><small>ниже — лучше</small></div>
        </div>
        <p class="ai-track-sample-note">${escapeHtml(sample.message || '')}</p>
        ${recent.length?`<div class="ai-track-recent">
          <div class="ai-track-block-head"><strong>Последние подтверждённые прогнозы</strong><span>${Number(r.periodDays || 180)} дней</span></div>
          ${recent.map(row=>`<div class="ai-track-row">
            <span class="ai-track-result ${row.matched?'hit':'miss'}">${row.matched?'✓':'✕'}</span>
            <div><strong>${escapeHtml(row.home)} — ${escapeHtml(row.away)}</strong><small>${escapeHtml(row.league || '')}${row.kickoffAt?` · ${dateTime(row.kickoffAt)}`:''}</small></div>
            <div class="ai-track-outcome"><strong>${escapeHtml(row.score)}</strong><small>AI: ${escapeHtml(row.predictedLabel || '—')}${Number.isFinite(Number(row.topProbability))?` · ${Number(row.topProbability)}%`:''} → ${escapeHtml(row.actualLabel || '—')}</small></div>
          </div>`).join('')}
        </div>`:''}
        <div class="ai-track-method">
          <strong>Что означает Брайер?</strong>
          <p>${escapeHtml(quality.explanation || '')}</p>
          <small>${escapeHtml(r.methodology?.disclaimer || '')}</small>
        </div>
      </section>`;
  }

  return Object.freeze({ renderAiTrackRecord });
}
