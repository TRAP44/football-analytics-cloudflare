export function createAnalysisController({
  state,
  documentRef,
  activeViewId,
  showView,
  api,
  runtimeAllows,
  stopLiveRefresh,
  hideQuotaPaywall,
  showQuotaPaywallForFixture,
  syncAnalysisBusyUi,
  renderJourneyState,
  renderAnalysis,
  renderMatchCenter,
  rememberHistoryAnalysis,
  renderProfile,
  renderProvider,
  renderDiscoveryHome,
  renderGlobalSearch,
  loadHistory,
  loadReminders,
  loadFavorites,
  buildAnalysisAccessUsage,
  refreshPassAccess,
  isAdmin,
  sendProductAction,
  sendOperationTiming,
  sendActionError,
  apiErrorCategory,
  toast,
  performanceNow = () => globalThis.performance?.now?.() ?? Date.now(),
}) {
  if (!state || typeof api !== 'function') throw new TypeError('Analysis controller requires state and api.');
  if (typeof activeViewId !== 'function' || typeof showView !== 'function') {
    throw new TypeError('Analysis controller requires activeViewId and showView.');
  }

  const canRun = typeof runtimeAllows === 'function' ? runtimeAllows : () => true;
  const stopLive = typeof stopLiveRefresh === 'function' ? stopLiveRefresh : () => {};
  const hidePaywall = typeof hideQuotaPaywall === 'function' ? hideQuotaPaywall : () => {};
  const showPaywall = typeof showQuotaPaywallForFixture === 'function' ? showQuotaPaywallForFixture : () => {};
  const syncBusy = typeof syncAnalysisBusyUi === 'function' ? syncAnalysisBusyUi : () => {};
  const renderJourney = typeof renderJourneyState === 'function' ? renderJourneyState : () => {};
  const renderResult = typeof renderAnalysis === 'function' ? renderAnalysis : () => {};
  const renderCenter = typeof renderMatchCenter === 'function' ? renderMatchCenter : () => {};
  const rememberHistory = typeof rememberHistoryAnalysis === 'function' ? rememberHistoryAnalysis : () => {};
  const renderUserProfile = typeof renderProfile === 'function' ? renderProfile : () => {};
  const renderAdminProvider = typeof renderProvider === 'function' ? renderProvider : () => {};
  const renderDiscovery = typeof renderDiscoveryHome === 'function' ? renderDiscoveryHome : () => {};
  const renderSearch = typeof renderGlobalSearch === 'function' ? renderGlobalSearch : () => {};
  const refreshHistory = typeof loadHistory === 'function' ? loadHistory : async () => null;
  const refreshReminders = typeof loadReminders === 'function' ? loadReminders : async () => null;
  const refreshFavorites = typeof loadFavorites === 'function' ? loadFavorites : async () => null;
  const buildAccessUsage = typeof buildAnalysisAccessUsage === 'function'
    ? buildAnalysisAccessUsage
    : () => null;
  const refreshPass = typeof refreshPassAccess === 'function' ? refreshPassAccess : async () => null;
  const adminCheck = typeof isAdmin === 'function' ? isAdmin : () => false;
  const productAction = typeof sendProductAction === 'function' ? sendProductAction : () => {};
  const timing = typeof sendOperationTiming === 'function' ? sendOperationTiming : () => {};
  const actionError = typeof sendActionError === 'function' ? sendActionError : () => {};
  const errorCategory = typeof apiErrorCategory === 'function' ? apiErrorCategory : () => 'error';
  const showToast = typeof toast === 'function' ? toast : () => {};

  async function loadAnalysisAccessSnapshot(fixtureId) {
    const id = Number(fixtureId || 0);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    try {
      return await api('/api/entitlements?fixtureId=' + encodeURIComponent(String(id)), {
        retry: false,
        timeoutMs: 4000,
      });
    } catch {
      return null;
    }
  }

  function analysisPayload(fixtureId, options = {}) {
    return {
      fixtureId,
      origin: 'miniapp',
      recheck: options.recheck !== false,
      newsImpactDecision: String(options.newsImpactDecision || '').toLowerCase().slice(0, 24),
      newsImpactAction: String(options.newsImpactAction || '').toLowerCase().slice(0, 24),
      newsImpactRecoveryCode: String(options.newsImpactRecoveryCode || '').toLowerCase().slice(0, 24),
      newsImpactRecoveryFrom: String(options.newsImpactRecoveryFrom || '').toLowerCase().slice(0, 24),
    };
  }

  async function analyzeMatch(fixtureId, button, options = {}) {
    if (state.analysisActionPending) {
      showToast('Анализ уже выполняется. Дождитесь завершения текущего запроса.');
      return;
    }

    const sourceView = activeViewId();
    const requestSeq = ++state.analysisRequestSeq;
    if (sourceView !== 'analysisView') state.analysisBackView = sourceView;

    if (!canRun('analysisEnabled')) {
      showToast(state.runtimeStatus?.message || 'Полный анализ временно приостановлен.');
      return;
    }

    stopLive();
    hidePaywall();

    const previousCenter = state.currentCenter;
    state.currentCenter = null;
    state.analysisActionPending = true;
    syncBusy();

    productAction('ai_start', sourceView);
    const timingStartedAt = performanceNow();
    const movedToAnalysis = sourceView !== 'analysisView';

    if (movedToAnalysis) {
      showView('analysisView');
      renderJourney('loading', {
        title: 'Готовим AI-анализ',
        message: 'Собираем данные матча и проверяем основные факторы.',
      });
    }

    const original = button?.textContent || '';
    if (button) button.textContent = '⏳ Собираю данные…';

    try {
      const entitlementBefore = await loadAnalysisAccessSnapshot(fixtureId);
      const data = await api('/api/analyze', {
        method: 'POST',
        body: JSON.stringify(analysisPayload(fixtureId, options)),
      });

      const entitlementAfter = entitlementBefore?.entitlement?.source === 'pass'
        ? await loadAnalysisAccessSnapshot(fixtureId)
        : entitlementBefore;

      data.accessUsage = buildAccessUsage({
        analysis: data,
        entitlementBefore: entitlementBefore || {},
        entitlementAfter: entitlementAfter || entitlementBefore || {},
        profile: state.profile || {},
        fixtureId,
      });

      if (entitlementBefore?.entitlement?.source === 'pass') {
        void Promise.resolve(refreshPass(fixtureId)).catch(() => null);
      }

      if (adminCheck() && data.provider?.visibility === 'admin') {
        state.provider = data.provider;
        renderAdminProvider();
      }

      const ownsAnalysisView = requestSeq === state.analysisRequestSeq
        && activeViewId() === 'analysisView';

      if (ownsAnalysisView) renderResult(data);
      rememberHistory(data);
      productAction('ai_complete', sourceView);
      timing('ai', timingStartedAt, sourceView);

      if (state.profile && data.quota) {
        state.profile.quota = data.quota;
        renderUserProfile();
      }

      if (ownsAnalysisView) showView('analysisView');

      const secondaryTasks = [refreshHistory(false)];
      if (!state.remindersLoaded) secondaryTasks.push(refreshReminders());
      if (!state.favoritesLoaded) secondaryTasks.push(refreshFavorites());
      void Promise.allSettled(secondaryTasks);
    } catch (error) {
      actionError('ai', error, sourceView);
      if (requestSeq !== state.analysisRequestSeq || activeViewId() !== 'analysisView') return;

      const recovery = error?.payload?.newsImpactRecovery || null;
      const providerRateLimit = error?.status === 429
        && String(error?.payload?.code || '').startsWith('FOOTBALL_');
      const quotaExhausted = error?.status === 429 && !providerRateLimit;

      if (quotaExhausted) showPaywall(fixtureId);

      if (recovery?.message) {
        showToast(recovery.message);
        if (recovery.action === 'search') {
          renderDiscovery();
          renderSearch();
          showView('searchView');
        }
      } else if (providerRateLimit) {
        showToast(error?.payload?.retryAfter
          ? `Источник футбольных данных временно на паузе. Повторите через ~${error.payload.retryAfter} сек.`
          : error?.message);
      } else if (quotaExhausted) {
        showToast('AI-разборы на сегодня закончились. Матчи и LIVE остаются доступны.');
      } else {
        showToast(error?.message);
      }

      const category = errorCategory(error);
      if (['rate_limit', 'provider'].includes(category)) {
        if (previousCenter && sourceView === 'analysisView') {
          state.currentCenter = previousCenter;
          renderCenter(previousCenter);
        } else if (sourceView && sourceView !== 'analysisView') {
          showView(sourceView, { restore: true });
        }
      } else if (movedToAnalysis && recovery?.action !== 'search') {
        renderJourney('error', {
          title: 'AI-анализ временно недоступен',
          message: quotaExhausted
            ? 'AI-разборы на сегодня закончились. Матчи, LIVE, составы и статистика остаются доступны бесплатно.'
            : (error?.status === 429
              ? 'Источник футбольных данных временно ограничил обновления.'
              : (error?.message || 'Не удалось подготовить анализ.')),
          retry: () => analyzeMatch(fixtureId, null, options),
        });
      }
    } finally {
      state.analysisActionPending = false;
      syncBusy();
      if (button) button.textContent = original;
    }
  }

  return Object.freeze({
    analyzeMatch,
    loadAnalysisAccessSnapshot,
  });
}
