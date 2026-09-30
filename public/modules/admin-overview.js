export function createAdminOverviewModule({
  state,
  elementById,
  isAdmin,
  planLabel,
  clientVersion,
}) {
  if (!state || typeof elementById !== 'function' || typeof isAdmin !== 'function') {
    throw new TypeError('Admin Overview requires state, elementById and isAdmin.');
  }

  const $ = elementById;

  function renderAdminOverview() {
    if (!isAdmin()) return;
    const runtime = state.runtimeControlsAdmin?.controls || state.runtimeStatus || {};
    const provider = state.provider || {};
    const hasRuntime = Object.keys(runtime).length > 0;
    const enabled = ['analysisEnabled', 'searchEnabled', 'liveEnabled'].filter(key => runtime[key] !== false).length;
    if ($('adminOverviewService')) $('adminOverviewService').textContent = !hasRuntime ? 'Проверяется' : runtime.maintenanceMode ? 'Обслуживание' : 'Работает';
    if ($('adminOverviewFeatures')) $('adminOverviewFeatures').textContent = hasRuntime ? enabled + '/3 основных функций' : 'Проверяется';
    if ($('adminOverviewSource')) $('adminOverviewSource').textContent = provider.plan && provider.plan !== 'UNKNOWN'
      ? planLabel(provider.plan) + ' · подключён'
      : state.providerLoaded ? 'Доступен' : 'Проверяется';
    if ($('adminOverviewVersion')) $('adminOverviewVersion').textContent = clientVersion;
  }

  return Object.freeze({ renderAdminOverview });
}
