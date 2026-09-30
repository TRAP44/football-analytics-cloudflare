export const DIGEST_FIXED_HOUR_UTC = 7;

export function normalizeDigestSettingsPayload(payload = {}) {
  const raw = payload?.settings || payload || {};
  const plan = ['FREE', 'PRO', 'PREMIUM'].includes(String(raw.plan || '').toUpperCase())
    ? String(raw.plan).toUpperCase()
    : 'FREE';
  const candidateHour = Number(raw?.delivery?.hourUtc);
  const hour = Number.isInteger(candidateHour) && candidateHour >= 0 && candidateHour <= 23
    ? candidateHour
    : DIGEST_FIXED_HOUR_UTC;
  const favoriteTeams = Array.isArray(raw.favoriteTeams)
    ? raw.favoriteTeams
      .map(team => ({
        teamId: Number(team?.teamId || 0),
        teamName: String(team?.teamName || '').trim().slice(0, 80),
      }))
      .filter(team => team.teamId > 0 && team.teamName)
      .slice(0, 6)
    : [];

  const capabilities = Object.freeze({
    baseDigest: raw?.capabilities?.baseDigest !== false,
    morningNews: raw?.capabilities?.morningNews === true,
    favoritePriority: raw?.capabilities?.favoritePriority === true,
    customDeliveryTime: raw?.capabilities?.customDeliveryTime === true,
    planSpecificContent: raw?.capabilities?.planSpecificContent === true,
  });

  return Object.freeze({
    enabled: raw.enabled === true,
    configured: raw.configured === true,
    plan,
    delivery: Object.freeze({
      hourUtc: hour,
      label: String(raw?.delivery?.label || `${String(hour).padStart(2, '0')}:00 UTC`),
      timezone: 'UTC',
      editable: capabilities.customDeliveryTime === true && raw?.delivery?.editable === true,
    }),
    capabilities,
    favoriteTeams: Object.freeze(favoriteTeams),
    updatedAt: raw.updatedAt || null,
  });
}

export function digestDeliverySummary(settings = {}) {
  const normalized = normalizeDigestSettingsPayload(settings);
  return {
    title: normalized.enabled ? 'Подборка включена' : 'Подборка выключена',
    status: normalized.enabled ? 'Включена' : 'Выключена',
    delivery: normalized.delivery.label,
    plan: normalized.plan,
  };
}

