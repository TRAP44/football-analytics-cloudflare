export function createAnalysisPresentationModule(deps = {}) {
  const {
    $,
    absenceKindLabel,
    absenceStatusLabel,
    analysisAccessUsageHtml,
    analysisHistoryForFixture,
    analyzeMatch,
    api,
    availabilityQualityHintHtml,
    calibrationModeLabel,
    dataPolicyModeLabel,
    dateTime,
    escapeHtml,
    favoriteStarSvg,
    isFavorite,
    launchIntentHandled,
    lineupPlayerName,
    lineupPlayerNumber,
    loadAiTrackRecord,
    loadFavorites,
    loadHistory,
    loadReminders,
    oddsQualityHintHtml,
    openHistoryAnalysis,
    openMatchCenter,
    openTeam,
    predictionAdviceLabel,
    publicText,
    renderDiscoveryHome,
    renderGlobalSearch,
    renderProfile,
    renderReminderList,
    runGlobalSearch,
    runtimeAllows,
    safeUrl,
    showView,
    state,
    tg,
    toast,
    toggleFavorite,
  } = deps;

  function pct(v) { return Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}%` : '—'; }
  
  function formSequence(form) {
    if (!form) return '—';
    return String(form).split('').map(x => x === 'W' ? 'П' : x === 'D' ? 'Н' : x === 'L' ? 'ПР' : x).join(' · ');
  }
  
  function likelyOutcomeDisplay(probabilities, fallback = '') {
    const rows = [Number(probabilities?.home), Number(probabilities?.draw), Number(probabilities?.away)]
      .filter(Number.isFinite)
      .sort((a, b) => b - a);
    if (rows.length === 3 && rows[0] - rows[1] < 1) return 'Нет явного фаворита';
    return String(fallback || 'Недостаточно данных');
  }
  
  function formCard(title, form) {
    const o = form?.overall;
    const v = form?.venue;
    if (!o?.sample) return `<div class="form-team-card"><strong>${escapeHtml(title)}</strong><p class="muted">Недостаточно данных по последним матчам.</p></div>`;
    return `<div class="form-team-card">
      <strong>${escapeHtml(title)}</strong>
      <div class="form-sequence">${escapeHtml(formSequence(o.form))}</div>
      <div class="mini-metrics">
        <span><b>${o.ppg}</b><small>очки/матч</small></span>
        <span><b>${o.gfAvg}</b><small>забито</small></span>
        <span><b>${o.gaAvg}</b><small>пропущено</small></span>
        <span><b>${o.over25Pct}%</b><small>ТБ 2.5</small></span>
      </div>
      ${v?.sample ? `<p class="muted">${form.preferredVenue === 'home' ? 'Дома' : 'В гостях'}: ${v.ppg} очка/матч · выборка ${v.sample}</p>` : ''}
    </div>`;
  }
  
  function modelWeightsText(weights = {}) {
    const names = { market: 'рынок', apiPrediction: 'прогноз источника', recentForm: 'форма', h2h: 'очные встречи' };
    const parts = Object.entries(weights).filter(([,v]) => Number(v) > 0).map(([k,v]) => `${names[k] || k} ${Number(v).toFixed(0)}%`);
    return parts.length ? parts.join(' · ') : 'Недостаточно сигналов';
  }
  
  function bullets(items = [], empty = 'Нет существенных факторов.') {
    if (!items?.length) return `<p class="muted">${escapeHtml(publicText(empty))}</p>`;
    return `<ul class="list analysis-list">${items.map(x => `<li>${escapeHtml(publicText(x))}</li>`).join('')}</ul>`;
  }
  
  function reminderFor(fixtureId) {
    return state.reminders.find(x => Number(x.fixtureId) === Number(fixtureId)) || null;
  }
  
  function hasReminder(fixtureId) {
    return Boolean(reminderFor(fixtureId));
  }
  
  function syncQuickReminderButton(button, fixtureId) {
    if (!button) return;
    const pending = state.reminderMutations.has(Number(fixtureId));
    const active = hasReminder(fixtureId);
    const minutes = Number(state.preferences?.reminderMinutes || 30);
    button.disabled = pending;
    button.classList.toggle('is-pending', pending);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.textContent = pending
      ? 'Сохраняю…'
      : active
        ? '🔔 Напоминание включено'
        : `🔔 Напомнить за ${minutes} мин.`;
  }
  
  function syncAllQuickReminderButtons() {
    document.querySelectorAll('.quick-reminder-btn[data-quick-reminder]').forEach(button => {
      syncQuickReminderButton(button, Number(button.dataset.quickReminder));
    });
  }
  
  function syncReminderMutationUi(fixtureId) {
    const pending = state.reminderMutations.has(Number(fixtureId));
    const button = $('reminderBtn');
    if (button && Number(state.currentAnalysis?.match?.fixtureId || 0) === Number(fixtureId)) {
      button.disabled = pending;
      button.classList.toggle('is-pending', pending);
    }
    document.querySelectorAll(`.reminder-remove[data-fixture-id="${Number(fixtureId)}"]`).forEach(el => {
      el.disabled = pending;
      el.classList.toggle('is-pending', pending);
    });
    document.querySelectorAll(`.quick-reminder-btn[data-quick-reminder="${Number(fixtureId)}"]`).forEach(el => {
      syncQuickReminderButton(el, fixtureId);
    });
  }
  
  async function toggleReminder(match) {
    if (!match?.fixtureId) return;
    const fixtureId = Number(match.fixtureId);
    if (state.reminderMutations.has(fixtureId)) return;
    const active = hasReminder(fixtureId);
    state.remindersLoadError = '';
    if (!active && !runtimeAllows('remindersEnabled')) {
      toast('Новые уведомления временно приостановлены.');
      return;
    }
    state.reminderMutations.add(fixtureId);
    syncReminderMutationUi(fixtureId);
    try {
      if (active) {
        await api(`/api/reminders?fixtureId=${fixtureId}`, { method: 'DELETE' });
        state.reminders = state.reminders.filter(x => Number(x.fixtureId) !== fixtureId);
        state.remindersLoaded = true;
        state.remindersRevision += 1;
        toast('Напоминание отключено');
      } else {
        const data = await api('/api/reminders', {
          method: 'POST',
          body: JSON.stringify({
            fixtureId,
            homeName: match.home?.name || '',
            awayName: match.away?.name || '',
            leagueName: match.league || '',
            fixtureDate: match.date || '',
            reminderMinutes: Number(state.preferences?.reminderMinutes || 30),
            kickoffNotify: state.preferences?.kickoffNotification !== false,
          }),
        });
        const item = data?.item || {
          fixtureId,
          homeName: match.home?.name || '',
          awayName: match.away?.name || '',
          leagueName: match.league || '',
          fixtureDate: match.date || '',
          remindBeforeMinutes: Number(state.preferences?.reminderMinutes || 30),
          kickoffNotify: state.preferences?.kickoffNotification !== false,
          deliveryStatus: 'scheduled',
          deliveryAttempts: 0,
        };
        state.reminders = [item, ...state.reminders.filter(x => Number(x.fixtureId) !== fixtureId)];
        state.remindersLoaded = true;
        state.remindersRevision += 1;
        renderReminderList();
        toast(`Напомним примерно за ${Number(item.remindBeforeMinutes || state.preferences?.reminderMinutes || 30)} минут до матча${item.kickoffNotify !== false ? ' и около старта' : ''}`);
      }
      if (state.profile) {
        state.profile = {
          ...state.profile,
          stats: { ...(state.profile.stats || {}), reminders: state.reminders.length },
        };
        renderProfile();
      }
      if (state.currentAnalysis) renderAnalysis(state.currentAnalysis);
    } catch (e) {
      toast(e.message);
    } finally {
      state.reminderMutations.delete(fixtureId);
      syncReminderMutationUi(fixtureId);
    }
  }
  
  function clampPercent(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  }
  
  function qualityInfo(completeness = {}) {
    const score = Number(completeness.score || 0);
    const max = Math.max(1, Number(completeness.max || 10));
    const ratio = score / max;
    if (ratio >= .8) return { label: 'Высокая полнота', cls: 'good' };
    if (ratio >= .55) return { label: 'Средняя полнота', cls: 'medium' };
    return { label: 'Ограниченные данные', cls: 'low' };
  }
  
  function probabilityStrip(p = {}) {
    const home = clampPercent(p.home);
    const draw = clampPercent(p.draw);
    const away = clampPercent(p.away);
    const total = home + draw + away || 1;
    const h = home / total * 100;
    const d = draw / total * 100;
    const a = away / total * 100;
    return `<div class="probability-strip" aria-label="Вероятности исхода">
      <span class="prob-segment home" style="width:${h.toFixed(2)}%"></span>
      <span class="prob-segment draw" style="width:${d.toFixed(2)}%"></span>
      <span class="prob-segment away" style="width:${a.toFixed(2)}%"></span>
    </div>`;
  }
  
  function compactAbsence(title, items) {
    if (!items?.length) return `<div class="squad-block"><div class="squad-title">${escapeHtml(title)}</div><p class="muted">Активных отметок о потерях нет или данные недоступны.</p></div>`;
    return `<div class="squad-block"><div class="squad-title">${escapeHtml(title)}</div><ul class="compact-list">${items.slice(0, 10).map(x => {
      const status=absenceStatusLabel(x);
      const role=x.seasonRole?.matched ? x.seasonRole.label : '';
      const detail=[absenceKindLabel(x),x.reason || x.type,status,role].filter(Boolean).map(publicText).join(' · ');
      return `<li><strong>${escapeHtml(x.name)}</strong><span>${escapeHtml(detail)}</span></li>`;
    }).join('')}</ul></div>`;
  }
  
  function lineupBlock(title, lineup) {
    const players = lineup?.startXI || [];
    return `<div class="squad-block"><div class="squad-title">${escapeHtml(title)} <span>${escapeHtml(lineup?.formation || '')}</span></div>${players.length ? `<div class="lineup-list">${players.map((x,i) => `<span><b>${lineupPlayerNumber(x) || i+1}</b>${escapeHtml(lineupPlayerName(x))}</span>`).join('')}</div>` : '<p class="muted">Стартовый состав ещё не опубликован.</p>'}</div>`;
  }
  
  async function shareAnalysis(d) {
    const m=d?.match || {};
    const p=d?.probabilities || {};
    const fixtureId=Number(m.fixtureId || 0);
    const signal=d?.aiInstructor?.betSignal || {};
    const confidenceScore=d?.confidence?.score ?? d?.aiInstructor?.confidenceScore;
    const hasProbabilities=[p.home,p.draw,p.away].every(value=>Number.isFinite(Number(value)));
    const title=`${m.home?.name || ''} — ${m.away?.name || ''}`;
    const lines=[
      `⚽ ${title}`,
      `${m.league || ''}${m.date ? ` · ${dateTime(m.date)}` : ''}`,
    ].filter(Boolean);
    if (hasProbabilities) lines.push(`П1 ${pct(p.home)} · Н ${pct(p.draw)} · П2 ${pct(p.away)}`);
    if (signal.label) {
      lines.push(`MatchRadar AI: ${signal.label}`);
      if (Number.isFinite(Number(confidenceScore))) lines.push(`Уверенность: ${Number(confidenceScore)}/100`);
    }
    lines.push(
      '',
      'Открой матч в MatchRadar — ссылка сразу приведёт к матчу и доступному AI-разбору.',
      'Аналитическая оценка модели · не гарантия результата.',
    );
    let shareUrl='';
    let telegramShareUrl='';
    try {
      if (fixtureId) {
        const share=await api(`/api/share-link?fixtureId=${fixtureId}&source=social&campaign=match_share&content=miniapp`,{retry:false,timeoutMs:7000});
        shareUrl=String(share?.url || '');
        telegramShareUrl=String(share?.telegramShareUrl || '');
      }
    } catch {}
    const text=lines.join('\n');
    const fullText=shareUrl ? `${text}\n\n${shareUrl}` : text;
    try {
      if (telegramShareUrl && tg?.openTelegramLink) {
        tg.openTelegramLink(telegramShareUrl);
        toast('Открыто окно отправки матча');
        return;
      }
      if (navigator.share) {
        await navigator.share({title,text,...(shareUrl?{url:shareUrl}:{})});
        return;
      }
      await navigator.clipboard.writeText(fullText);
      toast(shareUrl ? 'Ссылка на матч скопирована' : 'Краткий анализ скопирован');
    } catch (e) {
      if (e?.name !== 'AbortError') {
        try {
          await navigator.clipboard.writeText(fullText);
          toast(shareUrl ? 'Ссылка на матч скопирована' : 'Краткий анализ скопирован');
        } catch {
          toast('Не удалось поделиться анализом');
        }
      }
    }
  }
  
  function bindRovingTabKeyboard(buttons, dataKey, activate) {
    const tabs = Array.from(buttons || []);
    if (!tabs.length) return;
    tabs.forEach((btn, index) => btn.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      const next = tabs[nextIndex];
      const value = next?.dataset?.[dataKey];
      if (!next || !value) return;
      activate(value);
      next.focus();
    }));
  }
  
  function setAnalysisTab(tab, scroll = false) {
    state.currentAnalysisTab = tab || 'brief';
    const buttons = [...document.querySelectorAll('.analysis-tab-btn')];
    const panels = [...document.querySelectorAll('.analysis-tab-panel')];
    buttons.forEach(btn => {
      const active = btn.dataset.tab === state.currentAnalysisTab;
      const name = btn.dataset.tab || 'overview';
      btn.id = `analysis-tab-${name}`;
      btn.classList.toggle('active', active);
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', `analysis-panel-${name}`);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });
    panels.forEach(panel => {
      const active = panel.dataset.panel === state.currentAnalysisTab;
      const name = panel.dataset.panel || 'overview';
      panel.id = `analysis-panel-${name}`;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
      panel.toggleAttribute('inert', !active);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `analysis-tab-${name}`);
      panel.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    if (scroll) document.querySelector('.analysis-tabs')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  
  function bindAnalysisTabs() {
    const buttons = [...document.querySelectorAll('.analysis-tab-btn')];
    buttons.forEach(btn => btn.addEventListener('click', () => setAnalysisTab(btn.dataset.tab, true)));
    bindRovingTabKeyboard(buttons, 'tab', value => setAnalysisTab(value, false));
    setAnalysisTab(state.currentAnalysisTab || 'brief', false);
  }
  
  
  function comparisonValue(metric, side) {
    const value = Number(metric?.[side === 'home' ? 'homeValue' : 'awayValue']);
    if (!Number.isFinite(value)) return '—';
    if (metric.format === 'percent') return `${Math.round(value)}%`;
    if (metric.format === 'rank') return `${Math.round(value)} место`;
    if (metric.format === 'integer') return String(Math.round(value));
    return value.toFixed(1);
  }
  
  function comparisonMetricRow(metric) {
    const edge = metric?.edge || 'even';
    const edgeLabel = edge === 'home' ? '← преимущество' : edge === 'away' ? 'преимущество →' : '≈ близко';
    return `<div class="comparison-row ${escapeHtml(edge)}">
      <div class="comparison-values"><strong>${comparisonValue(metric,'home')}</strong><span>${escapeHtml(metric.label || '')}</span><strong>${comparisonValue(metric,'away')}</strong></div>
      <div class="comparison-track"><i class="home"></i><b>${escapeHtml(edgeLabel)}</b><i class="away"></i></div>
      ${metric.note ? `<small>${escapeHtml(metric.note)}</small>` : ''}
    </div>`;
  }
  
  function comparisonAdvantages(title, items = [], side = '') {
    return `<div class="comparison-advantages-card ${side}"><strong>${escapeHtml(title)}</strong>${items.length
      ? `<ul>${items.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`
      : '<p>Явного перевеса по доступным метрикам нет.</p>'}</div>`;
  }
  
  function comparisonTeamHeader(team, side, edges) {
    return `<button class="comparison-team-head ${side}" type="button" data-open-team="${Number(team?.id || 0)}" data-team-name="${escapeHtml(team?.name || '')}" data-team-logo="${safeUrl(team?.logo || '')}">
      ${team?.logo ? `<img src="${safeUrl(team.logo)}" alt="">` : '<span class="comparison-logo-placeholder">⚽</span>'}
      <span><strong>${escapeHtml(team?.name || '')}</strong><small>${Number(edges || 0)} метрик с преимуществом</small></span>
    </button>`;
  }
  
  
  function prematchOutcomeName(key, match) {
    if (key === 'home') return match.home?.name || 'П1';
    if (key === 'away') return match.away?.name || 'П2';
    if (key === 'draw') return 'Ничья';
    return '—';
  }
  
  function prematchDriverCard(driver, match) {
    const sideName = driver.side === 'home' ? match.home?.name : driver.side === 'away' ? match.away?.name : '';
    const strengthText = driver.strength === 'high' ? 'сильный фактор' : driver.strength === 'low' ? 'контекст' : 'заметный фактор';
    return `<article class="prematch-driver ${escapeHtml(driver.side || 'neutral')} ${escapeHtml(driver.strength || 'medium')}">
      <div class="prematch-driver-icon">${escapeHtml(driver.icon || '•')}</div>
      <div class="prematch-driver-body">
        <div class="prematch-driver-kicker">${sideName ? `${escapeHtml(sideName)} · ` : ''}${escapeHtml(strengthText)}</div>
        <h3>${escapeHtml(publicText(driver.title || 'Фактор'))}</h3>
        <p>${escapeHtml(publicText(driver.text || ''))}</p>
        ${Number.isFinite(Number(driver.weight)) ? `<div class="driver-weight"><span>Вес в общей модели</span><strong>${Number(driver.weight).toFixed(1)}%</strong></div>` : ''}
      </div>
    </article>`;
  }
  
  function prematchScenarioCard(scenario) {
    return `<article class="prematch-scenario ${escapeHtml(scenario.tone || 'balanced')}">
      <div class="prematch-scenario-top"><span>${escapeHtml(scenario.icon || '•')}</span><small>${escapeHtml(publicText(scenario.relevance || ''))}</small></div>
      <h3>${escapeHtml(publicText(scenario.title || ''))}</h3>
      <p>${escapeHtml(publicText(scenario.text || ''))}</p>
    </article>`;
  }
  
  function prematchSourceRow(row, match) {
    const finalKey = state.currentAnalysis?.preMatchIntelligence?.leader?.key || '';
    return `<div class="prematch-source-row ${row.agreesWithFinal ? 'agree' : 'disagree'}">
      <div class="prematch-source-main">
        <span class="prematch-source-icon">${escapeHtml(row.icon || '•')}</span>
        <div><strong>${escapeHtml(publicText(row.label || ''))}</strong><small>Вес ${Number(row.weight || 0).toFixed(1)}%</small></div>
      </div>
      <div class="prematch-source-result">
        <strong>${escapeHtml(row.leader || '—')}</strong>
        <span>${Number(row.leaderProbability || 0).toFixed(1)}%</span>
      </div>
      <div class="prematch-source-status">${row.agreesWithFinal ? '✓ согласен' : '↔ расходится'}</div>
    </div>`;
  }
  
  function prematchBriefHtml(pm, match, probabilities) {
    if (!pm) {
      return `<section class="panel"><div class="empty"><strong>Преданализ недоступен</strong><p>Пересчитайте анализ после обновления приложения.</p></div></section>`;
    }
    const uncertainty = pm.uncertainty || {};
    const leader = pm.leader || {};
    const dataScore = Number(pm.dataScore || 0);
    return `
      <section class="panel prematch-brief-hero">
        <div class="prematch-brief-top">
          <div>
            <span class="prematch-brief-label">🧠 ПРЕДАНАЛИЗ МАТЧА</span>
            <h2>${escapeHtml(publicText(pm.headline || 'Преданализ матча'))}</h2>
          </div>
          <div class="prematch-data-score"><strong>${dataScore}%</strong><span>полнота данных</span></div>
        </div>
        <p class="prematch-brief-summary">${escapeHtml(publicText(pm.summary || ''))}</p>
  
        <div class="prematch-brief-kpis">
          <div><span>Главный сценарий</span><strong>${escapeHtml(leader.label || prematchOutcomeName(leader.key, match))}</strong><small>${Number(leader.probability || 0).toFixed(1)}%</small></div>
          <div><span>Отрыв</span><strong>${Number(leader.gap || 0).toFixed(1)} п.п.</strong><small>от второго исхода</small></div>
          <div><span>Неопределённость</span><strong>${Number(uncertainty.score || 0)}/100</strong><small>${escapeHtml(publicText(uncertainty.label || ''))}</small></div>
        </div>
  
        <div class="prematch-hero-probs">
          <div><span>${escapeHtml(match.home?.name || 'П1')}</span><strong>${pct(probabilities?.home)}</strong></div>
          <div><span>Ничья</span><strong>${pct(probabilities?.draw)}</strong></div>
          <div><span>${escapeHtml(match.away?.name || 'П2')}</span><strong>${pct(probabilities?.away)}</strong></div>
        </div>
        ${probabilityStrip(probabilities)}
      </section>
  
      <section class="panel">
        <div class="prematch-section-head"><div><h2>Почему модель пришла к этим процентам</h2><p>Факторы отсортированы по полезности и весу источников</p></div><span>${(pm.drivers || []).length} факторов</span></div>
        <div class="prematch-driver-list">${(pm.drivers || []).length ? pm.drivers.map(x => prematchDriverCard(x, match)).join('') : '<div class="empty compact-empty">Сильных факторов пока недостаточно.</div>'}</div>
      </section>
  
      <section class="panel">
        <div class="prematch-section-head"><div><h2>Сценарии матча</h2><p>Не новые прогнозы, а интерпретация уже рассчитанных сигналов</p></div></div>
        <div class="prematch-scenarios">${(pm.scenarios || []).length ? pm.scenarios.map(prematchScenarioCard).join('') : '<div class="empty compact-empty">Сценарии не сформированы из-за ограниченных данных.</div>'}</div>
      </section>
  
      <section class="panel">
        <div class="prematch-section-head"><div><h2>Что может изменить оценку до старта</h2><p>Факторы, за которыми стоит следить перед матчем</p></div></div>
        ${(pm.watch || []).length ? `<div class="prematch-watch-list">${pm.watch.map((x,i)=>`<div><b>${i+1}</b><span>${escapeHtml(publicText(x))}</span></div>`).join('')}</div>` : '<div class="empty compact-empty">Критичных ожидаемых изменений по доступным данным нет.</div>'}
      </section>
  
      <section class="panel">
        <div class="prematch-section-head"><div><h2>Как голосуют источники</h2><p>Каждый источник имеет собственную оценку и вес в объединении</p></div></div>
        <div class="prematch-source-table">${(pm.sourceRows || []).length ? pm.sourceRows.map(x => prematchSourceRow(x, match)).join('') : '<div class="empty compact-empty">Детальные данные по отдельным сигналам пока недоступны.</div>'}</div>
        <p class="tiny warning">${escapeHtml(publicText(pm.methodology || ''))}</p>
      </section>`;
  }
  
  function providerCoverageHtml(reliability = {}) {
    const features = reliability?.features || {};
    const labels = { injuries:'Травмы', lineups:'Составы', odds:'Коэффициенты', predictions:'Прогноз API', h2h:'Очные встречи' };
    const states = {
      available:['✓','Получено'], empty_response:['○','Источник вернул пустой ответ'], skipped:['○','Запрос отложен'],
      rate_limited:['!','Лимит запросов'], plan_limited:['!','Недоступно на текущем тарифе источника'],
      timeout:['!','Тайм-аут источника'], network_error:['!','Ошибка сети источника'], provider_error:['!','Ошибка источника'],
      configuration:['!','Источник не настроен'], error:['!','Временно недоступно'],
    };
    const rows = Object.entries(labels).filter(([key]) => features[key]).map(([key,label]) => {
      const item = features[key] || {};
      const state = String(item.state || 'unknown');
      const [icon,text] = states[state] || ['○','Статус не определён'];
      const cls = item.available ? 'available' : item.degraded ? 'degraded' : 'missing';
      return `<div class="provider-coverage-row ${cls}"><span>${icon}</span><strong>${label}</strong><small>${escapeHtml(text)}</small></div>`;
    }).join('');
    if (!rows) return '';
    const state = String(reliability.state || 'partial');
    const title = state === 'healthy' ? 'Данные источника получены' : state === 'degraded' ? 'Часть данных ограничена' : 'Часть данных ещё недоступна';
    return `<section class="provider-coverage-card ${escapeHtml(state)}"><div class="provider-coverage-head"><strong>${escapeHtml(title)}</strong><span>доверие ≤ ${Math.round(Number(reliability.trustCap || 100))}%</span></div><div class="provider-coverage-grid">${rows}</div><p>${escapeHtml(publicText(reliability.note || 'AI использует только подтверждённые сигналы.'))}</p></section>`;
  }
  
  function aiInstructorHtml(ai = {}, match = {}, kickoffHandoff = {}) {
    const signal = ai.betSignal || {};
    const verdict = ai.verdict || {};
    const factors = Array.isArray(ai.factors) ? ai.factors.slice(0, 3) : [];
    const risks = Array.isArray(ai.risks) ? ai.risks.slice(0, 2) : [];
    const handoffLocked = Boolean(kickoffHandoff?.locked);
    const signalClass = handoffLocked ? 'archived' : signal.code === 'skip' ? 'skip' : signal.code === 'watch' ? 'watch' : 'active';
    const confidenceText = Number.isFinite(Number(ai.confidenceScore)) ? `${Math.round(Number(ai.confidenceScore))}/100` : 'данных мало';
    const dataTrust = ai.dataTrust || {};
    const qualityGate = ai.qualityGate || {};
    const gateReasons = Array.isArray(qualityGate.reasons) ? qualityGate.reasons.slice(0, 2) : [];
    const matchPlan = ai.matchPlan || {};
    const checks = Array.isArray(matchPlan.checks) ? matchPlan.checks.slice(0, 3) : [];
    const dataTrustScore = Number.isFinite(Number(dataTrust.score)) ? `${Math.round(Number(dataTrust.score))}%` : '—';
    return `
      <section class="panel ai-instructor-card ${signalClass}">
        <div class="ai-instructor-head">
          <div><span>AI ФУТБОЛЬНЫЙ ИНСТРУКТОР</span><h2>${handoffLocked ? 'Предматчевый разбор зафиксирован' : 'Мой разбор перед матчем'}</h2></div>
          <b>AI</b>
        </div>
        <div class="ai-verdict-grid" aria-label="Вердикт AI за 10 секунд">
          <div><span>Исход</span><strong>${escapeHtml(verdict.outcome || '—')}</strong></div>
          <div><span>Тотал 2.5</span><strong>${escapeHtml(verdict.total || '—')}</strong></div>
          <div><span>Обе забьют</span><strong>${escapeHtml(verdict.btts || '—')}</strong></div>
          <div class="${handoffLocked ? 'archived' : signal.code === 'skip' ? 'skip' : 'action'}"><span>${handoffLocked ? 'Сигнал до старта' : 'Решение'}</span><strong>${escapeHtml(signal.label || 'Изучить матч')}</strong></div>
        </div>
        <div class="ai-instructor-main">
          <div class="ai-instructor-pick">
            <span>${handoffLocked ? 'Архивная идея до старта' : 'Главная идея'}</span>
            <strong>${escapeHtml(signal.label || 'Сначала изучить матч')}</strong>
            <small>${escapeHtml(publicText(signal.reason || 'Собираю доступные сигналы и риски.'))}</small>
            ${ai.marketNote ? `<div class="ai-market-note">💹 ${escapeHtml(publicText(ai.marketNote))}</div>` : ''}
            ${ai.lineupImpact?.note ? `<div class="ai-lineup-note">👥 ${escapeHtml(publicText(ai.lineupImpact.note))}</div>` : ''}
          </div>
          <div class="ai-instructor-facts">
            <div><span>Уверенность</span><strong>${escapeHtml(ai.confidenceLabel || '—')}</strong><small>${confidenceText}</small></div>
            <div><span>Риск</span><strong>${escapeHtml(ai.riskLabel || '—')}</strong><small>${escapeHtml(publicText(ai.riskNote || 'Оценивайте несколько факторов.'))}</small></div>
            <div><span>Судья</span><strong>${escapeHtml(ai.refereeProfile?.name || ai.referee || match.referee || 'Ещё не указан')}</strong><small>${escapeHtml(publicText(ai.refereeHistory?.available ? `${ai.refereeHistory.styleLabel} · ${ai.refereeHistory.avgYellow} жёлт. · ${ai.refereeHistory.avgRed} красн. · выборка ${ai.refereeHistory.sample}` : ai.refereeProfile?.country ? `${ai.refereeProfile.country} · ${ai.refereeNote || ''}` : ai.refereeNote || 'Назначение судьи может появиться ближе к матчу.'))}</small></div>
            <div class="ai-data-trust"><span>Качество данных</span><strong>${escapeHtml(dataTrust.label || 'Оценивается')}</strong><small>${dataTrustScore} · ${escapeHtml(publicText(dataTrust.note || 'Отдельно от уверенности модели.'))}</small></div>
            <div class="ai-data-trust"><span>Quality Gate</span><strong>${escapeHtml(qualityGate.label || 'Оценивается')}</strong><small>${escapeHtml(publicText(gateReasons[0]?.text || 'Проверка качества сигнала пройдена без блокирующих причин.'))}</small></div>
          </div>
        </div>
        ${factors.length ? `<div class="ai-instructor-reasons"><strong>Почему так</strong><ul>${factors.map(x => `<li>${escapeHtml(publicText(x))}</li>`).join('')}</ul></div>` : ''}
        ${risks.length ? `<div class="ai-instructor-risks"><strong>Что может сломать сценарий</strong><ul>${risks.map(x => `<li>${escapeHtml(publicText(x))}</li>`).join('')}</ul></div>` : ''}
        <div class="ai-match-plan">
          <div class="ai-match-plan-head"><span>AI-ПЛАН ДО СТАРТОВОГО СВИСТКА</span><strong>Что проверить перед решением</strong></div>
          ${checks.length ? `<div class="ai-match-plan-checks">${checks.map((x,i) => `<div><b>${i+1}</b><span>${escapeHtml(publicText(x))}</span></div>`).join('')}</div>` : ''}
          <div class="ai-match-plan-grid">
            <div><span>Условие отмены</span><strong>${escapeHtml(publicText(matchPlan.cancel || 'Если ключевые данные изменятся — пересмотреть сценарий.'))}</strong></div>
            <div><span>Что смотреть дальше</span><strong>${escapeHtml(publicText(matchPlan.liveWatch || 'После стартового свистка сверять фактический рисунок игры с предматчевым сценарием.'))}</strong></div>
          </div>
        </div>
        <p class="ai-instructor-disclaimer">Это аналитический сигнал по данным матча, а не гарантия результата. Если сигнал слабый, лучший вариант — пропустить ставку.</p>
      </section>`;
  }
  
  let launchIntentHandled = false;
  async function openLaunchFixture(fixtureId, action, tab = '', handoff = false, newsImpactDecision = '', newsImpactAction = '', newsImpactRecoveryCode = '', newsImpactRecoveryFrom = '') {
    const id = Number(fixtureId || 0);
    if (!id) return;
    const allowedTabs = new Set(['brief','overview','form','comparison','market','squads','context']);
    const requestedTab = allowedTabs.has(String(tab || '').toLowerCase()) ? String(tab).toLowerCase() : '';
    if (requestedTab) state.currentAnalysisTab = requestedTab;
    if (action === 'center') return openMatchCenter(id, null);
    if (action === 'analysis') {
      if (handoff) {
        await Promise.allSettled([loadFavorites(), loadReminders()]);
        return analyzeMatch(id, null, { recheck:true, newsImpactDecision, newsImpactAction, newsImpactRecoveryCode, newsImpactRecoveryFrom });
      }
      await loadHistory(false);
      if (analysisHistoryForFixture(id)) return openHistoryAnalysis(id, null);
      return analyzeMatch(id, null);
    }
  }
  
  function applyLaunchIntent() {
    if (launchIntentHandled) return;
    launchIntentHandled = true;
    const params = new URLSearchParams(location.search);
    const filter = String(params.get('filter') || '').toLowerCase();
    const view = String(params.get('view') || '').toLowerCase();
    const query = String(params.get('q') || '').trim().slice(0, 60);
    const fixtureId = Number(params.get('fixtureId') || 0);
    const action = String(params.get('action') || '').toLowerCase();
    const tab = String(params.get('tab') || '').toLowerCase();
    const handoff = params.get('handoff') === '1';
    const newsImpactDecision = String(params.get('newsImpactDecision') || '').toLowerCase().slice(0,24);
    const newsImpactAction = String(params.get('newsImpactAction') || '').toLowerCase().slice(0,24);
    const newsImpactRecoveryCode = String(params.get('newsImpactRecoveryCode') || '').toLowerCase().slice(0,24);
    const newsImpactRecoveryFrom = String(params.get('newsImpactRecoveryFrom') || '').toLowerCase().slice(0,24);
    if (['top', 'live', 'favorites', 'all'].includes(filter)) {
      state.filter = filter;
    }
    if (view === 'search' || query) {
      if (query) {
        state.globalSearch.query = query;
        const input = $('globalSearchInput');
        if (input) input.value = query;
      }
      renderDiscoveryHome();
      renderGlobalSearch();
      showView('searchView');
      if (query) void runGlobalSearch();
    } else if (view === 'history') {
      showView('historyView');
      void Promise.allSettled([loadHistory(false),loadAiTrackRecord(false)]);
    } else if (fixtureId > 0 && ['analysis','center'].includes(action)) {
      showView('searchView');
      void openLaunchFixture(fixtureId, action, tab, handoff, newsImpactDecision, newsImpactAction, newsImpactRecoveryCode, newsImpactRecoveryFrom);
    } else {
      renderGlobalSearch();
      showView('searchView', { restore: true });
    }
  }
  function analysisFreshnessHtml(freshness = {}, recheck = {}) {
    if (!freshness || !freshness.label) return '';
    const state=String(freshness.state || 'fresh');
    const icon=state==='recheck'?'🟠':state==='started'?'⚪':'🟢';
    const mins=Number(freshness.ageMinutes || 0);
    const kickoff=Number.isFinite(Number(freshness.minutesToKickoff)) ? Number(freshness.minutesToKickoff) : null;
    const kickoffText=kickoff===null?'':kickoff>0?` · до старта ${kickoff} мин.`:' · матч уже начался';
    const action=freshness.needsRecheck ? '<button id="analysisRecheckBtn" class="freshness-recheck-btn" type="button">↻ Перепроверить AI сейчас</button>' : '';
    const rechecked=recheck?.performed ? `<small class="freshness-recheck-meta">${recheck.free ? 'Перепроверено без повторного списания лимита' : 'Выполнена свежая перепроверка'}</small>` : '';
    const delta=recheck?.performed ? recheck?.delta : null;
    const deltaItems=Array.isArray(delta?.items) ? delta.items.slice(0,6) : [];
    const deltaHtml=delta?.available ? `<div class="analysis-delta ${delta.material ? 'material' : delta.stable ? 'stable' : ''}">
      <div class="analysis-delta-head"><strong>${delta.material ? '🔄 Что изменилось' : delta.stable ? '✓ Прогноз стабилен' : '↻ Обновились детали'}</strong><span>${deltaItems.length} изменений</span></div>
      <p>${escapeHtml(publicText(delta.summary || ''))}</p>
      ${deltaItems.length ? `<div class="analysis-delta-list">${deltaItems.map(item=>`<div><span>${escapeHtml(item.title || item.code || '')}</span><strong>${item.before && item.after ? `${escapeHtml(item.before)} → ${escapeHtml(item.after)}` : escapeHtml(item.after || item.before || '')}</strong></div>`).join('')}</div>` : ''}
    </div>` : '';
    return `<section class="panel analysis-freshness ${escapeHtml(state)}">
      <div><span>${icon}</span><div><strong>${escapeHtml(freshness.label)}</strong><small>Расчёту ${mins} мин.${escapeHtml(kickoffText)}</small></div></div>
      <p>${escapeHtml(publicText(freshness.reason || ''))}</p>
      ${rechecked}${deltaHtml}${action}
    </section>`;
  }
  
  function kickoffHandoffHtml(handoff = {}, match = {}) {
    const state=String(handoff?.state || 'prematch');
    if (state==='prematch') return '';
    const locked=Boolean(handoff?.locked);
    const icon=state==='imminent'?'⏳':state==='finished'?'✓':'●';
    const action=locked && Number(match?.fixtureId || 0)
      ? `<button id="kickoffMatchCenterBtn" class="kickoff-center-btn" type="button">${escapeHtml(handoff.actionLabel || (state==='finished'?'Открыть итог матча':'Открыть центр матча'))}</button>`
      : '';
    return `<section class="panel kickoff-handoff ${locked?'locked':state}">
      <div><span>${icon}</span><div><strong>${escapeHtml(handoff.label || '')}</strong><small>${locked?'Предматчевый AI переведён в архивный режим':'Последняя проверка перед стартом'}</small></div></div>
      <p>${escapeHtml(publicText(handoff.reason || ''))}</p>
      ${action}
    </section>`;
  }
  
  function dataProvenanceHtml(provenance = {}) {
    const features = provenance?.features || {};
    const labels = {
      injuries:'Травмы и дисквалификации',
      predictions:'Прогноз источника',
      odds:'Коэффициенты',
      h2h:'Очные встречи',
      lineups:'Стартовые составы',
    };
    const stateLabels = {
      available:'получено', empty_response:'пустой подтверждённый ответ', skipped:'пропущено политикой',
      rate_limited:'лимит источника', plan_limited:'ограничено тарифом', timeout:'тайм-аут',
      network_error:'ошибка сети', provider_error:'ошибка источника', error:'недоступно', unknown:'неизвестно',
      stale_data:'устарело — исключено из расчёта', unverified_source:'источник не подтверждён', unverified_freshness:'свежесть не подтверждена',
    };
    const rows = Object.entries(labels).filter(([key]) => features[key]).map(([key,label]) => {
      const meta = features[key] || {};
      const provider = meta.provider === 'api-football' ? 'API-Football' : String(meta.provider || '—');
      const age = Number.isFinite(Number(meta.ageSeconds)) ? ` · возраст ${Math.max(0,Math.round(Number(meta.ageSeconds)))} сек.` : '';
      return `<div class="provenance-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(provider)}</strong><small>${escapeHtml(stateLabels[meta.state] || meta.state || '—')}${escapeHtml(age)}</small></div>`;
    });
    if (!rows.length) return '';
    return `<section class="panel data-provenance-panel">
      <div class="prematch-section-head"><div><h2>🛰️ Паспорт данных</h2><p>Откуда пришли ключевые входы и насколько они свежие</p></div></div>
      <div class="provenance-grid">${rows.join('')}</div>
    </section>`;
  }
  
  function cockpitProviderLabel(provider = '') {
    const key=String(provider || '').toLowerCase();
    if (key==='api-football') return 'API-Football';
    if (key==='the-odds-api') return 'The Odds API';
    return provider ? String(provider) : '—';
  }
  
  function matchCockpitHtml(d = {}) {
    const m=d.match || {};
    const recent=d.recentForm || {};
    const comparison=d.comparison || {};
    const metrics=Array.isArray(comparison.metrics) ? comparison.metrics : [];
    const metric=key=>metrics.find(x=>x?.key===key) || null;
    const formMetric=metric('form_ppg');
    const venueMetric=metric('venue_ppg');
    const tableMetric=metric('table_rank');
    const injuriesMeta=d.providerReliability?.features?.injuries || d.dataPolicy?.reliability?.features?.injuries || {};
    const lineupMeta=d.providerReliability?.features?.lineups || d.dataPolicy?.reliability?.features?.lineups || {};
    const injuryConfirmed=Boolean(injuriesMeta.available);
    const homeAbs=Array.isArray(d.absences?.home) ? d.absences.home.length : 0;
    const awayAbs=Array.isArray(d.absences?.away) ? d.absences.away.length : 0;
    const homeConfirmed=Boolean(d.lineupImpact?.homeConfirmed || d.lineups?.home?.quality?.confirmed === true);
    const awayConfirmed=Boolean(d.lineupImpact?.awayConfirmed || d.lineups?.away?.quality?.confirmed === true);
    const confirmedCount=Number(homeConfirmed)+Number(awayConfirmed);
    const h2h=d.h2h || {};
    const h2hSample=Number(h2h.homeWins || 0)+Number(h2h.draws || 0)+Number(h2h.awayWins || 0);
    const market=d.market || null;
    const oddsProvider=d.dataProvenance?.features?.odds?.provider || market?.provider || '';
    const confidence=Number.isFinite(Number(d.confidence?.score)) ? Math.round(Number(d.confidence.score)) : null;
    const completeness=Number.isFinite(Number(d.completeness?.score)) ? Number(d.completeness.score) : null;
    const completenessMax=Number.isFinite(Number(d.completeness?.max)) ? Number(d.completeness.max) : null;
    const homeName=m.home?.name || 'Хозяева';
    const awayName=m.away?.name || 'Гости';
    const fmt=value=>Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '—';
    const rank=value=>Number.isFinite(Number(value)) ? `${Math.round(Number(value))} место` : '—';
    const formAvailable=Boolean(recent.home?.overall?.sample && recent.away?.overall?.sample);
    const venueAvailable=Boolean(recent.home?.venue?.sample && recent.away?.venue?.sample);
    const marketAvailable=Boolean(market?.odds && Number(market.odds.home)>1 && Number(market.odds.draw)>1 && Number(market.odds.away)>1);
    const tableAvailable=Boolean(tableMetric && Number.isFinite(Number(tableMetric.homeValue)) && Number.isFinite(Number(tableMetric.awayValue)));
    const movement=d.marketMovement || {};
    const movementDelta=movement?.probabilityChange || {};
    const movementSample=Number(movement?.sample || 0);
    const movementRows=[['П1',Number(movementDelta.home || 0)],['Н',Number(movementDelta.draw || 0)],['П2',Number(movementDelta.away || 0)]]
      .sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
    const strongestMove=movementRows[0];
    const movementText=movementSample>=2 && Math.abs(strongestMove?.[1] || 0)>=1
      ? `Рынок: ${strongestMove[0]} ${strongestMove[1]>0?'+':''}${strongestMove[1].toFixed(1)} п.п.`
      : '';
    const lineupText=confirmedCount===2
      ? 'Оба стартовых состава подтверждены'
      : confirmedCount===1
        ? 'Подтверждён состав одной команды'
        : lineupMeta.state==='empty_response'
          ? 'Составы ещё не опубликованы источником'
          : 'Стартовые составы пока не подтверждены';
    const injuryText=injuryConfirmed
      ? `${homeName}: ${homeAbs} · ${awayName}: ${awayAbs}`
      : injuriesMeta.state==='empty_response'
        ? 'Источник вернул пустой ответ — это не означает «потерь нет»'
        : 'Данные о потерях сейчас не подтверждены';
    const qualityText=confidence===null
      ? 'Оценивается'
      : `${confidence}/100${completeness!==null&&completenessMax!==null ? ` · данные ${completeness}/${completenessMax}` : ''}`;
  
    const card=(tab,icon,title,value,note,available=true)=>`<button class="match-cockpit-card ${available?'':'is-missing'}" type="button" data-cockpit-tab="${escapeHtml(tab)}">
      <span class="match-cockpit-icon">${icon}</span>
      <span class="match-cockpit-copy"><small>${escapeHtml(title)}</small><strong>${escapeHtml(value)}</strong><em>${escapeHtml(publicText(note || ''))}</em></span>
      <span class="match-cockpit-arrow">→</span>
    </button>`;
  
    return `<section class="panel match-cockpit-panel">
      <div class="match-cockpit-head">
        <div><span>⚡ МАТЧ ЗА 15 СЕКУНД</span><h2>Ключевые факторы перед стартом</h2></div>
        <small>${escapeHtml(publicText(comparison.balanceLabel || 'Сводка строится только по доступным подтверждённым данным'))}</small>
      </div>
      <div class="match-cockpit-grid">
        ${card('form','📈','Текущая форма',
          formAvailable ? `${fmt(formMetric?.homeValue ?? recent.home?.overall?.ppg)} — ${fmt(formMetric?.awayValue ?? recent.away?.overall?.ppg)} очка/матч` : 'Недостаточно данных',
          formAvailable ? `${homeName} / ${awayName}, последние матчи` : 'Форма не включается в вывод без достаточной выборки',
          formAvailable)}
        ${card('form','🏟️','Дома / в гостях',
          venueAvailable ? `${fmt(venueMetric?.homeValue ?? recent.home?.venue?.ppg)} — ${fmt(venueMetric?.awayValue ?? recent.away?.venue?.ppg)} очка/матч` : 'Недостаточно данных',
          venueAvailable ? 'Хозяева дома против гостей на выезде' : 'Профиль площадки пока неполный',
          venueAvailable)}
        ${card('comparison','🏆','Положение в таблице',
          tableAvailable ? `${rank(tableMetric.homeValue)} — ${rank(tableMetric.awayValue)}` : 'Нет в сохранённых данных',
          tableAvailable ? `${homeName} / ${awayName}` : 'Таблица не запрашивается дополнительно только ради этой карточки',
          tableAvailable)}
        ${card('squads','🚑','Потери состава',
          injuryConfirmed ? `${homeAbs} — ${awayAbs}` : 'Не подтверждены',
          injuryText,
          injuryConfirmed)}
        ${card('squads','👥','Стартовые составы',
          confirmedCount===2 ? '2 / 2 подтверждены' : confirmedCount===1 ? '1 / 2 подтверждён' : 'Ожидаются',
          lineupText,
          confirmedCount>0)}
        ${card('form','🤝','Очные встречи',
          h2hSample ? `${Number(h2h.homeWins||0)} — ${Number(h2h.draws||0)} — ${Number(h2h.awayWins||0)}` : 'Нет выборки',
          h2hSample ? `${homeName} · ничьи · ${awayName}, выборка ${h2hSample}` : 'H2H не используется, если источник не вернул выборку',
          h2hSample>0)}
        ${card('market','💹','Коэффициенты П1 / Н / П2',
          marketAvailable ? `${market.odds.home} · ${market.odds.draw} · ${market.odds.away}` : 'Недоступен',
          marketAvailable ? `${cockpitProviderLabel(oddsProvider)}${movementText ? ` · ${movementText}` : ''}` : 'Рыночный сигнал исключён из модели',
          marketAvailable)}
        ${card('overview','🧠','Качество оценки',
          qualityText,
          d.confidence?.label || 'Уверенность модели и полнота входных данных считаются отдельно',
          confidence!==null)}
      </div>
      ${d.lineupImpact?.note ? `<div class="match-cockpit-note"><span>👥</span><p>${escapeHtml(publicText(d.lineupImpact.note))}</p></div>` : ''}
    </section>`;
  }
  
  function analysisGlanceHtml(d = {}) {
    const factors = (Array.isArray(d.insights) ? d.insights : []).filter(Boolean).slice(0, 3);
    const risks = (Array.isArray(d.risks) ? d.risks : []).filter(Boolean).slice(0, 3);
    const score = Number.isFinite(Number(d.confidence?.score)) ? Math.round(Number(d.confidence.score)) : null;
    const dataQuality = qualityInfo(d.completeness);
    return `<section class="panel analysis-glance">
      <div class="analysis-glance-head">
        <div><span>ГЛАВНОЕ</span><h2>Что важно перед матчем</h2></div>
        <div class="analysis-confidence-simple"><span>Уверенность AI</span><strong>${score === null ? '—' : `${score}/100`}</strong><small>${escapeHtml(publicText(d.confidence?.label || 'Оценивается'))}</small><small>Данные: ${escapeHtml(dataQuality.label || 'пока неполные')}</small></div>
      </div>
      <div class="analysis-glance-grid">
        <div><h3>Главные факторы</h3>${factors.length ? `<ol>${factors.map(x => `<li>${escapeHtml(publicText(x))}</li>`).join('')}</ol>` : '<p>Сильных отдельных факторов пока нет.</p>'}</div>
        <div class="analysis-glance-risks"><h3>Основные риски</h3>${risks.length ? `<ul>${risks.map(x => `<li>${escapeHtml(publicText(x))}</li>`).join('')}</ul>` : '<p>Критичных ограничений не найдено.</p>'}</div>
      </div>
    </section>`;
  }
  
  function renderAnalysis(d) {
    $('analysis')?.setAttribute('aria-busy', 'false');
    if (!d) return;
    const previousFixture = Number(state.currentAnalysis?.match?.fixtureId || 0);
    const nextFixture = Number(d?.match?.fixtureId || 0);
    if (previousFixture && nextFixture && previousFixture !== nextFixture) state.currentAnalysisTab = 'brief';
    state.currentAnalysis = d;
    const p = d.probabilities || {};
    const m = d.match || {};
    const market = d.market;
    const pred = d.apiPrediction;
    const h2h = d.h2h || {};
    const news = d.news || {};
    const homeLine = d.lineups?.home;
    const awayLine = d.lineups?.away;
    const activeReminder = reminderFor(m.fixtureId);
    const reminderActive = Boolean(activeReminder);
    const reminderPending = state.reminderMutations.has(Number(m.fixtureId));
    const homeFavorite = isFavorite(Number(m.home?.id || 0));
    const awayFavorite = isFavorite(Number(m.away?.id || 0));
    const confidence = d.confidence || {};
    const goal = d.goalModel;
    const recent = d.recentForm || {};
    const comparison = d.comparison || { metrics: [], advantages: { home: [], away: [] }, score: { home: 0, away: 0, even: 0 }, dataReuse: {} };
    const quality = qualityInfo(d.completeness);
    const confidenceScore = clampPercent(confidence.score);
  
    $('analysis').innerHTML = `
      <section class="panel match-experience-hero">
        <div class="analysis-brand-kicker">MatchRadar · AI-центр матча</div>
        <div class="match-experience-meta">
          <span>${escapeHtml(m.league || 'Турнир')}${m.country ? ` · ${escapeHtml(m.country)}` : ''}</span>
          <span>${dateTime(m.date)}</span>
        </div>
        <div class="match-experience-teams">
          <div class="experience-team">
            ${m.home?.logo ? `<img src="${safeUrl(m.home.logo)}" alt="">` : '<div class="experience-logo-placeholder">⚽</div>'}
            <strong>${escapeHtml(m.home?.name || '')}</strong>
            <small>Хозяева</small>
          </div>
          <div class="experience-vs">
            <span>против</span>
            ${m.venue ? `<small>${escapeHtml(m.venue)}</small>` : ''}
          </div>
          <div class="experience-team">
            ${m.away?.logo ? `<img src="${safeUrl(m.away.logo)}" alt="">` : '<div class="experience-logo-placeholder">⚽</div>'}
            <strong>${escapeHtml(m.away?.name || '')}</strong>
            <small>Гости</small>
          </div>
        </div>
  
        <div class="experience-callout">
          <span>Наиболее вероятный исход</span>
          <strong>${escapeHtml(likelyOutcomeDisplay(p, d.likelyOutcome))}</strong>
        </div>
  
        <div class="experience-prob-labels">
          <div><span>П1</span><strong>${pct(p.home)}</strong></div>
          <div><span>Н</span><strong>${pct(p.draw)}</strong></div>
          <div><span>П2</span><strong>${pct(p.away)}</strong></div>
        </div>
        ${probabilityStrip(p)}
  
        <div class="experience-health-row">
          <span class="quality-pill ${quality.cls}">● ${escapeHtml(publicText(confidence.label || quality.label || 'Оценивается'))}</span>
          <span>${confidence.score ?? '—'}/100 уверенность</span>
          ${d.stale ? '<span>⚠️ Показана последняя доступная версия</span>' : ''}
        </div>
        ${analysisAccessUsageHtml(d.accessUsage, escapeHtml)}
  
        <div class="experience-actions">
          <button id="reminderBtn" class="reminder-btn ${reminderActive ? 'active' : ''} ${reminderPending ? 'is-pending' : ''}" type="button" aria-pressed="${reminderActive ? 'true' : 'false'}" ${reminderPending ? 'disabled' : ''}>${reminderPending ? '⏳ Сохраняю…' : reminderActive ? `🔔 За ${Number(activeReminder?.remindBeforeMinutes || 30)} мин.${activeReminder?.kickoffNotify ? ' + старт' : ''}` : `🔕 Напомнить за ${Number(state.preferences?.reminderMinutes || 30)} минут`}</button>
          <button id="shareAnalysisBtn" class="share-analysis-btn" type="button">↗ Поделиться матчем</button>
          ${Number(m.home?.id || 0) ? `<button class="secondary-btn analysis-favorite-btn ${homeFavorite ? 'active' : ''}" type="button" data-analysis-favorite="${Number(m.home.id)}" data-team-name="${escapeHtml(m.home?.name || '')}" data-team-logo="${escapeHtml(m.home?.logo || '')}" aria-pressed="${homeFavorite ? 'true' : 'false'}"><span class="analysis-favorite-star">${favoriteStarSvg(homeFavorite)}</span><span class="analysis-favorite-copy"><small>${homeFavorite ? 'В избранном' : 'В избранное'}</small><strong>${escapeHtml(m.home?.name || 'Хозяева')}</strong></span></button>` : ''}
          ${Number(m.away?.id || 0) ? `<button class="secondary-btn analysis-favorite-btn ${awayFavorite ? 'active' : ''}" type="button" data-analysis-favorite="${Number(m.away.id)}" data-team-name="${escapeHtml(m.away?.name || '')}" data-team-logo="${escapeHtml(m.away?.logo || '')}" aria-pressed="${awayFavorite ? 'true' : 'false'}"><span class="analysis-favorite-star">${favoriteStarSvg(awayFavorite)}</span><span class="analysis-favorite-copy"><small>${awayFavorite ? 'В избранном' : 'В избранное'}</small><strong>${escapeHtml(m.away?.name || 'Гости')}</strong></span></button>` : ''}
        </div>
      </section>
  
  
      ${analysisGlanceHtml(d)}
  
      ${kickoffHandoffHtml(d.kickoffHandoff || {}, m)}
  
      <details class="analysis-more-data">
        <summary>Подробные данные матча</summary>
        <div class="analysis-more-body">
      <div class="analysis-tabs" role="tablist">
        <button class="analysis-tab-btn" data-tab="brief" type="button">Главное</button>
        <button class="analysis-tab-btn" data-tab="overview" type="button">Обзор</button>
        <button class="analysis-tab-btn" data-tab="form" type="button">Форма</button>
        <button class="analysis-tab-btn" data-tab="comparison" type="button">Сравнение</button>
        <button class="analysis-tab-btn" data-tab="market" type="button">Рынок</button>
        <button class="analysis-tab-btn" data-tab="squads" type="button">Составы</button>
        <button class="analysis-tab-btn" data-tab="context" type="button">Контекст</button>
      </div>
  
      <div class="analysis-tab-panel" data-panel="brief">
        ${prematchBriefHtml(d.preMatchIntelligence, m, p)}
        ${aiInstructorHtml(d.aiInstructor || {}, m, d.kickoffHandoff || {})}
      </div>
  
      <div class="analysis-tab-panel" data-panel="overview">
        ${matchCockpitHtml(d)}
  
  
        <section class="panel">
          <h2>🧩 Почему такая оценка</h2>
          ${bullets(d.insights, 'Пока нет сильных дополнительных факторов.')}
        </section>
  
        <section class="panel goal-visual-panel">
          <h2>⚽ Голевая модель</h2>
          ${goal ? `<div class="goal-score-visual">
            <div><span>${escapeHtml(m.home?.name || 'Хозяева')}</span><strong>${goal.homeExpected}</strong></div>
            <div class="goal-divider">:</div>
            <div><span>${escapeHtml(m.away?.name || 'Гости')}</span><strong>${goal.awayExpected}</strong></div>
          </div>
          <div class="goal-market-grid">
            <div><span>ТБ 2.5</span><strong>${pct(goal.over25)}</strong><div class="mini-progress"><i style="width:${clampPercent(goal.over25)}%"></i></div></div>
            <div><span>Обе забьют</span><strong>${pct(goal.btts)}</strong><div class="mini-progress"><i style="width:${clampPercent(goal.btts)}%"></i></div></div>
          </div>
          <p class="muted">Модель Пуассона по недавней результативности. Качество выборки: <b>${escapeHtml(goal.qualityLabel || 'Оценивается')}</b>${Number.isFinite(Number(goal.qualityScore)) ? ` · ${Math.round(Number(goal.qualityScore))}/100` : ''}. Это не официальный показатель ожидаемых голов.</p>` : '<p class="muted">Недостаточно недавних матчей для голевой модели.</p>'}
        </section>
  
        <section class="panel risk-panel">
          <h2>⚠️ Риски и ограничения</h2>
          ${bullets(d.risks, 'Критичных ограничений по доступным данным не найдено.')}
        </section>
      </div>
  
      <div class="analysis-tab-panel" data-panel="form">
        <section class="panel">
          <h2>📈 Форма команд</h2>
          <div class="form-grid experience-form-grid">
            ${formCard(m.home?.name || 'Хозяева', recent.home)}
            ${formCard(m.away?.name || 'Гости', recent.away)}
          </div>
        </section>
        <section class="panel">
          <h2>🤝 Последние очные встречи</h2>
          <div class="h2h-visual">
            <div><strong>${h2h.homeWins ?? 0}</strong><span>${escapeHtml(m.home?.name || '')}</span></div>
            <div class="h2h-draw"><strong>${h2h.draws ?? 0}</strong><span>Ничьи</span></div>
            <div><strong>${h2h.awayWins ?? 0}</strong><span>${escapeHtml(m.away?.name || '')}</span></div>
          </div>
        </section>
      </div>
  
      <div class="analysis-tab-panel" data-panel="comparison">
        <section class="panel comparison-hero-panel">
          <div class="comparison-heads">
            ${comparisonTeamHeader(m.home, 'home', comparison.score?.home)}
            <div class="comparison-score"><span>МЕТРИКИ</span><strong>${Number(comparison.score?.home || 0)} : ${Number(comparison.score?.away || 0)}</strong><small>${Number(comparison.score?.even || 0)} близких</small></div>
            ${comparisonTeamHeader(m.away, 'away', comparison.score?.away)}
          </div>
          <div class="comparison-balance">${escapeHtml(publicText(comparison.balanceLabel || 'Сравнение строится по доступным данным'))}</div>
        </section>
  
        <section class="panel">
          <div class="comparison-section-head"><h2>⚖️ Команда к команде</h2><span>${comparison.metrics?.length || 0} метрик</span></div>
          ${comparison.metrics?.length ? `<div class="comparison-metrics">${comparison.metrics.map(comparisonMetricRow).join('')}</div>` : '<div class="empty compact-empty">Недостаточно сопоставимых данных для детального сравнения.</div>'}
        </section>
  
        <section class="panel">
          <h2>🔎 Ключевые преимущества</h2>
          <div class="comparison-advantages-grid">
            ${comparisonAdvantages(m.home?.name || 'Хозяева', comparison.advantages?.home || [], 'home')}
            ${comparisonAdvantages(m.away?.name || 'Гости', comparison.advantages?.away || [], 'away')}
          </div>
        </section>
  
  
      </div>
  
      <div class="analysis-tab-panel" data-panel="market">
        <section class="panel">
          <h2>💹 Коэффициенты П1 / Н / П2</h2>
          ${oddsQualityHintHtml(d.oddsQuality)}
          <div class="odds-grid">
            <div><span>П1</span><strong>${market?.odds?.home ?? '—'}</strong></div>
            <div><span>Н</span><strong>${market?.odds?.draw ?? '—'}</strong></div>
            <div><span>П2</span><strong>${market?.odds?.away ?? '—'}</strong></div>
          </div>
          <p class="muted">Букмекеров в выборке: ${market?.bookmakers ?? '—'}. Коэффициенты отражают рынок, а не гарантированный исход.</p>
        </section>
        <details class="panel analysis-disclosure">
          <summary>Подробнее о расчёте</summary>
          <div class="analysis-disclosure-body">
          <h2>🧠 Состав модели</h2>
          <p class="muted">${escapeHtml(publicText(d.modelBreakdown?.method || 'Модель объединяет доступные статистические сигналы.'))}</p>
          <div class="model-weights">${escapeHtml(modelWeightsText(d.modelBreakdown?.weights || {}))}</div>
        ${d.modelCalibration ? `<div class="analysis-calibration-card ${escapeHtml(d.modelCalibration.mode || 'baseline')}"><span>Настройка модели</span><strong>${escapeHtml(calibrationModeLabel(d.modelCalibration.mode))}</strong><small>Проверено на выборке: ${Number(d.modelCalibration.sample || 0)}</small></div>` : ''}
          <div class="model-api-card">
            <span>Прогноз источника данных</span>
            <strong>${escapeHtml(pred?.winner || 'Нет данных')}</strong>
            <small>${escapeHtml(predictionAdviceLabel(pred?.advice || 'Подсказка недоступна'))}</small>
          </div>
  
          </div>
        </details>
      </div>
  
      <div class="analysis-tab-panel" data-panel="squads">
        <section class="panel">
          <h2>🚑 Потери</h2>
          ${availabilityQualityHintHtml(d.availabilityQuality)}
          <div class="squad-grid">
            ${compactAbsence(m.home?.name || 'Хозяева', d.absences?.home)}
            ${compactAbsence(m.away?.name || 'Гости', d.absences?.away)}
          </div>
        </section>
        <section class="panel">
          <h2>👥 Стартовые составы</h2>
          <div class="squad-grid">
            ${lineupBlock(m.home?.name || 'Хозяева', homeLine)}
            ${lineupBlock(m.away?.name || 'Гости', awayLine)}
          </div>
        </section>
      </div>
  
      <div class="analysis-tab-panel" data-panel="context">
        <section class="panel">
          <h2>🌐 Свежий контекст из интернета</h2>
          <p class="context-answer">${escapeHtml(news.answer || 'Источник свежего веб-контекста не подключён или сводка не найдена.')}</p>
          ${news.results?.length ? `<div class="news-links">${news.results.slice(0, 5).map(r => `<a href="${safeUrl(r.url)}" target="_blank" rel="noopener">↗ ${escapeHtml(r.title || 'Источник')}</a>`).join('')}</div>` : ''}
        </section>
        <details class="panel analysis-disclosure data-details-disclosure">
          <summary>Подробнее о данных</summary>
          <div class="analysis-disclosure-body">
            ${analysisFreshnessHtml(d.freshness || {}, d.recheck || {})}
            ${providerCoverageHtml(d.providerReliability || d.dataPolicy?.reliability || {})}
            ${dataProvenanceHtml(d.dataProvenance || {})}
            <section class="data-transparency-panel">
          <h2>О данных</h2>
          <div class="transparency-grid">
            <div><span>Полнота</span><strong>${d.completeness?.score ?? 0}/${d.completeness?.max ?? 10}</strong></div>
            <div><span>Статус</span><strong>${d.stale ? 'Последние сохранённые данные' : d.cached ? 'Сохранённые данные' : 'Свежие данные'}</strong></div>
            <div><span>Режим</span><strong>${escapeHtml(dataPolicyModeLabel(d.dataPolicy?.mode || 'standard'))}</strong></div>
          </div>
          ${d.dataPolicy?.skipped?.length ? `<div class="policy-list"><strong>Что было пропущено для экономии/качества:</strong><ul>${d.dataPolicy.skipped.map(x => `<li>${escapeHtml(publicText(x))}</li>`).join('')}</ul></div>` : ''}
          <p class="tiny warning">${escapeHtml(publicText(d.disclaimer || ''))}</p>
            </section>
          </div>
        </details>
        ${m.referee ? `<section class="panel analysis-referee-line"><h2>Судья</h2><p>${escapeHtml(m.referee)}</p></section>` : ''}
      </div>
        </div>
      </details>
    `;
  
    $('analysisRecheckBtn')?.addEventListener('click', e => analyzeMatch(Number(m.fixtureId), e.currentTarget, { recheck:true }));
    $('kickoffMatchCenterBtn')?.addEventListener('click', e => openMatchCenter(Number(m.fixtureId), e.currentTarget));
    $('reminderBtn')?.addEventListener('click', () => toggleReminder(m));
    $('shareAnalysisBtn')?.addEventListener('click', () => shareAnalysis(d));
    $('analysis')?.querySelectorAll('[data-analysis-favorite]').forEach(btn => btn.addEventListener('click', () => toggleFavorite({
      id:Number(btn.dataset.analysisFavorite || 0),
      name:btn.dataset.teamName || '',
      logo:btn.dataset.teamLogo || '',
    })));
    $('openPrematchBrief')?.addEventListener('click', () => setAnalysisTab('brief', true));
    $('analysis')?.querySelectorAll('[data-cockpit-tab]').forEach(btn => btn.addEventListener('click', () => setAnalysisTab(btn.dataset.cockpitTab || 'overview', true)));
    $('analysis')?.querySelectorAll('[data-open-team]').forEach(btn => btn.addEventListener('click', () => openTeam({
      id: Number(btn.dataset.openTeam), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '',
    })));
    bindAnalysisTabs();
  }

  return {
    pct,
    formSequence,
    likelyOutcomeDisplay,
    formCard,
    modelWeightsText,
    bullets,
    reminderFor,
    hasReminder,
    syncQuickReminderButton,
    syncAllQuickReminderButtons,
    syncReminderMutationUi,
    toggleReminder,
    clampPercent,
    qualityInfo,
    probabilityStrip,
    compactAbsence,
    lineupBlock,
    shareAnalysis,
    bindRovingTabKeyboard,
    setAnalysisTab,
    bindAnalysisTabs,
    comparisonValue,
    comparisonMetricRow,
    comparisonAdvantages,
    comparisonTeamHeader,
    prematchOutcomeName,
    prematchDriverCard,
    prematchScenarioCard,
    prematchSourceRow,
    prematchBriefHtml,
    providerCoverageHtml,
    aiInstructorHtml,
    openLaunchFixture,
    applyLaunchIntent,
    analysisFreshnessHtml,
    kickoffHandoffHtml,
    dataProvenanceHtml,
    cockpitProviderLabel,
    matchCockpitHtml,
    analysisGlanceHtml,
    renderAnalysis,
  };
}
