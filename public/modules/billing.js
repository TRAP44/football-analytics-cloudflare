export function billingUiSnapshot(profile = {}, billing = {}, now = Date.now()) {
  const quota = profile?.quota || {};
  const profileBilling = profile?.billing || {};
  const current = billing?.current || {};
  const plan = String(current.plan || profileBilling.plan || quota.plan || 'FREE').toUpperCase();
  const subscriptionUntil = current.subscriptionUntil || profileBilling.subscriptionUntil || null;
  const expiresMs = subscriptionUntil ? new Date(subscriptionUntil).getTime() : Number.NaN;
  const expired = Boolean(subscriptionUntil && Number.isFinite(expiresMs) && expiresMs <= Number(now));
  const used = Math.max(0, Number(quota.used || 0));
  const limit = Math.max(0, Number(quota.limit || billing?.plans?.[plan]?.dailyLimit || 0));
  const left = Math.max(0, Number.isFinite(Number(quota.left)) ? Number(quota.left) : limit - used);
  const monetizationEnabled = Boolean(billing?.enabled ?? profile?.features?.monetizationEnabled);
  return {
    plan: expired && plan !== 'FREE' ? 'FREE' : plan,
    subscriptionUntil,
    expired,
    canceled: Boolean(current.canceled ?? profileBilling.canceled),
    used,
    limit,
    left,
    monetizationEnabled,
    ready: Boolean(monetizationEnabled && billing?.ready),
  };
}