export function createDigestSettingsModule({
  elementById,
  api,
  escapeHtml,
  planLabel = value => String(value || ''),
  toast = () => {},
}) {
  if (typeof elementById !== 'function' || typeof api !== 'function' || typeof escapeHtml !== 'function') {
    throw new TypeError('Digest Settings requires elementById, api and escapeHtml.');
  }

  const $ = elementById;
  const model = {
    loaded: false,
    loading: false,
    saving: false,
    error: '',
    settings: null,
    pendingEnabled: null,
  };
  let desiredEnabled = null;
  let mutationPromise = null;

  function renderDigestSettings() {
    const root = $('digestSettingsRoot');
    if (!root) return;

    if (model.error && !model.settings) {
      root.innerHTML = `<div class="digest-settings-state is-error" role="status">
        <span>↻</span>
        <div><strong>Подборка временно недоступна</strong><small>${escapeHtml(model.error)}</small></div>
        <button id="digestRetryBtn" class="secondary-btn digest-retry-btn" type="button">Повторить</button>
      </div>`;
      $('digestRetryBtn')?.addEventListener('click', () => loadDigestSettings(true));
      return;
    }

    if ((!model.loaded || model.loading) && !model.settings) {
      root.innerHTML = '<div class="digest-settings-state" role="status"><span>⏳</span><div><strong>Загружаем утреннюю подборку…</strong><small>Проверяем текущую подписку в Telegram.</small></div></div>';
      return;
    }

    const settings = normalizeDigestSettingsPayload(model.settings || {});
    const checked = model.pendingEnabled === null ? settings.enabled : Boolean(model.pendingEnabled);
    const summary = digestDeliverySummary({ ...settings, enabled: checked });
    const teams = settings.favoriteTeams;
    const favoriteHint = settings.capabilities.favoritePriority
      ? 'Любимые команды получают приоритет в серверной подборке.'
      : 'Любимые команды уже связаны с профилем. Текущий серверный Digest пока отправляет общую подборку без отдельного приоритета по командам.';
    const teamsHtml = teams.length
      ? `<div class="digest-team-chips" aria-label="Любимые команды">${teams.map(team => `<span>${escapeHtml(team.teamName)}</span>`).join('')}</div>
         <small>${escapeHtml(favoriteHint)}</small>`
      : '<small>Добавьте любимые команды в «Мои команды». Текущий серверный Digest пока использует общую подборку.</small>';

    root.innerHTML = `
      <div class="digest-settings-head">
        <div>
          <span class="profile-zone-kicker">TELEGRAM DIGEST</span>
          <h2>☀️ Утренняя подборка</h2>
          <p>До 3 заметных матчей дня и важные футбольные новости — прямо в личный чат MatchRadar.</p>
        </div>
        <span class="digest-status-chip ${checked ? 'is-on' : 'is-off'}">${escapeHtml(summary.status)}</span>
      </div>
      <label class="switch-row digest-main-toggle">
        <span><strong>Получать подборку</strong><small>${model.saving ? 'Сохраняем настройку…' : 'Включить или отключить существующую Telegram-доставку.'}</small></span>
        <input id="digestEnabledToggle" type="checkbox" ${checked ? 'checked' : ''} ${model.saving ? 'disabled' : ''}>
        <i></i>
      </label>
      <div class="digest-settings-grid">
        <div><span>Время доставки</span><strong>${escapeHtml(settings.delivery.label)}</strong><small>Фиксированное окно текущей серверной доставки · 07:00–07:55 UTC</small></div>
        <div><span>Тариф</span><strong>${escapeHtml(planLabel(settings.plan))}</strong><small>${settings.capabilities.planSpecificContent ? 'Расширенное содержание тарифа подключено.' : 'Используется базовое содержание, доступное текущей серверной доставке.'}</small></div>
      </div>
      <div class="digest-favorites">
        <strong>⭐ Любимые команды</strong>
        ${teamsHtml}
      </div>
      <p class="tiny digest-time-note">Местное время доставки пока не настраивается: серверный планировщик работает в UTC. Это ограничение показано явно, чтобы не обещать функцию, которой ещё нет на сервере.</p>
      ${model.error ? `<p class="digest-inline-error" role="status">${escapeHtml(model.error)}</p>` : ''}
    `;

    $('digestEnabledToggle')?.addEventListener('change', event => {
      void setDigestEnabled(Boolean(event.currentTarget.checked));
    });
  }

  async function loadDigestSettings(force = false) {
    if (model.loading) return model.settings;
    if (model.loaded && !force) {
      renderDigestSettings();
      return model.settings;
    }
    model.loading = true;
    model.error = '';
    renderDigestSettings();
    try {
      const payload = await api('/api/digest-settings', { retry: true });
      model.settings = normalizeDigestSettingsPayload(payload);
      model.loaded = true;
      return model.settings;
    } catch (error) {
      model.error = error?.message || 'Не удалось загрузить настройки подборки.';
      throw error;
    } finally {
      model.loading = false;
      renderDigestSettings();
    }
  }

  async function drainMutations() {
    while (desiredEnabled !== null) {
      const next = Boolean(desiredEnabled);
      desiredEnabled = null;
      model.saving = true;
      model.error = '';
      model.pendingEnabled = next;
      renderDigestSettings();
      try {
        const payload = await api('/api/digest-settings', {
          method: 'PUT',
          body: JSON.stringify({ enabled: next }),
          retry: false,
          dedupe: false,
        });
        model.settings = normalizeDigestSettingsPayload(payload);
        model.loaded = true;
        toast(next ? 'Утренняя подборка включена.' : 'Утренняя подборка отключена.');
      } catch (error) {
        model.error = error?.message || 'Не удалось сохранить настройку подборки.';
        desiredEnabled = null;
        toast(model.error);
      } finally {
        model.pendingEnabled = null;
        model.saving = false;
        renderDigestSettings();
      }
    }
    mutationPromise = null;
    return model.settings;
  }

  function setDigestEnabled(enabled) {
    desiredEnabled = Boolean(enabled);
    if (!mutationPromise) mutationPromise = drainMutations();
    return mutationPromise;
  }

  return Object.freeze({
    loadDigestSettings,
    renderDigestSettings,
    setDigestEnabled,
    get loaded() { return model.loaded; },
    get saving() { return model.saving; },
    snapshot() {
      return {
        loaded: model.loaded,
        loading: model.loading,
        saving: model.saving,
        error: model.error,
        settings: model.settings,
      };
    },
  });
}
