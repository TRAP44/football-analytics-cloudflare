const PASS_TYPES = Object.freeze(['MATCH_PASS', 'DAY_PASS', 'WEEKEND_PASS']);
const PASS_META = Object.freeze({
  MATCH_PASS: Object.freeze({ title:'Match Pass', short:'1 матч' }),
  DAY_PASS: Object.freeze({ title:'Day Pass', short:'1 день' }),
  WEEKEND_PASS: Object.freeze({ title:'Weekend Pass', short:'7 дней' }),
});

function safeFixtureId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : 0;
  if (typeof value !== 'string' || value.length > 24) return 0;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return 0;
  const id=Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

export function matchPassPickerRows(rows = [], { query = '', status = 'all' } = {}) {
  const needle = String(query || '').trim().toLocaleLowerCase('ru-RU');
  const wanted = ['all', 'upcoming', 'live'].includes(status) ? status : 'all';
  return (Array.isArray(rows) ? rows : []).filter(match => {
    if (!safeFixtureId(match?.fixtureId)) return false;
    if (wanted === 'upcoming' && (match.live || match.finished)) return false;
    if (wanted === 'live' && !match.live) return false;
    const title = [match?.home?.name, match?.away?.name, match?.leagueShort, match?.league].join(' ');
    return !needle || title.toLocaleLowerCase('ru-RU').includes(needle);
  }).slice(0, 50);
}

function localMatchPickerDate(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
}

export function buildPassPurchaseBody(passType, fixtureId = 0) {
  const type = String(passType || '').trim().toUpperCase();
  if (!PASS_TYPES.includes(type)) return null;
  if (type === 'MATCH_PASS') {
    const id = safeFixtureId(fixtureId);
    return id ? { passType:type, fixtureId:id } : null;
  }
  return { passType:type };
}

function latestPassDecision(entitlement = {}, passType = '', fixtureId = 0, now = Date.now()) {
  const type=String(passType || '').toUpperCase();
  const rows=(Array.isArray(entitlement?.decisions) ? entitlement.decisions : [])
    .filter(row => String(row?.type || '').toUpperCase() === type)
    .sort((a,b) => String(b?.expiresAt || '').localeCompare(String(a?.expiresAt || '')));
  if (!rows.length) return null;

  if (type === 'MATCH_PASS') {
    const requestedFixtureId=safeFixtureId(fixtureId);
    if (requestedFixtureId) {
      const exactActive=rows.find(row => (
        row?.active === true
        && safeFixtureId(row?.fixtureId) === requestedFixtureId
      ));
      if (exactActive) return exactActive;

      const nowMs=Number(now);
      const activeOther=rows.find(row => {
        const expiry=row?.expiresAt ? new Date(row.expiresAt).getTime() : Number.NaN;
        return row?.reason === 'fixture_mismatch'
          && safeFixtureId(row?.fixtureId) > 0
          && Number.isFinite(nowMs)
          && Number.isFinite(expiry)
          && expiry > nowMs;
      });
      if (activeOther) return activeOther;

      const exactPrevious=rows.find(row => safeFixtureId(row?.fixtureId) === requestedFixtureId);
      if (exactPrevious) return exactPrevious;
    }
  }

  return rows.find(row => row?.active === true) || rows[0];
}

export function passUiState({
  product = null,
  entitlement = {},
  passType = '',
  fixtureId = 0,
  paymentsEnabled = false,
  subscriptionActive = false,
  now = Date.now(),
} = {}) {
  const type = String(passType || '').toUpperCase();
  const nowMs=Number(now);
  const decision = latestPassDecision(entitlement, type, fixtureId, nowMs);
  const expiresMs = decision?.expiresAt ? new Date(decision.expiresAt).getTime() : Number.NaN;
  const future = Number.isFinite(expiresMs) && expiresMs > nowMs;
  const exactFixture = type !== 'MATCH_PASS'
    || (safeFixtureId(fixtureId) > 0 && Number(decision?.fixtureId || 0) === safeFixtureId(fixtureId));

  let state = 'available';
  if (subscriptionActive) state = 'included';
  else if (!product || product.saleReady === false) state = 'unavailable';
  else if (type === 'MATCH_PASS' && !safeFixtureId(fixtureId)) state = 'needs-fixture';
  else if (decision?.active && exactFixture) state = 'active';
  else if (type === 'MATCH_PASS' && decision?.reason === 'fixture_mismatch' && future) state = 'active-other';
  // Historical Pass rows describe past usage, not a currently expired shop item.
  // A new Pass can still be purchased when previous access ended or was used up.
  // Keep old decisions in the entitlement response for history/auditing only.
  else if (!paymentsEnabled) state = 'paused';

  return { state, decision, expiresAt:decision?.expiresAt || null };
}

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
  const profileMonetization=profile?.features?.monetizationEnabled;
  const billingMonetization=billing?.enabled;
  const monetizationEnabled=profileMonetization === false
    ? false
    : billingMonetization === true
      || (billingMonetization == null && profileMonetization === true);
  return {
    plan: expired && plan !== 'FREE' ? 'FREE' : plan,
    subscriptionUntil,
    expired,
    canceled: Boolean(current.canceled ?? profileBilling.canceled),
    used,
    limit,
    left,
    monetizationEnabled,
    ready: Boolean(monetizationEnabled && billing?.ready === true),
  };
}

