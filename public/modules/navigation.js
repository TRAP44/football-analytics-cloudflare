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
  const candidate = String(target || '');
  if (!PUBLIC_VIEW_IDS.includes(candidate) || candidate === currentView) return CANONICAL_HOME_VIEW;
  return candidate;
}

export function backTargetForView(view, state = {}) {
  if (view === 'analysisView') return normalizeBackTarget(state.analysisBackView, 'analysisView');
  if (view === 'teamView') return normalizeBackTarget(state.teamBackView, 'teamView');
  if (view === 'playerView') return normalizeBackTarget(state.playerBackView, 'playerView');
  if (view === 'tournamentView') return normalizeBackTarget(state.tournamentBackView, 'tournamentView');
  return CANONICAL_HOME_VIEW;
}

export function telegramBackButtonVisible(view) {
  return PUBLIC_VIEW_IDS.includes(view) && view !== CANONICAL_HOME_VIEW;
}
