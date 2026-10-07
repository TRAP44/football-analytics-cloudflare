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

function safeText(value,max=280) {
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

function safeParamEntries(value) {
  const source=plainObject(value);
  if (!source) return [];
  let keys=[];
  try {
    keys=Object.keys(source).slice(0,24);
  } catch {
    return [];
  }
  const rows=[];
  for (const key of keys) {
    if (
      typeof key!=='string'
      || !/^[A-Za-z0-9_-]{1,40}$/.test(key)
      || key==='fixtureId'
    ) continue;
    const item=safeRead(source,key);
    if (typeof item==='string') {
      const text=safeText(item,160);
      if (text) rows.push([key,text]);
    } else if (
      typeof item==='number'
      && Number.isFinite(item)
    ) {
      rows.push([key,String(item)]);
    } else if (typeof item==='boolean') {
      rows.push([key,item ? 'true' : 'false']);
    }
  }
  return rows;
}

function responseFixtureId(value) {
  const data=plainObject(value);
  const match=plainObject(safeRead(data,'match'));
  return positiveId(safeRead(match,'fixtureId'));
}

function matchCenterResponseError(code,message) {
  const error=new Error(message);
  error.code=code;
  return error;
}

function matchCenterResponseMode(value) {
  const data=plainObject(value);
  const mode=safeText(safeRead(data,'mode'),24);
  return ['upcoming','live','finished'].includes(mode)
    ? mode
    : '';
}

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
  if (!state || typeof api!=='function') {
    throw new TypeError(
      'Match Center controller requires state and api.',
    );
  }
  if (
    !documentRef
    || typeof activeViewId!=='function'
    || typeof showView!=='function'
  ) {
    throw new TypeError(
      'Match Center controller requires documentRef, activeViewId and showView.',
    );
  }

  const $=typeof elementById==='function'
    ? elementById
    : ()=>null;
  const canRun=typeof runtimeAllows==='function'
    ? runtimeAllows
    : ()=>false;
  const ensureExtras=typeof ensureMatchCenterExtras==='function'
    ? ensureMatchCenterExtras
    : async()=>null;
  const renderCenter=typeof renderMatchCenter==='function'
    ? renderMatchCenter
    : ()=>{};
  const renderJourney=typeof renderJourneyState==='function'
    ? renderJourneyState
    : ()=>{};
  const productAction=typeof sendProductAction==='function'
    ? sendProductAction
    : ()=>{};
  const coverage=typeof sendMatchDataCoverage==='function'
    ? sendMatchDataCoverage
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
  const friendlyError=typeof friendlyErrorMessage==='function'
    ? friendlyErrorMessage
    : ()=>'Не удалось открыть матч.';
  const showToast=typeof toast==='function'
    ? toast
    : ()=>{};

  const inFlight=new Map();
  let requestSeq=0;
  let liveRefreshTimer=null;
  let liveRefreshWasActive=false;

  function currentView() {
    const value=safeCall(activeViewId);
    return typeof value==='string' && value
      ? value
      : 'matchesView';
  }

  function currentCenterFixtureId() {
    const center=plainObject(safeRead(state,'currentCenter'));
    const match=plainObject(safeRead(center,'match'));
    return positiveId(safeRead(match,'fixtureId'));
  }

  function element(id) {
    return safeCall($,id) || null;
  }

  function buttonText(button) {
    return safeText(safeRead(button,'textContent'),160);
  }

  function setButton(button,{disabled,text}={}) {
    if (!button || typeof button!=='object') return;
    try {
      if (typeof disabled==='boolean') button.disabled=disabled;
      if (typeof text==='string') button.textContent=text;
    } catch {}
  }

  function incrementDeduped() {
    const perf=plainObject(safeRead(state,'clientPerf'));
    if (!perf) return;
    const current=safeRead(perf,'deduped');
    perf.deduped=
      typeof current==='number'
      && Number.isSafeInteger(current)
      && current>=0
        ? current+1
        : 1;
  }

  async function requestMatchCenter(
    fixtureId,
    extraParams={},
    options={},
  ) {
    const id=positiveId(fixtureId);
    if (!id) return null;
    const key=String(id);
    const existing=inFlight.get(key);
    if (existing) {
      incrementDeduped();
      return await existing;
    }

    const seq=++requestSeq;
    const params=new URLSearchParams({fixtureId:key});
    for (const [paramKey,value] of safeParamEntries(extraParams)) {
      params.set(paramKey,value);
    }

    const task=(async()=>{
      try {
        const data=await api(
          `/api/match-center?${params.toString()}`,
          plainObject(options) || {},
        );
        if (seq!==requestSeq) return null;
        if (responseFixtureId(data)!==id) {
          throw matchCenterResponseError(
            'MATCH_CENTER_RESPONSE_IDENTITY_MISMATCH',
            'Ответ центра матча не прошёл проверку выбранного матча.',
          );
        }
        if (!matchCenterResponseMode(data)) {
          throw matchCenterResponseError(
            'MATCH_CENTER_RESPONSE_MODE_INVALID',
            'Ответ центра матча содержит некорректный режим матча.',
          );
        }
        return data;
      } catch (error) {
        if (seq!==requestSeq) return null;
        throw error;
      }
    })();

    inFlight.set(key,task);
    try {
      return await task;
    } finally {
      if (inFlight.get(key)===task) {
        inFlight.delete(key);
      }
    }
  }

  function isActiveLiveFixture(fixtureId) {
    const id=positiveId(fixtureId);
    if (!id) return false;
    return liveRefreshWasActive
      && safeRead(documentRef,'hidden')!==true
      && currentView()==='analysisView'
      && safeRead(
        plainObject(safeRead(state,'currentCenter')),
        'mode',
      )==='live'
      && currentCenterFixtureId()===id;
  }

  function stopLiveRefresh() {
    if (liveRefreshTimer!==null) {
      safeCall(clearTimer,liveRefreshTimer);
    }
    liveRefreshTimer=null;
  }

  function deactivateLiveRefresh() {
    stopLiveRefresh();
    liveRefreshWasActive=false;
  }

  function refreshDelayMs() {
    const center=plainObject(safeRead(state,'currentCenter'));
    const value=safeRead(center,'refreshSeconds');
    const seconds=
      typeof value==='number'
      && Number.isFinite(value)
      && value>=15
      && value<=300
        ? value
        : 60;
    return Math.round(seconds*1000);
  }

  function scheduleLiveRefresh(fixtureId) {
    const id=positiveId(fixtureId);
    if (!id || !isActiveLiveFixture(id)) return false;

    const handle=safeCall(setTimer,async()=>{
      liveRefreshTimer=null;
      if (!isActiveLiveFixture(id)) return;
      try {
        const timingValue=safeCall(performanceNow);
        const timingStartedAt=
          typeof timingValue==='number'
          && Number.isFinite(timingValue)
            ? timingValue
            : Date.now();
        const data=await requestMatchCenter(
          id,
          {t:Date.now()},
        );
        if (!data || !isActiveLiveFixture(id)) return;
        safeCall(timing,'live',timingStartedAt,'analysisView');
        state.currentCenter=data;
        safeCall(renderCenter,data);
        if (safeRead(data,'mode')!=='live') {
          liveRefreshWasActive=false;
        }
      } catch (error) {
        if (!isActiveLiveFixture(id)) return;
        const el=element('liveRefreshText');
        try {
          if (el) {
            el.textContent=
              'Не удалось обновить. Повторим автоматически.';
          }
        } catch {}
        safeCall(actionError,'live_refresh',error,'analysisView');
      } finally {
        if (
          isActiveLiveFixture(id)
          && liveRefreshTimer===null
        ) {
          scheduleLiveRefresh(id);
        }
      }
    },refreshDelayMs());

    if (handle===undefined || handle===null) return false;
    liveRefreshTimer=handle;
    return true;
  }

  function startLiveRefresh(fixtureId) {
    const id=positiveId(fixtureId);
    stopLiveRefresh();

    let enabled=false;
    try {
      enabled=canRun('liveEnabled')===true;
    } catch {
      enabled=false;
    }

    const el=element('liveRefreshText');
    if (!id || !enabled) {
      liveRefreshWasActive=false;
      try {
        if (el) {
          el.textContent=
            'Автообновление матча временно приостановлено.';
        }
      } catch {}
      return;
    }

    liveRefreshWasActive=true;
    try {
      if (el) el.textContent='Обновляется автоматически';
    } catch {}
    if (safeRead(documentRef,'hidden')!==true) {
      scheduleLiveRefresh(id);
    }
  }

  function suspendLiveRefresh() {
    if (liveRefreshTimer===null) return false;
    stopLiveRefresh();
    liveRefreshWasActive=true;
    return true;
  }

  function resumeLiveRefresh() {
    const fixtureId=currentCenterFixtureId();
    const center=plainObject(safeRead(state,'currentCenter'));
    if (
      !fixtureId
      || safeRead(center,'mode')!=='live'
      || currentView()!=='analysisView'
      || !liveRefreshWasActive
    ) return false;
    startLiveRefresh(fixtureId);
    return liveRefreshWasActive;
  }

  async function openMatchCenter(fixtureId,button) {
    const id=positiveId(fixtureId);
    if (!id) {
      safeCall(showToast,'Не удалось определить выбранный матч.');
      return;
    }

    const previousFixtureId=currentCenterFixtureId();
    if (previousFixtureId && previousFixtureId!==id) {
      // A scheduled refresh for the previously open LIVE fixture must not
      // compete with the foreground navigation request for another fixture.
      deactivateLiveRefresh();
    }

    if (safeRead(state,'analysisActionPending')===true) {
      const seq=safeRead(state,'analysisRequestSeq');
      state.analysisRequestSeq=
        Number.isSafeInteger(seq) && seq>=0 ? seq+1 : 1;
    }

    const sourceView=currentView();
    if (sourceView!=='analysisView') {
      state.analysisBackView=sourceView;
    }
    if (previousFixtureId!==id) {
      state.currentCenterTab='summary';
    }

    const original=buttonText(button);
    const timingValue=safeCall(performanceNow);
    const timingStartedAt=
      typeof timingValue==='number' && Number.isFinite(timingValue)
        ? timingValue
        : Date.now();
    const reusableCenter=previousFixtureId===id
      ? safeRead(state,'currentCenter')
      : null;

    setButton(button,{
      disabled:true,
      text:'⏳ Загружаю матч…',
    });
    safeCall(showView,'analysisView');

    if (!reusableCenter) {
      safeCall(renderJourney,'loading',{
        title:'Открываем матч',
        message:
          'Загружаем счёт, события и доступную статистику.',
      });
    }

    try {
      const extrasPromise=Promise.resolve()
        .then(()=>ensureExtras())
        .catch(()=>null);
      const centerLoad=Promise.all([
        requestMatchCenter(id),
        extrasPromise,
      ]).then(([data])=>data);

      await extrasPromise;
      if (reusableCenter) {
        safeCall(renderCenter,reusableCenter);
      }

      const data=await centerLoad;
      if (!data) return;
      state.currentCenter=data;
      safeCall(renderCenter,data);
      safeCall(productAction,'match_open',sourceView);
      safeCall(coverage,data,sourceView);
      safeCall(timing,'match',timingStartedAt,sourceView);
      if (safeRead(data,'mode')==='live') {
        safeCall(productAction,'live_open',sourceView);
        safeCall(timing,'live',timingStartedAt,sourceView);
      }
    } catch (error) {
      safeCall(actionError,'match',error,sourceView);
      const category=safeCall(errorCategory,error);
      const previous=currentCenterFixtureId()===id
        ? safeRead(state,'currentCenter')
        : null;

      if (category==='rate_limit' || category==='provider') {
        if (previous) {
          safeCall(renderCenter,previous);
        } else if (
          sourceView
          && sourceView!=='analysisView'
        ) {
          safeCall(showView,sourceView,{restore:true});
        }
        const friendly=safeCall(friendlyError,error);
        safeCall(
          showToast,
          safeText(friendly,320)
            || 'Матч временно недоступен.',
        );
      } else {
        safeCall(renderJourney,'error',{
          title:'Матч временно не открылся',
          message:
            safeText(safeRead(error,'message'),320)
            || 'Не удалось получить данные матча.',
          retry:()=>openMatchCenter(id,null),
        });
      }
    } finally {
      setButton(button,{
        disabled:false,
        text:original,
      });
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
    isLiveRefreshActive:()=>liveRefreshWasActive,
  });
}
