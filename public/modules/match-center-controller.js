export function createMatchCenterController({
  state,
  documentRef,
  elementById,
  activeViewId,
  showView,
  api,
  runtimeAllows,
  ensureMatchCenterExtras,
  renderMatchCenter,
  renderJourneyState,
  sendProductAction,
  sendMatchDataCoverage,
  sendOperationTiming,
  sendActionError,
  apiErrorCategory,
  friendlyErrorMessage,
  toast,
  performanceNow = () => globalThis.performance?.now?.() ?? Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = handle => clearTimeout(handle),
}) {
  if (!state || typeof api !== 'function') throw new TypeError('Match Center controller requires state and api.');
  if (!documentRef || typeof activeViewId !== 'function' || typeof showView !== 'function') {
    throw new TypeError('Match Center controller requires documentRef, activeViewId and showView.');
  }

  const $ = typeof elementById === 'function' ? elementById : () => null;
  const canRun = typeof runtimeAllows === 'function' ? runtimeAllows : () => true;
  const ensureExtras = typeof ensureMatchCenterExtras === 'function' ? ensureMatchCenterExtras : async () => null;
  const renderCenter = typeof renderMatchCenter === 'function' ? renderMatchCenter : () => {};
  const renderJourney = typeof renderJourneyState === 'function' ? renderJourneyState : () => {};
  const productAction = typeof sendProductAction === 'function' ? sendProductAction : () => {};
  const coverage = typeof sendMatchDataCoverage === 'function' ? sendMatchDataCoverage : () => {};
  const timing = typeof sendOperationTiming === 'function' ? sendOperationTiming : () => {};
  const actionError = typeof sendActionError === 'function' ? sendActionError : () => {};
  const errorCategory = typeof apiErrorCategory === 'function' ? apiErrorCategory : () => 'error';
  const friendlyError = typeof friendlyErrorMessage === 'function' ? friendlyErrorMessage : error => String(error?.message || 'Не удалось открыть матч.');
  const showToast = typeof toast === 'function' ? toast : () => {};

  const inFlight = new Map();
  let requestSeq = 0;
  let liveRefreshTimer = null;
  let liveRefreshWasActive = false;

  async function requestMatchCenter(fixtureId, extraParams = {}, options = {}) {
    const id = Number(fixtureId);
    const key = String(id);
    const existing = inFlight.get(key);
    if (existing) {
      if (state.clientPerf) state.clientPerf.deduped = Number(state.clientPerf.deduped || 0) + 1;
      return await existing;
    }

    const seq = ++requestSeq;
    const params = new URLSearchParams({ fixtureId: key });
    Object.entries(extraParams || {}).forEach(([paramKey, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(paramKey, String(value));
    });

    const task = (async () => {
      const data = await api(`/api/match-center?${params.toString()}`, options);
      return seq === requestSeq ? data : null;
    })();
    inFlight.set(key, task);
    try {
      return await task;
    } finally {
      if (inFlight.get(key) === task) inFlight.delete(key);
    }
  }

  function isActiveLiveFixture(fixtureId) {
    return liveRefreshWasActive
      && !documentRef.hidden
      && activeViewId() === 'analysisView'
      && state.currentCenter?.mode === 'live'
      && Number(state.currentCenter?.match?.fixtureId || 0) === Number(fixtureId);
  }

  function stopLiveRefresh() {
    if (liveRefreshTimer) clearTimer(liveRefreshTimer);
    liveRefreshTimer = null;
  }

  function deactivateLiveRefresh() {
    stopLiveRefresh();
    liveRefreshWasActive = false;
  }

  function scheduleLiveRefresh(fixtureId) {
    const delayMs = Math.max(15, Number(state.currentCenter?.refreshSeconds || 60)) * 1000;
    liveRefreshTimer = setTimer(async () => {
      liveRefreshTimer = null;
      if (!isActiveLiveFixture(fixtureId)) return;
      try {
        const timingStartedAt = performanceNow();
        const data = await requestMatchCenter(fixtureId, { t: Date.now() });
        if (!data || !isActiveLiveFixture(fixtureId)) return;
        timing('live', timingStartedAt, 'analysisView');
        state.currentCenter = data;
        renderCenter(data);
        if (data.mode !== 'live') liveRefreshWasActive = false;
      } catch (error) {
        if (!isActiveLiveFixture(fixtureId)) return;
        const el = $('liveRefreshText');
        if (el) el.textContent = 'Не удалось обновить. Повторим автоматически.';
        actionError('live_refresh', error, 'analysisView');
      } finally {
        if (isActiveLiveFixture(fixtureId) && !liveRefreshTimer) scheduleLiveRefresh(fixtureId);
      }
    }, delayMs);
  }

  function startLiveRefresh(fixtureId) {
    stopLiveRefresh();
    const el = $('liveRefreshText');
    if (!canRun('liveEnabled')) {
      liveRefreshWasActive = false;
      if (el) el.textContent = 'Автообновление матча временно приостановлено.';
      return;
    }
    liveRefreshWasActive = true;
    if (el) el.textContent = 'Обновляется автоматически';
    if (!documentRef.hidden) scheduleLiveRefresh(fixtureId);
  }

  function suspendLiveRefresh() {
    if (!liveRefreshTimer) return false;
    stopLiveRefresh();
    liveRefreshWasActive = true;
    return true;
  }

  function resumeLiveRefresh() {
    const fixtureId = Number(state.currentCenter?.match?.fixtureId || 0);
    if (!fixtureId || state.currentCenter?.mode !== 'live' || activeViewId() !== 'analysisView' || !liveRefreshWasActive) return false;
    startLiveRefresh(fixtureId);
    return true;
  }

  async function openMatchCenter(fixtureId, button) {
    if (state.analysisActionPending) state.analysisRequestSeq += 1;
    const sourceView = activeViewId();
    if (sourceView !== 'analysisView') state.analysisBackView = sourceView;
    if (Number(state.currentCenter?.match?.fixtureId || 0) !== Number(fixtureId)) state.currentCenterTab = 'summary';

    const original = button?.textContent || '';
    const timingStartedAt = performanceNow();
    const reusableCenter = Number(state.currentCenter?.match?.fixtureId || 0) === Number(fixtureId)
      ? state.currentCenter
      : null;

    if (button) {
      button.disabled = true;
      button.textContent = '⏳ Загружаю матч…';
    }
    showView('analysisView');

    if (!reusableCenter) {
      renderJourney('loading', {
        title: 'Открываем матч',
        message: 'Загружаем счёт, события и доступную статистику.',
      });
    }

    try {
      const extrasPromise = ensureExtras();
      const centerLoad = Promise.all([
        requestMatchCenter(fixtureId),
        extrasPromise,
      ]).then(([data]) => data);

      await extrasPromise;
      if (reusableCenter) renderCenter(reusableCenter);

      const data = await centerLoad;
      if (!data) return;
      renderCenter(data);
      productAction('match_open', sourceView);
      coverage(data, sourceView);
      timing('match', timingStartedAt, sourceView);
      if (data.mode === 'live') {
        productAction('live_open', sourceView);
        timing('live', timingStartedAt, sourceView);
      }
    } catch (error) {
      actionError('match', error, sourceView);
      const category = errorCategory(error);
      const previous = Number(state.currentCenter?.match?.fixtureId || 0) === Number(fixtureId)
        ? state.currentCenter
        : null;

      if (['rate_limit', 'provider'].includes(category)) {
        if (previous) {
          renderCenter(previous);
        } else if (sourceView && sourceView !== 'analysisView') {
          showView(sourceView, { restore: true });
        }
        showToast(friendlyError(error));
      } else {
        renderJourney('error', {
          title: 'Матч временно не открылся',
          message: error?.message || 'Не удалось получить данные матча.',
          retry: () => openMatchCenter(fixtureId, null),
        });
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  }

  return Object.freeze({
    requestMatchCenter,
    openMatchCenter,
    startLiveRefresh,
    stopLiveRefresh,
    deactivateLiveRefresh,
    suspendLiveRefresh,
    resumeLiveRefresh,
    isActiveLiveFixture,
    isLiveRefreshActive: () => liveRefreshWasActive,
  });
}