export function billingPurchaseVisibility(snapshot = {}) {
  const enabled=snapshot?.monetizationEnabled === true;
  return Object.freeze({
    enabled,
    pricing:enabled,
    passes:enabled,
    paymentActions:enabled,
    quotaUpgrade:enabled,
  });
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
  openPassMatches,
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
  let passFixtureId = 0;
  let passLoading = false;
  let passLoadingFixtureId = 0;
  let passLoaded = false;
  let passLoadedFixtureId = 0;
  let passRequestSequence = 0;
  let passError = '';
  let matchPickerOpen = false;
  let matchPickerDate = '';
  let matchPickerSearch = '';
  let matchPickerStatus = 'all';
  let matchPickerRows = [];
  let matchPickerLoading = false;
  let matchPickerError = '';
  let matchPickerRequest = 0;
  let selectedMatch = null;
  let passData = {
    paymentsEnabled:false,
    products:{},
    entitlement:{ decisions:[], passes:{ active:[] }, subscriptionActive:false },
  };

  function planConfig(plan) {
    return state.billing?.plans?.[plan] || null;
  }

  function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = String(value ?? '');
  }

  function contextFixtureId() {
    return safeFixtureId(passFixtureId);
  }

  function clearPassContext() {
    matchPickerOpen = false;
    matchPickerRequest += 1;
    selectedMatch = null;
    passFixtureId = 0;
    passLoaded = false;
    passLoadedFixtureId = 0;
    passLoading = false;
    passLoadingFixtureId = 0;
    passRequestSequence += 1;
    passError = '';
    render();
  }

  function paymentStatus(snapshot) {
    if (paymentState === 'opening') return ['pending', 'Открываю защищённое окно Telegram Stars…'];
    if (paymentState === 'syncing') return ['pending', 'Платёж подтверждён Telegram. Сверяем доступ с сервером…'];
    if (paymentState === 'success') return ['success', 'Оплата подтверждена сервером. Доступ активирован.'];
    if (paymentState === 'pending') return ['pending', 'Платёж обрабатывается. Нажмите «Проверить оплату», если статус не обновится автоматически.'];
    if (paymentState === 'failed') return ['failed', 'Telegram не завершил платёж. Доступ меняется только после серверного подтверждения транзакции.'];
    if (paymentState === 'cancelled') return ['waiting', 'Оплата отменена. Текущий доступ не изменился.'];
    if (lastError) return ['failed', lastError];
    if (!snapshot.monetizationEnabled) return ['waiting', 'Платежи пока на паузе. Тарифы и Pass подготовлены, бесплатные функции работают как обычно.'];
    if (!telegram?.openInvoice) return ['waiting', 'Оплата Telegram Stars доступна только внутри Telegram Mini App.'];
    if (!snapshot.ready) return ['waiting', 'Платежи временно недоступны: проверяем подключение Telegram.'];
    return ['ready', 'Telegram Stars готовы. Доступ активируется только после серверного подтверждения платежа.'];
  }

  function renderPlan(plan, snapshot) {
    const cfg = planConfig(plan);
    const price = $(plan === 'PRO' ? 'proPrice' : 'premiumPrice');
    const limit = $(plan === 'PRO' ? 'proLimit' : 'premiumLimit');
    const button = $(plan === 'PRO' ? 'proBtn' : 'premiumBtn');
    if (price) price.textContent = cfg
      ? String(cfg.stars) + ' ⭐ / 30 дней'
      : (snapshot.monetizationEnabled ? (loading ? 'Цена загружается…' : 'Не удалось получить цену') : 'Пока недоступно');
    if (limit) limit.textContent = cfg
      ? String(cfg.dailyLimit) + ' AI-разборов / день'
      : (snapshot.monetizationEnabled ? (loading ? 'Лимит загружается…' : 'Лимит недоступен') : 'После включения оплаты');
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

  function passDurationLabel(type, product) {
    if (type === 'MATCH_PASS') return '1 матч';
    if (type === 'DAY_PASS') return '24 часа';
    if (type === 'WEEKEND_PASS') return '7 дней';
    const n = Number(product?.durationHours || 0);
    return n > 0 ? String(n) + ' ч' : '—';
  }

  function passUsageLabel(type, product) {
    if (type === 'MATCH_PASS') return 'Полный AI-доступ';
    if (type === 'DAY_PASS') return 'Все матчи';
    const limit = Number(product?.usageLimit || 0);
    if (type === 'WEEKEND_PASS' && limit > 0) return 'До ' + String(limit) + ' AI-анализов';
    if (limit > 0) return String(limit) + ' AI-анализов';
    return 'Все матчи';
  }

  function passStateCopy(type, view) {
    if (view.state === 'active' && type === 'MATCH_PASS') return 'Активен только для выбранного матча';
    if (view.state === 'active' && type === 'DAY_PASS') {
      return view.expiresAt ? 'Все поддерживаемые матчи · до ' + dateTime(view.expiresAt) : 'Все поддерживаемые матчи';
    }
    if (view.state === 'active' && type === 'WEEKEND_PASS') {
      const used = Math.max(0, Number(view.decision?.usageCount || 0));
      const limit = Math.max(0, Number(view.decision?.usageLimit || 0));
      const usage = limit > 0 ? ' · использовано ' + used + '/' + limit + ' · осталось ' + Math.max(0, limit - used) : '';
      return (view.expiresAt ? 'Активен до ' + dateTime(view.expiresAt) : 'Активен') + usage;
    }
    if (view.state === 'active') return view.expiresAt ? 'Активен до ' + dateTime(view.expiresAt) : 'Активен';
    if (view.state === 'active-other') return 'Есть Match Pass только для матча #' + Number(view.decision?.fixtureId || 0);
    if (view.state === 'expired' && type === 'MATCH_PASS') return 'Match Pass завершён';
    if (view.state === 'expired') return view.expiresAt ? 'Истёк · ' + dateTime(view.expiresAt) : 'Истёк';
    if (view.state === 'exhausted') return 'Пакет использован';
    if (view.state === 'included') return 'Расширенный доступ уже входит в подписку';
    if (view.state === 'unavailable') return type === 'WEEKEND_PASS' ? 'Пока недоступен: серверный лимит не настроен' : 'Пока недоступен';
    if (view.state === 'needs-fixture') return 'Выберите матч ниже. Покупка будет действовать только для него.';
    if (view.state === 'paused') return 'Покупка пока на паузе';
    return 'Доступен к покупке';
  }

  function passButtonCopy(type, product, view) {
    if (busyAction === 'pass:' + type) return 'Открываю Telegram…';
    if (view.state === 'active' && (type === 'DAY_PASS' || type === 'WEEKEND_PASS')) return 'Выбрать матч';
    if (view.state === 'active') return 'Уже активен';
    if (view.state === 'included') return 'Входит в подписку';
    if (view.state === 'unavailable') return 'Недоступен';
    if (view.state === 'needs-fixture') return 'Выбрать матч · ' + String(product?.stars || '—') + ' ⭐';
    if (view.state === 'paused') return 'Оплата пока на паузе';
    if (!telegram?.openInvoice) return 'Откройте в Telegram';
    return 'Купить · ' + String(product?.stars || '—') + ' ⭐';
  }

  function renderPasses(snapshot) {
    const root = $('passStore');
    if (!root) return;
    const fixtureId = contextFixtureId();
    root.classList.toggle('is-loading', passLoading);
    root.dataset.fixtureId = fixtureId ? String(fixtureId) : '';

    const context = $('passContext');
    if (context) context.textContent = fixtureId
      ? 'Match Pass для ' + (selectedMatch?.fixtureId === fixtureId
        ? selectedMatch.title : 'матча №' + fixtureId) + '. После выбора подтвердите покупку.'
      : 'Match Pass — для выбранного матча. Day Pass — на 24 часа, Weekend Pass — на 7 дней.';

    if ($('passStoreStatus')) {
      $('passStoreStatus').textContent = passError
        ? passError
        : (passLoading ? 'Обновляем Pass-доступ…' : 'Pass покупается отдельно: без автопродления и смены вашего тарифа.');
    }

    for (const type of PASS_TYPES) {
      const meta = PASS_META[type];
      const product = passData.products?.[type] || null;
      const view = passUiState({
        product,
        entitlement:passData.entitlement,
        passType:type,
        fixtureId,
        paymentsEnabled:Boolean(passData.paymentsEnabled),
        subscriptionActive:Boolean(passData.entitlement?.subscriptionActive || paidPlans.has(snapshot.plan)),
      });
      const key = type === 'MATCH_PASS' ? 'matchPass' : type === 'DAY_PASS' ? 'dayPass' : 'weekendPass';
      setText(key + 'Title', meta.title);
      setText(key + 'Price', product ? String(product.stars) + ' ⭐' : '— ⭐');
      setText(key + 'Duration', product ? passDurationLabel(type, product) : '—');
      setText(key + 'Usage', product ? passUsageLabel(type, product) : 'Проверяем сервер…');
      setText(key + 'State', type === 'MATCH_PASS' && selectedMatch?.fixtureId === fixtureId
        && view.state === 'available'
        ? 'Выбрано: ' + selectedMatch.title + '. Нажмите «Купить», чтобы открыть Telegram Stars.'
        : passStateCopy(type, view));
      const card = $(key + 'Card');
      if (card) card.dataset.state = view.state;
      const button = $(key + 'Btn');
      if (button) {
        const request = buildPassPurchaseBody(type, fixtureId);
        const useActivePass = view.state === 'active'
          && (type === 'DAY_PASS' || type === 'WEEKEND_PASS')
          && typeof openPassMatches === 'function';
        const chooseFixture = type === 'MATCH_PASS' && view.state === 'needs-fixture';
        const enabledState = ['available','active-other'].includes(view.state) || useActivePass || chooseFixture;
        button.dataset.passAction = useActivePass ? 'use' : 'buy';
        button.disabled = Boolean(
          busyAction || syncing || passLoading
          || !product || product.saleReady === false
          || (!chooseFixture && !useActivePass && (!passData.paymentsEnabled || !telegram?.openInvoice || !request))
          || !enabledState
        );
        button.textContent = passButtonCopy(type, product, view);
        button.setAttribute('aria-busy', busyAction === 'pass:' + type ? 'true' : 'false');
      }
    }

    renderMatchPicker();

    const active = $('activePasses');
    if (active) {
      const rows = Array.isArray(passData.entitlement?.decisions) ? passData.entitlement.decisions : [];
      const visible = rows.filter(row => {
        const expiry = row?.expiresAt ? new Date(row.expiresAt).getTime() : Number.NaN;
        return row?.active || (row?.reason === 'fixture_mismatch' && Number.isFinite(expiry) && expiry > Date.now());
      }).slice(0,4);
      active.hidden=visible.length===0;
      active.replaceChildren();
      for (const row of visible) {
        const type=PASS_TYPES.includes(String(row?.type || '').toUpperCase())
          ? String(row.type).toUpperCase()
          : '';
        if (!type) continue;
        const title=PASS_META[type].title;
        const fixtureId=safeFixtureId(row?.fixtureId);
        const usageCount=Math.max(0,Number.isSafeInteger(Number(row?.usageCount)) ? Number(row.usageCount) : 0);
        const usageLimit=row?.usageLimit == null
          ? null
          : Math.max(0,Number.isSafeInteger(Number(row.usageLimit)) ? Number(row.usageLimit) : 0);
        const scope=type === 'MATCH_PASS' && fixtureId
          ? 'только матч №' + fixtureId
          : type === 'DAY_PASS'
            ? 'все поддерживаемые матчи'
            : '';
        const usage=usageLimit !== null
          ? 'использовано ' + usageCount + '/' + usageLimit + ' · осталось ' + Math.max(0,usageLimit-usageCount)
          : '';
        const expiry=type === 'MATCH_PASS' || !row?.expiresAt ? '' : 'до ' + dateTime(row.expiresAt);
        const line=document.createElement('div');
        line.className='active-pass-row';
        const strong=document.createElement('strong');
        strong.textContent=title;
        const span=document.createElement('span');
        span.textContent=[scope,usage,expiry].filter(Boolean).join(' · ');
        line.append(strong,span);
        active.append(line);
      }
      active.hidden=active.children.length===0;
    }
  }

  function render() {
    const root = $('billingPanel');
    if (!root) return;
    const snapshot = billingUiSnapshot(state.profile || {}, state.billing || {});
    root.dataset.plan = snapshot.plan;
    root.classList.toggle('is-loading', loading);
    root.classList.toggle('is-paused', !snapshot.monetizationEnabled);

    const purchaseUi=billingPurchaseVisibility(snapshot);
    const preview=$('billingPreview');
    if (preview) preview.hidden=purchaseUi.enabled;
    for (const id of ['billingPricingGrid','passStore','billingActions','billingFootnote']) {
      const node=$(id);
      if (node) node.hidden=!purchaseUi.enabled;
    }
    const quotaUpgrade=$('quotaUpgradeBtn');
    if (quotaUpgrade) quotaUpgrade.hidden=!purchaseUi.quotaUpgrade;

    setText('billingKicker', purchaseUi.enabled ? 'MATCHRADAR PRO' : 'AI-ДОСТУП');
    setText('billingTitle', purchaseUi.enabled ? 'Тариф и AI-доступ' : 'AI-лимит');
    setText(
      'billingIntro',
      purchaseUi.enabled
        ? 'Подписка через Telegram Stars. Матчи, LIVE и базовая статистика не блокируются тарифом.'
        : 'Бесплатный режим активен. Матчи, LIVE и базовая статистика доступны без оплаты.'
    );

    setText('billingPlanBadge', snapshot.plan === 'FREE' ? 'Бесплатный' : snapshot.plan);
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
      expiry.textContent = snapshot.plan === 'FREE'
        ? 'Нет активной подписки'
        : (snapshot.subscriptionUntil && !snapshot.expired
          ? 'До · ' + dateTime(snapshot.subscriptionUntil)
          : 'Нет активной подписки');
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
    renderPasses(snapshot);
  }


  function renderMatchPicker() {
    const root = $('matchPassPicker');
    if (!root) return;
    root.hidden = !matchPickerOpen;
    if (!matchPickerOpen) return;
    if ($('matchPassPickerDate')) $('matchPassPickerDate').value = matchPickerDate;
    if ($('matchPassPickerSearch')) $('matchPassPickerSearch').value = matchPickerSearch;
    if ($('matchPassPickerFilter')) $('matchPassPickerFilter').value = matchPickerStatus;
    renderMatchPickerResults();
  }

  function renderMatchPickerResults() {
    const list = $('matchPassPickerMatches');
    const notice = $('matchPassPickerStatus');
    if (!list || !notice || !matchPickerOpen) return;
    list.replaceChildren();
    if (matchPickerLoading) {
      notice.textContent = 'Загружаем матчи выбранной даты…';
      return;
    }
    if (matchPickerError) {
      notice.textContent = matchPickerError;
      return;
    }
    const matches = matchPassPickerRows(matchPickerRows, {
      query:matchPickerSearch,
      status:matchPickerStatus,
    });
    notice.textContent = matches.length
      ? 'Выберите матч: оплата начнётся только после подтверждения.'
      : 'Матчей по этому запросу нет. Попробуйте другую дату или снимите фильтр.';
    for (const match of matches) {
      const id = safeFixtureId(match.fixtureId);
      const title = [match?.home?.name || 'Команда', match?.away?.name || 'Команда'].join(' — ');
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'match-pass-picker-option';
      const name = document.createElement('strong');
      name.textContent = title;
      const detail = document.createElement('small');
      const progress = match.live ? 'LIVE' : match.finished ? 'Завершён' : 'Предстоящий';
      detail.textContent = [match?.leagueShort || match?.league || 'Турнир',
        match?.date && typeof dateTime === 'function' ? dateTime(match.date) : '',
        progress].filter(Boolean).join(' · ');
      choice.append(name,detail);
      choice.addEventListener('click', () => {
        if (!matchPickerOpen || matchPickerLoading) return;
        selectedMatch = {fixtureId:id,title,date:match.date || ''};
        matchPickerOpen = false;
        matchPickerRequest += 1;
        passFixtureId = id;
        render();
        void loadPassAccess({fixtureId:id,force:true});
      });
      list.append(choice);
    }
  }

  async function loadMatchPickerDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ||
        Number.isNaN(Date.parse(date+'T12:00:00'))) {
      matchPickerError = 'Выберите корректную дату.';
      renderMatchPickerResults();
      return;
    }
    const requestId = ++matchPickerRequest;
    matchPickerDate = date;
    matchPickerLoading = true;
    matchPickerError = '';
    renderMatchPicker();
    try {
      if (state.matchesMeta?.date === date && Array.isArray(state.matches) && state.matches.length) {
        matchPickerRows = state.matches;
      } else {
        const data = await api('/api/matches?date=' + encodeURIComponent(date), {retry:false});
        if (requestId !== matchPickerRequest || !matchPickerOpen) return;
        matchPickerRows = Array.isArray(data?.matches) ? data.matches
          : Array.isArray(data?.items) ? data.items : [];
      }
    } catch (error) {
      if (requestId !== matchPickerRequest || !matchPickerOpen) return;
      matchPickerRows = [];
      matchPickerError = error?.message || 'Не удалось загрузить матчи. Попробуйте другую дату.';
    } finally {
      if (requestId === matchPickerRequest) {
        matchPickerLoading = false;
        renderMatchPicker();
      }
    }
  }

  async function openMatchPicker() {
    if (matchPickerOpen) {
      $('matchPassPicker')?.scrollIntoView?.({block:'nearest',behavior:'smooth'});
      return;
    }
    matchPickerOpen = true;
    matchPickerDate = /^\d{4}-\d{2}-\d{2}$/.test(state.matchesMeta?.date || '')
      ? state.matchesMeta.date : localMatchPickerDate();
    matchPickerSearch = '';
    matchPickerStatus = 'all';
    renderMatchPicker();
    $('matchPassPicker')?.scrollIntoView?.({block:'nearest',behavior:'smooth'});
    await loadMatchPickerDate(matchPickerDate);
  }

  async function loadPassAccess({ fixtureId = contextFixtureId(), force = false } = {}) {
    const fid = safeFixtureId(fixtureId);
    passFixtureId = fid;
    const snapshot=billingUiSnapshot(state.profile || {}, state.billing || {});
    if (!snapshot.monetizationEnabled) {
      passRequestSequence += 1;
      passLoaded = true;
      passLoadedFixtureId = fid;
      passLoading = false;
      passLoadingFixtureId = 0;
      passError = '';
      passData = {
        paymentsEnabled:false,
        products:{},
        entitlement:{ decisions:[], passes:{ active:[] }, subscriptionActive:false },
      };
      render();
      return passData;
    }
    if (
      (passLoading && passLoadingFixtureId === fid)
      || (passLoaded && !force && passLoadedFixtureId === fid)
    ) {
      render();
      return passData;
    }

    const requestId=++passRequestSequence;
    passLoading = true;
    passLoadingFixtureId = fid;
    passError = '';
    render();
    try {
      const suffix = fid ? '?fixtureId=' + encodeURIComponent(String(fid)) : '';
      const data = await api('/api/entitlements' + suffix, { retry:false });
      if (requestId !== passRequestSequence || contextFixtureId() !== fid) return passData;
      passData = {
        paymentsEnabled:Boolean(data?.paymentsEnabled),
        products:data?.products || {},
        entitlement:data?.entitlement || { decisions:[], passes:{ active:[] }, subscriptionActive:false },
      };
      passLoaded = true;
      passLoadedFixtureId = fid;
      return passData;
    } catch (error) {
      if (requestId !== passRequestSequence || contextFixtureId() !== fid) return passData;
      passLoaded = false;
      passLoadedFixtureId = 0;
      passError = error?.message || 'Не удалось проверить Pass-доступ.';
      return passData;
    } finally {
      if (requestId === passRequestSequence) {
        passLoading = false;
        passLoadingFixtureId = 0;
        render();
      }
    }
  }

  async function load({ force = false } = {}) {
    if (state.profile?.features?.monetizationEnabled === false) {
      state.billing = {
        enabled: false,
        ready: false,
        current: {
          plan: state.profile?.billing?.plan || state.profile?.quota?.plan || 'FREE',
          subscriptionUntil: state.profile?.billing?.subscriptionUntil || null,
          canceled: Boolean(state.profile?.billing?.canceled),
        },
      };
      loaded = true;
      loading = false;
      lastError = '';
      passRequestSequence += 1;
      passLoaded = true;
      passLoadedFixtureId = contextFixtureId();
      passLoading = false;
      passLoadingFixtureId = 0;
      passError = '';
      passData = {
        paymentsEnabled:false,
        products:{},
        entitlement:{ decisions:[], passes:{ active:[] }, subscriptionActive:false },
      };
      render();
      return state.billing;
    }
    if (loading || (loaded && !force)) {
      if (!passLoaded || force) await loadPassAccess({ force });
      render();
      return state.billing;
    }
    loading = true;
    lastError = '';
    render();
    try {
      state.billing = await api('/api/billing/plans', { retry: false });
      loaded = true;
      await loadPassAccess({ force:true });
      return state.billing;
    } catch (error) {
      loaded = false;
      lastError = error?.message || 'Не удалось загрузить тарифы.';
      state.billing = state.billing || { enabled: Boolean(state.profile?.features?.monetizationEnabled), ready: false };
      await loadPassAccess({ force });
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
      await loadPassAccess({ force:true });
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

  async function buyPass(passType) {
    const type = String(passType || '').toUpperCase();
    if (!PASS_TYPES.includes(type) || busyAction || syncing) return;
    const fixtureId = contextFixtureId();
    const body = buildPassPurchaseBody(type, fixtureId);
    const product = passData.products?.[type] || null;
    const snapshot = billingUiSnapshot(state.profile || {}, state.billing || {});
    const view = passUiState({
      product,
      entitlement:passData.entitlement,
      passType:type,
      fixtureId,
      paymentsEnabled:Boolean(passData.paymentsEnabled),
      subscriptionActive:Boolean(passData.entitlement?.subscriptionActive || paidPlans.has(snapshot.plan)),
    });

    if (!body) {
      if (type === 'MATCH_PASS') await openMatchPicker();
      else toast?.('Выберите матч для покупки.');
      return;
    }
    if (!product?.saleReady) {
      toast?.('Этот Pass пока недоступен.');
      return;
    }
    if (!passData.paymentsEnabled || !snapshot.monetizationEnabled) {
      toast?.('Оплата пока не включена.');
      return;
    }
    if (!telegram?.openInvoice) {
      toast?.('Оплата доступна только внутри Telegram.');
      return;
    }
    if (view.state === 'active' || view.state === 'included') {
      toast?.(view.state === 'included' ? 'Расширенный доступ уже входит в подписку.' : 'Этот Pass уже активен.');
      return;
    }

    busyAction = 'pass:' + type;
    paymentState = 'opening';
    lastError = '';
    render();
    try {
      const invoice = await api('/api/billing/invoice', {
        method:'POST',
        body:JSON.stringify(body),
      });
      if (!invoice?.invoiceUrl) throw new Error('Telegram не вернул ссылку на оплату.');
      if (type === 'MATCH_PASS' && Number(invoice.fixtureId || 0) !== fixtureId) {
        throw new Error('Сервер вернул другой контекст матча. Счёт отменён.');
      }

      telegram.openInvoice(invoice.invoiceUrl, status => {
        void (async () => {
          const value = String(typeof status === 'string' ? status : status?.status || '').toLowerCase();
          try {
            if (value === 'paid') {
              paymentState = 'syncing';
              render();
              await syncBilling(false);
              await loadPassAccess({ fixtureId, force:true });
              const confirmed = passUiState({
                product:passData.products?.[type],
                entitlement:passData.entitlement,
                passType:type,
                fixtureId,
                paymentsEnabled:Boolean(passData.paymentsEnabled),
                subscriptionActive:Boolean(passData.entitlement?.subscriptionActive),
              });
              if (confirmed.state === 'active') {
                paymentState = 'success';
                toast?.((PASS_META[type]?.title || 'Pass') + ' активирован');
              } else {
                paymentState = 'pending';
                toast?.('Платёж принят Telegram. Сервер ещё активирует Pass.');
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
            lastError = error?.message || 'Pass требует повторной серверной проверки.';
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

  async function openPassStoreForFixture(fixtureId) {
    const id = safeFixtureId(fixtureId);
    if (!id) {
      toast?.('Не удалось определить матч для Match Pass.');
      return;
    }
    const snapshot=billingUiSnapshot(state.profile || {}, state.billing || {});
    if (!snapshot.monetizationEnabled) {
      toast?.('Покупки пока не включены. Бесплатные функции продолжают работать.');
      return { opened:false, reason:'monetization_paused' };
    }
    selectedMatch = null;
    matchPickerOpen = false;
    matchPickerRequest += 1;
    passFixtureId = id;
    if (typeof openProfile === 'function') await openProfile();
    await loadPassAccess({ fixtureId:id, force:true });
    render();
    $('passStore')?.scrollIntoView?.({ behavior:'smooth', block:'start' });
  }

  async function openPlansFromQuota() {
    if (typeof openProfile === 'function') await openProfile({ preservePassContext:true });
    await load({ force: !loaded });
    const id = contextFixtureId();
    if (id) await loadPassAccess({ fixtureId:id, force:true });
    $('billingPanel')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  function showQuotaPaywall(fixtureId = 0) {
    const id = safeFixtureId(fixtureId);
    if (id) passFixtureId = id;
    const snapshot=billingUiSnapshot(state.profile || {}, state.billing || {});
    const button=$('quotaUpgradeBtn');
    if (button) button.hidden=!snapshot.monetizationEnabled;
    const panel = $('analysisQuotaPaywall');
    if (panel) panel.hidden = false;
  }

  function hideQuotaPaywall() {
    const panel = $('analysisQuotaPaywall');
    if (panel) panel.hidden = true;
  }

  function handlePassButton(type) {
    const normalized = String(type || '').toUpperCase();
    const key = normalized === 'MATCH_PASS' ? 'matchPass' : normalized === 'DAY_PASS' ? 'dayPass' : 'weekendPass';
    const button = $(key + 'Btn');
    if (normalized === 'MATCH_PASS' && !contextFixtureId()) {
      void openMatchPicker();
      return;
    }
    if (button?.dataset.passAction === 'use' && typeof openPassMatches === 'function') {
      openPassMatches(normalized);
      return;
    }
    void buyPass(normalized);
  }

  function bind() {
    if (bound) return;
    bound = true;
    $('proBtn')?.addEventListener('click', () => buyPlan('PRO'));
    $('premiumBtn')?.addEventListener('click', () => buyPlan('PREMIUM'));
    $('billingSyncBtn')?.addEventListener('click', () => syncBilling(true));
    $('subscriptionManageBtn')?.addEventListener('click', () => manageSubscription($('subscriptionManageBtn')?.dataset.action || 'cancel'));
    $('quotaUpgradeBtn')?.addEventListener('click', () => { void openPlansFromQuota(); });
    $('matchPassBtn')?.addEventListener('click', () => handlePassButton('MATCH_PASS'));
    $('matchPassPickerClose')?.addEventListener('click', () => {
      matchPickerOpen = false;
      matchPickerRequest += 1;
      renderMatchPicker();
    });
    $('matchPassPickerDate')?.addEventListener('change', event => {
      void loadMatchPickerDate(event.target.value);
    });
    $('matchPassPickerSearch')?.addEventListener('input', event => {
      matchPickerSearch = String(event.target.value || '').slice(0,100);
      renderMatchPickerResults();
    });
    $('matchPassPickerFilter')?.addEventListener('change', event => {
      matchPickerStatus = event.target.value;
      renderMatchPickerResults();
    });
    $('dayPassBtn')?.addEventListener('click', () => handlePassButton('DAY_PASS'));
    $('weekendPassBtn')?.addEventListener('click', () => handlePassButton('WEEKEND_PASS'));
    $('passRefreshBtn')?.addEventListener('click', () => { void loadPassAccess({ force:true }); });
    render();
  }

  return Object.freeze({
    bind,
    buyPass,
    clearPassContext,
    buyPlan,
    hideQuotaPaywall,
    load,
    loadPassAccess,
    manageSubscription,
    openPassStoreForFixture,
    render,
    showQuotaPaywall,
    snapshot: () => ({
      loaded, loading, busyAction, syncing, paymentState, lastError,
      passLoaded, passLoading, passError, matchPickerOpen, matchPickerDate, passFixtureId:contextFixtureId(),
      passLoadedFixtureId, passLoadingFixtureId,
    }),
    syncBilling,
  });
}
