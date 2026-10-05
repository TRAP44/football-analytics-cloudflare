export function createMatchCenterRenderModule(deps = {}) {
  const {
    $,
    analyzeMatch,
    api,
    availabilityQualityHintHtml,
    bindRovingTabKeyboard,
    centerAllStatsHtml,
    centerKeyStatsHtml,
    centerPlayersHtml,
    dateTime,
    ensureMatchCenterController,
    escapeHtml,
    eventQualityHintHtml,
    isAdmin,
    lineupLiveHtml,
    liveAbsencesHtml,
    liveEventsHtml,
    matchCenterExtras,
    minuteLabel,
    oddsMovementHtml,
    oddsQualityHintHtml,
    openPassStoreForFixture,
    openPlayerFromMatch,
    openProfileView,
    openTeam,
    publicText,
    renderProvider,
    requestMatchCenter,
    runProviderCoverageAudit,
    runProviderE2E,
    safeUrl,
    signedPp,
    startLiveRefresh,
    state,
    statisticsQualityHintHtml,
    stopLiveRefresh,
    timeOf,
    timelineEventsHtml,
    toast,
    xgQualityHintHtml,
  } = deps;

  function freshnessSourceLabel(source) {
    return ({
      embedded: 'данные матча',
      api: 'источник данных',
      cache: 'сохранённые данные',
      stale: 'резервные сохранённые данные',
      skipped: 'пропущено',
      error: 'ошибка',
    })[source] || publicText(source) || '—';
  }
  
  function freshnessAgeLabel(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s)) return '';
    if (s < 60) return `${Math.max(0, Math.round(s))}с`;
    if (s < 3600) return `${Math.round(s / 60)}м`;
    return `${Math.round(s / 3600)}ч`;
  }
  
  function centerFreshnessHtml(d) {
    const rows = Object.entries(d.dataFreshness || {});
    if (!rows.length) return '';
    const names = { events:'События', statistics:'Статистика', players:'Игроки', lineups:'Составы', injuries:'Потери', liveOdds:'Коэффициенты' };
    return `<div class="center-freshness">
      ${rows.map(([key, meta]) => `<div class="${escapeHtml(meta?.source || '')}">
        <span>${escapeHtml(names[key] || key)}</span>
        <strong>${escapeHtml(freshnessSourceLabel(meta?.source))}</strong>
        <small>${freshnessAgeLabel(meta?.ageSeconds)}${meta?.policy?.ttlSeconds ? ` · срок обновления ${Math.round(Number(meta.policy.ttlSeconds)/60*10)/10} мин.` : ''}</small>
      </div>`).join('')}
    </div>`;
  }
  
  function centerCoverageHtml(d) {
    const cells = [
      ['События', d.availability?.events],
      ['Статистика', d.availability?.statistics],
      ['xG', d.availability?.xg],
      ['Составы', d.availability?.lineups],
      ['Игроки', d.availability?.players],
      ['Потери', d.availability?.injuries],
      ['Рынок', Boolean(d.availability?.liveOdds)],
    ];
    return `<div class="center-coverage">${cells.map(([label,ok])=>`<span class="${ok?'ok':''}">${ok?'✓':'·'} ${label}</span>`).join('')}</div>`;
  }
  
  function centerMarketHtml(d) {
    const quality = oddsQualityHintHtml(d.liveOddsQuality);
    if (!d.liveOdds) return `${quality}<div class="empty compact-empty">Коэффициенты П1 / Н / П2 в реальном времени сейчас недоступны. Покрытие зависит от турнира и режима данных.</div>`;
    return `${quality}<div class="center-market">
      <div class="odds-grid">
        <div><span>П1</span><strong>${d.liveOdds.odds?.home ?? '—'}</strong></div>
        <div><span>Н</span><strong>${d.liveOdds.odds?.draw ?? '—'}</strong></div>
        <div><span>П2</span><strong>${d.liveOdds.odds?.away ?? '—'}</strong></div>
      </div>
      <p class="tiny">Источников: ${Number(d.liveOdds.sources || 0)}${d.liveOdds.updatedAt ? ` · ${escapeHtml(String(d.liveOdds.updatedAt))}` : ''}</p>
      <div class="odds-movement-wrap"><h3>Движение рынка</h3>${oddsMovementHtml(d.oddsMovement)}</div>
    </div>`;
  }
  
  function centerAbsenceSummary(absences, match) {
    const side = (name, rows = [], summary = {}) => {
      const total=rows.length;
      const injury=Number(summary.injury || 0)+Number(summary.illness || 0);
      const suspension=Number(summary.suspension || 0);
      const doubtful=Number(summary.doubtful || 0);
      return `<div>
        <span>${escapeHtml(name)}</span><strong>${total}</strong><small>активных отметок</small>
        <p>${injury ? `🚑 ${injury}` : ''}${suspension ? `${injury ? ' · ' : ''}🟥 ${suspension}` : ''}${doubtful ? `${injury || suspension ? ' · ' : ''}❔ ${doubtful}` : ''}</p>
      </div>`;
    };
    const hc = absences?.home?.length || 0;
    const ac = absences?.away?.length || 0;
    if (!hc && !ac) return '';
    return `<div class="center-absence-summary">
      ${side(match.home?.name || 'Хозяева', absences?.home || [], absences?.summary?.home || {})}
      ${side(match.away?.name || 'Гости', absences?.away || [], absences?.summary?.away || {})}
    </div>`;
  }
  
  function setMatchCenterTab(tab, scroll = false) {
    state.currentCenterTab = tab || 'summary';
    const buttons = [...document.querySelectorAll('.center-tab-btn')];
    const panels = [...document.querySelectorAll('.center-tab-panel')];
    buttons.forEach(btn => {
      const active = btn.dataset.centerTab === state.currentCenterTab;
      const name = btn.dataset.centerTab || 'summary';
      btn.id = `center-tab-${name}`;
      btn.classList.toggle('active', active);
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', `center-panel-${name}`);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });
    panels.forEach(panel => {
      const active = panel.dataset.centerPanel === state.currentCenterTab;
      const name = panel.dataset.centerPanel || 'summary';
      panel.id = `center-panel-${name}`;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
      panel.toggleAttribute('inert', !active);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `center-tab-${name}`);
      panel.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    if (scroll) document.querySelector('.center-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  
  function bindMatchCenterTabs() {
    const buttons = [...document.querySelectorAll('.center-tab-btn')];
    buttons.forEach(btn => btn.addEventListener('click', () => setMatchCenterTab(btn.dataset.centerTab, false)));
    bindRovingTabKeyboard(buttons, 'centerTab', value => setMatchCenterTab(value, false));
    setMatchCenterTab(state.currentCenterTab || 'summary');
  }
  
  
  function insightSideLabel(side, match) {
    if (side === 'home') return match.home?.name || 'Хозяева';
    if (side === 'away') return match.away?.name || 'Гости';
    return 'Матч';
  }
  
  function smartInsightCardHtml(insight, match) {
    const sideClass = insight.side === 'home' ? 'home' : insight.side === 'away' ? 'away' : 'neutral';
    const metrics = Array.isArray(insight.metrics) && insight.metrics.length
      ? `<div class="insight-metrics">${insight.metrics.map(m => `<span>${escapeHtml(m.label || '')}: <b>${m.home ?? '—'} — ${m.away ?? '—'}</b></span>`).join('')}</div>`
      : '';
    return `<article class="smart-insight-card ${sideClass} ${escapeHtml(insight.importance || 'medium')}">
      <div class="smart-insight-icon">${escapeHtml(insight.icon || '💡')}</div>
      <div class="smart-insight-body">
        <div class="smart-insight-kicker">${escapeHtml(insightSideLabel(insight.side, match))}</div>
        <h3>${escapeHtml(publicText(insight.title || 'Наблюдение'))}</h3>
        <p>${escapeHtml(publicText(insight.text || ''))}</p>
        ${metrics}
      </div>
    </article>`;
  }
  
  function matchChangeNarrativeHtml(d = {}, match = {}) {
    const items = [];
    const mode = String(d.mode || '');
    const events = Array.isArray(d.events) ? d.events : [];
    const latest = [...events].reverse().find(event => {
      const type = String(event?.type || '').toLowerCase();
      const detail = String(event?.detail || '').toLowerCase();
      return type.includes('goal')
        || type.includes('card')
        || type.includes('subst')
        || detail.includes('goal')
        || detail.includes('card')
        || detail.includes('subst');
    });
  
    if (latest && mode !== 'upcoming') {
      const type = String(latest.type || '').toLowerCase();
      const detail = String(latest.detail || '').toLowerCase();
      const icon = type.includes('goal') || detail.includes('goal')
        ? '⚽'
        : type.includes('card') || detail.includes('card')
          ? '🟨'
          : '🔄';
      const actor = latest.player || latest.teamName || (latest.side === 'home' ? match.home?.name : latest.side === 'away' ? match.away?.name : '');
      items.push({
        icon,
        title: `${minuteLabel(latest)} · ${publicText(latest.label || latest.detail || latest.type || 'Событие матча')}`,
        text: actor ? String(actor) : 'Новое событие в хронологии матча.',
        tone: type.includes('goal') || detail.includes('goal') ? 'strong' : 'neutral',
      });
    }
  
    if (mode === 'live' && d.livePressure) {
      const home = Number(d.livePressure.home);
      const away = Number.isFinite(Number(d.livePressure.away)) ? Number(d.livePressure.away) : (Number.isFinite(home) ? 100 - home : NaN);
      const leader = d.livePressure.leader === 'home'
        ? match.home?.name
        : d.livePressure.leader === 'away'
          ? match.away?.name
          : '';
      if (leader && Number.isFinite(home) && Number.isFinite(away) && Math.abs(home - away) >= 12) {
        items.push({
          icon: '⚡',
          title: `${leader} усилил давление`,
          text: `Текущий индекс давления: ${Math.round(home)}:${Math.round(away)}.`,
          tone: 'strong',
        });
      }
    }
  
    const movement = d.oddsMovement?.probabilityChange || null;
    if (movement && typeof movement === 'object') {
      const labels = {
        home: match.home?.name || 'П1',
        draw: 'Ничья',
        away: match.away?.name || 'П2',
      };
      const strongest = Object.entries(movement)
        .map(([key, value]) => ({ key, value: Number(value) }))
        .filter(row => Number.isFinite(row.value))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
      if (strongest && Math.abs(strongest.value) >= 0.5) {
        items.push({
          icon: strongest.value > 0 ? '📈' : '📉',
          title: `Изменилась оценка: ${labels[strongest.key] || strongest.key}`,
          text: `Сдвиг расчётной рыночной вероятности: ${signedPp(strongest.value)}.`,
          tone: strongest.value > 0 ? 'up' : 'down',
        });
      }
    }
  
    if (mode === 'upcoming') {
      const homeAbsences = Number(d.absences?.home?.length || 0);
      const awayAbsences = Number(d.absences?.away?.length || 0);
      const totalAbsences = homeAbsences + awayAbsences;
      if (totalAbsences > 0) {
        items.push({
          icon: '🩺',
          title: 'Есть изменения по доступности игроков',
          text: `${match.home?.name || 'Хозяева'}: ${homeAbsences} · ${match.away?.name || 'Гости'}: ${awayAbsences}.`,
          tone: 'neutral',
        });
      }
    }
  
    if (!items.length) return '';
    const visible = items.slice(0, 3);
    return `<section class="panel match-change-panel">
      <div class="center-section-title">
        <div><span class="center-priority-label">RADAR</span><h2>Что изменилось</h2><p>Последние сигналы, которые реально меняют картину матча</p></div>
      </div>
      <div class="match-change-list">
        ${visible.map(item => `<article class="match-change-item ${escapeHtml(item.tone || 'neutral')}">
          <span class="match-change-icon">${escapeHtml(item.icon || '•')}</span>
          <div><strong>${escapeHtml(publicText(item.title || ''))}</strong><p>${escapeHtml(publicText(item.text || ''))}</p></div>
        </article>`).join('')}
      </div>
    </section>`;
  }
  
  function smartInsightsHeroHtml(si, match) {
    if (!si?.available) {
      return `<section class="panel smart-story-panel is-empty">
        <div class="center-section-title"><div><h2>🧠 Умные инсайты</h2><p>Автоматическое объяснение происходящего</p></div></div>
        <div class="empty compact-empty">Пока недостаточно статистики и событий для содержательного вывода.</div>
      </section>`;
    }
    const first = si.insights?.[0];
    return `<section class="panel smart-story-panel">
      <div class="smart-story-top">
        <div><span class="smart-story-label">🧠 КАРТИНА МАТЧА</span><h2>${escapeHtml(publicText(si.headline || ''))}</h2></div>
        <div class="smart-data-score"><strong>${Number(si.dataScore || 0)}%</strong><span>${escapeHtml(publicText(si.dataLabel || 'Покрытие'))}</span></div>
      </div>
      <p class="smart-story-summary">${escapeHtml(publicText(si.summary || ''))}</p>
      ${first ? `<div class="smart-story-focus"><span>${escapeHtml(first.icon || '💡')}</span><b>${escapeHtml(insightSideLabel(first.side, match))}</b><small>${escapeHtml(first.importance === 'high' ? 'Сильный сигнал' : first.importance === 'medium' ? 'Заметный сигнал' : 'Наблюдение')}</small></div>` : ''}
      <button class="text-btn smart-open-insights" type="button">Все инсайты →</button>
    </section>`;
  }
  
  function smartInsightsFullHtml(si, match) {
    if (!si?.available) {
      return `<div class="empty"><strong>Недостаточно данных</strong><p>Когда появятся статистика и события, здесь будут автоматические выводы по ходу матча.</p></div>`;
    }
    return `<div class="smart-insights-full">
      <section class="panel smart-insight-summary-panel">
        <div class="smart-story-top">
          <div><span class="smart-story-label">ТЕКУЩАЯ КАРТИНА</span><h2>${escapeHtml(si.headline || '')}</h2></div>
          <div class="smart-data-score"><strong>${Number(si.dataScore || 0)}%</strong><span>${escapeHtml(publicText(si.dataLabel || ''))}</span></div>
        </div>
        <p>${escapeHtml(si.summary || '')}</p>
      </section>
      <div class="smart-insight-list">${(si.insights || []).map(x => smartInsightCardHtml(x, match)).join('')}</div>
      <section class="panel smart-methodology"><strong>Как это считается</strong><p>${escapeHtml(publicText(si.methodology || ''))}</p></section>
    </div>`;
  }
  
  function liveAiCoachHtml(ai, match) {
    if (!ai?.available) return '';
    const tone = ['holds','weakened','broken','shifted','wait'].includes(ai.state) ? ai.state : 'neutral';
    const pressure = ai.current?.pressure || {};
    const xg = ai.current?.xg || {};
    const pressureText = Number.isFinite(Number(pressure.home)) && Number.isFinite(Number(pressure.away)) ? `${pressure.home}:${pressure.away}` : '—';
    const xgText = Number.isFinite(Number(xg.home)) && Number.isFinite(Number(xg.away)) ? `${Number(xg.home).toFixed(2)}:${Number(xg.away).toFixed(2)}` : '—';
    const xgQualityLabel = publicText(ai.current?.xgQuality?.label || '');
    const watch = Array.isArray(ai.watchNext) ? ai.watchNext.slice(0,3) : [];
    return `<section class="panel live-ai-coach ${tone}">
      <div class="live-ai-head"><div><span>AI В ЭФИРЕ · ${Number(match.elapsed || 0) ? `${Number(match.elapsed)}′` : 'сейчас'}</span><h2>${escapeHtml(publicText(ai.headline || 'Читаю матч в реальном времени'))}</h2></div><b>${Math.round(Number(ai.confidence || 0))}%</b></div>
      <p class="live-ai-summary">${escapeHtml(publicText(ai.summary || ''))}</p>
      <div class="live-ai-decision"><span>Решение AI сейчас</span><strong>${escapeHtml(publicText(ai.action?.label || 'Наблюдать'))}</strong><small>${escapeHtml(publicText(ai.action?.reason || 'Дождитесь более устойчивой картины.'))}</small></div>
      <div class="live-ai-grid">
        <div><span>Счёт</span><strong>${match.score?.home ?? 0}:${match.score?.away ?? 0}</strong><small>${Number(match.elapsed || 0) ? `${Number(match.elapsed)} мин.` : 'Матч идёт'}</small></div>
        <div><span>Давление</span><strong>${pressureText}</strong><small>${escapeHtml(publicText(ai.current?.pressureLeaderLabel || 'Баланс'))}</small></div>
        <div><span>xG</span><strong>${xgText}</strong><small>${escapeHtml(publicText(ai.current?.chanceLabel || 'По доступным данным'))}${xgQualityLabel ? ` · ${escapeHtml(xgQualityLabel)}` : ''}</small></div>
        <div><span>Риск сценария</span><strong>${escapeHtml(publicText(ai.volatility?.label || 'Средний'))}</strong><small>${escapeHtml(publicText(ai.volatility?.reason || 'Матч может быстро измениться.'))}</small></div>
      </div>
      ${ai.prematch?.available ? `<div class="live-ai-prematch"><span>До матча</span><strong>${escapeHtml(publicText(ai.prematch.signal || ai.prematch.outcome || 'AI-разбор'))}</strong><b>${escapeHtml(publicText(ai.prematch.stateLabel || 'сравниваю'))}</b></div>` : `<div class="live-ai-prematch muted"><span>До матча</span><strong>Сохранённого AI-разбора нет</strong><b>читаю только текущий матч</b></div>`}
      ${watch.length ? `<div class="live-ai-watch"><strong>Что смотреть дальше</strong><ul>${watch.map(x=>`<li>${escapeHtml(publicText(x))}</li>`).join('')}</ul></div>` : ''}
      <p class="live-ai-disclaimer">Оценка по ходу матча перестраивается при каждом обновлении счёта, событий и статистики. Это объяснение сценария, а не гарантия результата.</p>
    </section>`;
  }
  
  function postMatchReviewHtml(review = {}, match = {}) {
    if (!review || !Object.keys(review).length) return '';
    if (!review.available) {
      return `<section class="panel post-match-review unavailable">
        <div class="post-match-review-head"><div><span>🧠 ПОСЛЕ МАТЧА</span><h2>${escapeHtml(review.headline || 'Итог AI недоступен')}</h2></div><b>архив</b></div>
        <p>${escapeHtml(publicText(review.summary || 'Для честного сравнения нужен сохранённый предматчевый снимок.'))}</p>
      </section>`;
    }
    const outcome=review.outcome || {};
    const score=review.score || {};
    const hit=Boolean(outcome.correct);
    const markets=Array.isArray(review.markets)?review.markets:[];
    const evidence=Array.isArray(review.evidence)?review.evidence.slice(0,3):[];
    const quality=review.quality || {};
    return `<section class="panel post-match-review ${hit?'hit':'miss'}">
      <div class="post-match-review-head">
        <div><span>🧠 POST-MATCH AI REVIEW</span><h2>${escapeHtml(review.headline || 'Разбор завершён')}</h2></div>
        <b>${hit?'✓ исход':'✕ исход'}</b>
      </div>
      <p class="post-match-summary">${escapeHtml(publicText(review.summary || ''))}</p>
      <div class="post-match-compare">
        <div><span>До матча</span><strong>${escapeHtml(outcome.predictedLabel || '—')}${Number.isFinite(Number(outcome.probability))?` · ${Number(outcome.probability)}%`:''}</strong><small>максимальная вероятность модели</small></div>
        <div><span>Факт</span><strong>${escapeHtml(outcome.actualLabel || '—')} · ${Number(score.home)}:${Number(score.away)}</strong><small>финальный результат</small></div>
      </div>
      ${markets.length?`<div class="post-match-markets">${markets.map(x=>`<div class="${x.correct?'hit':'miss'}"><span>${x.correct?'✓':'✕'} ${escapeHtml(x.label || '')}</span><strong>${escapeHtml(x.predicted || '—')} → ${escapeHtml(x.actual || '—')}</strong><small>${Number.isFinite(Number(x.probability))?`до матча ${Number(x.probability)}%`:''}</small></div>`).join('')}</div>`:''}
      ${evidence.length?`<div class="post-match-evidence"><strong>Что видно по матчу</strong>${evidence.map(x=>`<div><span>${escapeHtml(x.icon || '•')}</span><p><b>${escapeHtml(x.title || '')}</b><small>${escapeHtml(publicText(x.text || ''))}</small></p></div>`).join('')}</div>`:''}
      <div class="post-match-calibration">
        <span>Калибровка</span>
        <p>${escapeHtml(publicText(review.calibration?.note || ''))}</p>
        ${Number.isFinite(Number(quality.brier))?`<small>Brier: ${Number(quality.brier).toFixed(3)} · чем меньше, тем точнее были вероятности</small>`:''}
      </div>
      <p class="tiny warning">${escapeHtml(publicText(review.disclaimer || ''))}</p>
    </section>`;
  }
  
  function renderMatchCenter(d) {
    $('analysis')?.setAttribute('aria-busy', 'false');
    const previousFixture = Number(state.currentCenter?.match?.fixtureId || 0);
    state.currentCenter = d;
    if (isAdmin() && d?.provider?.visibility === 'admin') { state.provider = d.provider; renderProvider(); }
    state.currentAnalysis = null;
    const m = d.match || {};
    if (previousFixture && previousFixture !== Number(m.fixtureId || 0)) state.currentCenterTab = 'summary';
  
    const live = d.mode === 'live';
    const finished = d.mode === 'finished';
    const upcoming = d.mode === 'upcoming';
    const score = m.score || {};
    const scoreText = upcoming ? timeOf(m.date) : `${score.home ?? 0} : ${score.away ?? 0}`;
    const statusText = live ? '● ИДЁТ' : finished ? '✓ ЗАВЕРШЁН' : 'ПРЕДСТОИТ';
    const latestEvents = (d.events || []).slice(-3).reverse();
  
    $('analysis').innerHTML = `
      <section class="panel center-hero ${live ? 'is-live' : ''}">
        <div class="center-brand-kicker">MatchRadar · Центр матча</div>
        <div class="center-hero-top">
          <span class="live-pill ${live ? 'active' : finished ? 'finished' : ''}">${statusText}</span>
          <span class="center-competition">${escapeHtml(m.league || '')}${m.round ? ` · ${escapeHtml(m.round)}` : ''}</span>
        </div>
  
        <div class="center-scoreboard">
          <button class="center-team-card" type="button" data-center-team="${Number(m.home?.id || 0)}">
            ${m.home?.logo ? `<img src="${safeUrl(m.home.logo)}" alt="">` : '<span class="center-logo-fallback">⚽</span>'}
            <strong>${escapeHtml(m.home?.name || '')}</strong>
            <small>Хозяева</small>
          </button>
          <div class="center-score-core">
            <strong>${escapeHtml(scoreText)}</strong>
            <span>${escapeHtml(m.statusLabel || '')}</span>
            ${live ? '<small id="liveRefreshText">Обновляется автоматически</small>' : `<small>${upcoming ? dateTime(m.date) : `Обновлено ${dateTime(d.generatedAt)}`}</small>`}
          </div>
          <button class="center-team-card away" type="button" data-center-team="${Number(m.away?.id || 0)}">
            ${m.away?.logo ? `<img src="${safeUrl(m.away.logo)}" alt="">` : '<span class="center-logo-fallback">⚽</span>'}
            <strong>${escapeHtml(m.away?.name || '')}</strong>
            <small>Гости</small>
          </button>
        </div>
  
        <div class="center-meta-line">
          ${m.venue ? `<span>🏟 ${escapeHtml(m.venue)}</span>` : ''}
          ${m.city ? `<span>📍 ${escapeHtml(m.city)}</span>` : ''}
        </div>
  
        <div class="center-hero-actions ${isAdmin() ? 'has-admin-audit' : ''}">
          <button id="centerRefreshBtn" class="reminder-btn" type="button">↻ Обновить</button>
          ${upcoming ? `<button id="centerAnalyzeBtn" class="primary-btn center-analyze-inline" type="button">🧠 Разобрать матч</button>${state.profile?.features?.monetizationEnabled === true ? '<button id="centerMatchPassBtn" class="reminder-btn center-pass-btn" type="button">⭐ Pass на матч</button>' : ''}` : ''}
          ${isAdmin() ? `<button id="centerCoverageAuditBtn" class="reminder-btn admin-audit-btn" type="button">🧪 Покрытие</button>` : ''}
          ${isAdmin() ? `<button id="centerE2EBtn" class="reminder-btn admin-e2e-btn" type="button">🚦 E2E</button>` : ''}
        </div>
      </section>
  
      ${matchCenterExtras?.renderMatchPulse?.(d) || ''}
  
      ${matchCenterExtras?.renderAiTimelineCompact?.(d.aiTimeline || {}, m) || ''}
  
      ${d.note ? `<section class="panel center-note"><p class="tiny warning">${escapeHtml(publicText(d.note))}</p></section>` : ''}
  
      <div class="match-center-primary" aria-label="Главное о матче">
        ${matchChangeNarrativeHtml(d, m)}
        ${matchCenterExtras?.renderAiTimelineDetails?.(d.aiTimeline || {}, m) || ''}
        ${live ? liveAiCoachHtml(d.liveAiCoach, m) : ''}
        ${smartInsightsHeroHtml(d.smartInsights, m)}
        ${finished ? postMatchReviewHtml(d.postMatchReview || {}, m) : ''}
  
        <section class="panel center-primary-metrics">
          <div class="center-section-title"><div><span class="center-priority-label">ГЛАВНОЕ</span><h2>Ключевые показатели</h2><p>Самые полезные метрики без перегрузки</p></div></div>
          ${centerKeyStatsHtml(d.statistics)}
        </section>
  
        ${latestEvents.length ? `<section class="panel center-primary-events"><div class="center-section-title"><div><span class="center-priority-label">СЕЙЧАС</span><h2>Последние события</h2><p>Что недавно изменило ход матча</p></div></div>${liveEventsHtml(latestEvents)}</section>` : ''}
      </div>
  
      <details class="match-center-more">
        <summary>Статистика, составы и хронология</summary>
        <div class="match-center-more-body">
        <div class="center-tabs-wrap">
        <div class="center-tabs" role="tablist" aria-label="Разделы матча">
          <button class="center-tab-btn" data-center-tab="summary" type="button">Данные</button>
          <button class="center-tab-btn" data-center-tab="insights" type="button">Инсайты</button>
          <button class="center-tab-btn" data-center-tab="timeline" type="button">Хронология</button>
          <button class="center-tab-btn" data-center-tab="stats" type="button">Статистика</button>
          <button class="center-tab-btn" data-center-tab="lineups" type="button">Составы</button>
          <button class="center-tab-btn" data-center-tab="players" type="button">Игроки</button>
          <button class="center-tab-btn" data-center-tab="market" type="button">Рынок</button>
        </div>
      </div>
  
      <div class="center-tab-panel" data-center-panel="summary">
        ${(d.availabilityQuality?.observed || d.absences?.home?.length || d.absences?.away?.length) ? `<section class="panel"><div class="center-section-title"><div><h2>🩺 Потери состава</h2><p>Доступность игроков и важные отсутствия</p></div></div>${centerAbsenceSummary(d.absences,m)}${liveAbsencesHtml(d.absences,m)}</section>` : ''}
  
        <details class="panel analysis-disclosure coverage-panel">
          <summary>Подробнее о данных</summary>
          <div class="analysis-disclosure-body">
          <div class="center-section-title"><div><h2>Покрытие и свежесть</h2><p>${d.cached ? 'Данные из сохранённой версии' : 'Свежие данные источника'} · ${dateTime(d.generatedAt)}</p></div></div>
          ${centerCoverageHtml(d)}
          ${centerFreshnessHtml(d)}
          ${d.quotaMode ? `<div class="quota-public-chip">${escapeHtml(publicText(d.quotaMode.label || ''))} · обновление ${Number(d.quotaMode.liveRefreshSeconds || d.refreshSeconds || 0)} сек.</div>` : ''}
          ${d.availability?.limitedCoverage ? '<div class="coverage-badge limited">Ограниченное покрытие · экономим лимит запросов</div>' : ''}
  
          </div>
        </details>
      </div>
  
      <div class="center-tab-panel" data-center-panel="insights">
        ${smartInsightsFullHtml(d.smartInsights, m)}
      </div>
  
      <div class="center-tab-panel" data-center-panel="timeline">
        <section class="panel">
          <div class="center-section-title"><div><h2>⚡ Хронология матча</h2><p>Голы, карточки, замены и видеопросмотры</p></div></div>
          ${eventQualityHintHtml(d.eventQuality)}
          ${timelineEventsHtml(d.events, m)}
        </section>
      </div>
  
      <div class="center-tab-panel" data-center-panel="stats">
        <section class="panel">
          <div class="center-section-title"><div><h2>📊 Статистика матча</h2><p>Сравнение команд по доступным показателям</p></div></div>
          ${statisticsQualityHintHtml(d.statisticsQuality)}
          ${xgQualityHintHtml(d.xgQuality)}
          ${centerAllStatsHtml(d.statistics)}
        </section>
      </div>
  
      <div class="center-tab-panel" data-center-panel="lineups">
        <section class="panel">
          <div class="center-section-title"><div><h2>👥 Составы и схема</h2><p>Стартовые составы, схемы и запасные</p></div></div>
          ${lineupLiveHtml(d.lineups, m)}
        </section>
        ${(d.availabilityQuality?.observed || d.absences?.home?.length || d.absences?.away?.length) ? `<section class="panel"><h2>🩺 Потери и сомнения</h2>${availabilityQualityHintHtml(d.availabilityQuality)}${liveAbsencesHtml(d.absences,m)}</section>` : ''}
      </div>
  
      <div class="center-tab-panel" data-center-panel="players">
        <section class="panel">
          <div class="center-section-title"><div><h2>⭐ Игроки матча</h2><p>Лучшие доступные показатели игроков и рейтинг</p></div></div>
          ${centerPlayersHtml(d.playerLeaders, m)}
        </section>
      </div>
  
      <div class="center-tab-panel" data-center-panel="market">
        <section class="panel">
          <div class="center-section-title"><div><h2>💹 Рынок в реальном времени</h2><p>Коэффициенты П1 / Н / П2 и изменение расчётной рыночной вероятности</p></div></div>
          ${centerMarketHtml(d)}
        </section>
      </div>
      ${m.referee ? `<section class="panel analysis-referee-line"><h2>Судья</h2><p>${escapeHtml(m.referee)}</p></section>` : ''}
        </div>
      </details>
    `;
  
    bindMatchCenterTabs();
    document.querySelectorAll('.smart-open-insights').forEach(btn => btn.addEventListener('click', () => {
      const details = document.querySelector('.match-center-more');
      if (details) details.open = true;
      setMatchCenterTab('insights', false);
      requestAnimationFrame(() => {
        document.querySelector('[data-center-panel="insights"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }));
  
    document.querySelectorAll('[data-center-player]').forEach(btn => btn.addEventListener('click', () => {
      openPlayerFromMatch(Number(btn.dataset.centerPlayer || 0), btn.dataset.centerPlayerSide || '');
    }));
  
    document.querySelectorAll('[data-center-team]').forEach(btn => btn.addEventListener('click', () => {
      const teamId = Number(btn.dataset.centerTeam || 0);
      if (!teamId) return;
      openTeam(teamId, btn);
    }));
  
    $('centerAnalyzeBtn')?.addEventListener('click', e => analyzeMatch(Number(m.fixtureId), e.currentTarget));
    $('centerMatchPassBtn')?.addEventListener('click', () => { void openPassStoreForFixture(Number(m.fixtureId)); });
    $('centerCoverageAuditBtn')?.addEventListener('click', async () => {
      await runProviderCoverageAudit(Number(m.fixtureId), true);
      await openProfileView();
      setTimeout(() => $('providerAuditResult')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    });
    $('centerE2EBtn')?.addEventListener('click', async () => {
      await runProviderE2E(Number(m.fixtureId));
      await openProfileView();
      setTimeout(() => $('expandedGateSteps')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    });
  
    $('centerRefreshBtn')?.addEventListener('click', async () => {
      const btn = $('centerRefreshBtn');
      btn.disabled = true; btn.textContent = '⏳ Обновляю…';
      try {
        const data = await requestMatchCenter(m.fixtureId, { t: Date.now() });
        if (!data) return;
        state.currentCenter = data;
        renderMatchCenter(data);
      } catch (e) {
        toast(e.message);
        btn.disabled = false; btn.textContent = '↻ Обновить';
      }
    });
  
    if (live) startLiveRefresh(m.fixtureId); else stopLiveRefresh();
  }
  
  async function openMatchCenter(fixtureId, btn) {
    const controller = await ensureMatchCenterController();
    return controller.openMatchCenter(fixtureId, btn);
  }

  return {
    freshnessSourceLabel,
    freshnessAgeLabel,
    centerFreshnessHtml,
    centerCoverageHtml,
    centerMarketHtml,
    centerAbsenceSummary,
    setMatchCenterTab,
    bindMatchCenterTabs,
    insightSideLabel,
    smartInsightCardHtml,
    matchChangeNarrativeHtml,
    smartInsightsHeroHtml,
    smartInsightsFullHtml,
    liveAiCoachHtml,
    postMatchReviewHtml,
    renderMatchCenter,
    openMatchCenter,
  };
}
