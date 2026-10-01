export function mountAdminBillingRefundPanel(doc = document) {
  if (!doc || doc.getElementById('adminBillingRefundPanel')) return doc?.getElementById?.('adminBillingRefundPanel') || null;
  const billing = doc.getElementById('billingPanel');
  if (!billing) return null;

  const section = doc.createElement('section');
  section.id = 'adminBillingRefundPanel';
  section.className = 'panel admin-billing-refund-panel';
  section.hidden = false;
  section.setAttribute('aria-hidden', 'false');
  section.innerHTML = `
    <div class="section-head profile-section-head">
      <div>
        <h2>💫 Возврат Telegram Stars</h2>
        <p>Ручной возврат только через Telegram API. База обновляется сервером после успешного refund.</p>
      </div>
    </div>
    <div class="admin-billing-refund-grid">
      <label class="setting-field">
        <span>Telegram ID пользователя</span>
        <input id="billingRefundUserId" inputmode="numeric" autocomplete="off" placeholder="Например: 123456789">
      </label>
      <button id="billingRefundLookupBtn" class="secondary-btn" type="button">Найти платежи</button>
    </div>
    <div id="billingRefundStatus" class="tiny" role="status" aria-live="polite">Укажите Telegram ID и загрузите доступные для возврата платежи.</div>
    <div id="billingRefundResults" class="admin-billing-refund-results"></div>
    <label class="runtime-message-field">
      <span>Причина возврата</span>
      <input id="billingRefundReason" maxlength="240" autocomplete="off" placeholder="Например: E2E тест финального monetization gate">
    </label>
    <label class="switch-row admin-billing-refund-confirm">
      <span><strong>Подтверждаю ручной возврат</strong><small>Stars будут возвращены через Telegram, а доступ будет отозван сервером.</small></span>
      <input id="billingRefundConfirm" type="checkbox"><i></i>
    </label>
    <p class="tiny quality-method-note">Повторный возврат одного charge блокируется сервером. Полный charge ID в интерфейсе не показывается.</p>
  `;
  billing.insertAdjacentElement('afterend', section);
  return section;
}

