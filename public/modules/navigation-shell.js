export const DEFAULT_BOTTOM_NAV = Object.freeze([
  Object.freeze(['navMatches', 'matchesView']),
  Object.freeze(['navMyTeams', 'myTeamsView']),
  Object.freeze(['navHistory', 'historyView']),
  Object.freeze(['navProfile', 'profileView']),
]);

export function createNavigationShell({
  window,
  document,
  elementById,
  viewIds = [],
  homeView = 'matchesView',
  bottomNav = DEFAULT_BOTTOM_NAV,
  resolveBackTarget,
  syncTopbar,
  syncBackButtons,
  syncTelegramBackButton,
  onLeaveView,
  onEffectError,
} = {}) {
  if (!window || !document || typeof elementById !== 'function') {
    throw new TypeError('Navigation shell requires window, document and elementById.');
  }

  const $ = elementById;
  const views = Array.isArray(viewIds) ? [...new Set(viewIds.map(value => String(value || '')).filter(Boolean))] : [];
  const viewSet = new Set(views);
  const scrollByView = new Map();
  const rawNavBindings = Array.isArray(bottomNav) ? bottomNav : DEFAULT_BOTTOM_NAV;
  const navBindings = rawNavBindings
    .filter(binding => Array.isArray(binding) && binding.length >= 2)
    .map(([navId, viewId]) => [String(navId || ''), String(viewId || '')])
    .filter(([navId, viewId], index, rows) =>
      navId
      && viewSet.has(viewId)
      && rows.findIndex(([candidate]) => candidate === navId) === index
    );

  function reportEffectError(error, context) {
    if (typeof onEffectError === 'function') {
      try {
        onEffectError(error, context);
        return;
      } catch (reportError) {
        console.error('Navigation effect error reporter failed', reportError);
      }
    }
    console.error('Navigation effect failed', context?.effect || 'unknown', error);
  }

  function runEffect(effect, name, context) {
    if (typeof effect !== 'function') return;
    try {
      effect(context);
    } catch (error) {
      reportEffectError(error, { ...context, effect: name });
    }
  }

  function normalizeViewId(id) {
    return viewSet.has(id) && $(id) ? id : homeView;
  }

  function activeViewId() {
    return document.querySelector('.view.active')?.id || homeView;
  }

  function releaseFocusFromHiddenView(current, target) {
    if (!current || current === target) return;
    const currentView = $(current);
    const focused = document.activeElement;
    if (currentView?.contains?.(focused)) focused?.blur?.();
  }

  function updateViewVisibility(target) {
    views.forEach(id => {
      const view = $(id);
      if (!view) return;
      const active = id === target;
      view.classList.toggle('active', active);
      view.hidden = !active;
      view.toggleAttribute('inert', !active);
      view.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
  }

  function updateBottomNavigation(target) {
    for (const [navId] of navBindings) {
      const item = $(navId);
      if (!item) continue;
      item.classList.remove('active');
      item.removeAttribute('aria-current');
    }

    const binding = navBindings.find(([, viewId]) => viewId === target);
    if (!binding) return;
    const item = $(binding[0]);
    if (!item) return;
    item.classList.add('active');
    item.setAttribute('aria-current', 'page');
  }

  function showView(id, options = {}) {
    const target = normalizeViewId(id);
    const current = activeViewId();
    const context = Object.freeze({ from: current, to: target, options });

    if (current && current !== target) {
      scrollByView.set(current, Number(window.scrollY || 0));
    }

    releaseFocusFromHiddenView(current, target);
    updateViewVisibility(target);
    updateBottomNavigation(target);

    runEffect(() => syncTopbar?.(target), 'syncTopbar', context);
    runEffect(() => syncBackButtons?.(), 'syncBackButtons', context);
    runEffect(() => syncTelegramBackButton?.(target), 'syncTelegramBackButton', context);

    if (current && current !== target) {
      runEffect(onLeaveView, 'onLeaveView', context);
    }

    const top = options.restore ? Number(scrollByView.get(target) || 0) : 0;
    const applyScrollAndFocus = () => {
      window.scrollTo({ top, behavior: 'auto' });
      if (options.focusHeading === true) $('topbarTitle')?.focus?.({ preventScroll: true });
    };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(applyScrollAndFocus);
    else applyScrollAndFocus();

    return target;
  }

  function handleBackNavigation() {
    const current = activeViewId();
    if (current === homeView) return false;
    const target = typeof resolveBackTarget === 'function' ? resolveBackTarget(current) : homeView;
    showView(target, { restore: true });
    return true;
  }

  return Object.freeze({
    activeViewId,
    handleBackNavigation,
    showView,
  });
}
