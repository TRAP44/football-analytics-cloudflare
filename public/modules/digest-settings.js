export const DIGEST_FIXED_HOUR_UTC = 7;

function plainObject(value) {
  return value && typeof value==='object' && !Array.isArray(value) ? value : null;
}

function safeRead(value,key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function safeText(value,max=160) {
  if (typeof value!=='string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]+/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,max);
}

function positiveSafeInteger(value) {
  if (typeof value==='number') {
    return Number.isSafeInteger(value) && value>0 ? value : 0;
  }
  if (typeof value!=='string') return 0;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return 0;
  const parsed=Number(raw);
  return Number.isSafeInteger(parsed) && parsed>0 ? parsed : 0;
}

function digestHour(value) {
  return typeof value==='number'
    && Number.isSafeInteger(value)
    && value>=0
    && value<=23
    ? value
    : DIGEST_FIXED_HOUR_UTC;
}

function errorMessage(error,fallback) {
  return safeText(safeRead(error,'message'),240) || fallback;
}

export function digestLocalDeliveryWindow(
  hourUtc = DIGEST_FIXED_HOUR_UTC,
  date = new Date(),
  timeZone = '',
) {
  const hour=digestHour(hourUtc);
  const anchor=date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  const start=new Date(Date.UTC(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth(),
    anchor.getUTCDate(),
    hour,
    0,
    0,
  ));
  const end=new Date(start.getTime()+55*60*1000);
  const normalizedTimeZone=safeText(timeZone,120);
  const options={
    hour:'2-digit',
    minute:'2-digit',
    ...(normalizedTimeZone ? {timeZone:normalizedTimeZone} : {}),
  };
  try {
    const format=new Intl.DateTimeFormat('ru-RU',options);
    return `${format.format(start)}–${format.format(end)}`;
  } catch {
    // Invalid optional time zones must not silently change local browser time to UTC.
    try {
      const local=new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'});
      return `${local.format(start)}–${local.format(end)}`;
    } catch {
      return `${String(hour).padStart(2,'0')}:00–${String(hour).padStart(2,'0')}:55`;
    }
  }
}

export function normalizeDigestSettingsPayload(payload = {}) {
  const payloadObject=plainObject(payload) || {};
  const nested=plainObject(safeRead(payloadObject,'settings'));
  const raw=nested || payloadObject;
  const delivery=plainObject(safeRead(raw,'delivery')) || {};
  const rawCapabilities=plainObject(safeRead(raw,'capabilities')) || {};

  const requestedPlan=safeText(safeRead(raw,'plan'),16).toUpperCase();
  const plan=['FREE','PRO','PREMIUM'].includes(requestedPlan)
    ? requestedPlan
    : 'FREE';
  const hour=digestHour(safeRead(delivery,'hourUtc'));

  const favoriteTeams=[];
  const seenTeamIds=new Set();
  const rawFavorites=safeRead(raw,'favoriteTeams');
  if (Array.isArray(rawFavorites)) {
    for (const value of rawFavorites.slice(0,24)) {
      const team=plainObject(value);
      if (!team) continue;
      const teamId=positiveSafeInteger(safeRead(team,'teamId'));
      const teamName=safeText(safeRead(team,'teamName'),80);
      if (!teamId || !teamName || seenTeamIds.has(teamId)) continue;
      seenTeamIds.add(teamId);
      favoriteTeams.push({teamId,teamName});
      if (favoriteTeams.length>=6) break;
    }
  }

  const capabilities=Object.freeze({
    baseDigest:safeRead(rawCapabilities,'baseDigest')===true,
    morningNews:safeRead(rawCapabilities,'morningNews')===true,
    favoritePriority:safeRead(rawCapabilities,'favoritePriority')===true,
    customDeliveryTime:safeRead(rawCapabilities,'customDeliveryTime')===true,
    planSpecificContent:safeRead(rawCapabilities,'planSpecificContent')===true,
  });
  const label=safeText(safeRead(delivery,'label'),80)
    || `${String(hour).padStart(2,'0')}:00 UTC`;
  const updatedAt=safeText(safeRead(raw,'updatedAt'),80) || null;

  return Object.freeze({
    enabled:safeRead(raw,'enabled')===true,
    configured:safeRead(raw,'configured')===true,
    plan,
    delivery:Object.freeze({
      hourUtc:hour,
      label,
      timezone:'UTC',
      editable:capabilities.customDeliveryTime===true
        && safeRead(delivery,'editable')===true,
    }),
    capabilities,
    favoriteTeams:Object.freeze(favoriteTeams),
    updatedAt,
  });
}

export function digestDeliverySummary(settings = {}) {
  const normalized=normalizeDigestSettingsPayload(settings);
  return {
    title:normalized.enabled ? 'Подборка включена' : 'Подборка выключена',
    status:normalized.enabled ? 'Включена' : 'Выключена',
    delivery:digestLocalDeliveryWindow(normalized.delivery.hourUtc),
    plan:normalized.plan,
  };
}

export function createDigestSettingsModule({
  elementById,
  api,
  escapeHtml,
  planLabel=value=>String(value || ''),
  toast=()=>{},
}) {
  if (
    typeof elementById!=='function'
    || typeof api!=='function'
    || typeof escapeHtml!=='function'
    || typeof planLabel!=='function'
    || typeof toast!=='function'
  ) {
    throw new TypeError(
      'Digest Settings requires elementById, api, escapeHtml, planLabel and toast functions.',
    );
  }

  const $=elementById;
  const model={
    loaded:false,
    loading:false,
    saving:false,
    error:'',
    settings:null,
    pendingEnabled:null,
  };
  let desiredEnabled=null;
  let mutationPromise=null;
  let loadPromise=null;

  function renderDigestSettings() {
    const root=$('digestSettingsRoot');
    if (!root) return;

    if (model.error && !model.settings) {
      root.innerHTML=`<div class="digest-settings-state is-error" role="status">
        <span>↻</span>
        <div><strong>Подборка временно недоступна</strong><small>${escapeHtml(model.error)}</small></div>
        <button id="digestRetryBtn" class="secondary-btn digest-retry-btn" type="button">Повторить</button>
      </div>`;
      $('digestRetryBtn')?.addEventListener('click',()=>loadDigestSettings(true));
      return;
    }

    if ((!model.loaded || model.loading) && !model.settings) {
      root.innerHTML='<div class="digest-settings-state" role="status"><span>⏳</span><div><strong>Загружаем утреннюю подборку…</strong><small>Загружаем настройки доставки.</small></div></div>';
      return;
    }

    const settings=normalizeDigestSettingsPayload(model.settings || {});
    const checked=model.pendingEnabled===null
      ? settings.enabled
      : model.pendingEnabled===true;
    const summary=digestDeliverySummary({...settings,enabled:checked});
    const localDeliveryWindow=digestLocalDeliveryWindow(settings.delivery.hourUtc);

    root.innerHTML=`
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
        <div><span>Время доставки</span><strong>${escapeHtml(localDeliveryWindow)}</strong><small>По вашему местному времени · ежедневное фиксированное окно</small></div>
        <div><span>Тариф</span><strong>${escapeHtml(planLabel(settings.plan))}</strong><small>${settings.capabilities.planSpecificContent ? 'Расширенная подборка доступна.' : 'Базовая подборка доступна.'}</small></div>
      </div>
      <p class="tiny digest-time-note">Время доставки задаётся автоматически и показано по вашему местному времени.</p>
      ${model.error ? `<p class="digest-inline-error" role="status">${escapeHtml(model.error)}</p>` : ''}
    `;

    $('digestEnabledToggle')?.addEventListener('change',event=>{
      void setDigestEnabled(event.currentTarget.checked===true);
    });
  }

  async function loadDigestSettings(force=false) {
    if (loadPromise) return loadPromise;
    if (model.loaded && force!==true) {
      renderDigestSettings();
      return model.settings;
    }

    model.loading=true;
    model.error='';
    renderDigestSettings();

    const operation=(async()=>{
      try {
        const payload=await api('/api/digest-settings',{retry:true});
        model.settings=normalizeDigestSettingsPayload(payload);
        model.loaded=true;
        return model.settings;
      } catch (error) {
        model.error=errorMessage(
          error,
          'Не удалось загрузить настройки подборки.',
        );
        throw error;
      } finally {
        model.loading=false;
        renderDigestSettings();
      }
    })();

    loadPromise=operation;
    try {
      return await operation;
    } finally {
      if (loadPromise===operation) loadPromise=null;
    }
  }

  async function drainMutations() {
    try {
      while (desiredEnabled!==null) {
        const next=desiredEnabled===true;
        desiredEnabled=null;
        model.saving=true;
        model.error='';
        model.pendingEnabled=next;
        renderDigestSettings();

        try {
          const payload=await api('/api/digest-settings',{
            method:'PUT',
            body:JSON.stringify({enabled:next}),
            retry:false,
            dedupe:false,
          });
          model.settings=normalizeDigestSettingsPayload(payload);
          model.loaded=true;
          try {
            toast(next
              ? 'Утренняя подборка включена.'
              : 'Утренняя подборка отключена.');
          } catch {}
        } catch (error) {
          model.error=errorMessage(
            error,
            'Не удалось сохранить настройку подборки.',
          );
          try { toast(model.error); } catch {}
        } finally {
          model.pendingEnabled=null;
          model.saving=false;
          renderDigestSettings();
        }
      }
      return model.settings;
    } finally {
      mutationPromise=null;
    }
  }

  function setDigestEnabled(enabled) {
    if (typeof enabled!=='boolean') {
      return Promise.reject(
        new TypeError('Digest enabled state must be boolean.'),
      );
    }
    desiredEnabled=enabled;
    if (!mutationPromise) mutationPromise=drainMutations();
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
        loaded:model.loaded,
        loading:model.loading,
        saving:model.saving,
        error:model.error,
        settings:model.settings,
      };
    },
  });
}
