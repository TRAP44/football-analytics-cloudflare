function plainObject(value) {
  try {
    return value && typeof value==='object' && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function safeRead(value,key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function safeCall(fn,...args) {
  try {
    return fn(...args);
  } catch {
    return undefined;
  }
}

function safeText(value,max=240) {
  if (typeof value!=='string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]+/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,max);
}

function positiveId(value) {
  if (typeof value==='number') {
    return Number.isSafeInteger(value) && value>0 ? value : 0;
  }
  if (typeof value!=='string') return 0;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return 0;
  const parsed=Number(raw);
  return Number.isSafeInteger(parsed) && parsed>0 ? parsed : 0;
}

function safeShallowCopy(value) {
  const source=plainObject(value);
  if (!source) return {};
  let keys=[];
  try {
    keys=Object.keys(source).slice(0,160);
  } catch {
    return {};
  }
  const out={};
  for (const key of keys) {
    const item=safeRead(source,key);
    if (item!==undefined) out[key]=item;
  }
  return out;
}

function responseFixtureId(value) {
  const data=plainObject(value);
  const match=plainObject(safeRead(data,'match'));
  return positiveId(safeRead(match,'fixtureId'));
}

function analysisResponseError() {
  const error=new Error(
    'Ответ AI-анализа не прошёл проверку выбранного матча.',
  );
  error.code='ANALYSIS_RESPONSE_IDENTITY_MISMATCH';
  return error;
}

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
  if (!state || typeof api !== 'function') {
    throw new TypeError('Analysis controller requires state and api.');
  }
  if (
    typeof activeViewId !== 'function'
    || typeof showView !== 'function'
  ) {
    throw new TypeError(
      'Analysis controller requires activeViewId and showView.',
    );
  }

  const canRun=typeof runtimeAllows==='function'
    ? runtimeAllows
    : ()=>false;
  const stopLive=typeof stopLiveRefresh==='function'
    ? stopLiveRefresh
    : ()=>{};
  const hidePaywall=typeof hideQuotaPaywall==='function'
    ? hideQuotaPaywall
    : ()=>{};
  const showPaywall=typeof showQuotaPaywallForFixture==='function'
    ? showQuotaPaywallForFixture
    : ()=>{};
  const syncBusy=typeof syncAnalysisBusyUi==='function'
    ? syncAnalysisBusyUi
    : ()=>{};
  const renderJourney=typeof renderJourneyState==='function'
    ? renderJourneyState
    : ()=>{};
  const renderResult=typeof renderAnalysis==='function'
    ? renderAnalysis
    : ()=>{};
  const renderCenter=typeof renderMatchCenter==='function'
    ? renderMatchCenter
    : ()=>{};
  const rememberHistory=typeof rememberHistoryAnalysis==='function'
    ? rememberHistoryAnalysis
    : ()=>{};
  const renderUserProfile=typeof renderProfile==='function'
    ? renderProfile
    : ()=>{};
  const renderAdminProvider=typeof renderProvider==='function'
    ? renderProvider
    : ()=>{};
  const renderDiscovery=typeof renderDiscoveryHome==='function'
    ? renderDiscoveryHome
    : ()=>{};
  const renderSearch=typeof renderGlobalSearch==='function'
    ? renderGlobalSearch
    : ()=>{};
  const refreshHistory=typeof loadHistory==='function'
    ? loadHistory
    : async()=>null;
  const refreshReminders=typeof loadReminders==='function'
    ? loadReminders
    : async()=>null;
  const refreshFavorites=typeof loadFavorites==='function'
    ? loadFavorites
    : async()=>null;
  const buildAccessUsage=typeof buildAnalysisAccessUsage==='function'
    ? buildAnalysisAccessUsage
    : ()=>null;
  const refreshPass=typeof refreshPassAccess==='function'
    ? refreshPassAccess
    : async()=>null;
  const adminCheck=typeof isAdmin==='function'
    ? isAdmin
    : ()=>false;
  const productAction=typeof sendProductAction==='function'
    ? sendProductAction
    : ()=>{};
  const timing=typeof sendOperationTiming==='function'
    ? sendOperationTiming
    : ()=>{};
  const actionError=typeof sendActionError==='function'
    ? sendActionError
    : ()=>{};
  const errorCategory=typeof apiErrorCategory==='function'
    ? apiErrorCategory
    : ()=>'error';
  const showToast=typeof toast==='function'
    ? toast
    : ()=>{};

  let operationSeq=0;

  function currentView() {
    const value=safeCall(activeViewId);
    return typeof value==='string' && value
      ? value
      : 'matchesView';
  }

  function toastSafe(message,fallback='') {
    const text=safeText(message,320) || fallback;
    if (text) safeCall(showToast,text);
  }

  function setButtonState(button,{disabled,text}={}) {
    if (!button || typeof button!=='object') return;
    try {
      if (typeof disabled==='boolean') button.disabled=disabled;
      if (typeof text==='string') button.textContent=text;
    } catch {}
  }

  async function loadAnalysisAccessSnapshot(fixtureId) {
    const id=positiveId(fixtureId);
    if (!id) return null;
    try {
      const value=await api(
        '/api/entitlements?fixtureId='
          +encodeURIComponent(String(id)),
        {
          retry:false,
          timeoutMs:4000,
        },
      );
      return plainObject(value);
    } catch {
      return null;
    }
  }

  function analysisPayload(fixtureId,options={}) {
    const source=plainObject(options) || {};
    return {
      fixtureId,
      origin:'miniapp',
      recheck:safeRead(source,'recheck')!==false,
      newsImpactDecision:safeText(
        safeRead(source,'newsImpactDecision'),
        24,
      ).toLowerCase(),
      newsImpactAction:safeText(
        safeRead(source,'newsImpactAction'),
        24,
      ).toLowerCase(),
      newsImpactRecoveryCode:safeText(
        safeRead(source,'newsImpactRecoveryCode'),
        24,
      ).toLowerCase(),
      newsImpactRecoveryFrom:safeText(
        safeRead(source,'newsImpactRecoveryFrom'),
        24,
      ).toLowerCase(),
    };
  }

  async function analyzeMatch(fixtureId,button,options={}) {
    if (safeRead(state,'analysisActionPending')===true) {
      toastSafe(
        'Анализ уже выполняется. Дождитесь завершения текущего запроса.',
      );
      return;
    }

    const id=positiveId(fixtureId);
    if (!id) {
      toastSafe('Не удалось определить матч для AI-разбора.');
      return;
    }

    let analysisEnabled=false;
    try {
      analysisEnabled=canRun('analysisEnabled')===true;
    } catch {
      analysisEnabled=false;
    }
    if (!analysisEnabled) {
      const runtimeStatus=plainObject(safeRead(state,'runtimeStatus'));
      toastSafe(
        safeRead(runtimeStatus,'message'),
        'Полный анализ временно приостановлен.',
      );
      return;
    }

    const sourceView=currentView();
    const currentSeq=Number.isSafeInteger(
      safeRead(state,'analysisRequestSeq'),
    )
      ? safeRead(state,'analysisRequestSeq')
      : 0;
    const requestSeq=currentSeq+1;
    state.analysisRequestSeq=requestSeq;
    if (sourceView!=='analysisView') {
      state.analysisBackView=sourceView;
    }

    const previousCenter=safeRead(state,'currentCenter');
    const operation=++operationSeq;
    state.currentCenter=null;
    state.analysisActionPending=true;
    safeCall(syncBusy);

    const original=safeText(safeRead(button,'textContent'),160);
    const timingValue=safeCall(performanceNow);
    const timingStartedAt=
      typeof timingValue==='number' && Number.isFinite(timingValue)
        ? timingValue
        : Date.now();
    const movedToAnalysis=sourceView!=='analysisView';

    try {
      safeCall(stopLive);
      safeCall(hidePaywall);
      safeCall(productAction,'ai_start',sourceView);

      if (movedToAnalysis) {
        safeCall(showView,'analysisView');
        safeCall(renderJourney,'loading',{
          title:'Готовим AI-анализ',
          message:
            'Собираем данные матча и проверяем основные факторы.',
        });
      }
      setButtonState(button,{text:'⏳ Собираю данные…'});

      const entitlementBefore=
        await loadAnalysisAccessSnapshot(id);
      const rawData=await api('/api/analyze',{
        method:'POST',
        body:JSON.stringify(analysisPayload(id,options)),
      });
      const payloadId=responseFixtureId(rawData);
      if (!payloadId || payloadId!==id) {
        throw analysisResponseError();
      }
      const data=safeShallowCopy(rawData);

      const beforeEntitlement=plainObject(
        safeRead(entitlementBefore,'entitlement'),
      );
      const entitlementAfter=
        safeRead(beforeEntitlement,'source')==='pass'
          ? await loadAnalysisAccessSnapshot(id)
          : entitlementBefore;

      const accessUsage=safeCall(buildAccessUsage,{
        analysis:data,
        entitlementBefore:entitlementBefore || {},
        entitlementAfter:
          entitlementAfter || entitlementBefore || {},
        profile:plainObject(safeRead(state,'profile')) || {},
        fixtureId:id,
      });
      data.accessUsage=accessUsage ?? null;

      if (safeRead(beforeEntitlement,'source')==='pass') {
        void Promise.resolve()
          .then(()=>refreshPass(id))
          .catch(()=>null);
      }

      const provider=plainObject(safeRead(data,'provider'));
      if (
        safeCall(adminCheck)===true
        && provider
        && safeRead(provider,'visibility')==='admin'
      ) {
        state.provider=safeShallowCopy(provider);
        safeCall(renderAdminProvider);
      }

      const ownsAnalysisView=
        requestSeq===safeRead(state,'analysisRequestSeq')
        && currentView()==='analysisView';

      if (ownsAnalysisView) safeCall(renderResult,data);
      safeCall(rememberHistory,data);
      safeCall(productAction,'ai_complete',sourceView);
      safeCall(timing,'ai',timingStartedAt,sourceView);

      const profile=plainObject(safeRead(state,'profile'));
      const quota=plainObject(safeRead(data,'quota'));
      if (profile && quota) {
        state.profile={
          ...safeShallowCopy(profile),
          quota:safeShallowCopy(quota),
        };
        safeCall(renderUserProfile);
      }

      if (ownsAnalysisView) {
        safeCall(showView,'analysisView');
      }

      const secondaryTasks=[
        Promise.resolve()
          .then(()=>refreshHistory(false)),
      ];
      if (safeRead(state,'remindersLoaded')!==true) {
        secondaryTasks.push(
          Promise.resolve().then(()=>refreshReminders()),
        );
      }
      if (safeRead(state,'favoritesLoaded')!==true) {
        secondaryTasks.push(
          Promise.resolve().then(()=>refreshFavorites()),
        );
      }
      void Promise.allSettled(secondaryTasks);
    } catch (error) {
      safeCall(actionError,'ai',error,sourceView);
      if (
        requestSeq!==safeRead(state,'analysisRequestSeq')
        || currentView()!=='analysisView'
      ) return;

      const errorPayload=plainObject(safeRead(error,'payload'));
      const recovery=plainObject(
        safeRead(errorPayload,'newsImpactRecovery'),
      );
      const errorCode=safeText(
        safeRead(errorPayload,'code'),
        80,
      ).toUpperCase();
      const status=safeRead(error,'status');
      const providerRateLimit=status===429
        && errorCode.startsWith('FOOTBALL_');
      const analysisWarming=status===429
        && errorCode==='ANALYSIS_WARMING';
      const quota=plainObject(safeRead(errorPayload,'quota'));
      const quotaLeft=safeRead(quota,'left');
      const legacyQuotaExhausted=status===429
        && !errorCode
        && typeof quotaLeft==='number'
        && Number.isFinite(quotaLeft)
        && quotaLeft<=0;
      const quotaExhausted=status===429
        && !providerRateLimit
        && !analysisWarming
        && (
          errorCode==='ANALYSIS_QUOTA_EXHAUSTED'
          || legacyQuotaExhausted
        );

      if (quotaExhausted) safeCall(showPaywall,id);

      const recoveryMessage=safeText(
        safeRead(recovery,'message'),
        320,
      );
      const recoveryAction=safeText(
        safeRead(recovery,'action'),
        40,
      );
      if (recoveryMessage) {
        toastSafe(recoveryMessage);
        if (recoveryAction==='search') {
          safeCall(renderDiscovery);
          safeCall(renderSearch);
          safeCall(showView,'searchView');
        }
      } else if (providerRateLimit) {
        const retryAfter=safeRead(errorPayload,'retryAfter');
        toastSafe(
          typeof retryAfter==='number'
            && Number.isFinite(retryAfter)
            && retryAfter>0
            ? `Источник футбольных данных временно на паузе. Повторите через ~${Math.ceil(retryAfter)} сек.`
            : safeRead(error,'message'),
          'Источник футбольных данных временно на паузе.',
        );
      } else if (quotaExhausted) {
        toastSafe(
          'AI-разборы на сегодня закончились. Матчи и LIVE остаются доступны.',
        );
      } else {
        toastSafe(
          safeRead(error,'message'),
          'Не удалось подготовить анализ.',
        );
      }

      const category=safeCall(errorCategory,error);
      if (
        category==='rate_limit'
        || category==='provider'
      ) {
        if (previousCenter && sourceView==='analysisView') {
          state.currentCenter=previousCenter;
          safeCall(renderCenter,previousCenter);
        } else if (
          sourceView
          && sourceView!=='analysisView'
        ) {
          safeCall(showView,sourceView,{restore:true});
        }
      } else if (
        movedToAnalysis
        && recoveryAction!=='search'
      ) {
        safeCall(renderJourney,'error',{
          title:'AI-анализ временно недоступен',
          message:quotaExhausted
            ? 'AI-разборы на сегодня закончились. Матчи, LIVE, составы и статистика остаются доступны бесплатно.'
            : status===429
              ? 'Источник футбольных данных временно ограничил обновления.'
              : safeText(
                  safeRead(error,'message'),
                  320,
                )
                || 'Не удалось подготовить анализ.',
          retry:()=>analyzeMatch(id,null,options),
        });
      }
    } finally {
      if (operation===operationSeq) {
        state.analysisActionPending=false;
        safeCall(syncBusy);
      }
      setButtonState(button,{disabled:false,text:original});
    }
  }

  return Object.freeze({
    analyzeMatch,
    loadAnalysisAccessSnapshot,
  });
}
