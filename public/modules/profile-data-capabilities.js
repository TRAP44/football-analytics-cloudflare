export function createProfileDataCapabilitiesModule({
  state,
  elementById,
}) {
  if (!state || typeof elementById !== 'function') {
    throw new TypeError('Profile Data Capabilities requires state and elementById.');
  }

  const $ = elementById;

  function renderDataCapabilities() {
    const c = state.dataCapabilities || state.profile?.features?.dataCapabilities || {};
    const features = c.features || {};
    if ($('dataModeLabel')) $('dataModeLabel').textContent = c.mode === 'expanded' ? 'Больше данных' : 'Обычное';
    if ($('dataModeSummary')) $('dataModeSummary').textContent = c.mode === 'expanded' ? 'Больше данных' : 'Обычное';
    if ($('dataModeRefresh')) $('dataModeRefresh').textContent = features.liveRefresh === false || Number(c.refreshSeconds) === 0
      ? 'временно приостановлены'
      : Number(c.refreshSeconds || 60) <= 30 ? 'частые' : 'автоматические';
    if ($('dataModeLineups')) $('dataModeLineups').textContent = features.lineupsFallback ? 'Чаще доступны' : 'По наличию';
    if ($('dataModePlayers')) $('dataModePlayers').textContent = features.playerStats ? 'Чаще доступны' : 'По наличию';
    if ($('dataModeOdds')) $('dataModeOdds').textContent = features.liveOdds ? 'Чаще доступны' : 'По наличию';
    if ($('dataModeNote')) $('dataModeNote').textContent = 'Доступность зависит от турнира и конкретного матча.';
  }

  return Object.freeze({ renderDataCapabilities });
}
