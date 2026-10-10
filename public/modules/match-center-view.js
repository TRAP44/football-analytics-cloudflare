import { homeMatchScoreLabel } from './home-match-priority.js';

// «Штаб матча» — главный AI-экран MatchRadar.
// Разметка вынесена из app.js в ленивый модуль: стартовый JS не растёт, а
// экран грузится вместе с остальными модулями штаба (ensureMatchCenterExtras).
// Вкладки: ✦ AI (по умолчанию) · Обзор · Игра · Составы.
// Вероятности показываются только из сохранённого AI-разбора пользователя,
// никогда из d.probabilities payload штаба — так было и раньше.

export const MATCH_CENTER_TABS = Object.freeze(['ai', 'summary', 'game', 'lineups']);
export const DEFAULT_MATCH_CENTER_TAB = 'ai';

export function normalizeMatchCenterTab(tab) {
  return MATCH_CENTER_TABS.includes(tab) ? tab : DEFAULT_MATCH_CENTER_TAB;
}

export function renderMatchCenterView(d, deps) {
  const {
    state, $, escapeHtml, publicText, safeUrl, timeOf, dateTime, isAdmin, isWatchedMatch, positiveEntityId,
    matchCenterExtraHtml, matchChangeNarrativeHtml, liveAiCoachHtml, smartInsightsHeroHtml, smartInsightsFullHtml,
    postMatchReviewHtml, centerKeyStatsHtml, liveEventsHtml, centerAbsenceSummary, liveAbsencesHtml,
    centerCoverageHtml, centerFreshnessHtml, eventQualityHintHtml, timelineEventsHtml, statisticsQualityHintHtml,
    xgQualityHintHtml, centerAllStatsHtml, lineupLiveHtml, availabilityQualityHintHtml, centerPlayersHtml,
    centerMarketHtml, analysisHistoryForFixture, aiConfidenceMeterHtml,
    bindMatchCenterTabs, setMatchCenterTab, openPlayerFromMatch, openTeam, toggleMatchWatch,
    syncQuickReminderButton, toggleReminder, analyzeMatch, loadHistory, openHistoryAnalysis, openPassStoreForFixture,
    runProviderCoverageAudit, openProfileView, runProviderE2E, requestMatchCenter, renderMatchCenter, toast,
    startLiveRefresh, stopLiveRefresh,
  } = deps;

  const m = d.match || {};
  const live = d.mode === 'live';
  const finished = d.mode === 'finished';
  const upcoming = d.mode === 'upcoming';
  const scoreText = upcoming
    ? timeOf(m.date)
    : homeMatchScoreLabel({...m,live,finished});
  const statusText = live ? '● LIVE' : finished ? 'Завершён' : 'Предстоит';
  const eventRows=Array.isArray(d.events) ? d.events : [];
  const latestEvents=upcoming ? [] : eventRows.slice(-3).reverse();
  const matchPulseHtml=matchCenterExtraHtml('renderMatchPulse',{
    ...d,
    events:eventRows,
  });
  const aiTimelineCompactHtml=matchCenterExtraHtml('renderAiTimelineCompact', d.aiTimeline || {}, m);
  const aiTimelineDetailsHtml=matchCenterExtraHtml('renderAiTimelineDetails', d.aiTimeline || {}, m);
  const hasAbsences=Boolean(d.availabilityQuality?.observed || d.absences?.home?.length || d.absences?.away?.length);
  const history=analysisHistoryForFixture(m.fixtureId);
  const fixtureId=Number(m.fixtureId || 0);
  state.currentCenterTab=normalizeMatchCenterTab(state.currentCenterTab);

  // «Вывод AI»: сохранённый разбор пользователя или честное приглашение его запустить.
  // История разборов грузится лениво: пока не загружена, отсутствие разбора не подтверждено.
  const historyPending = !history && !state.historyLoaded && !state.historyLoadError;
  const historyUnknown = !history && !state.historyLoaded && Boolean(state.historyLoadError);
  // Заголовок карточки нейтральный: метки сигнала из истории бывают ставочными
  // (тоталы, исходы в рыночной записи), поэтому ни aiSignalLabel, ни aiOutcome здесь не выводим.
  const aiCardBody = historyPending
    ? `<h2 id="mrAiCardTitle">Проверяю сохранённые AI-разборы…</h2>
       <p class="mr-ai-card-note">Секунду: смотрю, разбирал ли AI этот матч раньше.</p>`
    : history
    ? `<h2 id="mrAiCardTitle">AI уже разобрал этот матч</h2>
       <p class="mr-ai-card-note">Вероятности исходов, ключевые факторы и что может изменить картину — в полном разборе.</p>
       ${aiConfidenceMeterHtml(history)}
       <button class="primary-btn mr-ai-card-btn" type="button" data-center-open-analysis="${fixtureId}">Открыть полный AI-разбор</button>`
    : historyUnknown
    ? `<h2 id="mrAiCardTitle">Не удалось проверить сохранённые разборы</h2>
       <p class="mr-ai-card-note">Проверим ещё раз, чтобы не тратить дневной лимит на повторный разбор.</p>
       <button id="centerHistoryRetryBtn" class="primary-btn mr-ai-card-btn" type="button">Проверить ещё раз</button>`
    : upcoming
      ? `<h2 id="mrAiCardTitle">AI ещё не разбирал этот матч</h2>
         <p class="mr-ai-card-note">Разбор посчитает вероятности исходов, ключевые факторы и риски. Учитывается в дневном лимите разборов.</p>
         <button id="centerAnalyzeBtn" class="primary-btn mr-ai-card-btn" type="button">✦ Запустить AI-разбор</button>`
      : `<h2 id="mrAiCardTitle">AI-разбор до матча не запускался</h2>
         <p class="mr-ai-card-note">Ниже — что AI видит по данным матча прямо сейчас.</p>`;

  $('analysis').innerHTML = `
    <section class="panel center-hero mr-hq-hero ${live ? 'is-live' : ''}">
      <div class="center-hero-top">
        <span class="center-competition">${escapeHtml(m.league || '')}${m.round ? ` · ${escapeHtml(m.round)}` : ''}</span>
        <span class="live-pill ${live ? 'active' : finished ? 'finished' : ''}">${statusText}</span>
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

      <div class="center-hero-actions ${isAdmin() ? 'has-admin-audit' : ''}">
        <button id="centerRefreshBtn" class="reminder-btn" type="button">↻ Обновить</button>
        ${upcoming && state.profile?.features?.monetizationEnabled === true ? '<button id="centerMatchPassBtn" class="reminder-btn center-pass-btn" type="button">⭐ Pass на матч</button>' : ''}
        ${isAdmin() ? `<button id="centerCoverageAuditBtn" class="reminder-btn admin-audit-btn" type="button">🧪 Покрытие</button>` : ''}
        ${isAdmin() ? `<button id="centerE2EBtn" class="reminder-btn admin-e2e-btn" type="button">🚦 E2E</button>` : ''}
      </div>
    </section>

    <div class="center-tabs-wrap mr-hq-tabs-wrap">
      <div class="center-tabs mr-hq-tabs" role="tablist" aria-label="Разделы матча">
        <button class="center-tab-btn" data-center-tab="ai" type="button">✦ AI</button>
        <button class="center-tab-btn" data-center-tab="summary" type="button">Обзор</button>
        <button class="center-tab-btn" data-center-tab="game" type="button">${live ? 'LIVE' : 'Игра'}</button>
        <button class="center-tab-btn" data-center-tab="lineups" type="button">Составы</button>
      </div>
    </div>

    <div class="center-tab-panel match-center-primary" data-center-panel="ai" aria-label="AI о матче">
      <section class="panel mr-ai-card" aria-labelledby="mrAiCardTitle">
        <div class="mr-ai-card-head"><span class="mr-kicker">✦ Вывод AI</span>${history?.aiConfidence ? `<span class="mr-ai-card-conf">уверенность ${Math.round(Number(history.aiConfidence))}/100</span>` : ''}</div>
        ${aiCardBody}
      </section>
      ${matchChangeNarrativeHtml(d, m)}
      ${aiTimelineCompactHtml}
      ${aiTimelineDetailsHtml}
      ${live ? liveAiCoachHtml(d.liveAiCoach, m) : ''}
      ${smartInsightsHeroHtml(d.smartInsights, m)}
      ${finished ? postMatchReviewHtml(d.postMatchReview || {}, m) : ''}
      ${d.smartInsights?.available ? `<div data-center-section="insights">${smartInsightsFullHtml(d.smartInsights, m)}</div>` : ''}
      <p class="mr-ai-honesty">AI показывает только то, что есть в данных матча. Это аналитика, а не гарантия результата.</p>
    </div>

    <div class="center-tab-panel" data-center-panel="summary">
      ${matchCenterExtraHtml('renderMatchHeadquarters',d)}
      <section class="panel observation-controls" aria-label="Наблюдение за матчем">
        <p class="muted">Наблюдение сохраняет матч на этом устройстве. Telegram-напоминание включается отдельно.</p>
        ${!finished || isWatchedMatch(m.fixtureId) ? `<button id="centerWatchBtn" class="secondary-btn" type="button" aria-pressed="${isWatchedMatch(m.fixtureId)}">${isWatchedMatch(m.fixtureId)?'Убрать из наблюдения':'Следить за матчем'}</button>` : ''}
        ${upcoming ? `<button class="quick-reminder-btn secondary-btn" data-quick-reminder="${positiveEntityId(m.fixtureId)}" type="button">Telegram-напоминание</button>` : ''}
      </section>
      ${d.note ? `<section class="panel center-note"><p class="tiny warning">${escapeHtml(publicText(d.note))}</p></section>` : ''}
      <section class="panel center-primary-metrics">
        <div class="center-section-title"><div><span class="center-priority-label">ГЛАВНОЕ</span><h2>Ключевые показатели</h2><p>Самые полезные метрики без перегрузки</p></div></div>
        ${centerKeyStatsHtml(d.statistics)}
      </section>
      ${hasAbsences ? `<section class="panel"><div class="center-section-title"><div><h2>🩺 Потери состава</h2><p>Доступность игроков и важные отсутствия</p></div></div>${centerAbsenceSummary(d.absences,m)}</section>` : ''}
      ${m.venue || m.city || m.referee ? `<section class="panel center-meta-line mr-hq-meta">${m.venue || m.city ? `<span>🏟 ${escapeHtml([m.venue, m.city].filter(Boolean).join(', '))}</span>` : ''}${m.referee ? `<span>Судья: ${escapeHtml(m.referee)}</span>` : ''}</section>` : ''}
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

    <div class="center-tab-panel" data-center-panel="game">
      ${matchPulseHtml}
      ${latestEvents.length ? `<section class="panel center-primary-events"><div class="center-section-title"><div><span class="center-priority-label">СЕЙЧАС</span><h2>Последние события</h2><p>Что недавно изменило ход матча</p></div></div>${liveEventsHtml(latestEvents)}</section>` : ''}
      <section class="panel">
        <div class="center-section-title"><div><h2>Хронология матча</h2><p>Голы, карточки, замены и видеопросмотры</p></div></div>
        ${eventQualityHintHtml(d.eventQuality)}
        ${timelineEventsHtml(eventRows, m)}
      </section>
      <section class="panel">
        <div class="center-section-title"><div><h2>Статистика матча</h2><p>Сравнение команд по доступным показателям</p></div></div>
        ${statisticsQualityHintHtml(d.statisticsQuality)}
        ${xgQualityHintHtml(d.xgQuality)}
        ${centerAllStatsHtml(d.statistics)}
      </section>
      <details class="panel analysis-disclosure center-market-panel">
        <summary>Рыночные данные</summary>
        <div class="analysis-disclosure-body">
          <div class="center-section-title"><div><h2>Оценка рынка</h2><p>Как рынок оценивает исходы П1 / Н / П2 и как это меняется</p></div></div>
          ${centerMarketHtml(d)}
        </div>
      </details>
    </div>

    <div class="center-tab-panel" data-center-panel="lineups">
      <section class="panel">
        <div class="center-section-title"><div><h2>Составы и схема</h2><p>Стартовые составы, схемы и запасные</p></div></div>
        ${lineupLiveHtml(d.lineups, m)}
      </section>
      ${hasAbsences ? `<section class="panel"><h2>Потери и сомнения</h2>${availabilityQualityHintHtml(d.availabilityQuality)}${liveAbsencesHtml(d.absences,m)}</section>` : ''}
      <section class="panel">
        <div class="center-section-title"><div><h2>Игроки матча</h2><p>Лучшие доступные показатели игроков и рейтинг</p></div></div>
        ${centerPlayersHtml(d.playerLeaders, m)}
      </section>
    </div>
  `;

  const root=$('analysis');
  bindMatchCenterTabs();
  root.querySelectorAll('.smart-open-insights').forEach(btn => btn.addEventListener('click', () => {
    setMatchCenterTab('ai', false);
    requestAnimationFrame(() => {
      root.querySelector('[data-center-section="insights"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }));

  root.querySelectorAll('[data-center-player]').forEach(btn => btn.addEventListener('click', () => {
    openPlayerFromMatch(Number(btn.dataset.centerPlayer || 0), btn.dataset.centerPlayerSide || '');
  }));

  root.querySelectorAll('[data-center-team]').forEach(btn => btn.addEventListener('click', () => {
    const teamId = Number(btn.dataset.centerTeam || 0);
    if (!teamId) return;
    openTeam(teamId, btn);
  }));

  root.querySelector('[data-center-open-analysis]')?.addEventListener('click', e => openHistoryAnalysis(fixtureId, e.currentTarget));
  $('centerWatchBtn')?.addEventListener('click',()=>toggleMatchWatch({...m,finished:false}));
  root.querySelectorAll('[data-quick-reminder]').forEach(button=>{syncQuickReminderButton(button,m.fixtureId);if(!state.remindersLoaded){button.disabled=true;button.textContent=state.remindersLoadError?'Напоминания недоступны · обновите в профиле':'Загружаю напоминания…';}button.addEventListener('click',()=>toggleReminder(m));});
  $('centerAnalyzeBtn')?.addEventListener('click', e => analyzeMatch(Number(m.fixtureId), e.currentTarget));
  $('centerHistoryRetryBtn')?.addEventListener('click', e => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Проверяю…';
    void loadHistory(false);
  });
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
// end renderMatchCenterView
