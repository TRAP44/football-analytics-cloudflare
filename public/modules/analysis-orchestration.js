export function createAnalysisOrchestrationModule(deps = {}) {
  const {
    activeViewId,
    aiTrackRecordRenderer,
    aiTrackRecordRendererPromise,
    api,
    dateTime,
    ensureAnalysisController,
    ensureMatchCenterExtras,
    escapeHtml,
    historyRenderer,
    historyRendererPromise,
    recoveryCardHtml,
    relativeAge,
    renderAnalysis,
    renderMatchCenter,
    renderMatches,
    requestMatchCenter,
    safeUrl,
    sendActionError,
    sendProductAction,
    showView,
    state,
    toast,
  } = deps;

  function syncAnalysisBusyUi() {
    document.querySelectorAll('.analyze-btn[data-fixture], #centerAnalyzeBtn').forEach(button => {
      button.disabled = Boolean(state.analysisActionPending);
      button.classList.toggle('is-pending', Boolean(state.analysisActionPending));
    });
  }
  
  async function analyzeMatch(fixtureId, btn, options = {}) {
    const controller = await ensureAnalysisController();
    return controller.analyzeMatch(fixtureId, btn, options);
  }
  
  function historyItemFromAnalysis(data = {}) {
    const match = data?.match || {};
    const fixtureId = Number(match.fixtureId || 0);
    if (!fixtureId) return null;
    return {
      fixtureId,
      homeName: match.home?.name || '',
      awayName: match.away?.name || '',
      leagueName: match.league || '',
      fixtureDate: match.date || '',
      homeLogo: match.home?.logo || '',
      awayLogo: match.away?.logo || '',
      aiSignalCode: data?.aiInstructor?.betSignal?.code || '',
      aiSignalLabel: data?.aiInstructor?.betSignal?.label || '',
      aiConfidence: Number(data?.aiInstructor?.confidenceScore ?? 0) || null,
      aiRisk: data?.aiInstructor?.riskLabel || '',
      aiOutcome: data?.aiInstructor?.verdict?.outcome || '',
      aiTotal: data?.aiInstructor?.verdict?.total || '',
      aiBtts: data?.aiInstructor?.verdict?.btts || '',
      analysisVersion: data?.analysisVersion || '',
      viewedAt: new Date().toISOString(),
    };
  }
  
  function rememberHistoryAnalysis(data) {
    const item = historyItemFromAnalysis(data);
    if (!item) return;
    state.history = [item, ...state.history.filter(x => Number(x.fixtureId) !== item.fixtureId)].slice(0, 50);
    state.historyLoaded = true;
    state.historyLoadError = '';
    state.historyRevision += 1;
    if (activeViewId() === 'historyView') renderHistory();
    if (state.matches.length) renderMatches();
  }
  
  
  async function loadAiTrackRecord(force = false) {
    if (state.aiTrackRecordLoading) return;
    state.aiTrackRecordLoading=true;
    state.aiTrackRecordError='';
    renderAiTrackRecord();
    try {
      const data=await api(`/api/ai-track-record?days=180${force?'&refresh=1':''}`,{retry:false,timeoutMs:9000});
      state.aiTrackRecord=data;
      state.aiTrackRecordLoaded=true;
    } catch (error) {
      state.aiTrackRecordError=error.message || 'Не удалось загрузить протокол AI.';
    } finally {
      state.aiTrackRecordLoading=false;
      renderAiTrackRecord();
    }
  }
  
  let aiTrackRecordRenderer = null;
  let aiTrackRecordRendererPromise = null;
  async function ensureAiTrackRecordRenderer() {
    if (aiTrackRecordRenderer) return aiTrackRecordRenderer;
    if (!aiTrackRecordRendererPromise) {
      aiTrackRecordRendererPromise = import('./modules/ai-track-record-renderer.js').then(({ createAiTrackRecordRenderer }) => {
        aiTrackRecordRenderer = createAiTrackRecordRenderer({
          state,
          elementById: $,
          escapeHtml,
          dateTime,
          onRetry: force => loadAiTrackRecord(force),
        });
        return aiTrackRecordRenderer;
      });
    }
    return aiTrackRecordRendererPromise;
  }
  
  function renderAiTrackRecord() {
    if (aiTrackRecordRenderer) return aiTrackRecordRenderer.renderAiTrackRecord();
    void ensureAiTrackRecordRenderer().then(module => module?.renderAiTrackRecord());
  }
  
  async function loadHistory(showLoader = true) {
    if (state.historyLoading) return;
    const revisionAtStart = state.historyRevision;
    state.historyLoading = true;
    state.historyLoadError = '';
    if (showLoader || !state.historyLoaded) renderHistory();
    try {
      const data = await api('/api/history');
      if (revisionAtStart !== state.historyRevision) return;
      state.history = data.items || [];
      state.historyLoaded = true;
      state.historyLoadError = '';
      if (state.matches.length) renderMatches();
    } catch (e) {
      if (revisionAtStart !== state.historyRevision) return;
      state.historyLoadError = e.message || 'Не удалось загрузить историю.';
      sendActionError('history', e, 'historyView');
    } finally {
      state.historyLoading = false;
      renderHistory();
    }
  }
  
  async function openHistoryAnalysis(fixtureId, btn) {
    const sourceView = activeViewId();
    if (sourceView !== 'analysisView') state.analysisBackView = sourceView;
    const seq = ++state.historyOpenRequestSeq;
    const original = btn?.textContent || '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Открываю…'; }
    try {
      const data = await api(`/api/history-analysis?fixtureId=${Number(fixtureId)}`, { retry: false, timeoutMs: 9000 });
      if (seq !== state.historyOpenRequestSeq) return;
      state.currentCenter = null;
      renderAnalysis(data);
      showView('analysisView', { fromHistoryOpen: true });
      sendProductAction('history_item_open', 'historyView');
    } catch (error) {
      if (seq !== state.historyOpenRequestSeq) return;
      if (Number(error?.status || 0) === 404) {
        const [center] = await Promise.all([
          requestMatchCenter(fixtureId, {}, { timeoutMs: 9000 }),
          ensureMatchCenterExtras(),
        ]);
        if (seq !== state.historyOpenRequestSeq || !center) return;
        renderMatchCenter(center);
        showView('analysisView', { fromHistoryOpen: true });
        toast('Сохранённый полный анализ уже недоступен — открыт центр матча.');
      } else {
        sendActionError('history', error, 'historyView');
        toast(error.message);
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = original; }
    }
  }
  
  let historyRenderer = null;
  let historyRendererPromise = null;
  async function ensureHistoryRenderer() {
    if (historyRenderer) return historyRenderer;
    if (!historyRendererPromise) {
      historyRendererPromise = import('./modules/history-renderer.js').then(({ createHistoryRenderer }) => {
        historyRenderer = createHistoryRenderer({
          state,
          elementById: $,
          recoveryCardHtml,
          escapeHtml,
          safeUrl,
          dateTime,
          relativeAge,
          onReloadHistory: force => loadHistory(force),
          onOpenSearch: () => showView('searchView'),
          onOpenHistoryAnalysis: (fixtureId, button) => openHistoryAnalysis(fixtureId, button),
        });
        return historyRenderer;
      });
    }
    return historyRendererPromise;
  }
  
  function renderHistory() {
    if (historyRenderer) return historyRenderer.renderHistory();
    void ensureHistoryRenderer().then(module => module?.renderHistory());
  }

  return {
    syncAnalysisBusyUi,
    analyzeMatch,
    historyItemFromAnalysis,
    rememberHistoryAnalysis,
    loadAiTrackRecord,
    ensureAiTrackRecordRenderer,
    renderAiTrackRecord,
    loadHistory,
    openHistoryAnalysis,
    ensureHistoryRenderer,
    renderHistory,
  };
}
