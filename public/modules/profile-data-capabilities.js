export function createProfileDataCapabilitiesModule({
  state,
  elementById,
}) {
  if (!state || typeof elementById !== 'function') {
    throw new TypeError('Profile Data Capabilities requires state and elementById.');
  }

  const $ = elementById;

  function renderDataCapabilities() {
    const selected=state.dataCapabilities ?? state.profile?.features?.dataCapabilities;
    const c=selected && typeof selected==='object' && !Array.isArray(selected) ? selected : {};
    const features=c.features && typeof c.features==='object' && !Array.isArray(c.features) ? c.features : {};
    const rawRefresh=c.refreshSeconds;
    const numericRefresh=typeof rawRefresh==='number'
      ? rawRefresh
      : typeof rawRefresh==='string' && /^\d+(?:\.\d+)?$/.test(rawRefresh.trim())
        ? Number(rawRefresh.trim()) : NaN;
    const validRefresh=Number.isFinite(numericRefresh) && numericRefresh>=0;
    const refreshSeconds=validRefresh ? numericRefresh : 60;
    const refreshPaused=(features.liveRefresh !== undefined && features.liveRefresh !== true)
      || (validRefresh && refreshSeconds===0);
    if ($('dataModeLabel')) $('dataModeLabel').textContent = c.mode === 'expanded' ? 'Расширенный' : 'Стандартный';
    if ($('dataModeSummary')) $('dataModeSummary').textContent = 'Подробнее';
    if ($('dataModeRefresh')) $('dataModeRefresh').textContent = refreshPaused
      ? 'временно приостановлены'
      : refreshSeconds <= 30 ? 'часто' : 'автоматически';
    if ($('dataModeLineups')) $('dataModeLineups').textContent = features.lineupsFallback === true ? 'Чаще доступны' : 'Если доступны';
    if ($('dataModePlayers')) $('dataModePlayers').textContent = features.playerStats === true ? 'Чаще доступны' : 'Если доступны';
    if ($('dataModeOdds')) $('dataModeOdds').textContent = features.liveOdds === true ? 'Чаще доступны' : 'Если доступны';
    if ($('dataModeNote')) $('dataModeNote').textContent = 'Если каких-то данных нет, MatchRadar не подставляет их искусственно.';
  }

  return Object.freeze({ renderDataCapabilities });
}
