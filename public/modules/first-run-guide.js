import { FIRST_RUN_GUIDE_KEY } from './app-runtime.js';

export function createFirstRunGuideController({
  window,
  tg,
  state,
  storage,
  elementById,
  sendProductAction,
  renderGlobalSearch,
  showView,
}) {
  function hasDirectLaunchIntent() {
    try {
      const params = new URLSearchParams(window.location.search);
      const view = String(params.get('view') || '').toLowerCase();
      const query = String(params.get('q') || '').trim();
      const fixtureId = Number(params.get('fixtureId') || 0);
      const action = String(params.get('action') || '').toLowerCase();
      return Boolean(
        tg?.initDataUnsafe?.start_param
        || view === 'search'
        || view === 'history'
        || query
        || (fixtureId > 0 && ['analysis', 'center'].includes(action))
      );
    } catch {
      return Boolean(tg?.initDataUnsafe?.start_param);
    }
  }

  function renderFirstRunGuide() {
    const guide = elementById('firstRunGuide');
    if (!guide) return;
    let dismissed = false;
    try { dismissed = storage.getItem(FIRST_RUN_GUIDE_KEY) === '1'; } catch {}
    guide.hidden = dismissed || hasDirectLaunchIntent();
  }

  function dismissFirstRunGuide() {
    const guide = elementById('firstRunGuide');
    try { storage.setItem(FIRST_RUN_GUIDE_KEY, '1'); } catch {}
    if (guide) guide.hidden = true;
  }

  function startFirstRunSearch() {
    dismissFirstRunGuide();
    sendProductAction('first_run_search', 'matchesView');
    elementById('matchSearch')?.focus({ preventScroll: true });
    elementById('matchSearch')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function startFirstRunFavorite() {
    dismissFirstRunGuide();
    sendProductAction('first_run_favorite', 'searchView');
    state.globalSearch.query = '';
    if (elementById('globalSearchInput')) elementById('globalSearchInput').value = '';
    renderGlobalSearch();
    showView('searchView');
    window.setTimeout(() => elementById('globalSearchInput')?.focus({ preventScroll: true }), 80);
  }

  return {
    hasDirectLaunchIntent,
    renderFirstRunGuide,
    dismissFirstRunGuide,
    startFirstRunSearch,
    startFirstRunFavorite,
  };
}
