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

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function renderAdminOverview() {
    if (!isAdmin()) return;

    const runtime = state.runtimeControlsAdmin?.controls || state.runtimeStatus || {};
    const provider = state.provider || {};
    const diagnostics = state.diagnostics || {};
    const database = diagnostics.supabase || {};
    const reminderHealth = state.reminderHealth || {};
    const modelQuality = state.modelQuality || {};
    const sample = modelQuality.sample || {};

    const hasRuntime = Object.keys(runtime).length > 0;
    const enabled = ['analysisEnabled', 'searchEnabled', 'liveEnabled'].filter(key => runtime[key] !== false).length;

    setText('adminOverviewService', !hasRuntime ? 'Проверяется' : runtime.maintenanceMode ? 'Обслуживание' : 'Работает');
    setText('adminOverviewFeatures', hasRuntime
      ? `${enabled}/3 основных функций`
      : 'Проверяем основные функции');

    const providerKnown = provider.plan && provider.plan !== 'UNKNOWN';
    setText('adminOverviewSource', providerKnown
      ? planLabel(provider.plan)
      : state.providerLoaded ? 'Доступен' : 'Проверяется');
    setText('adminOverviewProviderDetail', Number.isFinite(Number(provider.dailyRemaining)) && Number.isFinite(Number(provider.dailyLimit))
      ? `${Number(provider.dailyRemaining)} / ${Number(provider.dailyLimit)} запросов осталось сегодня`
      : providerKnown ? 'Лимиты ещё не получены' : 'Проверяем источник данных');

    if (state.diagnosticsLoading) {
      setText('adminOverviewDatabase', 'Проверяется');
      setText('adminOverviewDatabaseDetail', 'Проверяем Supabase');
    } else if (state.diagnostics) {
      setText('adminOverviewDatabase', database.ok ? (database.recovered ? 'Восстановлено' : 'Норма') : 'Проверить');
      setText('adminOverviewDatabaseDetail', Number.isFinite(Number(database.latencyMs))
        ? `${Number(database.latencyMs)} мс · ${Number(database.attempts || 1)} попыт.`
        : database.ok ? 'Соединение доступно' : 'Диагностика обнаружила проблему');
    } else {
      setText('adminOverviewDatabase', 'Не проверено');
      setText('adminOverviewDatabaseDetail', 'Откройте расширенные инструменты');
    }

    if (runtime.remindersEnabled === false) {
      setText('adminOverviewNotifications', 'Выключены');
      setText('adminOverviewNotificationsDetail', 'Отключены Runtime Control');
    } else if (state.reminderHealthLoading) {
      setText('adminOverviewNotifications', 'Проверяется');
      setText('adminOverviewNotificationsDetail', 'Проверяем доставку');
    } else if (reminderHealth.available) {
      const healthy = reminderHealth.health?.state === 'healthy';
      const summary = reminderHealth.summary || {};
      setText('adminOverviewNotifications', healthy ? 'Норма' : 'Проверить');
      setText('adminOverviewNotificationsDetail',
        `${Number(summary.activeUpcoming || 0)} активных · ${Number(summary.failed24h || 0)} ошибок за 24ч`);
    } else {
      setText('adminOverviewNotifications', hasRuntime ? 'Включены' : 'Не проверено');
      setText('adminOverviewNotificationsDetail', hasRuntime ? 'Доставка разрешена' : 'Проверка ещё не выполнена');
    }

    if (runtime.analysisEnabled === false) {
      setText('adminOverviewAi', 'Выключен');
      setText('adminOverviewAiDetail', 'Отключён Runtime Control');
    } else if (modelQuality.available === false) {
      setText('adminOverviewAi', 'Проверить');
      setText('adminOverviewAiDetail', modelQuality.reason || 'История качества недоступна');
    } else if (Number(sample.settled || 0) > 0) {
      setText('adminOverviewAi', 'Включён');
      setText('adminOverviewAiDetail', `${Number(sample.settled)} прогнозов проверено`);
    } else {
      setText('adminOverviewAi', hasRuntime ? 'Включён' : 'Проверяется');
      setText('adminOverviewAiDetail', 'Качество — в расширенных инструментах');
    }

    setText('adminOverviewVersion', clientVersion);
  }

  return Object.freeze({ renderAdminOverview });
}
