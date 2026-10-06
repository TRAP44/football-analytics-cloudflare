export function createBillingApiRuntime(deps = {}) {
  const {
    CHANNEL_PUBLISH_IDEMPOTENCY_MINUTES,
    PASS_TYPES,
    SUBSCRIPTION_PERIOD_SECONDS,
    adminForbidden,
    applyRefundedPayment,
    billingPlanConfig,
    billingWebhookStatus,
    createPassInvoicePayload,
    createSharedCacheRuntime,
    createTelegramLinksRuntime,
    findRefundableBillingCharge,
    getQuota,
    getUserRecord,
    hasSupabase,
    isAdminUser,
    json,
    listUserEntitlements,
    makeInvoicePayload,
    passProductConfig,
    recordOpsEvent,
    resolveUserEntitlements,
    supaSelectMany,
    syncBillingFromStars,
    telegramApi,
    updateUserSubscription
  } = deps;

  async function apiBillingPlans(request, cfg, user) {
    const webhook = cfg.monetizationEnabled
      ? await billingWebhookStatus(request, cfg)
      : { ready:false, reason:'monetization_paused', expectedUrl:`${new URL(request.url).origin}/telegram/webhook`, currentUrl:'', lastError:'' };
    const quota = await getQuota(user.id, cfg);
    const record = await getUserRecord(user.id, cfg);
    return json({
      enabled: Boolean(cfg.monetizationEnabled),
      ready: Boolean(cfg.monetizationEnabled && webhook.ready),
      reason: webhook.reason || '',
      webhook: { expectedUrl: webhook.expectedUrl, currentUrl: webhook.currentUrl || '', lastError: webhook.lastError || '' },
      current: {
        plan: quota.plan,
        subscriptionUntil: record?.subscription_until || null,
        canceled: Boolean(record?.subscription_canceled),
      },
      plans: {
        FREE: { stars: 0, dailyLimit: cfg.limits.FREE },
        PRO: { stars: billingPlanConfig('PRO', cfg).stars, dailyLimit: cfg.limits.PRO },
        PREMIUM: { stars: billingPlanConfig('PREMIUM', cfg).stars, dailyLimit: cfg.limits.PREMIUM },
      },
      passes: {
        MATCH_PASS: passProductConfig(PASS_TYPES.MATCH, cfg),
        DAY_PASS: passProductConfig(PASS_TYPES.DAY, cfg),
        WEEKEND_PASS: passProductConfig(PASS_TYPES.WEEKEND, cfg),
      },
    });
  }
  
  async function apiEntitlements(request, cfg, user) {
    const url = new URL(request.url);
    const rawFixtureId = url.searchParams.get('fixtureId');
    const fixtureId = rawFixtureId == null || rawFixtureId === '' ? 0 : Number(rawFixtureId);
    if (!Number.isSafeInteger(fixtureId) || fixtureId < 0) {
      return json({ error: 'Некорректный fixtureId.', code: 'ENTITLEMENT_INVALID_FIXTURE' }, 400);
    }
    return json({
      entitlement: await resolveUserEntitlements(user.id, fixtureId, cfg),
      paymentsEnabled: Boolean(cfg.monetizationEnabled),
      products: {
        MATCH_PASS: passProductConfig(PASS_TYPES.MATCH, cfg),
        DAY_PASS: passProductConfig(PASS_TYPES.DAY, cfg),
        WEEKEND_PASS: passProductConfig(PASS_TYPES.WEEKEND, cfg),
      },
    });
  }
  
  async function apiBillingInvoice(request, cfg, user) {
    const webhook = await billingWebhookStatus(request, cfg);
    if (!webhook.ready) return json({ error: 'Оплата ещё не активирована: Telegram webhook не настроен.', webhook }, 503);
  
    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Некорректное тело запроса.', code: 'BILLING_INVALID_JSON' }, 400); }
  
    const passType = String(body?.passType || '').trim().toUpperCase();
    if (passType) {
      const product = passProductConfig(passType, cfg);
      if (!product) return json({ error: 'Неизвестный Pass.', code: 'BILLING_UNKNOWN_PASS' }, 400);
      if (!product.saleReady) {
        return json({
          error: 'Этот Pass ещё не готов к продаже: серверный лимит использования не настроен.',
          code: 'BILLING_PASS_USAGE_LIMIT_REQUIRED',
        }, 503);
      }
  
      const fixtureId = passType === PASS_TYPES.MATCH ? Number(body?.fixtureId || 0) : 0;
      if (passType === PASS_TYPES.MATCH && (!Number.isSafeInteger(fixtureId) || fixtureId <= 0)) {
        return json({ error: 'Для Match Pass нужен корректный fixtureId.', code: 'BILLING_FIXTURE_REQUIRED' }, 400);
      }
      if (passType !== PASS_TYPES.MATCH && body?.fixtureId != null && Number(body.fixtureId || 0) !== 0) {
        return json({ error: 'Этот Pass не привязывается к матчу.', code: 'BILLING_FIXTURE_NOT_ALLOWED' }, 400);
      }
  
      const currentAccess = await resolveUserEntitlements(user.id, fixtureId, cfg);
      if (currentAccess.store?.available !== true) {
        return json({
          error: 'Pass-покупки временно недоступны: хранилище доступов ещё не готово.',
          code: 'BILLING_ENTITLEMENT_STORE_UNAVAILABLE',
        }, 503);
      }
      if (currentAccess.subscriptionActive) {
        return json({ error: 'Активная подписка уже включает расширенный доступ.', code: 'BILLING_SUBSCRIPTION_HAS_ACCESS' }, 409);
      }
  
      const payload = await createPassInvoicePayload(user.id, passType, fixtureId, cfg.botToken);
      const invoiceUrl = await telegramApi('createInvoiceLink', cfg, {
        title: product.title,
        description: product.description,
        payload,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: product.title, amount: product.stars }],
      });
      return json({ invoiceUrl, passType, fixtureId: fixtureId || null, stars: product.stars });
    }
  
    const plan = String(body?.plan || '').toUpperCase();
    const planCfg = billingPlanConfig(plan, cfg);
    if (!planCfg) return json({ error: 'Неизвестный тариф.' }, 400);
  
    const quota = await getQuota(user.id, cfg);
    const record = await getUserRecord(user.id, cfg);
    if (quota.plan !== 'FREE' && record?.subscription_until && new Date(record.subscription_until) > new Date()) {
      return json({ error: quota.plan === plan ? 'Этот тариф уже активен.' : 'Сначала отключите автопродление текущего тарифа и дождитесь окончания оплаченного периода.' }, 409);
    }
  
    const payload = await makeInvoicePayload(user.id, plan, cfg.botToken);
    const invoiceUrl = await telegramApi('createInvoiceLink', cfg, {
      title: planCfg.title,
      description: planCfg.description,
      payload,
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: `${plan} · 30 дней`, amount: planCfg.stars }],
      subscription_period: SUBSCRIPTION_PERIOD_SECONDS,
    });
    return json({ invoiceUrl, plan, stars: planCfg.stars });
  }
  
  async function apiBillingSync(request, cfg, user) {
    return json(await syncBillingFromStars(user.id, cfg));
  }
  
  async function apiBillingSubscription(request, cfg, user) {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Некорректное тело запроса.', code: 'BILLING_INVALID_JSON' }, 400);
    }
    const action = String(body?.action || '').trim().toLowerCase();
    if (!['cancel', 'resume'].includes(action)) {
      return json({ error: 'Укажите действие cancel или resume.', code: 'BILLING_INVALID_ACTION' }, 400);
    }
    const record = await getUserRecord(user.id, cfg);
    const chargeId = String(record?.telegram_payment_charge_id || '');
    if (!chargeId) return json({ error: 'Активная подписка Telegram Stars не найдена.' }, 404);
    await telegramApi('editUserStarSubscription', cfg, {
      user_id: Number(user.id),
      telegram_payment_charge_id: chargeId,
      is_canceled: action === 'cancel',
    });
    await updateUserSubscription(user.id, { subscription_canceled: action === 'cancel' }, cfg);
    return json({ ok: true, canceled: action === 'cancel' });
  }
  
  async function listRefundableBillingCharges(userId, cfg) {
    const uid = Number(userId);
    if (!Number.isSafeInteger(uid) || uid <= 0) return [];
  
    const items = [];
    let payments = [];
    if (hasSupabase(cfg)) {
      payments = await supaSelectMany(cfg, 'billing_payments', {
        telegram_id: `eq.${uid}`,
      }, {
        limit: 20,
        order: 'created_at.desc',
      }).catch(() => []);
    } else {
      payments = [...memory.billingPayments.values()]
        .filter(row => Number(row?.telegram_id || 0) === uid)
        .sort((a, b) => Date.parse(b?.created_at || 0) - Date.parse(a?.created_at || 0))
        .slice(0, 20);
    }
  
    for (const row of payments || []) {
      const chargeId = String(row?.telegram_payment_charge_id || '').trim();
      const status = String(row?.status || 'paid').toLowerCase();
      if (!chargeId || status !== 'paid') continue;
      items.push({
        kind: 'subscription',
        product: String(row?.plan || ''),
        stars: Math.max(0, Number(row?.stars_amount || 0)),
        status,
        createdAt: row?.created_at || null,
        expiresAt: row?.subscription_expiration_date || null,
        fixtureId: null,
        paymentChargeId: chargeId,
        chargeSuffix: chargeId.slice(-8),
      });
    }
  
    const entitlements = await listUserEntitlements(uid, cfg).catch(() => []);
    for (const row of entitlements || []) {
      const chargeId = String(row?.payment_charge_id || row?.paymentChargeId || '').trim();
      const status = String(row?.status || 'active').toLowerCase();
      if (!chargeId || status !== 'active') continue;
      items.push({
        kind: 'pass',
        product: String(row?.entitlement_type || row?.type || ''),
        stars: Math.max(0, Number(row?.stars_amount || row?.starsAmount || 0)),
        status,
        createdAt: row?.created_at || row?.createdAt || null,
        expiresAt: row?.expires_at || row?.expiresAt || null,
        fixtureId: Number(row?.fixture_id || row?.fixtureId || 0) || null,
        paymentChargeId: chargeId,
        chargeSuffix: chargeId.slice(-8),
      });
    }
  
    const seen = new Set();
    return items
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
      .filter(item => {
        if (seen.has(item.paymentChargeId)) return false;
        seen.add(item.paymentChargeId);
        return true;
      })
      .slice(0, 20);
  }
  
  async function apiBillingRefundLookup(request, cfg, user) {
    const url = new URL(request.url);
    const targetUserId = Number(url.searchParams.get('telegramId') || user?.id || 0);
    if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
      return json({ error:'Укажите корректный Telegram ID.', code:'BILLING_REFUND_INVALID_TARGET' }, 400);
    }
    const items = await listRefundableBillingCharges(targetUserId, cfg);
    return json({
      ok:true,
      telegramId:targetUserId,
      items,
    });
  }
  
  async function apiBillingRefund(request, cfg, user) {
    if (!isAdminUser(user, cfg)) return adminForbidden();
  
    let body;
    try { body = await request.json(); }
    catch { return json({ error:'Некорректное тело запроса.', code:'BILLING_INVALID_JSON' }, 400); }
  
    const targetUserId = Number(body?.telegramId || 0);
    const chargeId = String(body?.telegramPaymentChargeId || '').trim();
    const reason = String(body?.reason || '').trim().slice(0, 240);
    if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0 || !chargeId || chargeId.length > 240) {
      return json({ error:'Нужны корректные telegramId и Telegram payment charge ID.', code:'BILLING_REFUND_INVALID_TARGET' }, 400);
    }
    if (reason.length < 3) {
      return json({ error:'Для ручного возврата укажите причину.', code:'BILLING_REFUND_REASON_REQUIRED' }, 400);
    }
  
    const source = await findRefundableBillingCharge(targetUserId, chargeId, cfg);
    if (!source) return json({ error:'Платёж с таким charge ID не принадлежит указанному пользователю.', code:'BILLING_REFUND_NOT_FOUND' }, 404);
  
    let alreadyRefunded = source.status === 'refunded';
    if (!alreadyRefunded) {
      try {
        await telegramApi('refundStarPayment', cfg, {
          user_id: targetUserId,
          telegram_payment_charge_id: chargeId,
        });
      } catch (error) {
        // A previous manual attempt may have refunded Stars successfully before
        // the internal entitlement/subscription reconciliation failed. Telegram
        // documents CHARGE_ALREADY_REFUNDED for that retry; continue with the
        // idempotent internal reconciliation instead of issuing a second refund.
        if (!/CHARGE_ALREADY_REFUNDED/i.test(String(error?.message || ''))) throw error;
        alreadyRefunded = true;
      }
    }
    const revoked = await applyRefundedPayment(targetUserId, chargeId, cfg);
    await recordOpsEvent(cfg, {
      severity:'warning',
      source:'billing',
      eventType:'manual_refund',
      code:'BILLING_MANUAL_REFUND',
      message:'Администратор выполнил ручной возврат Telegram Stars.',
      endpoint:'/api/admin/billing/refund',
      status:200,
      meta:{
        kind:source.kind,
        product:source.plan,
        chargeSuffix:chargeId.slice(-8),
        reason,
        actorRole:'admin',
      },
    }).catch(() => null);
  
    return json({
      ok:true,
      refunded:true,
      reconciled:true,
      alreadyRefunded,
      kind:source.kind,
      subscriptionRevoked:Boolean(revoked?.subscriptionRevoked),
      passRevoked:Boolean(revoked?.passRevoked),
    });
  }
  
  const {
    getCacheEntry,
    getCache,
    getStaleCache,
    setCache,
  } = createSharedCacheRuntime({
    memory,
    bumpTelemetry,
    phase5ProviderCacheUsage,
    hasSupabase,
    supaSelectOne,
    supaUpsert,
    pruneMemoryState,
    recordOpsEvent,
  });
  
  const {
    telegramWebAppUrl,
    telegramAnalysisHandoffParams,
    telegramFullAnalysisUrl,
    oneTapHandoffDrill,
    fixtureShareStartParam,
    campaignStartParam,
    telegramBotUsername,
    fixtureTelegramDeepLink,
    telegramCampaignDeepLink,
    telegramShareComposerUrl,
  } = createTelegramLinksRuntime({
    cleanLaunchPart,
    getCache,
    setCache,
    telegramApi,
  });

  return {
    apiBillingPlans,
    apiEntitlements,
    apiBillingInvoice,
    apiBillingSync,
    apiBillingSubscription,
    listRefundableBillingCharges,
    apiBillingRefundLookup,
    apiBillingRefund
  };
}
