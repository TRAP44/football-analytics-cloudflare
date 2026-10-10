import { FIRST_RUN_GUIDE_KEY } from './app-runtime.js';

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

function safeElement(elementById,id) {
  try {
    return elementById(id) || null;
  } catch {
    return null;
  }
}

function safeCall(fn,...args) {
  try {
    return fn(...args);
  } catch {
    return undefined;
  }
}

function nonEmptyText(value,max=512) {
  if (typeof value!=='string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]+/g,' ')
    .trim()
    .slice(0,max);
}

function positiveFixtureId(value) {
  if (typeof value!=='string') return 0;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return 0;
  const parsed=Number(raw);
  return Number.isSafeInteger(parsed) && parsed>0 ? parsed : 0;
}

function telegramStartParam(tg) {
  const initDataUnsafe=plainObject(safeRead(tg,'initDataUnsafe'));
  return nonEmptyText(safeRead(initDataUnsafe,'start_param'),256);
}

export function createFirstRunGuideController({
  window,
  tg,
  state,
  storage,
  elementById,
  sendProductAction,
  renderGlobalSearch,
  showView,
} = {}) {
  const windowObject=plainObject(window);
  const stateObject=plainObject(state);
  const storageObject=plainObject(storage);
  if (
    !windowObject
    || !stateObject
    || !storageObject
    || typeof safeRead(storageObject,'getItem')!=='function'
    || typeof safeRead(storageObject,'setItem')!=='function'
    || typeof elementById!=='function'
    || typeof sendProductAction!=='function'
    || typeof renderGlobalSearch!=='function'
    || typeof showView!=='function'
  ) {
    throw new TypeError(
      'First Run Guide requires window, state, storage, DOM access and explicit callbacks.',
    );
  }

  let dismissedThisSession=false;

  function hasDirectLaunchIntent() {
    const startParam=telegramStartParam(tg);
    const location=plainObject(safeRead(windowObject,'location'));
    const search=safeRead(location,'search');
    if (typeof search!=='string') return Boolean(startParam);

    try {
      const params=new URLSearchParams(search);
      const view=nonEmptyText(params.get('view'),80).toLowerCase();
      const query=nonEmptyText(params.get('q'),240);
      const fixtureId=positiveFixtureId(params.get('fixtureId'));
      const action=nonEmptyText(params.get('action'),80).toLowerCase();
      return Boolean(
        startParam
        || view==='search'
        || view==='history'
        || query
        || (fixtureId>0 && ['analysis','center'].includes(action))
      );
    } catch {
      return Boolean(startParam);
    }
  }

  function renderFirstRunGuide() {
    const guide=safeElement(elementById,'firstRunGuide');
    if (!guide) return false;

    let dismissed=false;
    try {
      dismissed=storageObject.getItem(FIRST_RUN_GUIDE_KEY)==='1';
    } catch {}

    const favorites=safeRead(stateObject,'favorites');
    const ids=new Set();
    if (Array.isArray(favorites)) {
      for (const row of favorites.slice(0,100)) {
        const raw=safeRead(row,'teamId');
        const id=typeof raw==='number' ? raw : positiveFixtureId(raw);
        if (Number.isSafeInteger(id) && id>0) ids.add(id);
      }
    }
    const count=ids.size;
    const progress=safeElement(elementById,'firstRunGuideProgress');
    const favoriteButton=safeElement(elementById,'firstRunGuideFavorite');
    if (progress) safeCall(()=>{progress.textContent=count
      ? `Выбрано команд: ${count}. Можно добавить ещё или открыть матч.`
      : 'Выберите 1–3 любимые команды. Их матчи появятся в блоке «Для вас».';});
    if (favoriteButton) safeCall(()=>{favoriteButton.textContent=count ? 'Добавить ещё команду' : 'Выбрать команды';});
    const hidden=dismissed || dismissedThisSession || count>=3 || hasDirectLaunchIntent();
    try {
      guide.hidden=hidden;
      return !hidden;
    } catch {
      return false;
    }
  }

  function dismissFirstRunGuide() {
    const guide=safeElement(elementById,'firstRunGuide');
    dismissedThisSession=true;
    try {
      storageObject.setItem(FIRST_RUN_GUIDE_KEY,'1');
    } catch {}
    try {
      if (guide) safeCall(()=>{guide.hidden=true;});
    } catch {}
    return true;
  }

  function focusMatchSearch() {
    const input=safeElement(elementById,'matchSearch');
    if (!input) return;
    const focus=safeRead(input,'focus');
    if (typeof focus==='function') {
      safeCall(focus.bind(input),{preventScroll:true});
    }
    const scrollIntoView=safeRead(input,'scrollIntoView');
    if (typeof scrollIntoView==='function') {
      safeCall(scrollIntoView.bind(input),{
        behavior:'smooth',
        block:'center',
      });
    }
  }

  function startFirstRunSearch() {
    dismissFirstRunGuide();
    safeCall(sendProductAction,'first_run_search','matchesView');
    focusMatchSearch();
    return true;
  }

  function resetGlobalSearchQuery() {
    const globalSearch=plainObject(safeRead(stateObject,'globalSearch'));
    if (globalSearch) {
      try {
        globalSearch.query='';
      } catch {}
    }
    const input=safeElement(elementById,'globalSearchInput');
    if (input) {
      try {
        input.value='';
      } catch {}
    }
  }

  function focusGlobalSearch() {
    const input=safeElement(elementById,'globalSearchInput');
    if (!input) return;
    const focus=safeRead(input,'focus');
    if (typeof focus==='function') {
      safeCall(focus.bind(input),{preventScroll:true});
    }
  }

  function startFirstRunFavorite() {
    const guide=safeElement(elementById,'firstRunGuide');
    if (guide) safeCall(()=>{guide.hidden=true;});
    safeCall(sendProductAction,'first_run_favorite','searchView');
    resetGlobalSearchQuery();
    safeCall(renderGlobalSearch);
    safeCall(showView,'searchView');

    const setTimeoutFn=safeRead(windowObject,'setTimeout');
    if (typeof setTimeoutFn==='function') {
      safeCall(setTimeoutFn.bind(windowObject),focusGlobalSearch,80);
    } else {
      focusGlobalSearch();
    }
    return true;
  }

  return Object.freeze({
    hasDirectLaunchIntent,
    renderFirstRunGuide,
    dismissFirstRunGuide,
    startFirstRunSearch,
    startFirstRunFavorite,
  });
}
