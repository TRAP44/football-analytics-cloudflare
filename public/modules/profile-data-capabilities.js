// @ts-check

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
    if ($('dataModeLabel')) $('dataModeLabel').textContent = c.mode === 'expanded' ? 'Расширенный' : 'Стандартный';
    if ($('dataModeSummary')) $('dataModeSummary').textContent = 'Подробнее';
    if ($('dataModeRefresh')) $('dataModeRefresh').textContent = features.liveRefresh === false || Number(c.refreshSeconds) === 0
      ? 'временно приостановлены'
      : Number(c.refreshSeconds || 60) <= 30 ? 'часто' : 'автоматически';
    if ($('dataModeLineups')) $('dataModeLineups').textContent = features.lineupsFallback ? 'Чаще доступны' : 'Если доступны';
    if ($('dataModePlayers')) $('dataModePlayers').textContent = features.playerStats ? 'Чаще доступны' : 'Если доступны';
    if ($('dataModeOdds')) $('dataModeOdds').textContent = features.liveOdds ? 'Чаще доступны' : 'Если доступны';
    if ($('dataModeNote')) $('dataModeNote').textContent = 'Если каких-то данных нет, MatchRadar не подставляет их искусственно.';
  }

  return Object.freeze({ renderDataCapabilities });
}