export function createAdminBillingRefundModule({
  state,
  elementById,
  api,
  escapeHtml,
  toast = () => {},
  isAdmin = () => false,
  confirmAction = () => false,
  reloadProfile = async () => {},
} = {}) {
  if (!state || typeof elementById !== 'function' || typeof api !== 'function' || typeof escapeHtml !== 'function') {
    throw new TypeError('Admin billing refund requires state, elementById, api and escapeHtml.');
  }
  const $ = elementById;
  let loaded = false;
  let loading = false;
  let refunding = false;
  let targetUserId = 0;
  let items = [];
  let error = '';
  let bound = false;

  function currentAdminId() {
    const id = Number(state.profile?.user?.id || 0);
    return Number.isSafeInteger(id) && id > 0 ? id : 0;
  }

  function productLabel(item = {}) {
    const key = String(item.product || '').toUpperCase();
    if (key === 'MATCH_PASS') return 'Доступ на один матч';
    if (key === 'DAY_PASS') return 'Доступ на сутки';
    if (key === 'WEEKEND_PASS') return 'Доступ на выходные';
    return key || 'Платёж';
  }

  function render() {
    const root = $('adminBillingRefundPanel');
    if (!root || !isAdmin()) return;
    const input = $('billingRefundUserId');
    if (input && !String(input.value || '').trim() && currentAdminId()) input.value = String(currentAdminId());

    const status = $('billingRefundStatus');
    if (status) {
      status.textContent = loading
        ? 'Загружаем доступные платежи…'
        : refunding
          ? 'Выполняем возврат через Telegram…'
          : error
            ? error
            : loaded
              ? (items.length ? 'Выберите платёж для возврата.' : 'Активных платежей, доступных для возврата, не найдено.')
              : 'Укажите Telegram ID и загрузите доступные для возврата платежи.';
    }

    const results = $('billingRefundResults');
    if (results) {
      results.innerHTML = items.map((item, index) => {
        const stars = Number(item.stars || 0);
        const fixture = item.fixtureId ? ' · матч #' + Number(item.fixtureId) : '';
        const expires = item.expiresAt ? ' · до ' + new Date(item.expiresAt).toLocaleString('ru-RU') : '';
        return `<article class="admin-billing-refund-item">
          <div>
            <strong>${escapeHtml(productLabel(item))}</strong>
            <span>${stars ? escapeHtml(String(stars) + ' ⭐') : 'Stars'}${escapeHtml(fixture)}${escapeHtml(expires)}</span>
            <small>charge …${escapeHtml(String(item.chargeSuffix || ''))}</small>
          </div>
          <button type="button" class="reminder-btn danger" data-billing-refund-index="${index}" ${refunding ? 'disabled' : ''}>Вернуть Stars</button>
        </article>`;
      }).join('');
    }

    const lookup = $('billingRefundLookupBtn');
    if (lookup) {
      lookup.disabled = loading || refunding;
      lookup.textContent = loading ? 'Загружаю…' : 'Найти платежи';
    }
  }

  async function load(force = false) {
    if (!isAdmin() || loading) return { items };
    const raw = String($('billingRefundUserId')?.value || currentAdminId() || '').trim();
    const uid = Number(raw);
    if (!Number.isSafeInteger(uid) || uid <= 0) {
      error = 'Укажите корректный Telegram ID.';
      loaded = false;
      render();
      return { items: [] };
    }
    if (loaded && !force && uid === targetUserId) {
      render();
      return { items };
    }
    targetUserId = uid;
    loading = true;
    error = '';
    render();
    try {
      const data = await api('/api/admin/billing/refundable?telegramId=' + encodeURIComponent(String(uid)), { retry:false });
      items = Array.isArray(data?.items) ? data.items : [];
      loaded = true;
      return data;
    } catch (e) {
      items = [];
      loaded = false;
      error = e?.message || 'Не удалось загрузить платежи.';
      throw e;
    } finally {
      loading = false;
      render();
    }
  }

  async function refund(index) {
    if (!isAdmin() || refunding) return null;
    const item = items[Number(index)];
    if (!item?.paymentChargeId || !targetUserId) return null;
    const reason = String($('billingRefundReason')?.value || '').trim();
    if (reason.length < 3) {
      toast('Укажите причину возврата.');
      return null;
    }
    if (!$('billingRefundConfirm')?.checked) {
      toast('Подтвердите ручной возврат.');
      return null;
    }
    const label = productLabel(item);
    const stars = Number(item.stars || 0);
    if (!confirmAction(`Вернуть ${stars || ''} Stars за «${label}» пользователю ${targetUserId}? Доступ будет отозван.`)) return null;

    refunding = true;
    error = '';
    render();
    try {
      const result = await api('/api/admin/billing/refund', {
        method:'POST',
        body:JSON.stringify({
          telegramId:targetUserId,
          telegramPaymentChargeId:String(item.paymentChargeId),
          reason,
        }),
        retry:false,
        dedupe:false,
      });
      toast('Возврат Telegram Stars выполнен.');
      const confirm = $('billingRefundConfirm');
      if (confirm) confirm.checked = false;
      await reloadProfile();
      await load(true);
      return result;
    } catch (e) {
      error = e?.message || 'Не удалось выполнить возврат.';
      toast(error);
      throw e;
    } finally {
      refunding = false;
      render();
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    $('billingRefundLookupBtn')?.addEventListener('click', () => { void load(true); });
    $('billingRefundUserId')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') void load(true);
    });
    $('adminBillingRefundPanel')?.addEventListener('click', event => {
      const button = event.target?.closest?.('[data-billing-refund-index]');
      if (!button || button.disabled) return;
      void refund(Number(button.dataset.billingRefundIndex));
    });
    render();
  }

  return Object.freeze({
    bind,
    load,
    refund,
    render,
    snapshot: () => ({ loaded, loading, refunding, targetUserId, items:[...items], error }),
  });
}
