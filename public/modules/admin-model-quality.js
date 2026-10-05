export function createAdminModelQualityModule({
  state,
  elementById,
  isAdmin,
  escapeHtml,
  humanizeTechnicalText,
  technicalStateLabel,
  russianCountLabel,
  dateTime,
  outcomeShortLabel,
  api,
}) {
  if (!state || typeof elementById !== 'function' || typeof isAdmin !== 'function' || typeof api !== 'function') {
    throw new TypeError('Admin Model Quality requires state, elementById, isAdmin and api.');
  }

  const $ = elementById;

  function percentClass(axis,value) {
    const n=Number(value);
    const safe=Number.isFinite(n) ? Math.max(0,Math.min(100,n)) : 0;
    return `pct-${axis}-${Math.round(safe)}`;
  }

  function qualityPct(value) {
    return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : '—';
  }
  
  function qualityNum(value, digits = 3) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
  }
  
  function signalLabel(name) {
    const labels = { market: 'Рынок', apiPrediction: 'Прогноз источника данных', recentForm: 'Форма', h2h: 'Очные встречи' };
    return labels[String(name || '')] || String(name || 'Сигнал');
  }

  function renderModelQuality() {
    const status = $('modelQualityStatus');
    const badge = $('modelQualitySampleBadge');
    const headline = $('modelQualityHeadline');
    const calibration = $('modelQualityCalibration');
    const engine = $('modelQualityEngine');
    const confidence = $('modelQualityConfidence');
    const secondary = $('modelQualitySecondary');
    const dashboard = $('modelQualityDashboard');
    const recent = $('modelQualityRecent');
    if (!status || !badge || !headline || !calibration || !engine || !confidence || !secondary || !dashboard || !recent) return;
  
    const q = state.modelQuality;
    if (state.modelQualityLoading) {
      status.textContent = 'Загружаю историческую проверку…';
      badge.textContent = 'Загрузка';
      [headline, calibration, engine, confidence, secondary, dashboard, recent].forEach(x => x.hidden = true);
      return;
    }
    if (!q) {
      status.textContent = 'Данные ещё не загружены.';
      badge.textContent = 'Нет данных';
      [headline, calibration, engine, confidence, secondary, dashboard, recent].forEach(x => x.hidden = true);
      return;
    }
    if (q.available === false) {
      status.textContent = q.reason || 'Историческая проверка пока недоступна.';
      badge.textContent = 'Нужна миграция';
      [headline, calibration, engine, confidence, secondary, dashboard, recent].forEach(x => x.hidden = true);
      return;
    }
  
    const sample = q.sample || {};
    const h = q.headline || {};
    const excludedText = Number(sample.excluded || 0) > 0 ? ` · ${Number(sample.excluded)} исключено проверкой целостности` : '';
    badge.textContent = sample.ready ? russianCountLabel(sample.settled || 0, 'матч', 'матча', 'матчей') : `${sample.settled || 0} / 20 матчей`;
    badge.classList.toggle('ready', Boolean(sample.ready));
    status.textContent = sample.settled
      ? `${sample.settled} проверенных прогнозов · ${sample.pending || 0} ожидают результата${excludedText}${sample.calibrationReady ? ' · калибровка уже информативнее' : ''}`
      : `Пока нет проверенных завершённых прогнозов${excludedText}. Новые предматчевые анализы будут автоматически попадать в историческую проверку.`;
  
    headline.hidden = false;
    headline.innerHTML = `
      <div><span>Точность П1 / Н / П2</span><strong>${qualityPct(h.accuracy)}</strong><small>максимальная вероятность</small></div>
      <div><span>Ошибка Брайера</span><strong>${qualityNum(h.avgBrier)}</strong><small>ниже — лучше</small></div>
      <div><span>Логарифмическая ошибка</span><strong>${qualityNum(h.avgLogLoss)}</strong><small>штраф за уверенные ошибки</small></div>
      <div><span>Средняя уверенность</span><strong>${qualityPct(h.avgTopProbability)}</strong><small>уверенность лидера</small></div>`;
  
    calibration.hidden = false;
    calibration.innerHTML = `
      <div class="quality-block-head"><strong>Калибровка вероятностей</strong><span>прогноз и факт</span></div>
      <div class="quality-calibration-list">${(q.calibration || []).map(x => `
        <div class="quality-cal-row">
          <span>${escapeHtml(x.label)}</span>
          <div class="quality-cal-bars"><i class="${percentClass('w',x.avgPredicted)}"></i><b class="${percentClass('w',x.hitRate)}"></b></div>
          <strong>${x.sample ? `${qualityPct(x.hitRate)} · выборка ${x.sample}` : '—'}</strong>
        </div>`).join('')}</div>
      ${q.methodology?.warning ? `<p class="quality-warning">⚠️ ${escapeHtml(humanizeTechnicalText(q.methodology.warning))}</p>` : ''}`;
  
    const ce = q.calibrationEngine || {};
    const impact = q.calibrationImpact || {};
    const modeLabel = ce.mode === 'active' ? 'Активен' : ce.mode === 'shadow' ? 'Наблюдение' : 'Базовый';
    const weightValidation = ce.weightsValidation || {};
    const promotion = ce.promotionGate || {};
    const lifecycle = ce.lifecycle || {};
    const lifecycleLabel = lifecycle.status === 'frozen'
      ? 'ЗАМОРОЖЕНО'
      : lifecycle.status === 'promoted'
      ? 'НОВАЯ АКТИВНАЯ МОДЕЛЬ'
      : lifecycle.status === 'active'
        ? 'АКТИВНА'
        : lifecycle.status === 'held'
          ? 'КАНДИДАТ УДЕРЖАН'
          : lifecycle.status === 'shadow'
            ? 'КАНДИДАТ В ТЕНИ'
            : lifecycle.available === false
              ? 'НУЖНА МИГРАЦИЯ'
              : 'БАЗОВАЯ';
    const promotionLabel = promotion.status === 'promoted'
      ? 'РАЗРЕШЕНО'
      : promotion.status === 'held'
        ? 'УДЕРЖАНО'
        : promotion.status === 'shadow'
          ? 'НАБЛЮДЕНИЕ'
          : 'БАЗОВЫЙ';
    const signalRows = (q.signalPerformance || []).some(x => Number(x.sample || 0) > 0) ? (q.signalPerformance || []) : (q.signals || []);
    engine.hidden = false;
    engine.innerHTML = `
      <div class="quality-block-head"><strong>⚙️ Калибратор вероятностей</strong><span class="calibration-mode ${escapeHtml(ce.mode || 'baseline')}">${modeLabel}</span></div>
      <div class="calibration-engine-grid">
        <div><span>Режим</span><strong>${modeLabel}</strong><small>${ce.mode === 'active' ? 'коррекции разрешены защитными правилами' : ce.mode === 'shadow' ? 'измеряет, но не меняет прогноз' : 'базовые веса'}</small></div>
        <div><span>Температура</span><strong>${Number.isFinite(Number(ce.temperature)) ? Number(ce.temperature).toFixed(2) : '1.00'}</strong><small>1.00 = без сжатия вероятностей</small></div>
        <div><span>Историческая проверка</span><strong>${Number(ce.sample || 0)}</strong><small>завершённых снимков</small></div>
        <div><span>Отложенная выборка температуры</span><strong>${Number(ce.temperatureValidation?.validationSample || 0)}</strong><small>${Number.isFinite(Number(ce.temperatureValidation?.improvement)) ? `${Number(ce.temperatureValidation.improvement).toFixed(1)}% логарифмической ошибки` : 'ещё нет проверки'}</small></div>
        <div><span>Отложенная выборка весов</span><strong>${Number(weightValidation.validationSample || 0)}</strong><small>${Number.isFinite(Number(weightValidation.brierGain)) ? `Δ Брайер ${Number(weightValidation.brierGain).toFixed(4)}` : 'ещё нет проверки'}</small></div>
        <div><span>Продвижение</span><strong>${promotionLabel}</strong><small>только доверенная отложенная выборка</small></div>
        <div><span>Жизненный цикл</span><strong>${lifecycleLabel}</strong><small>версия ${Number(lifecycle.revision || 0)}</small></div>
        <div><span>Отпечаток активной модели</span><strong>${escapeHtml(String(lifecycle.activeFingerprint || ce.fingerprint || '—').slice(0, 10))}</strong><small>${lifecycle.previousFingerprint ? `откат → ${escapeHtml(String(lifecycle.previousFingerprint).slice(0, 10))}` : 'предыдущей активной модели нет'}</small></div>
      </div>
      <div class="calibration-promotion-note"><strong>Защитная проверка:</strong> кандидат проходит два последовательных окна доверенной отложенной выборки, затем атомарно сравнивается с активной моделью. ${lifecycle.frozen ? `Жизненный цикл заморожен: ${escapeHtml(lifecycle.freezeReason || 'причина указана в административном журнале')}.` : 'После продвижения отдельная когорта может автоматически вернуть предыдущий профиль.'}</div>
      <div class="calibration-weights">
        ${(ce.signalStats || []).map(x => {
          const base = Number(x.baseWeight || 0) * 100;
          const current = Number(x.currentWeight ?? x.baseWeight ?? 0) * 100;
          return `<div class="calibration-weight-row"><span>${escapeHtml(signalLabel(x.name))}</span><div><i class="${percentClass('w',current)}"></i></div><strong>${base.toFixed(0)} → ${current.toFixed(1)}%</strong><small>выборка ${Number(x.sample || 0)}${Number.isFinite(Number(x.avgBrier)) ? ` · ошибка Брайера ${qualityNum(x.avgBrier)}` : ''}</small></div>`;
        }).join('')}
      </div>
      ${Number(impact.sample || 0) ? `<div class="calibration-impact"><span>Проверка v3.7: выборка ${Number(impact.sample || 0)}</span><strong>Ошибка Брайера ${qualityNum(impact.rawBrier)} → ${qualityNum(impact.finalBrier)}</strong><small>${Number(impact.brierDelta || 0) > 0 ? 'улучшение' : Number(impact.brierDelta || 0) < 0 ? 'ухудшение — автоматика будет видна в исторической проверке' : 'без изменения'}</small></div>` : '<p class="quality-engine-note">Эффект v3.7 появится после завершения первых матчей, рассчитанных этой версией.</p>'}
      <p class="quality-engine-note">${escapeHtml(humanizeTechnicalText(ce.note || 'Автокалибровка включается только после достаточной выборки.'))}</p>`;
  
    confidence.hidden = false;
    confidence.innerHTML = `
      <div class="quality-block-head"><strong>По уверенности модели</strong><span>не рейтинг, а диагностика</span></div>
      <div class="quality-mini-grid">${(q.confidence || []).map(x => `
        <div><span>${escapeHtml(x.label)}</span><strong>${qualityPct(x.accuracy)}</strong><small>матчей: ${Number(x.sample || 0)} · ошибка Брайера ${qualityNum(x.avgBrier)}</small></div>`).join('')}</div>
      <div class="quality-signal-grid">${signalRows.map(x => `
        <div><span>${escapeHtml(signalLabel(x.name))}</span><strong>${qualityPct(x.accuracy)}</strong><small>выборка ${Number(x.sample || 0)}${Number.isFinite(Number(x.avgBrier)) ? ` · ошибка Брайера ${qualityNum(x.avgBrier)}` : ''}</small></div>`).join('')}</div>`;
  
    const sec = q.secondary || {};
    secondary.hidden = false;
    secondary.innerHTML = `
      <div class="quality-block-head"><strong>Дополнительные рынки модели</strong><span>порог 50%</span></div>
      <div class="quality-secondary-grid">
        <div><span>ТБ 2.5</span><strong>${qualityPct(sec.over25?.accuracy)}</strong><small>матчей: ${Number(sec.over25?.sample || 0)}</small></div>
        <div><span>Обе забьют</span><strong>${qualityPct(sec.btts?.accuracy)}</strong><small>матчей: ${Number(sec.btts?.sample || 0)}</small></div>
      </div>`;
  
    const db = q.dashboard || {};
    dashboard.hidden = false;
    if (!db.overview || !Number(db.overview.sample || 0)) {
      dashboard.innerHTML = '<div class="empty compact-empty">Панель модели заполнится после завершения первых прогнозов.</div>';
    } else {
      const ov = db.overview || {};
      const trendMaxSample = Math.max(1, ...(db.trend || []).map(x => Number(x.sample || 0)));
      const leagues = db.leagues || [];
      dashboard.innerHTML = `
        <div class="quality-block-head"><strong>📊 Панель качества модели</strong><span>${Number(db.periodDays || q.periodDays || 90)} дней</span></div>
  
        <div class="model-dash-kpis">
          <div><span>Снимки</span><strong>${Number(ov.sample || 0)}</strong><small>завершено</small></div>
          <div><span>Точность</span><strong>${qualityPct(ov.accuracy)}</strong><small>П1 / Н / П2</small></div>
          <div><span>Ошибка Брайера</span><strong>${qualityNum(ov.avgBrier)}</strong><small>ниже лучше</small></div>
          <div><span>Разрыв</span><strong>${Number.isFinite(Number(ov.calibrationGap)) ? `${Number(ov.calibrationGap).toFixed(1)} п.п.` : '—'}</strong><small>уверенность − точность</small></div>
          <div><span>Ошибка калибровки</span><strong>${Number.isFinite(Number(q.calibrationDiagnostics?.weightedTopCalibrationError)) ? `${Number(q.calibrationDiagnostics.weightedTopCalibrationError).toFixed(1)} п.п.` : '—'}</strong><small>взвешенно · 5 групп</small></div>
        </div>
  
        <div class="model-dash-section">
          <div class="model-dash-section-head"><strong>Тренд по неделям</strong><span>точность + размер выборки; ошибка Брайера указана текстом</span></div>
          ${(db.trend || []).length ? `<div class="model-trend-chart">${db.trend.map(x => {
            const acc = Math.max(2, Math.min(100, Number(x.accuracy || 0)));
            const sampleH = Math.max(8, Math.round(Number(x.sample || 0) / trendMaxSample * 100));
            return `<div class="model-trend-col" title="${escapeHtml(x.label)} · выборка ${Number(x.sample || 0)} · ${qualityPct(x.accuracy)}">
              <div class="model-trend-bars"><i class="${percentClass('h',acc)}"></i><b class="${percentClass('h',sampleH)}"></b></div>
              <strong>${qualityPct(x.accuracy)}</strong>
              <span>${escapeHtml(x.label)}</span>
              <small>выборка ${Number(x.sample || 0)} · Ошибка Брайера ${qualityNum(x.avgBrier)}</small>
            </div>`;
          }).join('')}</div>` : '<div class="empty compact-empty">Пока недостаточно недельных данных.</div>'}
        </div>
  
        <div class="model-dash-section">
          <div class="model-dash-section-head"><strong>Диапазоны уверенности</strong><span>проверяем, растёт ли качество с уверенностью</span></div>
          <div class="model-band-list">${(db.confidence || []).map(x => `
            <div class="model-band-row">
              <span>${escapeHtml(x.label)}</span>
              <div><i class="${percentClass('w',x.accuracy)}"></i></div>
              <strong>${x.sample ? qualityPct(x.accuracy) : '—'}</strong>
              <small>выборка ${Number(x.sample || 0)} · Ошибка Брайера ${qualityNum(x.avgBrier)}</small>
            </div>`).join('')}</div>
        </div>
  
        <div class="model-dash-section">
          <div class="model-dash-section-head"><strong>Полнота данных</strong><span>влияет ли богатство входных данных</span></div>
          <div class="model-dash-mini-grid">${(db.completeness || []).map(x => `
            <div><span>${escapeHtml(x.label)}</span><strong>${qualityPct(x.accuracy)}</strong><small>матчей: ${Number(x.sample || 0)} · ошибка Брайера ${qualityNum(x.avgBrier)}</small></div>`).join('')}</div>
        </div>
  
        <div class="model-dash-section">
          <div class="model-dash-section-head"><strong>Лиги</strong><span>сортировка по размеру выборки</span></div>
          ${leagues.length ? `<div class="model-league-table">${leagues.map(x => `
            <div class="model-league-row">
              <div><strong>${escapeHtml(x.leagueName || x.label)}</strong><small>матчей: ${Number(x.sample || 0)} · уверенность ${qualityPct(x.avgConfidence)}</small></div>
              <span>${qualityPct(x.accuracy)}</span>
              <span>Ошибка Брайера ${qualityNum(x.avgBrier)}</span>
              <em>${Number.isFinite(Number(x.calibrationGap)) ? `${Number(x.calibrationGap) >= 0 ? '+' : ''}${Number(x.calibrationGap).toFixed(1)} п.п.` : '—'}</em>
            </div>`).join('')}</div>` : '<div class="empty compact-empty">Лиг для сравнения пока нет.</div>'}
        </div>
  
        <div class="model-dash-section">
          <div class="model-dash-section-head"><strong>Исходы модели</strong><span>описательный срез П1 / X / П2</span></div>
          <div class="model-dash-mini-grid">${(db.outcomes || []).map(x => `
            <div>
              <span>${escapeHtml(x.label)}</span>
              <strong>${x.sample ? qualityPct(x.accuracy) : '—'}</strong>
              <small>матчей: ${Number(x.sample || 0)} · ошибка Брайера ${qualityNum(x.avgBrier)}</small>
            </div>`).join('')}</div>
        </div>
  
        <div class="model-dash-section">
          <div class="model-dash-section-head"><strong>Сравнение версий</strong><span>без рейтинга и автоматического продвижения</span></div>
          ${(db.versions || []).length ? `<div class="model-version-table">${db.versions.map(x => `
            <div class="model-version-row">
              <div>
                <strong>${escapeHtml(x.version || 'старая / неизвестная')}</strong>
                <small>матчей: ${Number(x.sample || 0)} · ${x.firstKickoffAt ? escapeHtml(dateTime(x.firstKickoffAt)) : '—'} → ${x.lastKickoffAt ? escapeHtml(dateTime(x.lastKickoffAt)) : '—'}</small>
              </div>
              <div><span>Точность</span><b>${qualityPct(x.accuracy)}</b></div>
              <div><span>Ошибка Брайера</span><b>${qualityNum(x.avgBrier)}</b></div>
              <div><span>Логарифмическая ошибка</span><b>${qualityNum(x.avgLogLoss)}</b></div>
              <div><span>Ошибка калибровки</span><b>${Number.isFinite(Number(x.calibrationError)) ? `${Number(x.calibrationError).toFixed(1)} п.п.` : '—'}</b></div>
              <div><span>Сигналы</span><b>${qualityPct(x.signalSnapshotCoverage)}</b></div>
            </div>`).join('')}</div>` : '<div class="empty compact-empty">Сравнение версий пока не сформировано.</div>'}
          <p class="quality-engine-note">Разрез показывает исторические когорты версия анализа. Различия могут быть связаны с периодом, лигами и составом данных; интерфейс не выбирает победителя.</p>
        </div>
  
        <div class="model-dash-section">
          <div class="model-dash-section-head"><strong>Качество отдельных сигналов</strong><span>источник отдельно и итоговая смесь</span></div>
          <div class="model-signal-table">${(db.signals || []).map(x => `
            <div class="model-signal-row">
              <div><strong>${escapeHtml(signalLabel(x.name))}</strong><small>выборка ${Number(x.sample || 0)} · базовый вес ${Number(x.baseWeight || 0).toFixed(0)}%</small></div>
              <div><span>Источник</span><b>${qualityPct(x.signalAccuracy)}</b><small>Брайер ${qualityNum(x.signalBrier)}</small></div>
              <div><span>Итог</span><b>${qualityPct(x.finalAccuracy)}</b><small>Брайер ${qualityNum(x.finalBrier)}</small></div>
              <em class="${Number(x.brierDeltaVsBlend || 0) <= 0 ? 'good' : 'watch'}">${Number.isFinite(Number(x.brierDeltaVsBlend)) ? `${Number(x.brierDeltaVsBlend) >= 0 ? '+' : ''}${Number(x.brierDeltaVsBlend).toFixed(3)}` : '—'}</em>
            </div>`).join('')}</div>
        </div>
  
        ${(db.calibrationModes || []).length ? `<div class="model-dash-section">
          <div class="model-dash-section-head"><strong>Режимы калибратора</strong><span>описательный срез, версии модели различаются</span></div>
          <div class="model-dash-mini-grid">${db.calibrationModes.map(x => `<div><span>${escapeHtml(x.label)}</span><strong>${qualityPct(x.accuracy)}</strong><small>матчей: ${Number(x.sample || 0)} · ошибка Брайера ${qualityNum(x.avgBrier)}</small></div>`).join('')}</div>
        </div>` : ''}
  
        <div class="model-dash-section">
          <div class="model-dash-section-head"><strong>🧪 Целостность прогнозов</strong><span>${escapeHtml(technicalStateLabel(q.integrity?.label || 'нет данных'))}</span></div>
          <div class="model-integrity-summary ${escapeHtml(q.integrity?.status || 'clean')}">
            <div><span>Загружено</span><strong>${Number(q.integrity?.loadedRows || 0)}</strong><small>завершённые + ожидающие</small></div>
            <div><span>Критические</span><strong>${Number(q.integrity?.severeIssues || 0)}</strong><small>вероятности / время / согласованность</small></div>
            <div><span>Предупреждения</span><strong>${Number(q.integrity?.warningIssues || 0)}</strong><small>фиксация результата / исход</small></div>
            <div><span>Информация</span><strong>${Number(q.integrity?.informationalIssues || 0)}</strong><small>устаревшие метаданные</small></div>
          </div>
          <div class="model-integrity-list">${(q.integrity?.checks || []).map(x => `
            <div class="${escapeHtml(x.state || 'info')}">
              <i>${x.state === 'pass' ? '✓' : x.state === 'fail' ? '×' : x.state === 'warn' ? '!' : 'i'}</i>
              <span><strong>${escapeHtml(humanizeTechnicalText(x.label || ''))}</strong><small>${escapeHtml(humanizeTechnicalText(x.detail || ''))}</small></span>
              <em>${Number(x.count || 0)}</em>
            </div>`).join('')}</div>
          ${q.integrity?.truncatedPotentially ? '<div class="data-notice stale">Выборка достигла лимита административного запроса: проверка целостности относится к загруженным строкам, а не ко всей истории.</div>' : ''}
          <p class="quality-engine-note">${escapeHtml(humanizeTechnicalText(q.integrity?.note || ''))}</p>
        </div>
  
        <div class="model-dash-section">
          <div class="model-dash-section-head"><strong>Наблюдения для проверки</strong><span>ничего не меняют автоматически</span></div>
          <div class="model-observations">${(db.observations || []).map(x => `
            <div class="${escapeHtml(x.level || 'info')}"><span>${x.level === 'good' ? '✓' : x.level === 'warn' ? '!' : x.level === 'watch' ? '↗' : 'i'}</span><div><strong>${escapeHtml(humanizeTechnicalText(x.title || ''))}</strong><p>${escapeHtml(humanizeTechnicalText(x.text || ''))}</p></div></div>`).join('')}</div>
          <p class="quality-engine-note">${escapeHtml(humanizeTechnicalText(db.note || ''))}</p>
        </div>`;
    }
  
    recent.hidden = false;
    if (!(q.recent || []).length) {
      recent.innerHTML = '<div class="empty compact-empty">Завершённых прогнозов пока нет.</div>';
    } else {
      recent.innerHTML = `
        <div class="quality-block-head"><strong>Последние проверки</strong><span>${Number(q.periodDays || state.modelQualityDays)} дней</span></div>
        <div class="quality-recent-list">${q.recent.map(x => `
          <div class="quality-recent-row ${x.correct ? 'hit' : 'miss'}">
            <div><strong>${escapeHtml(x.home)} — ${escapeHtml(x.away)}</strong><span>${escapeHtml(x.league || '')}${x.kickoffAt ? ` · ${escapeHtml(dateTime(x.kickoffAt))}` : ''}${x.analysisVersion ? ` · ${escapeHtml(x.analysisVersion)}` : ''}</span></div>
            <div class="quality-result"><b>${escapeHtml(x.score)}</b><small>${escapeHtml(x.predictedLabel || outcomeShortLabel(x.predictedOutcome))} · ${qualityPct(x.topProbability)}</small></div>
            <em>${x.correct ? '✓' : '×'}</em>
          </div>`).join('')}</div>`;
    }
  }
  
  async function loadModelQuality(force = false) {
    if (!isAdmin()) return;
    if (state.modelQualityLoading) return;
    const days = Number($('modelQualityPeriod')?.value || state.modelQualityDays || 90);
    state.modelQualityDays = days;
    if (!force && state.modelQuality && Number(state.modelQuality.periodDays || days) === days) {
      renderModelQuality();
      return;
    }
    state.modelQualityLoading = true;
    renderModelQuality();
    try {
      state.modelQuality = await api(`/api/model-quality?days=${days}${force ? '&refresh=1' : ''}`);
    } catch (e) {
      state.modelQuality = { available: false, reason: e.message || 'Не удалось загрузить историческую проверку.' };
    } finally {
      state.modelQualityLoading = false;
      renderModelQuality();
    }
  }

  return Object.freeze({
    renderModelQuality,
    loadModelQuality,
  });
}
