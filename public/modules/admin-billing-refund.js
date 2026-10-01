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
