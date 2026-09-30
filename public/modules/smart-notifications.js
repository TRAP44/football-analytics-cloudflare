const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  enabled: true,
  match: true,
  teams: true,
  players: true,
  aiRadar: true,
});

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeSmartNotificationPayload(payload = {}) {
  const rawPreferences = payload?.preferences?.notificationPreferences
    ?? payload?.preferences?.notification_preferences
    ?? payload?.notificationPreferences
    ?? {};
  const rawCapabilities = payload?.notificationCapabilities || {};
  const categories = rawCapabilities.categories || {};
  const preferences = Object.freeze({
    enabled: bool(rawPreferences.enabled, DEFAULT_NOTIFICATION_PREFERENCES.enabled),
    match: bool(rawPreferences.match, DEFAULT_NOTIFICATION_PREFERENCES.match),
    teams: bool(rawPreferences.teams, DEFAULT_NOTIFICATION_PREFERENCES.teams),
    players: bool(rawPreferences.players, DEFAULT_NOTIFICATION_PREFERENCES.players),
    aiRadar: bool(rawPreferences.aiRadar ?? rawPreferences.ai_radar, DEFAULT_NOTIFICATION_PREFERENCES.aiRadar),
  });
  const capability = key => Object.freeze({
    available: categories?.[key]?.available === true,
    requiredPlan: String(categories?.[key]?.requiredPlan || (key === 'match' || key === 'teams' ? 'FREE' : 'PRO')),
  });
  return Object.freeze({
    preferences,
    capabilities: Object.freeze({
      plan: String(rawCapabilities.plan || 'FREE').toUpperCase(),
      smartAlerts: rawCapabilities.smartAlerts === true,
      categories: Object.freeze({
        match: capability('match'),
        teams: capability('teams'),
        players: capability('players'),
        aiRadar: capability('aiRadar'),
      }),
      thresholds: Object.freeze({
        marketPp: Number(rawCapabilities?.thresholds?.marketPp || 0),
        aiProbabilityPp: Number(rawCapabilities?.thresholds?.aiProbabilityPp || 0),
        aiCooldownMinutes: Number(rawCapabilities?.thresholds?.aiCooldownMinutes || 0),
        radarConfidence: Number(rawCapabilities?.thresholds?.radarConfidence || 0),
        radarOutcomeProbability: Number(rawCapabilities?.thresholds?.radarOutcomeProbability || 0),
        radarCooldownMinutes: Number(rawCapabilities?.thresholds?.radarCooldownMinutes || 0),
      }),
    }),
  });
}