export function createBillingModule({
  state,
  elementById,
  api,
  toast,
  telegram,
  dateTime,
  reloadProfile,
  openProfile,
}) {
  if (!state || typeof elementById !== 'function' || typeof api !== 'function') {
    throw new TypeError('Billing module requires state, elementById and api.');
  }

  const $ = elementById;
  const paidPlans = new Set(['PRO', 'PREMIUM']);
  let loaded = false;
  let loading = false;
  let busyAction = '';
  let syncing = false;
  let paymentState = 'idle';
  let bound = false;
  let lastError = '';

  function planConfig(plan) {
    return state.billing?.plans?.[plan] || null;
  }

  function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = String(value ?? '');
  }

  function paymentStatus(snapshot) {
    if (paymentState === 'opening') return ['pending', 'Открываю защищённое окно Telegram Stars…'];
    if (paymentState === 'syncing') return ['pending', 'Платёж подтверждён Telegram. Сверяем доступ с сервером…'];
    if (paymentState === 'success') return ['success', 'Оплата подтверждена сервером. Тариф активирован.'];
    if (paymentState === 'pending') return ['pending', 'Платёж обрабатывается. Нажмите «Проверить оплату», если статус не обновится автоматически.'];
    if (paymentState === 'failed') return ['failed', 'Telegram не завершил платёж. Доступ меняется только после серверного подтверждения транзакции.'];
    if (paymentState === 'cancelled') return ['waiting', 'Оплата отменена. Текущий доступ не изменился.'];
    if (lastError) return ['failed', lastError];
    if (!snapshot.monetizationEnabled) return ['waiting', 'Платежи пока на паузе. Тарифы подготовлены, бесплатные функции работают как обычно.'];
    if (!telegram?.openInvoice) return ['waiting', 'Оплата Telegram Stars доступна только внутри Telegram Mini App.'];
    if (!snapshot.ready) return ['waiting', 'Платежи временно недоступны: проверяем подключение Telegram.'];
    return ['ready', 'Telegram Stars готовы. Тариф активируется только после серверного подтверждения платежа.'];
  }

  function renderPlan(plan, snapshot) {
    const cfg = planConfig(plan);
    const price = $(plan === 'PRO' ? 'proPrice' : 'premiumPrice');
    const limit = $(plan === 'PRO' ? 'proLimit' : 'premiumLimit');
    const button = $(plan === 'PRO' ? 'proBtn' : 'premiumBtn');
    if (price) price.textContent = cfg ? String(cfg.stars) + ' ⭐ / 30 дней' : 'Цена загружается…';
    if (limit) limit.textContent = cfg ? String(cfg.dailyLimit) + ' AI-разборов / день' : 'Лимит загружается…';
    if (!button) return;

    const currentPaid = paidPlans.has(snapshot.plan);
    const samePlan = snapshot.plan === plan && !snapshot.expired;
    const available = snapshot.ready && Boolean(telegram?.openInvoice) && Boolean(cfg);
    button.disabled = Boolean(busyAction || syncing || samePlan || currentPaid || !available);
    button.setAttribute('aria-busy', busyAction === 'purchase:' + plan ? 'true' : 'false');

    if (busyAction === 'purchase:' + plan) button.textContent = 'Открываю Telegram…';
    else if (samePlan) button.textContent = 'Текущий тариф';
    else if (currentPaid) button.textContent = 'После окончания ' + snapshot.plan;
    else if (!snapshot.monetizationEnabled) button.textContent = 'Оплата пока на паузе';
    else if (!telegram?.openInvoice) button.textContent = 'Откройте в Telegram';
    else if (!snapshot.ready) button.textContent = 'Временно недоступно';
    else button.textContent = 'Подключить · ' + String(cfg.stars) + ' ⭐';
  }

  function render() {
    const root = $('billingPanel');
    if (!root) return;
    const snapshot = billingUiSnapshot(state.profile || {}, state.billing || {});
    root.dataset.plan = snapshot.plan;
    root.classList.toggle('is-loading', loading);
    root.classList.toggle('is-paused', !snapshot.monetizationEnabled);

    setText('billingPlanBadge', snapshot.plan);
    setText('billingQuotaUsed', snapshot.used);
    setText('billingQuotaLimit', snapshot.limit || '—');
    setText('billingQuotaLeft', snapshot.limit ? snapshot.left : '—');
    setText('freeLimit', String(planConfig('FREE')?.dailyLimit || snapshot.limit || '—') + ' AI-разборов / день');

    const progress = $('billingQuotaProgress');
    if (progress) {
      const percent = snapshot.limit > 0 ? Math.max(0, Math.min(100, Math.round(snapshot.used / snapshot.limit * 100))) : 0;
      progress.style.width = String(percent) + '%';
      progress.parentElement?.setAttribute('aria-valuenow', String(percent));
    }

    const expiry = $('billingExpiry');
    if (expiry) {
      expiry.textContent = snapshot.subscriptionUntil
        ? (snapshot.expired ? 'Истекла · ' : 'До · ') + dateTime(snapshot.subscriptionUntil)
        : 'Без подписки';
    }

    document.querySelectorAll('.pricing-card[data-plan]').forEach(card => {
      card.classList.toggle('current', card.dataset.plan === snapshot.plan);
    });
    setText('freePlanState', snapshot.plan === 'FREE' ? 'Текущий тариф' : 'Базовый доступ');

    const [tone, message] = paymentStatus(snapshot);
    const status = $('billingStatus');
    if (status) {
      status.className = 'billing-status ' + tone;
      status.textContent = message;
    }

    const details = $('subscriptionDetails');
    const detailsPlan = $('subscriptionPlan');
    const detailsCopy = $('subscriptionCopy');
    const manage = $('subscriptionManageBtn');
    if (details && detailsPlan && detailsCopy && manage) {
      const show = paidPlans.has(snapshot.plan) && Boolean(snapshot.subscriptionUntil) && !snapshot.expired;
      details.hidden = !show;
      manage.hidden = !show;
      if (show) {
        detailsPlan.textContent = snapshot.plan;
        detailsCopy.textContent = 'Активен до ' + dateTime(snapshot.subscriptionUntil) + (snapshot.canceled ? ' · автопродление отключено' : ' · автопродление включено');
        manage.dataset.action = snapshot.canceled ? 'resume' : 'cancel';
        manage.textContent = snapshot.canceled ? 'Возобновить автопродление' : 'Отключить автопродление';
      }
      manage.disabled = Boolean(busyAction || syncing || !snapshot.monetizationEnabled);
    }

    const sync = $('billingSyncBtn');
    if (sync) {
      sync.disabled = Boolean(syncing || busyAction || !snapshot.monetizationEnabled);
      sync.textContent = syncing ? 'Проверяю…' : 'Проверить оплату';
    }

    renderPlan('PRO', snapshot);
    renderPlan('PREMIUM', snapshot);
  }

  async function load({ force = false } = {}) {
    if (loading || (loaded && !force)) {
      render();
      return state.billing;
    }
    loading = true;
    lastError = '';
    render();
    try {
      state.billing = await api('/api/billing/plans', { retry: false });
      loaded = true;
      return state.billing;
    } catch (error) {
      loaded = false;
      lastError = error?.message || 'Не удалось загрузить тарифы.';
      state.billing = state.billing || { enabled: Boolean(state.profile?.features?.monetizationEnabled), ready: false };
      return state.billing;
    } finally {
      loading = false;
      render();
    }
  }

  async function syncBilling(showToast = true) {
    const snapshot = billingUiSnapshot(state.profile || {}, state.billing || {});
    if (!snapshot.monetizationEnabled) {
      if (showToast) toast?.('Оплата пока не включена.');
      return { synced: false };
    }
    if (syncing) return { synced: false, duplicate: true };
    syncing = true;
    lastError = '';
    render();
    try {
      const result = await api('/api/billing/sync', { method: 'POST', body: '{}' });
      if (typeof reloadProfile === 'function') await reloadProfile();
      await load({ force: true });
      if (showToast) toast?.(result.synced ? 'Оплата подтверждена сервером' : 'Новых подтверждённых платежей не найдено');
      return result;
    } catch (error) {
      lastError = error?.message || 'Не удалось проверить оплату.';
      if (showToast) toast?.(lastError);
      throw error;
    } finally {
      syncing = false;
      render();
    }
  }

  async function buyPlan(plan) {
    const normalized = String(plan || '').toUpperCase();
    if (!paidPlans.has(normalized) || busyAction || syncing) return;
    const snapshot = billingUiSnapshot(state.profile || {}, state.billing || {});
    if (!snapshot.monetizationEnabled || !snapshot.ready) {
      toast?.('Оплата пока недоступна.');
      return;
    }
    if (!telegram?.openInvoice) {
      toast?.('Оплата доступна только внутри Telegram.');
      return;
    }
    if (paidPlans.has(snapshot.plan)) {
      toast?.('Сначала дождитесь окончания текущего оплаченного периода.');
      return;
    }

    busyAction = 'purchase:' + normalized;
    paymentState = 'opening';
    lastError = '';
    render();

    try {
      const invoice = await api('/api/billing/invoice', {
        method: 'POST',
        body: JSON.stringify({ plan: normalized }),
      });
      if (!invoice?.invoiceUrl) throw new Error('Telegram не вернул ссылку на оплату.');

      telegram.openInvoice(invoice.invoiceUrl, status => {
        void (async () => {
          const value = String(typeof status === 'string' ? status : status?.status || '').toLowerCase();
          try {
            if (value === 'paid') {
              paymentState = 'syncing';
              render();
              await syncBilling(false);
              const after = billingUiSnapshot(state.profile || {}, state.billing || {});
              if (after.plan === normalized && !after.expired) {
                paymentState = 'success';
                toast?.(normalized + ' активирован');
              } else {
                paymentState = 'pending';
                toast?.('Платёж принят Telegram. Сервер ещё синхронизирует доступ.');
              }
            } else if (value === 'pending') {
              paymentState = 'pending';
              toast?.('Платёж обрабатывается.');
            } else if (value === 'cancelled' || value === 'canceled') {
              paymentState = 'cancelled';
              toast?.('Оплата отменена.');
            } else {
              paymentState = 'failed';
              toast?.('Telegram не завершил платёж.');
            }
          } catch (error) {
            paymentState = 'pending';
            lastError = error?.message || 'Платёж требует повторной серверной проверки.';
          } finally {
            busyAction = '';
            render();
          }
        })();
      });
    } catch (error) {
      busyAction = '';
      paymentState = 'failed';
      lastError = error?.message || 'Не удалось открыть оплату.';
      render();
      toast?.(lastError);
    }
  }

  async function manageSubscription(action) {
    const normalized = String(action || '').toLowerCase();
    if (!['cancel', 'resume'].includes(normalized) || busyAction || syncing) return;
    busyAction = 'subscription:' + normalized;
    lastError = '';
    render();
    try {
      const data = await api('/api/billing/subscription', {
        method: 'POST',
        body: JSON.stringify({ action: normalized }),
      });
      if (typeof reloadProfile === 'function') await reloadProfile();
      await load({ force: true });
      toast?.(data.canceled ? 'Автопродление отключено' : 'Автопродление включено');
    } catch (error) {
      lastError = error?.message || 'Не удалось изменить подписку.';
      toast?.(lastError);
    } finally {
      busyAction = '';
      render();
    }
  }

  async function openPlansFromQuota() {
    if (typeof openProfile === 'function') await openProfile();
    await load({ force: !loaded });
    $('billingPanel')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  function showQuotaPaywall() {
    const panel = $('analysisQuotaPaywall');
    if (panel) panel.hidden = false;
  }

  function hideQuotaPaywall() {
    const panel = $('analysisQuotaPaywall');
    if (panel) panel.hidden = true;
  }

  function bind() {
    if (bound) return;
    bound = true;
    $('proBtn')?.addEventListener('click', () => buyPlan('PRO'));
    $('premiumBtn')?.addEventListener('click', () => buyPlan('PREMIUM'));
    $('billingSyncBtn')?.addEventListener('click', () => syncBilling(true));
    $('subscriptionManageBtn')?.addEventListener('click', () => manageSubscription($('subscriptionManageBtn')?.dataset.action || 'cancel'));
    $('quotaUpgradeBtn')?.addEventListener('click', () => { void openPlansFromQuota(); });
    render();
  }

  return Object.freeze({
    bind,
    buyPlan,
    hideQuotaPaywall,
    load,
    manageSubscription,
    render,
    showQuotaPaywall,
    snapshot: () => ({ loaded, loading, busyAction, syncing, paymentState, lastError }),
    syncBilling,
  });
}
