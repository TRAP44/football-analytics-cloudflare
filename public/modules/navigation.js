export const CANONICAL_HOME_VIEW = 'matchesView';

export const PUBLIC_VIEW_IDS = Object.freeze([
  'matchesView',
  'searchView',
  'myTeamsView',
  'tournamentView',
  'teamView',
  'playerView',
  'analysisView',
  'historyView',
  'profileView',
]);

export function normalizeBackTarget(target, currentView = '') {
  const candidate = typeof target === 'string' ? target : '';
  const current = typeof currentView === 'string' ? currentView : '';
  if (!PUBLIC_VIEW_IDS.includes(candidate) || candidate === current) return CANONICAL_HOME_VIEW;
  return candidate;
}

export function backTargetForView(view, state = {}) {
  const source=state && typeof state === 'object' && !Array.isArray(state)
    ? state
    : {};
  if (view === 'analysisView') return normalizeBackTarget(source.analysisBackView, 'analysisView');
  if (view === 'teamView') return normalizeBackTarget(source.teamBackView, 'teamView');
  if (view === 'playerView') return normalizeBackTarget(source.playerBackView, 'playerView');
  if (view === 'tournamentView') return normalizeBackTarget(source.tournamentBackView, 'tournamentView');
  return CANONICAL_HOME_VIEW;
}

export function telegramBackButtonVisible(view) {
  return PUBLIC_VIEW_IDS.includes(view) && view !== CANONICAL_HOME_VIEW;
}