export function createSmartNotificationsModule({
  elementById,
  api,
  escapeHtml,
  toast = () => {},
} = {}) {
  if (typeof elementById !== 'function' || typeof api !== 'function' || typeof escapeHtml !== 'function') {
    throw new TypeError('Smart Notifications requires elementById, api and escapeHtml.');
  }
  const $ = elementById;
  const model = {
    loaded: false,
    loading: false,
    saving: false,
    error: '',
    payload: normalizeSmartNotificationPayload(),
    desired: null,
  };
  let mutationPromise = null;

  const rows = [
    ['match', 'Матчи', 'Старт, составы, голы и красные карточки для отслеживаемых матчей.'],
    ['teams', 'Мои команды', 'Категория для уведомлений, связанных с любимыми командами.'],
    ['players', 'Мои игроки', 'Стартовый состав и события игроков из Favorite Players.'],
    ['aiRadar', 'AI / Radar', 'Сильные изменения вероятностей и движения рынка без мелкого шума.'],
  ];

  function render() {
    const root = $('smartNotificationsRoot');
    if (!root) return;
    if (model.loading && !model.loaded) {
      root.innerHTML = '<div class="smart-notification-state" role="status">⏳ <span>Загружаем настройки уведомлений…</span></div>';
      return;
    }
    if (model.error && !model.loaded) {
      root.innerHTML = `<div class="smart-notification-state is-error" role="status"><span>↻</span><div><strong>Уведомления временно недоступны</strong><small>${escapeHtml(model.error)}</small></div><button id="smartNotificationsRetryBtn" class="secondary-btn" type="button">Повторить</button></div>`;
      $('smartNotificationsRetryBtn')?.addEventListener('click', () => void load(true));
      return;
    }

    const normalized = normalizeSmartNotificationPayload(model.payload);
    const preferences = model.desired || normalized.preferences;
    const caps = normalized.capabilities;
    const paidLabel = caps.smartAlerts ? 'Smart Alerts доступны' : 'Smart Alerts · PRO';
    root.innerHTML = `
      <div class="smart-notification-head">
        <div>
          <span class="profile-zone-kicker">SMART ALERTS</span>
          <h2>🔔 Уведомления</h2>
          <p>Только важные изменения. Дубли, мелкие колебания и частые повторения подавляются на сервере.</p>
        </div>
        <span class="smart-notification-plan ${caps.smartAlerts ? 'is-on' : ''}">${escapeHtml(paidLabel)}</span>
      </div>
      <label class="switch-row smart-notification-master">
        <span><strong>Получать уведомления</strong><small>${model.saving ? 'Сохраняем…' : 'Главный выключатель для уведомлений MatchRadar.'}</small></span>
        <input id="smartNotificationMaster" type="checkbox" ${preferences.enabled ? 'checked' : ''} ${model.saving ? 'disabled' : ''}>
        <i></i>
      </label>
      <details class="smart-notification-details">
        <summary><span><strong>Что присылать</strong><small>Тонкая настройка по категориям</small></span><b>Настроить</b></summary>
        <div class="smart-notification-options">
          ${rows.map(([key, title, description]) => {
            const cap = caps.categories[key];
            const locked = !cap.available;
            return `<label class="switch-row smart-notification-option ${locked ? 'is-locked' : ''}">
              <span><strong>${escapeHtml(title)} ${locked ? `<em>${escapeHtml(cap.requiredPlan)}</em>` : ''}</strong><small>${escapeHtml(description)}</small></span>
              <input data-smart-notification-key="${escapeHtml(key)}" type="checkbox" ${preferences[key] ? 'checked' : ''} ${model.saving || locked ? 'disabled' : ''}>
              <i></i>
            </label>`;
          }).join('')}
        </div>
      </details>
      <p class="tiny smart-notification-note">
        Порог рынка: ${caps.thresholds.marketPp || '—'} п.п. · AI: ${caps.thresholds.aiProbabilityPp || '—'} п.п.${caps.thresholds.aiCooldownMinutes ? ` · cooldown ${caps.thresholds.aiCooldownMinutes} мин` : ''}.
        ${caps.thresholds.radarConfidence ? `Radar: confidence ≥ ${caps.thresholds.radarConfidence}/100 и лидер ≥ ${caps.thresholds.radarOutcomeProbability}%${caps.thresholds.radarCooldownMinutes ? ` · cooldown ${caps.thresholds.radarCooldownMinutes} мин` : ''}.` : ''}
        Тариф проверяется сервером при каждой доставке.
      </p>
      ${model.error ? `<p class="digest-inline-error" role="status">${escapeHtml(model.error)}</p>` : ''}
    `;

    $('smartNotificationMaster')?.addEventListener('change', event => {
      void updatePreference('enabled', Boolean(event.currentTarget.checked));
    });
    root.querySelectorAll?.('[data-smart-notification-key]').forEach(input => {
      input.addEventListener('change', event => {
        void updatePreference(String(event.currentTarget.dataset.smartNotificationKey || ''), Boolean(event.currentTarget.checked));
      });
    });
  }

  async function load(force = false) {
    if (model.loading) return model.payload;
    if (model.loaded && !force) {
      render();
      return model.payload;
    }
    model.loading = true;
    model.error = '';
    render();
    try {
      model.payload = normalizeSmartNotificationPayload(await api('/api/preferences', { retry: true }));
      model.loaded = true;
      return model.payload;
    } catch (error) {
      model.error = error?.message || 'Не удалось загрузить настройки уведомлений.';
      throw error;
    } finally {
      model.loading = false;
      render();
    }
  }

  async function drain() {
    while (model.desired) {
      const next = model.desired;
      model.desired = null;
      model.saving = true;
      model.error = '';
      render();
      try {
        const response = await api('/api/preferences', {
          method: 'PUT',
          body: JSON.stringify({ notificationPreferences: next }),
          retry: false,
          dedupe: false,
        });
        model.payload = normalizeSmartNotificationPayload(response);
        model.loaded = true;
        toast('Настройки уведомлений сохранены.');
      } catch (error) {
        model.error = error?.message || 'Не удалось сохранить настройки уведомлений.';
        model.desired = null;
        toast(model.error);
      } finally {
        model.saving = false;
        render();
      }
    }
    mutationPromise = null;
    return model.payload;
  }

  function updatePreference(key, enabled) {
    if (!Object.hasOwn(DEFAULT_NOTIFICATION_PREFERENCES, key)) return Promise.resolve(model.payload);
    const current = model.desired || normalizeSmartNotificationPayload(model.payload).preferences;
    model.desired = { ...current, [key]: Boolean(enabled) };
    if (!mutationPromise) mutationPromise = drain();
    return mutationPromise;
  }

  return Object.freeze({
    load,
    render,
    updatePreference,
    snapshot() {
      return {
        loaded: model.loaded,
        loading: model.loading,
        saving: model.saving,
        error: model.error,
        payload: model.payload,
      };
    },
  });
}
